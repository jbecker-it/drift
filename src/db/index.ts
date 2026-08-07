import Dexie, { type Table } from 'dexie';
import { v4 as uuid } from 'uuid';

// ─── Types ───────────────────────────────────────────

export interface JournalEntry {
  id: string;
  body: string;
  created: string;
  updatedAt?: string;
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
  updatedAt?: string;
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
  updatedAt?: string;
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
  /**
   * Time-of-day slot this specific instance belongs to.
   * Present only on multi-slot daily preset instances (one instance per slot).
   * Legacy single-slot instances omit this and inherit their template's slot.
   */
  slot?: JournalTaskSlot;
  updatedAt?: string;
}

export interface TaskTemplate {
  id: string;
  text: string;
  /** 'preset' = daily time-of-day, 'weekly' = weekly frequency, 'oneoff' = created once */
  type: 'preset' | 'weekly' | 'oneoff';
  /** Time-of-day slot for preset tasks */
  preset?: 'morning' | 'midday' | 'afternoon' | 'night' | 'anytime';
  /** How many completions needed per week (for weekly tasks) */
  weekFrequency?: number;
  /** Sort order within the preset slot */
  order: number;
  /**
   * Time-of-day slots this daily task applies to (multi-slot support).
   * One template can appear under several slots, each checked off independently.
   * Falls back to `preset` for legacy single-slot templates.
   */
  slots?: JournalTaskSlot[];
  /**
   * Independent display order per time-of-day slot. When a template sits in more
   * than one slot, each slot keeps its own ordering. Falls back to `order`.
   */
  slotOrders?: Partial<Record<JournalTaskSlot, number>>;
  createdAt: string;
  updatedAt?: string;
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
    super('drift-v2');
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
    // Database was renamed to drift-v2 (see App.tsx) because v3 tries to change
    // entryTags primary key from id to entryId, which Dexie does not support.
    // Fresh databases get v9 directly. Old drift DB is preserved but not loaded.
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
    // v10: add order field to taskTemplates for sort ordering
    this.version(10).stores({
      entries: 'id, created, mood, isDraft',
      entryTags: 'entryId, taggedAt',
      sessions: 'id, entryId, started',
      rewards: 'id, type, earned',
      moods: 'id, date, entryId',
      tasks: 'id, date, done, entryId, templateId, weekKey, type, dueDate',
      taskTemplates: 'id, type, active',
      contextMemory: 'id',
      settings: 'key',
    }).upgrade(async (tx) => {
      // Backfill order field for existing templates
      const templates = await tx.table('taskTemplates').toArray();
      // Group by type + preset slot (skip oneoff — they don't use ordering)
      const bySlot = new Map<string, any[]>();
      for (const t of templates) {
        if (t.type === 'oneoff') continue;
        const slot = t.type === 'preset' ? (t.preset || 'anytime') : 'weekly';
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot)!.push(t);
      }
      for (const [, items] of bySlot) {
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (let i = 0; i < items.length; i++) {
          await tx.table('taskTemplates').update(items[i].id, { order: i });
        }
      }
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
  triggerSync();
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
  await db.entries.update(draftId, { ...updates, updatedAt: new Date().toISOString() });
  const entry = await db.entries.get(draftId);
  if (!entry) throw new Error('Draft not found after finalization');
  triggerSync();
  return entry;
}

export async function updateEntry(id: string, updates: Partial<JournalEntry>): Promise<void> {
  const old = await db.entries.get(id);
  await db.entries.update(id, { ...updates, updatedAt: new Date().toISOString() });

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
        await db.moods.update(existing.id, { mood: updates.mood, updatedAt: new Date().toISOString() });
      } else {
        await db.moods.add({
          id: uuid(),
          date: localDateKey(new Date(old.created)),
          mood: updates.mood,
          updatedAt: new Date().toISOString(),
          entryId: id,
        });
      }
    }
  }
  triggerSync();
}

