#!/usr/bin/env node
/**
 * doc-sync-check —— 拦住「代码升版了、资料库还停在旧版本」这类落后。
 *
 * 用法：
 *   npm run doc:check          快速检查（版本号 / tag / CHANGELOG，秒级）
 *   npm run doc:check -- --full 附带跑 npm test 比对断言数（慢，发版前用）
 *
 * 判定的事实源只有三处：package.json 的 version、git tag、CHANGELOG 最新段。
 * 资料库在云端，脚本读不到正文，所以用 docs/LIBRARY-BASELINE.json 作为
 * 「资料库现在声明的是哪一版」的代理，人工更新资料库后同步改它。
 * 脚本能保证的是：任何一处不一致都会在发版前被拦下来，不会静默漂移。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'docs', 'LIBRARY-BASELINE.json');
const PKG = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

const full = process.argv.includes('--full');
const problems = [];
const notes = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ── 1. 载入三处事实源 ────────────────────────────────
if (!fs.existsSync(BASELINE)) {
  console.error('✗ 找不到 docs/LIBRARY-BASELINE.json，没有锚点就无法判断资料库是否落后。');
  process.exit(2);
}

const baseline = JSON.parse(read(BASELINE));
const pkg = JSON.parse(read(PKG));
const version = pkg.version;
const lastTag = git('git describe --tags --abbrev=0');
const headCommit = git('git rev-parse --short HEAD');
const headDate = git('git log -1 --format=%cs');

// ── 2. 版本号一致性 ──────────────────────────────────
if (baseline.version !== version) {
  problems.push(`锚点版本 ${baseline.version} ≠ package.json ${version}：资料库落后或锚点没更新`);
}

if (lastTag && lastTag !== `v${version}`) {
  problems.push(`最新 tag ${lastTag} ≠ v${version}：要么没打 tag，要么版本号没跟着升`);
}

if (baseline.tag && baseline.tag !== lastTag) {
  problems.push(`锚点 tag ${baseline.tag} ≠ 实际最新 tag ${lastTag}`);
}

// ── 3. CHANGELOG 最新段 ──────────────────────────────
const changelog = read(CHANGELOG);
const m = changelog.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
if (!m) {
  problems.push('CHANGELOG.md 找不到 `## [x.y.z]` 形式的版本标题');
} else if (m[1] !== version) {
  problems.push(`CHANGELOG 最新段是 ${m[1]} ≠ package.json ${version}：更新说明没跟上版本号`);
}

// ── 4. 锚点时间 vs 最近提交时间 ──────────────────────
if (baseline.updatedAt && headDate && baseline.updatedAt < headDate) {
  notes.push(
    `锚点更新于 ${baseline.updatedAt}，但最后一次提交在 ${headDate}（${headCommit}）—— ` +
      `如果这次提交改了行为或断言数，资料库很可能还没同步。`
  );
}

// ── 5. 每篇文档的同步日期 ────────────────────────────
const stale = (baseline.docs || []).filter((d) => d.syncedAt && baseline.updatedAt && d.syncedAt < baseline.updatedAt);
if (stale.length) {
  problems.push(`这 ${stale.length} 篇的同步日期早于锚点更新日期：${stale.map((d) => d.title).join('、')}`);
}

// ── 6. 断言数（--full 才跑）──────────────────────────
if (full) {
  process.stdout.write('… 跑 npm test 比对断言数（约 1 分钟）\n');
  let out = '';
  try {
    out = execSync('npm test', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    problems.push('npm test 未通过，先修测试再谈文档同步');
  }
  const counts = [...out.matchAll(/(?:结果|汇总):\s*(\d+)\s*通过/g)].map((x) => Number(x[1]));
  const printed = counts.reduce((a, b) => a + b, 0);
  if (printed === 0) {
    problems.push('未能从 npm test 输出中解析到任何断言汇总（printed=0），请检查测试输出格式');
  } else if (baseline.printed && printed !== baseline.printed) {
    problems.push(
      `实测打印项 ${printed} ≠ 锚点声明的 ${baseline.printed}：断言数变了，六篇里凡引用断言数的段落都要改`
    );
  } else {
    notes.push(`断言数一致：${printed} 打印项。`);
  }
}

// ── 7. 输出 ──────────────────────────────────────────
console.log('');
console.log(`  package.json   ${version}`);
console.log(`  最新 tag       ${lastTag || '(无)'}`);
console.log(`  HEAD           ${headCommit}  ${headDate}`);
console.log(`  锚点           ${baseline.version} / ${baseline.tag} / 更新于 ${baseline.updatedAt}`);
console.log(`  资料库篇数     ${(baseline.docs || []).length}`);
console.log('');

if (notes.length) {
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
}

if (problems.length) {
  console.log('  ✗ 资料库与代码不一致：');
  for (const p of problems) console.log(`    - ${p}`);
  console.log('');
  console.log('  修法：更新对应资料库文档 → 改 docs/LIBRARY-BASELINE.json 的 version/tag/updatedAt/printed 与各篇 syncedAt');
  console.log('       → 重跑 npm run doc:check -- --full 全绿再提交。');
  console.log('');
  process.exit(1);
}

console.log('  ✓ 一致：资料库声明与代码同版本，可以发版。');
console.log('');
