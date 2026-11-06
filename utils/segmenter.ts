import type {
  Json3CaptionData,
  CaptionToken,
  SubtitleSentence,
  ExtensionSettings
} from '../types';
import { normalizeCaptionResponse, decodeHtmlEntities } from './caption-parser';

/**
 * 断句引擎 v0.2.6 + v0.2.7 —— 语言分策略断句 + 防劈词/悬空助词守卫
 *
 * 核心思路：
 * 1. 先对整条字幕轨做语言检测（ja / zh / ko / en / generic）；
 * 2. 按语言套用不同的断句规则包：
 *    - 日语：句末助词/敬语（です・ました・だよ…）、接续助词（けど・から・ので）、
 *            新句叹词（じゃあ・そして…）、疑问终助词「か」、标点「。！？」；
 *    - 中文：仅依赖标点（。！？；）+ 声学停顿 + 字数/时长硬上限，不套用日语语法；
 *    - 英语：标点（.!?，含缩写保护）+ 词数 + 从句连词 + 疑问起始词；
 *    - 其他：通用（标点 + 停顿 + 长度/时长硬上限）。
 * 3. 硬约束优先级最高，杜绝 68 秒长句与无限吞噬（v0.2.7 分级）：
 *    - 极端停顿（>= max(5s, 3×超长停顿阈值)）无条件断句，守卫不得拦；
 *    - 超长停顿（>= max(2×阈值, 800ms)）、单句时长达 maxDurationMs、CJK 字数/拉丁词数
 *      达上限——守卫生效时延后切分（词中换气不劈词），但达到 2 倍上限时无条件强制切断。
 * 4. 输出后处理：纯标点句过滤（flush 时）、短碎片合并、相邻句时间轴去重叠、重编号。
 *
 * v0.4.2 增量：
 * - 噪声侧：括号内文为「歧义短词」（单字 CJK / ≤2 拉丁字母，如（音）（笑）（SE））时如实保留，
 *   音效名词（笑い声/拍手/ため息…）仍剔除——见 isAmbiguousShortInner；
 * - 断句侧：新增 SegmenterExperimentOptions（超长句治理方案 A/B），**默认全关、默认路径不变**。
 *
 * 本轮增量（超长句治理方案 C 落地，未发版）：
 * - 后处理「短碎片合并」不再是无限吞噬：合并后的句子必须同时满足
 *   时长 <= maxDurationMs 且长度 <= 主循环同一口径的长度上限（CJK 字数 / 拉丁词数），
 *   两条上限都直接取自用户设置，超限即**不合并**——两段各自保留为独立句，不丢内容、也不新造碎片。
 *   这是最外层闸门，不改守卫 A/B 的判定；单句自身已超限时原样输出（不报错、不二次切分）。
 * - 方案 A 保留为实验开关（默认关闭）；方案 B 已被否决，代码仅留作对照（见 SegmenterExperimentOptions）。
 */

/**
 * 常见英语简写词列表，避免因句点错误断句
 */
const COMMON_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'vs.', 'etc.', 'i.e.', 'e.g.',
  'u.s.', 'u.k.', 'inc.', 'ltd.', 'corp.', 'jr.', 'sr.', 'st.', 'ave.'
]);

/**
 * 常见疑问句起始词（英语策略专用）
 */
const QUESTION_STARTERS = new Set([
  'what', 'why', 'how', 'who', 'whom', 'whose', 'where', 'when', 'which',
  'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might',
  'have', 'has', 'had'
]);

/**
 * 强从句连词和转折词（英语新句常见首词）
 */
const STRONG_CLAUSE_STARTERS = new Set([
  'however', 'therefore', 'moreover', 'furthermore', 'meanwhile',
  'finally', 'secondly', 'thirdly', 'basically', 'actually', 'incidentally',
  'nonetheless', 'nevertheless', 'conversely', 'otherwise'
]);

/**
 * 次级连词（英语弱断句信号）
 */
const SECONDARY_CONJUNCTIONS = new Set([
  'and', 'but', 'so', 'because', 'although', 'though', 'while', 'whereas',
  'if', 'unless', 'since', 'as', 'or'
]);

/**
 * 日文常见句末终助词与敬语结语（VTuber 直播 / ACG 日常断句核心特征）
 */
const JAPANESE_SENTENCE_ENDINGS = [
  'ですねー', 'ですよー', 'ですね', 'ですよ', 'でした', 'ですか',
  'ますね', 'ますよ', 'ました', 'ません', 'ますか', 'ましょう', 'ます', 'です',
  'だよね', 'んだよね', 'んだよ', 'んだね', 'んだな', 'んだ', 'だよ', 'だね', 'だな',
  'よね', 'わね', 'かしら', 'かなー', 'かな', 'かい', 'わよ',
  'ちゃう', 'ちゃった', 'とくね', 'といた',
  'ありがとう', 'ございます', 'よろしく', 'お願い',
  'ね', 'よ', 'な', 'わ', 'ぞ'
];

/**
 * 日文句间从句与转折连接助词（遇到轻度停顿即可自然切句）
 */
const JAPANESE_CLAUSE_CONNECTORS = [
  'けど', 'けれど', 'けれども', 'から', 'ので', 'のに', 'なら', 'たら', 'てね', 'でね', 'てさ', 'でさ'
];

/**
 * 日文新句开头常见接续词与叹词
 */
const JAPANESE_SENTENCE_STARTERS = new Set([
  'えーっと', 'えっと', 'あのー', 'あの', 'えー', 'まあ', 'うーん', 'じゃあ', 'では',
  'そして', 'それで', 'でも', 'だけど', 'ただ', 'ですから', 'ちなみに', '実は', '要するに', 'ところで', 'なんか'
]);

/**
 * 可独立开话轮的常见词（v0.2.7）：这些词以平假名开头但不属于接续形态，
 * 在防劈词守卫中视为合法新句开头，不阻止断句。
 */
const JA_ALLOWED_SENTENCE_STARTERS = new Set([
  ...JAPANESE_SENTENCE_STARTERS,
  'はい', 'いいえ', 'うん', 'ううん', 'なるほど', 'やっぱ', 'やっぱり', 'ちょっと',
  'なんて', 'なんで', 'よし', 'おい', 'わかった', 'すみません',
  'こんにちは', 'こんばんは', 'おはよう', 'ありがとう', 'ほんま', 'せや', 'ほな'
]);

