import { DEFAULT_SETTINGS, type ExtensionSettings } from '../types';

const STORAGE_KEY = 'yt_sub_translator_settings';

/**
 * 获取当前用户配置
 */
export async function getStoredSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: ExtensionSettings) => {
      if (!settled) {
        settled = true;
        resolve(res);
      }
    };

    // 关键防御：350ms 超时强制返回默认配置，严防 Edge/Chrome MV3 sync.get 挂死导致脚本停滞！
    const timeoutTimer = setTimeout(() => {
      finish({ ...DEFAULT_SETTINGS });
    }, 350);

    if (typeof chrome === 'undefined' || !chrome.storage) {
      clearTimeout(timeoutTimer);
      finish({ ...DEFAULT_SETTINGS });
      return;
    }

    try {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        clearTimeout(timeoutTimer);
        if (chrome.runtime.lastError) {
          // 如果 sync 不可用，降级到 local
          chrome.storage.local.get([STORAGE_KEY], (localRes) => {
            finish({ ...DEFAULT_SETTINGS, ...(localRes?.[STORAGE_KEY] || {}) });
          });
          return;
        }
        finish({ ...DEFAULT_SETTINGS, ...(result?.[STORAGE_KEY] || {}) });
      });
    } catch (e) {
      clearTimeout(timeoutTimer);
      finish({ ...DEFAULT_SETTINGS });
    }
  });
}

/**
 * 保存用户配置
 */
export async function saveStoredSettings(newSettings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getStoredSettings();
  const updated: ExtensionSettings = { ...current, ...newSettings };

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      resolve(updated);
      return;
    }

    chrome.storage.sync.set({ [STORAGE_KEY]: updated }, () => {
      if (chrome.runtime.lastError) {
        chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
          resolve(updated);
        });
        return;
      }
      resolve(updated);
    });
  });
}
