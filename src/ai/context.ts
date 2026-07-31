// ─── Context Memory Refresh ─────────────────────────
// §7 of the original plan: rolling user profile updated every ~5-7 entries.
// Uses the background model (DeepSeek Flash) to analyze tagged summaries
// and maintain a structured profile of the user.

import { chatComplete } from './openrouter';
import {
  getApiKey, getBackgroundModel,
  getContextMemory, saveContextMemory,
  getEntrySummaries, getLastEntriesForContext,
  
} from '../db';
import { REQUEST_CONFIG } from './prompts';

const CONTEXT_REFRESH_PROMPT = `You maintain a rolling profile of a journal user for a private ADHD journaling app. You receive:
1. The user's existing profile (may be empty on first run)
2. Recent entry summaries with dates
3. Full text of the most recent entries

Update the profile based on what you see. Be specific and grounded — only include things the user actually wrote about. Use their own words where possible.

Output ONLY valid JSON matching this schema, nothing else:
{
  "patterns": ["recurring themes, 2-5 items"],
  "keyFacts": ["stable things mentioned: work role, people, hobbies, projects — max 8 items"],
  "openLoops": ["unfinished threads the user hasn't resolved — max 5 items"],
  "recentWins": ["things that went well recently — max 5 items, remove older ones"],
  "moodTrend": "one sentence describing the recent emotional trajectory"
}

Rules:
- Merge new observations with existing profile data (don't discard history)
- Remove keyFacts/openLoops that are no longer mentioned (they may be resolved)
- recentWins should only contain the last 1-2 weeks
- moodTrend should be grounded in actual mood entries and emotional language, not assumed
- Never fabricate details not present in the entries
- If entries are too sparse to determine something, leave that array empty
- No text before or after the JSON`;

interface ContextRefreshResult {
  patterns: string[];
  keyFacts: string[];
  openLoops: string[];
  recentWins: string[];
  moodTrend: string;
}

/**
 * Check if context memory needs refreshing (every ~5 entries).
 * Returns true if refresh should run.
 */
export async function shouldRefreshContext(): Promise<boolean> {
  const memory = await getContextMemory();
  if (!memory) return true; // Never run yet
  const entriesSinceRefresh = await getLastEntriesForContext(10);
  // Count entries newer than last update
  const newer = entriesSinceRefresh.filter(e => e.created > memory.lastUpdated);
  return newer.length >= 5;
}

/**
 * Refresh the context memory profile using the background model.
 * Runs fire-and-forget — errors are swallowed silently.
 */
export async function refreshContextMemory(): Promise<void> {
  try {
    const apiKey = await getApiKey();
    const model = await getBackgroundModel();
    if (!apiKey) return;

    // Get existing memory (if any)
    const existingMemory = await getContextMemory();

    // Get recent entries for analysis
    const summaries = await getEntrySummaries(14); // last 2 weeks
    const recentEntries = await getLastEntriesForContext(5); // full text of last 5

    if (summaries.length === 0 && !existingMemory) return; // Nothing to analyze

    // Build the prompt
    const existingProfile = existingMemory
      ? JSON.stringify({
          patterns: existingMemory.patterns,
          keyFacts: existingMemory.keyFacts,
          openLoops: existingMemory.openLoops,
          recentWins: existingMemory.recentWins,
          moodTrend: existingMemory.moodTrend,
        }, null, 2)
      : '(No existing profile — first run)';

    const entriesText = recentEntries
      .map(e => `[${e.created.split('T')[0]}]\n${e.body.substring(0, 500)}`)
      .join('\n\n');

    const messages = [
      { role: 'system' as const, content: CONTEXT_REFRESH_PROMPT },
      { role: 'user' as const, content: `Existing profile:\n${existingProfile}\n\nRecent entry summaries:\n${summaries.join('\n')}\n\nRecent entries (full text):\n${entriesText}` },
    ];

    const raw = await chatComplete(
      messages,
      { apiKey, model },
      undefined,
      REQUEST_CONFIG.entry_tagging, // reuse low-temp JSON config
    );

    // Parse JSON response
    const cleaned = raw.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: ContextRefreshResult = JSON.parse(cleaned);

    // Validate output — ensure arrays are arrays of strings
    const validated = {
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter((x: any) => typeof x === 'string').slice(0, 10) : [],
      keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.filter((x: any) => typeof x === 'string').slice(0, 10) : [],
      openLoops: Array.isArray(parsed.openLoops) ? parsed.openLoops.filter((x: any) => typeof x === 'string').slice(0, 10) : [],
      recentWins: Array.isArray(parsed.recentWins) ? parsed.recentWins.filter((x: any) => typeof x === 'string').slice(0, 10) : [],
      moodTrend: typeof parsed.moodTrend === 'string' ? parsed.moodTrend : '',
    };

    // Save updated memory
    await saveContextMemory({
      patterns: validated.patterns,
      keyFacts: validated.keyFacts,
      openLoops: validated.openLoops,
      recentWins: validated.recentWins,
      moodTrend: validated.moodTrend,
      lastUpdated: new Date().toISOString(),
      entryCount: summaries.length,
    });
  } catch {
    // Background job — fail silently
  }
}

/**
 * Get the context memory formatted for the reflection prompt.
 */
export async function getContextMemoryPrompt(): Promise<string> {
  const memory = await getContextMemory();
  if (!memory) return '';

  const parts: string[] = [];
  if (memory.patterns.length > 0) {
    parts.push(`Patterns: ${memory.patterns.join('; ')}`);
  }
  if (memory.keyFacts.length > 0) {
    parts.push(`Key facts: ${memory.keyFacts.join('; ')}`);
  }
  if (memory.openLoops.length > 0) {
    parts.push(`Open loops: ${memory.openLoops.join('; ')}`);
  }
  if (memory.recentWins.length > 0) {
    parts.push(`Recent wins: ${memory.recentWins.join('; ')}`);
  }
  if (memory.moodTrend) {
    parts.push(`Mood trend: ${memory.moodTrend}`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}
