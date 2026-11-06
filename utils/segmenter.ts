import type {
  Json3CaptionData,
  CaptionToken,
  SubtitleSentence,
  ExtensionSettings
} from '../types';
import { normalizeCaptionResponse, decodeHtmlEntities } from './caption-parser';

/**
 * 常见英语简写词列表，避免因句点错误断句
 */
const COMMON_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'vs.', 'etc.', 'i.e.', 'e.g.',
  'u.s.', 'u.k.', 'inc.', 'ltd.', 'corp.', 'jr.', 'sr.', 'st.', 'ave.'
]);

/**
 * 常见疑问句起始词
 */
const QUESTION_STARTERS = new Set([
  'what', 'why', 'how', 'who', 'whom', 'whose', 'where', 'when', 'which',
  'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might',
  'have', 'has', 'had'
]);

/**
 * 强从句连词和转折词（新句常见首词）
 */
const STRONG_CLAUSE_STARTERS = new Set([
  'however', 'therefore', 'moreover', 'furthermore', 'meanwhile',
  'finally', 'secondly', 'thirdly', 'basically', 'actually', 'incidentally',
  'nonetheless', 'nevertheless', 'conversely', 'otherwise'
]);

/**
 * 次级连词
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
  'ありがとう', 'ございます', 'よろしく', 'お願い'
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
 * 判断是否含有中日韩文字 (CJK)
 */
function isCjkText(str: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}

/**
 * 判断词尾是否具有断句标点符号
 */
function hasSentenceTerminalPunctuation(word: string): boolean {
  const clean = word.trim().toLowerCase();
  if (COMMON_ABBREVIATIONS.has(clean)) {
    return false;
  }
  return /[.!?。！？\n]$/.test(clean);
}

/**
 * 检查日文字符串是否以句末助词/结语结尾
 */
function endsWithJapaneseTerminal(text: string): boolean {
  const clean = text.trim();
  for (const ending of JAPANESE_SENTENCE_ENDINGS) {
    if (clean.endsWith(ending)) {
      return true;
    }
  }
  return false;
}

/**
 * 检查日文字符串是否以转折/连接助词结尾
 */
