import { defineBackground } from 'wxt/utils/define-background';
import type { ExtensionMessage } from '../types';
import { translateSentenceBatch, fetchAvailableModels } from '../utils/translator';
import { getStoredSettings, saveStoredSettings } from '../utils/storage';
import { normalizeCaptionResponse } from '../utils/caption-parser';

const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$/i;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * 只信任来自 YouTube 页面内容脚本的消息，拒绝 popup / 其他来源伪造抓取指令
 */
function isTrustedCaptionSender(sender: chrome.runtime.MessageSender): boolean {
  const tabUrl = sender.tab?.url;
  if (!tabUrl) return false;
  try {
    const url = new URL(tabUrl);
    return url.protocol === 'https:' && YOUTUBE_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * 严格限制可抓取的 timedtext 地址，防止页面脚本借扩展权限访问内网/本机
 */
function sanitizeCaptionUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!YOUTUBE_HOST_RE.test(url.hostname)) return null;
    if (url.pathname !== '/api/timedtext') return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default defineBackground(() => {
  console.log(
    '%c[YT-Sub-Translator v0.6.0]%c Background service worker active (Immersive Translate Mode)',
    'background:#2563eb;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
    'color:#16a34a;font-weight:bold;margin-left:4px'
  );

  // 同步注册消息监听器 (svc-register-listeners-synchronously)
  chrome.runtime.onMessage.addListener((message: ExtensionMessage | any, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    switch (message.type) {
      case 'FETCH_CAPTIONS': {
        if (!isTrustedCaptionSender(sender)) {
          console.warn('[YT-Sub-Translator] 拒绝非 YouTube 页面发起的字幕抓取请求');
          sendResponse({ success: false, error: 'Untrusted sender' });
          return false;
        }

        const safeUrl = sanitizeCaptionUrl(message.payload?.url);
        if (!safeUrl) {
          console.warn('[YT-Sub-Translator] 拒绝非法字幕 URL:', message.payload?.url);
          sendResponse({ success: false, error: 'Invalid caption url' });
          return false;
        }

        const doFetch = async (targetUrl: string) => {
          const res = await fetchWithTimeout(targetUrl, {}, 12000);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const text = await res.text();
          return normalizeCaptionResponse(text);
        };

        (async () => {
          try {
            let data = await doFetch(safeUrl);
            // 若带有 fmt=json3 但拉下来没有解析到有效 events，尝试回退去除 fmt 参数拉取原生 XML 格式
            if ((!data.events || data.events.length === 0) && safeUrl.includes('fmt=json3')) {
              const fallbackUrl = safeUrl.replace(/[?&]fmt=json3/, '');
              console.log('[YT-Sub-Translator] Json3 returned empty events, trying raw XML fallback');
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
            if (safeUrl.includes('fmt=json3')) {
              try {
                const fallbackUrl = safeUrl.replace(/[?&]fmt=json3/, '');
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
        const videoId = String(message.payload?.videoId || '');
        const apiKey = String(message.payload?.apiKey || '');
        const clientVersion = String(message.payload?.clientVersion || '');
        const visitorData = String(message.payload?.visitorData || '');

        if (!VIDEO_ID_RE.test(videoId)) {
          sendResponse({ success: false, error: 'Invalid videoId', tracks: [] });
          return false;
        }

        // 页面没有 INNERTUBE_API_KEY 时，任何客户端都只会拿到边缘 403（实测响应体为空）。
        // 直接跳过全部策略、不发必败请求 —— 本次改动只允许减少请求，不允许增加。
        // `skipped: true` 是明确语义：请求根本没发生，调用方不得据此判定「该视频无字幕」。
        if (!apiKey) {
          console.debug('[YT-Sub-Translator] 跳过 youtubei 兜底：页面未提供 INNERTUBE_API_KEY');
          sendResponse({ success: false, skipped: true, error: 'No apiKey', tracks: [] });
          return false;
        }

        const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`;

        const requestPlayer = async (client: any, extraHeaders: Record<string, string> = {}) => {
          const res = await fetchWithTimeout(
            apiUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...extraHeaders
              },
              body: JSON.stringify({
                videoId,
                context: {
                  client,
                  user: { lockedSafetyMode: false },
                  request: { useSsl: true }
                }
              })
            },
            12000
          );
          // throw 前先把响应体读出来：4xx 不再只有 "HTTP 403"，能看清是边缘拒绝还是业务 JSON
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const detail = body.replace(/\s+/g, ' ').trim().slice(0, 200) || '<empty body>';
            console.debug(
              `[YT-Sub-Translator] youtubei ${client?.clientName || '?'} → HTTP ${res.status} · ${detail}`
            );
            const err: any = new Error(`HTTP ${res.status} · ${detail}`);
            err.httpStatus = res.status;
            throw err;
          }
          return await res.json();
        };

        (async () => {
          /**
           * 策略顺序（0.5.1）：
           *   1) WEB —— 带页面真实 INNERTUBE key，visitorData / X-Goog-Visitor-Id 有就带；
           *   2) ANDROID —— 该客户端已失效（20.10.38 恒 403），降为最后手段。
           * 每条策略独立 try/catch：WEB 失败不再直接中断，但也绝不无谓重试。
           */
          const failures: string[] = [];
          let tracks: any[] = [];

          const webVersion = clientVersion || '2.20240901.00.00';
          const webClient: any = {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: webVersion
          };
          if (visitorData) webClient.visitorData = visitorData;

          try {
            const data = await requestPlayer(webClient, {
              'X-Youtube-Client-Name': '1',
              'X-Youtube-Client-Version': webVersion,
              ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {})
            });
            tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          } catch (err: any) {
            failures.push(`WEB: ${err?.message || err}`);
          }

          // 策略 2: ANDROID 客户端（最后手段）
          if (!tracks || tracks.length === 0) {
            const androidClient = {
              hl: 'en',
              gl: 'US',
              clientName: 'ANDROID',
              clientVersion: '20.10.38'
            };
            try {
              const data = await requestPlayer(androidClient, {
                'X-Youtube-Client-Name': '3',
                'X-Youtube-Client-Version': '20.10.38'
              });
              tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            } catch (err: any) {
              failures.push(`ANDROID: ${err?.message || err}`);
            }
          }

          if (tracks && tracks.length > 0) {
            sendResponse({ success: true, tracks });
            return;
          }

          // 4xx / 纯「无字幕」属预期失败 → debug；5xx 与网络异常仍是 error
          const hasUnexpected = failures.some((f) => !/HTTP 4\d\d/.test(f));
          const log = hasUnexpected ? console.error : console.debug;
          log(
            `[YT-Sub-Translator] Fetch youtubei captions failed (0 tracks): ${
              failures.join(' | ') || 'no strategy returned tracks'
            }`
          );
          sendResponse({ success: false, error: failures.join(' | ') || 'No tracks', tracks: [] });
        })();

        return true;
      }

      case 'TRANSLATE_BATCH': {
        // contextBefore（需求 7）：续翻时紧邻上文的原文+已有译文，原样透传给翻译层，
        // 后台不做任何加工 —— 它只影响 user 消息，不进缓存键。
        const { texts, targetLang, settings, noFallback, bypassCache, contextBefore } = message.payload;
        translateSentenceBatch(texts, targetLang, settings, { noFallback, bypassCache, contextBefore })
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
        fetchWithTimeout(
          'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello',
          {},
          4000
        )
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
                  try {
                    const result = chrome.tabs.sendMessage(tab.id, {
                      type: 'SETTINGS_UPDATED',
                      settings: updated
                    }) as any;
                    if (result && typeof result.catch === 'function') {
                      result.catch(() => {});
                    }
                  } catch {
                    // 目标标签页可能已关闭
                  }
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
