/**
 * 字幕字体（v0.5.6）
 * ----------------------------------------------------------------------------
 * 两条互不干扰的通道：
 *   1. **内置字体**：只存 CSS font-family 栈，不打包任何字体文件 —— 用户装了什么
 *      字体就用什么，没装则沿栈回落到系统默认。零体积、零网络请求。
 *   2. **用户上传字体**：文件以 base64 data URL 形式存 `chrome.storage.local`
 *      （体积远超 sync 的 100KB 配额），运行时用 `FontFace(name, ArrayBuffer)`
 *      注册到 `document.fonts`，**一次注册、按 id 去重**，绝不每次渲染 new 一个。
 *
 * 语言维度是硬要求：中日英韩「其它」五个分组各自独立存储 / 展示，
 * 上传时必须由用户选语言（或按文件名给一个可改的默认判断），不允许一律丢进「其它」。
 *
 * 本模块只依赖 DOM 标准 API，不 import 任何其它业务模块（types 只做类型引用），
 * 这样 content script / options / popup 三处都能直接用，不会拉进存储层或运行时依赖。
 */
/** 字体所属语言；'other' = 其它 / 未归类（仍然独立成组，不混进中日英韩） */
export type FontLang = 'zh' | 'ja' | 'en' | 'ko' | 'other';

export interface BuiltinFont {
  /** 如 'system' / 'yahei' / 'noto-jp' */
  id: string;
  /** 展示名 */
  name: string;
  language: FontLang;
  /** CSS font-family 栈；空串 = 跟随 YouTube 默认（清掉内联属性，走继承） */
  stack: string;
  /** 适用场景的一句话说明 */
  note?: string;
}

export interface CustomFontPack {
  /** 'font-' + 时间戳/随机 */
  id: string;
  /** 用户看到的名称（默认取文件名去扩展名） */
  name: string;
  /** 上传时让用户选语言 */
  language: FontLang;
  /** 'truetype' | 'opentype' | 'woff' | 'woff2' */
  format: string;
  /** 解码后的字节数（由 base64 长度反算，不信存储里的自报值） */
  size: number;
  /** base64 data URL；只进 local，绝不进 sync */
  dataUrl: string;
  createdAt: number;
}

/** 语言分组（顺序即界面 tab 顺序）；'other' 独立成组，不与「自定义全部」混淆 */
export const FONT_LANGS: ReadonlyArray<{ id: FontLang; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日文' },
  { id: 'en', label: '英文' },
  { id: 'ko', label: '韩文' },
  { id: 'other', label: '其它' }
];

/** 单文件 / 累计上限（与设置页提示文案同一份数字，不各写一遍） */
export const MAX_CUSTOM_FONT_BYTES = 5 * 1024 * 1024;
export const MAX_CUSTOM_FONTS_TOTAL_BYTES = 20 * 1024 * 1024;
/** 条数上限：兜住「无数个 0 字节垃圾条目」这种极端情况，正常用户远用不到 */
export const MAX_CUSTOM_FONTS = 24;

/** 默认字体 id：不写 font-family，跟随 YouTube 自己的字体 */
export const DEFAULT_FONT_FAMILY = 'system';

const VALID_FORMATS = ['truetype', 'opentype', 'woff', 'woff2'] as const;

/**
 * 内置字体表（按语言分组，全部是系统字体栈）。
 * 每组第一个都是「系统默认」——它的 stack 是空串，选中即清空内联 font-family，
 * 回到 YouTube 默认字体；这也保证「切回默认」不看系统里装了什么。
 */