/**
 * Delete an entry and all related data (tags, moods, sessions) in one transaction.
 * Also cancels any pending background tagging for this entry.
 * Tombstones are written inside the same transaction for atomicity.
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
    ...tags.map(t => ({ table: 'entryTags', recordId: t.entryId })),
    ...moods.map(m => ({ table: 'moods', recordId: m.id })),
    ...sessions.map(s => ({ table: 'sessions', recordId: s.id })),
    ...tasks.map(t => ({ table: 'tasks', recordId: t.id })),
  ];

  // Atomic: tombstones + record deletion in the same transaction.
  // Including db.settings ensures recordDeletions() operates within this tx.
  await db.transaction(
    'rw',
    [db.entries, db.entryTags, db.moods, db.sessions, db.tasks, db.settings],
    async () => {
      await recordDeletions(deletions);
      await db.entries.delete(id);
      await db.entryTags.where('entryId').equals(id).delete();
      await db.moods.where('entryId').equals(id).delete();
      await db.sessions.where('entryId').equals(id).delete();
      await db.tasks.where('entryId').equals(id).delete();
    },
  );
  // Push the deletion tombstones to the server so they propagate to other devices.
  triggerSync();
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
    session.updatedAt = new Date().toISOString();
  });
  triggerSync();
}

export async function endSession(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { ended: new Date().toISOString(), updatedAt: new Date().toISOString() });
  triggerSync();
}

// ─── Mood helpers ────────────────────────────────────

export async function logMood(mood: number, entryId?: string): Promise<MoodEntry> {
  const today = localDateKey();
  const now = new Date().toISOString();
  const entry: MoodEntry = {
    id: uuid(),
    date: today,
    mood,
    updatedAt: now,
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

// ─── Old DB Detection & Restore ─────────────────────
//
// Uses raw IndexedDB API to read the old 'drift' database.
// This is CRITICAL because:
//  - Dexie cannot open a DB at a higher version than declared
//  - Dexie cannot change primary keys (v3 tried, failed)
//  - We need to read data regardless of which version the old DB is stuck at

/** Tables we expect in the old 'drift' database. */
const OLD_DB_TABLES = ['entries', 'entryTags', 'sessions', 'rewards', 'moods', 'settings'];

/**
 * Read all records from a raw IndexedDB object store.
 * Returns a promise that resolves with an array of structured-clone'd records.
 */
function readRawStore(
  db: IDBDatabase,
  storeName: string,
): Promise<any[]> {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        return resolve([]);
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]); // Non-fatal — table might be empty or missing
    } catch {
      resolve([]);
    }
  });
}

/**
 * Open the old 'drift' database using raw IndexedDB (no Dexie, no migrations).
 * Returns the IDBDatabase handle, or null if the DB doesn't exist.
 */
function openOldDriftDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('drift');
      req.onsuccess = () => {
        const idb = req.result;
        // Safety: only accept databases that have tables we recognise
        const storeNames = Array.from(idb.objectStoreNames);
        if (storeNames.length === 0) {
          idb.close();
          return resolve(null);
        }
        resolve(idb);
      };
      req.onerror = () => resolve(null);
      req.addEventListener('abort', () => resolve(null));
      req.onblocked = () => resolve(null);
      // If the DB doesn't exist yet, onupgradeneeded fires — just close it.
      req.onupgradeneeded = (event) => {
        // New DB — nothing to read. Abort the upgrade to prevent creating
        // a phantom empty 'drift' database that would persist forever.
        (event.target as IDBOpenDBRequest)?.transaction?.abort();
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Check if an old 'drift' database exists with data.
 * Returns entry count and per-table counts so the UI can show what's available.
 * Safe for any DB version (v1, v2, v3+, or corrupted).
 */
export async function checkOldDatabase(): Promise<{
  hasData: boolean;
  entryCount: number;
  tableCounts: Record<string, number>;
}> {
  const idb = await openOldDriftDB();
  if (!idb) return { hasData: false, entryCount: 0, tableCounts: {} };

  try {
    const tableCounts: Record<string, number> = {};
    for (const table of OLD_DB_TABLES) {
      if (!idb.objectStoreNames.contains(table)) {
        tableCounts[table] = 0;
        continue;
      }
      const count = await new Promise<number>((resolve) => {
        try {
          const tx = idb.transaction(table, 'readonly');
          const req = tx.objectStore(table).count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(0);
        } catch {
          resolve(0);
        }
      });
      tableCounts[table] = count;
    }

    const entryCount = tableCounts.entries || 0;
    return { hasData: entryCount > 0, entryCount, tableCounts };
  } finally {
    idb.close();
  }
}

/**
 * Read all data from the old 'drift' database for backup / restore.
 * Uses raw IndexedDB — works regardless of which schema version the DB is stuck at.
 * Returns null if no data found or if read fails.
 */
export async function readOldDatabase(): Promise<Record<string, any[]> | null> {
  const idb = await openOldDriftDB();
  if (!idb) return null;

  try {
    const data: Record<string, any[]> = {};
    for (const table of OLD_DB_TABLES) {
      data[table] = await readRawStore(idb, table);
    }

    const hasData = Object.values(data).some(arr => arr.length > 0);
    return hasData ? data : null;
  } catch {
    return null;
  } finally {
    idb.close();
  }
}

/** Tables that require a primary key field on each record for bulkPut. */
const REQUIRED_PK: Record<string, string> = {
  entries: 'id',
  entryTags: 'entryId', // new schema: entryId is PK
  sessions: 'id',
  rewards: 'id',
  moods: 'id',
  tasks: 'id',
  taskTemplates: 'id',
  contextMemory: 'id',
};

/** Tables that participate in a single atomic import transaction. */
const IMPORT_TABLES = [
  'entries', 'entryTags', 'sessions', 'rewards',
  'moods', 'tasks', 'taskTemplates', 'contextMemory',
] as const;

/**
 * Import data from a JSON string into the current database.
 * Handles export format (from exportAllData / WebDAV sync) and old DB format.
 * - Deduplicates entryTags by entryId (keeps the latest taggedAt).
 * - Validates primary keys before bulkPut.
 * - Wraps everything in a single Dexie transaction for atomicity.
 * - Processes tombstones so deleted records stay deleted.
 */
export async function importFromJson(jsonString: string): Promise<{
  success: boolean;
  error?: string;
  imported?: Record<string, number>;
  tombstonesApplied?: number;
}> {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Invalid JSON structure' };
    }

    // Pre-process: deduplicate entryTags, validate primary keys
    const tableData: Record<string, any[]> = {};
    for (const table of IMPORT_TABLES) {
      if (!Array.isArray(data[table])) continue;

      let records = data[table].filter((r: any) => r && typeof r === 'object');

      // entryTags: deduplicate by entryId, keep the latest taggedAt
      if (table === 'entryTags') {
        const byEntryId = new Map<string, any>();
        for (const r of records) {
          if (!r.entryId) continue;
          const existing = byEntryId.get(r.entryId);
          if (!existing || !existing.taggedAt || (r.taggedAt && r.taggedAt > existing.taggedAt)) {
            byEntryId.set(r.entryId, r);
          }
        }
        records = Array.from(byEntryId.values());
      }

      // Validate: keep only records that have the required primary key
      const pkField = REQUIRED_PK[table];
      if (pkField) {
        records = records.filter((r: any) => typeof r[pkField] === 'string' && r[pkField]);
      }

      if (records.length > 0) {
        tableData[table] = records;
      }
    }

    // Parse tombstones if present (from WebDAV sync payloads)
    const tombstones: { table: string; recordId: string; deletedAt: string }[] =
      Array.isArray(data.tombstones) ? data.tombstones : [];

    // Atomic: import all tables + apply tombstones in a single transaction
    const imported: Record<string, number> = {};
    let tombstonesApplied = 0;

    const dbTables = IMPORT_TABLES.map(t => (db as any)[t]).filter(Boolean);
    // Also need settings for tombstone persistence
    // Load the tombstone helper OUTSIDE the transaction — an awaited dynamic
    // import() inside a Dexie transaction can break the transaction context.
    const { getTombstones } = await import('../sync/webdavSync');
    await db.transaction(
      'rw',
      [...dbTables, db.settings],
      async () => {
        // Apply tombstones first (deletions before insertions)
        for (const ts of tombstones) {
          if (!ts.table || !ts.recordId) continue;
          const targetTable = (db as any)[ts.table];
          if (!targetTable) continue;
          try {
            const existing = await targetTable.get(ts.recordId);
            if (existing) {
              // Only delete if tombstone is newer than the record
              const recordTime = existing.updatedAt ?? existing.doneAt ?? existing.ended
                ?? existing.lastUpdated ?? existing.taggedAt ?? existing.earned
                ?? existing.started ?? existing.createdAt ?? existing.created ?? '';
              if (!recordTime || ts.deletedAt >= recordTime) {
                await targetTable.delete(ts.recordId);
                tombstonesApplied++;
              }
            }
          } catch {
            // Table might not exist in current schema — skip
          }
        }

        // Import records table by table
        for (const table of IMPORT_TABLES) {
          const records = tableData[table];
          if (!records || records.length === 0) continue;
          await (db as any)[table].bulkPut(records);
          imported[table] = records.length;
        }

        // Persist tombstones locally so they survive push
        if (tombstones.length > 0) {
          // Merge: local tombstones + imported tombstones (newer wins)
          const localTombstones = await getTombstones();
          const tombstoneMap = new Map<string, any>();
          for (const lt of localTombstones) tombstoneMap.set(lt.id, lt);
          for (const rt of tombstones) {
            const id = `${rt.table}:${rt.recordId}`;
            const existing = tombstoneMap.get(id);
            if (!existing || rt.deletedAt > existing.deletedAt) {
              tombstoneMap.set(id, {
                id,
                table: rt.table,
                recordId: rt.recordId,
                deletedAt: rt.deletedAt,
              });
            }
          }
          const merged = Array.from(tombstoneMap.values());
          if (merged.length > 0) {
            await setSetting('sync_tombstones', JSON.stringify(merged));
          }
        }
      },
    );

    return { success: true, imported, tombstonesApplied };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to import data',
    };
  }
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
  const filteredTags = tags.filter(t => t.one_line_summary).slice(0, limit * 2);

  // Batch-fetch all entries in one query
  const entryIds = filteredTags.map(t => t.entryId);
  const entries = await db.entries.where('id').anyOf(entryIds).toArray();
  const entryMap = new Map(entries.map(e => [e.id, e]));

  const results: string[] = [];
  for (const tag of filteredTags) {
    if (!tag.one_line_summary) continue;
    const entry = entryMap.get(tag.entryId);
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
    task.updatedAt = new Date().toISOString();
  });
}

