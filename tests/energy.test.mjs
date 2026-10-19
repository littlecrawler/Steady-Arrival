import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, mergeHealthRecords } from '../dist/domain.js';
import { calculateEnergy, foodFingerprint, validateCalorieEstimate, restingEnergy, weightForDate, exportCalendarDate, estimateFromForm } from '../dist/energy.js';
import { renderEnergyPanel } from '../dist/energy-ui.js';
import { publicSnapshot } from '../scripts/export-public.mjs';

const profile = { age: 20, sex: 'male', heightCm: 181, startingWeightKg: 108.6, startDate: '2026-10-18', calorieTarget: 2300, targetWeightKg: 71.2 };
function record(overrides = {}) {
  return validateRecord({ date: '2026-10-18', weightKg: 103, source: 'chat', dinnerStatus: 'skipped', meals: { breakfast: 'Synthetic breakfast', lunch: 'Synthetic lunch', dinner: 'No dinner' }, ...overrides }, '2026-10-19');
}
function estimated(complete = false) {
  const r = record();
  r.calorieEstimate = validateCalorieEstimate({ meals: {
    breakfast: { minKcal: 200, maxKcal: 300, basedOn: r.meals.breakfast, note: 'Synthetic only', source: 'assistant' },
    lunch: { minKcal: 1200, maxKcal: 2200, basedOn: r.meals.lunch, note: 'Synthetic only', source: 'assistant' }
  }, complete, completeFor: complete ? foodFingerprint(r) : '' });
  return r;
}
function options(r, extra = {}) { return { record: r, profile, records: mergeHealthRecords([r]), ...extra }; }

test('Mifflin resting estimate uses actual body data and does not substitute target weight or calorie goal', () => {
  assert.equal(restingEnergy(profile, 103), 2066.25);
  assert.equal(restingEnergy({ ...profile, sex: 'female' }, 103), 1900.25);
  assert.equal(restingEnergy({ ...profile, sex: 'unspecified' }, 103), null);
  assert.equal(restingEnergy({ ...profile, age: 17 }, 103), null);
  const result = calculateEnergy(options(record()));
  assert.deepEqual(result.intake.range, { min: 0, max: 0 }); // only the explicitly skipped dinner is known
  assert.equal(result.intake.complete, false);
  assert.equal(result.deficit, null);
  assert.deepEqual(result.expenditure.range, { min: 2066.25 * 1.4, max: 2066.25 * 1.6 });
  assert.deepEqual(calculateEnergy(options(record(), { profile: { ...profile, calorieTarget: 1500, targetWeightKg: 80 } })).expenditure.range, result.expenditure.range);
  assert.equal(calculateEnergy(options(record({ weightKg: null, dinnerStatus: '', meals: {} }), { records: [] })).intake.range, null);
});

test('unknown food and drinks prevent a confirmed deficit; a conditional difference stays explicit', () => {
  const r = estimated();
  const result = calculateEnergy(options(r));
  assert.deepEqual(result.intake.range, { min: 1400, max: 2500 });
  assert.ok(result.intake.missing.includes('零食 / 饮料未确认'));
  assert.equal(result.deficit, null);
  assert.deepEqual(result.conditional, { min: 2066.25 * 1.4 - 2500, max: 2066.25 * 1.6 - 1400 });
  const html = renderEnergyPanel(options(r));
  assert.match(html, /待确认/);
  assert.match(html, /仅当当天没有其他未记录摄入/);
  assert.ok(!html.includes('name="energy-complete"')); // public/read-only rendering never exposes write controls
});

test('confirmation allows a full-day estimate but changing food or manual intake invalidates it', () => {
  const r = estimated(true);
  assert.ok(calculateEnergy(options(r)).deficit);
  r.meals.lunch = 'Different synthetic meal';
  const changed = calculateEnergy(options(r));
  assert.equal(changed.deficit, null);
  assert.equal(changed.conditional, null);
  assert.equal(changed.intake.staleConfirmation, true);
  assert.equal(changed.intake.rows.find(m => m.key === 'lunch').range, null);
  const manual = record({ caloriesKcal: 2000 });
  manual.calorieEstimate = { ...estimated(true).calorieEstimate, completeFor: foodFingerprint(manual) };
  assert.equal(calculateEnergy(options(manual)).intake.range.min, 2000);
  manual.caloriesKcal = 2500;
  assert.equal(calculateEnergy(options(manual)).deficit, null);
});

test('manual totals are used once and signed balance retains a surplus or a range crossing zero', () => {
  const r = estimated(true);
  r.caloriesKcal = 4000;
  r.calorieEstimate.completeFor = foodFingerprint(r);
  const result = calculateEnergy(options(r));
  assert.deepEqual(result.intake.range, { min: 4000, max: 4000 });
  assert.ok(result.deficit.max < 0);
  r.caloriesKcal = null;
  r.calorieEstimate.meals.lunch.maxKcal = 3500;
  r.calorieEstimate.completeFor = foodFingerprint(r);
  const crossing = calculateEnergy(options(r));
  assert.ok(crossing.deficit.min < 0 && crossing.deficit.max > 0);
});

