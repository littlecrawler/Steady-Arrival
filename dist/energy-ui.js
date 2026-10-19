import { escapeHTML as esc } from './domain.js';
import { calculateEnergy, foodFingerprint, MEALS, DEFAULT_PAL } from './energy.js';

const num = n => (Math.round(n / 10) * 10).toLocaleString('zh-CN');
export function kcalRange(range) {
  if (!range) return '待估算';
  return range.min === range.max ? num(range.min) : num(range.min) + ' 至 ' + num(range.max);
}
function resultCard(label, value, foot) {
  return '<div class="energy-card"><span>' + label + '</span><strong>' + value + '</strong><small>' + foot + '</small></div>';
}
export function renderEnergyResults(options, compact = false) {
  const { intake, expenditure, deficit, conditional } = calculateEnergy(options);
  const cards = '<div class="energy-cards">' +
    resultCard(intake.complete ? '全天摄入 · 估算' : '已记录摄入 · 估算', intake.range ? '约 ' + kcalRange(intake.range) : '待估算', intake.range ? 'kcal · ' + (intake.manual ? '采用手动总摄入，未叠加每餐值' : '按已有每餐估算相加') : '记录食物后，由助手补充份量估算') +
    resultCard('全天消耗 · 估算', expenditure.range ? '约 ' + kcalRange(expenditure.range) : '暂不能计算', expenditure.method === 'model' ? 'kcal · 身体数据 × 假定活动水平' : 'kcal · 设备基础 + 活动估算') +
    resultCard('全天差额 · 估算', deficit ? '约 ' + kcalRange(deficit) : '待确认', deficit ? 'kcal · 正数为缺口，负数为盈余' : '需确认全天吃喝并补齐摄入估算') + '</div>';
  const notice = '<div class="energy-status" role="status">' +
    (intake.staleConfirmation ? '<p>饮食或总摄入已修改，请重新确认全天吃喝是否记全。</p>' : '') +
    (intake.missing.length ? '<p><strong>还缺：</strong>' + esc(intake.missing.join('、')) + '。未确认的项目没有按 0 计算。</p>' : '') +
    (expenditure.reason ? '<p>' + esc(expenditure.reason) + '</p>' : '') +
    (conditional ? '<p class="conditional-balance">仅当当天没有其他未记录摄入时，按现有记录暂算差额约 <strong>' + kcalRange(conditional) + ' kcal</strong>（正数缺口，负数盈余）。这还不能代表全天结果。</p>' : '') +
    '<p>范围来自份量、用油和活动假设，实际可能超出；差额不会换算成当天减掉的脂肪，也不用于自动减餐或加练。</p></div>';
  if (compact) return cards + notice;
  const ledger = '<div class="table-scroll"><table class="energy-table"><caption class="sr-only">每餐的摄入估算与依据</caption><thead><tr><th scope="col">餐次</th><th scope="col">记录</th><th scope="col">估算 kcal</th><th scope="col">来源与份量假设</th></tr></thead><tbody>' + intake.rows.map(r =>
    '<tr><th scope="row">' + r.label + '</th><td>' + esc(r.food || '尚未记录') + '</td><td>' + (r.range ? '约 ' + kcalRange(r.range) : r.stale ? '需重估' : '待估算') + '</td><td>' + esc(({ assistant: '助手暂估', manual: '手动估算', record: '本人记录' }[r.source] || '') + (r.note ? ' · ' + r.note : '')) + '</td></tr>').join('') + '</tbody></table></div>';
  return cards + notice + ledger;
}
export function renderEnergyPanel(options, { editable = false, compact = false } = {}) {
  const { record } = options;
  const e = record.calorieEstimate;
  const current = !!e?.complete && e.completeFor === foodFingerprint(record);
  const result = '<div id="energy-results">' + renderEnergyResults(options, compact) + '</div>';
  const action = compact ? '<button type="button" class="button small" data-action="edit-date" data-date="' + esc(record.date) + '">查看当天估算</button>' : '<span class="tag">估算范围</span>';
  let controls = '';
  if (editable) {
    controls = '<details class="more-fields energy-editor"><summary>补充 / 调整每餐估算（可选）</summary><p class="hint">你可以只记吃了什么，让助手补估算。手动调整时填下限和上限；所有内容随本页“保存记录”一起保存。</p><div class="energy-edit-grid">' + Object.entries(MEALS).map(([key, label]) => {
      const food = record.meals?.[key]?.trim() || '';
      const m = e?.meals?.[key];
      const matches = !!food && m?.basedOn === food;
      const disabled = !food || key === 'dinner' && record.dinnerStatus === 'skipped';
      return '<fieldset class="energy-meal" data-energy-meal="' + key + '"><legend>' + label + '</legend><p class="hint" id="energy-label-' + key + '">' + esc(food || '先在上方记录吃了什么') + '</p><input type="hidden" name="energy-food-' + key + '" value="' + esc(food) + '"><div class="fields">' + ['min', 'max'].map((bound, i) =>
        '<div class="field"><label for="energy-' + bound + '-' + key + '">' + (i ? '上限' : '下限') + ' kcal</label><input id="energy-' + bound + '-' + key + '" name="energy-' + bound + '-' + key + '" type="number" inputmode="decimal" min="0" max="12000" step="1" placeholder="待估算" value="' + (matches ? m[i ? 'maxKcal' : 'minKcal'] : '') + '" ' + (disabled ? 'disabled' : '') + '></div>').join('') + '</div><div class="field"><label for="energy-note-' + key + '">份量 / 用油假设</label><textarea id="energy-note-' + key + '" name="energy-note-' + key + '" maxlength="600" rows="2" ' + (disabled ? 'disabled' : '') + '>' + esc(matches ? m.note : '') + '</textarea></div></fieldset>';
    }).join('') + '</div><div class="fields"><div class="field"><label for="energy-method">消耗计算方式</label><select id="energy-method" name="energy-method"><option value="model" ' + (e?.method !== 'device' ? 'selected' : '') + '>身体数据估算（默认）</option><option value="device" ' + (e?.method === 'device' ? 'selected' : '') + '>Apple 健康消耗估算</option></select></div></div><p class="hint">设备方式只用于导出日之前、同时有基础与活动热量的日期。佩戴或记录不完整时也会低估；不会再叠加训练热量。</p>' +
      '<details class="more-fields"><summary>活动水平假设</summary><div class="fields">' + ['min', 'max'].map((bound, i) => '<div class="field"><label for="energy-pal-' + bound + '">活动系数' + (i ? '上限' : '下限') + '</label><input id="energy-pal-' + bound + '" name="energy-pal-' + bound + '" type="number" min="1.2" max="2.5" step="0.1" required value="' + (e?.[i ? 'palMax' : 'palMin'] ?? DEFAULT_PAL[i]) + '"></div>').join('') + '</div><p class="hint">默认 1.4–1.6 暂按久坐至轻量日常活动估算，尚未按实际趋势校准。它已包含活动，不再另外加步数、训练或机器热量。</p></details></details>' +
      '<label class="energy-confirm"><input type="checkbox" id="energy-complete" name="energy-complete" ' + (current ? 'checked' : '') + '><span>我已记全当天吃喝，包括零食、含糖饮料、酒、酱料等；空白的零食 / 饮料栏代表没有额外摄入。</span></label><p id="energy-preview-error" class="form-error" role="alert"></p>';
  }
  const basis = compact ? '' : '<details class="more-fields energy-basis"><summary>计算依据与来源</summary><div id="energy-basis-body">' + renderEnergyBasis(options) + '</div></details>';
  return '<section class="panel energy-panel" id="energy-panel"><div class="panel-header"><div><h2>热量收支计算器</h2><p>' + esc(record.date) + ' · ' + (compact ? '最近有饮食的记录' : '按当天实际记录计算') + '</p></div>' + action + '</div><div class="panel-body">' + result + controls + basis + '</div></section>';
}
export function renderEnergyBasis(options) {
  const burn = calculateEnergy(options).expenditure;
  return '<p>摄入采用当前饮食对应的每餐范围；已手动填写总摄入时优先使用该值。饮食文字改变后，旧的每餐估算失效。没有记录、尚未估算与明确没吃会分别处理。</p><p>' +
      (burn.weight ? '参考体重 ' + esc(String(burn.weight.value)) + ' kg，日期 ' + esc(burn.weight.date) + '（' + esc(burn.weight.source) + '）。' : '没有足够近期的体重。') +
      (burn.resting !== null ? '按当前年龄、身高和性别，Mifflin–St Jeor 静息消耗约 ' + num(burn.resting) + ' kcal / 天；乘活动系数 ' + burn.pal.join('–') + ' 得到模型全天消耗。' : '') + '</p><p>设备方式为基础热量 + 活动热量，两者仍是设备估算。饮食参考目标不是实际摄入，计划训练不代表已完成，训练热量不重复相加。用 2–4 周可比体重趋势、饥饿和恢复再校准假设。</p><p class="source-links"><a href="https://pubmed.ncbi.nlm.nih.gov/2305711/" target="_blank" rel="noreferrer">Mifflin 等 · 原始公式 ↗</a><a href="https://www.niddk.nih.gov/bwp" target="_blank" rel="noreferrer">NIDDK · 活动水平说明 ↗</a></p><p class="hint">本应用采用简单静态估算，并非 NIDDK 的动态体重预测模型。每餐范围是份量情景估计，不是营养检测或统计置信区间。</p>';
}
