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
import {
  AI_TRACK_BATCH_SIZE,
  AI_TRACK_CONTEXT_WINDOW,
  buildAiTrackRecord,
  buildResumeBatches,
  decideAiRunAction,
  planResume,
  type AiResumePlan,
  type AiTrackRecord
} from '../../utils/ai-track-cache';
import { getCachedSentencesBatch, buildSentenceCacheKey } from '../../utils/db-cache';
import { SubtitleOverlay } from './overlay';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    console.log(
      '%c[YT-Sub-Translator v0.4.3]%c Content-script active (Immersive Translate Mode)',
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
    let cachedHostClientInfo: { apiKey?: string; clientVersion?: string; visitorData?: string } = {};
    // 注意：必须在使用前完成声明。setupPlayerAndOverlay() 在启动时就会执行，并会重置该变量；
    // 若声明位置晚于调用点，会触发 "Cannot access 'pipTextTrack' before initialization" (TDZ) 并使整个 main() 中断。
    let pipTextTrack: TextTrack | null = null;
    // 单飞锁：防止多次 CAPTION_TRACKS_FOUND 广播触发多条并发的 41 音轨拉取瀑布
    let trackCascadeActive = false;
    // 记录已消费的字幕 token 数，允许后续更完整的截获结果覆盖先到的分片/广告字幕
    let lastCaptionTokenCount = 0;
    // 当前视频原声语言（由 MAIN world 从 playerResponse 读出），用于选对字幕轨
    let currentSourceLang = '';
    // AI 全篇精翻的运行代际：切视频时自增，旧循环立即失效，避免把旧字幕写进新视频
    let aiRunToken = 0;
    // 「命中本地 AI 精翻缓存」日志每部视频只打一次，避免每批都刷屏
    let aiTrackHitLoggedFor = '';
    // 播放器 / 字幕 DOM 观察器的节流计时器
    let playerSyncTimer: any = null;
    let domCaptionTimer: any = null;
    let playerObserver: MutationObserver | null = null;
    let captionObserver: MutationObserver | null = null;
    let captionObserverTarget: Element | null = null;
    // 广告会耗尽看门狗，广告结束后允许有限次数重新武装
    let watchdogRearms = 0;

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
        const prevMaxChars = settings?.maxCharsPerSentence;
        const prevMaxDuration = settings?.maxDurationMs;
        const prevSegLang = settings?.segmentationLanguage;
        const prevMergeFragments = settings?.mergeShortFragments;
        const prevAutoPunct = settings?.autoPunctuation;
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
          (prevPause !== settings.pauseThreshold ||
            prevMaxWords !== settings.maxWordsPerSentence ||
            prevMaxChars !== settings.maxCharsPerSentence ||
            prevMaxDuration !== settings.maxDurationMs ||
            prevSegLang !== settings.segmentationLanguage ||
            prevMergeFragments !== settings.mergeShortFragments ||
            prevAutoPunct !== settings.autoPunctuation)
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
     * 仅在插件已经拿到可渲染字幕后才隐藏原生字幕；
     * 否则取轨失败时会把原生字幕也一起隐藏，用户会彻底看不到字幕。
     */
    function updateNativeSubtitleVisibility() {
      if (!nativeSubtitleStyleEl) {
        nativeSubtitleStyleEl = document.createElement('style');
        nativeSubtitleStyleEl.id = 'yt-sub-translator-native-sub-hider';
        document.head.appendChild(nativeSubtitleStyleEl);
      }

      const shouldHide =
        settings?.enabled && settings?.autoHideNativeSubtitles && currentSentences.length > 0;

      if (shouldHide) {
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

      // 节流：YouTube 页面（尤其直播间聊天）DOM 变动极其频繁，
      // 若每个 mutation 都执行 querySelector + 挂载检查，会造成持续主线程占用。
      const schedulePlayerSync = () => {
        if (playerSyncTimer) return;
        playerSyncTimer = setTimeout(() => {
          playerSyncTimer = null;
          setupPlayerAndOverlay();
          if (buttonManager) {
            buttonManager.checkAndMount();
          }
        }, 150);
      };

      if (playerObserver) playerObserver.disconnect();
      playerObserver = new MutationObserver(schedulePlayerSync);
      playerObserver.observe(document.body, { childList: true, subtree: true });

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
      ensureCaptionObserverTarget();

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
      // 广告/缓冲会耗尽启动期看门狗；正片开始播放后自动重新武装有限次数
      if (
        currentSentences.length === 0 &&
        !captionsWatchdogTimer &&
        watchdogRearms < 2 &&
        videoElement.currentTime > 1 &&
        !videoElement.closest('.html5-video-player')?.classList.contains('ad-showing')
      ) {
        watchdogRearms++;
        console.log(`[YT-Sub-Translator] 播放中未检测到字幕，重新启动探测 (${watchdogRearms}/2)`);
        startCaptionsWatchdog();
      }
      // 控制栏按钮自身有 350ms 看门狗，这里不再重复做全页查询
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
        // 只释放页内内存镜像；**不删盘** —— 旧视频的整轨记录要留给「重看时续翻」
        EphemeralSubtitleStore.release(currentVideoId);
      }
      currentVideoId = newVid;
      EphemeralSubtitleStore.init(newVid);
      aiTrackHitLoggedFor = '';
      currentSentences = [];
      lastCaptionData = null;
      currentLoadingTrackUrl = '';
      lastCaptionTokenCount = 0;
      trackCascadeActive = false;
      currentSourceLang = '';
      // 让正在执行的 AI 全篇精翻立即失效，避免把上一部视频的译文写到新视频缓存里
      aiRunToken++;
      isFullAiRunning = false;
      watchdogRearms = 0;
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
            clientVersion: cachedHostClientInfo.clientVersion,
            visitorData: cachedHostClientInfo.visitorData
          }
        },
        (res) => {
          if (res && res.success && res.tracks && res.tracks.length > 0 && currentSentences.length === 0) {
            console.log('[YT-Sub-Translator] Fetched tracks via YouTubei fallback:', res.tracks.length);
            handleCaptionTracks(res.tracks, currentSourceLang);
          }
        }
      );
    }

    /**
     * 从任意 JSON 文本中提取指定 key 后的数组字面量。
     * 使用括号配对扫描，避免正则非贪婪匹配在内层数组（如 name.runs）处截断。
     */
    function extractJsonArrayAfterKey(text: string, key: string): string | null {
      const marker = `"${key}"`;
      let searchFrom = 0;

      while (true) {
        const keyIdx = text.indexOf(marker, searchFrom);
        if (keyIdx === -1) return null;

        const arrStart = text.indexOf('[', keyIdx + marker.length);
        if (arrStart === -1) return null;

        const between = text.slice(keyIdx + marker.length, arrStart);
        if (!/^\s*:\s*$/.test(between)) {
          searchFrom = keyIdx + marker.length;
          continue;
        }

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = arrStart; i < text.length; i++) {
          const ch = text[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') {
            inString = true;
            continue;
          }
          if (ch === '[') depth++;
          else if (ch === ']') {
            depth--;
            if (depth === 0) return text.slice(arrStart, i + 1);
          }
        }
        return null;
      }
    }

    function scanTracksFromDomScripts(): YouTubeCaptionTrack[] | null {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (text.includes('captionTracks') && (text.includes('playerCaptionsTracklistRenderer') || text.includes('baseUrl'))) {
          try {
            const arrayText = extractJsonArrayAfterKey(text, 'captionTracks');
            if (!arrayText) continue;
            const tracks = JSON.parse(arrayText);
            if (Array.isArray(tracks) && tracks.length > 0) {
              return tracks;
            }
          } catch (e) {
            console.warn('[YT-Sub-Translator] DOM 字幕轨解析失败，跳过该 script:', e);
          }
        }
      }
      return null;
    }

    /**
     * 接收来自 MAIN world bridge 脚本的消息
     */
    window.addEventListener('message', (event) => {
      // 只接受同源页面窗口的消息，防止第三方 iframe / 脚本伪造字幕数据
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!event.data || event.data.source !== 'YT_SUB_TRANSLATOR_MAIN') return;

      if (event.data.type === 'CAPTION_TRACKS_FOUND') {
        const { tracks, videoData, clientInfo, sourceLang, isAd } = event.data;

        // 广告播放时 videoData.video_id 是广告视频，不能据此切换正片上下文
        if (isAd) return;

        if (clientInfo && typeof clientInfo === 'object') {
          cachedHostClientInfo = {
            apiKey: typeof clientInfo.apiKey === 'string' ? clientInfo.apiKey : '',
            clientVersion:
              typeof clientInfo.clientVersion === 'string' ? clientInfo.clientVersion : '',
            visitorData: typeof clientInfo.visitorData === 'string' ? clientInfo.visitorData : ''
          };
        }

        if (typeof sourceLang === 'string' && sourceLang) {
          currentSourceLang = sourceLang;
        }

        const newVid =
          (videoData && typeof videoData.video_id === 'string' && videoData.video_id) ||
          getVideoIdFromUrl();
        if (newVid && newVid !== currentVideoId) {
          handleVideoChange(newVid);
        }

        if (Array.isArray(tracks) && tracks.length > 0) {
          handleCaptionTracks(tracks, currentSourceLang);
        }
      } else if (event.data.type === 'CAPTURED_TIMEDTEXT_RESPONSE') {
        // 核心突破（借鉴沉浸式翻译）：零拷贝直接获取 YouTube 播放器刚完成的 responseText
        // 彻底免去多余的二次网络请求，杜绝 429 频率限制与 Cookie 鉴权丢失！
        const { url, responseText } = event.data;
        if (typeof responseText !== 'string' || responseText.length === 0) return;
        // 限制单条响应体积，避免伪造的超大 payload 拖垮页面
        if (responseText.length > 8 * 1024 * 1024) {
          console.warn('[YT-Sub-Translator] 忽略超大字幕响应:', responseText.length);
          return;
        }

        // 广告/预加载也会走 timedtext，必须校验视频 ID，避免把其他视频的字幕套到当前视频上
        const capturedVid = (String(url || '').match(/[?&]v=([^&]+)/) || [])[1];
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
        if (
          typeof url === 'string' &&
          url.startsWith('https://') &&
          url.includes('/api/timedtext') &&
          url.length <= 4096 &&
          currentSentences.length === 0 &&
          url !== currentLoadingTrackUrl
        ) {
          console.log('[YT-Sub-Translator] Direct timedtext URL intercepted from YouTube player');
          currentLoadingTrackUrl = url;
          chrome.runtime.sendMessage(
            { type: 'FETCH_CAPTIONS', payload: { url } },
            (response) => {
              void chrome.runtime.lastError;
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

    function sortCaptionTracks(
      tracks: YouTubeCaptionTrack[],
      sourceLang: string,
      targetLang: string
    ): YouTubeCaptionTrack[] {
      const validTracks = tracks.filter((t) => !!t.baseUrl);
      if (validTracks.length <= 1) return validTracks;

      const srcBase = (sourceLang || '').toLowerCase().split('-')[0];
      const tgtBase = (targetLang || '').toLowerCase().split('-')[0];

      const getScore = (track: YouTubeCaptionTrack): number => {
        let score = 0;
        const lang = (track.languageCode || '').toLowerCase();
        const rawName = typeof track.name === 'string'
          ? track.name
          : (track.name?.simpleText || track.name?.runs?.[0]?.text || '');
        const isAsr = track.kind === 'asr';

        // 1. 人工字幕 100 分，自动生成字幕 80 分
        score += isAsr ? 80 : 100;

        // 2. 原声语言是唯一强信号：命中 +200，避免把译文轨再翻一遍
        if (srcBase) {
          if (lang.startsWith(srcBase)) {
            score += 200;
          } else if (track.vssId && track.vssId.startsWith('.')) {
            // YouTube 的派生翻译轨通常以 '.' 开头且语言不同于原声
            score -= 60;
          }
        } else {
          // 3. 拿不到原声语言时才使用历史语言偏好
          if (lang.startsWith('ja')) score += 60;
          else if (lang.startsWith('en')) score += 45;
          else if (lang.startsWith('zh')) score += 35;
          else if (lang.startsWith('ko')) score += 30;
        }

        // 4. 目标语言轨降权（否则等于把中文再翻译成中文）
        if (tgtBase && lang.startsWith(tgtBase)) {
          score -= 120;
        }

        // 5. 原声关键字加分
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
    function handleCaptionTracks(tracks: YouTubeCaptionTrack[], sourceLang = '') {
      if (!tracks || tracks.length === 0) return;
      if (currentSentences.length > 0) return;
      // 单飞：同一时刻只允许一条候选音轨瀑布，避免重复广播造成 N 倍并发请求
      if (trackCascadeActive) return;
      trackCascadeActive = true;

      // 原声语言优先级：MAIN world 的 defaultAudioLanguage → 本地上次值 → ASR 轨语言
      const inferredSourceLang =
        sourceLang ||
        currentSourceLang ||
        (tracks.find((t) => t.kind === 'asr')?.languageCode || '');
      if (inferredSourceLang) currentSourceLang = inferredSourceLang;

      const candidateTracks = sortCaptionTracks(
        tracks,
        inferredSourceLang,
        settings.targetLang
      );
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

      currentSentences = sentences;
      updateNativeSubtitleVisibility();
      if (overlay) {
        overlay.setSentences(currentSentences, true);
        overlay.resetAiProgress();
      }

      // 先查本地 AI 精翻整轨（内存 → IndexedDB）：命中就先把已翻的那部分铺出来，
      // 再决定要不要跑机器翻译预翻译（全篇都 AI 翻过时完全不用发请求）。
      void restoreAiTrackThenStartPipeline();
    }

    /**
     * 打开视频后的第一条路径：内存 → IndexedDB → 恢复已翻部分 → 视模式决定续翻。
     * 「刷新/重看后 AI 精翻字幕消失」这个 bug 就修在这里。
     */
    async function restoreAiTrackThenStartPipeline() {
      const entryToken = aiRunToken;
      const restored = await applyCachedAiTrack();
      if (entryToken !== aiRunToken) return; // 期间切了视频，全部作废

      const complete = !!restored && restored.pending === 0;

      if (!complete) {
        await hydrateSentencesFromCache();
        if (entryToken !== aiRunToken) return;
        startPreTranslationPipeline();
      }

      if (restored && restored.pending > 0) {
        const willAutoResume = settings.aiResumeMode === 'auto';
        if (willAutoResume) {
          if (entryToken !== aiRunToken) return;
          // 自动续翻：只翻缺的，不动已完成的
          void startAiFullTranslation(restored);
        } else if (overlay) {
          // 手动续翻：打开视频就告诉用户「还差多少、点哪里」，不擅自发请求
          overlay.showToast(
            `检测到上次精翻完成 ${restored.restored}/${currentSentences.length} 句，点「AI 深度精翻」继续（不会重翻已完成部分）`
          );
        }
      }
    }

    /** 当前视频落盘用的元信息（每次现取，用户中途改语言/场景也不会写错记录） */
    function aiTrackMeta() {
      return {
        videoId: currentVideoId,
        targetLang: settings.targetLang,
        scenario: settings.scenario,
        service: settings.service,
        modelName: settings.modelName || ''
      };
    }

    /**
     * 取本地整轨记录：先看页内内存镜像（同一次播放内重复点按钮 / 重渲染），
     * 再查 IndexedDB（刷新、关标签页、换天重看都走这条）。
     */
    async function resolveCachedAiRecord(): Promise<AiTrackRecord | null> {
      if (!currentVideoId || currentSentences.length === 0) return null;
      const meta = aiTrackMeta();
      const mem = EphemeralSubtitleStore.load(currentVideoId);
      if (
        mem &&
        mem.length === currentSentences.length &&
        mem.some((s) => !!s.translation)
      ) {
        return buildAiTrackRecord(meta, mem);
      }
      return EphemeralSubtitleStore.hydrate(currentVideoId, meta);
    }

    /** 把 plan 里恢复出来的 AI 译文贴回当前句子数组（保留机翻结果，不清空） */
    function applyPlanTranslations(plan: AiResumePlan, target: SubtitleSentence[]): number {
      let applied = 0;
      const len = Math.min(target.length, plan.sentences.length);
      for (let i = 0; i < len; i++) {
        const s = plan.sentences[i];
        if (s.status === 'done' && typeof s.translation === 'string' && s.translation.trim()) {
          target[i].translation = s.translation;
          target[i].status = 'done';
          target[i].isAi = true;
          applied++;
        }
      }
      return applied;
    }

    /**
     * 查本地缓存并恢复已翻部分。返回 resume plan（不可复用时返回 null）。
     * 命中会打一行日志，每部视频只打一次。
     */
    async function applyCachedAiTrack(): Promise<AiResumePlan | null> {
      const record = await resolveCachedAiRecord();
      if (!record) return null;

      const plan = planResume(record, currentSentences, {
        targetLang: settings.targetLang,
        scenario: settings.scenario
      });

      if (!plan.reusable || plan.restored === 0) {
        console.log(`[AiTrack] 未复用 videoId=${currentVideoId} 原因=${plan.reason}`);
        return null;
      }

      const applied = applyPlanTranslations(plan, currentSentences);
      plan.restored = applied;
      plan.pending = currentSentences.length - applied;

      if (overlay) {
        overlay.setSentences(currentSentences);
        if (plan.pending === 0) {
          overlay.setAiComplete(currentSentences.length);
        } else {
          /* 注意：这里**不能**用 updateAiProgress() —— 它会把 AI 按钮置灰，
             手动续翻模式下用户就再也点不动「AI 深度精翻」了（overlay.ts 不在本轮
             改动范围，无法新增「只显示进度但不置灰」的方法）。
             所以部分恢复时用 resetAiProgress() 保持按钮可用，进度用 toast 的 N/M 表达。 */
          overlay.resetAiProgress();
        }
      }

      if (aiTrackHitLoggedFor !== currentVideoId) {
        aiTrackHitLoggedFor = currentVideoId;
        console.log(
          `[AiTrack] 命中 videoId=${currentVideoId} 完成 ${applied}/${currentSentences.length}` +
            (plan.pending > 0 ? `（续翻模式：${settings.aiResumeMode}）` : '（全篇完整，零请求）')
        );
      }
      return plan;
    }

    async function hydrateSentencesFromCache() {
      if (currentSentences.length === 0) return;
      const texts = currentSentences.map((s) => s.text);
      const cacheKeys = texts.map((t) =>
        buildSentenceCacheKey(
          settings.targetLang,
          t,
          settings.scenario,
          settings.reasoningEffort,
          settings.service,
          settings.modelName
        )
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
     * 全篇 AI 深度字幕精翻管线（按钮入口）
     *
     * 三条路径（需求 7）：
     *   1. 本地缓存**全篇完整** → 直接恢复，零请求；
     *   2. 本地缓存**只翻了一半** + `aiResumeMode='manual'`（默认）→ 立即恢复已翻部分，
     *      只提示「已完成 N/M，点按钮继续」，不发请求；
     *   3. 其余情况（含 auto 续翻）→ 只翻缺译文的句子，并带紧邻上文两句。
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

      // 先查本地（页内内存 → IndexedDB），已翻部分立刻铺出来
      const plan = await applyCachedAiTrack();
      const action = decideAiRunAction(plan, settings.aiResumeMode);

      if (action === 'restore_only' && plan) {
        if (overlay) {
          overlay.setSentences(currentSentences);
          overlay.setAiComplete(currentSentences.length);
          overlay.showToast('已从本地缓存载入全篇精翻字幕');
        }
        return; // 零请求
      }

      if (action === 'prompt_resume' && plan) {
        if (overlay) {
          overlay.resetAiProgress();
          overlay.showToast(
            `检测到上次精翻完成 ${plan.restored}/${currentSentences.length} 句，点「AI 深度精翻」继续（不会重翻已完成部分）`
          );
        }
        return; // 手动模式：等用户再点一次
      }

      await startAiFullTranslation(plan);
    }

    /**
     * 真正发请求的核心循环。`resume` 非空时只翻剩余句子。
     */
    async function startAiFullTranslation(resume: AiResumePlan | null) {
      if (isFullAiRunning) return;
      const runSentences = currentSentences;
      if (runSentences.length === 0) return;

      isFullAiRunning = true;
      // 固化本次运行上下文：切换视频后 token 变化，旧循环立即失效
      const runToken = ++aiRunToken;
      const runVideoId = currentVideoId;
      const runMeta = aiTrackMeta();
      const totalSentences = runSentences.length;
      let doneSentences = resume ? resume.restored : 0;

      if (!resume) {
        // 非续翻：从零开始计。「已完成」以 isAi 为准（机翻会先铺满缺口，不能算数）
        doneSentences = 0;
        for (const s of runSentences) {
          if (s.isAi && s.translation) doneSentences++;
        }
      }

      if (overlay) {
        overlay.showToast(
          resume
            ? `继续精翻剩余 ${resume.pending} 句（已完成 ${resume.restored} 句不会重翻）...`
            : `正在为全篇 ${totalSentences} 句字幕启动 AI 深度精翻...`
        );
        overlay.updateAiProgress(
          Math.min(100, Math.round((doneSentences / totalSentences) * 100)),
          resume
            ? `继续精翻剩余 ${resume.pending} 句 (已完成 ${resume.restored}/${totalSentences} 句)...`
            : `准备开始精翻 (共 ${totalSentences} 句)...`
        );
      }

      // 只挑缺译文的句子，按句序切批，每批附「紧邻上文最多 2 句」
      const batches = buildResumeBatches(runSentences, {
        batchSize: AI_TRACK_BATCH_SIZE,
        contextWindow: AI_TRACK_CONTEXT_WINDOW
      });

      for (const batch of batches) {
        // 视频已切换：立即终止，避免旧字幕继续请求和落盘
        if (runToken !== aiRunToken) return;

        const needTrans = batch.indices
          .map((i) => runSentences[i])
          .filter((s) => s && !(s.isAi === true && typeof s.translation === 'string' && !!s.translation.trim()));
        if (needTrans.length === 0) continue;

        for (const s of needTrans) s.status = 'translating';
        if (overlay) overlay.setSentences(runSentences);

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
                  noFallback: true, // AI 深度字幕严禁用谷歌机翻冒充
                  bypassCache: true,
                  // 续翻语境：上文原文 + 已有译文，只帮模型判断指代与语气
                  contextBefore: batch.contextBefore
                }
              },
              resolve
            );
          });

          if (runToken !== aiRunToken) return;

          const translations = Array.isArray(res?.translations) ? res.translations : null;
          if (res && res.success && translations && translations.length === needTrans.length) {
            for (let j = 0; j < needTrans.length; j++) {
              const text = typeof translations[j] === 'string' ? translations[j].trim() : '';
              if (!text) {
                needTrans[j].status = 'error';
                needTrans[j].translation = '[AI精翻失败: 模型返回空译文]';
                continue;
              }
              needTrans[j].translation = text;
              needTrans[j].status = 'done';
              needTrans[j].isAi = true;
              doneSentences++;
            }
          } else {
            // 条数不符 / 请求失败：不做「按位硬贴」，整批按失败处理（与既有失败路径一致）
            const reason =
              res?.error ||
              (translations ? `返回 ${translations.length} 条，期望 ${needTrans.length} 条` : '网络连接超时');
            for (const s of needTrans) {
              s.status = 'error';
              s.translation = `[AI精翻重试: ${reason}]`;
            }
          }
        } catch (e: any) {
          for (const s of needTrans) {
            s.status = 'error';
            s.translation = `[AI精翻异常: ${e.message}]`;
          }
        }

        if (runToken !== aiRunToken) return;

        // 每批结束立即落盘到 IndexedDB（用运行开始时的 videoId/meta，绝不串写到新视频）
        EphemeralSubtitleStore.save(runVideoId, runSentences, runMeta);
        EphemeralSubtitleStore.flushNow(runVideoId);

        const percent = Math.min(100, Math.round((doneSentences / totalSentences) * 100));
        if (overlay) {
          overlay.updateAiProgress(percent, `已处理 ${doneSentences}/${totalSentences} 句 (${percent}%)`);
          overlay.setSentences(runSentences);
        }
      }

      if (runToken !== aiRunToken) return;
      isFullAiRunning = false;
      EphemeralSubtitleStore.save(runVideoId, runSentences, runMeta);
      EphemeralSubtitleStore.flushNow(runVideoId);
      if (overlay) {
        overlay.setAiComplete(totalSentences);
        overlay.setSentences(runSentences);
        overlay.showToast(
          `全篇 AI 深度字幕已精翻完成！已保存到本地（按「保留时长」设置自动清理，重看时自动载入）`
        );
      }
    }

    /**
     * 清理当前视频的 AI 字幕缓存（内存 + IndexedDB）
     */
    async function handleClearAiSubtitles() {
      await EphemeralSubtitleStore.clear(currentVideoId);
      aiTrackHitLoggedFor = '';
      for (const s of currentSentences) {
        s.translation = undefined;
        s.status = 'idle';
        s.isAi = false;
      }
      if (overlay) {
        overlay.setSentences(currentSentences);
        overlay.resetAiProgress();
        overlay.showToast('已清空当前视频的 AI 字幕缓存');
      }
      startPreTranslationPipeline();
    }

    /**
     * 引擎 2：DOM 原生字幕实时捕获兜底器
     */
    let lastDomCaptionText = '';
    let liveTranslateTimer: any = null;

    function initDomCaptionObserver() {
      const processDomCaption = () => {
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
                void chrome.runtime.lastError;
                if (res && res.success && Array.isArray(res.translations) && res.translations[0]) {
                  if (overlay) {
                    overlay.renderLiveCaption(fullText, res.translations[0]);
                  }
                }
              }
            );
          }, 200);
        }
      };

      // 节流：直播间聊天会持续触发 characterData，绝不能每个 mutation 都全页查询
      if (captionObserver) captionObserver.disconnect();
      captionObserver = new MutationObserver(() => {
        if (domCaptionTimer) return;
        domCaptionTimer = setTimeout(() => {
          domCaptionTimer = null;
          processDomCaption();
        }, 200);
      });

      ensureCaptionObserverTarget();
    }

    /**
     * 优先只观察播放器字幕容器，避免 body 级观察在直播页被聊天刷屏
     */
    function ensureCaptionObserverTarget() {
      if (!captionObserver) return;
      const container =
        document.querySelector('#movie_player .ytp-caption-window-container') ||
        document.getElementById('movie_player') ||
        document.body;
      if (container === captionObserverTarget) return;
      captionObserver.disconnect();
      captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
      captionObserverTarget = container;
    }
  }
});
