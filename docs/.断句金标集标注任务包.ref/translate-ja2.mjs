import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const tokens = data.ja.tokens;

async function translate(text) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=ja|zh-CN';
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (j.responseStatus !== 200) throw new Error('API ' + j.responseStatus + ' ' + (j.responseDetails || '').slice(0, 40));
  return j.responseData.translatedText || '';
}

const W = 3;
const results = [];
let errors = 0;
for (let i = 0; i < tokens.length; i++) {
  const from = Math.max(0, i - W);
  const to = Math.min(tokens.length, i + W + 1);
  const context = tokens.slice(from, to).map(t => t.text).join('');
  let zh = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try { zh = (await translate(context)).trim(); break; }
    catch (e) { if (attempt === 1) { errors++; console.error('\nERR @', i + 1, e.message); } await new Promise(r => setTimeout(r, 800)); }
  }
  results.push({ idx: tokens[i].idx, ja: context, zh });
  process.stdout.write(`\r${i + 1}/${tokens.length} err=${errors}   `);
  await new Promise(r => setTimeout(r, 220));
}
fs.writeFileSync('ja-translations.json', JSON.stringify(results, null, 1));
console.log('\nsaved, rows:', results.length, 'errors:', errors);
console.log('样例 1-3:');
for (const r of results.slice(0, 3)) console.log(' ', r.idx, r.ja.slice(0, 24), '→', r.zh.slice(0, 40));
