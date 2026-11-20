import {
  DEFAULT_SETTINGS,
  type CustomModelEntry,
  type CustomModelService,
  type ExtensionSettings
} from '../types';
/* 图标白名单与自定义条目的取值域都只有一份，放在 utils/models.ts */
import {
  CUSTOM_MODEL_SERVICES,
  MAX_CUSTOM_MODELS,
  PROVIDER_IDS,
  getProvider,
  isModelIconKey,
  resolveProviderByService
} from './models';
/* 带 base64 的字体包只能进 local：清洗规则与体积上限在 utils/fonts.ts 里定义一份 */
import { DEFAULT_FONT_FAMILY, sanitizeCustomFonts as sanitizeFontPacks, type CustomFontPack } from './fonts';

const STORAGE_KEY = 'yt_sub_translator_settings';
/**
 * 自定义字体包（含 base64 dataUrl）的 local 键。
 * 与设置分开存的两个理由：
 *   1. `chrome.storage.sync` 单键 8KB / 总量 100KB，一个中文字体就几百 KB ~ 几 MB；
 *   2. dataUrl 属于「体积大、不需要跨设备同步」的数据，放 sync 只会让每次保存都超配额失败。
 */
const FONTS_KEY = 'yt_sub_translator_fonts';
/**
 * 敏感字段（Key）单独存 local，用这个键。
 * 为什么不能继续放 sync：`chrome.storage.sync` 会随浏览器账号同步到云端，
 * 与「Key 仅保存在本地」直接冲突。非敏感设置仍走 sync（跨设备同步是原有特性）。
 */
const SECRETS_KEY = 'yt_sub_translator_secrets';
/** 只允许落在 local 的字段；serviceKeys 是 v0.4.2 之前「按服务商记 Key」的残留 */
const SECRET_FIELDS = ['apiKey', 'providerKeys', 'serviceKeys'] as const;
const READ_TIMEOUT_MS = 1500;

/** 一份密钥集合：当前生效的 Key + 按厂牌分格的 Key */
interface SecretState {
  apiKey?: string;
  providerKeys?: Record<string, string>;
}

/* API Key 与其按服务商分格保存的副本共用一个长度上限（v0.4.2） */
const MAX_SECRET_LENGTH = 400;
const MAX_MODEL_ID_LENGTH = 120;
const MAX_MODEL_LABEL_LENGTH = 40;
/* Base URL 与其按服务商分格保存的副本共用上限（任务四）：够放长路径，又不至于存进一段正文 */
const MAX_BASE_URL_LENGTH = 300;

const VALID_SERVICES = ['google', 'gemini', 'openai', 'deepseek'] as const;
const VALID_REASONING = ['none', 'low', 'high'] as const;
const VALID_DISPLAY_MODES = ['bilingual', 'translation_only', 'original_only'] as const;
const VALID_LAYOUTS = ['translation_top', 'original_top'] as const;
const VALID_SEGMENTATION_LANGS = ['auto', 'ja', 'zh', 'en', 'generic'] as const;
/* v0.4.2 两个新增选项的合法取值（非法值一律回落默认，避免脏数据进 prompt 装配） */
const VALID_GLOSSARY_ANNOTATION = ['off', 'on'] as const;
const VALID_ASR_CORRECTION = ['strict', 'normal'] as const;
/* 需求 7：AI 精翻字幕保留时长（小时，0 = 永久）与续翻模式 */
const VALID_AI_CACHE_TTL_HOURS = [24, 168, 720, 0] as const;
const VALID_AI_RESUME_MODES = ['auto', 'manual'] as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function sanitizeColor(value: unknown, fallback: string, allowTransparent = false): string {
  if (typeof value !== 'string') return fallback;
  // `#00000000` 是「完全透明无底色」这个合法预设（仅 bgColor 棋盘格色块允许），
  // 8 位 hex 仅此一例：渲染侧 hexToRgba 对它特判返回 'transparent'。
  if (allowTransparent && value.toLowerCase() === '#00000000') return '#00000000';
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function sanitizeOptionalHexColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : '';
}

/**
 * 剥离大体积自定义字体包（base64 dataUrl，最高 ~27MB），用于跨进程 IPC 消息透传，
 * 避免每次翻译或设置广播都序列化几十 MB 字体数据。
 */
