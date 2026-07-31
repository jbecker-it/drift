import Dexie, { type Table } from 'dexie';
import { v4 as uuid } from 'uuid';

// ─── Types ───────────────────────────────────────────

export interface JournalEntry {
  id: string;
  body: string;
  created: string;
  mood?: number;
  tags?: string[];
  aiSummary?: string;
  aiReflection?: string;
  isDraft: boolean;
  wordCount: number;
  /** 'pending' | 'complete' | 'failed' — auto-tagging status */
  taggingStatus?: 'pending' | 'complete' | 'failed';
  taggingError?: string;
}

export interface EntryTags {
  id: string;
  entryId: string;
  topics: string[];
  mentions: {
    sleep_hours: number | null;
    mood_words: string[];
    tasks_open: string[];
    tasks_done: string[];
    people: string[];
  };
  one_line_summary: string;
  taggedAt: string;
}

export interface ChatSession {
  id: string;
  started: string;
  ended?: string;
  entryId?: string;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: string }[];
  promptType: 'morning' | 'evening' | 'dump' | 'coach' | 'topic';
}

export interface Reward {
  id: string;
  type: 'streak' | 'deepthought' | 'insight' | 'consistency' | 'wordcount';
  earned: string;
  label: string;
  description: string;
}

export interface MoodEntry {
  id: string;
  date: string;
  mood: number;
  entryId?: string;
}

export interface AppSettings {
  key: string;
  value: string;
}

export interface Task {
  id: string;
  text: string;
  date: string; // YYYY-MM-DD — tasks are per-day
  done: boolean;
  createdAt: string;
  doneAt?: string;
  /** Where the task came from: 'manual' | 'extracted' (from journal tagging) */
  source?: 'manual' | 'extracted';
  /** Entry ID if extracted from a journal entry */
  entryId?: string;
}

export interface ContextMemory {
  id: string; // always 'primary' — single rolling profile
  patterns: string[];      // recurring themes
  keyFacts: string[];      // stable things mentioned (work, people, hobbies)
  openLoops: string[];     // unfinished threads
  recentWins: string[];    // things that went well recently
  moodTrend: string;       // brief trajectory
  lastUpdated: string;     // ISO timestamp
  entryCount: number;      // how many entries have been analyzed
}

// ─── Database ────────────────────────────────────────

class DriftDB extends Dexie {
  entries!: Table<JournalEntry>;
  entryTags!: Table<EntryTags>;
  sessions!: Table<ChatSession>;
  rewards!: Table<Reward>;
  moods!: Table<MoodEntry>;
  tasks!: Table<Task>;
  contextMemory!: Table<ContextMemory>;
  settings!: Table<AppSettings>;

  constructor() {
    super('drift');
    this.version(1).stores({
      entries: 'id, created, mood, isDraft',
      sessions: 'id, entryId, started',
      rewards: 'id, type, earned',
      moods: 'id, date, entryId',
      settings: 'key',
    });
    this.version(2).stores({
      entryTags: 'id, entryId, taggedAt',
    });
    // v3: make entryId unique in entryTags to prevent duplicates
    this.version(3).stores({
      entryTags: 'entryId, taggedAt',
    });
    // v4: add tasks table for daily task tracking
    this.version(4).stores({
      tasks: 'id, date, done, entryId',
    });
    // v5: add context memory for rolling user profile
    this.version(5).stores({
      contextMemory: 'id',
    });
  }
}

export const db = new DriftDB();

// ─── Helpers ─────────────────────────────────────────

/** Get a YYYY-MM-DD string in the user's local timezone (not UTC). */
function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD key back to a local Date (avoids UTC midnight issues). */
function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── Entry helpers ───────────────────────────────────

