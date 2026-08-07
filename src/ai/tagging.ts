// ─── Entry Auto-Tagging ─────────────────────────────
// §5a of the handoff doc: structured extraction on entry save.
// Uses the background model (DeepSeek V4 Flash) with JSON response format.

import { chatComplete } from './openrouter';
import {
  db, getApiKey, getBackgroundModel, saveEntryTags, getEntrySummaries, updateEntry,
  type JournalEntry, type EntryTags,
} from '../db';
import { getEntryTaggingPrompt, getWeeklySummaryPrompt, REQUEST_CONFIG } from './prompts';

// ─── Entry tagging ──────────────────────────────────

export interface TaggingResult {
  topics: string[];
  mentions: {
    sleep_hours: number | null;
    mood_words: string[];
    tasks_open: string[];
    tasks_done: string[];
    people: string[];
  };
  one_line_summary: string;
}

/**
 * Tag a journal entry with structured data using the background model.
 * Runs fire-and-forget on entry save. Tracks status on the entry itself (#10).
 */
export async function tagEntry(entry: JournalEntry): Promise<EntryTags | null> {
  const apiKey = await getApiKey();
  const model = await getBackgroundModel();
  // AI not configured — bail silently instead of recording a "failed" state that
  // can never succeed and shows a misleading retry button.
  if (!apiKey) return null;

  // Mark as pending
  await updateEntry(entry.id, { taggingStatus: 'pending' });

  try {
    const messages = getEntryTaggingPrompt(entry.body);
    const raw = await chatComplete(
      messages,
      { apiKey, model },
      undefined,
      REQUEST_CONFIG.entry_tagging,
    );

    // Parse JSON response — strip any markdown fences the model might add
    const cleaned = raw.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: Partial<TaggingResult> = JSON.parse(cleaned);

    // Defensively validate the parsed shape (json_object guarantees valid JSON,
    // NOT schema conformance). A malformed response must never reach IndexedDB
    // and crash entry rendering — mirror the validation used in ai/context.ts.
    const asStrArr = (v: any): string[] =>
      Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : [];
    const mentions = (parsed.mentions ?? {}) as Record<string, any>;

    // Verify entry still exists and save tags atomically (prevents orphan after delete)
    const tags = await db.transaction('rw', db.entries, db.entryTags, async () => {
      const entryStillExists = await db.entries.get(entry.id);
      if (!entryStillExists) return null;
      return saveEntryTags({
        entryId: entry.id,
        topics: asStrArr(parsed.topics).slice(0, 5),
        mentions: {
          sleep_hours: typeof mentions.sleep_hours === 'number' ? mentions.sleep_hours : null,
          mood_words: asStrArr(mentions.mood_words),
          tasks_open: asStrArr(mentions.tasks_open),
          tasks_done: asStrArr(mentions.tasks_done),
          people: asStrArr(mentions.people),
        },
        one_line_summary: typeof parsed.one_line_summary === 'string' ? parsed.one_line_summary : '',
        taggedAt: new Date().toISOString(),
      });
    });

    // Entry was deleted mid-tag (transaction returned null) — don't write status
    // to a gone entry and don't report a spurious completion.
    if (tags === null) return null;

    // Mark as complete
    await updateEntry(entry.id, { taggingStatus: 'complete', taggingError: undefined });

    return tags;
  } catch (err: any) {
    // Record the error on the entry so UI can show retry option (#10)
    const errorMsg = err?.message || 'Unknown error';
    await updateEntry(entry.id, { taggingStatus: 'failed', taggingError: errorMsg });
    return null;
  }
}

/**
 * Retry tagging for a failed entry.
 */
export async function retryTagEntry(entry: JournalEntry): Promise<EntryTags | null> {
  return tagEntry(entry);
}

// ─── Weekly summary ─────────────────────────────────

/**
 * Generate a weekly summary from stored entry summaries.
 * §5b of the handoff doc. Runs on-demand from the Dashboard.
 */
export async function generateWeeklySummary(): Promise<string> {
  const apiKey = await getApiKey();
  const model = await getBackgroundModel();
  if (!apiKey) throw new Error('API key not set');

  const summaries = await getEntrySummaries(14); // last 2 weeks
  if (summaries.length === 0) {
    return 'No tagged entries yet. Write some entries and let them be tagged first.';
  }

  const messages = getWeeklySummaryPrompt(summaries.join('\n'));
  return chatComplete(
    messages,
    { apiKey, model },
    undefined,
    REQUEST_CONFIG.weekly_summary,
  );
}