export function stripCustomFonts(settings: ExtensionSettings): ExtensionSettings {
  if (!settings || !settings.customFonts || settings.customFonts.length === 0) {
    return settings;
  }
  const { customFonts: _omit, ...rest } = settings;
  return rest as ExtensionSettings;
}

/**
 * 自定义模型：逐条校验，**非法/超限条目单独丢弃**（不整份重置，用户不丢已配好的那条）。
 * - id 必填且截断到 120 字符；label 缺省回落 id；
 * - service 必须是白名单值，否则整条丢（不知道该往哪个端点发）；
 * - providerId 必须是厂牌白名单值；老条目没有这个字段时按 service 的主厂牌补上，
 *   这样它还会出现在原来那个厂牌的列表里，不会凭空消失；
 * - icon 只接受白名单（历史值 ∪ 厂牌 key），非法回落 'generic'。
 */
function sanitizeCustomModels(value: unknown): CustomModelEntry[] {
  if (!Array.isArray(value)) return [];
  const out: CustomModelEntry[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<CustomModelEntry>;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, MAX_MODEL_ID_LENGTH) : '';
    if (!id) continue;
    if (!CUSTOM_MODEL_SERVICES.includes(item.service as CustomModelService)) continue;

    const service = item.service as CustomModelService;
    const providerId = typeof item.providerId === 'string' && PROVIDER_IDS.includes(item.providerId)
      ? item.providerId
      : resolveProviderByService(service === 'custom' ? 'openai' : service).id;
    /* 去重键带上厂牌：同一个 id 在两个厂牌下是两条不同的配置（端点与 Key 都不同） */
    const dedupe = `${providerId}|${id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const label = typeof item.label === 'string' ? item.label.trim().slice(0, MAX_MODEL_LABEL_LENGTH) : '';
    out.push({
      id,
      label: label || id,
      service,
      icon: isModelIconKey(item.icon) ? item.icon : 'generic',
      providerId
    });
    if (out.length >= MAX_CUSTOM_MODELS) break;
  }

  return out;
}

/** 按厂牌记的 Key：键做白名单过滤，值 trim + 截断（与 apiKey 同一个上限） */
function sanitizeProviderKeys(value: unknown): Record<string, string> {
  return sanitizeProviderMap(value, MAX_SECRET_LENGTH);
}

/** 按厂牌记的 Base URL：与 providerKeys 同规则——键白名单、值 trim + 截断、空串不占格 */
function sanitizeProviderBaseUrls(value: unknown): Record<string, string> {
  return sanitizeProviderMap(value, MAX_BASE_URL_LENGTH);
}

/**
 * 降级顺序上限（v0.4.2）。
 * 每多一级就多一次真实请求，而「全都不可用」时多配几级也解决不了问题；
 * 8 这个数字同时覆盖「全部 7 个大模型厂牌 + Google 免费」的极端排法。
 */
export const MAX_FALLBACK_ORDER = 8;

/**
 * 降级顺序清洗（v0.4.2）：只留**合法厂牌 id**（以 utils/models.ts#PROVIDERS 为准）、
 * 去重、保持用户设定的相对顺序、最多 MAX_FALLBACK_ORDER 个。
 *
 * 三条口径：
 * - 非法值（未知 id / 非字符串 / 空串）整条丢弃，不占位 —— 与需求「丢弃未知 id」一致；
 * - 重复项只留第一次出现的位置（顺序即优先级，后出现的那次没有意义）；
 * - 不是数组（老数据没这个字段、或存成字符串）→ `[]`，等于「保持现有行为」，不报错。
 *
 * 刻意**不校验**「该厂牌是否配了 Key」：Key 可以事后补，顺序是用户的偏好，
 * 不该因为当下没配 Key 就被存储层悄悄改掉（运行时由 utils/translator.ts 跳过无 Key 的级）。
 */
export function sanitizeFallbackOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!PROVIDER_IDS.includes(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_FALLBACK_ORDER) break;
  }
  return out;
}

/**
 * 按厂牌记的「上次选的模型」（v0.4.2）：键白名单 + 值 trim + 模型 id 长度上限。
 * 刻意**不校验这个 id 是否还在该厂牌的清单里** —— 手填的自定义 id、厂商已下架的
 * 型号都要能被恢复；清单本身只是内部参考（默认值 / 归属判断），不是白名单。
 */
function sanitizeProviderModelSelections(value: unknown): Record<string, string> {
  return sanitizeProviderMap(value, MAX_MODEL_ID_LENGTH);
}

function sanitizeProviderMap(value: unknown, maxLength: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!PROVIDER_IDS.includes(key)) continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, maxLength);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/** 按服务商记的 Key：键做白名单过滤，值 trim + 截断（与 apiKey 同一个上限） */
function sanitizeServiceKeys(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_SERVICES.includes(key as any)) continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, MAX_SECRET_LENGTH);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/** 按服务商记的 Base URL：与 serviceKeys 同规则——键白名单、值 trim + 截断、空串不占格 */
function sanitizeBaseUrls(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_SERVICES.includes(key as any)) continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, MAX_BASE_URL_LENGTH);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/**
 * 合并默认值并校验字段，避免非法枚举/越界数值进入渲染与请求链路
 */
export function sanitizeSettings(raw: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) } as ExtensionSettings;

  if (!VALID_SERVICES.includes(merged.service as any)) merged.service = 'google';
  /* v0.2.9：场景支持用户上传包 id（ASCII/CJK 短标识），非法值回落 vtuber */
  if (typeof merged.scenario !== 'string' || !/^[\w\u4e00-\u9fff-]{1,80}$/.test(merged.scenario)) {
    merged.scenario = 'vtuber';
  }
  if (!VALID_REASONING.includes(merged.reasoningEffort as any)) merged.reasoningEffort = 'low';
  if (!VALID_DISPLAY_MODES.includes(merged.displayMode as any)) merged.displayMode = 'bilingual';
  if (!VALID_LAYOUTS.includes(merged.layoutOrder as any)) merged.layoutOrder = 'translation_top';

  merged.pauseThreshold = clampNumber(merged.pauseThreshold, 120, 3000, 450);
  merged.maxWordsPerSentence = clampNumber(merged.maxWordsPerSentence, 4, 60, 16);
  merged.minWordsPerSentence = clampNumber(merged.minWordsPerSentence, 1, 20, 3);
  if (merged.minWordsPerSentence > merged.maxWordsPerSentence) {
    merged.minWordsPerSentence = merged.maxWordsPerSentence;
  }
  merged.maxDurationMs = clampNumber(merged.maxDurationMs, 1500, 20000, 6500);
  if (!VALID_SEGMENTATION_LANGS.includes(merged.segmentationLanguage as any)) {
    merged.segmentationLanguage = 'auto';
  }
  merged.maxCharsPerSentence = clampNumber(merged.maxCharsPerSentence, 12, 80, 28);
  merged.fontSize = clampNumber(merged.fontSize, 12, 48, 20);
  merged.bgOpacity = clampNumber(merged.bgOpacity, 0, 100, 75);
  /* v0.5.5：快捷面板高度。0 = 自适应，其余按 px 夹到 0 ~ 900（超过 900 对 4K 全屏也没意义）。
     clampNumber 内部 Number.isFinite 判定，所以显式写 0 不会被当成「未设置」而回落默认值。 */
  merged.quickPanelHeight = clampNumber(
    merged.quickPanelHeight,
    0,
    900,
    DEFAULT_SETTINGS.quickPanelHeight
  );
  merged.offsetY = clampNumber(merged.offsetY, 30, 94, 82);
  merged.syncOffsetMs = clampNumber(merged.syncOffsetMs, -2000, 2000, 0);

  /* v0.5.6：字幕字体。只接受「id 形状」的短标识（内置 id / font-xxx / system），
     任意字符串不能进样式层；不认识的自定义 id 这里**不判死**（字体列表可能还没读到 local），
     由渲染层 resolveSubtitleFont 回退到 'system'。 */
  const fontFamilyRaw = typeof merged.fontFamily === 'string' ? merged.fontFamily.trim() : '';
  merged.fontFamily = /^[A-Za-z0-9_-]{1,64}$/.test(fontFamilyRaw) ? fontFamilyRaw : DEFAULT_FONT_FAMILY;
  /* 自定义字体包：逐条清洗（缺 dataUrl / 非法 base64 / 超单文件上限的条目单独丢弃） */
  merged.customFonts = sanitizeFontPacks(merged.customFonts);

  merged.bgColor = sanitizeColor(merged.bgColor, DEFAULT_SETTINGS.bgColor, true);
  merged.origColor = sanitizeColor(merged.origColor, DEFAULT_SETTINGS.origColor, false);
  merged.transColor = sanitizeColor(merged.transColor, DEFAULT_SETTINGS.transColor, false);
  merged.aiIconColor = sanitizeColor(
    merged.aiIconColor || DEFAULT_SETTINGS.aiIconColor,
    DEFAULT_SETTINGS.aiIconColor || '#fbbf24',
    false
  );
  merged.wordHighlightColor = sanitizeOptionalHexColor(merged.wordHighlightColor);
  merged.wordHighlightTransColor = sanitizeOptionalHexColor(merged.wordHighlightTransColor);
  merged.lyricKaraoke = merged.lyricKaraoke !== false;
  merged.asrWordReveal = merged.asrWordReveal !== false;

  merged.targetLang = typeof merged.targetLang === 'string' && merged.targetLang.trim()
    ? merged.targetLang.trim()
    : DEFAULT_SETTINGS.targetLang;
  merged.apiKey = typeof merged.apiKey === 'string' ? merged.apiKey.trim().slice(0, MAX_SECRET_LENGTH) : '';
  merged.apiBaseUrl = typeof merged.apiBaseUrl === 'string'
    ? merged.apiBaseUrl.trim().slice(0, MAX_BASE_URL_LENGTH)
    : '';
  merged.modelName = typeof merged.modelName === 'string' ? merged.modelName.trim() : '';
  merged.enabled = merged.enabled !== false;
  merged.autoHideNativeSubtitles = merged.autoHideNativeSubtitles !== false;
  merged.autoPunctuation = merged.autoPunctuation !== false;
  merged.mergeShortFragments = merged.mergeShortFragments !== false;
  merged.autoFallbackToGoogle = merged.autoFallbackToGoogle !== false;
  /* v0.4.2：降级顺序。老数据没有这一项 / 形状不对 → []（= 保持 v0.4.1「失败直接降级 Google」）；
     它是普通设置（不含 Key），跟着 sync 走，跨设备同步同一份优先级。 */
  merged.fallbackOrder = sanitizeFallbackOrder(merged.fallbackOrder);
  merged.glossaryEnabled = merged.glossaryEnabled !== false;
  /* v0.2.9：术语库启用包列表（只保留字符串数组，长度与字符集受限） */
  if (Array.isArray(merged.glossaryPacks)) {
    merged.glossaryPacks = merged.glossaryPacks
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 60)
      .slice(0, 20);
  } else {
    merged.glossaryPacks = ['vtuber-hololive'];
  }
  /* v0.4.2：专名括注 / ASR 纠错授权（默认 off / normal = 老行为；非法值回落默认） */
  if (!VALID_GLOSSARY_ANNOTATION.includes(merged.glossaryAnnotation as any)) {
    merged.glossaryAnnotation = 'off';
  }
  if (!VALID_ASR_CORRECTION.includes(merged.asrCorrection as any)) {
    merged.asrCorrection = 'normal';
  }

  /* v0.4.2：自定义模型（逐条过滤，超限截断） */
  merged.customModels = sanitizeCustomModels(merged.customModels);

  /* 需求 7：AI 精翻缓存保留时长。
     分段控件写回来的值是字符串（'720' / '0'），所以先转数字再判白名单；
     非 24/168/720/0 一律回落 720 —— 不做就近取整，避免存储层自己发明档位。 */
  const ttlSource = merged.aiCacheTtlHours as unknown;
  const ttlRaw = typeof ttlSource === 'number'
    ? ttlSource
    : (typeof ttlSource === 'string' && ttlSource.trim() !== '' ? Number(ttlSource) : NaN);
  merged.aiCacheTtlHours = VALID_AI_CACHE_TTL_HOURS.includes(ttlRaw as any)
    ? ttlRaw
    : DEFAULT_SETTINGS.aiCacheTtlHours;

  /* 需求 7：续翻模式（默认 manual = 不擅自消耗 token 续翻） */
  if (!VALID_AI_RESUME_MODES.includes(merged.aiResumeMode as any)) {
    merged.aiResumeMode = 'manual';
  }

  /* ══════════════════ 任务四：厂牌维度的 Key / 端点（含老数据迁移） ══════════════════
   * 为什么要有这一层：Key 必须跟着**厂牌**走（Claude / 通义 / Kimi / GLM 的 service 都是
   * 'openai'，只按 service 记会互相覆盖），所以存储结构从 service 维度升到 provider 维度。
   *
   * 迁移口径（老用户只有 service / apiKey / apiBaseUrl / serviceKeys / baseUrls）：
   *   1. 先定「当前厂牌」：providerId 有效且与当前 service 对得上就用它；
   *      对不上（例如弹窗只改了 service，或老数据压根没有 providerId）就按 service 的主厂牌落位；
   *   2. serviceKeys / baseUrls 里能映射到厂牌的老值，**只在目标格为空时**并进去，不覆盖已有值；
   *   3. 当前厂牌那一格始终以 apiKey / apiBaseUrl 为准（弹窗只写这两个字段）；
   *   4. 迁完把 serviceKeys / baseUrls 从输出里删掉——它们只是迁移输入，不再有第二份真相。
   */
  merged.providerKeys = sanitizeProviderKeys(merged.providerKeys);
  merged.providerBaseUrls = sanitizeProviderBaseUrls(merged.providerBaseUrls);
  /* v0.4.2：按厂牌记的「上次选的模型」。老数据没有这一项 → DEFAULT 的 {} 兜住；
     有值但形状不对（数组 / 字符串 / 未知厂牌键）→ 逐项丢弃，不整份重置。 */
  merged.providerModelSelections = sanitizeProviderModelSelections(merged.providerModelSelections);

  const requestedProvider = getProvider(typeof merged.providerId === 'string' ? merged.providerId : '');
  const providerMatchesService = !requestedProvider
    ? false
    : merged.service === 'google' || requestedProvider.service === merged.service;
  const currentProvider = providerMatchesService && requestedProvider
    ? requestedProvider
    : resolveProviderByService(merged.service);
  merged.providerId = currentProvider.id;

  /* 2. 老 service 维度的 Key / 端点 → 厂牌维度（不覆盖已有值） */
  for (const [service, key] of Object.entries(sanitizeServiceKeys(merged.serviceKeys))) {
    const pid = resolveProviderByService(service).id;
    if (!merged.providerKeys[pid]) merged.providerKeys[pid] = key;
  }
  for (const [service, url] of Object.entries(sanitizeBaseUrls(merged.baseUrls))) {
    const pid = resolveProviderByService(service).id;
    if (!merged.providerBaseUrls[pid]) merged.providerBaseUrls[pid] = url;
  }

  /* 3. 当前厂牌那一格以 apiKey / apiBaseUrl 为准。
     Google 免费通道（service==='google'）不参与：它不需要 Key，
     此时 providerId 只是「上次用的那个厂牌」，不该把 apiKey 写进它的格子。 */
  if (merged.service !== 'google') {
    if (merged.apiKey) merged.providerKeys[currentProvider.id] = merged.apiKey;
    else delete merged.providerKeys[currentProvider.id];

    if (merged.apiBaseUrl) merged.providerBaseUrls[currentProvider.id] = merged.apiBaseUrl;
    else delete merged.providerBaseUrls[currentProvider.id];
  }

  /* 4. 老字段与内部时间戳只作迁移/比对输入：清掉，保证输出结构纯净 */
  delete merged.serviceKeys;
  delete merged.baseUrls;
  delete (merged as unknown as Record<string, unknown>)._updatedAt;

  return merged;
}

function readAreaKey(
  area: 'sync' | 'local',
  key: string,
  timeoutMs: number
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[Storage] chrome.storage.${area}.get(${key}) 超时（${timeoutMs}ms）`);
      resolve(null);
    }, timeoutMs);

    const finish = (value: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    try {
      const storageArea = chrome.storage?.[area];
      if (!storageArea) {
        finish(null);
        return;
      }
      storageArea.get([key], (result) => {
        if (chrome.runtime.lastError) {
          console.warn(`[Storage] chrome.storage.${area} 读取失败:`, chrome.runtime.lastError.message);
          finish(null);
          return;
        }
        const raw = result?.[key];
        finish(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null);
      });
    } catch (e) {
      console.warn(`[Storage] chrome.storage.${area} 异常:`, e);
      finish(null);
    }
  });
}

