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
  date: string; // YYYY-MM-DD — tasks are per-day (for 'daily' type)
  done: boolean;
  createdAt: string;
  doneAt?: string;
  /** Where the task came from: 'manual' | 'extracted' (from journal tagging) */
  source?: 'manual' | 'extracted';
  /** Entry ID if extracted from a journal entry */
  entryId?: string;
  /** Link back to template if auto-generated from a template */
  templateId?: string;
  /** ISO week key YYYY-Wxx for weekly task instances */
  weekKey?: string;
  /** Task type: 'daily' (per-day, default) | 'todo' (persists until done) */
  type?: 'daily' | 'todo';
  /** Optional due date for to-dos (YYYY-MM-DD) */
  dueDate?: string;
  // NOTE for sync: Task has no `updatedAt` field. The sync layer (getTimestamp in
  // webdavSync.ts) uses `createdAt` as a fallback, but mutations like toggleTask
  // (done/doneAt changes) won't produce a newer timestamp. A proper fix requires
  // adding an `updatedAt` field to Task and updating it on every mutation.
}

export interface TaskTemplate {
  id: string;
  text: string;
  /** 'preset' = daily time-of-day, 'weekly' = weekly frequency, 'oneoff' = created once */
  type: 'preset' | 'weekly' | 'oneoff';
  /** Time-of-day slot for preset tasks */
  preset?: 'morning' | 'midday' | 'afternoon' | 'night';
  /** How many completions needed per week (for weekly tasks) */
  weekFrequency?: number;
  createdAt: string;
  /** Can be deactivated without deleting */
  active: boolean;
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
  taskTemplates!: Table<TaskTemplate>;
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
    // NOTE: Dexie upgrade() callbacks run in the OLD schema context,
    // so entryTags still has 'id' as primary key during this callback.
    this.version(3).stores({
      entryTags: 'entryId, taggedAt',
    }).upgrade(async (tx) => {
      // Deduplicate: keep the latest tag record per entryId
      // Running in old schema context where 'id' is still the primary key
      const tags = await tx.table('entryTags').toArray();
      const seen = new Map<string, any>();
      for (const tag of tags) {
        const existing = seen.get(tag.entryId);
        if (!existing || tag.taggedAt > existing.taggedAt) {
          if (existing) {
            await tx.table('entryTags').delete(existing.id);
          }
          seen.set(tag.entryId, tag);
        } else {
          await tx.table('entryTags').delete(tag.id);
        }
      }
    });
    // v4: add tasks table for daily task tracking
    this.version(4).stores({
      tasks: 'id, date, done',
    });
    // v5: add context memory
    this.version(5).stores({
      contextMemory: 'id',
    });
    // v6: add entryId index to tasks (was missing in v4)
    this.version(6).stores({
      tasks: 'id, date, done, entryId',
    });
    // v7: add taskTemplates table for presets, weekly tasks
    this.version(7).stores({
      tasks: 'id, date, done, entryId, templateId, weekKey',
      taskTemplates: 'id, type, active',
    });
    // v8: add type/dueDate to tasks for to-do support
    this.version(8).stores({
      tasks: 'id, date, done, entryId, templateId, weekKey, type, dueDate',
    });
    // v9: explicit full schema — defines ALL tables so Dexie sees the final state.
    // Does NOT bypass old migrations (v3 still runs for databases below v3).
    // Combined with error recovery that deletes DB on migration failure.
    this.version(9).stores({
      entries: 'id, created, mood, isDraft',
      entryTags: 'entryId, taggedAt',
      sessions: 'id, entryId, started',
      rewards: 'id, type, earned',
      moods: 'id, date, entryId',
      tasks: 'id, date, done, entryId, templateId, weekKey, type, dueDate',
      taskTemplates: 'id, type, active',
      contextMemory: 'id',
      settings: 'key',
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
  await db.entries.update(draftId, { ...updates, updatedAt: new Date().toISOString() } as any);
  const entry = await db.entries.get(draftId);
  if (!entry) throw new Error('Draft not found after finalization');
  return entry;
}

export async function updateEntry(id: string, updates: Partial<JournalEntry>): Promise<void> {
  const old = await db.entries.get(id);
  await db.entries.update(id, { ...updates, updatedAt: new Date().toISOString() } as any);

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
  // Record tombstones before deletion for sync propagation.
  // Use bulk recordDeletions to avoid Promise.all race on the tombstone store.
  const { recordDeletions } = await import('../sync/webdavSync');
  const [tags, moods, sessions, tasks] = await Promise.all([
    db.entryTags.where('entryId').equals(id).toArray(),
    db.moods.where('entryId').equals(id).toArray(),
    db.sessions.where('entryId').equals(id).toArray(),
    db.tasks.where('entryId').equals(id).toArray(),
  ]);
  const deletions: { table: string; recordId: string }[] = [
    { table: 'entries', recordId: id },
    ...tags.map(t => ({ table: 'entryTags', recordId: t.id })),
    ...moods.map(m => ({ table: 'moods', recordId: m.id })),
    ...sessions.map(s => ({ table: 'sessions', recordId: s.id })),
    ...tasks.map(t => ({ table: 'tasks', recordId: t.id })),
  ];
  await recordDeletions(deletions);

  await db.transaction('rw', [db.entries, db.entryTags, db.moods, db.sessions, db.tasks], async () => {
    await db.entries.delete(id);
    await db.entryTags.where('entryId').equals(id).delete();
    await db.moods.where('entryId').equals(id).delete();
    await db.sessions.where('entryId').equals(id).delete();
    await db.tasks.where('entryId').equals(id).delete();
  });
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
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const results = await db.entries
    .where('created')
    .between(today.toISOString(), tomorrow.toISOString(), true, false)
    .toArray();
  return results
    .filter(e => !e.isDraft)
    .sort((a, b) => b.created.localeCompare(a.created));
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
  triggerSync();
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
  triggerSync();
}

export async function endSession(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { ended: new Date().toISOString() });
  triggerSync();
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
  triggerSync();
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
  const result = await db.transaction('rw', db.rewards, async () => {
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
  if (result) triggerSync();
  return result;
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
  // NOTE: Settings table is excluded from export to prevent leaking
  // sensitive credentials (openrouter_api_key, webdav_sync password/URL)
  const data = {
    entries: await db.entries.toArray(),
    entryTags: await db.entryTags.toArray(),
    sessions: await db.sessions.toArray(),
    rewards: await db.rewards.toArray(),
    moods: await db.moods.toArray(),
    tasks: await db.tasks.toArray(),
    taskTemplates: await db.taskTemplates.toArray(),
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
  await db.taskTemplates.clear();
  await db.contextMemory.clear();
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
    (task as any).updatedAt = new Date().toISOString();
  });
}

/** Delete a task. */
export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

/** Get today's tasks (excluding to-dos which persist across days). */
export async function getTodaysTasks(): Promise<Task[]> {
  const today = localDateKey();
  return db.tasks.where('date').equals(today).filter(t => t.type !== 'todo').toArray();
}

/** Get tasks for a specific date. */
export async function getTasksForDate(date: string): Promise<Task[]> {
  return db.tasks.where('date').equals(date).toArray();
}

/** Get today's tasks filtered by preset slot (via template). */
export async function getTodaysTasksBySlot(
  slot: 'morning' | 'midday' | 'afternoon' | 'night'
): Promise<Task[]> {
  const today = localDateKey();
  const templates = await db.taskTemplates
    .where('type').equals('preset')
    .filter(t => t.preset === slot && t.active)
    .toArray();

  const templateIds = templates.map(t => t.id);
  if (templateIds.length === 0) return [];

  return db.tasks
    .where('date').equals(today)
    .filter(t => !!t.templateId && templateIds.includes(t.templateId) && !t.done)
    .toArray();
}

/** Get today's custom tasks (no template, not todo type). */
export async function getTodaysCustomTasks(): Promise<Task[]> {
  const today = localDateKey();
  return db.tasks
    .where('date').equals(today)
    .filter(t => !t.templateId && t.type !== 'todo' && !t.done)
    .toArray();
}

/** Get a summary of today's tasks for AI context. */
export async function getTodayTasksSummary(): Promise<string> {
  const tasks = await getTodaysTasks();
  if (tasks.length === 0) return '';
  const done = tasks.filter(t => t.done).map(t => `✓ ${t.text}`);
  const open = tasks.filter(t => !t.done).map(t => `○ ${t.text}`);
  return [...open, ...done].join('\n');
}

// ─── Task Template helpers ─────────────────────────

/** Get the ISO week key for a date (YYYY-Wxx). Weeks start on Monday. */
export function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Set to Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Create a new task template. */
export async function createTaskTemplate(
  text: string,
  type: TaskTemplate['type'],
  preset?: TaskTemplate['preset'],
  weekFrequency?: number,
): Promise<TaskTemplate> {
  const template: TaskTemplate = {
    id: uuid(),
    text,
    type,
    preset,
    weekFrequency,
    createdAt: new Date().toISOString(),
    active: true,
  };
  await db.taskTemplates.add(template);
  return template;
}

/** Get all active templates. */
export async function getActiveTemplates(): Promise<TaskTemplate[]> {
  return db.taskTemplates.filter(t => t.active).toArray();
}

/** Get templates by type. */
export async function getTemplatesByType(type: TaskTemplate['type']): Promise<TaskTemplate[]> {
  return db.taskTemplates.where('type').equals(type).filter(t => t.active).toArray();
}

/** Update a template. */
export async function updateTaskTemplate(id: string, updates: Partial<TaskTemplate>): Promise<void> {
  await db.taskTemplates.update(id, updates);
}

/** Deactivate (soft-delete) a template. */
export async function deactivateTemplate(id: string): Promise<void> {
  await db.taskTemplates.update(id, { active: false });
}

/** Move a task template to a different preset slot. */
export async function moveTemplateToPreset(id: string, newPreset: TaskTemplate['preset']): Promise<void> {
  await db.taskTemplates.update(id, { preset: newPreset });
}

/** Delete a template and all its task instances. */
export async function deleteTaskTemplate(id: string): Promise<void> {
  await db.transaction('rw', db.taskTemplates, db.tasks, async () => {
    await db.taskTemplates.delete(id);
    await db.tasks.where('templateId').equals(id).delete();
  });
}

/**
 * Ensure today's task instances exist for all active daily preset templates.
 * Creates a Task for each preset template if one doesn't already exist for today.
 */
export async function ensureDailyPresetInstances(): Promise<void> {
  const today = localDateKey();
  const presets = await getTemplatesByType('preset');

  for (const template of presets) {
    const existing = await db.tasks
      .where('templateId')
      .equals(template.id)
      .filter(t => t.date === today)
      .first();
    if (!existing) {
      await db.tasks.add({
        id: uuid(),
        text: template.text,
        date: today,
        done: false,
        createdAt: new Date().toISOString(),
        source: 'manual',
        templateId: template.id,
      });
    }
  }
}

/**
 * Ensure this week's task instances exist for all active weekly templates.
 * For a template with weekFrequency=3, creates 3 task instances if <3 exist for this week.
 */
export async function ensureWeeklyTaskInstances(): Promise<void> {
  const weekKey = getWeekKey();
  const weeklyTemplates = await getTemplatesByType('weekly');

  for (const template of weeklyTemplates) {
    const frequency = template.weekFrequency ?? 1;
    const existing = await db.tasks
      .where('templateId')
      .equals(template.id)
      .filter(t => t.weekKey === weekKey)
      .toArray();

    // Create missing instances up to the frequency count
    const toCreate = frequency - existing.length;
    for (let i = 0; i < toCreate; i++) {
      // Default to today's date for new instances
      await db.tasks.add({
        id: uuid(),
        text: template.text,
        date: localDateKey(),
        done: false,
        createdAt: new Date().toISOString(),
        source: 'manual',
        templateId: template.id,
        weekKey,
      });
    }
  }
}

/**
 * Get this week's tasks for a weekly template, with completion stats.
 */
export async function getWeeklyTaskInstances(
  templateId: string,
): Promise<{ tasks: Task[]; done: number; total: number; frequency: number }> {
  const weekKey = getWeekKey();
  const template = await db.taskTemplates.get(templateId);
  if (!template) return { tasks: [], done: 0, total: 0, frequency: 1 };

  const tasks = await db.tasks
    .where('templateId')
    .equals(templateId)
    .filter(t => t.weekKey === weekKey)
    .toArray();

  const frequency = template.weekFrequency ?? 1;
  return {
    tasks,
    done: tasks.filter(t => t.done).length,
    total: tasks.length,
    frequency,
  };
}

/**
 * Get all active templates with their current week's instance status.
 */
export async function getTemplatesWithStatus(): Promise<{
  presets: { template: TaskTemplate; instance?: Task }[];
  weekly: { template: TaskTemplate; done: number; total: number; frequency: number }[];
}> {
  const today = localDateKey();
  const weekKey = getWeekKey();

  const allTemplates = await getActiveTemplates();

  // Daily presets
  const presetTemplates = allTemplates.filter(t => t.type === 'preset');
  const presets = await Promise.all(
    presetTemplates.map(async (template) => {
      const instance = await db.tasks
        .where('templateId')
        .equals(template.id)
        .filter(t => t.date === today)
        .first();
      return { template, instance };
    }),
  );

  // Weekly tasks
  const weeklyTemplates = allTemplates.filter(t => t.type === 'weekly');
  const weekly = await Promise.all(
    weeklyTemplates.map(async (template) => {
      const tasks = await db.tasks
        .where('templateId')
        .equals(template.id)
        .filter(t => t.weekKey === weekKey)
        .toArray();
      const frequency = template.weekFrequency ?? 1;
      return {
        template,
        done: tasks.filter(t => t.done).length,
        total: tasks.length,
        frequency,
      };
    }),
  );

  return { presets, weekly };
}

// ─── To-Do helpers ─────────────────────────────────

/** Create a to-do task (persists until done, optional due date). */
export async function addTodo(text: string, dueDate?: string): Promise<Task> {
  const task: Task = {
    id: uuid(),
    text,
    date: localDateKey(), // creation date
    done: false,
    createdAt: new Date().toISOString(),
    source: 'manual',
    type: 'todo',
    dueDate,
  };
  await db.tasks.add(task);
  return task;
}

/** Get all open to-dos, sorted by due date (undated first, then by urgency). */
export async function getOpenTodos(): Promise<Task[]> {
  const todos = await db.tasks
    .filter(t => t.type === 'todo' && !t.done)
    .toArray();
  return todos.sort((a, b) => {
    // Undated to-dos come first
    if (!a.dueDate && !b.dueDate) return a.createdAt.localeCompare(b.createdAt);
    if (!a.dueDate) return -1;
    if (!b.dueDate) return 1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

/** Get all to-dos (open + done). */
export async function getAllTodos(): Promise<Task[]> {
  return db.tasks
    .filter(t => t.type === 'todo')
    .toArray();
}

/** Check if a to-do is overdue (due date is before today). */
export function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  return dueDate < localDateKey();
}

/** Check if a to-do is due today. */
export function isDueToday(dueDate?: string): boolean {
  if (!dueDate) return false;
  return dueDate === localDateKey();
}

/** Check if a to-do is due this week. */
export function isDueThisWeek(dueDate?: string): boolean {
  if (!dueDate) return false;
  const today = new Date();
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
  return dueDate <= localDateKey(endOfWeek);
}

// ─── AI Nudge Summary ──────────────────────────────

/**
 * Build a task nudge summary for AI context.
 * Includes undone daily tasks, overdue/upcoming to-dos, and stalling weekly tasks.
 */
export async function getTaskNudgeSummary(): Promise<string> {
  const parts: string[] = [];
  const today = localDateKey();

  // 1. Undone daily tasks
  const dailyTasks = await getTodaysTasks();
  const undoneDaily = dailyTasks.filter(t => !t.done && !t.templateId);
  if (undoneDaily.length > 0) {
    parts.push(`Undone today: ${undoneDaily.map(t => t.text).join(', ')}`);
  }

  // 2. To-dos — overdue and due soon
  const todos = await getOpenTodos();
  const overdue = todos.filter(t => t.dueDate && t.dueDate < today);
  const dueToday = todos.filter(t => t.dueDate === today);
  const dueSoon = todos.filter(t => {
    if (!t.dueDate || t.dueDate <= today) return false;
    const diff = (new Date(t.dueDate).getTime() - new Date(today).getTime()) / 86400000;
    return diff <= 3;
  });

  if (overdue.length > 0) {
    parts.push(`Overdue to-dos: ${overdue.map(t => `${t.text} (due ${t.dueDate})`).join(', ')}`);
  }
  if (dueToday.length > 0) {
    parts.push(`Due today: ${dueToday.map(t => t.text).join(', ')}`);
  }
  if (dueSoon.length > 0) {
    parts.push(`Due this week: ${dueSoon.map(t => `${t.text} (due ${t.dueDate})`).join(', ')}`);
  }

  // 3. Weekly tasks — detect stalling
  const weekKey = getWeekKey();
  const weeklyTemplates = await getTemplatesByType('weekly');
  for (const template of weeklyTemplates) {
    const frequency = template.weekFrequency ?? 1;
    const weekTasks = await db.tasks
      .where('templateId')
      .equals(template.id)
      .filter(t => t.weekKey === weekKey)
      .toArray();
    const done = weekTasks.filter(t => t.done).length;
    const remaining = frequency - done;

    if (remaining > 0) {
      // Check if it's late in the week (Thursday+) and still incomplete
      const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const isLateInWeek = dayOfWeek >= 4; // Thursday or later
      if (isLateInWeek) {
        parts.push(`Weekly stalling: "${template.text}" needs ${remaining} more ${remaining === 1 ? 'completion' : 'completions'} this week (${done}/${frequency})`);
      } else if (remaining === frequency) {
        parts.push(`Weekly not started: "${template.text}" — 0/${frequency} done so far`);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
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

// ─── WebDAV Sync trigger ───────────────────────────

// sync trigger — debounced to avoid excessive sync calls
// No-op if WebDAV sync is not configured (local-first)
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

export function triggerSync(): void {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const { isSyncEnabled, pushToServer } = await import('../sync/webdavSync');
      if (await isSyncEnabled()) {
        await pushToServer();
      }
    } catch {
      // Silent — sync module may not be configured, that's fine
    }
  }, 2000); // 2s debounce
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
