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
  // Mark as pending
  await updateEntry(entry.id, { taggingStatus: 'pending' });

  try {
    const apiKey = await getApiKey();
    const model = await getBackgroundModel();
    if (!apiKey) throw new Error('API key not set');

    const messages = getEntryTaggingPrompt(entry.body);
    const raw = await chatComplete(
      messages,
      { apiKey, model },
      undefined,
      REQUEST_CONFIG.entry_tagging,
    );

    // Parse JSON response — strip any markdown fences the model might add
    const cleaned = raw.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: TaggingResult = JSON.parse(cleaned);

    // Verify entry still exists and save tags atomically (prevents orphan after delete)
    const tags = await db.transaction('rw', db.entries, db.entryTags, async () => {
      const entryStillExists = await db.entries.get(entry.id);
      if (!entryStillExists) return null;
      return saveEntryTags({
        entryId: entry.id,
        topics: parsed.topics ?? [],
        mentions: {
          sleep_hours: parsed.mentions?.sleep_hours ?? null,
          mood_words: parsed.mentions?.mood_words ?? [],
          tasks_open: parsed.mentions?.tasks_open ?? [],
          tasks_done: parsed.mentions?.tasks_done ?? [],
          people: parsed.mentions?.people ?? [],
        },
        one_line_summary: parsed.one_line_summary ?? '',
        taggedAt: new Date().toISOString(),
      });
    });

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
