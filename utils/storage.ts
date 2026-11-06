import { DEFAULT_SETTINGS, type ExtensionSettings } from '../types';

const STORAGE_KEY = 'yt_sub_translator_settings';
const READ_TIMEOUT_MS = 1500;

const VALID_SERVICES = ['google', 'gemini', 'openai', 'deepseek'] as const;
const VALID_SCENARIOS = ['general', 'vtuber'] as const;
const VALID_REASONING = ['none', 'low', 'high'] as const;
const VALID_DISPLAY_MODES = ['bilingual', 'translation_only', 'original_only'] as const;
const VALID_LAYOUTS = ['translation_top', 'original_top'] as const;
const VALID_SEGMENTATION_LANGS = ['auto', 'ja', 'zh', 'en', 'generic'] as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/**
 * 合并默认值并校验字段，避免非法枚举/越界数值进入渲染与请求链路
 */
export function sanitizeSettings(raw: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) } as ExtensionSettings;

  if (!VALID_SERVICES.includes(merged.service as any)) merged.service = 'google';
  if (!VALID_SCENARIOS.includes(merged.scenario as any)) merged.scenario = 'general';
  if (!VALID_REASONING.includes(merged.reasoningEffort as any)) merged.reasoningEffort = 'low';
  if (!VALID_DISPLAY_MODES.includes(merged.displayMode as any)) merged.displayMode = 'bilingual';
  if (!VALID_LAYOUTS.includes(merged.layoutOrder as any)) merged.layoutOrder = 'translation_top';

  merged.pauseThreshold = clampNumber(merged.pauseThreshold, 120, 3000, 450);
  merged.maxWordsPerSentence = clampNumber(merged.maxWordsPerSentence, 4, 60, 16);
  merged.minWordsPerSentence = clampNumber(merged.minWordsPerSentence, 1, 20, 3);
  merged.maxDurationMs = clampNumber(merged.maxDurationMs, 1500, 20000, 6500);
  if (!VALID_SEGMENTATION_LANGS.includes(merged.segmentationLanguage as any)) {
    merged.segmentationLanguage = 'auto';
  }
  merged.maxCharsPerSentence = clampNumber(merged.maxCharsPerSentence, 12, 80, 28);
  merged.fontSize = clampNumber(merged.fontSize, 12, 48, 20);
  merged.bgOpacity = clampNumber(merged.bgOpacity, 0, 100, 75);
  merged.offsetY = clampNumber(merged.offsetY, 30, 94, 82);
  merged.syncOffsetMs = clampNumber(merged.syncOffsetMs, -2000, 2000, 0);

  merged.bgColor = sanitizeColor(merged.bgColor, DEFAULT_SETTINGS.bgColor);
  merged.origColor = sanitizeColor(merged.origColor, DEFAULT_SETTINGS.origColor);
  merged.transColor = sanitizeColor(merged.transColor, DEFAULT_SETTINGS.transColor);
  merged.aiIconColor = sanitizeColor(
    merged.aiIconColor || DEFAULT_SETTINGS.aiIconColor,
    DEFAULT_SETTINGS.aiIconColor || '#fbbf24'
  );

  merged.targetLang = typeof merged.targetLang === 'string' && merged.targetLang.trim()
    ? merged.targetLang.trim()
    : DEFAULT_SETTINGS.targetLang;
  merged.apiKey = typeof merged.apiKey === 'string' ? merged.apiKey : '';
  merged.apiBaseUrl = typeof merged.apiBaseUrl === 'string' ? merged.apiBaseUrl : '';
  merged.modelName = typeof merged.modelName === 'string' ? merged.modelName : '';
  merged.enabled = merged.enabled !== false;
  merged.autoHideNativeSubtitles = merged.autoHideNativeSubtitles !== false;
  merged.autoPunctuation = merged.autoPunctuation !== false;
  merged.mergeShortFragments = merged.mergeShortFragments !== false;
  merged.autoFallbackToGoogle = merged.autoFallbackToGoogle !== false;
  merged.glossaryEnabled = merged.glossaryEnabled !== false;

  return merged;
}

function readStorageArea(
  area: 'sync' | 'local',
  timeoutMs: number
): Promise<Partial<ExtensionSettings> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[Storage] chrome.storage.${area}.get 超时（${timeoutMs}ms）`);
      resolve(null);
    }, timeoutMs);

    const finish = (value: Partial<ExtensionSettings> | null) => {
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
      storageArea.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.warn(`[Storage] chrome.storage.${area} 读取失败:`, chrome.runtime.lastError.message);
          finish(null);
          return;
        }
        finish((result?.[STORAGE_KEY] as Partial<ExtensionSettings>) || null);
      });
    } catch (e) {
      console.warn(`[Storage] chrome.storage.${area} 异常:`, e);
      finish(null);
    }
  });
}

function writeStorageArea(area: 'sync' | 'local', value: ExtensionSettings): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const storageArea = chrome.storage?.[area];
      if (!storageArea) {
        resolve(false);
        return;
      }
      storageArea.set({ [STORAGE_KEY]: value }, () => {
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

/**
 * 获取当前用户配置
 * 读取顺序：sync → local → 默认值；超时会记录日志，而不是静默伪装成默认配置。
 */
export async function getStoredSettings(): Promise<ExtensionSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return { ...DEFAULT_SETTINGS };
  }

  const syncValue = await readStorageArea('sync', READ_TIMEOUT_MS);
  if (syncValue) {
    return sanitizeSettings(syncValue);
  }

  const localValue = await readStorageArea('local', 1000);
  if (localValue) {
    return sanitizeSettings(localValue);
  }

  return { ...DEFAULT_SETTINGS };
}

// 串行化“读-改-写”，避免 popup 与快捷面板并发保存时互相覆盖字段
let saveChain: Promise<ExtensionSettings> = Promise.resolve({ ...DEFAULT_SETTINGS });

/**
 * 保存用户配置（自动合并当前持久化值，串行执行）
 */
export function saveStoredSettings(
  newSettings: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  saveChain = saveChain
    .catch(() => ({ ...DEFAULT_SETTINGS }))
    .then(async () => {
      const current = await getStoredSettings();
      const updated = sanitizeSettings({ ...current, ...newSettings });

      const ok = await writeStorageArea('sync', updated);
      if (!ok) {
        await writeStorageArea('local', updated);
      }
      return updated;
    });

  return saveChain;
}
