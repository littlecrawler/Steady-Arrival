import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createServer, ROOT } from '../server.mjs';
import { blankState } from '../scripts/setup.mjs';

test('API persists records, protects revisions, imports, exports and blocks cross-origin writes', async t => {
  const parent = path.join(ROOT, 'tests', '.tmp');
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(path.join(parent, 'api-'));
  assert.ok(folder.startsWith(parent + path.sep));
  const file = path.join(folder, 'tracker.json');
  await writeFile(file, JSON.stringify(blankState()));
  const server = createServer({ dataFile: file });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const request = (route, method, body, headers = {}) => fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let response = await request('/api/state', 'GET');
  const initial = await response.json();
  assert.equal(initial.records.length, 0);
  const record = { date: '2026-01-01', weightKg: 75, notes: '<script>alert(1)</script>', meals: { dinner: 'Synthetic test meal' } };
  response = await request('/api/records/2026-01-01', 'PUT', { revision: 1, record });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.revision, 2);
  assert.equal(saved.records[0].weightKg, 75);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).records.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(folder, 'tracker.previous.json'), 'utf8')).records.length, 0);
  response = await request('/api/records/2026-01-01', 'PUT', { revision: 1, record });
  assert.equal(response.status, 409);
  response = await request('/api/records/2026-01-01', 'PUT', { revision: 2, record }, { Origin: 'https://untrusted.example' });
  assert.equal(response.status, 403);
  response = await request('/data/tracker.json', 'GET');
  assert.equal(response.status, 404);
  response = await request('/导出.zip', 'GET');
  assert.equal(response.status, 404);
  response = await request('/api/health-data', 'GET');
  assert.equal(await response.json(), null);
  response = await request('/api/export?format=csv', 'GET');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Synthetic test meal/);
  response = await request('/api/import', 'POST', { revision: 2, data: { ...saved, records: [{ ...record, weightKg: 76 }] }, mode: 'keep' });
  const kept = await response.json();
  assert.equal(kept.records[0].weightKg, 75);
  response = await request('/api/import', 'POST', { revision: kept.revision, data: { ...saved, records: [{ ...record, weightKg: 76 }] }, mode: 'replace' });
  const replaced = await response.json();
  assert.equal(replaced.records[0].weightKg, 76);
  response = await request('/api/records/2026-01-01', 'DELETE', { revision: replaced.revision });
  assert.equal((await response.json()).records.length, 0);
  const lastGood = await readFile(file, 'utf8');
  response = await request('/api/import', 'POST', { revision: 5, data: { schemaVersion: 1, records: [{ date: '2026-02-30' }] }, mode: 'replace' });
  assert.equal(response.status, 400);
  assert.equal(await readFile(file, 'utf8'), lastGood);
  for (const route of ['/', '/app.js', '/domain.js', '/styles.css', '/favicon.svg']) {
    response = await request(route, 'GET');
    assert.equal(response.status, 200, route);
    assert.ok(response.headers.get('content-security-policy').includes("default-src 'self'"));
  }
});
