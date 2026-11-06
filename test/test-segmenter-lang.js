/**
 * 断句引擎 v0.2.6 / v0.2.7 / v0.4.2 回归测试：
 * 语言分策略 / 硬约束 / 标点清理 / 噪声过滤 / 歧义短词保留 / 碎句合并 / 守卫 A·B / 超长句实验开关
 */
import { extractCaptionTokens, segmentCaptionTokens, detectStreamLanguage } from '../utils/segmenter.ts';

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' => ' + detail : ''}`);
  }
}

const S = {
  pauseThreshold: 450,
  maxWordsPerSentence: 16,
  minWordsPerSentence: 3,
  maxDurationMs: 6500,
  autoPunctuation: true,
  segmentationLanguage: 'auto',
  maxCharsPerSentence: 28,
  mergeShortFragments: true
};

// 便捷构造器：words = [[text, offsetMs], ...]
function ev(startMs, durMs, words) {
  return {
    tStartMs: startMs,
    dDurationMs: durMs,
    segs: words.map(([t, off]) => ({ utf8: t, tOffsetMs: off }))
  };
}

// ────────────────────────────────────────────────
console.log('--- 测试 1: 语言检测 ---');
{
  const ja = extractCaptionTokens({ events: [ev(0, 2000, [['こんにちは', 0], ['今日', 500], ['ですね', 800]])] });
  const zh = extractCaptionTokens({ events: [ev(0, 2000, [['我们', 0], ['今天', 500], ['讲', 800], ['思维', 1100]])] });
  const en = extractCaptionTokens({ events: [ev(0, 2000, [['hello', 0], ['world', 500], ['this', 800]])] });
  check('假名 → ja', detectStreamLanguage(ja) === 'ja', detectStreamLanguage(ja));
  check('汉字无假名 → zh', detectStreamLanguage(zh) === 'zh', detectStreamLanguage(zh));
  check('拉丁 → en', detectStreamLanguage(en) === 'en', detectStreamLanguage(en));
}

// ────────────────────────────────────────────────
console.log('--- 测试 2: 超长静音不再吞句（原 68 秒 bug） ---');
{
  // 1 字 token，后跟 33 秒静音，再 1 token，再 25 秒静音
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 300, [['は', 0]]),
      ev(33300, 300, [['は', 0]]),
      ev(58400, 300, [['は', 0]])
    ]
  });
  const s = segmentCaptionTokens(tokens, S);
  const maxDur = Math.max(...s.map((x) => x.end - x.start));
  check('长静音强制断句', s.length >= 3, `句数=${s.length}`);
  check(`无超长句 (max=${maxDur}ms < 15000ms)`, maxDur < 15000);
}

// ────────────────────────────────────────────────
console.log('--- 测试 3: 连续无停顿长流被时长硬切 ---');
{
  // 10 秒连续 token，无标点无停顿（interval 500ms，重叠滚动字幕）
  const events = [];
  for (let i = 0; i < 21; i++) {
    events.push(ev(i * 500, 600, [[`単語${i}`, 0]]));
  }
  const tokens = extractCaptionTokens({ events });
  const s = segmentCaptionTokens(tokens, S);
  const over = s.filter((x) => x.end - x.start > S.maxDurationMs + 1500);
  check(`时长硬切生效 (句数=${s.length})`, s.length >= 2);
  check('无句超过 maxDuration+1.5s 容差', over.length === 0, JSON.stringify(over.map((x) => x.end - x.start)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 4: 字数硬上限（CJK 设置生效） ---');
{
  const events = [];
  const chunk = 'あ'.repeat(10); // 每词 10 字
  for (let i = 0; i < 10; i++) {
    events.push(ev(i * 400, 500, [[chunk, 0]])); // 共 100 字，无停顿
  }
  const tokens = extractCaptionTokens({ events });
  const s = segmentCaptionTokens(tokens, { ...S, maxCharsPerSentence: 20 });
  const maxChars = Math.max(...s.map((x) => [...x.text].length));
  check(`字数上限切断 (句数=${s.length}, 最长=${maxChars}字)`, s.length >= 4);
  check('最长句 <= 上限+单 token 容差', maxChars <= 20 + 10 + 2, `maxChars=${maxChars}`);
}

// ────────────────────────────────────────────────
console.log('--- 测试 5: 「，。」伪影消除 ---');
{
  // 中文句以逗号结尾，断句后不应输出「，。」
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 3000, [['我开车从城镇一边', 0], ['到另一边，', 1200]]),
      ev(4000, 2000, [['然后我发现自己', 0]])
    ]
  });
  const s = segmentCaptionTokens(tokens, S);
  const artifact = s.filter((x) => /[，,]\s*[。.]/.test(x.text));
  check('无「，。」伪影', artifact.length === 0, JSON.stringify(artifact.map((x) => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 6: 省略号后不追加句号 ---');
{
  const tokens = extractCaptionTokens({
    events: [ev(0, 2000, [['等一下', 0], ['这是…', 600]])]
  });
  const s = segmentCaptionTokens(tokens, S);
  const bad = s.filter((x) => /…[。.]/.test(x.text));
  check('「…。」伪影消除', bad.length === 0, JSON.stringify(s.map((x) => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 7: 噪声 token 过滤 ---');
{
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 1000, [['[Music]', 0]]),
      ev(1200, 1000, [['翻译人员: Jingyao Xue', 0]]),
      ev(2400, 1500, [['大家好', 0]])
    ]
  });
  const texts = tokens.map((t) => t.text).join('|');
  check('[Music] 被过滤', !tokens.some((t) => t.text.includes('Music')), texts);
  check('署名行被过滤', !tokens.some((t) => t.text.includes('翻译人员')), texts);
  check('正文保留', tokens.some((t) => t.text === '大家好'), texts);
}

// ────────────────────────────────────────────────
console.log('--- 测试 7b [v0.4.1]: 噪声词表补漏（实测漏网清单 + 专名不误伤） ---');
{
  const cases = [
    // [输入, 是否应作为噪声剔除, 说明]
    ['[笑い]', true, '日语笑声（实测 86 处，原带前导空格死条目）'],
    ['[拍手]', true, '日语拍手'],
    ['[鼻息]', true, '日语鼻息（实测 17 处）'],
    ['[叫び声]', true, '日语叫び声（实测 20 处）'],
    ['[息をのむ音]', true, '日语音效（实测 10 处）'],
    ['[ため息][息をのむ音]', true, '多重括号标记（实测 4 处）'],
    ['（鼓掌）', true, '中文鼓掌（实测 1 处）'],
    ['(Laughter)', true, '英语笑声（大小写不敏感）'],
    ['(Cheering)', true, '原 ` cheering` 死条目修正'],
    ['（♪）', true, '括号内纯符号'],
    ['（Glaxo Smith Kline）', false, '专名不得误伤（实测语料）'],
    ['（NNT）', false, '术语缩写不得误伤（实测语料）'],
    ['（笑顔がすごい）', false, '含真实语义的括号内容不得误伤']
  ];
  const events = cases.map(([text], i) => ev(i * 1000, 900, [[text, 0]]));
  events.push(ev(999999, 900, [['終わります', 0]]));
  const toks = extractCaptionTokens({ events });
  const kept = new Set(toks.map((t) => t.text));
  for (const [text, shouldDrop, why] of cases) {
    check(
      `${shouldDrop ? '剔除' : '保留'} ${text}（${why}）`,
      shouldDrop ? !kept.has(text) : kept.has(text),
      kept.has(text) ? '实际保留' : '实际剔除'
    );
  }
}

// ────────────────────────────────────────────────
console.log('--- 测试 7c [v0.4.2]: 歧义短词如实保留（音/笑/SE…），音效长词仍剔除 ---');
{
  // 用户口径：(音)(笑)(SE) 属随话语同步的副语言标记，要如实表达；音效名词仍剔除
  const kept = [
    ['（音）', '单字内文——无构词成分可判，歧义'],
    ['（笑）', '用户点名场景：今天天气真好啊（笑）'],
    ['[笑]', '方括号同规则'],
    ['（SE）', '2 字母缩写'],
    ['[咳]', '单字——歧义（v0.4.2 从词表移除）'],
    ['（Glaxo Smith Kline）', '专名（既有约束不回归）'],
    ['（笑顔がすごい）', '含真实语义（既有约束不回归）']
  ];
  const dropped = [
    ['[笑い声]', '音效名词'],
    ['[拍手]', '音效名词'],
    ['[ため息]', '音效名词'],
    ['[叫び声]', '音效名词'],
    ['[息をのむ音]', '含「音」的 5 字音效名词'],
    ['[笑い]', '2 字音效名词（不豁免）'],
    ['(Laughter)', '英语音效名词'],
    ['（♪）', '纯符号']
  ];
  const all = [...kept, ...dropped];
  const events = all.map(([text], i) => ev(i * 1000, 900, [[text, 0]]));
  events.push(ev(999999, 900, [['終わります', 0]]));
  const toks = extractCaptionTokens({ events });
  const seen = new Set(toks.map((t) => t.text));
  for (const [text, why] of kept) {
    check(`保留 ${text}（${why}）`, seen.has(text), seen.has(text) ? '实际保留' : '被误删');
  }
  for (const [text, why] of dropped) {
    check(`剔除 ${text}（${why}）`, !seen.has(text), seen.has(text) ? '漏网' : '已剔除');
  }

  // 端到端：短词进入断句结果，不被删、不被改写
  const s = segmentCaptionTokens(
    extractCaptionTokens({
      events: [ev(0, 2400, [['今日は', 0], ['いい天気です', 600], ['（笑）', 1200]])]
    }),
    S
  );
  check('句内保留（笑）原样', s.some((x) => x.text.includes('（笑）')), JSON.stringify(s.map((x) => x.text)));
  check('不产生「（笑）」独立碎片行', !s.some((x) => /^（笑）[。]?$/.test(x.text.trim())), JSON.stringify(s.map((x) => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 8: 短碎片合并 ---');
{
  // 4 字碎片（无终止标点、非助词结尾）+ 500ms 停顿触发独立断句，随后并入下一句
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 800, [['いい天気', 0]]),
      ev(1300, 2500, [['悪く', 0], ['なりました。', 500]])
    ]
  });
  const sNoMerge = segmentCaptionTokens(tokens, { ...S, mergeShortFragments: false });
  const sMerged = segmentCaptionTokens(tokens, S);
  check('关闭合并时碎片独立成句', sNoMerge.length === 2, `no=${sNoMerge.length}`);
  check('合并后碎片并入相邻句', sMerged.length === 1, `merge=${sMerged.length}`);
  check('合并文本完整', sMerged[0] && /いい天気/.test(sMerged[0].text) && /なりました/.test(sMerged[0].text), sMerged[0]?.text);
  const frag = sMerged.filter((x) => [...x.text].length < 6 && !/[.!?。！？…]$/.test(x.text));
  check('合并后无无标点短碎片', frag.length === 0, JSON.stringify(frag.map((x) => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 9: 日语语法断句（句末助词） ---');
{
  // 「ですね」句末 + 轻停顿 200ms → 断句
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 2000, [['今日は', 0], ['とても', 400], ['いい天気です', 800], ['ね', 1150]]),
      ev(2400, 2000, [['次の話題', 0], ['に入ります', 600]])
    ]
  });
  const s = segmentCaptionTokens(tokens, S);
  check('句末助词触发断句', s.length >= 2, `句数=${s.length}`);
  check('第一句以终助词结尾', /ね/.test(s[0].text), s[0].text);
}

// ────────────────────────────────────────────────
console.log('--- 测试 10: 日语疑问句「か」补问号 ---');
{
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 2000, [['これって', 0], ['本当', 400], ['ですか', 900]])
    ]
  });
  const s = segmentCaptionTokens(tokens, S);
  check('「か」结尾补「？」', s.some((x) => /[？]$/.test(x.text)), JSON.stringify(s.map((x) => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 11: 中文轨不套用日语规则 ---');
{
  // 中文长句以「から」结尾（中文中无意义）不应触发日语接续助词断句
  // 同时验证 segmentationLanguage='zh' 强制策略
  const tokens = extractCaptionTokens({
    events: [ev(0, 4000, [['今天天气', 0], ['很好から', 500], ['我们出去', 1000], ['走走吧', 1600]])]
  });
  const s = segmentCaptionTokens(tokens, { ...S, segmentationLanguage: 'zh' });
  check('zh 强制策略正常输出', s.length >= 1 && s[0].text.length > 0, s[0]?.text);
}

// ────────────────────────────────────────────────
console.log('--- 测试 12: 英语缩写保护 ---');
{
  const tokens = extractCaptionTokens({
    events: [ev(0, 3000, [['Mr.', 0], ['Smith', 300], ['went', 600], ['home', 900], ['yesterday.', 1200]])]
  });
  const s = segmentCaptionTokens(tokens, S);
  check('Mr. 不触发断句（首句完整）', s[0].text.startsWith('Mr.'), s[0].text);
}

// ────────────────────────────────────────────────
console.log('--- 测试 13: 相邻句时间轴无重叠 ---');
{
  const events = [];
  for (let i = 0; i < 30; i++) {
    events.push(ev(i * 300, 500, [[`词${i}组数据`, 0]]));
  }
  const s = segmentCaptionTokens(extractCaptionTokens({ events }), S);
  let overlap = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i].end > s[i + 1].start) overlap++;
  }
  check('无相邻句重叠', overlap === 0, `重叠数=${overlap}`);
}

// ────────────────────────────────────────────────
console.log('--- 测试 14: 语言策略设置可感知 ---');
{
  const jaTokens = extractCaptionTokens({
    events: [
      ev(0, 2000, [['今日は', 0], ['いい天気です', 400], ['ね', 800]]),
      // 第二事件起点 2200：与前句末 token（结束于 2000ms）留 200ms 停顿，
      // 满足规则 6 的「句末助词 + 轻停顿（>=160ms）」，auto/ja 才会断句；en/zh 不断
      ev(2200, 2000, [['次の話題', 0], ['に入ります', 600]])
    ]
  });
  // auto/ja 会因句末助词「ね」在 800ms 处断句；en 强制策略则不套用日语语法
  const sAuto = segmentCaptionTokens(jaTokens, S);
  const sEn = segmentCaptionTokens(jaTokens, { ...S, segmentationLanguage: 'en' });
  check('auto 与 en 策略产生差异（策略生效）', sAuto.length !== sEn.length, `auto=${sAuto.length} / en=${sEn.length}`);
  check('日语规则仅在 ja/auto 下启用', segmentCaptionTokens(jaTokens, { ...S, segmentationLanguage: 'zh' }).length >= 1);
}

// ────────────────────────────────────────────────
console.log('--- 测试 15 [v0.2.7 守卫A]: 防劈词回退（「つけ」+「たんやけど」） ---');
{
  // 复刻 Vivi 直播 673s 真实场景：滚动字幕无停顿，28 字硬切落在「配信つけ」与「たんやけど」之间
  const words = ['今日はね、', 'あの、', '帰ってき、', 'さっき帰ってきて', '急いで配信つけ', 'たんやけど、', 'あの、', 'パパって食べれる', 'パンみたいなのをさ、', 'ちょっと。'];
  const events = [ev(0, 99999, words.map((w, i) => [w, i * 400]))];
  const tokens = extractCaptionTokens({ events });
  const s = segmentCaptionTokens(tokens, S);
  const splitMid = s.filter(x => /^たんやけど/.test(x.text));
  check('不得在「つけ/たんやけど」之间劈词', splitMid.length === 0, JSON.stringify(splitMid.map(x => x.text.slice(0, 16))));
  check('文本完整保留（不丢词）', s.some(x => x.text.includes('たんやけど')), JSON.stringify(s.map(x => x.text.slice(0, 14))));
}

// ────────────────────────────────────────────────
console.log('--- 测试 16 [v0.2.7 守卫A]: 「ローソン」+「の美味しいパン」不劈开 ---');
{
  const words = ['用意してて、', 'あのね、', 'もっちドーナツ', 'コシアンっていう', 'ローソン', 'の美味しいパン', 'があるの。'];
  const events = [ev(0, 99999, words.map((w, i) => [w, i * 400]))];
  const tokens = extractCaptionTokens({ events });
  const s = segmentCaptionTokens(tokens, S);
  const splitMid = s.filter(x => /^の美味しい/.test(x.text));
  check('不得在「ローソン/の」之间劈词', splitMid.length === 0, JSON.stringify(splitMid.map(x => x.text.slice(0, 16))));
}

// ────────────────────────────────────────────────
console.log('--- 测试 17 [v0.2.7 守卫B]: 「ガルガンダーを」悬空宾语不独立成句 ---');
{
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 600, [['ガルガンダーを', 0]]),
      ev(1200, 2000, [['捕まえるんだ。', 0]])
    ]
  });
  const s = segmentCaptionTokens(tokens, S);
  const hanging = s.filter(x => /[をがにはもでと]$/.test(x.text.replace(/[。.!？?]$/, '')));
  check('悬空格助词不独立成句', hanging.length === 0, JSON.stringify(s.map(x => x.text)));
  check('合并为完整句', s.some(x => x.text.includes('ガルガンダーを捕まえるんだ')), JSON.stringify(s.map(x => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 18 [v0.2.7]: 守卫不误伤正常新句开头 ---');
{
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 600, [['ガルガンダーを', 0]]),
      ev(1200, 2000, [['じゃあ、', 0], ['次に行こう。', 400]])
    ]
  });
  const s = segmentCaptionTokens(tokens, S);
  check('「じゃあ」作为合法新句开头仍可断句', s.some(x => x.text.startsWith('じゃあ')), JSON.stringify(s.map(x => x.text)));
}

// ────────────────────────────────────────────────
console.log('--- 测试 19 [v0.2.7]: 安全阀——守卫连续生效不无限吞句 ---');
{
  // 连续 30 个て/で开头接续 token，无停顿无标点 → 2 倍上限（56 字）内必须被切断
  const words = [];
  for (let i = 0; i < 30; i++) words.push(i % 2 === 0 ? 'して' : 'でね');
  const events = [ev(0, 99999, words.map((w, i) => [w, i * 300]))];
  const s = segmentCaptionTokens(extractCaptionTokens({ events }), S);
  const maxChars = Math.max(...s.map(x => [...x.text].length));
  // 天花板 2×28=56 字，末尾短碎片合并最多再带入 ~1 个碎片（+8 字容差）
  check(`绝对天花板生效 (最长=${maxChars}字 <= 64)`, maxChars <= 64, `maxChars=${maxChars}`);
  check('守卫生效期间句子被合并拉长', s.length < 15, `句数=${s.length}`);
}

// ────────────────────────────────────────────────
console.log('--- 测试 20 [v0.4.2 方案A]: 2× 天花板前置——末 token 不再溢出天花板 ---');
{
  // 20 个 1 字 token 铺到 8s，紧跟一个 6s 的末 token（= 真实轨「末 token 占 2.0s」放大版）
  const events = [];
  for (let i = 0; i < 20; i++) events.push(ev(i * 400, 400, [['あ', 0]]));
  // 末 token 用 9 字（>6 字碎片阈值），否则会被「短碎片合并」缝回去（见下方反例）
  events.push(ev(8000, 6000, [['どーんどーんどーん', 0]]));
  const tokens = extractCaptionTokens({ events });
  const base = segmentCaptionTokens(tokens, S);
  const expA = segmentCaptionTokens(tokens, S, { ceilingBeforeToken: true });
  const maxBase = Math.max(...base.map((x) => x.end - x.start));
  const maxA = Math.max(...expA.map((x) => x.end - x.start));
  check('默认路径仍会溢出 2× 天花板（现状，说明开关默认关闭）', maxBase > S.maxDurationMs * 2, `max=${maxBase}ms`);
  check('方案A 下最长句不超过 2× 天花板', maxA <= S.maxDurationMs * 2, `max=${maxA}ms`);
  // 文本会因自动补标点而不同，故按 rawTokens 序列比对是否丢词
  const flatTokens = (arr) => arr.flatMap((x) => (x.rawTokens || []).map((t) => t.text)).join('|');
  check('方案A 不丢 token', flatTokens(expA) === flatTokens(base), `${flatTokens(expA).slice(0, 40)} vs ${flatTokens(base).slice(0, 40)}`);
  const off = segmentCaptionTokens(tokens, S, { ceilingBeforeToken: false });
  check(
    '显式关闭开关 = 默认行为（句数/最长句一致）',
    off.length === base.length && Math.max(...off.map((x) => x.end - x.start)) === maxBase
  );

  // 历史记录：末 token 若是 ≤6 字碎片，会被「短碎片合并」pass 缝回上一句，方案A 的切口失效。
  // 方案 C 落地后该漏洞已堵（下面的两条断言就是 C 的验收点：关 C 复原旧行为、开 C 不再缝回）。
  const shortEvents = [];
  for (let i = 0; i < 20; i++) shortEvents.push(ev(i * 400, 400, [['あ', 0]]));
  shortEvents.push(ev(8000, 6000, [['どーん', 0]]));
  const shortTokens = extractCaptionTokens({ events: shortEvents });
  const maxDurOf = (arr) => Math.max(...arr.map((x) => x.end - x.start));
  const aShortNoC = segmentCaptionTokens(shortTokens, S, {
    ceilingBeforeToken: true,
    mergeCeiling: false
  });
  const aShort = segmentCaptionTokens(shortTokens, S, { ceilingBeforeToken: true });
  check(
    '旧行为（C 关）：碎片尾巴把方案A 的切口缝回去，产出 14s 句',
    maxDurOf(aShortNoC) > 13000,
    `max=${maxDurOf(aShortNoC)}ms`
  );
  check(
    'C 生效后：碎片不再被缝回，最长句回落到主循环单句长度（8s）',
    maxDurOf(aShort) <= 8000,
    `max=${maxDurOf(aShort)}ms`
  );
}

// ────────────────────────────────────────────────
console.log('--- 测试 21 [v0.4.2 方案B]: 守卫A 只认前缀表——默认不劈词，开关打开才劈 ---');
{
  // 「言わ」+「れ」+「たから」：真实轨确有「言わ|れた」这类劈词风险
  const tokens = extractCaptionTokens({
    events: [
      ev(0, 800, [['今日は', 0]]),
      ev(1800, 500, [['言わ', 0]]),
      ev(3300, 400, [['れ', 0]]),
      ev(4900, 1100, [['たから。', 0]])
    ]
  });
  const base = segmentCaptionTokens(tokens, S);
  const expB = segmentCaptionTokens(tokens, S, { strictContinuationGuard: true });
  check('默认守卫拦住「言わ|れ」', base.length === 1, JSON.stringify(base.map((x) => x.text)));
  check('方案B 下该守卫失效（开关生效）', expB.length === 2, JSON.stringify(expB.map((x) => x.text)));
  check(
    '方案B 确实切在词中（代价示例）',
    expB.length === 2 && /^れ/.test(expB[1].text),
    JSON.stringify(expB.map((x) => x.text))
  );
  const off = segmentCaptionTokens(tokens, S, { strictContinuationGuard: false });
  check('显式关闭开关 = 默认行为（句数一致）', off.length === base.length);
}

// ────────────────────────────────────────────────
console.log('--- 测试 22 [本轮 方案C]: 短碎片合并的累计上限（默认生效） ---');
{
  const maxDurOf = (arr) => Math.max(...arr.map((x) => x.end - x.start));
  const flat = (arr) => arr.flatMap((x) => (x.rawTokens || []).map((t) => t.text)).join('|');

  // 22a 时长闸门：碎片（4 实字、无终止标点）+ 6.4s 实体句，过去缝成 9.65s，C 应拒绝合并
  const durTokens = extractCaptionTokens({
    events: [
      ev(500, 2500, [['いい天気', 0]]), // 0.5~3.0s ⇒ 会被合并 pass 认定为碎片
      ev(3600, 6400, [['悪く', 0], ['なりました。', 3000]]) // 3.6~10.0s 实体句
    ]
  });
  const durWithC = segmentCaptionTokens(durTokens, S);
  const durNoC = segmentCaptionTokens(durTokens, S, { mergeCeiling: false });
  check(
    'C 关时碎片被缝进下一句（旧行为：1 句 9.6s）',
    durNoC.length === 1 && maxDurOf(durNoC) > 9000,
    `句数=${durNoC.length} max=${maxDurOf(durNoC)}ms`
  );
  check(
    'C 生效时时长超限不合并（碎片与实体句各自保留）',
    durWithC.length === 2,
    `句数=${durWithC.length}：${JSON.stringify(durWithC.map((x) => x.text))}`
  );
  check(
    'C 生效后无句子被缝过 maxDurationMs（单句自身超限除外）',
    maxDurOf(durWithC) <= S.maxDurationMs + 200,
    `max=${maxDurOf(durWithC)}ms`
  );
  check('C 拒绝合并不丢 token（内容完整）', flat(durWithC) === flat(durNoC), `${flat(durWithC)} vs ${flat(durNoC)}`);

  // 22b 字数闸门：4 字碎片 + 27 字句 = 31 字 > 28 ⇒ 不合并
  const charTokens = extractCaptionTokens({
    events: [
      ev(500, 2500, [['いい天気', 0]]), // 0.5~3.0s，与下一事件留 600ms 停顿 ⇒ 断句
      ev(3600, 2400, [[`${'あ'.repeat(26)}。`, 0]])
    ]
  });
  const charDefault = segmentCaptionTokens(charTokens, S);
  const charRaised = segmentCaptionTokens(charTokens, { ...S, maxCharsPerSentence: 60 });
  check(
    'C 生效时字数超限不合并（31 字 > 28）',
    charDefault.length === 2,
    `句数=${charDefault.length}：${JSON.stringify(charDefault.map((x) => x.text))}`
  );
  check(
    '上限跟随用户设置：maxCharsPerSentence 提到 60 后同一对碎片可合并',
    charRaised.length === 1,
    `句数=${charRaised.length}：${JSON.stringify(charRaised.map((x) => x.text))}`
  );

  // 22c 时长上限同样跟随设置：把 maxDurationMs 提到 20s 后，22a 的合并重新被允许
  const durRaised = segmentCaptionTokens(durTokens, { ...S, maxDurationMs: 20000 });
  check(
    '上限跟随用户设置：maxDurationMs 提到 20s 后长碎片可合并',
    durRaised.length === 1,
    `句数=${durRaised.length}`
  );

  // 22d 边界：单句自身已超上限（单个长 token，无处可切）⇒ 原样输出，不报错、不切分
  const singleLong = extractCaptionTokens({
    events: [ev(0, 12000, [['どーんどーんどーんどーん', 0]])]
  });
  const singleOut = segmentCaptionTokens(singleLong, S);
  check(
    '单句自身超上限时原样输出（1 句，未被切成碎片）',
    singleOut.length === 1 && singleOut[0].end - singleOut[0].start >= 11000,
    `句数=${singleOut.length} dur=${singleOut[0] ? singleOut[0].end - singleOut[0].start : '-'}ms`
  );
  check('单句超上限时不产生空句/纯标点句', singleOut.every((x) => /\S/.test(x.text)), JSON.stringify(singleOut.map((x) => x.text)));

  // 22e 闸门不改守卫判定：同一输入下守卫 A/B 仍生效（「つけ/たんやけど」不得被劈开）
  const guardWords = ['急いで配信つけ', 'たんやけど、', 'あの、', 'パパって食べれる'];
  const guardTokens = extractCaptionTokens({
    events: [ev(0, 99999, guardWords.map((w, i) => [w, i * 400]))]
  });
  const guardC = segmentCaptionTokens(guardTokens, S);
  check(
    'C 生效不影响守卫 A（依旧不在「つけ/たんやけど」之间劈词）',
    !guardC.some((x) => /^たんやけど/.test(x.text)),
    JSON.stringify(guardC.map((x) => x.text.slice(0, 14)))
  );

  // 22f 开关语义：默认 = C 开；显式 true 与默认逐句一致
  const implicit = segmentCaptionTokens(durTokens, S);
  const explicit = segmentCaptionTokens(durTokens, S, { mergeCeiling: true });
  check(
    '默认路径 = C 开（不传第三参数与显式 mergeCeiling:true 一致）',
    implicit.length === explicit.length &&
      implicit.every((s, i) => s.text === explicit[i].text && s.start === explicit[i].start),
    `${implicit.length} vs ${explicit.length}`
  );
}

// ────────────────────────────────────────────────
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('所有断句语言策略测试通过！');
}