export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  /* ── 中文 ── */
  { id: 'system', name: '系统默认', language: 'zh', stack: '', note: '跟随 YouTube 自带字体' },
  {
    id: 'yahei',
    name: '微软雅黑',
    language: 'zh',
    stack: '"Microsoft YaHei", "Microsoft JhengHei", sans-serif',
    note: '中文正文，字重均匀'
  },
  {
    id: 'source-han',
    name: '思源黑体',
    language: 'zh',
    stack: '"Source Han Sans SC", "Noto Sans SC", "Source Han Sans CN", sans-serif',
    note: '开源黑体，笔画干净，长句耐看'
  },
  {
    id: 'pingfang',
    name: '苹方',
    language: 'zh',
    stack: '"PingFang SC", "Hiragino Sans GB", sans-serif',
    note: 'macOS / iOS 默认中文，字形现代'
  },
  {
    id: 'simsun',
    name: '宋体',
    language: 'zh',
    stack: '"SimSun", "Songti SC", serif',
    note: '传统衬线，适合旁白与歌词'
  },
  {
    id: 'kaiti',
    name: '楷体',
    language: 'zh',
    stack: '"KaiTi", "STKaiti", "Kaiti SC", serif',
    note: '手写感强，适合抒情内容'
  },

  /* ── 日文 ── */
  { id: 'system-ja', name: '系统默认', language: 'ja', stack: '', note: '跟随 YouTube 自带字体' },
  {
    id: 'noto-jp',
    name: 'Noto Sans JP',
    language: 'ja',
    stack: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
    note: '日文黑体，假名字面均匀'
  },
  {
    id: 'mincho',
    name: '明朝',
    language: 'ja',
    stack: '"Yu Mincho", "Hiragino Mincho ProN", "MS Mincho", serif',
    note: '日文衬线，适合歌词与文学性台词'
  },
  {
    id: 'meiryo',
    name: 'メイリオ',
    language: 'ja',
    stack: '"Meiryo", "Segoe UI", sans-serif',
    note: 'Windows 日文默认，字形偏圆'
  },

  /* ── 英文 ── */
  { id: 'system-en', name: '系统默认', language: 'en', stack: '', note: '跟随 YouTube 自带字体' },
  {
    id: 'inter',
    name: 'Inter',
    language: 'en',
    stack: '"Inter", system-ui, -apple-system, sans-serif',
    note: '屏幕友好无衬线，数字与英文都清晰'
  },
  {
    id: 'roboto',
    name: 'Roboto',
    language: 'en',
    stack: '"Roboto", "Helvetica Neue", sans-serif',
    note: 'Android 观感，紧凑中性'
  },
  {
    id: 'arial',
    name: 'Arial',
    language: 'en',
    stack: '"Arial", "Helvetica", sans-serif',
    note: '通用无衬线，兼容性最好'
  },
  {
    id: 'georgia',
    name: 'Georgia',
    language: 'en',
    stack: '"Georgia", "Times New Roman", serif',
    note: '衬线，适合歌词与长句'
  },
  {
    id: 'times',
    name: 'Times',
    language: 'en',
    stack: '"Times New Roman", "Times", serif',
    note: '经典衬线，正式感强'
  },

  /* ── 韩文 ── */
  { id: 'system-ko', name: '系统默认', language: 'ko', stack: '', note: '跟随 YouTube 自带字体' },
  {
    id: 'noto-kr',
    name: 'Noto Sans KR',
    language: 'ko',
    stack: '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
    note: '韩文黑体，谚文字形完整'
  }
];

/** 自定义字体未命中时，按语言给一条兜底栈（中文/日文优先自家的系统黑体） */
const CUSTOM_FALLBACK_STACK: Record<FontLang, string> = {
  zh: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  ja: '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif',
  en: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  ko: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  other: 'system-ui, sans-serif'
};

export function isFontLang(value: unknown): value is FontLang {
  return value === 'zh' || value === 'ja' || value === 'en' || value === 'ko' || value === 'other';
}

export function findBuiltinFont(id: string | undefined | null): BuiltinFont | undefined {
  if (!id) return undefined;
  return BUILTIN_FONTS.find((font) => font.id === id);
}

export function findCustomFont(
  fonts: readonly CustomFontPack[] | undefined | null,
  id: string | undefined | null
): CustomFontPack | undefined {
  if (!id || !fonts || fonts.length === 0) return undefined;
  return fonts.find((font) => font.id === id);
}

/** 内置字体按语言分组（不含「其它」，那一组正常情况下没有内置项） */
export function builtinFontsOf(language: FontLang): BuiltinFont[] {
  return BUILTIN_FONTS.filter((font) => font.language === language);
}

export function customFontsOf(
  fonts: readonly CustomFontPack[] | undefined | null,
  language: FontLang
): CustomFontPack[] {
  if (!fonts || fonts.length === 0) return [];
  return fonts.filter((font) => font.language === language);
}

/** FontFace 使用的 family 名：带前缀 + id，避免与页面/用户字体重名 */
export function customFontFamily(id: string): string {
  return `YTSF-${id}`;
}

/** 自定义字体在 CSS 里的栈：自己的 family 打头，后面跟同语言的系统兜底 */
export function customFontStack(pack: CustomFontPack): string {
  return `"${customFontFamily(pack.id)}", ${CUSTOM_FALLBACK_STACK[pack.language]}`;
}

/** 一个字体 id（内置或自定义）对应的 CSS 栈；空串 = 跟随 YouTube 默认 */
export function fontStackOf(
  fontFamily: string | undefined,
  customFonts: readonly CustomFontPack[] | undefined
): string {
  const id = typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily.trim() : DEFAULT_FONT_FAMILY;
  const builtin = findBuiltinFont(id);
  if (builtin) return builtin.stack;
  const custom = findCustomFont(customFonts, id);
  if (custom) return customFontStack(custom);
  /* 未知 id（字体被删掉 / 手改过 storage）→ 回退跟随默认，不把非法字符串拼进样式 */
  return '';
}

