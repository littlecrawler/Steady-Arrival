import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { ROOT, createServer } from '../server.mjs';
import { blankState } from './setup.mjs';
import { localDate, shiftDate, validateRecord } from '../dist/domain.js';

const folder = path.join(ROOT, '.runtime', 'demo');
await mkdir(folder, { recursive: true });
const state = blankState();
state.profile.name = '虚构演示 · 稳步到站';
state.profile.isDemo = true;
state.profile.context = '全部是程序生成的虚构演示记录，不代表真实用户、效果或医学建议。';
state.profile.startDate = shiftDate(localDate(), -29);
state.records = Array.from({ length: 30 }, (_, i) => validateRecord({
  date: shiftDate(localDate(), i - 29), weightKg: Math.round((75 - i * .045 + Math.sin(i) * .3) * 10) / 10,
  steps: 4600 + (i * 773 % 5000), sleepHours: Math.round((6.7 + i % 4 * .3) * 10) / 10,
  hunger: 3 + i % 3, energy: 3 + i % 2,
  meals: { dinner: '虚构演示：米饭、豆腐、蔬菜' },
  workoutType: i % 3 === 0 ? 'strength' : '', workoutStatus: i % 3 === 0 ? 'completed' : '',
  workoutMinutes: i % 3 === 0 ? 45 : null,
  notes: '虚构演示数据'
}));
const file = path.join(folder, 'tracker.json');
await writeFile(file, JSON.stringify(state, null, 2));
const server = createServer({ dataFile: file });
server.listen(Number(process.env.PORT || 8766), '127.0.0.1');
await once(server, 'listening');
console.log('虚构数据演示：http://127.0.0.1:' + server.address().port);
