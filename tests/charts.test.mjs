import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTrend, trendSamples } from '../dist/charts.js';
const options = { label: '体重', unit: 'kg', digits: 1, days: 30, today: '2026-10-18' };

test('weight chart has one observed curve, no average curve, and breaks long missing intervals', () => {
  const html = renderTrend([
    { date: '2026-10-13', weightKg: 78.5 },
    { date: '2026-10-03', weightKg: 79.5 },
    { date: '2026-10-01', weightKg: 80 }
  ], 'weightKg', options);
  assert.equal((html.match(/data-series="actual"/g) || []).length, 1);
  assert.equal((html.match(/<path /g) || []).length, 1);
  assert.equal((html.match(/<circle /g) || []).length, 3);
  assert.ok(!html.includes('7日均值'));
  const path = html.match(/data-series="actual" d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g) || []).length, 2);
  assert.equal((path.match(/L/g) || []).length, 1);
  assert.ok(!html.includes('NaN'));
});

test('chart deduplicates dates, preserves manual priority, and drops invalid or missing points', () => {
  const rows = [
    { date: '2026-10-01', weightKg: 80, manual: true },
    { date: '2026-10-01', weightKg: 79 },
    { date: '2026-10-02', weightKg: null },
    { date: '2026-10-03', weightKg: NaN },
    { date: '2026-10-04', weightKg: Infinity },
    { date: '2026-02-30', weightKg: 70 },
    { date: '2026-10-19', weightKg: 75 }
  ];
  assert.deepEqual(trendSamples(rows, 'weightKg', '2026-09-19', '2026-10-18'), [rows[0]]);
  const html = renderTrend(rows, 'weightKg', options);
  assert.equal((html.match(/<circle /g) || []).length, 1);
  assert.match(html, /80\.0 kg/);
});

test('one-day and empty charts do not fabricate measurements or repeat date ticks', () => {
  const html = renderTrend([{ date: '2026-10-18', weightKg: 80 }], 'weightKg', { ...options, days: 0 });
  assert.equal((html.match(/>10\/18<\/text>/g) || []).length, 1);
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('Infinity'));
  const empty = renderTrend([], 'weightKg', options);
  assert.ok(!empty.includes('data-series'));
  assert.match(empty, /还没有/);
});

test('chart hover titles hide original device names even when passed unmerged records', () => {
  const privateName = "Synthetic Owner's iPhone";
  const html = renderTrend([{ date: '2026-10-18', weightKg: 80, sources: { weightKg: privateName } }], 'weightKg', options);
  assert.ok(!html.includes(privateName));
  assert.ok(!html.includes('Synthetic Owner'));
  assert.match(html, /Apple 健康导入/);
  assert.match(html, /80\.0 kg/);
});