function writeAreaKey(area: 'sync' | 'local', key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const storageArea = chrome.storage?.[area];
      if (!storageArea) {
        resolve(false);
        return;
      }
      storageArea.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.warn(`[Storage] chrome.storage.${area} 写入失败:`, chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (e) {
      console.warn(`[Storage] chrome.storage.${area} 写入异常:`, e);
      resolve(false);
    }
  });
}

/* ══════════════════════ 敏感字段：只进 local ══════════════════════
 * 分工：
 *   sync  → 非敏感设置（语言、外观、断句、厂牌 id、Base URL…），跨设备同步
 *   local → 只有一把 Key 的集合（SECRETS_KEY），不随账号上云
 * 老用户（v0.4.1 及以前）的 Key 还在 sync 里：首次读取时搬到 local，
 * 并把 sync 里那几个字段抹掉。迁移幂等（抹完就没有可搬的了），失败也不影响读取。
 */

/** 一份设置里是否还带着敏感字段（老格式 / 迁移前） */
function hasSecretFields(raw: Record<string, unknown> | null): boolean {
  if (!raw) return false;
  return SECRET_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(raw, field));
}

/** 从老格式设置里取出敏感字段（serviceKeys 由 sanitizeSettings 折进 providerKeys） */
function extractSecrets(raw: Partial<ExtensionSettings>): SecretState {
  const normalized = sanitizeSettings(raw);
  return { apiKey: normalized.apiKey, providerKeys: normalized.providerKeys };
}

