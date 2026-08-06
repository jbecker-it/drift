import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { v4 as uuid } from 'uuid';
import {
  db,
  createTaskTemplate,
  ensureDailyPresetInstances,
  getTemplatesWithStatus,
  getTemplateSlots, orderInSlot,
  toggleTask,
  getJournalTaskGroups,
  getTodaysTasksBySlot,
  setTemplateSlots,
  reorderTemplate,
} from '../src/db/index';

describe('multi-slot daily presets', () => {
  it('creates one instance per slot and reports per-slot status', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();

    // Single-slot legacy template
    const legacy = await createTaskTemplate('Brush teeth', 'preset', 'morning');
    // Multi-slot template
    const multi = await createTaskTemplate('Drink 2L water', 'preset', undefined, undefined, ['morning', 'night']);

    await ensureDailyPresetInstances();

    assert.deepEqual(getTemplateSlots(legacy), ['morning']);
    assert.deepEqual(getTemplateSlots(multi), ['morning', 'night']);

    const { presets } = await getTemplatesWithStatus();
    const multiEntry = presets.find(p => p.template.id === multi.id)!;
    const legacyEntry = presets.find(p => p.template.id === legacy.id)!;

    // Multi-slot → two independent instances (morning + night)
    const morningInstance = multiEntry.instances['morning'];
    const nightInstance = multiEntry.instances['night'];
    assert.ok(morningInstance && nightInstance, 'expected morning + night instances');
    assert.notEqual(morningInstance.id, nightInstance.id, 'instances should be distinct');
    assert.equal(morningInstance.slot, 'morning');
    assert.equal(nightInstance.slot, 'night');

    // Newly-created single-slot templates get a slotted instance today.
    assert.ok(legacyEntry.instances['morning']);
    assert.equal(legacyEntry.instances['morning']!.slot, 'morning');

    // Toggle only the morning instance of the multi-slot task
    await toggleTask(morningInstance.id);
    const after = await getTemplatesWithStatus();
    const multiAfter = after.presets.find(p => p.template.id === multi.id)!;
    assert.equal(multiAfter.instances['morning']!.done, true);
    assert.equal(multiAfter.instances['night']!.done, false, 'night must stay undone');
  });

  it('handles legacy template+instance with no slots (no duplicate)', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    // Pre-existing shape: template has preset but no `slots`; instance has no `slot`.
    await db.taskTemplates.add({
      id: uuid(), text: 'Old habit', type: 'preset', preset: 'afternoon',
      order: 0, createdAt: new Date().toISOString(), active: true,
    } as any);
    const tpl = (await db.taskTemplates.toArray())[0];
    const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
    await db.tasks.add({
      id: uuid(), text: 'Old habit', date: today,
      done: false, createdAt: new Date().toISOString(), source: 'manual', templateId: tpl.id,
    } as any);

    await ensureDailyPresetInstances();

    // No duplicate created for the legacy instance.
    const instances = await db.tasks.where('templateId').equals(tpl.id).toArray();
    assert.equal(instances.length, 1, 'must not duplicate legacy instance');

    const { presets } = await getTemplatesWithStatus();
    const entry = presets.find(p => p.template.id === tpl.id)!;
    assert.ok(entry.instances['afternoon'], 'legacy instance resolves to its (first) slot');
    assert.equal(entry.instances['afternoon']!.slot, undefined, 'the legacy instance itself stays un-slotted');

    const afternoonTasks = await getTodaysTasksBySlot('afternoon');
    assert.ok(afternoonTasks.some(x => x.templateId === tpl.id));
  });

  it('getJournalTaskGroups shows the task under both slots', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    await createTaskTemplate('Drink 2L water', 'preset', undefined, undefined, ['morning', 'night']);
    await ensureDailyPresetInstances();

    const { groups } = await getJournalTaskGroups();
    const morning = groups.find(g => g.slot === 'morning');
    const night = groups.find(g => g.slot === 'night');
    assert.ok(morning?.items.find(i => i.text === 'Drink 2L water'));
    assert.ok(night?.items.find(i => i.text === 'Drink 2L water'));
  });

  it('setTemplateSlots adds/removes a slot and ensures new instance', async () => {
    await db.tasks.clear();
    await db.taskTemplates.clear();
    const t = await createTaskTemplate('Walk', 'preset', 'afternoon');
    await ensureDailyPresetInstances();

    // Add 'morning'
    await setTemplateSlots(t.id, ['afternoon', 'morning']);
    await ensureDailyPresetInstances();
    const { presets } = await getTemplatesWithStatus();
    const entry = presets.find(p => p.template.id === t.id)!;
    assert.ok(entry.instances['morning'] && entry.instances['afternoon'], 'both slots should have instances');

    // getTodaysTasksBySlot works for both
    const morningTasks = await getTodaysTasksBySlot('morning');
    assert.ok(morningTasks.some(x => x.templateId === t.id));
  });

  it('setTemplateSlots refuses to remove the last slot', async () => {
    await db.taskTemplates.clear();
    await db.tasks.clear();
    const t = await createTaskTemplate('Solo', 'preset', 'morning');
    await assert.rejects(() => setTemplateSlots(t.id, []), /at least one time slot/i);
    // template is untouched
    const after = await db.taskTemplates.get(t.id)!;
    assert.deepEqual(getTemplateSlots(after!), ['morning']);
  });

  it('setTemplateSlots removes today\'s instance for a removed slot', async () => {
    await db.taskTemplates.clear();
    await db.tasks.clear();
    const t = await createTaskTemplate('Multi', 'preset', undefined, undefined, ['morning', 'night']);
    await ensureDailyPresetInstances();
    let instances = await db.tasks.where('templateId').equals(t.id).toArray();
    assert.equal(instances.length, 2);
    assert.ok(instances.every(x => x.slot !== undefined), 'instances are slotted');

    // Drop 'night' → only morning + today's night instance removed
    await setTemplateSlots(t.id, ['morning']);
    instances = await db.tasks.where('templateId').equals(t.id).toArray();
    assert.equal(instances.length, 1, 'removed-slot instance cleaned up');
    assert.equal(instances[0].slot, 'morning');
  });

  it('materializes legacy un-slotted instances before reinterpretation', async () => {
    await db.taskTemplates.clear();
    await db.tasks.clear();
    const t = await createTaskTemplate('Legacy habit', 'preset', 'morning');
    await ensureDailyPresetInstances();
    // Simulate old data: strip the slot field off today's instance
    const inst = (await db.tasks.where('templateId').equals(t.id).toArray())[0];
    await db.tasks.update(inst.id, { slot: undefined as any });

    // Switch to 'night' only (morning removed). The un-slotted legacy instance
    // must be tagged, removed, and NOT reinterpreted as the new slot.
    await setTemplateSlots(t.id, ['night']);
    await ensureDailyPresetInstances();

    const instances = await db.tasks.where('templateId').equals(t.id).toArray();
    assert.equal(instances.some(x => x.slot === undefined), false, 'no un-slotted instances remain');
    assert.equal(instances.filter(x => x.slot === 'night').length, 1, 'night instance created');
    assert.equal(instances.filter(x => x.slot === 'morning').length, 0, 'legacy morning not reinterpreted as night');
    assert.equal(instances.length, 1);
  });

  it('reorderTemplate orders within the specified slot only', async () => {
    await db.taskTemplates.clear();
    await db.tasks.clear();
    await createTaskTemplate('A', 'preset', undefined, undefined, ['morning', 'night']);
    await createTaskTemplate('B', 'preset', undefined, undefined, ['morning', 'night']);
    const c = await createTaskTemplate('C', 'preset', undefined, undefined, ['morning', 'night']);

    // Move 'C' up within 'night' — should not affect 'morning' order
    await reorderTemplate(c.id, 'night', 'up');
    const all = await db.taskTemplates.toArray();
    const night = all.slice().sort((x, y) => orderInSlot(x, 'night') - orderInSlot(y, 'night')).map(x => x.text);
    const morning = all.slice().sort((x, y) => orderInSlot(x, 'morning') - orderInSlot(y, 'morning')).map(x => x.text);
    assert.deepEqual(night, ['A', 'C', 'B'], 'night order changed');
    assert.deepEqual(morning, ['A', 'B', 'C'], 'morning order unaffected');
  });

  it('createTaskTemplate throws for a preset with no visible day slot', async () => {
    await db.taskTemplates.clear();
    await assert.rejects(() => createTaskTemplate('Bare', 'preset'), /at least one time slot/i);
    await assert.rejects(() => createTaskTemplate('Anytime', 'preset', 'anytime'), /at least one time slot/i);
  });

  it('setTemplateSlots appends a newly added slot to the end of its segment', async () => {
    await db.taskTemplates.clear();
    await db.tasks.clear();
    // N lives in 'night'; M lives in 'morning'
    const n = await createTaskTemplate('N', 'preset', 'night');
    const m = await createTaskTemplate('M', 'preset', 'morning');
    // Move M into 'night' too → it should be placed after existing N
    await setTemplateSlots(m.id, ['morning', 'night']);
    const mAfter = (await db.taskTemplates.get(m.id))!;
    const nAfter = (await db.taskTemplates.get(n.id))!;
    assert.ok(
      orderInSlot(mAfter, 'night') > orderInSlot(nAfter, 'night'),
      'newly added slot should append after existing items in that segment',
    );
    // morning order preserved
    assert.equal(orderInSlot(mAfter, 'morning'), orderInSlot(m, 'morning'));
  });
});