function endsWithJapaneseConnector(text: string): boolean {
  const clean = text.trim();
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
  end: number
): Array<{ text: string; start: number; end: number }> {
  const clean = text.replace(/[\r\n]+/g, ' \n ').trim();
  if (!clean) return [];

  // 标点分割正则（保留分隔符）
  const parts = clean.split(/([。！？!?\n]+)/);
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
    if (/[。！？!?\n]+/.test(part) || i === parts.length - 1) {
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
 * 从 YouTube Timedtext JSON3 原始数据解析出单词/词元级别的 Token 列表
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
            rawTokens.push(sub);
          }
        }
      }
      continue;
    }

    for (let i = 0; i < event.segs.length; i++) {
      const seg = event.segs[i];
      const text = seg.utf8 ? decodeHtmlEntities(seg.utf8).trim() : '';
      if (!text) continue;

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
      if (/[。！？!?\n]/.test(text)) {
        const subTokens = splitRawSegmentByPunctuation(text, segStart, segEnd);
        for (const sub of subTokens) {
          rawTokens.push(sub);
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
      if (next.start > end) {
        gapToNext = next.start - end;
      } else {
        end = Math.min(end, next.start);
        gapToNext = 0;
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
 * - CJK 与 CJK 之间不插空格
 * - 标点前不插空格，左括号后不插空格
 */
function shouldInsertSpace(prev: string, curr: string): boolean {
  if (!prev || !curr) return false;
  // 闭合标点/右括号前不加空格
  if (/^[.,!?;:%)\]}、。，！？：；）】」』]/.test(curr)) return false;
  // 左括号后不加空格
  if (/[(\[{（【「『]$/.test(prev)) return false;
  // CJK 字符之间不加空格
  if (isCjkText(prev) && isCjkText(curr)) return false;
  return true;
}

/**
 * 智能大小写与句末标点自动修补（支持日文平假片假汉字无空格自然拼接与英文自然空格拼接）
 */
function polishSentenceText(tokens: CaptionToken[], autoPunctuation: boolean): string {
  if (tokens.length === 0) return '';

  let rawJoined = tokens[0].text;
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1].text;
    const curr = tokens[i].text;
    rawJoined += shouldInsertSpace(prev, curr) ? ' ' + curr : curr;
  }
  rawJoined = rawJoined.trim();

  if (!autoPunctuation) {
    return rawJoined;
  }

  // 首字母大写处理 (仅对拉丁字母有效)
  let polished = rawJoined.charAt(0).toUpperCase() + rawJoined.slice(1);

  // 检查末尾是否已有标点
  if (!/[.!?。！？]$/.test(polished)) {
    const isCjk = isCjkText(polished);
    const firstWord = tokens[0].text.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (QUESTION_STARTERS.has(firstWord) || /[かかい]$/.test(polished)) {
      polished += isCjk ? '？' : '?';
    } else {
      polished += isCjk ? '。' : '.';
    }
  }

  return polished;
}

/**
 * 核心升级版断句算法：
 * 深度融合日文句末助词、转折接续、CJK 字符数与声学停顿，将连续语音词流智能重组为自然优雅的句子
 */
export function segmentCaptionTokens(
  tokens: CaptionToken[],
  settings: Pick<
    ExtensionSettings,
    'pauseThreshold' | 'maxWordsPerSentence' | 'minWordsPerSentence' | 'maxDurationMs' | 'autoPunctuation'
  >
): SubtitleSentence[] {
  if (tokens.length === 0) return [];

  const sentences: SubtitleSentence[] = [];
  let currentGroup: CaptionToken[] = [];
  let sentenceId = 1;

  const {
    pauseThreshold,
    maxWordsPerSentence,
    minWordsPerSentence,
    maxDurationMs,
    autoPunctuation
  } = settings;

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
    if (end - start < 900) {
      end = start + 900;
    }

    const text = polishSentenceText(currentGroup, autoPunctuation);

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

    const nextWordLower = nextToken.text.trim().toLowerCase().replace(/[^a-z]/g, '');
    const isNextCjkStarter = JAPANESE_SENTENCE_STARTERS.has(nextToken.text.trim());

    let shouldBreak = false;

    // 规则 1: 自身自带明确的句末标点（如 . ! ? 。 ！）
    if (hasSentenceTerminalPunctuation(token.text)) {
      shouldBreak = true;
    }
    // 规则 2: 停顿超过常规阈值（说话人换气/较长停顿）
    else if (gap >= pauseThreshold) {
      if (containsCjk) {
        // CJK 字符只要达到 4 个字以上即可断句
        if (groupCharLength >= 4) shouldBreak = true;
      } else {
        if (wordCount >= minWordsPerSentence) shouldBreak = true;
      }
    }
    // 规则 3 (日文专属核心优化): 遇到日文句末助词/敬语结语 (如「ですね」「ました」「だよ」「んだよね」等)
    else if (containsCjk && endsWithJapaneseTerminal(token.text) && groupCharLength >= 8) {
      // 只要稍微有一点停顿 (>= 160ms) 或下一个词是叹词接续词，立即确认断句
      if (gap >= 160 || isNextCjkStarter) {
        shouldBreak = true;
      }
    }
    // 规则 4 (日文从句与转折连接): 遇到「けど」「から」「ので」「のに」等 + 中等停顿
    else if (containsCjk && endsWithJapaneseConnector(token.text) && groupCharLength >= 12 && gap >= 200) {
      shouldBreak = true;
    }
    // 规则 5: 下一个词是明确的新句开头 (英文强从句连词或日文接续词/语气词)
    else if (
      (STRONG_CLAUSE_STARTERS.has(nextWordLower) || isNextCjkStarter) &&
      gap >= 180 &&
      (containsCjk ? groupCharLength >= 6 : wordCount >= minWordsPerSentence)
    ) {
      shouldBreak = true;
    }
    // 规则 6: 英文弱连词 (and, but, so, because) + 中等停顿
    else if (
      !containsCjk &&
      SECONDARY_CONJUNCTIONS.has(nextWordLower) &&
      gap >= Math.max(240, pauseThreshold * 0.6) &&
      wordCount >= 5
    ) {
      shouldBreak = true;
    }
    // 规则 7: 达到舒适长度上限 (CJK 字符数 >= 24 或 英文词数 >= maxWordsPerSentence)
    else if (
      (containsCjk && groupCharLength >= 24) ||
      (!containsCjk && wordCount >= maxWordsPerSentence) ||
      currentDuration >= maxDurationMs
    ) {
      // 达到长度上限后，只要有轻度停顿 (>= 130ms) 或处于从句连词，立刻平滑切分
      if (
        gap >= 130 ||
        SECONDARY_CONJUNCTIONS.has(nextWordLower) ||
        isNextCjkStarter ||
        groupCharLength >= 32
      ) {
        shouldBreak = true;
      }
    }

    if (shouldBreak) {
      flushCurrentGroup();
    }
  }

  return sentences;
}