/**
 * 接续活用形态前缀（v0.2.7）：正常日语句子不会以这些形态开头；
 * 下一 token 以它们开头 ⇒ 上一组的切点落在词中或谓语未完成处（如「つけ」+「たんやけど」）。
 * 仅匹配平假名开头，片假名/汉字/拉丁开头不受影响（如「ガルガンダー」不误伤）。
 */
const JA_CONTINUATION_PREFIXES = [
  'たん', 'けど', 'けれど', 'ので', 'のに', 'たら', 'れば', 'ばっ', 'ても', 'でも',
  'んで', 'でね', 'てね', 'てさ', 'でさ', 'ちゃって', 'ちゃう',
  'が', 'の', 'に', 'を', 'は', 'も', 'で', 'て', 'と', 'ば', 'し', 'っ', 'や', 'ね', 'な', 'わ', 'け'
];

/**
 * v0.2.7 守卫 A：判断下一 token 是否以接续活用形态开头（切点劈词信号）。
 * 结构性规则（针对单字粒度 ASR 流）：≤2 字纯平假名 token 且不是已知话轮词 ⇒ 接续
 * （正常日语新句几乎不会以 ≤2 字平假名开头）；更长 token 退回前缀表匹配。
 *
 * v0.4.2 实验开关（方案 B，`strict = true`，默认 false 保持现状）——**该方案已否决，仅留对照**：
 * 不再用「≤2 字纯平假名」做结构性推断，只认 JA_CONTINUATION_PREFIXES 命中。
 * 代价：落在前缀表之外的两字接续形态（「る」「ませ」「ない」…）不再被拦，会劈词。
 */
function startsWithJapaneseContinuation(text: string, strict = false): boolean {
  const clean = text.trim().replace(/^[。！？…、，,.!?]+/, '');
  if (!clean || !/^[ぁ-ゖー]/.test(clean)) {
    return false;
  }
  if (JA_ALLOWED_SENTENCE_STARTERS.has(clean)) {
    return false;
  }
  if (strict) {
    // 方案 B：跳过一切「≤2 字纯平假名」结构性推断与短词豁免，只做前缀表匹配
    for (const p of JA_CONTINUATION_PREFIXES) {
      if (clean.startsWith(p)) {
        return true;
      }
    }
    return false;
  }
  // 短平假名 token 中可独立成话轮的词（单字 ASR 流常见）
  if (/^(えー?|んー?|はい|うん|ううん|おい|ほら|なに|まじ|それ|これ|あれ|どれ|ここ|そこ|どこ|だれ|だめ|まだ|また|まで|もう|もし|やば|やっば|やれ|たぶん|できる|がんば|つぎ|よく|こら)$/.test(clean)) {
    return false;
  }
  if (/^[ぁ-ゖー]+$/.test(clean) && [...clean].length <= 2) {
    // ≤2 字纯平假名且不是任何已知话轮词 ⇒ 接续形态（「ん」「や」「けど」「て」等）
    return true;
  }
  // 多字 token：豁免以活用尾开头的完整词
  if (/^(たぶん|だめ|できる|どこ|どっち|どう|ちょっと|ありがとう|がんば|けっこう|つぎ|まだ|また|まで|もう|もし|やっぱ|よく|わざと)/.test(clean)) {
    return false;
  }
  for (const p of JA_CONTINUATION_PREFIXES) {
    if (clean.startsWith(p)) {
      return true;
    }
  }
  return false;
}

/**
 * v0.2.7 守卫 A（双向）：判断当前组末 token 是否停在未完成活用形上
 * （≤2 字纯平假名且末字不是终止/终助词 ⇒ 谓语未完成，如「つけ」「た」「ん」）。
 * 单字粒度 ASR 下「た」+「ん」+「やけど」被逐字输出，仅有 next 侧信号会漏防。
 *
 * v0.4.2 实验开关（方案 B，`strict = true`）：同属「≤2 字纯平假名」结构性推断，一并关闭。
 * **该方案已否决，仅留对照**。
 */
const JA_TERMINAL_ENDING_HIRAGANA = new Set(['ね', 'よ', 'な', 'か', 'わ', 'ぞ', 'さ', 'け', 'え']);
function endsWithUnfinishedForm(text: string, strict = false): boolean {
  if (strict) return false;
  const clean = text.trim().replace(/[。！？…、，,.!?]+$/, '');
  if (!clean || !/^[ぁ-ゖー]+$/.test(clean) || [...clean].length > 2) {
    return false;
  }
  const last = clean.charAt(clean.length - 1);
  return !JA_TERMINAL_ENDING_HIRAGANA.has(last);
}

/**
 * v0.2.7 守卫 B：判断当前组末 token 是否以裸格助词结尾（SOV 悬空宾语信号）。
 * 剥离尾部标点后以单个格助词（を/が/に/は/も/で/と/へ/や）收尾 ⇒ 宾语尚未落到动词上，不宜在此切分。
 * 权衡：疑问终助词「の」等完整句形态也会被延迟切分，但规则 1（源标点）
 * 与规则 2a（极端停顿）不受此守卫约束，过度合并的代价可控。
 */
function endsWithBareCaseParticle(text: string): boolean {
  const clean = text.trim().replace(/[。！？…、，,.!?「」『』（）()]+$/, '');
  if (!clean) {
    return false;
  }
  return /[をがにはもでとへや]$/.test(clean);
}

/**
 * 日文疑问句末尾「か」的排除名单（避免陈述句误判为疑问）
 */
const JA_QUESTION_EXCLUSIONS = ['かも', 'から', 'かしら', 'かな', 'だろう', 'でしょう', 'かもね'];