async function readSecrets(): Promise<SecretState | null> {
  const raw = await readAreaKey('local', SECRETS_KEY, 1000);
  if (!raw) return null;
  const out: SecretState = {};
  if (typeof raw.apiKey === 'string') out.apiKey = raw.apiKey;
  if (raw.providerKeys && typeof raw.providerKeys === 'object' && !Array.isArray(raw.providerKeys)) {
    out.providerKeys = raw.providerKeys as Record<string, string>;
  }
  return out;
}

/** 写 local：空值不占格（「恢复默认」清空 Key 时这里落成 {}，语义上就是没有 Key） */
function writeSecrets(value: SecretState): Promise<boolean> {
  const payload: Record<string, unknown> = {};
  if (value.apiKey) payload.apiKey = value.apiKey;
  if (value.providerKeys && Object.keys(value.providerKeys).length > 0) {
    payload.providerKeys = value.providerKeys;
  }
  return writeAreaKey('local', SECRETS_KEY, payload);
}

/** 把设置区里残留的敏感字段抹掉（迁移的最后一步；失败只记日志） */
async function stripSecrets(area: 'sync' | 'local', raw: Record<string, unknown>): Promise<void> {
  const next: Record<string, unknown> = { ...raw };
  for (const field of SECRET_FIELDS) delete next[field];
  const ok = await writeAreaKey(area, STORAGE_KEY, next);
  if (!ok) console.warn(`[Storage] 迁移后重写 chrome.storage.${area} 失败（下次读取会重试）`);
}

