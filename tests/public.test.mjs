import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSnapshot } from '../scripts/export-public.mjs';
import { mergeHealthRecords } from '../dist/domain.js';

test('public snapshot publishes approved health fields, preserves unknowns and strips identifiers', () => {
  const snapshot = publicSnapshot({ profile: { age: 20, heightCm: 181, context: 'PRIVATE_CONTEXT', name: 'PRIVATE_NAME' }, records: [
    { date: '2026-10-18', weightKg: 103, steps: null, source: 'chat', notes: 'PRIVATE_NOTES', meals: { dinner: '米饭、豆腐、青菜' }, exerciseNotes: '腿举3组' }
  ] }, { exportDate: '2026-10-18 09:34:37 +0800', sourceName: 'PRIVATE_DEVICE', daily: [
    { date: '2026-10-18', weightKg: 104, steps: 0, sources: { steps: 'PRIVATE_DEVICE' }, deviceId: 'PRIVATE_ID' }
  ], workouts: [{ route: 'PRIVATE_LOCATION' }] });
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes('PRIVATE_'));
  assert.equal(snapshot.state.records[0].sleepHours, null);
  assert.equal(snapshot.state.records[0].meals.dinner, '米饭、豆腐、青菜');
  const [row] = mergeHealthRecords(snapshot.state.records, snapshot.health.daily);
  assert.equal(row.weightKg, 103);
  assert.equal(row.steps, 0);
  assert.equal(row.sources.weightKg, '对话记录');
  assert.equal(row.sources.steps, 'Apple 健康导入');
  assert.equal(snapshot.health.exportDate, '2026-10-18 09:34:37 +0800');
  assert.throws(() => publicSnapshot(null, null), /公开快照保持不变/);
});
