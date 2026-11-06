import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    console.log(
      '%c[YT-Sub-Translator v0.2.7]%c MAIN-world bridge loaded (Immersive Translate Mode)',
      'background:#2563eb;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
      'color:#16a34a;font-weight:bold;margin-left:4px'
    );

    function getPlayer(): any {
      return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    }

    /**
     * 规范化清洗字段：只保留真实有效 baseUrl
     * 注意：getOption('captions','tracklist') 返回的是播放器内部音轨对象，通常不含 baseUrl，
     * 若把它当成有效结果会"污染"后续兜底途径，导致最终广播 0 条音轨。
     */
    function normalizeTracks(list: any): any[] {
      if (!Array.isArray(list)) return [];
      return list
        .map((t) => {
          const url = t?.baseUrl || t?.url || '';
          return {
            baseUrl: url,
            name: t?.name || { simpleText: t?.languageName || t?.languageCode || 'Caption' },
            vssId: t?.vssId || '',
            languageCode: t?.languageCode || t?.lang || '',
            kind: t?.kind,
            isTranslatable: t?.isTranslatable ?? true
          };
        })
        .filter((t) => !!t.baseUrl);
    }

    /**
     * 7 重途径全方位抓取 YouTube 播放器字幕音轨
     * 每一路都先校验"是否真的带 baseUrl"，无效则继续下一路。
     */
    function getCaptionTracks(): any[] | null {
      const player = getPlayer();

      const providers: Array<() => any> = [
        // 途径 1: HTML5 播放器官方标准公开 option: 'captions', 'tracklist'
        () => (player && typeof player.getOption === 'function' ? player.getOption('captions', 'tracklist') : null),
        // 途径 2: player.getCaptionTrackList()
        () => (player && typeof player.getCaptionTrackList === 'function' ? player.getCaptionTrackList() : null),
        // 途径 3: player.getPlayerResponse()
        () => player?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
        // 途径 4: window.ytInitialPlayerResponse
        () => (window as any).ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
        // 途径 5: window.ytplayer?.config?.args?.raw_player_response
        () => {
          const cfg = (window as any).ytplayer?.config;
          let rawResp = cfg?.args?.raw_player_response;
          if (typeof rawResp === 'string') {
            rawResp = JSON.parse(rawResp);
          }
          return rawResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        },
        // 途径 6: ytd-watch-flexy DOM 节点绑定的 playerData
        () => (document.querySelector('ytd-watch-flexy') as any)?.playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
      ];

      for (const getTracks of providers) {
        try {
          const tracks = normalizeTracks(getTracks());
          if (tracks.length > 0) return tracks;
        } catch (e) {}
      }

      return null;
    }

    /**
     * 获取页面宿主当前使用的客户端配置
     */
    function getHostClientInfo() {
      try {
        const ytcfg = (window as any).ytcfg;
        if (ytcfg && typeof ytcfg.get === 'function') {
          return {
            apiKey: ytcfg.get('INNERTUBE_API_KEY') || '',
            clientVersion: ytcfg.get('INNERTUBE_CLIENT_VERSION') || '',
            visitorData: ytcfg.get('VISITOR_DATA') || ''
          };
        }
      } catch (e) {}
      return { apiKey: '', clientVersion: '', visitorData: '' };
    }

    /**
     * 原声语言：用于选择正确的字幕轨，避免把译文轨再翻一遍
     */
    function getSourceLang(): string {
      try {
        const player = getPlayer();
        const resp = player?.getPlayerResponse?.() || (window as any).ytInitialPlayerResponse;
        const details = resp?.videoDetails;
        return details?.defaultAudioLanguage || details?.defaultAudioLanguageIso || '';
      } catch (e) {
        return '';
      }
    }

    /**
     * 广告播放期间会切换 videoData.video_id，需让内容脚本忽略，避免清空正片缓存
     */
    function isAdPlaying(): boolean {
      try {
        const player = getPlayer();
        return typeof player?.getAdState === 'function' ? player.getAdState() > 0 : false;
      } catch (e) {
        return false;
      }
    }

    function broadcastTracks(reason: string) {
      const tracks = getCaptionTracks();
      const player = getPlayer();
      const videoData = player?.getVideoData?.() || null;
      const clientInfo = getHostClientInfo();

      window.postMessage(
        {
          source: 'YT_SUB_TRANSLATOR_MAIN',
          type: 'CAPTION_TRACKS_FOUND',
          tracks: tracks || [],
          videoData: videoData,
          clientInfo: clientInfo,
          sourceLang: getSourceLang(),
          isAd: isAdPlaying(),
          reason: reason || 'poll'
        },
        '*'
      );
    }

    /**
     * 借鉴沉浸式翻译核心机制：主动激活/唤醒 YouTube 播放器原生字幕模块
     * 解决“用户未开启原生 CC 时，YouTube 播放器根本不发起 timedtext 请求、导致插件检测不到字幕”的根本痛点
     */
    function triggerSubtitle(force = false) {
      const playerEl = document.querySelector('.html5-video-player');
      const btn = (playerEl?.querySelector('.ytp-subtitles-button') || document.querySelector('.ytp-subtitles-button')) as HTMLElement | null;
      if (btn) {
        const isPressed = btn.getAttribute('aria-pressed') === 'true';
        if (!isPressed) {
          console.log('[YT-Sub-Translator] 借鉴沉浸式翻译: 模拟点击激活原生字幕按钮...');
          btn.click();
        } else if (force) {
          console.log('[YT-Sub-Translator] 借鉴沉浸式翻译: 强制重置刷新字幕按钮...');
          btn.click();
          setTimeout(() => {
            if (btn.getAttribute('aria-pressed') !== 'true') {
              btn.click();
            }
          }, 100);
        }
        return;
      }

      const player = getPlayer();
      if (player && typeof player.toggleSubtitles === 'function') {
        player.toggleSubtitles();
      }
    }

    // 途径 7: 深度拦截 timedtext 网络流量与真实有效字幕数据 (借鉴沉浸式翻译零拷贝拦截)
    const hookNetwork = () => {
      // 1. Hook XMLHttpRequest (沉浸式翻译核心: 直接截获已完成的 responseText)
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
        try {
          (this as any)._timedtextUrl = String(url);
        } catch (e) {}
        return (origOpen as any).apply(this, [method, url, ...rest]);
      };

      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
        try {
          const urlStr = (this as any)._timedtextUrl || '';
          if (urlStr.includes('/api/timedtext') && !urlStr.includes('from_sub_translator=1')) {
            // 先广播 URL (用于备用)
            window.postMessage(
              {
                source: 'YT_SUB_TRANSLATOR_MAIN',
                type: 'CAPTURED_TIMEDTEXT_URL',
                url: urlStr
              },
              '*'
            );

            // 核心突破（借鉴沉浸式翻译）: 监听响应完成，直接截获已下载完毕的 responseText
            this.addEventListener('load', function () {
              try {
                if (this.status === 200 && this.responseText && this.responseText.length > 20) {
                  console.log('[YT-Sub-Translator] 借鉴沉浸式翻译: 零拷贝截获 YouTube 播放器原生完成的 timedtext responseText!');
                  window.postMessage(
                    {
                      source: 'YT_SUB_TRANSLATOR_MAIN',
                      type: 'CAPTURED_TIMEDTEXT_RESPONSE',
                      url: urlStr,
                      responseText: this.responseText
                    },
                    '*'
                  );
                }
              } catch (err) {}
            });
          }
        } catch (e) {}
        return (origSend as any).apply(this, args);
      };

      // 2. Hook window.fetch
      const origFetch = window.fetch;
      window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        let urlStr = '';
        try {
          if (typeof input === 'string') urlStr = input;
          else if (input instanceof URL) urlStr = input.href;
          else if (input && typeof (input as any).url === 'string') urlStr = (input as any).url;

          if (urlStr.includes('/api/timedtext') && !urlStr.includes('from_sub_translator=1')) {
            window.postMessage(
              {
                source: 'YT_SUB_TRANSLATOR_MAIN',
                type: 'CAPTURED_TIMEDTEXT_URL',
                url: urlStr
              },
              '*'
            );
          }
        } catch (e) {}

        const resPromise = origFetch.apply(this, [input, init]);

        if (urlStr && urlStr.includes('/api/timedtext') && !urlStr.includes('from_sub_translator=1')) {
          resPromise.then(async (response) => {
            try {
              if (response.ok) {
                const text = await response.clone().text();
                if (text && text.length > 20) {
                  console.log('[YT-Sub-Translator] 借鉴沉浸式翻译: Fetch 零拷贝截获 timedtext responseText!');
                  window.postMessage(
                    {
                      source: 'YT_SUB_TRANSLATOR_MAIN',
                      type: 'CAPTURED_TIMEDTEXT_RESPONSE',
                      url: urlStr,
                      responseText: text
                    },
                    '*'
                  );
                }
              }
            } catch (err) {}
          }).catch(() => {});
        }

        return resPromise;
      };
    };

    try {
      hookNetwork();
    } catch (e) {
      console.warn('[YT-Sub-Translator] Failed to hook timedtext network:', e);
    }

    // 监听 Content Script 的控制指令
    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'YT_SUB_TRANSLATOR_CONTENT') {
        if (event.data.action === 'REQUEST_TRACKS') {
          broadcastTracks('request');
        } else if (event.data.action === 'TRIGGER_SUBTITLES') {
          triggerSubtitle(!!event.data.force);
        } else if (event.data.action === 'SEEK_TO') {
          const player = getPlayer();
          if (player && typeof player.seekTo === 'function') {
            player.seekTo(event.data.seconds, true);
          }
        }
      }
    });

    // 挂载播放器内部原生事件监听
    const attachPlayerEventListeners = () => {
      const player = getPlayer();
      if (!player) return;

      try {
        if (typeof player.addEventListener === 'function') {
          player.addEventListener('onCaptionsTrackListChanged', () => {
            console.log('[YT-Sub-Translator] onCaptionsTrackListChanged triggered');
            broadcastTracks('player_captions_list_changed');
          });
          player.addEventListener('onCaptionsChange', () => {
            console.log('[YT-Sub-Translator] onCaptionsChange triggered');
            broadcastTracks('player_captions_changed');
          });
        }
      } catch (e) {}
    };

    // 监听 YouTube SPA 路由与播放器变动事件
    window.addEventListener('yt-navigate-finish', () => {
      attachPlayerEventListeners();
      broadcastTracks('yt-navigate-finish-immediate');
      setTimeout(() => broadcastTracks('yt-navigate-finish-500'), 500);
      setTimeout(() => {
        broadcastTracks('yt-navigate-finish-1000');
        triggerSubtitle(false);
      }, 1000);
      setTimeout(() => broadcastTracks('yt-navigate-finish-2500'), 2500);
    });

    // 周期性轮询检测播放器就绪 (最多持续 15 秒轮询，确保慢速网络和异步字幕就绪)
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      attachPlayerEventListeners();
      const tracks = getCaptionTracks();
      if (tracks && tracks.length > 0) {
        broadcastTracks('polling_ready');
        if (attempts > 10) {
          clearInterval(interval);
        }
      } else if (attempts > 30) {
        clearInterval(interval);
      }
    }, 600);

    // 页面初次加载广播与字幕唤醒
    setTimeout(() => {
      attachPlayerEventListeners();
      broadcastTracks('init');
      triggerSubtitle(false);
    }, 500);
  }
});
