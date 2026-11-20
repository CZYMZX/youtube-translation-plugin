#!/usr/bin/env node
/**
 * doc-brief —— 生成「这次该往资料库写什么」的要点清单。
 *
 * 做的事：把 CHANGELOG 当前版本段 + 上个 tag 到 HEAD 的提交列表捞出来，
 * 打印成一份可直接对着改资料库的提纲。不联网、不改任何文件。
 *
 * 用法：npm run doc:brief            （只看最新版本段）
 *      npm run doc:brief -- --all   （附带上一个 tag 以来的全部提交）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const all = process.argv.includes('--all');

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const baselinePath = path.join(ROOT, 'docs', 'LIBRARY-BASELINE.json');
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;

// 取最新版本段：从第一个 ## [x.y.z] 到下一个同级标题
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((l) => /^##\s*\[/.test(l));
let end = lines.length;
if (start >= 0) {
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
}
const section = start >= 0 ? lines.slice(start, end).join('\n') : '(没找到版本段)';

const lastTag = git('git describe --tags --abbrev=0');
const head = git('git rev-parse --short HEAD');
const commits = lastTag ? git(`git log ${lastTag}..HEAD --oneline`) : '(无 tag，无法比对范围)';

console.log('\n══════ 资料库更新提纲 ══════\n');
console.log(`包版本        ${pkg.version}`);
console.log(`锚点声明      ${baseline ? `${baseline.version} / 更新于 ${baseline.updatedAt}` : '(无锚点)'}`);
console.log(`上一个 tag    ${lastTag || '(无)'}  →  HEAD ${head}`);
console.log('');
console.log('── 1. 本次版本段（照此拆分到各任务篇） ──');
console.log(section);
console.log('');
console.log('── 2. 上一个 tag 以来的提交 ──');
console.log(commits || '(无)');
console.log('');
console.log('── 3. 要改的位置 ──');
for (const d of baseline?.docs || []) {
  console.log(`  · ${d.title}  (${d.id})`);
}
console.log('  · docs/LIBRARY-BASELINE.json  ← 最后一步，改完再跑 npm run doc:check -- --full');
console.log('');
if (all) {
  console.log('── 4. 全量提交历史（最近 30 条） ──');
  console.log(git('git log -30 --oneline'));
  console.log('');
}
