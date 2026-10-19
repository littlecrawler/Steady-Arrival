import { renderTrend } from './charts.js';
import { estimateFromForm, intakeEstimate } from './energy.js';
import { renderEnergyPanel, renderEnergyResults, renderEnergyBasis, kcalRange } from './energy-ui.js';
import {
  localDate, isDate, displaySource, shiftDate, weekday, weekStart, escapeHTML as esc, mean,
  summarize, mergeHealthRecords, planForDate, EXERCISES, NUMBER_FIELDS, validateRecord, recordsCSV
} from './domain.js';

const $ = selector => document.querySelector(selector);
const main = $('#main');
const publicMode = document.documentElement.dataset.mode === 'public';
let publishedAt = '';
let today = localDate();
let state, health, records = [], view = 'overview', selectedDate = today, dirty = false, busy = false;
let chartKey = 'weightKg', chartDays = 90, query = '', fromDate = '', toDate = '';
let historyPage = 1;
let toastTimer;
const titles = { overview: '今日总览', record: '每日记录', history: '历史与趋势', plan: '计划与目标', vision: '薄肌理论与海报' };
const metrics = {
  weightKg: ['体重', 'kg', 1], waistCm: ['腰围', 'cm', 1], bodyFatPct: ['体脂率 · 设备估算', '%', 1],
  steps: ['步数 · 单来源汇总', '步', 0], distanceKm: ['步行与跑步距离', 'km', 2],
  caloriesKcal: ['饮食摄入 · 已记录部分', 'kcal', 0], proteinG: ['蛋白质 · 已记录部分', 'g', 0],
  activeKcal: ['活动热量 · 设备估算', 'kcal', 0], restingKcal: ['基础热量 · 设备估算', 'kcal', 0],
  sleepHours: ['睡眠', '小时', 1], inBedHours: ['卧床 · 不等于睡眠', '小时', 1],
  deviceWorkoutMinutes: ['设备运动时段', '分钟', 0], hunger: ['睡前饥饿感', '/10', 0],
  energy: ['精力', '/5', 0], stress: ['压力', '/10', 0],
  leanMassKg: ['去脂体重 · 设备估算', 'kg', 1], deviceBMI: ['BMI · 设备记录', '', 1],
  flights: ['爬楼层数', '层', 0], carbsG: ['碳水 · 已记录部分', 'g', 0],
  fatG: ['脂肪摄入 · 已记录部分', 'g', 0], waterMl: ['饮水 · 已记录部分', 'mL', 0],
  restingHeartRate: ['静息心率 · 设备记录', '次/分', 0], hrvMs: ['心率变异性 · 设备记录', 'ms', 1]
};
const typeLabels = { strength: '力量', cardio: '有氧', walk: '散步', other: '其他', rest: '休息' };
const statusLabels = { completed: '已完成', partial: '完成一部分', skipped: '未练', rest: '休息' };
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/>',
  chart: '<path d="M3 3v18h18M6 16l5-6 4 3 6-8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  weight: '<rect x="4" y="4" width="16" height="17" rx="4"/><path d="M8 8a6 6 0 0 1 8 0m-4-1 2 3"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  leaf: '<path d="M20 4C8 2 1 9 6 17s16-1 14-13ZM5 21 16 10"/>',
  heart: '<path d="M12 21 3 12C-2 5 7-1 12 6c5-7 14-1 9 6Z"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.activity) + '</svg>';
const number = (value, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const shortDate = date => date.slice(5).replace('-', '/');
const dateLabel = date => new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(date + 'T12:00:00Z'));
const button = (label, action, classes = '', extra = '') => '<button type="button" class="button ' + classes + '" data-action="' + action + '" ' + extra + '>' + label + '</button>';
const heading = (eyebrow, title, subtitle, actions = '') => '<div class="page-heading"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p class="subtitle">' + subtitle + '</p></div><div class="actions">' + actions + '</div></div>';
const panel = (title, subtitle, content, action = '', classes = '') => '<section class="panel ' + classes + '"><div class="panel-header"><div><h2>' + title + '</h2>' + (subtitle ? '<p>' + subtitle + '</p>' : '') + '</div>' + action + '</div><div class="panel-body">' + content + '</div></section>';
const rowFor = date => records.find(r => r.date === date);
const latestFor = key => [...records].reverse().find(r => typeof r[key] === 'number' && r.date <= today);

