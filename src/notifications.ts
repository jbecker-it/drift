// ─── PWA Notifications ────────────────────────────
// Local-first notification scheduling for Drift.
// Uses the Web Notifications API + setTimeout-based scheduling.
// These reminders only fire while the app/tab is OPEN — they will NOT fire
// if the app/browser is closed or the tab is suspended.

import { getSetting, setSetting, getTodaysTasksBySlot, getTodaysCustomTasks, getOpenTodos, getTodaysEntries, isOverdue, isDueToday } from './db';

// ─── Types ─────────────────────────────────────────

export interface NotificationSettings {
  enabled: boolean;
  /** HH:mm format — morning journal reminder */
  morningTime: string;
  /** HH:mm format — evening journal reminder */
  eveningTime: string;
  /** HH:mm format — general task reminder (for tasks without a slot) */
  taskReminderTime: string;
  /** Enable per-part-of-day task notifications (fires at end of each slot) */
  perSlotTasks: boolean;
  /** HH:mm — end of morning slot */
  morningSlotEnd: string;
  /** HH:mm — end of midday slot */
  middaySlotEnd: string;
  /** HH:mm — end of afternoon slot */
  afternoonSlotEnd: string;
  /** HH:mm — end of night slot */
  nightSlotEnd: string;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  morningTime: '08:00',
  eveningTime: '20:00',
  taskReminderTime: '18:00',
  perSlotTasks: true,
  morningSlotEnd: '12:00',
  middaySlotEnd: '14:00',
  afternoonSlotEnd: '18:00',
  nightSlotEnd: '22:00',
};

/** Validate a HH:mm time string. Returns true if valid. */
function isValidTime(time: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Validate slot ordering: morning <= midday <= afternoon <= night. */
function validateSlotOrdering(settings: NotificationSettings): boolean {
  const times = [settings.morningSlotEnd, settings.middaySlotEnd, settings.afternoonSlotEnd, settings.nightSlotEnd];
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) return false;
  }
  return true;
}

// ─── Permission ────────────────────────────────────

/** Check if notifications are supported. */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
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
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      morningTime: isValidTime(parsed.morningTime) ? parsed.morningTime : DEFAULT_SETTINGS.morningTime,
      eveningTime: isValidTime(parsed.eveningTime) ? parsed.eveningTime : DEFAULT_SETTINGS.eveningTime,
      taskReminderTime: isValidTime(parsed.taskReminderTime) ? parsed.taskReminderTime : DEFAULT_SETTINGS.taskReminderTime,
      perSlotTasks: typeof parsed.perSlotTasks === 'boolean' ? parsed.perSlotTasks : DEFAULT_SETTINGS.perSlotTasks,
      morningSlotEnd: isValidTime(parsed.morningSlotEnd) ? parsed.morningSlotEnd : DEFAULT_SETTINGS.morningSlotEnd,
      middaySlotEnd: isValidTime(parsed.middaySlotEnd) ? parsed.middaySlotEnd : DEFAULT_SETTINGS.middaySlotEnd,
      afternoonSlotEnd: isValidTime(parsed.afternoonSlotEnd) ? parsed.afternoonSlotEnd : DEFAULT_SETTINGS.afternoonSlotEnd,
      nightSlotEnd: isValidTime(parsed.nightSlotEnd) ? parsed.nightSlotEnd : DEFAULT_SETTINGS.nightSlotEnd,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  // Validate all time fields
  const timeFields: Array<[string, string]> = [
    ['morningTime', settings.morningTime],
    ['eveningTime', settings.eveningTime],
    ['taskReminderTime', settings.taskReminderTime],
    ['morningSlotEnd', settings.morningSlotEnd],
    ['middaySlotEnd', settings.middaySlotEnd],
    ['afternoonSlotEnd', settings.afternoonSlotEnd],
    ['nightSlotEnd', settings.nightSlotEnd],
  ];
  for (const [field, value] of timeFields) {
    if (!isValidTime(value)) {
      throw new Error(`Invalid notification time for ${field}: "${value}"`);
    }
  }
  // Validate slot ordering
  if (settings.perSlotTasks && !validateSlotOrdering(settings)) {
    throw new Error('Slot end times must be in chronological order: morning <= midday <= afternoon <= night');
  }
  await setSetting('notifications', JSON.stringify(settings));
}

// ─── Scheduling (concurrency-safe, DST-safe) ───────

let scheduledTimers: ReturnType<typeof setTimeout>[] = [];
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleGeneration = 0;

/** Clear all scheduled notification timers. */
export function clearScheduledNotifications(): void {
  scheduleGeneration++; // Invalidate any in-flight scheduling
  scheduledTimers.forEach(t => clearTimeout(t));
  scheduledTimers = [];
  if (midnightTimer) { clearTimeout(midnightTimer); midnightTimer = null; }
}

/** Calculate ms until a target HH:mm time today. Returns -1 if already passed. */
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
  midnight.setHours(24, 0, 5, 0);
  return midnight.getTime() - now.getTime();
}

