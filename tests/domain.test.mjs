import test from 'node:test';
import assert from 'node:assert/strict';
import { isDate, validateRecord, rollingAverage, mergeHealthRecords, recordsCSV, planForDate, localDate } from '../dist/domain.js';

test('dates are real calendar dates and use Singapore/Hong Kong time', () => {
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2024-02-29'), true);
  assert.equal(localDate(new Date('2026-10-17T17:00:00Z')), '2026-10-18');
  assert.throws(() => validateRecord({ date: '2099-01-01' }, '2026-10-18'), /未来/);
});
test('missing and explicit zero remain distinct; malformed values are rejected', () => {
  const record = validateRecord({ date: '2026-01-01', steps: 0, sleepHours: '', hunger: 0 });
  assert.equal(record.steps, 0);
  assert.equal(record.hunger, 0);
  assert.equal(record.sleepHours, null);
  assert.equal(record.weightKg, null);
  assert.throws(() => validateRecord({ date: '2026-01-01', hunger: true }));
  assert.throws(() => validateRecord({ date: '2026-01-01', weightKg: 500 }));
});
test('seven-day mean requires three observed days and never fills gaps with zero', () => {
  const rows = [{ date: '2026-10-01', weightKg: 70 }, { date: '2026-10-14', weightKg: 80 }, { date: '2026-10-16', weightKg: 79 }];
  assert.deepEqual(rollingAverage(rows, '2026-10-18'), { count: 2, value: null });
  rows.push({ date: '2026-10-18', weightKg: 78 });
  assert.deepEqual(rollingAverage(rows, '2026-10-18'), { count: 3, value: 79 });
});
test('manual values override imports without erasing provenance or unknown fields', () => {
  const health = [{ date: '2026-01-01', weightKg: 80, steps: 2000, inBedHours: 8, sources: { weightKg: 'Demo scale', steps: 'Demo phone' } }];
  const manual = [validateRecord({ date: '2026-01-01', weightKg: 81, steps: null, hunger: 0 })];
  const [row] = mergeHealthRecords(manual, health);
  assert.equal(row.weightKg, 81);
  assert.equal(row.steps, 2000);
  assert.equal(row.sleepHours, undefined);
  assert.equal(row.inBedHours, 8);
  assert.equal(row.sources.weightKg, '手动记录');
  assert.equal(health[0].weightKg, 80);
});
test('CSV guards spreadsheet formulas and preserves multiline notes', () => {
  const text = recordsCSV([{ date: '2026-01-01', notes: '=1+1\n"quoted"', steps: 0 }]);
  assert.ok(text.startsWith('\uFEFF'));
  assert.ok(text.includes("\"'=1+1\n\"\"quoted\"\"\""));
  assert.ok(text.includes('"0"'));
});
test('weekly routine has two strength and two cardio sessions; Sunday optional', () => {
  const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  const plans = dates.map(planForDate);
  assert.deepEqual(plans.map(p => p.type), ['strength', 'cardio', 'rest', 'strength', 'rest', 'cardio', 'walk']);
  assert.equal(plans[6].optional, true);
});