/** Delete a task. Records a tombstone for sync. */
export async function deleteTask(id: string): Promise<void> {
  // Best-effort tombstone: a local-first app must never let sync bookkeeping
  // (a dynamic import or tombstone write) block the actual local delete.
  try {
    const { recordDeletion } = await import('../sync/webdavSync');
    await recordDeletion('tasks', id);
  } catch { /* tombstone skipped; local delete proceeds */ }
  await db.tasks.delete(id);
}

/** Get today's tasks (excluding to-dos which persist across days AND weekly
 *  instances, which are surfaced separately via their own weekKey grouping). */
export async function getTodaysTasks(): Promise<Task[]> {
  const today = localDateKey();
  return db.tasks.where('date').equals(today).filter(t => t.type !== 'todo' && !t.weekKey).toArray();
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
    .filter(t => t.active && getTemplateSlots(t).includes(slot))
    .toArray();

  const templateIds = templates.map(t => t.id);
  if (templateIds.length === 0) return [];
  const templateById = new Map(templates.map(t => [t.id, t]));

  return db.tasks
    .where('date').equals(today)
    .filter(t => {
      if (!t.templateId || !templateIds.includes(t.templateId) || t.done) return false;
      // Slotted instance → must match the requested slot; legacy → first slot.
      if (t.slot) return t.slot === slot;
      const first = getTemplateSlots(templateById.get(t.templateId)!)[0];
      return first === slot;
    })
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

// ─── Journal Task Groups ────────────────────────────

export type JournalTaskSlot = 'morning' | 'midday' | 'afternoon' | 'night' | 'anytime';

/** The four time-of-day segments shown in the daily tab. */
export type DaySlot = Exclude<JournalTaskSlot, 'anytime'>;

/** The four time-of-day segments shown in the daily tab. */
export const DAY_SLOTS: DaySlot[] = ['morning', 'midday', 'afternoon', 'night'];

/**
 * Resolve which time-of-day slots a preset template applies to.
 * Multi-slot templates use `slots`; legacy single-slot ones fall back to `preset`.
 */
export function getTemplateSlots(template: Pick<TaskTemplate, 'slots' | 'preset'>): JournalTaskSlot[] {
  if (template.slots && template.slots.length > 0) return [...new Set(template.slots)];
  return template.preset ? [template.preset] : [];
}

/**
 * Display order of a template within a specific slot.
 * Multi-slot templates keep an independent order per slot (`slotOrders`);
 * legacy single-slot templates fall back to the scalar `order` field.
 */
export function orderInSlot(template: Pick<TaskTemplate, 'slotOrders' | 'order'>, slot: JournalTaskSlot): number {
  return template.slotOrders?.[slot] ?? template.order ?? 0;
}

/** Normalize caller-supplied day slots: dedupe + drop non-day values. */
export function normalizeDaySlots(slots: DaySlot[] | undefined): DaySlot[] {
  if (!slots) return [];
  return [...new Set(slots.filter((s): s is DaySlot => DAY_SLOTS.includes(s)))];
}

export interface JournalTaskGroup {
  slot: JournalTaskSlot;
  label: string;
  icon: string;
  items: JournalTaskItem[];
}

export interface JournalTaskItem {
  /** Actual task instance id (for toggling/deleting) */
  id: string;
  text: string;
  done: boolean;
}

export interface JournalWeeklyTask {
  /** Task instance id for toggling */
  id: string;
  text: string;
  done: boolean;
  progress: { done: number; total: number; frequency: number };
}

export interface JournalTasks {
  groups: JournalTaskGroup[];
  weekly: JournalWeeklyTask[];
}

/**
 * Build grouped task data for the journal view.
 * Returns daily presets grouped by time-of-day AND weekly tasks separately.
 * Weekly tasks are NOT mixed into the daily groups.
 */
export async function getJournalTaskGroups(): Promise<JournalTasks> {
  await ensureDailyPresetInstances();
  await ensureWeeklyTaskInstances();

  const today = localDateKey();
  const weekKey = getWeekKey();

  const SLOT_META: Record<JournalTaskSlot, { label: string; icon: string }> = {
    morning:   { label: 'Morning',   icon: '🌅' },
    midday:    { label: 'Midday',    icon: '☀️' },
    afternoon: { label: 'Afternoon', icon: '🌤️' },
    night:     { label: 'Night',     icon: '🌙' },
    anytime:   { label: 'Anytime',   icon: '📋' },
  };

  const SLOT_ORDER: JournalTaskSlot[] = ['morning', 'midday', 'afternoon', 'night', 'anytime'];

  // 1. Daily presets — grouped by slot, ordered per-slot
  const presetTemplates = await getTemplatesByType('preset');
  const slotMap = new Map<JournalTaskSlot, JournalTaskItem[]>();
  for (const slot of SLOT_ORDER) slotMap.set(slot, []);

  // Preload today's instances per template so each slot list sorts by its own order.
  const instanceByTemplate = new Map<string, Record<string, Task>>();
  for (const template of presetTemplates) {
    const slots = getTemplateSlots(template);
    const dayInstances = await db.tasks
      .where('templateId')
      .equals(template.id)
      .filter(t => t.date === today)
      .toArray();
    const bySlot: Record<string, Task> = {};
    for (const t of dayInstances) {
      const s = t.slot ?? slots[0];
      if (s && slots.includes(s)) bySlot[s] = t;
    }
    instanceByTemplate.set(template.id, bySlot);
  }

  for (const slot of SLOT_ORDER) {
    const slotTemplates = presetTemplates
      .filter(t => getTemplateSlots(t).includes(slot))
      .sort((a, b) => orderInSlot(a, slot) - orderInSlot(b, slot) || a.createdAt.localeCompare(b.createdAt));
    const items: JournalTaskItem[] = [];
    for (const template of slotTemplates) {
      const instance = instanceByTemplate.get(template.id)?.[slot];
      if (!instance) continue;
      items.push({ id: instance.id, text: template.text, done: instance.done });
    }
    slotMap.set(slot, [...(slotMap.get(slot) ?? []), ...items]);
  }

  // 2. Custom/extracted tasks — under 'anytime'
  const allTodayTasks = await getTodaysTasks();
  const customTasks = allTodayTasks.filter(t => !t.templateId && t.type !== 'todo');
  const anytimeItems = slotMap.get('anytime')!;
  for (const task of customTasks) {
    anytimeItems.push({
      id: task.id,
      text: task.text,
      done: task.done,
    });
  }

  // Build daily groups — only include non-empty, always show anytime
  const groups: JournalTaskGroup[] = [];
  for (const slot of SLOT_ORDER) {
    const items = slotMap.get(slot)!;
    if (items.length === 0 && slot !== 'anytime') continue;
    groups.push({
      slot,
      label: SLOT_META[slot].label,
      icon: SLOT_META[slot].icon,
      items,
    });
  }

  // 3. Weekly tasks — separate list, deduplicated by template
  const weeklyTemplates = (await getTemplatesByType('weekly'))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const weekly: JournalWeeklyTask[] = [];

  for (const template of weeklyTemplates) {
    const frequency = template.weekFrequency ?? 1;
    const weekTasks = await db.tasks
      .where('templateId')
      .equals(template.id)
      .filter(t => t.weekKey === weekKey)
      .toArray();
    const done = weekTasks.filter(t => t.done).length;
    const isComplete = done >= frequency;
    const undoneInstance = weekTasks.find(t => !t.done) ?? weekTasks[0];

    weekly.push({
      id: undoneInstance?.id ?? template.id,
      text: template.text,
      done: isComplete,
      progress: { done, total: weekTasks.length, frequency },
    });
  }

  return { groups, weekly };
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
  slots?: DaySlot[],
): Promise<TaskTemplate> {
  // Multi-slot presets store the full slot list; single-slot legacy data reads `preset`.
  const cleanSlots = normalizeDaySlots(slots);
  const resolvedSlots: DaySlot[] | undefined = type === 'preset'
    ? (cleanSlots.length > 0
        ? cleanSlots
        : preset && DAY_SLOTS.includes(preset as DaySlot)
          ? [preset as DaySlot]
          : undefined)
    : undefined;
  if (type === 'preset' && (!resolvedSlots || resolvedSlots.length === 0)) {
    // A daily preset must appear in at least one visible segment.
    throw new Error('A daily preset must have at least one time slot');
  }

  const template: TaskTemplate = {
    id: uuid(),
    text,
    type,
    preset: type === 'preset' ? (resolvedSlots![0] ?? 'anytime') : preset,
    weekFrequency,
    slots: resolvedSlots,
    order: 0,
    createdAt: new Date().toISOString(),
    active: true,
  };

  // Atomic: count existing + insert in one transaction to avoid race conditions
  await db.transaction('rw', db.taskTemplates, async () => {
    if (type === 'preset' && template.slots && template.slots.length > 0) {
      // Append each selected slot to the END of that segment's own list, so the
      // new template never collides with a slot order previously set via setTemplateSlots.
      const slotOrders: Partial<Record<JournalTaskSlot, number>> = {};
      for (const s of template.slots) {
        const siblings = await db.taskTemplates
          .where('type').equals('preset')
          .filter(t => t.active && getTemplateSlots(t).includes(s))
          .toArray();
        const maxOrder = siblings.reduce((mx, t) => Math.max(mx, orderInSlot(t, s)), -1);
        slotOrders[s] = maxOrder + 1;
      }
      template.slotOrders = slotOrders;
      // Scalar order stays a monotonic global counter (legacy fallback / stability).
      // Count inactive templates too so a deactivated slot's order is never reused.
      const existing = await db.taskTemplates
        .where('type').equals('preset')
        .toArray();
      template.order = existing.reduce((mx, t) => Math.max(mx, t.order ?? 0), -1) + 1;
    } else if (type === 'weekly') {
      const existing = await db.taskTemplates
        .where('type').equals('weekly')
        .toArray();
      template.order = existing.reduce((mx, t) => Math.max(mx, t.order ?? 0), -1) + 1;
    }
    await db.taskTemplates.add(template);
  });

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
  await db.taskTemplates.update(id, { ...updates, updatedAt: new Date().toISOString() });
}

/** Deactivate (soft-delete) a template. */
export async function deactivateTemplate(id: string): Promise<void> {
  await db.taskTemplates.update(id, { active: false, updatedAt: new Date().toISOString() });
}

/**
 * Set the exact set of time-of-day slots a preset applies to.
 * Multi-slot templates show under every selected slot, each checked off separately.
 */
export async function setTemplateSlots(id: string, slots: DaySlot[]): Promise<void> {
  const clean = normalizeDaySlots(slots);
  if (clean.length === 0) {
    // An active daily preset must appear in at least one segment.
    throw new Error('A daily preset must have at least one time slot');
  }
  const now = new Date().toISOString();
  const { recordDeletions } = await import('../sync/webdavSync');

  await db.transaction('rw', db.taskTemplates, db.tasks, db.settings, async () => {
    const template = await db.taskTemplates.get(id);
    if (!template) return;
    if (template.type !== 'preset') {
      throw new Error('Only preset templates can have daily time slots');
    }
    const oldSlots = getTemplateSlots(template);
    const oldFirst = oldSlots[0];

    // Materialize any legacy un-slotted instances to their original slot so they
    // are not later reinterpreted against a (possibly changed) slot list.
    if (oldFirst) {
      await db.tasks.where('templateId').equals(id)
        .filter(t => t.slot === undefined)
        .modify(t => { t.slot = oldFirst; t.updatedAt = now; });
    }

    // Remove today's instances for slots that are being deactivated. Tombstone
    // them so the deletion propagates via WebDAV (prevents resurrection on pull).
    const removedSlots = oldSlots.filter(s => !(clean as JournalTaskSlot[]).includes(s));
    if (removedSlots.length > 0) {
      const today = localDateKey();
      const removed = await db.tasks.where('templateId').equals(id)
        .filter(t => t.date === today && (t.slot !== undefined && removedSlots.includes(t.slot)))
        .toArray();
      if (removed.length > 0) {
        await recordDeletions(removed.map(t => ({ table: 'tasks', recordId: t.id })));
        await db.tasks.bulkDelete(removed.map(t => t.id));
      }
    }

    // Per-slot display order: keep existing slot orders; append newly selected
    // slots to the end of that segment's current list.
    const oldSlotSet = new Set<JournalTaskSlot>(oldSlots);
    const slotOrders: Partial<Record<JournalTaskSlot, number>> = {};
    for (const s of clean) {
      if (oldSlotSet.has(s)) {
        slotOrders[s] = orderInSlot(template, s);
      } else {
        const siblings = await db.taskTemplates
          .where('type').equals('preset')
          .filter(t => t.active && t.id !== id && getTemplateSlots(t).includes(s))
          .toArray();
        const maxOrder = siblings.reduce((mx, t) => Math.max(mx, orderInSlot(t, s)), -1);
        slotOrders[s] = maxOrder + 1;
      }
    }

    await db.taskTemplates.update(id, {
      slots: clean,
      preset: clean[0],
      slotOrders,
      updatedAt: now,
    });
  });
}

/**
 * Reorder a template within a specific slot.
 * Uses per-slot ordering (`slotOrders`), so a multi-slot task can be ordered
 * independently in each segment without disturbing the others.
 */
export async function reorderTemplate(id: string, slot: DaySlot, direction: 'up' | 'down'): Promise<void> {
  await db.transaction('rw', db.taskTemplates, async () => {
    const template = await db.taskTemplates.get(id);
    if (!template || template.type !== 'preset') return;
    if (!getTemplateSlots(template).includes(slot)) return;

    // Active presets sharing this slot only
    const siblings = await db.taskTemplates
      .where('type').equals('preset')
      .filter(t => t.active && getTemplateSlots(t).includes(slot))
      .toArray();

    siblings.sort((a, b) =>
      orderInSlot(a, slot) - orderInSlot(b, slot) || a.createdAt.localeCompare(b.createdAt));

    const idx = siblings.findIndex(t => t.id === id);
    if (idx === -1) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= siblings.length) return;

    // Swap in place, then reassign sequential order for the whole slot group.
    [siblings[idx], siblings[target]] = [siblings[target], siblings[idx]];

    const now = new Date().toISOString();
    await db.taskTemplates.bulkPut(siblings.map((t, i) => ({
      ...t,
      slotOrders: { ...t.slotOrders, [slot]: i },
      updatedAt: now,
    })));
  });
}