async function api(path, options = {}) {
  if (publicMode) throw new Error('这是公开展示页，记录由本人在本地应用维护。');
  const response = await fetch(path, { cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || '读取失败，请稍后重试。');
    error.status = response.status;
    throw error;
  }
  return result;
}
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = 'toast visible' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function setDirty(value) {
  dirty = value;
  $('#save-status').textContent = publicMode ? '公开快照 · 只读' : value ? '有尚未保存的修改' : '本地记录已同步';
}
function merge() { records = mergeHealthRecords(state.records, health?.daily || []); }
async function load() {
  const previousToday = today;
  today = localDate();
  if (selectedDate === previousToday && !dirty) selectedDate = today;
  if (publicMode) {
    const response = await fetch('./progress.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('公开记录暂时未能读取，请稍后刷新。');
    const snapshot = await response.json();
    if (snapshot.kind !== 'public-progress' || !Array.isArray(snapshot.state?.records)) throw new Error('公开记录格式不正确。');
    ({ state, health, publishedAt } = snapshot);
  } else {
    [state, health] = await Promise.all([api('/api/state'), api('/api/health-data')]);
  }
  merge();
  setDirty(false);
}
function dialog(title, content, confirmLabel = '确定', danger = false) {
  const el = $('#confirm-dialog');
  el.returnValue = '';
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = content;
  $('#dialog-actions').innerHTML = '<button value="cancel" class="button">取消</button><button value="confirm" class="button ' + (danger ? 'danger' : 'primary') + '">' + esc(confirmLabel) + '</button>';
  return new Promise(resolve => {
    el.addEventListener('close', () => resolve(el.returnValue === 'confirm'), { once: true });
    el.showModal();
  });
}
async function leaveDirty() {
  return !dirty || await dialog('离开前还没有保存', '<p>这页有尚未保存的修改。离开会丢弃本次编辑，已经保存的记录会保留。</p>', '丢弃本次编辑');
}
async function navigate(next, date) {
  if (!titles[next] || !await leaveDirty()) return;
  if (date) selectedDate = date;
  view = next;
  history.replaceState(null, '', '#' + view);
  setDirty(false);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  main.focus({ preventScroll: true });
}
function ranges() {
  return '<div class="segmented" aria-label="图表时间范围">' + [[7, '7天'], [30, '30天'], [90, '90天'], [0, '全部']].map(([n, label]) =>
    '<button type="button" data-action="range" data-days="' + n + '" class="' + (chartDays === n ? 'active' : '') + '" aria-pressed="' + (chartDays === n) + '">' + label + '</button>').join('') + '</div>';
}
function chart(key = 'weightKg') {
  const [label, unit, digits] = metrics[key];
  return renderTrend(records, key, { label, unit, digits, days: chartDays, today });
}
function metricCard(label, value, unit, foot, name) {
  return '<article class="metric"><div class="metric-top"><span>' + label + '</span><span class="metric-icon">' + icon(name) + '</span></div><div class="metric-value">' + value + '<small>' + unit + '</small></div><div class="metric-foot">' + foot + '</div></article>';
}
function taskPanel() {
  const plan = planForDate(today), row = rowFor(today);
  const weighDay = [1, 3, 6].includes(weekday(today));
  const items = [
    { title: '正常吃晚餐', text: '蛋白质 + 蔬菜 + 主食，吃到舒服的饱足感。', done: row?.dinnerStatus === 'ate' },
    { title: plan.title, text: plan.duration + '。' + plan.description, done: ['completed', 'rest'].includes(row?.workoutStatus) },
    { title: weighDay ? '晨起记录体重' : '睡前花1分钟记录', text: weighDay ? '起床如厕后、进食前，尽量保持相同条件。' : '记下吃了什么、饥饿和精力；有缺项也能保存。', done: weighDay ? !!state.records.find(r => r.date === today && r.weightKg !== null) : !!state.records.find(r => r.date === today && r.hunger !== null) }
  ];
  return '<section class="task-card"><div class="task-title"><span class="symbol">' + icon('leaf') + '</span><div><div class="eyebrow">ONE DAY AT A TIME</div><h2>今天的三件事</h2></div></div><p class="task-description">先完成今天，再根据记录调整。</p><div class="task-list">' +
    items.map(item => '<div class="task-item ' + (item.done ? 'done' : '') + '"><span>' + (item.done ? icon('check') : '') + '</span><div><strong>' + item.title + '</strong><p>' + item.text + '</p></div></div>').join('') +
    '</div>' + button((publicMode ? '查看今天 ' : '记录今天 ') + icon('arrow'), 'today', 'primary') + '</section>';
}
function energyOptions(record, temporaryRecords = records) {
  return { record, profile: state.profile, records: temporaryRecords, health };
}
function recentEnergyPanel() {
  const record = [...state.records].sort((a, b) => b.date.localeCompare(a.date)).find(r => r.date <= today && (Object.values(r.meals || {}).some(Boolean) || typeof r.caloriesKcal === 'number'));
  return record ? renderEnergyPanel(energyOptions(record), { compact: true }) : '';
}
function overview() {
  const s = summarize(records, state.profile, today), p = state.profile;
  const latestSteps = latestFor('steps'), current = rowFor(today);
  const meanText = s.current.value === null ? '近7天有' + s.current.count + '天称重，满3天显示均值' : '近7天均值 ' + number(s.current.value) + ' kg';
  const recentDays = Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 6));
  const stepsMax = Math.max(1000, ...recentDays.map(d => rowFor(d)?.steps || 0));
  const bars = recentDays.map(d => {
    const v = rowFor(d)?.steps, present = typeof v === 'number';
    return '<div class="bar-col ' + (d === today ? 'today' : '') + '"><div class="bar-value">' + (present ? number(v, 0) : '—') + '</div><div class="bar-area"><div class="bar ' + (present ? '' : 'empty') + '" style="height:' + (present ? Math.max(2, v / stepsMax * 95) : 4) + '%"></div></div><small>' + (d === today ? '今天' : shortDate(d)) + '</small></div>';
  }).join('');
  const calendar = Array.from({ length: 28 }, (_, i) => shiftDate(today, i - 27)).map(d => {
    const r = state.records.find(r => r.date === d), has = !!r;
    return '<button class="calendar-day ' + (has ? 'filled ' : '') + (d === today ? 'today' : '') + '" data-action="edit-date" data-date="' + d + '" aria-label="' + d + (has ? ' 有手动记录' : ' 尚无手动记录') + '" title="' + d + '">' + Number(d.slice(-2)) + '</button>';
  }).join('');
  return heading(dateLabel(today) + (publicMode ? ' · 公开成长记录' : ' · 我的日常'), publicMode ? '让行动，留下记录。' : '把今天，记录清楚。', '体重、饮食、活动与恢复，放在同一个地方。', button(icon('plus') + (publicMode ? ' 查看记录' : ' 添加记录'), 'today', 'primary')) +
    '<section class="hero"><div><div class="eyebrow">稳步前进</div><h2>下一站，' + number(p.milestoneKg) + ' kg</h2><p>长期目标 ' + number(p.targetWeightKg) + ' kg · 根据趋势调整节奏</p></div><div class="hero-progress"><div class="progress-meta"><span>阶段进度</span><strong>' + Math.round(s.progress * 100) + '%</strong></div><div class="progress-track"><span style="width:' + Math.round(s.progress * 100) + '%"></span></div><div class="progress-ends"><span>起点 ' + number(p.startingWeightKg) + '</span><span>阶段目标 ' + number(p.milestoneKg) + '</span></div></div></section>' +
    '<div class="metrics">' +
    metricCard('最新体重', number(s.latest?.weightKg), 'kg', (s.latest ? s.latest.date + ' · ' : '') + meanText, 'weight') +
    metricCard('最近记录的步数', number(latestSteps?.steps, 0), '步', latestSteps ? latestSteps.date + ' · ' + (['手动记录', '对话记录'].includes(latestSteps.sources?.steps) ? latestSteps.sources.steps : latestSteps.date >= (health?.exportDate?.slice(0, 10) || today) ? '截至导出时，可能未完整' : '当日单来源汇总') : '连接健康导出，或手动填写', 'activity') +
    metricCard('近7天睡眠', number(s.avgSleep), '小时', s.avgSleep === null ? '暂无睡眠记录；卧床不等于睡眠' : '只平均有记录的日期', 'moon') +
    metricCard('本周计划训练', s.workoutRecorded ? number(s.completed, 0) : '—', '次', '按手动完成记录统计 · 计划每周4次', 'calendar') +
    '</div>' + recentEnergyPanel() + '<div class="grid-main">' +
    panel('体重的变化', '看一段时间的走向', '<div class="chart-legend"><span><i class="legend-dot"></i>实际体重记录</span></div>' + chart('weightKg'), ranges()) + taskPanel() +
    '</div><div class="grid-bottom">' +
    panel('最近一周的活动', '步数 · 单来源汇总；导出当天可能不完整，空白表示没有记录', '<div class="habit-bars">' + bars + '</div>') +
    panel('给记录留一点位置', '近28天 · 实心日期代表有手动记录', '<div class="calendar-grid">' + calendar + '</div><div class="support-line">' + icon('heart') + '<span><strong>空白可以留着。</strong>从下一条记录继续。</span></div>') + '</div>' +
    (health ? '<div class="notice"><strong>Apple 健康已连接</strong><p>导出时间 ' + esc(health.exportDate || '') + ' · ' + number(health.rawRecordCount, 0) + ' 条原始样本 · ' + number(health.daily.length, 0) + ' 个有数据的日期。它是导出文件的快照，后续数据需要重新导入。</p></div>' : '');
}