/**
 * ASR 噪声 token 整体匹配规则：纯括号音效标记与署名行
 *
 * v0.4.1 修复（真实语料实测，见 docs/SEGMENTER-0.2.6.md 第八节）：
 * - 原正则中的 ` cheering` / ` 笑い` 带前导空格，而括号内文已 trim，属永不命中的死条目；
 * - 原词表仅按「整段内文精确匹配单括号」判定，多重标记（[ため息][息をのむ音]）与
 *   实测高频音效词（[笑い] 86 处 / [叫び声] 20 / [鼻息] 17 / [うめき声] 16 /
 *   [息をのむ音] 10 / [泣き声] 6 / [ため息] 3 / [あくび] 1）全部漏网；
 * - 现改为「token 整体由括号段组成 ⇒ 逐段判定是否音效词」，去掉单段 12 字上限，
 *   但内文必须命中词表或为纯符号才算噪声，故（Glaxo Smith Kline）/（NNT）等专名不受影响。
 *
 * v0.4.2 修订（用户口径：(音)/(笑)/(SE) 这类歧义短词要如实保留）：
 * - 从词表移除 `音` / `笑` / `se` / `咳` 四个**歧义短词**（详见 isAmbiguousShortInner）；
 * - 划线的依据是「内文能否唯一读作非言语音效」，不是字数：
 *   词表只保留**自身即音效名词**的条目（笑い声 / 拍手 / ため息 / 叫び声 / 息をのむ音 …），
 *   这些词单独出现时在字幕里没有指称功能；而单字/双字母内文既可能是实词、缩写、
 *   注释，也可能是（笑）这类随话语同步表达的副语言标记——删错会丢语义，
 *   留错只多一行标记。按「宁可漏删不可误删」（与断句侧「宁可漏切不可劈词」同源）取保留。
 */
const NOISE_SOUND_WORDS = new Set([
  // 英语
  'music', 'applause', 'applauses', 'clapping', 'claps', 'laughter', 'laughs', 'laughing',
  'chuckles', 'giggle', 'giggling', 'silence', 'noise', 'breath', 'breathing', 'exhale',
  'inhale', 'sigh', 'sighs', 'sighing', 'gasp', 'gasps', 'cough', 'coughing', 'cheering',
  'crowd cheering', 'intro', 'outro', 'inaudible',
  // 日语（v0.4.2：移除歧义短词「音」「笑」——由 isAmbiguousShortInner 结构性保留）
  '笑い', '笑い声', '叫び声', '悲鳴', '鼻息', 'うめき声', '息をのむ音', '泣き声',
  'ため息', '溜息', '吐息', 'あくび', '号泣', '嗚咽', '拍手', '音楽', '歓声', '効果音',
  '無音', '沈黙', '咳払い', '舌打ち', '足音', '物音', 'ざわめき', 'bgm',
  // 中文
  '笑声', '掌声', '鼓掌', '音乐', '音效', '欢呼', '叹气', '咳嗽', '沉默', '掌声响起'
]);

/** token 整体由一或多段括号标记组成（可相邻拼接） */
const NOISE_BRACKET_SEQ_RE = /^(?:[\[【（(][^\]】）)]*[\]】）)])+$/;
/** 逐段取出括号内文 */
const NOISE_BRACKET_ITEM_RE = /[\[【（(]([^\]】）)]*)[\]】）)]/g;

const CREDIT_LINE_RE = /^(翻译|譯|校对|校對|字幕|监制|監製|提供|译者|譯者|时间轴|時軸)(人员|人員|者)?\s*[:：]/;

/**
 * v0.4.2 歧义短词豁免：括号内文**整体**为单个 CJK 字，或 1~2 个拉丁字母 ⇒ 一律保留。
 *
 * 划线依据（不是拍脑袋，三条）：
 * 1. **语义不可判定**：单字内文没有构词成分（「〜声」「〜音」「〜息」）可供判断它是音效名词
 *    还是实词/缩写/注释；而词表里保留的条目（笑い声 / 拍手 / ため息 / 息をのむ音）都是
 *    「自身即音效名词」的完整词，单独出现时在字幕流里没有指称功能。
 * 2. **用户口径**：（音）（笑）（SE）属随话语同步的副语言标记，用户要求「如实表达」，
 *    例如「今天天气真好啊（笑）」——删掉会损失语气，不是噪声。
 * 3. **代价不对称**：误留 = 多一行标记（可读）；误删 = 丢语义且该句不再进翻译（不可逆）。
 *    与断句侧「宁可漏切不可劈词」同源 ⇒ 宁可漏删不可误删。
 *
 * 注意 2 个 CJK 字（笑い/拍手/泣き声…）不豁免：双字起才有可判定的音效构词语义。
 */
function isAmbiguousShortInner(inner: string): boolean {
  if (!inner) return false;
  // 单个 CJK 字（含假名/汉字；不含标点、不含「〜声」类构词）
  if (/^[\u3041-\u3096\u30a1-\u30fa\u3400-\u4dbf\u4e00-\u9fff]$/.test(inner)) return true;
  // 1~2 个拉丁字母（SE / BGM 类缩写，可能是术语缩写而非音效标记）
  if (/^[a-zA-Z]{1,2}$/.test(inner)) return true;
  return false;
}

/**
 * 判断 token 是否整体由音效括号标记构成（v0.4.1：支持多重标记与去死条目；
 * v0.4.2：歧义短词豁免，任一段是歧义短词即整体保留）
 * 逐段内文判定，全部满足其一才算噪声：空内文 / 命中音效词表 / 纯符号（♪♥← 等）。
 * 任一段含真实文字（专名、术语、歧义短词）即整体保留。
 */