/** Delete a template and all its task instances. Records tombstones for sync. */
export async function deleteTaskTemplate(id: string): Promise<void> {
  // Best-effort tombstone loading: the local delete must never be blocked by a
  // stale dynamic import or a failed tombstone write in the sync module.
  let recordDeletions: (d: { table: string; recordId: string }[]) => Promise<void> | undefined;
  try {
    ({ recordDeletions } = await import('../sync/webdavSync'));
  } catch { /* tombstone module unavailable — proceed without */ }
  // Collect all task IDs that will be deleted so we can tombstone them
  const tasksToDelete = await db.tasks.where('templateId').equals(id).toArray();
  const deletions: { table: string; recordId: string }[] = [
    { table: 'taskTemplates', recordId: id },
    ...tasksToDelete.map(t => ({ table: 'tasks', recordId: t.id })),
  ];
  await db.transaction('rw', db.taskTemplates, db.tasks, db.settings, async () => {
    if (recordDeletions) {
      try { await recordDeletions(deletions); } catch { /* tombstone best-effort */ }
    }
    await db.taskTemplates.delete(id);
    await db.tasks.where('templateId').equals(id).delete();
  });
}

/**
 * Ensure today's task instances exist for all active daily preset templates.
 * Creates a Task per (template × slot) so multi-slot tasks can be checked
 * off independently in each time-of-day segment. Runs atomically so concurrent
 * callers (tasks page, journal view, notifications) can never duplicate an instance.
 */
