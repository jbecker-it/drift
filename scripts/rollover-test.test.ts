import 'fake-indexeddb/auto';
import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  db,
  createTaskTemplate,
  ensureDailyPresetInstances,
  ensureWeeklyTaskInstances,
  presetDailyId,
  presetWeeklyId,
  getWeekKey,
  getWeeklyTaskInstances,
} from '../src/db/index';
import { onTaskRollover, runTaskRollover, resetTaskRolloverState } from '../src/utils/taskRollover';

function mmdd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextDay(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

/** Next Monday at 00:00 local — the ISO weekly rollover boundary. */
function nextMonday(): Date {
  const d = new Date();
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() + 7 - daysSinceMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe('task rollover scheduler', () => {
  before(async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    resetTaskRolloverState();
  });

  it('baselines keys and emits no event when nothing changed', async () => {
    resetTaskRolloverState();
    await db.tasks.clear();
    await db.taskTemplates.clear();
    // First call seeds lastDayKey/lastWeekKey to the current day/week.
    const first = await runTaskRollover();
    assert.equal(first.dayChanged, true, 'first ever run should count as a day change');
    await runTaskRollover(); // second run, same day — no change
    const changed: string[] = [];
    const off = onTaskRollover(() => changed.push('fired'));
    const r = await runTaskRollover();
    off();
    assert.equal(r.dayChanged, false);
    assert.equal(r.weekChanged, false);
    assert.deepEqual(changed, [], 'no event should fire when neither boundary crossed');
  });

  it('resets daily preset instances on the next day at 00:00', async () => {
    // Create a daily preset and materialise today's instance(s).
    const tpl = await createTaskTemplate('Morning walk', 'preset', 'morning');
    await ensureDailyPresetInstances();

    const today = mmdd(new Date());
    const todayId = presetDailyId(tpl.id, today, 'morning');
    const todayTask = await db.tasks.get(todayId);
    assert.ok(todayTask, 'today instance exists');
    // Mark it done — it should stay done for today.
    await db.tasks.update(todayId, { done: true });

    // Simulate midnight → next day.
    const events: string[] = [];
    const off = onTaskRollover(() => events.push('rollover'));
    const r = await runTaskRollover(nextDay());
    off();

    assert.equal(r.dayChanged, true, 'should detect day boundary');
    assert.equal(events.length, 1, 'should emit rollover event');

    // Today's instance must remain done (history preserved)…
    assert.equal((await db.tasks.get(todayId))?.done, true);
    // …and a FRESH instance must exist for the new day, undone.
    const tomId = presetDailyId(tpl.id, mmdd(nextDay()), 'morning');
    const tomTask = await db.tasks.get(tomId);
    assert.ok(tomTask, 'new day instance created');
    assert.equal(tomTask.done, false, 'new day instance starts undone');
  });

  it('resets weekly task instances on Monday 00:00, preserving last week history', async () => {
    resetTaskRolloverState(); // fresh baseline so weekChanged is computed from empty
    await db.tasks.clear();
    await db.taskTemplates.clear();

    const tpl = await createTaskTemplate('Weekly planning', 'weekly', undefined, 2);
    await ensureWeeklyTaskInstances();

    const curWeek = getWeekKey();
    const before = await getWeeklyTaskInstances(tpl.id);
    assert.equal(before.tasks.length, 2);
    // Mark both instances of the current week done.
    const ids = before.tasks.map(t => t.id);
    for (const id of ids) await db.tasks.update(id, { done: true });

    const mon = nextMonday();
    const monWeek = getWeekKey(mon);
    assert.notEqual(monWeek, curWeek, 'test setup: Monday should be a new ISO week');

    const events: string[] = [];
    const off = onTaskRollover(() => events.push('rollover'));
    const r = await runTaskRollover(mon);
    off();

    assert.equal(r.weekChanged, true, 'should detect the new ISO week');
    assert.equal(events.length, 1);

    // New week has a fresh, undone pair under the deterministic keys. (We query
    // the DB directly because getWeeklyTaskInstances always targets the *real*
    // current week, not our simulated Monday.)
    const monRows = await db.tasks.where('weekKey').equals(monWeek).toArray();
    assert.equal(monRows.length, 2);
    assert.equal(monRows.filter(t => t.done).length, 0, 'new week instances start undone');
    for (let i = 0; i < 2; i++) {
      const fresh = await db.tasks.get(presetWeeklyId(tpl.id, monWeek, i));
      assert.ok(fresh, `new week instance ${i} exists`);
      assert.equal(fresh.done, false);
    }
    // Last week's instance records still exist (not deleted) — just outside the
    // current-week query.
    const lastWeekRows = await db.tasks.where('weekKey').equals(curWeek).toArray();
    assert.equal(lastWeekRows.length, 2, 'previous week history preserved');
  });
});