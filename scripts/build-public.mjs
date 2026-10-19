import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, '.runtime', 'public-site');
await mkdir(out, { recursive: true });
const snapshot = JSON.parse(await readFile(path.join(root, 'public', 'progress.json'), 'utf8'));
if (snapshot.kind !== 'public-progress') throw new Error('缺少有效的公开快照，请先运行 npm run export:public。');
let html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
html = html.replace('<html lang="zh-Hans">', '<html lang="zh-Hans" data-mode="public">')
  .replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./')
  .replace('稳步到站 · 我的健康记录', '稳步到站 · 公开成长记录')
  .replace('你的本地每日体重、饮食、训练与恢复记录。', '薄肌理论与真实体重、饮食、训练和恢复记录。');
await writeFile(path.join(out, 'index.html'), html);
for (const file of ['app.js', 'domain.js', 'charts.js', 'energy.js', 'energy-ui.js', 'styles.css', 'favicon.svg']) await copyFile(path.join(root, 'dist', file), path.join(out, file));
await cp(path.join(root, 'dist', 'assets'), path.join(out, 'assets'), { recursive: true });
await copyFile(path.join(root, 'public', 'progress.json'), path.join(out, 'progress.json'));
await writeFile(path.join(out, '.nojekyll'), '');
console.log('公开展示页已生成：.runtime/public-site（访客只读）。');