function isBracketNoiseToken(t: string): boolean {
  if (!NOISE_BRACKET_SEQ_RE.test(t)) return false;
  const inners = [...t.matchAll(NOISE_BRACKET_ITEM_RE)].map((m) => m[1].trim());
  if (inners.length === 0) return false;
  return inners.every(
    (inner) =>
      !inner ||
      (!isAmbiguousShortInner(inner) && NOISE_SOUND_WORDS.has(inner.toLowerCase())) ||
      !/[a-zA-Z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(inner)
  );
}

/**
 * 检测 token 是否为应被剔除的噪声（音效标记 / 署名行）
 */
function isNoiseToken(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (CREDIT_LINE_RE.test(t)) return true;
  return isBracketNoiseToken(t);
}

/**
 * 判断是否含有 CJK 表意文字（不含 CJK 标点）
 */
function isCjkText(str: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}

/**
 * 判断是否含有假名（日语专属信号）
 */
function hasKana(str: string): boolean {
  return /[\u3041-\u3096\u30a1-\u30fa]/.test(str);
}

/**
 * 判断是否含有谚文（韩语专属信号）
 */
function hasHangul(str: string): boolean {
  return /[\uac00-\ud7af]/.test(str);
}

/**
 * 语言类型（内部检测结果）
 */
export type StreamLanguage = 'ja' | 'zh' | 'ko' | 'en' | 'generic';

/**
 * 对整条 token 流做语言检测：
 * - 假名出现即可判定日语（中文轨不会混入假名，日语轨必然有假名）；
 * - 仅谚文 → ko；仅汉字 → zh；拉丁字母为主 → en；其余 → generic。
 */
export function detectStreamLanguage(tokens: CaptionToken[]): StreamLanguage {
  let kana = 0;
  let hangul = 0;
  let han = 0;
  let latin = 0;
  for (const t of tokens) {
    for (const ch of t.text) {
      const code = ch.codePointAt(0) ?? 0;
      if ((code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa)) kana++;
      else if (code >= 0xac00 && code <= 0xd7af) hangul++;
      else if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)) han++;
      else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
    }
  }
  if (kana >= 3) return 'ja';
  if (hangul >= 3 && hangul > han) return 'ko';
  if (han >= 4) return 'zh';
  if (latin >= 12 && latin > han) return 'en';
  return 'generic';
}

/**
 * 语言断句策略参数包
 */
interface LanguageProfile {
  lang: StreamLanguage;
  /** 断句单位是否按字符计（CJK true / 拉丁 false） */
  charBased: boolean;
  /** 是否启用日语语法规则（句末助词/接续助词/疑问か） */
  useJapaneseGrammar: boolean;
  /** 是否启用英语从句连词规则 */
  useEnglishGrammar: boolean;
  /** 停顿断句所需最小单位数（CJK 字符 / 英语词） */
  minBreakUnits: number;
  /** 日语句末助词确认断句所需最小字数 */
  jaTerminalMinChars: number;
}

function getLanguageProfile(lang: StreamLanguage, minWordsPerSentence: number): LanguageProfile {
  switch (lang) {
    case 'ja':
      return {
        lang,
        charBased: true,
        useJapaneseGrammar: true,
        useEnglishGrammar: false,
        minBreakUnits: 4,
        jaTerminalMinChars: 8
      };
    case 'zh':
      return {
        lang,
        charBased: true,
        useJapaneseGrammar: false,
        useEnglishGrammar: false,
        minBreakUnits: 4,
        jaTerminalMinChars: 0
      };
    case 'ko':
      // 韩语词间有空格，按词计
      return {
        lang,
        charBased: false,
        useJapaneseGrammar: false,
        useEnglishGrammar: false,
        minBreakUnits: 3,
        jaTerminalMinChars: 0
      };
    case 'en':
      return {
        lang,
        charBased: false,
        useJapaneseGrammar: false,
        useEnglishGrammar: true,
        minBreakUnits: Math.max(2, minWordsPerSentence),
        jaTerminalMinChars: 0
      };
    default:
      return {
        lang: 'generic',
        charBased: false,
        useJapaneseGrammar: false,
        useEnglishGrammar: false,
        minBreakUnits: 3,
        jaTerminalMinChars: 0
      };
  }
}

/**
 * 判断词尾是否具有断句标点符号（省略号/破折号同样视为句末）
 */
function hasSentenceTerminalPunctuation(word: string, lang: StreamLanguage): boolean {
  const clean = word.trim().toLowerCase();
  if (lang === 'en' && COMMON_ABBREVIATIONS.has(clean)) {
    return false;
  }
  return /[.!?。！？…]$/.test(clean);
}

/**
 * 检查日文字符串是否以句末助词/结语结尾（剥离尾部标点后匹配，容忍「ですね。」形式）
 */
function endsWithJapaneseTerminal(text: string): boolean {
  const clean = text.trim().replace(/[。！？…、，,.!?]+$/, '');
  for (const ending of JAPANESE_SENTENCE_ENDINGS) {
    if (clean.endsWith(ending)) {
      return true;
    }
  }
  return false;
}

/**
 * 检查日文字符串是否以转折/连接助词结尾（同样剥离尾部标点）
 */
function endsWithJapaneseConnector(text: string): boolean {
  const clean = text.trim().replace(/[。！？…、，,.!?]+$/, '');
  for (const conn of JAPANESE_CLAUSE_CONNECTORS) {
    if (clean.endsWith(conn)) {
      return true;
    }
  }
  return false;
}

/**
 * 将单个可能包含多个句子（句号、感叹号、换行）的长分段智能细化拆分，并按字符比例分配时间
 */
function splitRawSegmentByPunctuation(
  text: string,
  start: number,
  end: number,
  splitOnCommas = false
): Array<{ text: string; start: number; end: number }> {
  const clean = text.replace(/[\r\n]+/g, ' \n ').trim();
  if (!clean) return [];

  // 标点分割正则（保留分隔符；省略号也参与分割）
  // v0.2.7：splitOnCommas 时「、」也参与拆分——行级 ASR token（整行输出）依赖此路径细分
  const commaClass = splitOnCommas ? '、，,' : '';
  const parts = clean.split(new RegExp(`([。！？!?\\n…${commaClass}]+)`));
  if (parts.length <= 1) {
    return [{ text: clean.replace(/\n/g, ''), start, end }];
  }

  const result: Array<{ text: string; start: number; end: number }> = [];
  const fullLength = Math.max(1, clean.length);
  const totalDuration = Math.max(150, end - start);

  let currentSubText = '';
  let subStartChar = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    currentSubText += part;

    // 如果当前部分是标点或者到了末尾，输出一个子句
    const punctRe = new RegExp(`[。！？!?\\n…${commaClass}]+`);
    if (punctRe.test(part) || i === parts.length - 1) {
      const trimmed = currentSubText.trim();
      if (trimmed) {
        const charStartRatio = subStartChar / fullLength;
        const charEndRatio = Math.min(1, (subStartChar + currentSubText.length) / fullLength);
        const subStart = Math.round(start + totalDuration * charStartRatio);
        const subEnd = Math.max(subStart + 100, Math.round(start + totalDuration * charEndRatio));

        result.push({
          text: trimmed,
          start: subStart,
          end: subEnd
        });
      }
      subStartChar += currentSubText.length;
      currentSubText = '';
    }
  }

  return result.length > 0 ? result : [{ text: clean, start, end }];
}

