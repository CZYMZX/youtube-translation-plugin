import type { Json3CaptionData, Json3Event, CaptionToken } from '../types';

/**
 * 完整解码常见 HTML 实体（单趟替换，避免 &amp;lt; 被二重解码篡改原文）
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str.replace(/&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#x([0-9a-fA-F]+));/gi, (match, named, dec, hex) => {
    if (named) {
      return NAMED_HTML_ENTITIES[named.toLowerCase()] ?? match;
    }
    if (dec) {
      try {
        const cp = Number(dec);
        return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
      } catch {
        return match;
      }
    }
    if (hex) {
      try {
        const cp = parseInt(hex, 16);
        return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
      } catch {
        return match;
      }
    }
    return match;
  });
}

/**
 * 将 WebVTT 时间戳 (00:01:23.456 或 01:23.456) 转换为毫秒数
 */
function parseVttTimestamp(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const seconds = parseFloat(parts[1]);
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  return 0;
}

/**
 * 从 WebVTT 原始文本解析为标准 Json3CaptionData 结构
 */
export function parseVttToCaptionData(vttText: string): Json3CaptionData {
  const events: Json3Event[] = [];
  const lines = vttText.split(/\r?\n/);
  const timeRegex = /((?:\d+:)?\d{2}:\d{2}[\.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[\.,]\d{3})/;

  let currentStart = -1;
  let currentEnd = -1;
  let currentTextLines: string[] = [];
  let inSkippedBlock = false;

  const flush = () => {
    if (currentStart >= 0 && currentEnd >= currentStart && currentTextLines.length > 0) {
      const text = decodeHtmlEntities(currentTextLines.join(' ')).trim();
      if (text) {
        events.push({
          tStartMs: currentStart,
          dDurationMs: Math.max(100, currentEnd - currentStart),
          segs: [{ utf8: text }]
        });
      }
    }
    currentStart = -1;
    currentEnd = -1;
    currentTextLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      inSkippedBlock = false;
      continue;
    }
    if (inSkippedBlock) continue;
    if (trimmed === 'WEBVTT') continue;
    if (trimmed.startsWith('NOTE') || trimmed.startsWith('STYLE') || trimmed.startsWith('REGION')) {
      flush();
      inSkippedBlock = true;
      continue;
    }

    const match = trimmed.match(timeRegex);
    if (match) {
      flush();
      const s = parseVttTimestamp(match[1].replace(',', '.'));
      const e = parseVttTimestamp(match[2].replace(',', '.'));
      currentStart = Number.isFinite(s) && s >= 0 ? s : -1;
      currentEnd = Number.isFinite(e) && e >= 0 ? e : -1;
    } else if (currentStart >= 0) {
      // 仅去除合法 VTT 标签与内联时间戳标签，避免把正文里的 `x < 5` 截断到行尾
      const cleanLine = trimmed
        .replace(/<\/?(?:c|i|b|u|v|lang|ruby|rt)\b[^>]*>/gi, '')
        .replace(/<\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}>/g, '');
      if (cleanLine) {
        currentTextLines.push(cleanLine);
      }
    }
  }

  flush();
  return { wireMagic: 'pb3', events };
}

/**
 * 从 YouTube Timedtext XML 文本解析为标准 Json3CaptionData 格式
 * 兼容经典 <transcript><text start="1.23" dur="4.56">...</text></transcript>
 * 以及新式 <timedtext format="3"><body><p t="1000" d="2000"><s>...</s></p></body></timedtext>
 */
