import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
} catch {
  console.error('Run this check inside an initialized Git checkout.');
  process.exit(1);
}
const blocked = files.filter(file => /^(data|imports|导出|\.runtime)\//.test(file) ||
  /\.(xml|zip|csv|log)$/i.test(file) || /(^|\/)\.env($|\.)/.test(file));
if (blocked.length) {
  console.error('Private/local files must not be tracked:\n' + blocked.join('\n'));
  process.exit(1);
}
console.log('Privacy boundary check passed: ' + files.length + ' tracked source files; no local health exports.');