/**
 * 从 YouTube Timedtext JSON3 原始数据解析出单词/词元级别的 Token 列表。
 * v0.2.6：在入队阶段同步剔除噪声 token（音效标记 / 署名行）。
 */
export function extractCaptionTokens(captionData: Json3CaptionData | any): CaptionToken[] {
  const normalized = normalizeCaptionResponse(captionData);
  const rawTokens: Array<{ text: string; start: number; end?: number }> = [];

  const events = normalized.events || [];

  for (const event of events) {
    const eventStart = event.tStartMs ?? 0;
    const eventDuration = event.dDurationMs ?? 2000;

    if (!event.segs || event.segs.length === 0) {
      const fallbackRaw = (event as any).utf8 || (event as any).text;
      if (fallbackRaw) {
        const text = decodeHtmlEntities(String(fallbackRaw)).trim();
        if (text) {
          const subTokens = splitRawSegmentByPunctuation(text, eventStart, eventStart + Math.max(150, eventDuration));
          for (const sub of subTokens) {
            if (!isNoiseToken(sub.text)) {
              rawTokens.push(sub);
            }
          }
        }
      }
      continue;
    }

    for (let i = 0; i < event.segs.length; i++) {
      const seg = event.segs[i];
      const text = seg.utf8 ? decodeHtmlEntities(seg.utf8).trim() : '';
      if (!text || isNoiseToken(text)) continue;

      const segOffset = seg.tOffsetMs ?? 0;
      const segStart = eventStart + segOffset;

      let segEnd: number | undefined;
      if (i < event.segs.length - 1 && event.segs[i + 1].tOffsetMs !== undefined) {
        segEnd = eventStart + event.segs[i + 1].tOffsetMs!;
      } else {
        segEnd = eventStart + eventDuration;
      }

      if (segEnd <= segStart) {
        segEnd = segStart + Math.max(150, text.length * 40);
      }

      // 如果当前 seg 自身含有换行或明确标点，则进行子分词拆分
      // v0.2.7：行级 ASR token（整行 >40 字、含顿号/逗号）也按「、，,」细分
      const isLongLineToken = [...text].length > 40 && /[、，,]/.test(text);
      if (/[。！？!?\n…]/.test(text) || isLongLineToken) {
        const subTokens = splitRawSegmentByPunctuation(text, segStart, segEnd, isLongLineToken);
        for (const sub of subTokens) {
          if (!isNoiseToken(sub.text)) {
            rawTokens.push(sub);
          }
        }
      } else {
        rawTokens.push({
          text,
          start: segStart,
          end: segEnd
        });
      }
    }
  }

  // 按起始时间排序
  rawTokens.sort((a, b) => a.start - b.start);

  const tokens: CaptionToken[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const cur = rawTokens[i];
    const next = rawTokens[i + 1];

    let end = cur.end ?? (cur.start + 250);
    let gapToNext = 0;

    if (next) {
      // v0.2.6：停顿信号按原始结束点计算（next.start - rawEnd），
      // 重叠（滚动字幕）时记 0；end 仅在展示意义上收敛到 next.start。
      const rawGap = next.start - (cur.end ?? cur.start + 250);
      gapToNext = Math.max(0, rawGap);
      if (next.start < end) {
        end = next.start;
      }
    } else {
      gapToNext = 999999;
    }

    tokens.push({
      text: cur.text,
      start: cur.start,
      end: Math.max(cur.start + 50, end),
      gapToNext
    });
  }

  return tokens;
}

/**
 * 判断 token 之间是否需要插入空格：
 * - CJK（含 CJK 标点）之间不插空格
 * - 西文标点前不插空格，左括号后不插空格
 */
function shouldInsertSpace(prev: string, curr: string): boolean {
  if (!prev || !curr) return false;
  // 闭合标点/右括号前不加空格
  if (/^[.,!?;:%)\]}、。，！？：；）】」』…]/.test(curr)) return false;
  // 左括号后不加空格
  if (/[(\[{（【「『]$/.test(prev)) return false;
  // CJK 字符/标点之间不加空格
  if (isCjkOrCjkPunct(prev) && isCjkOrCjkPunct(curr)) return false;
  return true;
}

function isCjkOrCjkPunct(str: string): boolean {
  return /[\u3041-\u3096\u30a1-\u30fa\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff01-\uff65]/.test(str);
}

/**
 * 智能大小写与句末标点自动修补（支持日文平假片假汉字无空格自然拼接与英文自然空格拼接）
 * v0.2.6 修复：
 * - 尾部逗号/顿号先剥离，杜绝「，。」伪影；
 * - 省略号「…」与破折号「——」视为句末，不再追加标点；
 * - 疑问判定按语言分流（英语疑问起始词 / 日语终助词か）。
 */
function polishSentenceText(
  tokens: CaptionToken[],
  autoPunctuation: boolean,
  lang: StreamLanguage
): string {
  if (tokens.length === 0) return '';

  let rawJoined = tokens[0].text;
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1].text;
    const curr = tokens[i].text;
    rawJoined += shouldInsertSpace(prev, curr) ? ' ' + curr : curr;
  }
  rawJoined = rawJoined.trim().replace(/\s{2,}/g, ' ');

  // v0.2.7：清理句首顿号/逗号伪影（ASR token 边界常把「、」放在下一 token 开头）
  rawJoined = rawJoined.replace(/^[、，,]+/, '');

  if (!autoPunctuation) {
    return rawJoined;
  }

  // 首字母大写处理 (仅对拉丁字母有效)
  let polished = /^[a-z]/.test(rawJoined)
    ? rawJoined.charAt(0).toUpperCase() + rawJoined.slice(1)
    : rawJoined;

  // 省略号/破折号结尾：视为已完成句末，不再追加
  if (/[…]$/.test(polished) || /——$/.test(polished)) {
    return polished;
  }

  // 已有句末终止标点：直接返回
  if (/[.!?。！？]$/.test(polished)) {
    return polished;
  }

  // 剥离尾部逗号/顿号/分号等非终止标点，避免出现「，。」
  polished = polished.replace(/[,，、;；:：\s]+$/, '');

  const isCjk = isCjkText(polished);
  let isQuestion = false;

  if (lang === 'en') {
    const firstWord = tokens[0].text.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (QUESTION_STARTERS.has(firstWord)) isQuestion = true;
  }
  if (lang === 'ja' && isCjk) {
    const endsKa = /か$/.test(polished);
    const excluded = JA_QUESTION_EXCLUSIONS.some((w) => polished.endsWith(w));
    if (endsKa && !excluded) isQuestion = true;
  }

  if (isQuestion) {
    polished += isCjk ? '？' : '?';
  } else {
    polished += isCjk ? '。' : '.';
  }

  return polished;
}