export function parseXmlToCaptionData(xmlText: string): Json3CaptionData {
  const events: Json3Event[] = [];

  // 1. 尝试匹配经典 <text start="1.2" dur="3.4">Hello</text>（排除自闭合 <text .../>）
  const sanitizedXml = xmlText.replace(/<(?:text|p)\b[^>]*\/>/gi, '');
  const textRegex = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/gi;
  let textMatch: RegExpExecArray | null;
  let foundClassic = false;

  while ((textMatch = textRegex.exec(sanitizedXml)) !== null) {
    foundClassic = true;
    const attrs = textMatch[1];
    const rawContent = textMatch[2];

    const startMatch = attrs.match(/\bstart=["']([0-9.]+)["']/i);
    const durMatch = attrs.match(/\bdur=["']([0-9.]+)["']/i);

    const parsedStart = startMatch ? parseFloat(startMatch[1]) : 0;
    const parsedDur = durMatch ? parseFloat(durMatch[1]) : 1.5;
    const startSec = Number.isFinite(parsedStart) && parsedStart >= 0 ? parsedStart : 0;
    const durSec = Number.isFinite(parsedDur) && parsedDur >= 0 ? parsedDur : 1.5;

    const cleanText = decodeHtmlEntities(rawContent.replace(/<[^>]+>/g, '')).trim();
    if (cleanText) {
      events.push({
        tStartMs: Math.round(startSec * 1000),
        dDurationMs: Math.max(100, Math.round(durSec * 1000)),
        segs: [{ utf8: cleanText }]
      });
    }
  }

  if (foundClassic && events.length > 0) {
    return { wireMagic: 'pb3', events };
  }

  // 2. 尝试匹配 <p t="1000" d="2000"><s>...</s></p> 格式（已剔除自闭合清屏标签 <p .../>，杜绝吞句）
  const pRegex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(sanitizedXml)) !== null) {
    const attrs = pMatch[1];
    const rawContent = pMatch[2];

    const tMatch = attrs.match(/\bt=["']([0-9]+)["']/i);
    const dMatch = attrs.match(/\bd=["']([0-9]+)["']/i);

    const parsedT = tMatch ? parseInt(tMatch[1], 10) : 0;
    const parsedD = dMatch ? parseInt(dMatch[1], 10) : 1500;
    const tMs = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : 0;
    const dMs = Number.isFinite(parsedD) && parsedD >= 0 ? parsedD : 1500;

    // 提取子标签 <s> 中的片段：任意属性顺序提取 t="..."，且保留词间前导空格防英文词粘连
    const sRegex = /<s(\s+[^>]*)?>([\s\S]*?)<\/s>/gi;
    let sMatch: RegExpExecArray | null;
    const segs: Array<{ utf8: string; tOffsetMs?: number }> = [];

    while ((sMatch = sRegex.exec(rawContent)) !== null) {
      const sAttrs = sMatch[1] || '';
      const sOffsetMatch = sAttrs.match(/\bt=["']([0-9]+)["']/i);
      const parsedOffset = sOffsetMatch ? parseInt(sOffsetMatch[1], 10) : undefined;
      const sOffset = parsedOffset !== undefined && Number.isFinite(parsedOffset) ? parsedOffset : undefined;
      const sText = decodeHtmlEntities(sMatch[2].replace(/<[^>]+>/g, ''));
      if (sText.trim()) {
        segs.push({ utf8: sText, tOffsetMs: sOffset });
      }
    }

    if (segs.length > 0) {
      events.push({
        tStartMs: tMs,
        dDurationMs: dMs,
        segs
      });
    } else {
      const cleanPText = decodeHtmlEntities(rawContent.replace(/<[^>]+>/g, '')).trim();
      if (cleanPText) {
        events.push({
          tStartMs: tMs,
          dDurationMs: dMs,
          segs: [{ utf8: cleanPText }]
        });
      }
    }
  }

  return { wireMagic: 'pb3', events };
}

/**
 * 万能多格式字幕数据解析器：
 * 自动识别并解析 JSON3、XML (timedtext/transcript)、WebVTT
 */
export function normalizeCaptionResponse(rawInput: any): Json3CaptionData {
  if (!rawInput) {
    return { wireMagic: 'pb3', events: [] };
  }

  // 若已经是解析好的 JSON 对象且含有 events
  if (typeof rawInput === 'object') {
    if (Array.isArray(rawInput.events)) {
      // 深度清洗 segs 中的 HTML 转义字符（带空值守卫，避免畸形 null event 抛 TypeError）
      for (const ev of rawInput.events) {
        if (ev && Array.isArray(ev.segs)) {
          for (const seg of ev.segs) {
            if (seg && typeof seg.utf8 === 'string') {
              seg.utf8 = decodeHtmlEntities(seg.utf8);
            }
          }
        }
      }
      return rawInput as Json3CaptionData;
    }
  }

  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return { wireMagic: 'pb3', events: [] };
    }

    // 1. 若以 { 开头，优先尝试 JSON.parse
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && Array.isArray(parsed.events)) {
          for (const ev of parsed.events) {
            if (ev && Array.isArray(ev.segs)) {
              for (const seg of ev.segs) {
                if (seg && typeof seg.utf8 === 'string') {
                  seg.utf8 = decodeHtmlEntities(seg.utf8);
                }
              }
            }
          }
          return parsed as Json3CaptionData;
        }
        // JSON 合法但不是可识别字幕结构：明确返回空，避免继续按 VTT/XML 误判
        if (parsed && typeof parsed === 'object') {
          console.warn('[CaptionParser] JSON 响应缺少 events 数组，按空字幕处理');
          return { wireMagic: 'pb3', events: [] };
        }
      } catch (e) {
        console.warn('[CaptionParser] JSON.parse failed, fallback to format sniff:', e);
      }
    }

    // 2. 明确 XML 前缀优先于宽泛 `-->` VTT 检测（防止 XML 正文出现 `--> 10:00` 被误判）
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<transcript') || trimmed.startsWith('<timedtext')) {
      return parseXmlToCaptionData(trimmed);
    }

    // 3. WebVTT 格式检测
    if (trimmed.startsWith('WEBVTT') || /-->\s*\d{1,2}:\d{2}/.test(trimmed)) {
      return parseVttToCaptionData(trimmed);
    }

    // 4. XML 兜底检测
    if (trimmed.includes('<transcript') || trimmed.includes('<timedtext') || trimmed.includes('<text ') || trimmed.includes('<p ')) {
      return parseXmlToCaptionData(trimmed);
    }
  }

  return { wireMagic: 'pb3', events: [] };
}
