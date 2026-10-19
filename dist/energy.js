// Scenario estimates, not measured energy balance or a weight-loss prediction.
export const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snacks: '零食 / 饮料' };
export const DEFAULT_PAL = [1.4, 1.6];
const keys = Object.keys(MEALS);
const text = value => typeof value === 'string' ? value.trim() : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
function bounded(value, min, max, label) {
  if (typeof value === 'string' && !value.trim() || value === null || value === undefined || !['string', 'number'].includes(typeof value)) throw new Error(label + '请填写数值。');
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(label + '超出范围。');
  return n;
}
function string(value, limit, label) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error(label + '格式不正确。');
  return value.trim();
}
export function foodFingerprint(record) {
  return JSON.stringify([keys.map(k => text(record.meals?.[k])), record.dinnerStatus || '', record.caloriesKcal ?? null]);
}
export function validateCalorieEstimate(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('热量估算格式不正确。');
  const method = raw.method ?? 'model';
  if (!['model', 'device'].includes(method)) throw new Error('请选择有效的消耗计算方式。');
  const palMin = bounded(raw.palMin ?? DEFAULT_PAL[0], 1.2, 2.5, '活动系数下限');
  const palMax = bounded(raw.palMax ?? DEFAULT_PAL[1], 1.2, 2.5, '活动系数上限');
  if (palMin > palMax) throw new Error('活动系数下限不能高于上限。');
  if (raw.complete !== undefined && typeof raw.complete !== 'boolean') throw new Error('吃喝完整性标记不正确。');
  if (raw.meals !== undefined && (!raw.meals || typeof raw.meals !== 'object' || Array.isArray(raw.meals))) throw new Error('每餐估算格式不正确。');
  const meals = {};
  for (const key of keys) {
    const m = raw.meals?.[key];
    if (m === undefined || m === null) continue;
    if (typeof m !== 'object' || Array.isArray(m)) throw new Error(MEALS[key] + '估算格式不正确。');
    const minKcal = bounded(m.minKcal, 0, 12000, MEALS[key] + '热量下限');
    const maxKcal = bounded(m.maxKcal, 0, 12000, MEALS[key] + '热量上限');
    if (minKcal > maxKcal) throw new Error(MEALS[key] + '热量下限不能高于上限。');
    if (!['assistant', 'manual'].includes(m.source)) throw new Error(MEALS[key] + '估算来源不正确。');
    meals[key] = { minKcal, maxKcal, basedOn: string(m.basedOn, 2000, '饮食依据'), note: string(m.note, 600, '份量假设'), source: m.source };
  }
  return { version: 1, method, palMin, palMax, meals, complete: raw.complete === true,
    completeFor: string(raw.completeFor, 10000, '吃喝完整性依据') };
}
export function estimateFromForm(record, values, previous) {
  const meals = {};
  for (const key of keys) {
    const min = values['energy-min-' + key], max = values['energy-max-' + key];
    if ((min === '' || min === undefined) && (max === '' || max === undefined)) continue;
    const old = previous?.meals?.[key];
    const basedOn = values['energy-food-' + key] ?? '';
    const note = values['energy-note-' + key] ?? '';
    const same = old && Number(min) === old.minKcal && Number(max) === old.maxKcal && basedOn === old.basedOn && text(note) === old.note;
    meals[key] = { minKcal: min, maxKcal: max, basedOn, note, source: same ? old.source : 'manual' };
  }
  return validateCalorieEstimate({ method: values['energy-method'] || 'model',
    palMin: values['energy-pal-min'] ?? DEFAULT_PAL[0], palMax: values['energy-pal-max'] ?? DEFAULT_PAL[1], meals,
    complete: values['energy-complete'] === 'on', completeFor: values['energy-complete'] === 'on' ? foodFingerprint(record) : '' });
}
export function intakeEstimate(record) {
  const estimate = record.calorieEstimate;
  const confirmed = !!estimate?.complete && estimate.completeFor === foodFingerprint(record);
  const staleConfirmation = !!estimate?.complete && !confirmed;
  const rows = keys.map(key => {
    const food = text(record.meals?.[key]);
    const m = estimate?.meals?.[key];
    const valid = !!food && m?.basedOn === food;
    if (key === 'dinner' && record.dinnerStatus === 'skipped' && (!valid || m.maxKcal === 0)) {
      return { key, label: MEALS[key], food: food || '已记录未吃晚餐', range: { min: 0, max: 0 }, note: '按本人记录未吃晚餐计为 0', source: 'record' };
    }
    if (valid) return { key, label: MEALS[key], food, range: { min: m.minKcal, max: m.maxKcal }, note: m.note, source: m.source };
    if (key === 'snacks' && !food && confirmed) return { key, label: MEALS[key], food: '已确认没有额外吃喝', range: { min: 0, max: 0 }, source: 'record', note: '' };
    return { key, label: MEALS[key], food, range: null, stale: !!m, note: m ? '饮食内容已改变，旧估算不再计入' : food ? '等待补充份量估算' : '尚未确认', source: '' };
  });
  // Imported dietary samples and the profile calorie target are never a full-day intake.
  const manual = finite(record.caloriesKcal);
  const known = rows.filter(r => r.range);
  const range = manual ? { min: record.caloriesKcal, max: record.caloriesKcal } : known.length ? {
    min: known.reduce((s, r) => s + r.range.min, 0), max: known.reduce((s, r) => s + r.range.max, 0)
  } : null;
  const missing = manual ? [] : rows.filter(r => !r.range).map(r => r.label + (r.food ? '待估算' : '未确认'));
  if (!confirmed && !missing.includes('零食 / 饮料未确认')) missing.push('全天吃喝是否记全未确认');
  const complete = confirmed && missing.length === 0 && !!range;
  const canCondition = manual || rows.every(r => r.range || r.key === 'snacks' && !r.food);
  return { range, rows, confirmed, staleConfirmation, complete, missing, manual, canCondition };
}
function daysBetween(from, to) { return (new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000; }
export function weightForDate(records, profile, date) {
  const candidates = records.filter(r => r.date <= date && finite(r.weightKg) && r.weightKg >= 25 && r.weightKg <= 400 && daysBetween(r.date, date) <= 30);
  const last = [...candidates].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (last) return { value: last.weightKg, date: last.date, source: ['对话记录', '手动记录'].includes(last.sources?.weightKg) ? last.sources.weightKg : last.source === 'chat' ? '对话记录' : last.manual ? '手动记录' : '健康记录' };
  if (profile.startDate <= date && daysBetween(profile.startDate, date) <= 30 && finite(profile.startingWeightKg)) {
    return { value: profile.startingWeightKg, date: profile.startDate, source: '阶段起始体重（备用）' };
  }
  return null;
}
export function restingEnergy(profile, weightKg) {
  if (!['male', 'female'].includes(profile.sex) || !finite(profile.age) || profile.age < 18 || profile.age > 100 || !finite(profile.heightCm) || profile.heightCm < 100 || profile.heightCm > 230 || !finite(weightKg) || weightKg < 25 || weightKg > 400) return null;
  return 10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age + (profile.sex === 'male' ? 5 : -161);
}
export function exportCalendarDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/, '$1T$2$3:$4');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime()) || !/(?:Z|[+-]\d\d:?\d\d)$/.test(normalized)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function expenditureEstimate(record, profile, records, health) {
  const estimate = record.calorieEstimate;
  const method = estimate?.method || 'model';
  const weight = weightForDate(records, profile, record.date);
  const resting = weight ? restingEnergy(profile, weight.value) : null;
  const pal = [estimate?.palMin ?? DEFAULT_PAL[0], estimate?.palMax ?? DEFAULT_PAL[1]];
  const exported = exportCalendarDate(health?.exportDate);
  const day = health?.daily?.find(r => r.date === record.date);
  const deviceReason = !exported ? '没有可用的健康导出时间。' : record.date >= exported ? '导出当天或之后的设备数据可能只有部分时段，不能作为全天消耗。' : !finite(day?.restingKcal) || day.restingKcal <= 0 || !finite(day?.activeKcal) || day.activeKcal < 0 ? '缺少当天的基础或活动热量汇总。' : '';
  const device = { range: deviceReason ? null : { min: day.restingKcal + day.activeKcal, max: day.restingKcal + day.activeKcal }, reason: deviceReason };
  if (method === 'device') return { method, range: device.range, reason: device.reason, weight, resting, pal, device };
  return { method, range: resting === null ? null : { min: resting * pal[0], max: resting * pal[1] },
    reason: !weight ? '需要当天或此前30天内的体重，不能用未来体重或目标体重代替。' : resting === null ? '请补全成人年龄、身高和公式使用的性别设置。' : '', weight, resting, pal, device };
}
export function calculateEnergy({ record, profile, records = [], health = null }) {
  const intake = intakeEstimate(record);
  const expenditure = expenditureEstimate(record, profile, records, health);
  const difference = intake.range && expenditure.range ? {
    min: expenditure.range.min - intake.range.max, max: expenditure.range.max - intake.range.min
  } : null;
  return { intake, expenditure, deficit: intake.complete ? difference : null,
    conditional: !intake.complete && intake.canCondition ? difference : null };
}