export async function saveEntry(body: string, mood?: number, tags?: string[]): Promise<JournalEntry> {
  const entry: JournalEntry = {
    id: uuid(),
    body,
    created: new Date().toISOString(),
    mood,
    tags,
    isDraft: false,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
  await db.entries.add(entry);
  return entry;
}

export async function saveDraft(body: string): Promise<JournalEntry> {
  const entry: JournalEntry = {
    id: uuid(),
    body,
    created: new Date().toISOString(),
    isDraft: true,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
  await db.entries.add(entry);
  return entry;
}

/**
 * Finalize a draft into a permanent entry (updates in-place instead of creating duplicate).
 */
export async function finalizeDraft(
  draftId: string,
  body: string,
  mood?: number,
): Promise<JournalEntry> {
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const updates: Partial<JournalEntry> = {
    body,
    mood,
    wordCount,
    isDraft: false,
  };
  await db.entries.update(draftId, updates);
  const entry = await db.entries.get(draftId);
  if (!entry) throw new Error('Draft not found after finalization');
  return entry;
}

export async function updateEntry(id: string, updates: Partial<JournalEntry>): Promise<void> {
  const old = await db.entries.get(id);
  await db.entries.update(id, updates);

  // Sync mood history if mood property was explicitly included in the update
  const hasMoodUpdate = Object.prototype.hasOwnProperty.call(updates, 'mood');
  if (hasMoodUpdate && old) {
    if (updates.mood === undefined || updates.mood === null) {
      // Mood removed — delete the mood record
      await db.moods.where('entryId').equals(id).delete();
    } else if (updates.mood !== old.mood) {
      // Mood changed — update or create mood record
      const existing = await db.moods.where('entryId').equals(id).first();
      if (existing) {
        await db.moods.update(existing.id, { mood: updates.mood });
      } else {
        await db.moods.add({
          id: uuid(),
          date: localDateKey(new Date(old.created)),
          mood: updates.mood,
          entryId: id,
        });
      }
    }
  }
}

/**
 * Delete an entry and all related data (tags, moods, sessions) in one transaction.
 * Also cancels any pending background tagging for this entry.
 */
export async function deleteEntry(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.entries,
    db.entryTags,
    db.moods,
    db.sessions,
    db.tasks,
    async () => {
      await db.entries.delete(id);
      await db.entryTags.where('entryId').equals(id).delete();
      await db.moods.where('entryId').equals(id).delete();
      await db.sessions.where('entryId').equals(id).delete();
      await db.tasks.where('entryId').equals(id).delete();
    },
  );
}

/** Get non-draft entries only, ordered newest first. */
export async function getRecentEntries(limit: number = 10): Promise<JournalEntry[]> {
  const all = await db.entries
    .orderBy('created')
    .reverse()
    .filter(e => !e.isDraft)
    .limit(limit)
    .toArray();
  return all;
}

/** Get non-draft entries since a given date. */
export async function getEntriesSince(date: Date): Promise<JournalEntry[]> {
  const results = await db.entries
    .where('created')
    .above(date.toISOString())
    .toArray();
  return results
    .filter(e => !e.isDraft)
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Get today's non-draft entries. */
export async function getTodaysEntries(): Promise<JournalEntry[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getEntriesSince(today);
}

/** Get ALL non-draft entries (for accurate total counts). */
export async function getAllNonDraftEntries(): Promise<JournalEntry[]> {
  const all = await db.entries.toArray();
  return all.filter(e => !e.isDraft);
}

// ─── Session helpers ─────────────────────────────────

export async function createSession(promptType: ChatSession['promptType'], entryId?: string): Promise<ChatSession> {
  const session: ChatSession = {
    id: uuid(),
    started: new Date().toISOString(),
    entryId,
    messages: [],
    promptType,
  };
  await db.sessions.add(session);
  return session;
}

export async function addMessageToSession(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await db.sessions.where('id').equals(sessionId).modify(session => {
    session.messages.push({ role, content, timestamp: new Date().toISOString() });
  });
}

export async function endSession(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { ended: new Date().toISOString() });
}

// ─── Mood helpers ────────────────────────────────────

export async function logMood(mood: number, entryId?: string): Promise<MoodEntry> {
  const today = localDateKey();
  const entry: MoodEntry = {
    id: uuid(),
    date: today,
    mood,
    entryId,
  };
  await db.moods.add(entry);
  return entry;
}

export async function getMoodHistory(days: number = 30): Promise<MoodEntry[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.moods.where('date').aboveOrEqual(localDateKey(since)).toArray();
}

// ─── Reward helpers ──────────────────────────────────

export async function awardReward(
  type: Reward['type'],
  label: string,
  description: string
): Promise<Reward | null> {
  // Use a transaction for atomic check-and-insert
  return db.transaction('rw', db.rewards, async () => {
    // Check both by type (new format) and scan for legacy UUID-keyed entries
    const existing = await db.rewards.where('type').equals(type).first();
    if (existing) return null;

    const reward: Reward = {
      id: type, // type IS the primary key — unique by definition
      type,
      earned: new Date().toISOString(),
      label,
      description,
    };
    await db.rewards.put(reward);
    return reward;
  });
}

export async function getAllRewards(): Promise<Reward[]> {
  return db.rewards.orderBy('earned').reverse().toArray();
}

// ─── Settings helpers ────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getApiKey(): Promise<string | null> {
  return getSetting('openrouter_api_key');
}