/**
 * 超长句治理实验开关（v0.4.2 起的 A/B；本轮方案 C 落地）
 *
 * 只用于 `scripts/compare-long-sentence.ts` 的对照实验；生产调用（content 脚本）
 * 不传第三个参数、也不设环境变量，因此行为只由本接口的默认值决定。
 * 环境变量仅在 Node（测试/脚本）下可读；浏览器里 globalThis.process 不存在 ⇒ 恒为 false。
 */
export interface SegmenterExperimentOptions {
  /** 方案 A：把「2× 时长/字数天花板」从 token 边界事后检查改为**并入前预测**（超 2× 先切）。默认关闭，保留为可选项 */
  ceilingBeforeToken?: boolean;
  /**
   * 方案 B：守卫 A 收紧为「只认 JA_CONTINUATION_PREFIXES」，关闭 ≤2 字纯平假名结构性推断。
   *
   * ⚠️ **已否决（用户 2026-11-06 拍板「B 不做」），代码仅留作对照，勿在生产启用**：
   * 实测它会把 v0.2.7 刚修好的劈词复发（`配信つけ｜たんやけど`）、劈词嫌疑 +87、
   * 最长句反而 14.35s → 17.99s、极短句 +32（详见 docs/SEGMENTER-0.2.7.md 七、八节）。
   */
  strictContinuationGuard?: boolean;
  /**
   * 方案 C：短碎片合并 pass 的累计时长/长度上限。**默认生效（true）**，
   * 传 false 只为对照实验（「C 关」列）；环境变量 `SEGMENTER_EXP_C_OFF=1` 亦可关闭。
   */
  mergeCeiling?: boolean;
}

const ENV_CEILING_BEFORE_TOKEN = 'SEGMENTER_EXP_A';
const ENV_STRICT_CONTINUATION_GUARD = 'SEGMENTER_EXP_B';
const ENV_MERGE_CEILING_OFF = 'SEGMENTER_EXP_C_OFF';