/**
 * 解析「当前该用哪条栈」并顺带告诉调用方：命中的是不是自定义字体。
 * 自定义字体还需要调用方确保 FontFace 已注册（见 ensureCustomFontRegistered）。
 */
export interface ResolvedSubtitleFont {
  /** CSS font-family 栈；空串 = 清掉内联属性，回到继承 */
  stack: string;
  /** 命中的自定义字体（需要注册）；内置 / 系统默认为 undefined */
  custom?: CustomFontPack;
}

export function resolveSubtitleFont(
  fontFamily: string | undefined,
  customFonts: readonly CustomFontPack[] | undefined
): ResolvedSubtitleFont {
  const id = typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily.trim() : DEFAULT_FONT_FAMILY;
  const builtin = findBuiltinFont(id);
  if (builtin) return { stack: builtin.stack };
  const custom = findCustomFont(customFonts, id);
  if (custom) return { stack: customFontStack(custom), custom };
  return { stack: '' };
}

/* ══════════════════════ base64 / 体积 ══════════════════════ */

const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

/** 严格校验 data URL 形状；不合格返回 null（调用方按「单条丢弃」处理） */
export function parseFontDataUrl(dataUrl: unknown): { mime: string; base64: string } | null {
  if (typeof dataUrl !== 'string') return null;
  /* 粗略挡一下：> 5MB 的文件 base64 后约 6.7MB，超出直接判废，不必跑正则 */
  if (dataUrl.length > MAX_CUSTOM_FONT_BYTES * 4 / 3 + 1024) return null;
  const hit = DATA_URL_RE.exec(dataUrl);
  if (!hit) return null;
  return { mime: hit[1].toLowerCase(), base64: hit[2] };
}

/** base64 解码后的字节数（不真的解码，避免在读设置时分配几 MB 内存） */
export function base64ByteLength(base64: string): number {
  if (!base64) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** MIME → 统一格式名；认不出返回 ''（= 丢弃） */
export function fontFormatOfMime(mime: string): string {
  const value = mime.toLowerCase();
  if (value === 'font/woff2' || value === 'application/font-woff2') return 'woff2';
  if (value === 'font/woff' || value === 'application/font-woff' || value === 'application/x-font-woff') return 'woff';
  if (value === 'font/otf' || value === 'application/x-font-opentype' || value === 'application/vnd.ms-opentype') {
    return 'opentype';
  }
  if (value === 'font/ttf' || value === 'application/x-font-ttf' || value === 'application/x-font-truetype') {
    return 'truetype';
  }
  if (value === 'application/octet-stream') return ''; // 太泛，靠扩展名兜底（见 formatOfFileName）
  return '';
}

/** 扩展名 → 格式名（MIME 不可信时兜底） */
export function formatOfFileName(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName || '')?.[1]?.toLowerCase() || '';
  if (ext === 'ttf') return 'truetype';
  if (ext === 'otf') return 'opentype';
  if (ext === 'woff') return 'woff';
  if (ext === 'woff2') return 'woff2';
  return '';
}

/** 按文件名粗略猜语言（只作为上传对话框的默认值，用户可改） */
export function guessFontLanguage(fileName: string): FontLang {
  const name = (fileName || '').toLowerCase();
  if (/(japan|jp|meiryo|yugo|yumin|mincho|gothic|kakugo|noto\s*sans\s*jp|mplus)/.test(name)) return 'ja';
  if (/(korean|kr|malgun|nanum|gothic\s*kr|noto\s*sans\s*kr|apple\s*sd)/.test(name)) return 'ko';
  if (/(chinese|zh|sc|tc|cn|yahei|msyh|simhei|simsun|song|kai|pingfang|source\s*han|noto\s*sans\s*(sc|tc)|fangsong|dengxian)/.test(name)) {
    return 'zh';
  }
  if (/(inter|roboto|arial|helvetica|georgia|times|segoe|calibri|verdana|tahoma|lato|montserrat|opensans|open\s*sans|poppins|noto\s*sans$)/.test(name)) {
    return 'en';
  }
  return 'other';
}

/** 人类可读体积（KB / MB，保留一位小数） */
export function formatFontBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function totalCustomFontBytes(fonts: readonly CustomFontPack[] | undefined): number {
  if (!fonts || fonts.length === 0) return 0;
  return fonts.reduce((sum, font) => sum + (Number.isFinite(font.size) ? font.size : 0), 0);
}

/* ══════════════════════ 清洗（存储层唯一入口） ══════════════════════ */

const FONT_ID_RE = /^font-[a-z0-9-]{1,40}$/;
const MAX_FONT_NAME_LENGTH = 40;

function sanitizeFontName(value: unknown, fallbackId: string): string {
  if (typeof value === 'string') {
    const name = value.trim().slice(0, MAX_FONT_NAME_LENGTH);
    if (name) return name;
  }
  return fallbackId;
}

