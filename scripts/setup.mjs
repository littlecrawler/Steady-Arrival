import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDate } from '../dist/domain.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function blankState() {
  return {
    schemaVersion: 1, revision: 1,
    profile: {
      name: '稳步到站', age: 30, sex: 'unspecified', heightCm: 170,
      startingWeightKg: 75, targetWeightKg: 68, milestoneKg: 72,
      startDate: localDate(), timeZone: 'Asia/Hong_Kong', calorieTarget: null,
      context: '首次使用请在「计划与目标」填写个人设置。默认设置是占位值，不是实际健康记录。'
    },
    records: []
  };
}
export async function ensureData() {
  const folder = path.join(root, 'data');
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(path.join(folder, 'tracker.json'), JSON.stringify(blankState(), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await ensureData();
