// ─── Entry Auto-Tagging ─────────────────────────────
// §5a of the handoff doc: structured extraction on entry save.
// Uses the background model (DeepSeek V4 Flash) with JSON response format.

import { chatComplete } from './openrouter';
import {
  getApiKey, getBackgroundModel, saveEntryTags, getEntrySummaries,
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
 * Runs fire-and-forget on entry save — errors are swallowed silently.
 */
export async function tagEntry(entry: JournalEntry): Promise<EntryTags | null> {
  try {
    const apiKey = await getApiKey();
    const model = await getBackgroundModel();
    if (!apiKey) return null;

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

    const tags = await saveEntryTags({
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

    return tags;
  } catch {
    // Background job — fail silently, don't block the UI
    return null;
  }
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