function readExperimentalFlag(name: string): boolean {
  try {
    const proc = (globalThis as any).process;
    const value = proc && proc.env ? proc.env[name] : undefined;
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

/**
 * 核心断句算法 v0.2.6（v0.2.7 加守卫与安全阀；v0.4.2 加实验开关）：语言分策略 + 硬约束 + 后处理
 */
export function segmentCaptionTokens(
  tokens: CaptionToken[],
  settings: Pick<
    ExtensionSettings,
    | 'pauseThreshold'
    | 'maxWordsPerSentence'
    | 'minWordsPerSentence'
    | 'maxDurationMs'
    | 'autoPunctuation'
    | 'segmentationLanguage'
    | 'maxCharsPerSentence'
    | 'mergeShortFragments'
  >,
  experiments: SegmenterExperimentOptions = {}
): SubtitleSentence[] {
  if (tokens.length === 0) return [];

  const {
    pauseThreshold,
    maxWordsPerSentence,
    minWordsPerSentence,
    maxDurationMs,
    autoPunctuation,
    segmentationLanguage = 'auto',
    maxCharsPerSentence = 28,
    mergeShortFragments = true
  } = settings;

  // ─── 语言检测 ───
  let lang: StreamLanguage;
  if (segmentationLanguage === 'auto') {
    lang = detectStreamLanguage(tokens);
  } else {
    lang = segmentationLanguage as StreamLanguage;
  }
  const profile = getLanguageProfile(lang, minWordsPerSentence);

  // 超长停顿硬断阈值：不小于 800ms 且不低于 2× 用户停顿阈值
  const hardPauseMs = Math.max(800, pauseThreshold * 2);
  // v0.2.7 极端停顿阈值 = max(5s, 3×超长停顿阈值)：达到该值无条件切断
  // （即使劈词/悬空助词——说话人确实停了很久）。默认停顿阈值 450ms 时该线即 5s。
  const hardPauseExtremeMs = Math.max(5000, hardPauseMs * 3);

  // CJK 字符上限：用户可调（v0.2.6 前为硬编码 24/32）
  const cjkCharHardLimit = Math.max(12, Math.min(80, maxCharsPerSentence));

  // 断句单位硬上限（CJK 按字 / 拉丁按词），方案 A 的前置检查也要用，故提到循环外
  const unitHardLimit = profile.charBased ? cjkCharHardLimit : maxWordsPerSentence;

  // 实验开关（方案 A/B，默认关闭）：显式参数优先，其次环境变量（仅 Node 生效）
  const expCeilingBeforeToken =
    experiments.ceilingBeforeToken ?? readExperimentalFlag(ENV_CEILING_BEFORE_TOKEN);
  // 方案 B 已否决：默认 false，仅保留显式传参/环境变量用于复现对照结论，生产路径永不启用
  const expStrictContinuationGuard =
    experiments.strictContinuationGuard ?? readExperimentalFlag(ENV_STRICT_CONTINUATION_GUARD);
  // 方案 C（默认生效）：只有显式 false / SEGMENTER_EXP_C_OFF=1 才关闭，用于对照实验
  const expMergeCeiling = experiments.mergeCeiling ?? !readExperimentalFlag(ENV_MERGE_CEILING_OFF);

  // 最小安全时长：硬切不允许产生过短的句子
  const minSentenceDurationMs = 900;

  const sentences: SubtitleSentence[] = [];
  let currentGroup: CaptionToken[] = [];
  let sentenceId = 1;

  const flushCurrentGroup = () => {
    if (currentGroup.length === 0) return;

    let start = currentGroup[0].start;
    let end = currentGroup[currentGroup.length - 1].end;

    // 声学前瞻平滑补偿：消除约 0.2 秒（150ms ~ 200ms）滞后，使字幕在主播开口发音瞬间同步弹出
    if (sentences.length > 0) {
      const prevEnd = sentences[sentences.length - 1].end;
      if (start - prevEnd >= 220) {
        start = Math.max(prevEnd + 40, start - 150);
      }
    } else {
      start = Math.max(0, start - 150);
    }

    // 确保单句在屏幕上的停留时间不少于 900ms，避免闪烁
    if (end - start < minSentenceDurationMs) {
      end = start + minSentenceDurationMs;
    }

    const text = polishSentenceText(currentGroup, autoPunctuation, lang);

    // 纯标点句（如仅剩「。」）直接丢弃
    if (!/[^\s。！？….,、，！？：；)/\]}]/.test(text)) {
      currentGroup = [];
      return;
    }

    sentences.push({
      id: sentenceId++,
      start,
      end,
      text,
      rawTokens: [...currentGroup],
      status: 'idle'
    });

    currentGroup = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    // ─── 方案 A（实验，默认关闭）：2× 天花板前置 ───
    // 现状是「并入后再查」：突破 2× 的那个 token 已被吞进本句，末 token 更连检查都不走
    // （`if (!nextToken)` 早退），溢出量 = 该 token 自身时长（测试 20 可复现 14s > 13s 天花板）。
    // 这里改为并入前预测：若并入后将达 2× 时长/2× 字数，则先 flush，让破线 token 成为下一句开头。
    // 注意范围：真实轨最长的 14.35s 句主因是「短碎片合并 pass 无时长上限」，本方案治不到它
    // （实测 A 的最长句仍 14.35s，>13s 句 15→3；详见 docs/SEGMENTER-0.2.7.md 第七节）。
    if (expCeilingBeforeToken && currentGroup.length > 0) {
      let projectedChars = token.text.length;
      for (const t of currentGroup) {
        projectedChars += t.text.length;
      }
      const projectedUnits = profile.charBased ? projectedChars : currentGroup.length + 1;
      const projectedDuration = token.end - currentGroup[0].start;
      if (projectedDuration >= maxDurationMs * 2 || projectedUnits >= unitHardLimit * 2) {
        flushCurrentGroup();
      }
    }

    currentGroup.push(token);

    if (!nextToken) {
      flushCurrentGroup();
      break;
    }

    const wordCount = currentGroup.length;
    const currentDuration = token.end - currentGroup[0].start;
    const gap = token.gapToNext;

    // 计算当前群组的总字符数以及是否为 CJK（日文/中文）
    let groupCharLength = 0;
    let containsCjk = false;
    for (const t of currentGroup) {
      groupCharLength += t.text.length;
      if (!containsCjk && isCjkText(t.text)) {
        containsCjk = true;
      }
    }

    // 断句单位数：CJK 按字计，拉丁按词计
    const unitCount = profile.charBased ? groupCharLength : wordCount;

    const nextWordLower = nextToken.text.trim().toLowerCase().replace(/[^a-z]/g, '');
    const nextRaw = nextToken.text.trim().replace(/^[。！？…、，,.!?]+/, '').replace(/[、，,]+$/, '');
    const isNextCjkStarter = profile.useJapaneseGrammar && JAPANESE_SENTENCE_STARTERS.has(nextRaw);

    // v0.2.7 语序/防劈词守卫（约束硬切与常规停顿；源标点与极端停顿不受限）：
    // A. 防劈词回退——下一 token 以接续形态开头，或当前组末 token 停在未完成活用形上
    //    （单字粒度 ASR：…「つけ」「た」「ん」「やけど」逐字输出，切哪一刀都在词内），不切；
    // B. 悬空格助词防断——当前组以格助词（を/が/に…）结尾时，切开会产出 SOV 悬空宾语行，不切；
    //    但下一 token 是合法新句开头（じゃあ/はい/でも…）时除外——那是说话人另起话轮。
    const nextIsContinuation = startsWithJapaneseContinuation(nextToken.text, expStrictContinuationGuard);
    const prevEndsUnfinished = endsWithUnfinishedForm(token.text, expStrictContinuationGuard);
    const nextIsSentenceStart = profile.useJapaneseGrammar && JA_ALLOWED_SENTENCE_STARTERS.has(nextRaw);
    const wordSplitGuard = nextIsContinuation || prevEndsUnfinished;
    const groupEndsHanging = endsWithBareCaseParticle(token.text) && !nextIsSentenceStart;

    let shouldBreak = false;

    // ── 规则 1: 句末终止标点（。！？… ；英语含缩写保护；忠实源标点不守卫） ──
    if (hasSentenceTerminalPunctuation(token.text, lang)) {
      shouldBreak = true;
    }
    // ── 规则 2a【硬】: 极端停顿（>=5s）无条件断句——说话人确实长时间停顿，劈词也要切 ──
    else if (gap >= hardPauseExtremeMs) {
      shouldBreak = true;
    }
    // ── 规则 2b【硬】: 超长停顿断句（守卫生效时延后：词中换气不劈词） ──
    else if (gap >= hardPauseMs && !wordSplitGuard && !groupEndsHanging) {
      shouldBreak = true;
    }
    // ── 规则 3【硬】: 单句时长达到上限强制切断（守卫生效时延后） ──
    // 安全阀：守卫连续生效导致时长/长度达到 2 倍上限时，无视守卫强制切断，避免无限吞句
    else if (currentDuration >= maxDurationMs * 2) {
      shouldBreak = true;
    } else if (currentDuration >= maxDurationMs && !wordSplitGuard && !groupEndsHanging) {
      shouldBreak = true;
    }
    // ── 规则 4【硬】: 长度达到上限强制切断（守卫生效时延后；2 倍上限为绝对天花板） ──
    else if (unitCount >= unitHardLimit * 2) {
      shouldBreak = true;
    } else if (unitCount >= unitHardLimit && !wordSplitGuard && !groupEndsHanging) {
      shouldBreak = true;
    }
    // ── 规则 5: 常规停顿（换气）+ 最小单位数（守卫生效时延后） ──
    else if (
      gap >= pauseThreshold &&
      unitCount >= profile.minBreakUnits &&
      !wordSplitGuard &&
      !groupEndsHanging
    ) {
      shouldBreak = true;
    }
    // ── 规则 6 (日语专属): 句末助词/敬语结语 + 轻停顿或新句叹词 ──
    else if (
      profile.useJapaneseGrammar &&
      containsCjk &&
      endsWithJapaneseTerminal(token.text) &&
      groupCharLength >= profile.jaTerminalMinChars &&
      (gap >= 160 || isNextCjkStarter)
    ) {
      shouldBreak = true;
    }
    // ── 规则 7 (日语专属): 接续助词（けど/から/ので…）+ 中等停顿 ──
    else if (
      profile.useJapaneseGrammar &&
      containsCjk &&
      endsWithJapaneseConnector(token.text) &&
      groupCharLength >= 12 &&
      gap >= 200
    ) {
      shouldBreak = true;
    }
    // ── 规则 8: 下一个词是明确的新句开头（英语强连词 / 日语叹词） ──
    else if (
      (profile.useEnglishGrammar && STRONG_CLAUSE_STARTERS.has(nextWordLower)) ||
      isNextCjkStarter
    ) {
      if (gap >= 180 && unitCount >= profile.minBreakUnits) {
        shouldBreak = true;
      }
    }
    // ── 规则 9 (英语专属): 弱连词 (and, but, so…) + 中等停顿 ──
    else if (
      profile.useEnglishGrammar &&
      SECONDARY_CONJUNCTIONS.has(nextWordLower) &&
      gap >= Math.max(240, pauseThreshold * 0.6) &&
      wordCount >= 5
    ) {
      shouldBreak = true;
    }

    if (shouldBreak) {
      flushCurrentGroup();
    }
  }

  // ─── 后处理 1: 短碎片合并（无终止标点的碎片并入相邻句） ───
  // 方案 C（默认生效）：合并是**累计**过程，必须有累计上限，否则「7.67s 碎片 + 6.68s 句」会缝成 14.35s。
  // 闸门取「主循环对单句的同一组上限」，两条都来自用户设置，不新增硬编码常量：
  //   · 时长 <= maxDurationMs
  //   · 长度 <= unitHardLimit（CJK 按字 = maxCharsPerSentence；拉丁按词 = maxWordsPerSentence，
  //     与主循环 unitCount 同口径——若对英文也用 28「字符」这一条，会把英文轨的合并整体关死）
  // 位置在最外层：超限只是「不合并」，不改守卫 A/B 的判定，也不丢任何 token。
  const mergeCeilingDurationMs = maxDurationMs;
  const mergeCeilingUnits = unitHardLimit;

  const fitsMergeCeiling = (
    headTokens: CaptionToken[],
    tailTokens: CaptionToken[],
    start: number,
    end: number
  ): boolean => {
    if (!expMergeCeiling) return true;
    if (end - start > mergeCeilingDurationMs) return false;
    const joined = headTokens.concat(tailTokens);
    if (profile.charBased) {
      let chars = 0;
      for (const t of joined) chars += [...t.text].length;
      return chars <= mergeCeilingUnits;
    }
    return joined.length <= mergeCeilingUnits;
  };

  if (mergeShortFragments) {
    const merged: SubtitleSentence[] = [];
    for (let i = 0; i < sentences.length; i++) {
      const cur = sentences[i];
      const curRawTokens = cur.rawTokens || [];
      const curUnits = profile.charBased ? [...cur.text].length : cur.text.split(/\s+/).length;
      const lastRaw = curRawTokens[curRawTokens.length - 1]?.text || cur.text;
      const hasTerminal = /[.!?。！？…]$/.test(lastRaw.trim());
      const fragmentThreshold = profile.charBased ? 6 : 3;

      const next = sentences[i + 1];
      const prev = merged[merged.length - 1];
      const gapToNext = next ? next.start - cur.end : Infinity;

      if (!hasTerminal && curUnits < fragmentThreshold) {
        if (next && gapToNext <= 900) {
          const nextRawTokens = next.rawTokens || [];
          const mergedStart = Math.min(cur.start, next.start);
          // 上限拒绝：cur 与 next 各自保留为独立句（内容不丢、不新造碎片），也不再改投上一句
          // ——否则只是把超长从「后一句」转移到「前一句」，闸门形同虚设。
          if (fitsMergeCeiling(curRawTokens, nextRawTokens, mergedStart, next.end)) {
            // 并入下一句
            const joinedTokens = [...curRawTokens, ...nextRawTokens];
            const joinedText = polishSentenceText(joinedTokens, autoPunctuation, lang);
            const mergedSentence: SubtitleSentence = {
              id: 0,
              start: mergedStart,
              end: next.end,
              text: joinedText,
              rawTokens: joinedTokens,
              status: 'idle'
            };
            sentences[i + 1] = mergedSentence;
            continue;
          }
          merged.push(cur);
          continue;
        } else if (prev && cur.start - prev.end <= 900) {
          const prevRawTokens = prev.rawTokens || [];
          const mergedStart = Math.min(prev.start, cur.start);
          const mergedEnd = Math.max(prev.end, cur.end);
          if (fitsMergeCeiling(prevRawTokens, curRawTokens, mergedStart, mergedEnd)) {
            // 并入上一句
            const joinedTokens = [...prevRawTokens, ...curRawTokens];
            const joinedText = polishSentenceText(joinedTokens, autoPunctuation, lang);
            merged[merged.length - 1] = {
              ...prev,
              end: mergedEnd,
              text: joinedText,
              rawTokens: joinedTokens
            };
            continue;
          }
        }
      }
      merged.push(cur);
    }
    sentences.length = 0;
    sentences.push(...merged);
  }

  // ─── 后处理 2: 相邻句时间轴去重叠 ───
  for (let i = 0; i < sentences.length - 1; i++) {
    const cur = sentences[i];
    const next = sentences[i + 1];
    if (cur.end > next.start) {
      // 保底显示时长 400ms，避免负时长
      cur.end = Math.max(cur.start + 400, next.start);
      if (cur.end > next.start) {
        // 极端情况（两句几乎同时开始）：压缩下一句起点
        next.start = cur.end;
      }
    }
  }

  // ─── 后处理 3: 重新编号 ───
  for (let i = 0; i < sentences.length; i++) {
    sentences[i].id = i + 1;
  }

  return sentences;
}
