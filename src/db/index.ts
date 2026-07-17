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

// ─── Database ────────────────────────────────────────

class DriftDB extends Dexie {
  entries!: Table<JournalEntry>;
  sessions!: Table<ChatSession>;
  rewards!: Table<Reward>;
  moods!: Table<MoodEntry>;
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
  }
}

export const db = new DriftDB();

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

export async function updateEntry(id: string, updates: Partial<JournalEntry>): Promise<void> {
  await db.entries.update(id, updates);
}

export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id);
}

export async function getRecentEntries(limit: number = 10): Promise<JournalEntry[]> {
  return db.entries
    .orderBy('created')
    .reverse()
    .limit(limit)
    .toArray();
}

export async function getEntriesSince(date: Date): Promise<JournalEntry[]> {
  const results = await db.entries
    .where('created')
    .above(date.toISOString())
    .toArray();
  return results.sort((a, b) => b.created.localeCompare(a.created));
}

export async function getTodaysEntries(): Promise<JournalEntry[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getEntriesSince(today);
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
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  session.messages.push({ role, content, timestamp: new Date().toISOString() });
  await db.sessions.update(sessionId, { messages: session.messages });
}

export async function endSession(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { ended: new Date().toISOString() });
}

// ─── Mood helpers ────────────────────────────────────

export async function logMood(mood: number, entryId?: string): Promise<MoodEntry> {
  const today = new Date().toISOString().split('T')[0];
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
  return db.moods
    .where('date')
    .above(since.toISOString().split('T')[0])
    .toArray();
}

// ─── Reward helpers ──────────────────────────────────

export async function awardReward(
  type: Reward['type'],
  label: string,
  description: string
): Promise<Reward | null> {
  // Check if already awarded (for unique achievements)
  const existing = await db.rewards.where('type').equals(type).first();
  if (existing) return null;

  const reward: Reward = {
    id: uuid(),
    type,
    earned: new Date().toISOString(),
    label,
    description,
  };
  await db.rewards.add(reward);
  return reward;
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
  // Default per handoff doc: Claude Sonnet 5 won the five-model blind comparison
  return (await getSetting('openrouter_model')) || 'anthropic/claude-sonnet-5';
}

export async function getBackgroundModel(): Promise<string> {
  const val = await getSetting('openrouter_background_model');
  if (!val || val === 'same') {
    return getModel(); // fall back to primary model
  }
  return val;
}

export async function setBackgroundModel(model: string): Promise<void> {
  await setSetting('openrouter_background_model', model);
}

export async function getPersonality(): Promise<string> {
  return (await getSetting('personality')) || 'coach';
}

// ─── Streak calculation ──────────────────────────────

export async function calculateStreak(): Promise<{ current: number; longest: number; lastEntryDate: string | null }> {
  const allEntries = await db.entries.toArray();
  const entries = allEntries.sort((a: JournalEntry, b: JournalEntry) => b.created.localeCompare(a.created));

  if (entries.length === 0) return { current: 0, longest: 0, lastEntryDate: null };

  // Get unique dates
  const dates = [...new Set(entries.map((e: JournalEntry) => e.created.split('T')[0]))].sort().reverse();

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Current streak
  let current = 0;
  let checkDate = new Date();

  // Allow starting from today or yesterday (forgiving)
  if (dates[0] !== today && dates[0] !== yesterday) {
    return { current: 0, longest: 0, lastEntryDate: dates[0] ?? null };
  }

  for (const date of dates) {
    const expected = checkDate.toISOString().split('T')[0];
    if (date === expected) {
      current++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (date < expected) {
      // Allow one gap (forgiving streaks)
      checkDate.setDate(checkDate.getDate() - 1);
      const expectedAfterGap = checkDate.toISOString().split('T')[0];
      if (date === expectedAfterGap) {
        current++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // Longest streak (iterate oldest-first so prev is always earlier)
  let longest = 0;
  let tempStreak = 0;
  let prevDate: string | null = null;

  for (const date of [...dates].reverse()) {
    if (prevDate) {
      const prev = new Date(prevDate);
      const curr = new Date(date as string);
      const diff = (curr.getTime() - prev.getTime()) / 86400000;
      if (diff === 1) {
        tempStreak++;
      } else if (diff === 2) {
        // forgiving — allow one gap
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    } else {
      tempStreak = 1;
    }
    longest = Math.max(longest, tempStreak);
    prevDate = date as string;
  }

  return { current, longest, lastEntryDate: dates[0] ?? null };
}

// ─── Export ──────────────────────────────────────────

export async function exportAllData(): Promise<string> {
  const data = {
    entries: await db.entries.toArray(),
    sessions: await db.sessions.toArray(),
    rewards: await db.rewards.toArray(),
    moods: await db.moods.toArray(),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(data, null, 2);
}

export async function clearAllData(): Promise<void> {
  await db.entries.clear();
  await db.sessions.clear();
  await db.rewards.clear();
  await db.moods.clear();
  await db.settings.clear();
}