export async function getModel(): Promise<string> {
  return (await getSetting('openrouter_model')) || 'anthropic/claude-sonnet-5';
}

export async function getBackgroundModel(): Promise<string> {
  const val = await getSetting('openrouter_background_model');
  if (val === 'same') {
    return getModel();
  }
  return val || 'deepseek/deepseek-v4-flash';
}

export async function setBackgroundModel(model: string): Promise<void> {
  await setSetting('openrouter_background_model', model);
}

const VALID_PERSONALITIES: readonly string[] = ['coach', 'listener', 'challenger'];

export async function getPersonality(): Promise<string> {
  const val = (await getSetting('personality')) || 'coach';
  return VALID_PERSONALITIES.includes(val) ? val : 'coach';
}

// ─── Streak calculation ──────────────────────────────

export async function calculateStreak(): Promise<{ current: number; longest: number; lastEntryDate: string | null }> {
  const allEntries = await db.entries.toArray();
  const entries = allEntries
    .filter(e => !e.isDraft)
    .sort((a, b) => b.created.localeCompare(a.created));

  if (entries.length === 0) return { current: 0, longest: 0, lastEntryDate: null };

  // Get unique local dates
  const dates = [...new Set(entries.map(e => localDateKey(new Date(e.created))))].sort().reverse();

  const today = localDateKey();
  // Use local calendar arithmetic for DST safety
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate);

  // Helper: count streak from a list of dates, allowing at most one 2-day gap
  function countStreak(dateList: string[]): number {
    if (dateList.length === 0) return 0;
    let streak = 0;
    let checkDate = new Date();
    let gapUsed = false;

    for (const date of dateList) {
      const expected = localDateKey(checkDate);
      if (date === expected) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (date < expected && !gapUsed) {
        // Allow one gap: skip one day
        gapUsed = true;
        checkDate.setDate(checkDate.getDate() - 1);
        const expectedAfterGap = localDateKey(checkDate);
        if (date === expectedAfterGap) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return streak;
  }

  // Current streak — only active if latest entry is today or yesterday
  const isStreakActive = dates[0] === today || dates[0] === yesterday;
  const current = isStreakActive ? countStreak(dates) : 0;

  // Longest streak — scan ALL date sequences (oldest to newest)
  let longest = 0;
  let tempStreak = 0;
  let tempGapUsed = false;
  let prevDate: string | null = null;

  for (const date of [...dates].reverse()) {
    if (prevDate) {
      const prev = parseLocalDateKey(prevDate);
      const curr = parseLocalDateKey(date);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays === 2 && !tempGapUsed) {
        // Forgiving: allow one 2-day gap per streak
        tempGapUsed = true;
        tempStreak++;
      } else {
        // New streak
        longest = Math.max(longest, tempStreak);
        tempStreak = 1;
        tempGapUsed = false;
      }
    } else {
      tempStreak = 1;
    }
    prevDate = date;
  }
  longest = Math.max(longest, tempStreak);

  return { current, longest, lastEntryDate: dates[0] ?? null };
}

// ─── Export ──────────────────────────────────────────