/* ══════════════════════ 自定义字体（只进 local） ══════════════════════
 * 读写口径：读 → 逐条清洗（utils/fonts.ts#sanitizeCustomFonts，坏条目单独丢弃）；
 *           写 → 整份替换（字体是不可变条目，没有「半份覆盖」的语义）。
 * 什么时候写：只有 `saveStoredSettings({ customFonts })` 显式带了这一项才写 ——
 * 每敲一个字都重写几 MB base64 是不可接受的。设置页删/加字体都会显式带这一项。
 */

/** 读取本机全部自定义字体（local 不可用时返回 []，不阻断设置读取） */
export async function loadCustomFonts(): Promise<CustomFontPack[]> {
  if (typeof chrome === 'undefined' || !chrome.storage) return [];
  const raw = await readAreaKey('local', FONTS_KEY, 1500);
  if (!raw) return [];
  return sanitizeFontPacks(raw.fonts);
}

/** 整份写入自定义字体；失败返回 false（配额 / 权限问题由调用方决定怎么提示） */
export async function writeCustomFonts(fonts: CustomFontPack[]): Promise<boolean> {
  const ok = await writeAreaKey('local', FONTS_KEY, { version: 1, fonts });
  if (!ok) console.warn('[Storage] 自定义字体写入 chrome.storage.local 失败（可能超出配额）');
  return ok;
}

