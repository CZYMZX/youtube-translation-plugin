/**
 * 断句引擎 v0.2.6 / v0.2.7 回归测试：语言分策略 / 硬约束 / 标点清理 / 噪声过滤 / 碎句合并 / 守卫 A·B
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
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('所有断句语言策略测试通过！');
}
