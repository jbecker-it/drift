import { ensureDailyPresetInstances, ensureWeeklyTaskInstances, getWeekKey, localDateKey } from '../db';

// ─── Task rollover scheduler ─────────────────────────
// Daily preset instances and weekly task instances are keyed deterministically
// per day (`preset:<template>:<date>:<slot>`) and per ISO week
// (`weekly:<template>:<weekKey>:<index>`). Any call to ensure*Instances() for a
// new date / week key therefore silently creates a fresh (done:false) set — so a
// "reset" is simply re-running those ensures once the calendar has moved on.
//
// That re-run used to happen only when a page mounted or the app reloaded. This
// module schedules it to fire automatically at the next local midnight (00:00)
// and on every subsequent midnight while the app stays open. Because weekly
// instances are keyed by ISO week (which starts on Monday), the weekly set only
// rolls over when a fresh week begins — i.e. exactly on Monday 00:00 — which is
// what the app already treats as the weekly reset point.
//
// When a rollover actually occurs we also emit an event so that any currently
// mounted page (Tasks, Journal) can re-read its data and show the new day's tasks.

export const TASK_ROLLOVER_EVENT = 'drift:tasks-rollover';

type RolloverListener = (detail: { dayChanged: boolean; weekChanged: boolean }) => void;

const listeners = new Set<RolloverListener>();

/** Subscribe to rollover events. Returns an unsubscribe function. */
export function onTaskRollover(listener: RolloverListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitRollover(detail: { dayChanged: boolean; weekChanged: boolean }): void {
  listeners.forEach(l => {
    try { l(detail); } catch { /* a bad listener must not break the scheduler */ }
  });
}

let timerId: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopped = false;
let lastDayKey = '';
let lastWeekKey = '';

/** Milliseconds until the next local midnight (DST-safe by construction). */
function msToNextMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // 24:00 today == 00:00 tomorrow, in local time
  return next.getTime() - now.getTime();
}

/**
 * Run the rollover check. When the day key or ISO week key has changed since the
 * last run, re-materialise instances (which "resets" them) and emit an event so
 * open pages refresh. Idempotent — safe to call on every midnight and on focus.
 *
 * @param now The time to treat as "now". Defaults to the real clock; injectable
 *            for tests that simulate the next day / Monday.
 */
export async function runTaskRollover(now: Date = new Date()): Promise<{ dayChanged: boolean; weekChanged: boolean }> {
  if (running) return { dayChanged: false, weekChanged: false };
  running = true;
  try {
    const dayKey = localDateKey(now);
    const weekKey = getWeekKey(now);
    const dayChanged = dayKey !== lastDayKey;
    const weekChanged = weekKey !== lastWeekKey;

    // Only touch the DB if a boundary was actually crossed.
    if (dayChanged || weekChanged) {
      await ensureDailyPresetInstances(now);
      if (weekChanged) {
        await ensureWeeklyTaskInstances(now);
      }
    }

    lastDayKey = dayKey;
    lastWeekKey = weekKey;

    const changed = dayChanged || weekChanged;
    if (changed) {
      // Emit AFTER `running` is cleared (see finally) so a listener that happens
      // to call runTaskRollover re-entrantly is not silently dropped.
      queueMicrotask(() => emitRollover({ dayChanged, weekChanged }));
    }
    return { dayChanged, weekChanged };
  } catch (err) {
    // Log rather than swallow silently — a failed reset is the user-visible
    // "stale done tasks" case and should be diagnosable.
    console.error('Drift: task rollover failed', err);
    return { dayChanged: false, weekChanged: false };
  } finally {
    running = false;
  }
}

/**
 * Arm the timer for the next midnight. Safe to call repeatedly — the bootstrap
 * (baseline + immediate reset) and the per-midnight re-arm are kept separate so
 * the timer callback never re-triggers an extra bootstrap.
 */
function scheduleNextMidnight(): void {
  if (stopped) return;
  timerId = setTimeout(async () => {
    timerId = null;
    if (stopped) return;
    await runTaskRollover();
    // Always re-arm for the following midnight, regardless of the outcome.
    scheduleNextMidnight();
  }, msToNextMidnight() + 1000); // +1s safety so we're clearly past 00:00
}

/** Start the scheduler. Call once when the app becomes ready. */
export function startTaskRollover(): void {
  if (timerId !== null) return;
  stopped = false;
  // Bootstrap the baseline day/week keys and run once immediately so a fresh
  // session after a gap (e.g. app closed overnight or over a weekend) resets the
  // tasks for the current day/week right away, without waiting for midnight.
  runTaskRollover()
    .catch(() => {})
    .finally(() => {
      if (!stopped) scheduleNextMidnight();
    });
}

/** Cancel the scheduler (used on app unmount / HMR). */
export function stopTaskRollover(): void {
  stopped = true;
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

/**
 * Reset the internal baseline day/week keys. Primarily for tests (each test runs
 * its own scenario from a clean slate) and hot restarts.
 */
export function resetTaskRolloverState(): void {
  lastDayKey = '';
  lastWeekKey = '';
}