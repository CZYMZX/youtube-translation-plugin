import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const tokens = data.ja.tokens;

async function translate(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const arr = await res.json();
  return (arr[0] || []).map(seg => seg[0]).join('');
}

const W = 4; // 语境窗口 ±4 token
const results = [];
for (let i = 0; i < tokens.length; i++) {
  const from = Math.max(0, i - W);
  const to = Math.min(tokens.length, i + W + 1);
  const context = tokens.slice(from, to).map(t => t.text).join('');
  try {
    const zh = await translate(context);
    results.push({ idx: tokens[i].idx, zh });
    process.stdout.write(`\r${i + 1}/${tokens.length}`);
  } catch (e) {
    results.push({ idx: tokens[i].idx, zh: '' });
    console.error('\nERR @', i, e.message);
  }
  await new Promise(r => setTimeout(r, 120));
}
fs.writeFileSync('ja-translations.json', JSON.stringify(results, null, 1));
console.log('\nsaved ja-translations.json, rows:', results.length);
console.log('样例:');
for (const r of results.slice(0, 3)) console.log(' ', r.idx, JSON.stringify(r.zh).slice(0, 80));