/**
 * 获取当前用户配置
 * 读取顺序：sync → local → 默认值；敏感字段一律以 local 的 SECRETS_KEY 为准（覆盖）。
 * 超时会记录日志，而不是静默伪装成默认配置。
 */
export async function getStoredSettings(): Promise<ExtensionSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return { ...DEFAULT_SETTINGS };
  }

  /* 四个读并行：多两次 local 读换来更短的启动路径（原本 sync 命中时压根不读 local） */
  const [syncValue, localValue, localSecrets, localFonts] = await Promise.all([
    readAreaKey('sync', STORAGE_KEY, READ_TIMEOUT_MS),
    readAreaKey('local', STORAGE_KEY, 1000),
    readSecrets(),
    loadCustomFonts()
  ]);

  const syncTs = typeof syncValue?._updatedAt === 'number' ? syncValue._updatedAt : 0;
  const localTs = typeof localValue?._updatedAt === 'number' ? localValue._updatedAt : 0;
  // 若 sync 曾经写入失败而降级落入 local，local 的 _updatedAt 更新，优先采信较新的一份
  const useLocal = !syncValue || (!!localValue && localTs > syncTs);
  const base = (useLocal ? localValue : syncValue) as Partial<ExtensionSettings> | null;
  const baseArea: 'sync' | 'local' = useLocal ? 'local' : 'sync';

  /* 字体包**只**来自 local：sync 那一份即便历史残留了也不采信（单键 8KB 塞不下字体） */
  const fonts = localFonts;

  if (!base) {
    return sanitizeSettings({ ...(localSecrets || {}), customFonts: fonts });
  }

  /* 迁移：老数据 Key 还写在 sync/settings 里 → 搬到 local，并把那份里的 Key 抹掉 */
  if (hasSecretFields(base as Record<string, unknown>)) {
    const migrated = extractSecrets(base);
    /* local 已有值优先，但不同厂牌的 Key 按键合并而非整包覆盖 */
    const merged: SecretState = {
      apiKey: localSecrets?.apiKey !== undefined ? localSecrets.apiKey : migrated.apiKey,
      providerKeys: {
        ...(migrated.providerKeys || {}),
        ...(localSecrets?.providerKeys || {})
      }
    };
    await writeSecrets(merged);
    await stripSecrets(baseArea, base as Record<string, unknown>);
    return sanitizeSettings({ ...base, ...merged, customFonts: fonts });
  }

  const mergedSettings = sanitizeSettings({ ...base, ...(localSecrets || {}) });
  /* 字体包只来自 local（loadCustomFonts 内部已逐条清洗），不参与 sync 那一份的合并 */
  return { ...mergedSettings, customFonts: fonts };
}

