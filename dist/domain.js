export const TIME_ZONE = 'Asia/Hong_Kong';
export const APP_ID = 'steady-arrival';
export const NUMBER_FIELDS = {
  weightKg: [25, 400], waistCm: [30, 250], bodyFatPct: [2, 70],
  caloriesKcal: [0, 12000], proteinG: [0, 600], steps: [0, 100000],
  sleepHours: [0, 24], hunger: [0, 10], energy: [1, 5], stress: [0, 10],
  workoutMinutes: [0, 600]
};
export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snacks'];
export const WORKOUT_TYPES = ['', 'strength', 'cardio', 'walk', 'other', 'rest'];
export const WORKOUT_STATUSES = ['', 'completed', 'partial', 'skipped', 'rest'];
export const WEIGHT_CONTEXTS = ['', 'morning', 'other', 'reported'];
export const DINNER_STATUSES = ['', 'ate', 'skipped', 'not_yet'];

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function shiftDate(value, days) {
  const d = new Date(value + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekday(value) {
  return new Date(value + 'T12:00:00Z').getUTCDay();
}
export function weekStart(value) {
  return shiftDate(value, -((weekday(value) + 6) % 7));
}
export function numberOrNull(value) {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return null;
  if (!['number', 'string'].includes(typeof value)) return NaN;
  return Number(value);
}
export function mergeHealthRecords(manual, health = []) {
  const map = new Map(health.map(day => [day.date, { ...day, meals: {}, sources: { ...(day.sources || {}) }, imported: true }]));
  for (const row of manual) {
    const combined = map.get(row.date) || { date: row.date, sources: {} };
    for (const [key, value] of Object.entries(row)) {
      if (key === 'date' || value !== null && value !== undefined && value !== '') {
        combined[key] = value;
        if (key in NUMBER_FIELDS && value !== null) combined.sources[key] = row.source === 'chat' ? '对话记录' : '手动记录';
      }
    }
    combined.manual = true;
    map.set(row.date, combined);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function textValue(value, limit = 2000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error('文字内容过长或格式不正确。');
  return value.trim();
}
function enumValue(value, choices, label) {
  const result = value ?? '';
  if (!choices.includes(result)) throw new Error(label + '选项不正确。');
  return result;
}
export function validateRecord(raw, today = localDate(), { allowFuture = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('记录格式不正确。');
  if (!isDate(raw.date) || raw.date < '2000-01-01') throw new Error('请选择有效日期。');
  if (!allowFuture && raw.date > today) throw new Error('未来日期可以查看计划，实际记录请在当天填写。');
  const clean = { date: raw.date };
  for (const [key, range] of Object.entries(NUMBER_FIELDS)) {
    const n = numberOrNull(raw[key]);
    if (n !== null && (!Number.isFinite(n) || n < range[0] || n > range[1])) {
      throw new Error('数值超出可记录范围：' + key);
    }
    if (key === 'steps' && n !== null && !Number.isInteger(n)) throw new Error('步数请填写整数。');
    clean[key] = n;
  }
  clean.meals = {};
  for (const key of MEAL_KEYS) clean.meals[key] = textValue(raw.meals?.[key]);
  clean.workoutType = enumValue(raw.workoutType, WORKOUT_TYPES, '训练类型');
  clean.workoutStatus = enumValue(raw.workoutStatus, WORKOUT_STATUSES, '训练状态');
  clean.weightContext = enumValue(raw.weightContext, WEIGHT_CONTEXTS, '称重条件');
  clean.dinnerStatus = enumValue(raw.dinnerStatus, DINNER_STATUSES, '晚餐状态');
  clean.notes = textValue(raw.notes, 4000);
  clean.exerciseNotes = textValue(raw.exerciseNotes, 2000);
  clean.source = raw.source === 'chat' ? 'chat' : 'manual';
  return clean;
}
export function validateProfile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('个人设置格式不正确。');
  const p = { ...raw };
  for (const [key, min, max] of [
    ['age', 18, 100], ['heightCm', 100, 230], ['startingWeightKg', 25, 400],
    ['targetWeightKg', 25, 400], ['milestoneKg', 25, 400]
  ]) {
    p[key] = Number(raw[key]);
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new Error('个人设置数值不正确：' + key);
  }
  if (p.targetWeightKg < 18.5 * (p.heightCm / 100) ** 2) throw new Error('此应用不设置低于成人 BMI 18.5 的减重目标。');
  if (p.targetWeightKg > p.startingWeightKg || p.milestoneKg < p.targetWeightKg || p.milestoneKg > p.startingWeightKg) {
    throw new Error('阶段目标应在起始体重与长期目标之间。');
  }
  p.name = textValue(raw.name || '稳步到站', 40);
  p.sex = enumValue(raw.sex, ['male', 'female', 'unspecified'], '性别');
  if (!isDate(raw.startDate)) throw new Error('开始日期不正确。');
  p.timeZone = TIME_ZONE;
  p.calorieTarget = numberOrNull(raw.calorieTarget);
  if (p.calorieTarget !== null && (!Number.isFinite(p.calorieTarget) || p.calorieTarget < 1500 || p.calorieTarget > 5000)) {
    throw new Error('请填写 1500–5000 kcal 的参考值，或留空。需要更低摄入时请由专业人员评估。');
  }
  return p;
}
export function mean(values) {
  const present = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}
export function inRange(records, from, to) {
  return records.filter(r => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}
export function rollingAverage(records, date, key = 'weightKg', minimum = 3) {
  const samples = inRange(records, shiftDate(date, -6), date).filter(r => r[key] !== null && r[key] !== undefined);
  return { count: samples.length, value: samples.length >= minimum ? mean(samples.map(r => r[key])) : null };
}
export function summarize(records, profile, today = localDate()) {
  const available = inRange(records, '2000-01-01', today);
  const lastWith = key => [...available].reverse().find(r => r[key] !== null && r[key] !== undefined);
  const latest = lastWith('weightKg');
  const waist = lastWith('waistCm');
  const current = rollingAverage(available, today);
  const previous = rollingAverage(available, shiftDate(today, -7));
  const week = inRange(available, weekStart(today), today);
  const completed = week.filter(r => r.workoutStatus === 'completed' && ['strength', 'cardio'].includes(r.workoutType));
  const last7 = inRange(available, shiftDate(today, -6), today);
  return {
    latest, waist, current, previous,
    change: current.value !== null && previous.value !== null ? current.value - previous.value : null,
    weightChange: latest ? latest.weightKg - profile.startingWeightKg : null,
    completed: completed.length,
    workoutRecorded: week.filter(r => !!r.workoutStatus || r.workoutMinutes !== null && r.workoutMinutes !== undefined).length,
    minutes: week.reduce((sum, r) => sum + (r.workoutMinutes || 0), 0),
    avgSleep: mean(last7.map(r => r.sleepHours)),
    avgHunger: mean(last7.map(r => r.hunger)),
    avgCalories: mean(last7.map(r => r.caloriesKcal)),
    mealDays: last7.filter(r => MEAL_KEYS.some(k => r.meals?.[k])).length,
    recordedDays: last7.length,
    progress: latest ? Math.max(0, Math.min(1, (profile.startingWeightKg - latest.weightKg) / (profile.startingWeightKg - profile.milestoneKg || 1))) : 0
  };
}
export const EXERCISES = [
  { name: '腿举机', english: 'Leg press', sets: 3, reps: '10次', cue: '双脚踩踏板，缓慢蹬出；回程保持骨盆贴靠垫。', link: 'https://www.mayoclinic.org/healthy-lifestyle/fitness/multimedia/leg-press/vid-20084684' },
  { name: '坐姿推胸', english: 'Chest press', sets: 3, reps: '10次', cue: '调整座椅，让把手大致在胸部高度；平稳向前推。' },
  { name: '坐姿划船', english: 'Seated row', sets: 3, reps: '10次', cue: '身体保持稳定，手肘往后拉，不用腰来回甩动。' },
  { name: '腿弯举机', english: 'Leg curl', sets: 3, reps: '10次', cue: '固定大腿，弯曲膝盖收回脚跟，练大腿后侧。', link: 'https://www.mayoclinic.org/healthy-lifestyle/fitness/multimedia/seated-hamstring-curl/vid-20084685' },
  { name: '死虫式', english: 'Dead bug', sets: 3, reps: '每侧6次', cue: '仰卧交替伸展对侧手脚，腰部不拱起；幅度以可控制为准。', link: 'https://www.nasm.org/resource-center/exercise-library/dead-bug' }
];
export function planForDate(date) {
  const d = weekday(date);
  if (d === 1 || d === 4) return { type: 'strength', title: '全身力量', duration: '45–60 分钟', minutes: 50, tag: '力量日', description: '热身5–8分钟，再依次完成5个动作。每组结束留3–4次余力，组间休息90–120秒。', optional: false };
  if (d === 2 || d === 6) return { type: 'cardio', title: '健身单车', duration: '30 分钟', minutes: 30, tag: '有氧日', description: '轻松5分钟 → 稍喘但能说完整句子20分钟 → 轻松5分钟。吃力时中段缩至10分钟。', optional: false };
  if (d === 0) return { type: 'walk', title: '轻松活动，或休息', duration: '可选 20 分钟', minutes: 20, tag: '弹性日', description: '选择轻松散步或单车。想骑车就轻松5分钟、舒适节奏10分钟、轻松5分钟。', optional: true };
  return { type: 'rest', title: '恢复日', duration: '正常日常活动', minutes: 0, tag: '休息日', description: '今天安排恢复，保持正常吃饭与日常活动。漏过一次训练也不用加倍补课。', optional: false };
}
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function recordsCSV(records) {
  const columns = [
    ['日期', 'date'], ['体重kg', 'weightKg'], ['称重条件', 'weightContext'], ['腰围cm', 'waistCm'],
    ['体脂率_设备读数%', 'bodyFatPct'], ['摄入估算kcal', 'caloriesKcal'], ['蛋白质估算g', 'proteinG'],
    ['步数', 'steps'], ['睡眠小时', 'sleepHours'], ['睡前饥饿0至10', 'hunger'], ['精力1至5', 'energy'],
    ['压力0至10', 'stress'], ['训练类型', 'workoutType'], ['完成情况', 'workoutStatus'],
    ['训练分钟', 'workoutMinutes'], ['晚餐状态', 'dinnerStatus'],
    ['早餐', 'breakfast'], ['午餐', 'lunch'], ['晚餐', 'dinner'], ['零食饮料', 'snacks'],
    ['训练重量与备注', 'exerciseNotes'], ['备注', 'notes']
  ];
  columns.push(['设备活动热量估算kcal', 'activeKcal'], ['设备基础热量估算kcal', 'restingKcal'],
    ['步行跑步公里', 'distanceKm'], ['卧床小时_不等于睡眠', 'inBedHours'],
    ['设备运动时段分钟', 'deviceWorkoutMinutes'], ['数据来源', 'dataSources']);
  return '\uFEFF' + [columns.map(c => csvCell(c[0])).join(','),
    ...[...records].sort((a, b) => a.date.localeCompare(b.date)).map(r => columns.map(c =>
      csvCell(c[1] === 'dataSources' ? JSON.stringify(r.sources || {}) : MEAL_KEYS.includes(c[1]) ? r.meals?.[c[1]] : r[c[1]])).join(','))
  ].join('\r\n');
}
