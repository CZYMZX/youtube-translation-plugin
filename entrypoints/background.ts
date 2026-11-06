import { defineBackground } from 'wxt/utils/define-background';
import type { ExtensionMessage } from '../types';
import { translateSentenceBatch, fetchAvailableModels } from '../utils/translator';
import { getStoredSettings, saveStoredSettings } from '../utils/storage';
import { normalizeCaptionResponse } from '../utils/caption-parser';

export default defineBackground(() => {
  console.log(
    '%c[YT-Sub-Translator v0.2.3]%c Background service worker active (Immersive Translate Mode)',
    'background:#2563eb;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
    'color:#16a34a;font-weight:bold;margin-left:4px'
  );

  // 同步注册消息监听器 (svc-register-listeners-synchronously)
  chrome.runtime.onMessage.addListener((message: ExtensionMessage | any, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    switch (message.type) {
      case 'FETCH_CAPTIONS': {
        const { url } = message.payload;

        const doFetch = async (targetUrl: string) => {
          const res = await fetch(targetUrl);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const text = await res.text();
          return normalizeCaptionResponse(text);
        };

        (async () => {
          try {
            let data = await doFetch(url);
            // 若带有 fmt=json3 但拉下来没有解析到有效 events，尝试回退去除 fmt 参数拉取原生 XML 格式
            if ((!data.events || data.events.length === 0) && url.includes('fmt=json3')) {
              const fallbackUrl = url.replace(/[?&]fmt=json3/, '');
              console.log('[YT-Sub-Translator] Json3 returned empty events, trying raw XML fallback:', fallbackUrl);
              try {
                const xmlData = await doFetch(fallbackUrl);
                if (xmlData.events && xmlData.events.length > 0) {
                  data = xmlData;
                }
              } catch (e2) {
                console.warn('[YT-Sub-Translator] Raw XML fallback failed:', e2);
              }
            }
            sendResponse({ success: true, data });
          } catch (err: any) {
            console.error('[YT-Sub-Translator] Fetch captions error:', err);
            // 如果初次请求因 fmt=json3 报错，尝试回退原 URL
            if (url.includes('fmt=json3')) {
              try {
                const fallbackUrl = url.replace(/[?&]fmt=json3/, '');
                const xmlData = await doFetch(fallbackUrl);
                sendResponse({ success: true, data: xmlData });
                return;
              } catch (e3: any) {
                sendResponse({ success: false, error: e3.message || 'Fetch failed' });
                return;
              }
            }
            sendResponse({ success: false, error: err.message || 'Fetch failed' });
          }
        })();

        return true;
      }

      // 通过官方 YouTubei API 直接由后台拉取特定视频全部字幕轨道 (高韧性双模式兜底)
      case 'FETCH_TRACKS_BY_VIDEO_ID': {
        const { videoId, apiKey, clientVersion } = message.payload;

        const requestPlayer = async (clientConfig: any) => {
          const apiUrl = apiKey
            ? `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`
            : 'https://www.youtube.com/youtubei/v1/player';

          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId: videoId,
              context: {
                client: clientConfig
              }
            })
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        };

        (async () => {
          try {
            // 策略 1: 尝试 WEB 客户端
            const webClient = {
              hl: 'en',
              gl: 'US',
              clientName: 'WEB',
              clientVersion: clientVersion || '2.20240901.00.00'
            };
            const data1 = await requestPlayer(webClient);
            let tracks = data1?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

            // 策略 2: 若 WEB 未返回字幕轨，尝试兼容性极高的 ANDROID 客户端上下文
            // 注意：19.09.37 等旧版本会被服务端直接返回 HTTP 400，需使用当前可用版本
            if (!tracks || tracks.length === 0) {
              const androidClient = {
                hl: 'en',
                gl: 'US',
                clientName: 'ANDROID',
                clientVersion: '20.10.38'
              };
              const data2 = await requestPlayer(androidClient);
              tracks = data2?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            }

            sendResponse({ success: true, tracks });
          } catch (err: any) {
            console.error('[YT-Sub-Translator] Fetch youtubei captions failed:', err);
            sendResponse({ success: false, error: err.message, tracks: [] });
          }
        })();

        return true;
      }

      case 'TRANSLATE_BATCH': {
        const { texts, targetLang, settings, noFallback, bypassCache } = message.payload;
        translateSentenceBatch(texts, targetLang, settings, { noFallback, bypassCache })
          .then((translations) => {
            sendResponse({ success: true, translations, service: settings?.service });
          })
          .catch((err) => {
            console.error('[YT-Sub-Translator] Translation batch error:', err);
            sendResponse({ success: false, error: err.message || 'Translation failed' });
          });
        return true;
      }

      case 'FETCH_MODELS': {
        const { settings } = message.payload;
        fetchAvailableModels(settings)
          .then((models) => {
            sendResponse({ success: true, models });
          })
          .catch((err) => {
            console.error('[YT-Sub-Translator] Fetch models error:', err);
            sendResponse({ success: false, error: err.message || '获取模型列表失败' });
          });
        return true;
      }

      case 'CHECK_GOOGLE_TRANSLATE_CONNECTION': {
        // 检测 Google 免费翻译服务是否可连通
        fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello', {
          signal: AbortSignal.timeout(4000)
        })
          .then((res) => {
            if (res.ok) {
              sendResponse({ success: true, canConnect: true });
            } else {
              sendResponse({ success: true, canConnect: false, status: res.status });
            }
          })
          .catch((err) => {
            sendResponse({ success: true, canConnect: false, error: err.message });
          });
        return true;
      }

      case 'GET_SETTINGS': {
        getStoredSettings()
          .then((settings) => {
            sendResponse({ success: true, settings });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }

      case 'SAVE_SETTINGS': {
        saveStoredSettings(message.payload)
          .then((updated) => {
            chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
              for (const tab of tabs) {
                if (tab.id) {
                  chrome.tabs.sendMessage(tab.id, {
                    type: 'SETTINGS_UPDATED',
                    settings: updated
                  }).catch(() => {});
                }
              }
            });
            sendResponse({ success: true, settings: updated });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }

      default:
        return false;
    }
  });
});