export async function ensureDailyPresetInstances(): Promise<void> {
  const today = localDateKey();
  // Read-check-add inside a single rw transaction: IndexedDB serializes rw
  // transactions over this scope, so overlapping calls cannot both insert.
  await db.transaction('rw', db.taskTemplates, db.tasks, async () => {
    const presets = await getTemplatesByType('preset');
    if (presets.length === 0) return;
    const presetsById = new Map(presets.map(p => [p.id, p]));

    // Track which (template, slot) pairs already have an instance today.
    // Legacy single-slot instances (no `slot` field) cover their template's first slot.
    const covered = new Map<string, Set<string>>();
    const todayTasks = await db.tasks
      .where('date').equals(today)
      .filter(t => !!t.templateId)
      .toArray();
    for (const t of todayTasks) {
      const tpl = t.templateId ? presetsById.get(t.templateId) : undefined;
      if (t.slot) {
        const set = covered.get(t.templateId!) ?? new Set<string>();
        set.add(t.slot);
        covered.set(t.templateId!, set);
      } else if (tpl) {
        const first = getTemplateSlots(tpl)[0];
        if (first) {
          const set = covered.get(t.templateId!) ?? new Set<string>();
          set.add(first);
          covered.set(t.templateId!, set);
        }
      }
    }

    const toCreate: { id: string; text: string; date: string; done: boolean; createdAt: string; source: 'manual'; templateId: string; slot: JournalTaskSlot }[] = [];
    for (const template of presets) {
      const coveredSlots = covered.get(template.id) ?? new Set<string>();
      for (const slot of getTemplateSlots(template)) {
        if (coveredSlots.has(slot)) continue;
        toCreate.push({
          id: uuid(),
          text: template.text,
          date: today,
          done: false,
          createdAt: new Date().toISOString(),
          source: 'manual',
          templateId: template.id,
          slot,
        });
      }
    }

    if (toCreate.length > 0) {
      await db.tasks.bulkAdd(toCreate);
    }
  });
}

