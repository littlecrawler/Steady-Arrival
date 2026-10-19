import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDate, NUMBER_FIELDS, MEAL_KEYS } from '../dist/domain.js';
import { validateCalorieEstimate, foodFingerprint } from '../dist/energy.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const metricKeys = [...Object.keys(NUMBER_FIELDS), 'distanceKm', 'activeKcal', 'restingKcal',
  'inBedHours', 'deviceWorkoutMinutes', 'leanMassKg', 'deviceBMI', 'flights', 'carbsG', 'fatG',
  'waterMl', 'restingHeartRate', 'hrvMs'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(key => obj?.[key] !== undefined).map(key => [key, obj[key]]));

// Only these fields cross the boundary into the deliberately public snapshot.
export function publicSnapshot(state, imported, publishedAt = new Date().toISOString()) {
  if (!state?.profile || !Array.isArray(state.records)) throw new Error('没有有效的本地记录；公开快照保持不变。');
  const records = state.records.filter(r => isDate(r.date)).map(r => {
    const clean = { date: r.date };
    for (const key of Object.keys(NUMBER_FIELDS)) clean[key] = typeof r[key] === 'number' && Number.isFinite(r[key]) ? r[key] : null;
    Object.assign(clean, pick(r, ['weightContext', 'workoutType', 'workoutStatus', 'dinnerStatus', 'exerciseNotes', 'updatedAt']));
    clean.source = r.source === 'chat' ? 'chat' : 'manual';
    clean.meals = Object.fromEntries(MEAL_KEYS.map(key => [key, typeof r.meals?.[key] === 'string' ? r.meals[key] : '']));
    if (r.calorieEstimate) {
      const estimate = validateCalorieEstimate(r.calorieEstimate);
      estimate.meals = Object.fromEntries(Object.entries(estimate.meals).filter(([key, m]) => m.basedOn === clean.meals[key]));
      const confirmed = estimate.complete && estimate.completeFor === foodFingerprint(r);
      estimate.complete = !!confirmed;
      estimate.completeFor = confirmed ? foodFingerprint(clean) : '';
      clean.calorieEstimate = estimate;
    }
    return clean;
  });
  const daily = (imported?.daily || []).filter(r => isDate(r.date)).map(r => {
    const clean = { date: r.date, sources: {} };
    for (const key of metricKeys) {
      if (typeof r[key] === 'number' && Number.isFinite(r[key])) {
        clean[key] = r[key];
        clean.sources[key] = 'Apple 健康导入';
      }
    }
    return clean;
  });
  const profile = { name: '稳步到站', ...pick(state.profile, ['age', 'sex', 'heightCm', 'startingWeightKg',
    'targetWeightKg', 'milestoneKg', 'startDate', 'timeZone', 'calorieTarget']) };
  const health = imported ? {
    schemaVersion: 1, timeZone: 'Asia/Hong_Kong', exportDate: imported.exportDate,
    rawRecordCount: imported.rawRecordCount, workoutCount: imported.workoutCount, daily,
    method: {
      cumulative: '累计指标去重后，按日期选择合计最大的单一来源；不同设备不相加。',
      sleep: '卧床与实际睡眠分开记录；空白表示没有可用记录。',
      energy: '设备热量和体脂为估算；摄入记录可能不完整，不据此判断确定的热量缺口。',
      workouts: '设备运动时段不代表计划训练已经完成。'
    }
  } : null;
  return { schemaVersion: 1, kind: 'public-progress', publishedAt, state: { schemaVersion: 1, revision: 1, profile, records }, health };
}

export async function exportPublic() {
  const state = JSON.parse(await readFile(path.join(root, 'data', 'tracker.json'), 'utf8'));
  let health = null;
  try { health = JSON.parse(await readFile(path.join(root, 'data', 'apple-health.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const next = publicSnapshot(state, health);
  const folder = path.join(root, 'public');
  const file = path.join(folder, 'progress.json');
  try {
    const previous = JSON.parse(await readFile(file, 'utf8'));
    if (JSON.stringify({ ...previous, publishedAt: null }) === JSON.stringify({ ...next, publishedAt: null })) {
      console.log('公开记录没有变化。');
      return previous;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(folder, { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + '\n');
  console.log(`已整理公开快照：${next.state.records.length} 天手动记录，${next.health?.daily.length || 0} 天健康历史。`);
  return next;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await exportPublic();
