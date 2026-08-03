// ─── PWA Notifications ────────────────────────────
// Local-first notification scheduling for Drift.
// Uses the Web Notifications API + setTimeout-based scheduling.
// Best-effort while the app is open — notifications will NOT fire
// if the app/browser is closed or the tab is suspended.

import { getSetting, setSetting, getTodaysTasks, getOpenTodos, getTodaysEntries, isOverdue, isDueToday } from './db';

// ─── Types ─────────────────────────────────────────

export interface NotificationSettings {
  enabled: boolean;
  /** HH:mm format — morning journal reminder */
  morningTime: string;
  /** HH:mm format — evening journal reminder */
  eveningTime: string;
  /** HH:mm format — task reminder */
  taskReminderTime: string;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  morningTime: '08:00',
  eveningTime: '20:00',
  taskReminderTime: '18:00',
};

/** Validate a HH:mm time string. Returns true if valid. */
function isValidTime(time: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// ─── Permission ────────────────────────────────────

/** Check if notifications are supported. */
export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

/** Get current permission state. */
export function getPermission(): NotificationPermission {
  if (!notificationsSupported()) return 'denied';
  return Notification.permission;
}

/** Request notification permission. Returns true if granted. */
export async function requestPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ─── Settings ──────────────────────────────────────

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const raw = await getSetting('notifications');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    // Validate and fall back to defaults for invalid fields
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      morningTime: isValidTime(parsed.morningTime) ? parsed.morningTime : DEFAULT_SETTINGS.morningTime,
      eveningTime: isValidTime(parsed.eveningTime) ? parsed.eveningTime : DEFAULT_SETTINGS.eveningTime,
      taskReminderTime: isValidTime(parsed.taskReminderTime) ? parsed.taskReminderTime : DEFAULT_SETTINGS.taskReminderTime,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await setSetting('notifications', JSON.stringify(settings));
}

// ─── Scheduling (concurrency-safe, DST-safe) ───────

let scheduledTimers: ReturnType<typeof setTimeout>[] = [];
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleGeneration = 0; // Monotonically increasing token to prevent stale writes

/** Clear all scheduled notification timers. */
export function clearScheduledNotifications(): void {
  scheduledTimers.forEach(t => clearTimeout(t));
  scheduledTimers = [];
  if (midnightTimer) { clearTimeout(midnightTimer); midnightTimer = null; }
}

/**
 * Calculate ms until a target HH:mm time today.
 * If the time has already passed, returns -1.
 */
function msUntilTime(timeStr: string): number {
  if (!isValidTime(timeStr)) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  return target.getTime() - now.getTime();
}

/** Calculate ms until the next local midnight (+ 5 seconds buffer). */
function msUntilNextMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 5, 0); // 5 seconds after midnight
  return midnight.getTime() - now.getTime();
}

/** Show a notification (uses service worker if available, fallback to Notification API). */
async function showNotification(title: string, body: string, tag: string): Promise<void> {
  if (getPermission() !== 'granted') return;

  // Try service worker notification (works in background)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        tag,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
      } as any);
      return;
    } catch {
      // Fall through to basic notification
    }
  }

  // Fallback: basic Notification API
  new Notification(title, { body, icon: '/favicon.svg', tag });
}

/** Build the morning journal reminder notification. */
async function buildMorningNotification(): Promise<void> {
  await showNotification(
    'Drift — Good morning 🌅',
    'What\'s on your mind today? Start with a quick journal entry.',
    'drift-morning',
  );
}

/** Build the evening journal reminder — only fires if no entry today. */
async function buildEveningNotification(): Promise<void> {
  const entries = await getTodaysEntries();
  if (entries.length > 0) return; // Already journaled today

  await showNotification(
    'Drift — Evening reflection 🌙',
    'No journal entry today yet. Take a minute to process your day.',
    'drift-evening',
  );
}

/** Build the task reminder — only fires if there are undone tasks. */
async function buildTaskReminder(): Promise<void> {
  const [dailyTasks, todos] = await Promise.all([
    getTodaysTasks(),
    getOpenTodos(),
  ]);

  const undoneDaily = dailyTasks.filter(t => !t.done);
  const overdueTodos = todos.filter(t => isOverdue(t.dueDate));
  const dueTodayTodos = todos.filter(t => isDueToday(t.dueDate));

  const parts: string[] = [];
  if (undoneDaily.length > 0) {
    parts.push(`${undoneDaily.length} undone task${undoneDaily.length > 1 ? 's' : ''} today`);
  }
  if (overdueTodos.length > 0) {
    parts.push(`${overdueTodos.length} overdue to-do${overdueTodos.length > 1 ? 's' : ''}`);
  }
  if (dueTodayTodos.length > 0) {
    parts.push(`${dueTodayTodos.length} to-do due today`);
  }

  if (parts.length === 0) return; // Nothing to remind about

  await showNotification(
    'Drift — Task reminder 📋',
    parts.join('. ') + '. Don\'t forget!',
    'drift-tasks',
  );
}

// ─── Main scheduler ────────────────────────────────

/**
 * Schedule today's notifications based on settings.
 * Concurrency-safe: uses a generation token to prevent stale writes.
 * DST-safe: recalculates midnight on each reschedule.
 */
export async function scheduleNotifications(): Promise<void> {
  clearScheduledNotifications();

  const gen = ++scheduleGeneration; // Increment before async work

  const settings = await getNotificationSettings();
  if (!settings.enabled) return;
  if (getPermission() !== 'granted') return;

  // Check if a newer schedule call has started while we were awaiting
  if (gen !== scheduleGeneration) return;

  const schedules = [
    { time: settings.morningTime, handler: buildMorningNotification },
    { time: settings.eveningTime, handler: buildEveningNotification },
    { time: settings.taskReminderTime, handler: buildTaskReminder },
  ];

  for (const { time, handler } of schedules) {
    const ms = msUntilTime(time);
    if (ms > 0) {
      const timer = setTimeout(handler, ms);
      scheduledTimers.push(timer);
    }
  }

  // Schedule next midnight reschedule (DST-safe: calculate each time)
  midnightTimer = setTimeout(async () => {
    await scheduleNotifications();
  }, msUntilNextMidnight());
}

/**
 * Initialize notifications: request permission and schedule.
 * Safe to call multiple times — clears previous timers before rescheduling.
 * Only sets permission request on first call.
 */
let permissionRequested = false;

export async function initNotifications(): Promise<void> {
  const settings = await getNotificationSettings();
  if (!settings.enabled) return;

  // Request permission only once per session
  if (!permissionRequested && getPermission() === 'default') {
    permissionRequested = true;
    const granted = await requestPermission();
    if (!granted) return;
  }

  if (getPermission() !== 'granted') return;

  // Schedule (idempotent via generation token)
  await scheduleNotifications();
}
