import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { v4 as uuid } from 'uuid';
import {
  db,
  createTaskTemplate,
  ensureWeeklyTaskInstances,
  getWeeklyTaskInstances,
  getWeekKey,
  getTaskNudgeSummary,
  updateTaskTemplate,
  getTodaysTasks,
} from '../src/db/index';

describe('weekly task rollover', () => {
  it('creates `frequency` instances for the current week', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    const tpl = await createTaskTemplate('Workout', 'weekly', undefined, 3);
    await ensureWeeklyTaskInstances();
    const { tasks, done } = await getWeeklyTaskInstances(tpl.id);
    assert.equal(tasks.length, 3, 'should create 3 instances for freq=3');
    assert.equal(done, 0, 'all should start undone');
    // Every instance must carry the current ISO week key
    const weekKey = getWeekKey();
    assert.ok(tasks.every(t => t.weekKey === weekKey), 'instances should belong to current week');
  });

  it('trims excess undone instances when frequency is reduced mid-week', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    const tpl = await createTaskTemplate('Read', 'weekly', undefined, 3);
    await ensureWeeklyTaskInstances();
    assert.equal((await getWeeklyTaskInstances(tpl.id)).tasks.length, 3);

    // Simulate a growing problem: manually inject 2 extra undone instances.
    const weekKey = getWeekKey();
    const today = new Date().toLocaleDateString('en-CA');
    for (let i = 0; i < 2; i++) {
      await db.tasks.add({
        id: uuid(), text: tpl.text, date: today, done: false,
        createdAt: new Date().toISOString(), source: 'manual',
        templateId: tpl.id, weekKey,
      } as any);
    }
    assert.equal((await getWeeklyTaskInstances(tpl.id)).tasks.length, 5);

    // Reduce the required frequency to 1 → 4 extra undone instances should be removed.
    await updateTaskTemplate(tpl.id, { weekFrequency: 1 });
    await ensureWeeklyTaskInstances();
    const after = await getWeeklyTaskInstances(tpl.id);
    assert.equal(after.tasks.length, 1, 'should trim back to the new frequency');
  });

  it('does not create duplicate instances across repeated calls (idempotent)', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    const tpl = await createTaskTemplate('Water', 'weekly', undefined, 2);
    await ensureWeeklyTaskInstances();
    await ensureWeeklyTaskInstances();
    await ensureWeeklyTaskInstances();
    assert.equal((await getWeeklyTaskInstances(tpl.id)).tasks.length, 2);
  });
});

describe('task data → AI nudge summary', () => {
  it('includes undone daily preset tasks and custom tasks', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    const today = new Date().toLocaleDateString('en-CA');

    // Daily preset instance (undone)
    const preset = await createTaskTemplate('Take meds', 'preset', 'morning');
    await db.tasks.add({
      id: uuid(), text: preset.text, date: today, done: false,
      createdAt: new Date().toISOString(), source: 'manual', templateId: preset.id,
    } as any);
    // Custom task (undone)
    await db.tasks.add({
      id: uuid(), text: 'Reply to Sarah', date: today, done: false,
      createdAt: new Date().toISOString(), source: 'manual',
    } as any);

    const summary = await getTaskNudgeSummary();
    assert.match(summary, /Take meds/, 'daily preset task should be in the nudge');
    assert.match(summary, /Reply to Sarah/, 'custom task should be in the nudge');
  });

  it('excludes weekly instances from today\'s tasks / daily undone list (reported separately)', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    const weeklyTpl = await createTaskTemplate('Weekly sync', 'weekly', undefined, 1);
    await ensureWeeklyTaskInstances();

    // The weekly instance's `date` is today, but getTodaysTasks must EXCLUDE it
    // (it's surfaced separately via its weekKey group).
    const todays = await getTodaysTasks();
    assert.ok(!todays.some(t => t.templateId === weeklyTpl.id),
      'weekly instance should be excluded from today\'s tasks');

    const summary = await getTaskNudgeSummary();
    // It must NOT appear as "Undone today: Weekly sync" (double-counted), because
    // the weekly section already reports it.
    assert.ok(!/Undone today: [^\n]*Weekly sync/.test(summary),
      'weekly instance should not appear in the daily undone list');
  });
});
