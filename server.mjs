import http from 'node:http';
import { readFile, writeFile, rename, mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_ID, localDate, isDate, validateRecord, validateProfile, recordsCSV, mergeHealthRecords } from './dist/domain.js';
import { ensureData } from './scripts/setup.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FILE = path.join(ROOT, 'data', 'tracker.json');
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/domain.js', ['domain.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
const MAX_BODY = 6 * 1024 * 1024;
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function parseState(raw, { today = localDate() } = {}) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.records)) fail('备份格式或版本不受支持。');
  if (raw.records.length > 10000) fail('单次最多导入10000天记录。');
  const seen = new Set();
  const records = raw.records.map(record => {
    const clean = validateRecord(record, today);
    if (seen.has(clean.date)) fail('同一天出现重复记录：' + clean.date);
    seen.add(clean.date);
    return { ...clean, updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null };
  });
  return { schemaVersion: 1, revision: Number.isInteger(raw.revision) ? raw.revision : 1,
    profile: validateProfile(raw.profile), records: records.sort((a, b) => a.date.localeCompare(b.date)) };
}
export function createStore(file = DEFAULT_FILE) {
  const absolute = path.resolve(file);
  if (!absolute.startsWith(ROOT + path.sep)) throw new Error('数据文件必须保存在当前工作区内。');
  let queue = Promise.resolve();
  async function read() {
    return parseState(JSON.parse(await readFile(absolute, 'utf8')));
  }
  function change(revision, mutate) {
    const operation = queue.then(async () => {
      const state = await read();
      if (!Number.isInteger(revision) || revision !== state.revision) fail('记录已在其他页面更新。请刷新后重新保存。', 409);
      const next = await mutate(structuredClone(state));
      const checked = parseState(next);
      checked.revision = state.revision + 1;
      const temp = absolute + '.pending';
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(temp, JSON.stringify(checked, null, 2) + '\n', 'utf8');
      await copyFile(absolute, absolute.replace(/\.json$/i, '') + '.previous.json');
      await rename(temp, absolute);
      return checked;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read, change };
}
async function bodyJSON(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail('请使用JSON格式提交。', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) fail('提交内容过大。', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('提交的JSON无法读取。'); }
}
function send(res, code, value, headers = {}) {
  const content = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(content);
}
export function createServer({ dataFile = DEFAULT_FILE, healthFile = path.join(path.dirname(dataFile), 'apple-health.json'), allowHealthImport = false } = {}) {
  const store = createStore(dataFile);
  let importing = false;
  async function readHealth() {
    try { return JSON.parse(await readFile(healthFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return http.createServer(async (req, res) => {
    try {
      const port = req.socket.localPort;
      const allowedHosts = ['127.0.0.1:' + port, 'localhost:' + port];
      if (!allowedHosts.includes(req.headers.host)) fail('仅允许从本机访问。', 403);
      if (req.headers.origin && !allowedHosts.map(h => 'http://' + h).includes(req.headers.origin)) fail('拒绝来自其他网站的请求。', 403);
      const url = new URL(req.url, 'http://127.0.0.1');
      const route = url.pathname;
      if (req.method === 'GET' && route === '/api/health') return send(res, 200, { app: APP_ID, date: localDate() });
      if (req.method === 'GET' && route === '/api/state') return send(res, 200, await store.read());
      if (req.method === 'GET' && route === '/api/health-data') return send(res, 200, await readHealth());
      if (req.method === 'GET' && route === '/api/health-export') {
        return send(res, 200, JSON.stringify(await readHealth(), null, 2), {
          'Content-Disposition': 'attachment; filename="apple-health-summary.json"'
        });
      }
      if (req.method === 'POST' && route === '/api/health/import') {
        await bodyJSON(req);
        if (!allowHealthImport) fail('当前运行模式不支持重新导入；请使用本地导入命令。', 403);
        if (importing) fail('健康数据正在导入，请稍后刷新。', 409);
        importing = true;
        try {
          await promisify(execFile)(process.env.PYTHON || 'python', [path.join(ROOT, 'scripts', 'import_apple_health.py')], {
            cwd: ROOT, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024
          });
          return send(res, 200, await readHealth());
        } catch {
          fail('导入未完成。请确认已安装 Python 3.9+，并把 Apple 健康导出的 XML 放在项目 imports 文件夹内。现有记录保留。');
        } finally { importing = false; }
      }
      if (req.method === 'GET' && route === '/api/export') {
        const state = await store.read();
        const csv = url.searchParams.get('format') === 'csv';
        const health = csv ? await readHealth() : null;
        return send(res, 200, csv ? recordsCSV(mergeHealthRecords(state.records, health?.daily)) : JSON.stringify(state, null, 2), {
          'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="steady-arrival-' + localDate() + (csv ? '.csv"' : '.json"')
        });
      }
      if (req.method === 'PUT' && route.startsWith('/api/records/')) {
        const date = route.slice('/api/records/'.length);
        const body = await bodyJSON(req);
        if (!isDate(date) || body.record?.date !== date) fail('记录日期不匹配。');
        const clean = validateRecord(body.record);
        const state = await store.change(body.revision, s => {
          const previous = s.records.find(r => r.date === date);
          s.records = s.records.filter(r => r.date !== date);
          s.records.push({ ...clean, source: previous?.source === 'chat' && clean.weightKg === previous.weightKg ? 'chat' : clean.source, updatedAt: new Date().toISOString() });
          return s;
        });
        return send(res, 200, state);
      }
      if (req.method === 'DELETE' && route.startsWith('/api/records/')) {
        const date = route.slice('/api/records/'.length);
        const body = await bodyJSON(req);
        if (!isDate(date)) fail('记录日期不正确。');
        return send(res, 200, await store.change(body.revision, s => {
          if (!s.records.some(r => r.date === date)) fail('这一天没有已保存的记录。', 404);
          s.records = s.records.filter(r => r.date !== date); return s;
        }));
      }
      if (req.method === 'PUT' && route === '/api/profile') {
        const body = await bodyJSON(req);
        return send(res, 200, await store.change(body.revision, s => {
          s.profile = validateProfile({ ...s.profile, ...body.profile }); return s;
        }));
      }
      if (req.method === 'POST' && route === '/api/import') {
        const body = await bodyJSON(req);
        const incoming = parseState(body.data);
        if (!['keep', 'replace'].includes(body.mode)) fail('请选择合并方式。');
        return send(res, 200, await store.change(body.revision, s => {
          const map = new Map(s.records.map(r => [r.date, r]));
          for (const record of incoming.records) {
            if (!map.has(record.date) || body.mode === 'replace') map.set(record.date, record);
          }
          s.records = [...map.values()];
          if (body.includeProfile === true) s.profile = incoming.profile;
          return s;
        }));
      }
      if (req.method === 'GET' && STATIC.has(route)) {
        const [file, type] = STATIC.get(route);
        return send(res, 200, await readFile(path.join(ROOT, 'dist', file)), {
          'Content-Type': type,
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        });
      }
      fail('没有找到这个页面或接口。', 404);
    } catch (error) {
      const expected = error.status || error.message?.startsWith('请选择') || error.message?.includes('不正确') || error.message?.includes('范围');
      send(res, error.status || (expected ? 400 : error instanceof SyntaxError ? 500 : 400), {
        error: error.code === 'ENOENT' ? '没有找到数据文件，请检查 data/tracker.json；不要用空数据覆盖原文件。' : error.message || '保存失败，请稍后重试。'
      });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8765);
  await ensureData();
  await access(DEFAULT_FILE);
  const server = createServer({ allowHealthImport: true });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '端口已占用。若应用已运行，请打开 http://127.0.0.1:' + port : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log('稳步到站已启动：http://127.0.0.1:' + port));
}