function input(name, label, unit, value, options = {}) {
  const range = NUMBER_FIELDS[name];
  const step = options.step || (['steps', 'hunger', 'energy', 'stress', 'caloriesKcal'].includes(name) ? '1' : ['weightKg', 'bodyFatPct'].includes(name) ? '0.01' : '0.1');
  const imported = rowFor(selectedDate);
  const hint = value === null || value === undefined || value === '' ? imported?.imported && typeof imported[name] === 'number' ? '已导入 ' + number(imported[name], 1) + ' ' + unit + '，留空会保留导入值' : '' : '';
  return '<div class="field"><label for="' + name + '">' + label + '</label><div class="input-unit"><input id="' + name + '" name="' + name + '" type="number" inputmode="decimal" step="' + step + '" value="' + esc(value ?? '') + '" ' + (range ? 'min="' + range[0] + '" max="' + range[1] + '"' : options.attrs || '') + ' placeholder="未记录"><span class="unit">' + unit + '</span></div>' + (hint ? '<small class="hint">' + hint + '</small>' : '') + '</div>';
}
function select(name, label, value, choices) {
  return '<div class="field"><label for="' + name + '">' + label + '</label><select id="' + name + '" name="' + name + '">' + choices.map(([v, t]) => '<option value="' + v + '" ' + (value === v ? 'selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
}
function section(step, title, description, content, wide = false) {
  return '<section class="form-section ' + (wide ? 'wide' : '') + '"><div class="section-heading"><span class="step">' + step + '</span><div><h2>' + title + '</h2><p>' + description + '</p></div></div>' + content + '</section>';
}
function recordView() {
  if (publicMode) return publicRecordView();
  const saved = state.records.find(r => r.date === selectedDate);
  const r = saved || { meals: {} }, plan = planForDate(selectedDate);
  const imported = health?.daily.find(d => d.date === selectedDate);
  const dateToolbar = '<div class="form-toolbar"><label class="date-control" for="record-date">记录日期 <input id="record-date" type="date" value="' + selectedDate + '" min="2000-01-01" max="' + today + '"></label><span class="tag ' + (saved ? 'green' : '') + '">' + (saved ? '已有手动记录 · 可以修改' : '新增手动记录') + '</span></div>';
  const measurement = '<div class="fields">' + input('weightKg', '体重', 'kg', r.weightKg) + select('weightContext', '称重条件', r.weightContext || '', [['', '未记录'], ['morning', '晨起如厕后、进食前'], ['other', '其他时间'], ['reported', '此前报告，条件未确认']]) + input('waistCm', '腰围（可选）', 'cm', r.waistCm) + input('bodyFatPct', '体脂率（设备读数，可选）', '%', r.bodyFatPct) + '</div><p class="hint">体脂率来自设备估算，应用不会根据体重或 BMI 推算体脂。</p>';
  const recovery = '<div class="fields">' + input('sleepHours', '实际睡眠', '小时', r.sleepHours) + input('hunger', '睡前饥饿感', '/10', r.hunger) + input('energy', '白天精力', '/5', r.energy) + input('stress', '压力感受', '/10', r.stress) + '</div><p class="hint">饥饿：0 不饿，10 难以忍受。精力：1 很疲惫，5 充沛。</p>';
  const meals = '<div class="fields">' + [['breakfast', '早餐'], ['lunch', '午餐'], ['dinner', '晚餐'], ['snacks', '零食 / 饮料']].map(([key, label]) =>
    '<div class="field"><label for="meal-' + key + '">' + label + '</label><textarea id="meal-' + key + '" name="meal-' + key + '" maxlength="2000" rows="2" placeholder="大概吃了什么、多少即可">' + esc(r.meals?.[key]) + '</textarea></div>').join('') +
    select('dinnerStatus', '晚餐情况', r.dinnerStatus || '', [['', '未记录'], ['ate', '吃了晚餐'], ['not_yet', '还没到晚餐时间'], ['skipped', '没有吃']]) + '</div><details class="more-fields"><summary>可选：记录摄入估算</summary><div class="fields">' + input('caloriesKcal', '全天摄入估算', 'kcal', r.caloriesKcal) + input('proteinG', '蛋白质估算', 'g', r.proteinG) + '</div><p class="hint">不知道就留空。只记录了一部分时，在备注中说明，不据此判断全天热量缺口。</p></details>';
  const training = '<div class="training-inline"><span class="tag green">' + plan.tag + '</span><strong>' + plan.title + ' · ' + plan.duration + '</strong><p>' + plan.description + '</p></div><div class="fields">' +
    select('workoutType', '实际活动', r.workoutType || '', [['', '尚未记录'], ['strength', '力量训练'], ['cardio', '有氧训练'], ['walk', '散步'], ['other', '其他'], ['rest', '休息']]) +
    select('workoutStatus', '实际完成情况', r.workoutStatus || '', [['', '尚未记录'], ['completed', '已完成'], ['partial', '完成一部分'], ['skipped', '今天未练'], ['rest', '休息']]) +
    input('workoutMinutes', '实际训练时长', '分钟', r.workoutMinutes) + input('steps', '全天步数（可选）', '步', r.steps) +
    '<div class="field full"><label for="exerciseNotes">动作 / 重量 / 感受</label><textarea id="exerciseNotes" name="exerciseNotes" maxlength="2000" rows="3" placeholder="例如：腿举 40 kg，3组×10次，感觉还留有余力">' + esc(r.exerciseNotes) + '</textarea></div></div>';
  return heading('DAILY LOG', '给今天留一条记录。', '填你知道的部分就好。保存后仍可随时修改。') +
    dateToolbar + (imported ? '<div class="notice"><strong>这一天已有 Apple 健康数据</strong><p>' + Object.keys(metrics).filter(k => typeof imported[k] === 'number').map(k => esc(metrics[k][0]) + ' ' + number(imported[k], metrics[k][2]) + ' ' + metrics[k][1]).join(' · ') + '</p><p>下方留空会继续使用导入数据；填写的数值优先显示，原始导入值会保留。</p></div>' : '') +
    '<form id="record-form"><div class="form-grid">' + section('01', '身体记录', '尽量保持一致的测量条件', measurement) + section('02', '睡眠与感受', '恢复也是计划的一部分', recovery) +
    section('03', '今天吃了什么', '先记内容，不要求称重', meals, true) + section('04', '活动与训练', '计划和实际完成分别记录', training, true) +
    section('05', '还有什么想记下', '考试、外食、生病或其他影响因素', '<div class="field"><label class="sr-only" for="notes">备注</label><textarea id="notes" name="notes" maxlength="4000" rows="3" placeholder="写给下次调整计划时的自己">' + esc(r.notes) + '</textarea></div>', true) +
    '</div>' + renderEnergyPanel(energyOptions({ ...r, date: selectedDate }), { editable: true }) + '<div class="save-bar"><div><strong>' + dateLabel(selectedDate) + '</strong><p id="form-message">空白表示未知，不会记成零。</p></div><button class="button primary" type="submit">' + icon('check') + ' 保存记录</button></div></form>';
}

function historyRows() {
  const needle = query.trim().toLowerCase();
  return records.filter(r => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate) &&
    (!needle || [r.date, r.notes, r.exerciseNotes, ...Object.values(r.meals || {}), ...Object.values(r.sources || {})].join(' ').toLowerCase().includes(needle))).reverse();
}
function calorieTableCell(row) {
  const manual = state.records.find(r => r.date === row.date);
  const intake = manual ? intakeEstimate(manual) : null;
  return intake?.range ? '约 ' + kcalRange(intake.range) + '<small>' + (intake.complete ? '全天估算' : '已记录部分 · 全天待确认') + '</small>' : number(row.caloriesKcal, 0);
}
function table() {
  const filtered = historyRows();
  const extraKey = ['weightKg', 'steps', 'caloriesKcal', 'sleepHours'].includes(chartKey) ? null : chartKey;
  const pages = Math.max(1, Math.ceil(filtered.length / 30));
  historyPage = Math.max(1, Math.min(pages, historyPage));
  const visible = filtered.slice((historyPage - 1) * 30, historyPage * 30);
  return '<div class="history-meta"><span>' + filtered.length + ' 个日期有记录</span><span>设备汇总与手动记录合并显示；手动值优先</span></div><div class="table-scroll"><table><thead><tr><th scope="col">日期 / 来源</th><th scope="col">体重 kg</th><th scope="col">步数</th><th scope="col">摄入估算 kcal</th><th scope="col">睡眠 h</th>' + (extraKey ? '<th scope="col">' + esc(metrics[extraKey][0]) + ' ' + esc(metrics[extraKey][1]) + '</th>' : '') + '<th scope="col">计划训练记录</th><th scope="col">备注</th><th scope="col">操作</th></tr></thead><tbody>' +
    (visible.length ? visible.map(r => '<tr><td><strong class="table-date">' + r.date + '</strong><small>' + (r.manual && r.imported ? '手动 + Apple 健康' : r.manual ? '手动 / 对话' : 'Apple 健康') + '</small></td>' +
      ['weightKg', 'steps', 'caloriesKcal', 'sleepHours'].map(k => '<td title="' + esc(displaySource(r.sources?.[k], '未记录')) + '">' + (k === 'caloriesKcal' ? calorieTableCell(r) : number(r[k], k === 'weightKg' || k === 'sleepHours' ? 1 : 0)) + '</td>').join('') +
      (extraKey ? '<td title="' + esc(displaySource(r.sources?.[extraKey], '未记录')) + '">' + number(r[extraKey], metrics[extraKey][2]) + '</td>' : '') +
      '<td>' + (r.workoutStatus ? '<span class="tag ' + (r.workoutStatus === 'completed' ? 'green' : '') + '">' + (typeLabels[r.workoutType] || '') + ' ' + statusLabels[r.workoutStatus] + '</span>' : '—') + '</td><td class="table-note" title="' + esc(r.notes || '') + '">' + esc(r.notes || '—') + '</td><td><button class="table-link" data-action="edit-date" data-date="' + r.date + '">' + (publicMode ? '查看详情' : '查看 / 编辑') + '</button>' +
      (r.manual && !publicMode ? '<button class="table-link delete-link" data-action="delete-date" data-date="' + r.date + '">删除手动记录</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="' + (extraKey ? 9 : 8) + '" class="empty-cell">没有符合筛选的记录。</td></tr>') +
    '</tbody></table></div><div class="history-meta"><span>第 ' + historyPage + ' / ' + pages + ' 页 · 每页最多30天</span><div class="actions">' +
    button('上一页', 'previous-page', 'small', historyPage === 1 ? 'disabled' : '') +
    button('下一页', 'next-page', 'small', historyPage === pages ? 'disabled' : '') + '</div></div>';
}
function historyView() {
  const selection = '<select id="metric-select" aria-label="选择趋势指标">' + Object.entries(metrics).map(([key, [label]]) => '<option value="' + key + '" ' + (key === chartKey ? 'selected' : '') + '>' + label + '</option>').join('') + '</select>';
  return heading('YOUR HISTORY', '变化，留在记录里。', '真实样本、可追溯的来源，以及允许存在的空白。', publicMode ? button(icon('download') + ' 导出公开 CSV', 'public-csv') : '<a class="button" href="/api/export?format=csv" download>' + icon('download') + ' 导出全部 CSV</a>') +
    panel('指标趋势', '体脂、活动热量等设备指标包含测量或模型误差', chart(chartKey), '<div class="chart-controls">' + selection + ranges() + '</div>', 'history-chart') +
    '<section class="panel"><div class="panel-header"><div><h2>每日记录表</h2><p>' + (publicMode ? '点击日期查看公开的饮食、训练和恢复记录' : '点击一个日期，查看详情或补充记录') + '</p></div></div><div class="panel-body"><div class="history-controls"><label class="search"><span class="sr-only">搜索记录</span><input id="history-search" type="search" placeholder="搜索日期、饮食、备注或来源" value="' + esc(query) + '"></label><label class="filter-input">从 <input id="history-from" type="date" value="' + fromDate + '"></label><label class="filter-input">至 <input id="history-to" type="date" value="' + toDate + '"></label>' + button('清除筛选', 'clear-filters', 'small') + '</div><div id="history-table">' + table() + '</div></div></section>' +
    (health ? '<div class="notice"><strong>导入说明</strong><p>' + esc(health.method?.cumulative || '') + '</p><p>' + esc(health.method?.sleep || '') + '</p><p>' + esc(health.method?.energy || '') + '</p><p>' + esc(health.method?.workouts || '') + '</p></div>' : '');
}

function planView() {
  const p = state.profile, week = weekStart(today);
  const schedule = '<ul class="weekly-plan">' + Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(week, i), plan = planForDate(date);
    return '<li class="' + (date === today ? 'today' : '') + '"><span class="week-day">' + ['一', '二', '三', '四', '五', '六', '日'][i] + '<small>' + shortDate(date) + '</small></span><div class="week-description"><strong>' + plan.title + '</strong><span>' + plan.duration + '</span></div><span class="tag ' + (plan.type === 'strength' ? 'green' : '') + '">' + plan.tag + '</span></li>';
  }).join('') + '</ul>';
  const exercise = '<div class="exercise-list">' + EXERCISES.map((e, i) => '<article class="exercise"><div class="exercise-top"><strong>' + (i + 1) + '. ' + e.name + '</strong><span class="tag green">' + e.sets + ' 组 × ' + e.reps + '</span></div><small>' + e.english + '</small><p>' + e.cue + '</p>' + (e.link ? '<a href="' + e.link + '" target="_blank" rel="noreferrer">查看动作说明 ↗</a>' : '') + '</article>').join('') + '</div><div class="form-note">先热身5–8分钟，每个器械做轻重量试练。每组结束留3–4次余力，休息90–120秒。初期先练熟动作；明显不适时停止，恢复情况允许再逐步调整。</div>';
  const food = '<div class="nutrition-number">' + (p.calorieTarget ? number(p.calorieTarget, 0) : '未设置') + '<small>' + (p.calorieTarget ? 'kcal / 天 · 参考估算' : '') + '</small></div><p class="nutrition-copy">这是可调整的起点。用实际份量、饥饿与2–4周趋势校准，不作为硬性上限，也不是已经确认的热量缺口。</p><div class="food-rule"><strong>早餐</strong><p>保留鸡蛋、牛奶和主食，记录实际份量。</p></div><div class="food-rule"><strong>午餐</strong><p>食堂点主食、蔬菜和蛋白质；留意油汁与份量。</p></div><div class="food-rule"><strong>晚餐</strong><p>安排正常的一餐：蛋白质 + 蔬菜 + 主食。不需要一直忍饿到睡觉。</p></div><div class="form-note">训练、正常吃饭和长期记录一起服务于减脂。体重变化还包含水分，应用不把体重下降等同于脂肪下降。</div>';
  const profile = '<form id="profile-form" class="profile-form"><div class="fields">' +
    '<div class="field full"><label for="profile-name">项目名称</label><input id="profile-name" name="name" maxlength="40" value="' + esc(p.name) + '" required></div>' +
    input('age', '年龄', '岁', p.age, { attrs: 'min="18" max="100"', step: '1' }) +
    select('sex', '性别', p.sex, [['male', '男'], ['female', '女'], ['unspecified', '不填写']]) +
    input('heightCm', '身高', 'cm', p.heightCm, { attrs: 'min="100" max="230"' }) +
    input('startingWeightKg', '本阶段起始体重', 'kg', p.startingWeightKg, { attrs: 'min="25" max="400"' }) +
    input('milestoneKg', '阶段目标', 'kg', p.milestoneKg, { attrs: 'min="25" max="400"' }) +
    input('targetWeightKg', '长期目标', 'kg', p.targetWeightKg, { attrs: 'min="25" max="400"' }) +
    '<div class="field"><label for="startDate">本阶段开始日期</label><input id="startDate" name="startDate" type="date" value="' + p.startDate + '" required></div>' +
    input('calorieTarget', '摄入参考（可留空）', 'kcal', p.calorieTarget, { attrs: 'min="1500" max="5000"', step: '1' }) +
    '</div><p class="hint">目标可以调整；应用不会根据目标生成强制完成日期。</p><p id="profile-error" class="form-error" role="alert"></p><button type="submit" class="button primary">保存设置</button></form>';
  const data = '<div class="data-actions"><a class="button" href="/api/export" download>' + icon('download') + ' 备份手动记录与设置</a>' +
    button('恢复 / 合并手动记录备份', 'import-json') + '<a class="button" href="/api/health-export" download>备份 Apple 健康汇总</a>' +
    button('重新读取本地 Apple 健康 XML', 'import-health') + '</div><p class="data-note">重新导入前，把新版导出 XML 放入项目 imports 文件夹，并移走旧导出。本人选择公开后，可双击 Sync-GitHub.cmd 发布指标、饮食与训练快照；一般备注、设备名称和原始 XML 保留在本地。饮食和训练备注会公开，请只填写愿意分享的内容。</p>' +
    (health ? '<p class="data-note">上次健康导出：' + esc(health.exportDate) + '<br>导入汇总：' + health.daily.length + ' 天，' + health.workoutCount + ' 次设备运动记录。设备记录不会自动勾选计划完成。</p>' : '<p class="data-note">尚未导入 Apple 健康数据。</p>');
  return heading('YOUR ROUTINE', '让计划，适合你的生活。', '每周4次训练，第5次可选；先从能持续执行的强度开始。') +
    '<div class="plan-layout"><div class="stack">' + panel('本周安排', '初始适应计划 · 根据实际恢复再调整', schedule) + panel('力量日 · 每个动作3组', '周一 / 周四 · 45–60分钟', exercise) + (publicMode ? panel('本阶段目标', '根据记录调整节奏', '<p>起点 ' + number(p.startingWeightKg) + ' kg · 阶段目标 ' + number(p.milestoneKg) + ' kg · 长期目标 ' + number(p.targetWeightKg) + ' kg</p>') : panel('个人设置', '修改后即时用于图表与阶段进度', profile)) + '</div><div class="stack">' +
    panel('饮食参考', '估算需要记录来校准', food) + (publicMode ? panel('公开数据', '由本人从本地应用发布的快照', '<p>记录允许留空，设备运动时段不会自动算作完成计划。健康导出时间：' + esc(health?.exportDate || '暂无') + '</p><a class="button" href="./progress.json" download>下载公开记录</a>') : panel('数据与备份', '本地保存，可以导出', data)) +
    panel('怎么判断是否需要调整', '每周一起看趋势', '<ul class="note-list"><li>尽量比较相似条件下的称重；至少3天再计算周均值。</li><li>有几周较完整的记录后，再结合围度、训练恢复、饥饿和精力判断。</li><li>体重没有立即下降时，不自动追加运动或进一步少吃。</li><li>长期反复减重反弹，可以让医生或营养师一起评估可持续的方案。</li></ul><div class="source-links"><a href="https://www.healthhub.sg/well-being-and-lifestyle/exercise-and-fitness/manage_weight_healthy_way" target="_blank" rel="noreferrer">HealthHub · 健康体重管理 ↗</a><a href="https://www.cdc.gov/healthy-weight-growth/physical-activity/" target="_blank" rel="noreferrer">CDC · 活动与体重管理 ↗</a></div>') +
    '</div></div>';
}
function publicRecordView() {
  const r = rowFor(selectedDate);
  const mealLabels = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snacks: '零食 / 饮料' };
  const meals = Object.entries(mealLabels).map(([key, label]) => '<div class="food-rule"><strong>' + label + '</strong><p>' + esc(r?.meals?.[key] || '尚未记录') + '</p></div>').join('');
  const values = Object.entries(metrics).filter(([key]) => typeof r?.[key] === 'number').map(([key, [label, unit, digits]]) => '<tr><th scope="row">' + esc(label) + '</th><td>' + number(r[key], digits) + ' ' + unit + '</td><td>' + esc(displaySource(r.sources?.[key], '手动记录')) + '</td></tr>').join('');
  return heading('DAILY LOG · PUBLIC', dateLabel(selectedDate), '由本人填写与设备导出组成；空白表示尚无记录。') +
    '<div class="form-toolbar"><label class="date-control" for="record-date">查看日期 <input id="record-date" type="date" value="' + selectedDate + '" min="2000-01-01" max="' + today + '"></label><span class="tag">公开记录 · 只读</span></div>' +
    '<div class="grid-bottom">' + panel('饮食记录', '实际吃了什么', meals) +
    panel('训练与感受', '只按本人实际填写的完成情况统计', '<div class="food-rule"><strong>实际训练</strong><p>' + esc(typeLabels[r?.workoutType] || '尚未记录') + ' · ' + esc(statusLabels[r?.workoutStatus] || '尚未记录') + '</p></div><div class="food-rule"><strong>动作与感受</strong><p>' + esc(r?.exerciseNotes || '尚未记录') + '</p></div><p>晚餐：' + ({ ate: '已吃晚餐', skipped: '未吃晚餐', not_yet: '尚未到晚餐时间' }[r?.dinnerStatus] || '尚未记录') + '</p>') + '</div>' +
    panel('当天指标', r?.weightContext === 'reported' ? '体重为对话报告，称重条件未确认' : '每个指标保留来源；设备估算不代表医学结论', '<div class="table-scroll"><table><thead><tr><th>指标</th><th>数值</th><th>来源</th></tr></thead><tbody>' + (values || '<tr><td colspan="3">这一天尚无指标记录。</td></tr>') + '</tbody></table></div>') + renderEnergyPanel(energyOptions(state.records.find(row => row.date === selectedDate) || { date: selectedDate, meals: {} }));
}
function visionView() {
  return heading('LEAN BODY. STRONG MIND.', '薄肌理论', '从改变身体开始，重新发现内在秩序。') +
    '<div class="vision-layout"><div class="stack">' + panel('我们的理念', '项目发起人的原文', '<blockquote class="manifesto"><p>“薄肌理论”倡导：自我提升、长期主义和向内探寻。</p><p>从改变身体开始，感受努力带来的回报，重新发现内在秩序，重获对生活的掌控。</p></blockquote><div class="vision-values"><span>自我提升</span><span>长期主义</span><span>向内探寻</span></div>') +
    panel('多运动。多思考。做有复利的事。', '把理念放进每天的行动', '<p class="nutrition-copy">一顿正常的饭，一次按计划的训练，一条真实的记录。从今天做得到的事情开始。</p><div class="actions"><a class="button primary" href="#history" data-view="history">查看真实记录</a><a class="button" href="#plan" data-view="plan">查看行动计划</a></div>') + '</div><figure class="poster-panel"><a href="./assets/lean-club-simplified.png" target="_blank" rel="noreferrer"><img class="club-poster" src="./assets/lean-club-simplified.png" width="1024" height="1536" alt="香港理工大学薄肌俱乐部海报：夕阳校园、LEAN CLUB，以及多运动、多思考、做有复利的事。"></a><figcaption>AI 生成的俱乐部形象海报 · 图中人物不是个人身体变化照片。</figcaption><div class="actions"><a class="button" href="./assets/lean-club-simplified.png" download>下载简体版</a><a class="button" href="./assets/lean-club-traditional.png" download>下载繁体版</a></div></figure></div>';
}
function render() {
  const pageURL = new URL(location.href);
  pageURL.hash = view;
  if (view === 'record') pageURL.searchParams.set('date', selectedDate); else pageURL.searchParams.delete('date');
  history.replaceState(null, '', pageURL);
  document.querySelectorAll('[data-view]').forEach(el => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  $('#view-label').textContent = titles[view];
  const publicNotice = publicMode ? '<div class="notice public-notice"><strong>真实公开记录 · 访客只读</strong><p>更新于 ' + esc(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(publishedAt))) + '（新加坡 / 香港时间）。这是发布时的快照。<a href="#vision" data-view="vision">了解薄肌理论与海报 ↗</a></p></div>' : '';
  main.innerHTML = publicNotice + (state.profile.isDemo ? '<div class="notice" role="status"><strong>虚构演示数据</strong> · 所有样例均由程序生成，不代表真实用户或减脂效果。编辑仅影响演示副本。</div>' : '') + ({ overview, record: recordView, history: historyView, plan: planView, vision: visionView })[view]();
}
async function saveRecord(form) {
  const values = Object.fromEntries(new FormData(form));
  const prior = state.records.find(r => r.date === selectedDate);
  const meals = Object.fromEntries(['breakfast', 'lunch', 'dinner', 'snacks'].map(key => [key, values['meal-' + key]]));
  const record = validateRecord({ ...prior, ...values, date: selectedDate, meals, source: prior?.source || 'manual' });
  record.calorieEstimate = estimateFromForm(record, values, prior?.calorieEstimate);
  state = await api('/api/records/' + selectedDate, { method: 'PUT', body: JSON.stringify({ revision: state.revision, record }) });
  merge(); setDirty(false); render(); toast('已保存 ' + selectedDate + ' 的记录');
}
document.addEventListener('submit', async event => {
  if (!['record-form', 'profile-form'].includes(event.target.id)) return;
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = event.target, submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (form.id === 'record-form') await saveRecord(form);
    else {
      state = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ revision: state.revision, profile: Object.fromEntries(new FormData(form)) }) });
      merge(); setDirty(false); render(); toast('设置已保存');
    }
  } catch (error) {
    const area = form.querySelector('#form-message, #profile-error');
    area.textContent = error.message + (error.status === 409 ? ' 这页输入仍保留，建议复制后刷新。' : '');
    area.classList.add('form-error');
    toast(error.message, true);
  } finally { busy = false; submit.disabled = false; }
});
function updateEnergyPreview(changed) {
  const form = $('#record-form');
  if (!form || !$('#energy-results')) return;
  const key = changed.name?.startsWith('meal-') ? changed.name.slice(5) : changed.name === 'dinnerStatus' ? 'dinner' : '';
  if (key) {
    const food = form.elements['meal-' + key].value.trim();
    form.elements['energy-food-' + key].value = food;
    $('#energy-label-' + key).textContent = food || '先在上方记录吃了什么';
    const disabled = !food || key === 'dinner' && form.elements.dinnerStatus.value === 'skipped';
    for (const bound of ['min', 'max', 'note']) {
      const field = form.elements['energy-' + bound + '-' + key];
      field.value = ''; field.disabled = disabled;
    }
  }
  if (key || changed.name === 'caloriesKcal') form.elements['energy-complete'].checked = false;
  try {
    const values = Object.fromEntries(new FormData(form));
    const prior = state.records.find(r => r.date === selectedDate);
    const meals = Object.fromEntries(['breakfast', 'lunch', 'dinner', 'snacks'].map(k => [k, values['meal-' + k]]));
    const record = validateRecord({ ...prior, ...values, date: selectedDate, meals });
    record.calorieEstimate = estimateFromForm(record, values, prior?.calorieEstimate);
    const temporary = mergeHealthRecords([...state.records.filter(r => r.date !== selectedDate), record], health?.daily || []);
    $('#energy-results').innerHTML = renderEnergyResults(energyOptions(record, temporary));
    $('#energy-basis-body').innerHTML = renderEnergyBasis(energyOptions(record, temporary));
    $('#energy-preview-error').textContent = '';
  } catch (error) {
    $('#energy-results').innerHTML = '<p class="hint">估算暂不能更新，请先核对输入。</p>';
    $('#energy-preview-error').textContent = error.message;
  }
}
document.addEventListener('input', event => {
  if (event.target.closest('#record-form, #profile-form')) setDirty(true);
  if (event.target.closest('#record-form')) updateEnergyPreview(event.target);
  if (event.target.id === 'history-search') {
    query = event.target.value;
    historyPage = 1;
    $('#history-table').innerHTML = table();
  }
});
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.closest('#record-form') && (el.tagName === 'SELECT' || el.type === 'checkbox')) { setDirty(true); updateEnergyPreview(el); }
  if (el.id === 'record-date') {
    const date = el.value;
    if (date && date >= '2000-01-01' && date <= today && await leaveDirty()) { selectedDate = date; setDirty(false); render(); }
    else el.value = selectedDate;
  }
  if (el.id === 'metric-select') { chartKey = el.value; render(); }
  if (el.id === 'history-from' || el.id === 'history-to') {
    if (el.id === 'history-from') fromDate = el.value; else toDate = el.value;
    historyPage = 1;
    $('#history-table').innerHTML = table();
  }
});
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view], .brand');
  if (nav) { event.preventDefault(); await navigate(nav.dataset.view || 'overview'); return; }
  const el = event.target.closest('[data-action]');
  if (!el || busy) return;
  const action = el.dataset.action;
  try {
    if (action === 'today') return await navigate('record', today);
    if (action === 'public-csv') {
      const url = URL.createObjectURL(new Blob([recordsCSV(records)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'steady-arrival-public.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (action === 'edit-date') return await navigate('record', el.dataset.date);
    if (action === 'range') { chartDays = Number(el.dataset.days); render(); return; }
    if (action === 'clear-filters') { query = ''; fromDate = ''; toDate = ''; historyPage = 1; render(); return; }
    if (action === 'previous-page' || action === 'next-page') {
      historyPage += action === 'next-page' ? 1 : -1;
      $('#history-table').innerHTML = table(); return;
    }
    if (action === 'refresh') {
      if (await leaveDirty()) { await load(); render(); toast(publicMode ? '已读取最新公开快照' : '已读取最新本地记录'); }
      return;
    }
    if (action === 'delete-date') {
      const date = el.dataset.date;
      if (!await dialog('删除 ' + date + ' 的手动记录？', '<p>这一天的手动记录将删除。Apple 健康导入的原始汇总仍保留。需要长期备份时，可先导出。</p>', '删除手动记录', true)) return;
      state = await api('/api/records/' + date, { method: 'DELETE', body: JSON.stringify({ revision: state.revision }) });
      merge(); render(); toast('手动记录已删除'); return;
    }
    if (action === 'import-json') {
      if (!await leaveDirty()) return;
      $('#import-file').click(); return;
    }
    if (action === 'import-health') {
      if (!await leaveDirty()) return;
      if (!await dialog('重新导入本地健康数据', '<p>读取项目 imports 文件夹中的 XML（兼容已有的导出文件夹），重新生成健康汇总；手动记录保留。多个 XML 时选择最大的健康导出文件，请先移走旧文件。</p>', '开始导入')) return;
      busy = true; el.disabled = true;
      toast('正在读取健康导出，通常需要几秒到一分钟…');
      health = await api('/api/health/import', { method: 'POST', body: '{}' });
      merge(); setDirty(false); render(); toast('已导入 ' + health.daily.length + ' 天健康数据');
    }
  } catch (error) { toast(error.message, true); }
  finally { busy = false; el.disabled = false; }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 6 * 1024 * 1024) throw new Error('手动记录备份应小于6 MB。Apple XML 请通过本地健康导入读取。');
    const data = JSON.parse(await file.text());
    if (data.schemaVersion !== 1 || !Array.isArray(data.records) || !data.profile) throw new Error('请选择此应用导出的手动记录 JSON 备份。');
    data.records.forEach(r => validateRecord(r));
    const duplicates = data.records.filter(r => state.records.some(existing => existing.date === r.date)).length;
    const accepted = await dialog('合并手动记录备份', '<p>备份有 ' + data.records.length + ' 天记录，其中 ' + duplicates + ' 天与现有日期重合。</p><div class="dialog-options"><label><input type="radio" name="import-mode" value="keep" checked> 重合日期保留现有记录</label><label><input type="radio" name="import-mode" value="replace"> 重合日期用备份中的整条记录替换</label><label><input id="import-profile" type="checkbox"> 同时恢复备份中的个人设置</label></div><p class="hint">Apple 健康汇总不受影响。导入前的手动数据会保留一份本地上一版副本。</p>', '确认合并');
    if (!accepted) return;
    state = await api('/api/import', { method: 'POST', body: JSON.stringify({
      revision: state.revision, data, mode: $('input[name="import-mode"]:checked').value,
      includeProfile: $('#import-profile').checked
    }) });
    merge(); setDirty(false); render(); toast('备份已合并');
  } catch (error) { toast(error.message, true); }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !dirty && localDate() !== today) {
    try { await load(); render(); } catch (error) { toast(error.message, true); }
  }
});
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
try {
  await load();
  if (publicMode) {
    $('.local-label').textContent = '真实记录 · 公开分享';
    $('.breadcrumb > span').textContent = '公开成长记录';
    $('.nav-caption').textContent = '一起见证长期改变';
  }
  const requestedDate = new URLSearchParams(location.search).get('date');
  if (isDate(requestedDate) && requestedDate >= '2000-01-01' && requestedDate <= today) selectedDate = requestedDate;
  view = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  render();
} catch (error) {
  $('#save-status').textContent = '连接未完成';
  main.innerHTML = '<div class="fatal-error">' + icon('activity') + '<h1>暂时打不开记录</h1><p>' + esc(error.message) + '</p><p>' + (publicMode ? '请稍后刷新公开页面。' : '请先启动本地程序，再刷新页面。已有数据不会被空白覆盖。') + '</p><button class="button primary" data-action="refresh">重试读取</button></div>';
}
