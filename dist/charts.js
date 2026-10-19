import { isDate, shiftDate, displaySource, escapeHTML as esc } from './domain.js';

export function trendSamples(records, key, from, to) {
  const days = new Map();
  for (const row of records) {
    if (!isDate(row.date) || row.date < from || row.date > to || typeof row[key] !== 'number' || !Number.isFinite(row[key])) continue;
    const previous = days.get(row.date);
    if (previous?.manual && !row.manual) continue;
    days.set(row.date, row);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function renderTrend(records, key, { label, unit, digits = 1, days = 90, today }) {
  const format = value => value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const shortDate = date => date.slice(5).replace('-', '/');
  const lower = days ? shiftDate(today, 1 - days) : '2000-01-01';
  const samples = trendSamples(records, key, lower, today);
  if (!samples.length) return '<div class="empty-chart"><strong>这段时间还没有' + esc(label) + '记录</strong><p>有记录后显示趋势。缺失日期不会算成零。</p></div>';
  const width = 800, height = 250, left = 52, right = 24, top = 22, bottom = 36;
  const dates = samples.map(r => Date.parse(r.date + 'T12:00:00Z'));
  let start = days ? Date.parse(lower + 'T12:00:00Z') : dates[0];
  let end = Date.parse(today + 'T12:00:00Z');
  const tickCount = Math.min(4, Math.round((end - start) / 86400000) + 1);
  if (start === end) { start -= 43200000; end += 43200000; }
  const values = samples.map(r => r[key]);
  let lo = Math.min(...values), hi = Math.max(...values);
  const padding = Math.max((hi - lo) * .16, key === 'weightKg' ? 1 : hi * .05 || 1);
  lo = Math.max(0, lo - padding); hi += padding;
  if (key === 'weightKg') {
    const step = Math.max(1, Math.ceil((hi - lo) / 3));
    lo = Math.floor(lo);
    hi = lo + step * 3;
  }
  const axisFormat = value => key === 'weightKg' ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : format(value);
  const x = stamp => left + (stamp - start) / (end - start) * (width - left - right);
  const y = value => top + (hi - value) / (hi - lo || 1) * (height - top - bottom);
  let svg = '<svg class="trend-svg" viewBox="0 0 800 250" role="img" aria-label="' + esc(label) + '趋势，' + samples.length + '天有记录"><title>' + esc(label) + '，' + samples[0].date + ' 至 ' + samples.at(-1).date + '</title>';
  for (let i = 0; i < 4; i++) {
    const v = lo + (hi - lo) * i / 3, py = y(v);
    svg += '<line x1="' + left + '" y1="' + py + '" x2="' + (width - right) + '" y2="' + py + '" stroke="#edf0ea" aria-hidden="true"/><text x="' + (left - 12) + '" y="' + (py + 4) + '" text-anchor="end">' + axisFormat(v) + '</text>';
  }
  for (let i = 0; i < tickCount; i++) {
    const stamp = tickCount === 1 ? dates[0] : start + (end - start) * i / (tickCount - 1);
    svg += '<text x="' + x(stamp) + '" y="' + (height - 10) + '" text-anchor="' + (tickCount === 1 ? 'middle' : i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle') + '">' + shortDate(new Date(stamp).toISOString().slice(0, 10)) + '</text>';
  }
  const maxGap = key === 'weightKg' || key === 'bodyFatPct' ? 7 : 1;
  const commands = dates.map((stamp, i) => (i === 0 || (stamp - dates[i - 1]) / 86400000 > maxGap ? 'M' : 'L') + x(stamp) + ' ' + y(values[i]));
  // Exactly one observed series; no moving-average or synthetic data series.
  svg += '<path data-series="actual" d="' + commands.join(' ') + '" stroke="#467e60" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" fill="none"/>';
  for (let i = 0; i < samples.length; i++) {
    const row = samples[i];
    svg += '<circle class="point" cx="' + x(dates[i]) + '" cy="' + y(values[i]) + '" r="' + (samples.length > 120 ? 2.2 : 4) + '" fill="#467e60" stroke="#fff" stroke-width="1.5"><title>' + row.date + ' · ' + format(row[key]) + ' ' + esc(unit) + ' · ' + esc(displaySource(row.sources?.[key])) + '</title></circle>';
  }
  svg += '</svg>';
  const note = key === 'weightKg' ? '仅显示实际体重记录 · 缺测不补值' : '缺失不计零 · 导出当天可能尚未完整';
  return '<div class="chart-wrapper">' + svg + '</div><div class="chart-foot"><span>' + samples.length + '天有记录 · ' + esc(unit) + '</span><span>' + note + '</span></div>';
}
