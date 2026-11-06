import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  DEFAULT_SETTINGS,
  type YouTubeCaptionTrack,
  type SubtitleSentence,
  type ExtensionSettings,
  type Json3CaptionData
} from '../../types';
import { getStoredSettings } from '../../utils/storage';
import { extractCaptionTokens, segmentCaptionTokens } from '../../utils/segmenter';
import { normalizeCaptionResponse } from '../../utils/caption-parser';
import { ControlBarButtonManager } from '../../utils/control-bar-button';
import { TranslationQueue } from '../../utils/translation-queue';
import { EphemeralSubtitleStore } from '../../utils/ephemeral-subtitle-store';
import { getCachedSentencesBatch, buildSentenceCacheKey } from '../../utils/db-cache';
import { SubtitleOverlay } from './overlay';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    console.log(
      '%c[YT-Sub-Translator v0.2.3]%c Content-script active (Immersive Translate Mode)',
      'background:#2563eb;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
      'color:#16a34a;font-weight:bold;margin-left:4px'
    );

    // 关键优化：首毫秒同步使用 DEFAULT_SETTINGS 立即启动核心系统，
    // 绝不等待 chrome.storage 异步回调，杜绝 Edge/Chrome MV3 因 storage 挂起导致组件永远不显示！
    let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    let overlay: SubtitleOverlay | null = null;
    let buttonManager: ControlBarButtonManager | null = null;
    let translationQueue: TranslationQueue | null = null;
    let videoElement: HTMLVideoElement | null = null;
    let currentVideoId: string = '';
    let currentSentences: SubtitleSentence[] = [];
    let isFullAiRunning = false;
    let nativeSubtitleStyleEl: HTMLStyleElement | null = null;
    let lastCaptionData: Json3CaptionData | null = null;
    let currentLoadingTrackUrl: string = '';
    let urlWatchdogTimer: any = null;
    let captionsWatchdogTimer: any = null;
    let captionsWatchdogAttempts = 0;
    let cachedHostClientInfo: { apiKey?: string; clientVersion?: string } = {};
    // 注意：必须在使用前完成声明。setupPlayerAndOverlay() 在启动时就会执行，并会重置该变量；
    // 若声明位置晚于调用点，会触发 "Cannot access 'pipTextTrack' before initialization" (TDZ) 并使整个 main() 中断。
    let pipTextTrack: TextTrack | null = null;
    // 单飞锁：防止多次 CAPTION_TRACKS_FOUND 广播触发多条并发的 41 音轨拉取瀑布
    let trackCascadeActive = false;
    // 记录已消费的字幕 token 数，允许后续更完整的截获结果覆盖先到的分片/广告字幕
    let lastCaptionTokenCount = 0;

    // 1. 同步实例化核心管理器
    translationQueue = new TranslationQueue(settings, {
      batchSize: 8,
      onSentenceUpdated: () => {
        if (overlay) overlay.setSentences(currentSentences);
        if (document.pictureInPictureElement && document.pictureInPictureElement === videoElement) {
          refreshPipCues();
        }
      }
    });

    // 启动控制栏快捷按钮（沉浸式/高保真自愈版）
    buttonManager = new ControlBarButtonManager(
      {
        onClick: () => {
          if (overlay) overlay.toggleQuickPanel();
        }
      },
      settings.enabled
    );
    buttonManager.init();

    // 立即初始化播放器与浮层
    initPlayerObserver();
    detectCurrentVideoAndLoad();
    initDomCaptionObserver();
    startUrlWatchdog();

    // 2. 异步载入持久化配置并无缝更新各子模块
    getStoredSettings().then((s) => {
      settings = s;
      updateNativeSubtitleVisibility();
      if (buttonManager) buttonManager.setEnabled(settings.enabled);
      if (translationQueue) translationQueue.updateSettings(settings);
      if (overlay) overlay.updateSettings(settings);
      if (currentSentences.length > 0) {
        startPreTranslationPipeline();
      }
    });

    // 3. 监听来自 Background/Popup 的配置更新通知
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'SETTINGS_UPDATED') {
        const prevLang = settings?.targetLang;
        const prevScenario = settings?.scenario;
        const prevReasoning = settings?.reasoningEffort;
        const prevPause = settings?.pauseThreshold;
        const prevMaxWords = settings?.maxWordsPerSentence;
        settings = message.settings;

        updateNativeSubtitleVisibility();
        if (buttonManager) {
          buttonManager.setEnabled(settings.enabled);
        }
        if (translationQueue) {
          translationQueue.updateSettings(settings);
        }
        if (overlay) {
          overlay.updateSettings(settings);
        }

        if (
          lastCaptionData &&
          (prevPause !== settings.pauseThreshold || prevMaxWords !== settings.maxWordsPerSentence)
        ) {
          reSegmentAndReload(lastCaptionData);
        } else if (
          prevLang !== settings.targetLang ||
          prevScenario !== settings.scenario ||
          prevReasoning !== settings.reasoningEffort
        ) {
          reTranslateAll();
        }
      }
    });

    /**
     * 借鉴沉浸式翻译：优雅控制原生字幕显隐
     * 当插件启用且开启隐藏原生字幕时，隐藏 YouTube 原生粗黑框字幕，避免激活原生字幕管线后产生视觉重叠与闪烁
     */
    function updateNativeSubtitleVisibility() {
      if (!nativeSubtitleStyleEl) {
        nativeSubtitleStyleEl = document.createElement('style');
        nativeSubtitleStyleEl.id = 'yt-sub-translator-native-sub-hider';
        document.head.appendChild(nativeSubtitleStyleEl);
      }

      if (settings?.enabled && settings?.autoHideNativeSubtitles) {
        nativeSubtitleStyleEl.textContent = `
          .ytp-caption-window-container,
          .caption-window {
            opacity: 0 !important;
            pointer-events: none !important;
          }
        `;
      } else {
        nativeSubtitleStyleEl.textContent = '';
      }
    }

    /**
     * 初始化播放器观察器（全天候自愈感知）
     */
    function initPlayerObserver() {
      setupPlayerAndOverlay();

      const observer = new MutationObserver(() => {
        setupPlayerAndOverlay();
        if (buttonManager) {
          buttonManager.checkAndMount();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // 请求 MAIN world bridge 脚本发送字幕音轨
      window.postMessage({ source: 'YT_SUB_TRANSLATOR_CONTENT', action: 'REQUEST_TRACKS' }, '*');
    }

    /**
     * 获取当前主播放器正在使用的核心 HTML5 Video 元素
     */
    function getActiveVideoElement(): HTMLVideoElement | null {
      // 优先从主播放器容器查找，排除缩略图预览
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (watchFlexy) {
        const v = watchFlexy.querySelector('video') as HTMLVideoElement;
        if (v) return v;
      }
      const mainPlayer = document.getElementById('movie_player');
      if (mainPlayer) {
        const v = mainPlayer.querySelector('video') as HTMLVideoElement;
        if (v) return v;
      }
      return document.querySelector('.html5-video-player:not(.ytp-preview) video, video') as HTMLVideoElement;
    }

    /**
     * 获取当前主播放器容器
     */
    function getActivePlayerContainer(): HTMLElement | null {
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (watchFlexy) {
        const p = (watchFlexy.querySelector('#movie_player') || watchFlexy.querySelector('.html5-video-player')) as HTMLElement;
        if (p) return p;
      }
      return (document.getElementById('movie_player') || document.querySelector('.html5-video-player:not(.ytp-preview)')) as HTMLElement;
    }

    /**
     * 绑定播放器与 Overlay（严格保证 video 元素始终有效且监听不丢失）
     */
    function setupPlayerAndOverlay() {
      const player = getActivePlayerContainer();
      const video = getActiveVideoElement();

      if (!player || !video) return;

      if (!overlay) {
        overlay = new SubtitleOverlay(settings, {
          onSeek: (seconds) => {
            window.postMessage(
              { source: 'YT_SUB_TRANSLATOR_CONTENT', action: 'SEEK_TO', seconds },
              '*'
            );
          },
          onSettingsChange: (newSettings) => {
            chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: newSettings });
          },
          onRetryTranslation: (sentenceId) => {
            if (sentenceId) {
              retrySingleSentence(sentenceId);
            } else {
              reTranslateAll();
            }
          },
          onRequestAiSubtitles: () => {
            handleRequestAiSubtitles();
          },
          onClearAiSubtitles: () => {
            handleClearAiSubtitles();
          },
          onRequestDetectCaptions: () => {
            currentLoadingTrackUrl = '';
            detectCurrentVideoAndLoad();
            startCaptionsWatchdog();
          }
        });
      }

      overlay.ensureMounted(player);

      if (videoElement !== video) {
        if (videoElement) {
          videoElement.removeEventListener('timeupdate', handleTimeUpdate);
          videoElement.removeEventListener('click', handleVideoClick);
          videoElement.removeEventListener('enterpictureinpicture', handleEnterPiP);
          videoElement.removeEventListener('leavepictureinpicture', handleLeavePiP);
        }
        videoElement = video;
        pipTextTrack = null;
        videoElement.addEventListener('timeupdate', handleTimeUpdate);
        videoElement.addEventListener('click', handleVideoClick);
        videoElement.addEventListener('enterpictureinpicture', handleEnterPiP);
        videoElement.addEventListener('leavepictureinpicture', handleLeavePiP);
      }

      if (buttonManager) {
        buttonManager.checkAndMount();
      }
    }

    function getOrCreatePipTrack(): TextTrack | null {
      if (!videoElement) return null;
      if (pipTextTrack) return pipTextTrack;
      try {
        for (let i = 0; i < videoElement.textTracks.length; i++) {
          const t = videoElement.textTracks[i];
          if (t.label === 'YT-Sub-Translator-PiP') {
            pipTextTrack = t;
            return pipTextTrack;
          }
        }
        pipTextTrack = videoElement.addTextTrack('subtitles', 'YT-Sub-Translator-PiP', settings.targetLang || 'zh');
      } catch (e) {
        console.warn('[YT-Sub-Translator] 创建画中画 TextTrack 异常:', e);
      }
      return pipTextTrack;
    }

    function refreshPipCues() {
      const track = getOrCreatePipTrack();
      if (!track) return;

      if (track.cues) {
        const oldCues = Array.from(track.cues);
        for (const c of oldCues) {
          try {
            track.removeCue(c);
          } catch {}
        }
      }

      for (const s of currentSentences) {
        if (!s.text) continue;
        const startSec = Math.max(0, s.start / 1000);
        const endSec = Math.max(startSec + 0.3, s.end / 1000);
        let cueContent = '';
        const trans = s.translation && !s.translation.startsWith('[') ? s.translation : '';

        if (settings.displayMode === 'original_only') {
          cueContent = s.text;
        } else if (settings.displayMode === 'translation_only') {
          cueContent = trans || s.text;
        } else {
          if (settings.layoutOrder === 'translation_top') {
            cueContent = trans ? `${trans}\n${s.text}` : s.text;
          } else {
            cueContent = trans ? `${s.text}\n${trans}` : s.text;
          }
        }

        try {
          if (typeof VTTCue !== 'undefined') {
            const cue = new VTTCue(startSec, endSec, cueContent);
            track.addCue(cue);
          }
        } catch {}
      }
    }

    function handleEnterPiP() {
      console.log('[YT-Sub-Translator] 视频进入画中画模式，激活原生双语 TextTrack...');
      const track = getOrCreatePipTrack();
      if (track) {
        refreshPipCues();
        track.mode = 'showing';
      }
    }

    function handleLeavePiP() {
      console.log('[YT-Sub-Translator] 视频离开画中画模式，停用原生 TextTrack...');
      const track = getOrCreatePipTrack();
      if (track) {
        track.mode = 'disabled';
      }
    }

    function handleVideoClick() {
      if (overlay) {
        overlay.toggleQuickPanel(false);
      }
    }

    function handleTimeUpdate() {
      if (!videoElement || !overlay) return;
      const currentTimeMs = videoElement.currentTime * 1000;
      overlay.onTimeUpdate(currentTimeMs);
      if (translationQueue) {
        translationQueue.triggerForTime(currentTimeMs, settings.syncOffsetMs);
      }
      if (buttonManager) {
        buttonManager.checkAndMount();
      }
    }

    function getVideoIdFromUrl(): string {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('v') || '';
    }

    /**
     * 全天候 URL 探测看门狗：
     * 每 300ms 探测 URL 变化，解决 YouTube SPA 路由跳转无刷新导致的组件丢失问题
     */
    function startUrlWatchdog() {
      if (urlWatchdogTimer) clearInterval(urlWatchdogTimer);
      urlWatchdogTimer = setInterval(() => {
        const vid = getVideoIdFromUrl();
        if (vid && vid !== currentVideoId) {
          console.log(`[YT-Sub-Translator] Watchdog detected video change: ${currentVideoId} -> ${vid}`);
          handleVideoChange(vid);
        }
      }, 300);
    }

    function handleVideoChange(newVid: string) {
      if (currentVideoId) {
        EphemeralSubtitleStore.clear(currentVideoId);
      }
      currentVideoId = newVid;
      EphemeralSubtitleStore.init(newVid);
      currentSentences = [];
      lastCaptionData = null;
      currentLoadingTrackUrl = '';
      lastCaptionTokenCount = 0;
      trackCascadeActive = false;
      updateNativeSubtitleVisibility();

      if (overlay) {
        overlay.resetReadyBadgeState();
        overlay.setSentences([]);
        overlay.resetAiProgress();
        overlay.setTrackEmpty(false);
      }

      setupPlayerAndOverlay();
      if (buttonManager) {
        buttonManager.checkAndMount();
      }

      // 重置并启动突发探测与看门狗
      stopCaptionsWatchdog();
      startCaptionsWatchdog();

      // 启动突发高频字幕探测
      detectCurrentVideoAndLoad();
      setTimeout(() => detectCurrentVideoAndLoad(), 250);
      setTimeout(() => detectCurrentVideoAndLoad(), 700);
      setTimeout(() => detectCurrentVideoAndLoad(), 1500);
      setTimeout(() => detectCurrentVideoAndLoad(), 3000);
      setTimeout(() => detectCurrentVideoAndLoad(), 5500);
    }

    /**
     * 智能字幕自愈看门狗：
     * 借鉴沉浸式翻译：如果视频刚打开时未拿到字幕，自动温和唤醒原生字幕模块
     */
    function startCaptionsWatchdog() {
      stopCaptionsWatchdog();
      captionsWatchdogAttempts = 0;
      captionsWatchdogTimer = setInterval(() => {
        captionsWatchdogAttempts++;
        if (currentSentences.length > 0) {
          stopCaptionsWatchdog();
          return;
        }

        // 持续检测 (约 15 秒)，并在未获得字幕时，借鉴沉浸式翻译模拟唤醒原生字幕模块
        if (captionsWatchdogAttempts <= 8) {
          detectCurrentVideoAndLoad();
          if (captionsWatchdogAttempts >= 2) {
            window.postMessage(
              {
                source: 'YT_SUB_TRANSLATOR_CONTENT',
                action: 'TRIGGER_SUBTITLES',
                force: captionsWatchdogAttempts === 3
              },
              '*'
            );
          }
        } else {
          stopCaptionsWatchdog();
          if (overlay && currentSentences.length === 0) {
            overlay.setTrackEmpty(true, 'watchdog_timeout');
          }
        }
      }, 1500);
    }

    function stopCaptionsWatchdog() {
      if (captionsWatchdogTimer) {
        clearInterval(captionsWatchdogTimer);
        captionsWatchdogTimer = null;
      }
    }

    /**
     * 视频检测主函数（借鉴沉浸式翻译多通道融合秒级检出）
     */
    function detectCurrentVideoAndLoad() {
      const vid = getVideoIdFromUrl();
      if (!vid) return;

      if (vid !== currentVideoId) {
        handleVideoChange(vid);
        return;
      }

      if (currentSentences.length > 0) return;

      // 策略 1: 请求 MAIN world bridge 脚本（广播音轨 + 唤醒原生字幕管线）
      window.postMessage({ source: 'YT_SUB_TRANSLATOR_CONTENT', action: 'REQUEST_TRACKS' }, '*');
      window.postMessage({ source: 'YT_SUB_TRANSLATOR_CONTENT', action: 'TRIGGER_SUBTITLES' }, '*');

      // 策略 2: 直接扫描当前页面 DOM script 标签
      const domTracks = scanTracksFromDomScripts();
      if (domTracks && domTracks.length > 0) {
        console.log('[YT-Sub-Translator] Found caption tracks from DOM scripts:', domTracks.length);
        handleCaptionTracks(domTracks);
        return;
      }

      // 策略 3: 若前两项未生效，通过后台 YouTubei API 双模式兜底
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_TRACKS_BY_VIDEO_ID',
          payload: {
            videoId: vid,
            apiKey: cachedHostClientInfo.apiKey,
            clientVersion: cachedHostClientInfo.clientVersion
          }
        },
        (res) => {
          if (res && res.success && res.tracks && res.tracks.length > 0 && currentSentences.length === 0) {
            console.log('[YT-Sub-Translator] Fetched tracks via YouTubei fallback:', res.tracks.length);
            handleCaptionTracks(res.tracks);
          }
        }
      );
    }

    function scanTracksFromDomScripts(): YouTubeCaptionTrack[] | null {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (text.includes('captionTracks') && (text.includes('playerCaptionsTracklistRenderer') || text.includes('baseUrl'))) {
          try {
            const match = text.match(/"captionTracks":\s*(\[[\s\S]+?\])/);
            if (match && match[1]) {
              const tracks = JSON.parse(match[1]);
              if (Array.isArray(tracks) && tracks.length > 0) {
                return tracks;
              }
            }
          } catch (e) {}
        }
      }
      return null;
    }

    /**
     * 接收来自 MAIN world bridge 脚本的消息
     */
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.source !== 'YT_SUB_TRANSLATOR_MAIN') return;

      if (event.data.type === 'CAPTION_TRACKS_FOUND') {
        const { tracks, videoData, clientInfo } = event.data;
        if (clientInfo) {
          cachedHostClientInfo = clientInfo;
        }

        const newVid = videoData?.video_id || getVideoIdFromUrl();
        if (newVid && newVid !== currentVideoId) {
          handleVideoChange(newVid);
        }

        if (tracks && tracks.length > 0) {
          handleCaptionTracks(tracks);
        }
      } else if (event.data.type === 'CAPTURED_TIMEDTEXT_RESPONSE') {
        // 核心突破（借鉴沉浸式翻译）：零拷贝直接获取 YouTube 播放器刚完成的 responseText
        // 彻底免去多余的二次网络请求，杜绝 429 频率限制与 Cookie 鉴权丢失！
        const { url, responseText } = event.data;
        if (!responseText) return;

        // 广告/预加载也会走 timedtext，必须校验视频 ID，避免把其他视频的字幕套到当前视频上
        const capturedVid = (String(url).match(/[?&]v=([^&]+)/) || [])[1];
        if (capturedVid && currentVideoId && capturedVid !== currentVideoId) {
          return;
        }

        try {
          const data = normalizeCaptionResponse(responseText);
          const tokens = extractCaptionTokens(data);
          // 仅接受比已消费数据更完整的响应：先到的分片/广告字幕可被后续完整字幕替换
          if (tokens.length > 0 && tokens.length > lastCaptionTokenCount) {
            console.log(`[YT-Sub-Translator] 借鉴沉浸式翻译: 零拷贝装载原生字幕 (${tokens.length} tokens)`);
            lastCaptionTokenCount = tokens.length;
            lastCaptionData = data;
            processCaptionData(data);
            stopCaptionsWatchdog();
          }
        } catch (e) {
          console.warn('[YT-Sub-Translator] 解析截获的原生字幕数据失败:', e);
        }
      } else if (event.data.type === 'CAPTURED_TIMEDTEXT_URL') {
        // 兜底机制：若未拦截到响应体，尝试通过 Background 代理拉取
        const { url } = event.data;
        if (url && currentSentences.length === 0 && url !== currentLoadingTrackUrl) {
          console.log('[YT-Sub-Translator] Direct timedtext URL intercepted from YouTube player:', url);
          currentLoadingTrackUrl = url;
          chrome.runtime.sendMessage(
            { type: 'FETCH_CAPTIONS', payload: { url } },
            (response) => {
              if (response && response.success && response.data && currentSentences.length === 0) {
                lastCaptionData = response.data;
                processCaptionData(response.data);
                stopCaptionsWatchdog();
              }
            }
          );
        }
      }
    });

    // 突发事件全量监听：处理 SPA 路由切换与状态刷新
    const triggerNavigationSync = () => {
      const vid = getVideoIdFromUrl();
      if (vid && vid !== currentVideoId) {
        handleVideoChange(vid);
      } else {
        setupPlayerAndOverlay();
        if (buttonManager) buttonManager.checkAndMount();
        detectCurrentVideoAndLoad();
      }
    };

    window.addEventListener('yt-navigate-start', triggerNavigationSync);
    window.addEventListener('yt-navigate-finish', () => {
      triggerNavigationSync();
      setTimeout(triggerNavigationSync, 200);
      setTimeout(triggerNavigationSync, 600);
      setTimeout(triggerNavigationSync, 1500);
    });
    window.addEventListener('yt-page-data-updated', triggerNavigationSync);
    window.addEventListener('spfdone', triggerNavigationSync);
    window.addEventListener('popstate', () => {
      triggerNavigationSync();
      setTimeout(triggerNavigationSync, 300);
    });

    function sortCaptionTracks(tracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack[] {
      const validTracks = tracks.filter((t) => !!t.baseUrl);
      if (validTracks.length <= 1) return validTracks;

      const getScore = (track: YouTubeCaptionTrack): number => {
        let score = 0;
        const lang = (track.languageCode || '').toLowerCase();
        const rawName = typeof track.name === 'string'
          ? track.name
          : (track.name?.simpleText || track.name?.runs?.[0]?.text || '');
        const isAsr = track.kind === 'asr';

        // 1. 人工优质字幕基础分 100 分，自动生成字幕 40 分
        score += isAsr ? 40 : 100;

        // 2. 源语言偏好权重
        if (lang.startsWith('ja')) {
          score += 60; // 日语
        } else if (lang.startsWith('en')) {
          score += 45; // 英语
        } else if (lang.startsWith('zh')) {
          score += 35; // 中文
        } else if (lang.startsWith('ko')) {
          score += 30; // 韩语
        }

        // 3. 原声关键字加分
        if (/original|原声|日本語|Japanese/i.test(rawName)) {
          score += 20;
        }

        return score;
      };

      return validTracks.sort((a, b) => getScore(b) - getScore(a));
    }

    /**
     * 选择最适字幕音轨并拉取数据 (带多音轨自动无缝候选回退机制)
     * 彻底解决某个 ASR 音轨为空或损坏导致整个视频被误判为“无可用字幕”的严重缺陷
     */
    function handleCaptionTracks(tracks: YouTubeCaptionTrack[]) {
      if (!tracks || tracks.length === 0) return;
      if (currentSentences.length > 0) return;
      // 单飞：同一时刻只允许一条候选音轨瀑布，避免重复广播造成 N 倍并发请求
      if (trackCascadeActive) return;
      trackCascadeActive = true;

      const candidateTracks = sortCaptionTracks(tracks);
      // YouTube 的 baseUrl 现需 pot 令牌才返回数据，逐个试 41 条只会触发 429。
      // 这里只做有限次兜底，主要数据源仍是播放器自身请求的零拷贝截获。
      const MAX_CANDIDATES = 3;
      const maxAttempts = Math.min(candidateTracks.length, MAX_CANDIDATES);
      console.log(`[YT-Sub-Translator] Candidate tracks (${candidateTracks.length}), will try ${maxAttempts}:`, candidateTracks.slice(0, maxAttempts).map(t => `${t.languageCode}[${t.kind || 'manual'}]`));

      let currentIndex = 0;

      const finishCascade = () => {
        trackCascadeActive = false;
      };

      const tryFetchCandidate = () => {
        if (currentSentences.length > 0) {
          finishCascade();
          return;
        }

        if (currentIndex >= maxAttempts) {
          console.warn('[YT-Sub-Translator] Candidate tracks exhausted, waiting for zero-copy sniffer.');
          finishCascade();
          if (currentSentences.length === 0) {
            if (overlay) {
              overlay.setTrackEmpty(true, 'all_tracks_empty');
            }
          }
          return;
        }

        const track = candidateTracks[currentIndex];
        currentIndex++;

        let fetchUrl = track.baseUrl;
        if (!fetchUrl.includes('fmt=')) {
          fetchUrl += '&fmt=json3';
        }

        if (fetchUrl === currentLoadingTrackUrl && currentSentences.length > 0) {
          finishCascade();
          return;
        }

        currentLoadingTrackUrl = fetchUrl;
        console.log(`[YT-Sub-Translator] Attempting track [${currentIndex}/${maxAttempts}]:`, track.languageCode, track.kind || 'manual');

        chrome.runtime.sendMessage(
          { type: 'FETCH_CAPTIONS', payload: { url: fetchUrl } },
          (response) => {
            if (response && response.success && response.data) {
              const tokens = extractCaptionTokens(response.data);
              if (tokens.length > 0) {
                console.log(`[YT-Sub-Translator] ✓ Successfully loaded track [${track.languageCode}] (${tokens.length} tokens).`);
                lastCaptionTokenCount = tokens.length;
                lastCaptionData = response.data;
                processCaptionData(response.data);
                stopCaptionsWatchdog();
                finishCascade();
                return;
              } else {
                console.warn(`[YT-Sub-Translator] Track [${track.languageCode}] returned 0 tokens. Falling back to next candidate...`);
              }
            } else {
              console.warn(`[YT-Sub-Translator] Track [${track.languageCode}] fetch failed:`, response?.error);
            }

            // 失败或该轨 0 tokens 时，自动尝试下一个候选音轨！
            tryFetchCandidate();
          }
        );
      };

      tryFetchCandidate();
    }

    function processCaptionData(data: Json3CaptionData) {
      const tokens = extractCaptionTokens(data);
      console.log(`[YT-Sub-Translator] Tokens count: ${tokens.length}`);

      if (tokens.length === 0) {
        currentSentences = [];
        updateNativeSubtitleVisibility();
        if (overlay) {
          overlay.setSentences([]);
          overlay.setTrackEmpty(true, 'empty_track');
        }
        return;
      }

      if (overlay) {
        overlay.setTrackEmpty(false);
      }

      const sentences = segmentCaptionTokens(tokens, settings);
      console.log(`[YT-Sub-Translator] Segmented into ${sentences.length} sentences.`);

      // 检查当前视频是否已有临时 AI 字幕缓存
      const cached = EphemeralSubtitleStore.load(currentVideoId);
      if (cached && cached.length === sentences.length && cached.some((s) => s.translation)) {
        console.log('[YT-Sub-Translator] Loaded from ephemeral subtitle store for video:', currentVideoId);
        currentSentences = cached;
        updateNativeSubtitleVisibility();
        if (overlay) {
          overlay.setSentences(currentSentences, true);
          const doneCount = cached.filter((s) => s.translation).length;
          if (doneCount === cached.length) {
            overlay.setAiComplete(doneCount);
          }
        }
      } else {
        currentSentences = sentences;
        updateNativeSubtitleVisibility();
        if (overlay) {
          overlay.setSentences(currentSentences, true);
          overlay.resetAiProgress();
        }
        hydrateSentencesFromCache().then(() => {
          startPreTranslationPipeline();
        });
      }
    }

    async function hydrateSentencesFromCache() {
      if (currentSentences.length === 0) return;
      const texts = currentSentences.map((s) => s.text);
      const cacheKeys = texts.map((t) =>
        buildSentenceCacheKey(settings.targetLang, t, settings.scenario, settings.reasoningEffort, settings.service)
      );
      try {
        const cachedMap = await getCachedSentencesBatch(cacheKeys);
        let hitCount = 0;
        for (let i = 0; i < currentSentences.length; i++) {
          const trans = cachedMap.get(cacheKeys[i]);
          if (trans && !currentSentences[i].translation) {
            currentSentences[i].translation = trans;
            currentSentences[i].status = 'done';
            hitCount++;
          }
        }
        if (hitCount > 0) {
          console.log(`[YT-Sub-Translator] 从本地持久化缓存命中 ${hitCount}/${currentSentences.length} 句字幕`);
          if (overlay) {
            overlay.setSentences(currentSentences);
          }
          if (document.pictureInPictureElement && document.pictureInPictureElement === videoElement) {
            refreshPipCues();
          }
        }
      } catch (e) {
        console.warn('[YT-Sub-Translator] 读取持久化缓存异常:', e);
      }
    }

    function reSegmentAndReload(data: Json3CaptionData) {
      const tokens = extractCaptionTokens(data);
      const sentences = segmentCaptionTokens(tokens, settings);
      currentSentences = sentences;
      updateNativeSubtitleVisibility();
      if (overlay) {
        overlay.setSentences(currentSentences);
      }
      hydrateSentencesFromCache().then(() => {
        startPreTranslationPipeline();
      });
    }

    function reTranslateAll() {
      for (const s of currentSentences) {
        s.translation = undefined;
        s.status = 'idle';
        s.isAi = false;
      }
      if (overlay) overlay.setSentences(currentSentences);
      startPreTranslationPipeline();
    }

    function retrySingleSentence(sentenceId: number) {
      const target = currentSentences.find((s) => s.id === sentenceId);
      if (!target) return;

      target.translation = undefined;
      target.status = 'translating';
      if (overlay) overlay.setSentences(currentSentences);

      chrome.runtime.sendMessage(
        {
          type: 'TRANSLATE_BATCH',
          payload: {
            texts: [target.text],
            targetLang: settings.targetLang,
            settings
          }
        },
        (res) => {
          if (res && res.success && Array.isArray(res.translations) && res.translations.length > 0) {
            target.translation = res.translations[0];
            target.status = 'done';
          } else {
            target.status = 'error';
            target.translation = `[翻译失败: ${res?.error || '网络不可达'}]`;
          }
          if (overlay) overlay.setSentences(currentSentences);
        }
      );
    }

    function startPreTranslationPipeline() {
      if (currentSentences.length === 0 || !translationQueue) return;
      translationQueue.setSentences(currentSentences);
      const curMs = videoElement ? videoElement.currentTime * 1000 : 0;
      translationQueue.triggerForTime(curMs, settings.syncOffsetMs);
    }

    /**
     * 全篇 AI 深度字幕精翻管线
     */
    async function handleRequestAiSubtitles() {
      if (isFullAiRunning) {
        if (overlay) overlay.showToast('AI 深度精翻正在执行中，请稍候...');
        return;
      }

      if (currentSentences.length === 0) {
        if (overlay) overlay.showToast('尚未获取到自动字幕，请先开启视频 CC 自动字幕');
        return;
      }

      // 检查当前视频是否已缓存全篇
      const cached = EphemeralSubtitleStore.load(currentVideoId);
      if (cached && cached.length === currentSentences.length && cached.every((s) => s.translation)) {
        currentSentences = cached;
        if (overlay) {
          overlay.setSentences(currentSentences);
          overlay.setAiComplete(currentSentences.length);
          overlay.showToast('已直接从当前视频临时缓存载入全篇 AI 字幕！');
        }
        return;
      }

      isFullAiRunning = true;
      if (overlay) {
        overlay.showToast(`正在为全篇 ${currentSentences.length} 句字幕启动 AI 深度精翻...`);
        overlay.updateAiProgress(0, `准备开始精翻 (共 ${currentSentences.length} 句)...`);
      }

      const batchSize = 12;
      const chunks: SubtitleSentence[][] = [];
      for (let i = 0; i < currentSentences.length; i += batchSize) {
        chunks.push(currentSentences.slice(i, i + batchSize));
      }

      let doneSentences = 0;
      const totalSentences = currentSentences.length;

      // 预先统计已有译文的句子
      for (const s of currentSentences) {
        if (s.translation && s.status === 'done') {
          doneSentences++;
        }
      }

      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        const needTrans = chunk.filter((s) => !s.translation || s.status !== 'done');

        if (needTrans.length > 0) {
          for (const s of needTrans) s.status = 'translating';
          if (overlay) overlay.setSentences(currentSentences);

          try {
            const texts = needTrans.map((s) => s.text);
            const res = await new Promise<any>((resolve) => {
              chrome.runtime.sendMessage(
                {
                  type: 'TRANSLATE_BATCH',
                  payload: {
                    texts,
                    targetLang: settings.targetLang,
                    settings,
                    noFallback: true,   // AI 深度字幕严禁用谷歌机翻冒充
                    bypassCache: true
                  }
                },
                resolve
              );
            });

            if (res && res.success && Array.isArray(res.translations)) {
              for (let j = 0; j < needTrans.length; j++) {
                needTrans[j].translation = res.translations[j] || needTrans[j].text;
                needTrans[j].status = 'done';
                needTrans[j].isAi = true;
                doneSentences++;
              }
            } else {
              for (const s of needTrans) {
                s.status = 'error';
                s.translation = `[AI精翻重试: ${res?.error || '网络连接超时'}]`;
              }
            }
          } catch (e: any) {
            for (const s of needTrans) {
              s.status = 'error';
              s.translation = `[AI精翻异常: ${e.message}]`;
            }
          }

          // 实时写入本地临时缓存
          EphemeralSubtitleStore.save(currentVideoId, currentSentences);

          const percent = Math.min(100, Math.round((doneSentences / totalSentences) * 100));
          if (overlay) {
            overlay.updateAiProgress(percent, `已处理 ${doneSentences}/${totalSentences} 句 (${percent}%)`);
            overlay.setSentences(currentSentences);
          }
        }
      }

      isFullAiRunning = false;
      EphemeralSubtitleStore.save(currentVideoId, currentSentences);
      if (overlay) {
        overlay.setAiComplete(totalSentences);
        overlay.setSentences(currentSentences);
        overlay.showToast('全篇 AI 深度字幕已精翻完成！已临时存储在本地，切片/关闭后自动销毁');
      }
    }

    /**
     * 清理当前视频的临时 AI 字幕
     */
    function handleClearAiSubtitles() {
      EphemeralSubtitleStore.clear(currentVideoId);
      for (const s of currentSentences) {
        s.translation = undefined;
        s.status = 'idle';
        s.isAi = false;
      }
      if (overlay) {
        overlay.setSentences(currentSentences);
        overlay.resetAiProgress();
        overlay.showToast('已清空当前视频的临时 AI 字幕缓存');
      }
      startPreTranslationPipeline();
    }

    /**
     * 引擎 2：DOM 原生字幕实时捕获兜底器
     */
    let lastDomCaptionText = '';
    let liveTranslateTimer: any = null;

    function initDomCaptionObserver() {
      const captionObserver = new MutationObserver(() => {
        if (!settings?.enabled) return;

        const segments = document.querySelectorAll('.ytp-caption-segment');
        if (segments.length === 0) return;

        // 只要原生字幕正在显示，立刻消除无字幕空状态，并启动看门狗探测全轨
        if (overlay) {
          overlay.setTrackEmpty(false);
        }

        if (currentSentences.length === 0) {
          detectCurrentVideoAndLoad();
        } else {
          // 如果已有全量断句轨，则优先走全量轨道，无需实时逐词翻译覆盖
          return;
        }

        let fullText = '';
        segments.forEach((seg) => {
          fullText += ' ' + (seg.textContent || '').trim();
        });
        fullText = fullText.trim();

        if (fullText && fullText !== lastDomCaptionText && fullText.length > 1) {
          lastDomCaptionText = fullText;
          clearTimeout(liveTranslateTimer);
          liveTranslateTimer = setTimeout(() => {
            chrome.runtime.sendMessage(
              {
                type: 'TRANSLATE_BATCH',
                payload: {
                  texts: [fullText],
                  targetLang: settings.targetLang,
                  settings
                }
              },
              (res) => {
                if (res && res.success && Array.isArray(res.translations) && res.translations[0]) {
                  if (overlay) {
                    overlay.renderLiveCaption(fullText, res.translations[0]);
                  }
                }
              }
            );
          }, 200);
        }
      });

      captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }
});