// 串行化“读-改-写”，避免 popup 与快捷面板并发保存时互相覆盖字段
let saveChain: Promise<ExtensionSettings> = Promise.resolve({ ...DEFAULT_SETTINGS });

/**
 * 保存用户配置（自动合并当前持久化值，串行执行）
 *
 * 分两次写：先 local（Key）再 sync（其余设置）。
 * 顺序不能反：写入会触发 storage.onChanged，设置页收到通知会重新读一次；
 * 若 sync 先落、Key 后落，那次回读会读到旧的 Key（输入框里刚打的字被抹回原值）。
 */
export function saveStoredSettings(
  newSettings: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  saveChain = saveChain
    .catch(() => ({ ...DEFAULT_SETTINGS }))
    .then(async () => {
      const current = await getStoredSettings();
      const updated = sanitizeSettings({ ...current, ...newSettings });

      /* v0.5.6：字体包整份写 local（只有调用方显式给了 customFonts 才写）。
         写失败直接抛：settings 里刚加的字体其实没落盘，静默成功会让用户重开页面后
         发现字体凭空消失 —— 让 update() 的 catch 弹出「保存失败」更诚实。 */
      if (newSettings.customFonts !== undefined) {
        const okFonts = await writeCustomFonts(updated.customFonts || []);
        if (!okFonts) throw new Error('FONT_WRITE_FAILED');
      }

      /* sync 里必须**不含** Key：显式删掉三个敏感字段，再写。
         同理**不含** customFonts：sync 单键 8KB，一个字体就爆；只保留 fontFamily 这个 id。 */
      const plain: Record<string, unknown> = { ...updated, _updatedAt: Date.now() };
      for (const field of SECRET_FIELDS) delete plain[field];
      delete plain.customFonts;

      const okSecrets = await writeSecrets({
        apiKey: updated.apiKey,
        providerKeys: updated.providerKeys
      });
      const okSync = await writeAreaKey('sync', STORAGE_KEY, plain);

      /* 与原语义一致：sync 不可用（配额 / 无权限）时整份退到 local；Key 已经在 local 了 */
      if (!okSync) await writeAreaKey('local', STORAGE_KEY, plain);
      if (!okSecrets) console.warn('[Storage] Key 写入 local 失败，本次改动只在内存里生效');

      return updated;
    });

  return saveChain;
}