/**
 * 自定义字体清洗：**逐条**校验，非法条目单独丢弃（不整份重置 —— 用户不丢其它字体）。
 * 丢弃口径：
 *   - id 不是 `font-xxx` 形状 / 重复；
 *   - dataUrl 缺失、不是合法 base64 data URL、解码后为 0 字节或 > 单文件上限；
 *   - 累计超过 20MB 之后的多余条目（前面的保留，不写坏已有数据）。
 * 体积一律按 base64 长度反算，不信条目自报的 size（手改 storage 也骗不过）。
 */
export function sanitizeCustomFonts(value: unknown): CustomFontPack[] {
  if (!Array.isArray(value)) return [];
  const out: CustomFontPack[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<CustomFontPack>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!FONT_ID_RE.test(id) || seen.has(id)) continue;

    const parsed = parseFontDataUrl(item.dataUrl);
    if (!parsed) continue;
    const bytes = base64ByteLength(parsed.base64);
    if (bytes <= 0 || bytes > MAX_CUSTOM_FONT_BYTES) continue;

    const format = VALID_FORMATS.includes(item.format as (typeof VALID_FORMATS)[number])
      ? (item.format as string)
      : fontFormatOfMime(parsed.mime);
    if (!VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])) continue;

    if (total + bytes > MAX_CUSTOM_FONTS_TOTAL_BYTES) {
      console.warn(`[Fonts] 自定义字体累计超过 ${formatFontBytes(MAX_CUSTOM_FONTS_TOTAL_BYTES)}，丢弃条目 ${id}`);
      continue;
    }
    if (out.length >= MAX_CUSTOM_FONTS) break;

    seen.add(id);
    total += bytes;
    out.push({
      id,
      name: sanitizeFontName(item.name, id),
      language: isFontLang(item.language) ? item.language : 'other',
      format,
      size: bytes,
      dataUrl: item.dataUrl as string,
      createdAt: Number.isFinite(item.createdAt as number) ? (item.createdAt as number) : Date.now()
    });
  }

  return out;
}

/** 生成一个不与现有条目撞车的 id */
export function createCustomFontId(existing: readonly CustomFontPack[] | undefined): string {
  const used = new Set((existing || []).map((font) => font.id));
  let id = '';
  do {
    id = `font-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } while (used.has(id));
  return id;
}

/* ══════════════════════ FontFace 注册（按 id 去重） ══════════════════════ */

/** 已注册成功的 id。整页生命周期内只增不减 —— 字体内容跟 id 绑定，重复注册没有意义 */
const registeredFontIds = new Set<string>();
/** 正在注册中的 promise，避免同 id 并发 load 两次 */
const pendingRegistrations = new Map<string, Promise<boolean>>();

export function isCustomFontRegistered(id: string): boolean {
  return registeredFontIds.has(id);
}

/** data URL → ArrayBuffer（用 atob 手解，避免在 YouTube 页面里被 CSP 的 connect-src 拦住） */
export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('data URL 缺少逗号分隔符');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 确保某个自定义字体已注册到 `document.fonts`。
 * 失败（格式不支持 / dataUrl 坏了 / 浏览器拒绝）返回 false 并留一条 warning，
 * **不抛给界面** —— 调用方按「回退系统默认」处理即可。
 */
export function ensureCustomFontRegistered(pack: CustomFontPack): Promise<boolean> {
  if (registeredFontIds.has(pack.id)) return Promise.resolve(true);
  const inflight = pendingRegistrations.get(pack.id);
  if (inflight) return inflight;

  const task = (async (): Promise<boolean> => {
    try {
      if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return false;
      const face = new FontFace(customFontFamily(pack.id), dataUrlToArrayBuffer(pack.dataUrl), {
        display: 'swap'
      });
      await face.load();
      document.fonts.add(face);
      registeredFontIds.add(pack.id);
      return true;
    } catch (error) {
      console.warn(`[Fonts] 自定义字体 ${pack.id}（${pack.name}）注册失败，回退系统默认字体`, error);
      return false;
    } finally {
      pendingRegistrations.delete(pack.id);
    }
  })();

  pendingRegistrations.set(pack.id, task);
  return task;
}

/** 启动时 / 设置变更时预热：把（当前用到的）自定义字体注册好。并发已由上面的 map 收敛 */
export function warmCustomFonts(
  fonts: readonly CustomFontPack[] | undefined,
  onlyId?: string
): Promise<boolean[]> {
  if (!fonts || fonts.length === 0) return Promise.resolve([]);
  const targets = onlyId ? fonts.filter((font) => font.id === onlyId) : fonts;
  return Promise.all(targets.map((font) => ensureCustomFontRegistered(font)));
}