/** Show a notification (uses service worker if available, fallback to Notification API). */
async function showNotification(title: string, body: string, tag: string): Promise<void> {
  if (getPermission() !== 'granted') return;

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      // Service worker notification options — DOM types may not include all fields
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

  new Notification(title, { body, icon: '/favicon.svg', tag });
}

// ─── Notification builders ─────────────────────────

/** Truncate task list for notification body. Max 3 items, then "and N more". */
function truncateTaskList(tasks: { text: string }[]): string {
  if (tasks.length <= 3) return tasks.map(t => t.text).join(', ');
  const shown = tasks.slice(0, 3).map(t => t.text).join(', ');
  return `${shown} and ${tasks.length - 3} more`;
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
  if (entries.length > 0) return;

  await showNotification(
    'Drift — Evening reflection 🌙',
    'No journal entry today yet. Take a minute to process your day.',
    'drift-evening',
  );
}

/** Build the general task reminder — covers custom tasks + to-dos without a slot. */
async function buildGeneralTaskReminder(): Promise<void> {
  const [customTasks, todos] = await Promise.all([
    getTodaysCustomTasks(),
    getOpenTodos(),
  ]);
  const overdueTodos = todos.filter((t: any) => isOverdue(t.dueDate));
  const dueTodayTodos = todos.filter((t: any) => isDueToday(t.dueDate));

  const parts: string[] = [];
  if (customTasks.length > 0) {
    parts.push(`${customTasks.length} undone day task${customTasks.length > 1 ? 's' : ''}`);
  }
  if (overdueTodos.length > 0) {
    parts.push(`${overdueTodos.length} overdue to-do${overdueTodos.length > 1 ? 's' : ''}`);
  }
  if (dueTodayTodos.length > 0) {
    parts.push(`${dueTodayTodos.length} to-do due today`);
  }

  if (parts.length === 0) return;

  await showNotification(
    'Drift — Task reminder 📋',
    parts.join('. ') + '. Don\'t forget!',
    'drift-tasks-general',
  );
}

// ─── Per-slot task notifications ───────────────────

type PartOfDay = 'morning' | 'midday' | 'afternoon' | 'night';

const SLOT_LABELS: Record<PartOfDay, string> = {
  morning: '🌅 Morning',
  midday: '☀️ Midday',
  afternoon: '🌤️ Afternoon',
  night: '🌙 Night',
};

async function buildSlotTaskReminder(slot: PartOfDay): Promise<void> {
  const undoneTasks = await getTodaysTasksBySlot(slot);
  if (undoneTasks.length === 0) return;

  await showNotification(
    `Drift — ${SLOT_LABELS[slot]} tasks 📋`,
    `${undoneTasks.length} undone: ${truncateTaskList(undoneTasks)}`,
    `drift-slot-${slot}`,
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

  const gen = ++scheduleGeneration;

  const settings = await getNotificationSettings();
  if (!settings.enabled) return;
  if (getPermission() !== 'granted') return;

  if (gen !== scheduleGeneration) return;

  // Journal reminders (always)
  const schedules: { time: string; handler: () => Promise<void> }[] = [
    { time: settings.morningTime, handler: buildMorningNotification },
    { time: settings.eveningTime, handler: buildEveningNotification },
  ];

  if (settings.perSlotTasks) {
    // Per-slot task reminders (fires at end of each part-of-day)
    schedules.push(
      { time: settings.morningSlotEnd, handler: () => buildSlotTaskReminder('morning') },
      { time: settings.middaySlotEnd, handler: () => buildSlotTaskReminder('midday') },
      { time: settings.afternoonSlotEnd, handler: () => buildSlotTaskReminder('afternoon') },
      { time: settings.nightSlotEnd, handler: () => buildSlotTaskReminder('night') },
    );
  }

  // General task reminder (always — covers custom tasks + to-dos without a slot)
  schedules.push({ time: settings.taskReminderTime, handler: buildGeneralTaskReminder });

  for (const { time, handler } of schedules) {
    const ms = msUntilTime(time);
    if (ms > 0) {
      const timer = setTimeout(() => {
        void (async () => {
          // Re-verify generation, settings, and permission before showing
          if (gen !== scheduleGeneration) return;
          if (!settings.enabled) return;
          if (getPermission() !== 'granted') return;
          await handler();
        })().catch(err => {
          console.error('Notification handler failed:', err);
        });
      }, ms);
      scheduledTimers.push(timer);
    }
  }

  // Schedule next midnight reschedule
  midnightTimer = setTimeout(() => {
    void scheduleNotifications().catch(err => {
      console.error('Midnight reschedule failed:', err);
    });
  }, msUntilNextMidnight());
}

// ─── Init ──────────────────────────────────────────

let permissionRequested = false;

/**
 * Initialize notifications: request permission and schedule.
 * Safe to call multiple times — clears previous timers before rescheduling.
 */
export async function initNotifications(): Promise<void> {
  const settings = await getNotificationSettings();
  if (!settings.enabled) return;

  if (!permissionRequested && getPermission() === 'default') {
    permissionRequested = true;
    const granted = await requestPermission();
    if (!granted) return;
  }

  if (getPermission() !== 'granted') return;

  await scheduleNotifications();
}