/**
 * Ensure this week's task instances exist for all active weekly templates.
 * For a template with weekFrequency=3, creates 3 task instances if <3 exist for this week.
 * Runs inside a transaction for atomicity (prevents duplicate instances from
 * concurrent calls), and trims excess instances if a template's frequency was
 * reduced mid-week.
 */
export async function ensureWeeklyTaskInstances(): Promise<void> {
  const weekKey = getWeekKey();
  const weeklyTemplates = await getTemplatesByType('weekly');
  if (weeklyTemplates.length === 0) return;

  const { recordDeletions } = await import('../sync/webdavSync');

  await db.transaction('rw', db.tasks, db.settings, async () => {
    // Single query: get all this week's tasks that have a templateId
    const weekTasks = await db.tasks
      .where('weekKey').equals(weekKey)
      .filter(t => !!t.templateId)
      .toArray();

    // Group by templateId
    const byTemplate = new Map<string, Task[]>();
    for (const t of weekTasks) {
      const arr = byTemplate.get(t.templateId!);
      if (arr) arr.push(t);
      else byTemplate.set(t.templateId!, [t]);
    }

    const today = localDateKey();
    const now = new Date().toISOString();
    const toCreate: { id: string; text: string; date: string; done: boolean; createdAt: string; source: 'manual'; templateId: string; weekKey: string }[] = [];
    const toDelete: string[] = [];

    for (const template of weeklyTemplates) {
      const frequency = template.weekFrequency ?? 1;
      const existing = byTemplate.get(template.id) ?? [];

      // If the frequency was reduced (e.g. 3 → 1), trim the excess instances so
      // the extra rows don't keep showing in the UI / counting toward completion.
      // Delete undone instances first; fall back to newest if not enough undone.
      if (existing.length > frequency) {
        const excess = existing.length - frequency;
        const undone = existing.filter(t => !t.done);
        const targets = undone.slice(0, excess);
        if (targets.length < excess) {
          const used = new Set(targets.map(t => t.id));
          const remaining = existing
            .filter(t => !used.has(t.id))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          targets.push(...remaining.slice(0, excess - targets.length));
        }
        toDelete.push(...targets.map(t => t.id));
      }

      const missing = frequency - existing.length;
      for (let i = 0; i < missing; i++) {
        toCreate.push({
          id: uuid(),
          text: template.text,
          date: today,
          done: false,
          createdAt: now,
          source: 'manual',
          templateId: template.id,
          weekKey,
        });
      }
    }

    if (toDelete.length > 0) {
      // Tombstone the trimmed instances so the reduction propagates via WebDAV
      // (otherwise the next pull would resurrect them and cause delete/restore churn).
      await recordDeletions(toDelete.map(id => ({ table: 'tasks', recordId: id })));
      await db.tasks.bulkDelete(toDelete);
    }
    if (toCreate.length > 0) {
      await db.tasks.bulkAdd(toCreate);
    }
  });
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
  presets: { template: TaskTemplate; instances: Partial<Record<JournalTaskSlot, Task>> }[];
  weekly: { template: TaskTemplate; done: number; total: number; frequency: number }[];
}> {
  const today = localDateKey();
  const weekKey = getWeekKey();

  const allTemplates = await getActiveTemplates();

  // Daily presets (sorted by order, then by creation date for stability)
  const presetTemplates = allTemplates.filter(t => t.type === 'preset')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
  const presets = await Promise.all(
    presetTemplates.map(async (template) => {
      const slots = getTemplateSlots(template);
      const dayInstances = await db.tasks
        .where('templateId')
        .equals(template.id)
        .filter(t => t.date === today)
        .toArray();
      // Map each instance to its slot; legacy no-slot instances go to slot[0].
      const instances: Partial<Record<JournalTaskSlot, Task>> = {};
      for (const slot of slots) instances[slot] = undefined;
      for (const t of dayInstances) {
        const slot = t.slot ?? slots[0];
        if (slot && slots.includes(slot)) instances[slot] = t;
      }
      return { template, instances };
    }),
  );

  // Weekly tasks (sorted by order for consistency)
  const weeklyTemplates = allTemplates.filter(t => t.type === 'weekly')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
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
  const todayKey = localDateKey();
  const today = new Date();
  const endOfWeek = new Date(today);
  // Monday-based week to match getWeekKey (ISO week)
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  endOfWeek.setDate(today.getDate() + daysUntilSunday);
  return dueDate >= todayKey && dueDate <= localDateKey(endOfWeek);
}

// ─── AI Nudge Summary ──────────────────────────────

/**
 * Build a task nudge summary for AI context.
 * Includes undone daily tasks, overdue/upcoming to-dos, and stalling weekly tasks.
 */
export async function getTaskNudgeSummary(): Promise<string> {
  const parts: string[] = [];
  const today = localDateKey();

  // 1. Undone daily tasks (presets + custom; weekly instances are reported separately below)
  const dailyTasks = await getTodaysTasks();
  const undoneDaily = dailyTasks.filter(t => !t.done && !t.weekKey);
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
let syncMutex = false;

export function triggerSync(): void {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    syncTimeout = null;
    if (syncMutex) {
      // A sync is already running — reschedule so these changes aren't lost.
      triggerSync();
      return;
    }
    syncMutex = true;
    try {
      const { isSyncEnabled, performSync } = await import('../sync/webdavSync');
      if (await isSyncEnabled()) {
        await performSync();
      }
    } catch {
      // Silent — sync module may not be configured, that's fine
    } finally {
      syncMutex = false;
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