test('device export day is blocked; prior dates add resting plus active once, with no workout bonus', () => {
  const r = estimated(true);
  r.calorieEstimate.method = 'device';
  const health = { exportDate: '2026-10-18 09:34:37 +0800', daily: [{ date: r.date, activeKcal: 12.14, restingKcal: 790.54 }] };
  assert.equal(exportCalendarDate(health.exportDate), '2026-10-18');
  assert.equal(exportCalendarDate('2026-10-17T20:00:00Z'), '2026-10-18');
  assert.equal(exportCalendarDate('2026-10-18'), null);
  assert.equal(calculateEnergy(options(r, { health })).expenditure.range, null);
  assert.match(calculateEnergy(options(r, { health })).expenditure.reason, /部分时段/);
  health.exportDate = '2026-10-19 09:00:00 +0800';
  health.daily[0] = { date: r.date, activeKcal: 400, restingKcal: 2100 };
  r.workoutMinutes = 60; r.steps = 10000;
  assert.deepEqual(calculateEnergy(options(r, { health })).expenditure.range, { min: 2500, max: 2500 });
  health.daily[0].activeKcal = null;
  assert.equal(calculateEnergy(options(r, { health })).expenditure.range, null);
});

test('only recent past weights are used, with dated starting weight as an explicit fallback', () => {
  const rows = [{ date: '2026-10-10', weightKg: 104 }, { date: '2026-10-19', weightKg: 100 }];
  assert.equal(weightForDate(rows, profile, '2026-10-18').value, 104);
  assert.equal(weightForDate([], profile, '2026-10-17'), null);
  assert.equal(weightForDate([{ date: '2026-08-01', weightKg: 99 }], profile, '2026-10-17'), null);
  assert.equal(weightForDate([], profile, '2026-10-18').value, 108.6);
  assert.equal(weightForDate([], profile, '2026-12-01'), null);
});

test('invalid ranges cannot be saved and non-nutrition metadata is stripped', () => {
  assert.throws(() => validateCalorieEstimate({ meals: { lunch: { minKcal: 600, maxKcal: 400, source: 'manual' } } }), /下限/);
  assert.throws(() => validateCalorieEstimate({ palMin: 2, palMax: 1.5 }), /下限/);
  assert.throws(() => validateCalorieEstimate({ meals: { lunch: { minKcal: '', maxKcal: 400, source: 'manual' } } }), /数值/);
  assert.throws(() => validateCalorieEstimate({ method: 'invented' }), /计算方式/);
  const clean = validateCalorieEstimate({ privateField: 'PRIVATE', meals: { breakfast: { minKcal: 1, maxKcal: 2, basedOn: 'Food', note: 'Assumed', source: 'assistant', deviceId: 'PRIVATE' } } });
  assert.ok(!JSON.stringify(clean).includes('PRIVATE'));
});

test('form preserves assistant provenance unless its range or assumption is edited', () => {
  const r = estimated();
  const old = r.calorieEstimate;
  const values = { 'energy-min-breakfast': '200', 'energy-max-breakfast': '300', 'energy-food-breakfast': r.meals.breakfast, 'energy-note-breakfast': old.meals.breakfast.note };
  assert.equal(estimateFromForm(r, values, old).meals.breakfast.source, 'assistant');
  values['energy-max-breakfast'] = '350';
  assert.equal(estimateFromForm(r, values, old).meals.breakfast.source, 'manual');
});

test('public export keeps current nutrition estimates and sanitizes stale text, fingerprints and identifiers', () => {
  const r = estimated(true);
  r.calorieEstimate.privateField = 'PRIVATE_METADATA';
  r.calorieEstimate.meals.lunch.deviceId = 'PRIVATE_DEVICE';
  const snapshot = publicSnapshot({ profile, records: [r] }, null);
  const published = snapshot.state.records[0];
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_'));
  assert.ok(calculateEnergy({ ...options(published), profile: snapshot.state.profile }).deficit);
  r.calorieEstimate.completeFor = 'PRIVATE_FINGERPRINT';
  r.calorieEstimate.meals.lunch.basedOn = 'PRIVATE_OLD_MEAL';
  const changed = publicSnapshot({ profile, records: [r] }, null);
  assert.ok(!JSON.stringify(changed).includes('PRIVATE_'));
  assert.equal(changed.state.records[0].calorieEstimate.complete, false);
});

test('meal text and assumptions are escaped in both editable and read-only calculator views', () => {
  const r = estimated();
  r.meals.breakfast = '<img src=x onerror=alert(1)>';
  r.calorieEstimate.meals.breakfast.basedOn = r.meals.breakfast;
  r.calorieEstimate.meals.breakfast.note = '</textarea><script>bad()</script>';
  for (const editable of [false, true]) {
    const html = renderEnergyPanel(options(r), { editable });
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img/);
    assert.equal(html.includes('name="energy-complete"'), editable);
    assert.ok(!html.includes('<form')); // calculator controls share the parent diary form
  }
});