export async function exportAllData(): Promise<string> {
  const data = {
    entries: await db.entries.toArray(),
    entryTags: await db.entryTags.toArray(),
    sessions: await db.sessions.toArray(),
    rewards: await db.rewards.toArray(),
    moods: await db.moods.toArray(),
    tasks: await db.tasks.toArray(),
    contextMemory: await db.contextMemory.toArray(),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(data, null, 2);
}

export async function clearAllData(): Promise<void> {
  await db.entries.clear();
  await db.entryTags.clear();
  await db.sessions.clear();
  await db.rewards.clear();
  await db.moods.clear();
  await db.tasks.clear();
  await db.contextMemory.clear();
  await db.tasks.clear();
  await db.settings.clear();
}

// ─── Entry tags helpers ──────────────────────────────

export async function saveEntryTags(tags: Omit<EntryTags, 'id'>): Promise<EntryTags> {
  // Use entryId as the key to prevent duplicates
  const existing = await db.entryTags.where('entryId').equals(tags.entryId).first();
  if (existing) {
    // Update existing tag record
    const updated: EntryTags = { ...existing, ...tags };
    await db.entryTags.put(updated);
    return updated;
  }
  const record: EntryTags = { ...tags, id: uuid() };
  await db.entryTags.put(record);
  return record;
}

export async function getTagsForEntry(entryId: string): Promise<EntryTags | null> {
  return (await db.entryTags.where('entryId').equals(entryId).first()) ?? null;
}

export async function getEntrySummaries(limit: number = 14): Promise<string[]> {
  const tags = await db.entryTags
    .orderBy('taggedAt')
    .reverse()
    .limit(limit * 2)
    .toArray();
  const results: string[] = [];
  for (const tag of tags) {
    if (!tag.one_line_summary) continue;
    const entry = await db.entries.get(tag.entryId);
    const date = entry ? entry.created.split('T')[0] : tag.taggedAt.split('T')[0];
    results.push(`[${date}] ${tag.one_line_summary}`);
    if (results.length >= limit) break;
  }
  return results;
}

// ─── Task helpers ────────────────────────────────────

/** Add a task for today. */
export async function addTask(text: string): Promise<Task> {
  const task: Task = {
    id: uuid(),
    text,
    date: localDateKey(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  await db.tasks.add(task);
  return task;
}

/** Toggle a task's done status. */
export async function toggleTask(id: string): Promise<void> {
  await db.tasks.where('id').equals(id).modify(task => {
    task.done = !task.done;
    task.doneAt = task.done ? new Date().toISOString() : undefined;
  });
}

/** Delete a task. */
export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

/** Get today's tasks. */
export async function getTodaysTasks(): Promise<Task[]> {
  const today = localDateKey();
  return db.tasks.where('date').equals(today).toArray();
}

/** Get tasks for a specific date. */
export async function getTasksForDate(date: string): Promise<Task[]> {
  return db.tasks.where('date').equals(date).toArray();
}

/** Get a summary of today's tasks for AI context. */
export async function getTodayTasksSummary(): Promise<string> {
  const tasks = await getTodaysTasks();
  if (tasks.length === 0) return '';
  const done = tasks.filter(t => t.done).map(t => `✓ ${t.text}`);
  const open = tasks.filter(t => !t.done).map(t => `○ ${t.text}`);
  return [...open, ...done].join('\n');
}

// ─── Context Memory helpers ──────────────────────────

/** Get the rolling context memory profile (singleton). */
export async function getContextMemory(): Promise<ContextMemory | null> {
  return (await db.contextMemory.get('primary')) ?? null;
}

/** Save/update the context memory profile. */
export async function saveContextMemory(memory: Omit<ContextMemory, 'id'>): Promise<void> {
  await db.contextMemory.put({ ...memory, id: 'primary' });
}

/** Get the last N non-draft entries for context building. */
export async function getLastEntriesForContext(count: number = 10): Promise<JournalEntry[]> {
  return db.entries
    .orderBy('created')
    .reverse()
    .filter(e => !e.isDraft)
    .limit(count)
    .toArray();
}

// ─── Task extraction from tagging ────────────────────

/**
 * Promote tasks extracted by auto-tagging into the Tasks table.
 * Called after tagEntry() completes — looks at tasks_open and tasks_done.
 */
export async function extractTasksFromTags(entry: JournalEntry): Promise<void> {
  const tags = await getTagsForEntry(entry.id);
  if (!tags) return;

  const entryDate = localDateKey(new Date(entry.created));

  // Add open tasks
  for (const taskText of (tags.mentions?.tasks_open ?? [])) {
    if (!taskText.trim()) continue;
    // Skip if a task with the same text already exists for this entry
    const existing = await db.tasks
      .where('entryId')
      .equals(entry.id)
      .filter(t => t.text === taskText)
      .first();
    if (existing) continue;

    await db.tasks.add({
      id: uuid(),
      text: taskText,
      date: entryDate,
      done: false,
      createdAt: entry.created,
      source: 'extracted',
      entryId: entry.id,
    });
  }

  // Mark done tasks as completed
  for (const taskText of (tags.mentions?.tasks_done ?? [])) {
    if (!taskText.trim()) continue;
    const existing = await db.tasks
      .where('entryId')
      .equals(entry.id)
      .filter(t => t.text === taskText)
      .first();
    if (existing) {
      await db.tasks.update(existing.id, { done: true, doneAt: entry.created });
    } else {
      await db.tasks.add({
        id: uuid(),
        text: taskText,
        date: entryDate,
        done: true,
        createdAt: entry.created,
        doneAt: entry.created,
        source: 'extracted',
        entryId: entry.id,
      });
    }
  }
}
