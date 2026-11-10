import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  DEFAULT_SETTINGS,
  type YouTubeCaptionTrack,
  type SubtitleSentence,
  type ExtensionSettings,
  type Json3CaptionData,
  type KaraokeWindow
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
import {
  detectLyricTrack,
  detectKaraokeHighlight,
  dedupeLyricEvents,
  toCaptionData,
  buildLineCharTimings,
  extractLineColors,
  attachCharColors,
  type LyricLine,
  type LyricTrackHint,
  type LineColorInfo,
  type CharTiming
} from '../../utils/lyric-track';
import { buildAsrCharTimings } from '../../utils/asr-timing';
import { isExtensionAlive, safeSendMessage } from '../../utils/runtime-safe';
import { SubtitleOverlay } from './overlay';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    console.log(
      '%c[YT-Sub-Translator v0.5.1]%c Content-script active (Immersive Translate Mode)',
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
    /**
     * 扩展上下文是否已失效（重载/更新后老脚本的 chrome.runtime 作废）。
     * 一次性标志：所有降级动作（清定时器/观察器/单飞锁、提示刷新）只跑一次，
     * 之后所有消息调用由 `safeSendMessage` 直接短路回调 invalidated，不再发请求。
     */
    let contextInvalidated = false;
    /** DOM 实时字幕翻译的节流计时器（声明在此，便于失效时统一清理） */
    let liveTranslateTimer: any = null;

    /* ── 无字幕视频的请求退避（0.5.1 A1/A3） ────────────────────────────────
     * 无轨视频上「youtubei 兜底 + 模拟点击原生字幕按钮」曾分别刷 14~22 次/40s：
     * 内容脚本每 250ms~1.5s 就重发一次，而这两条通道对无轨视频是**必然失败**的。
     *
     * 两层记忆必须分开，否则会误伤有轨视频：
     *   ① `noTracksConfirmed` —— MAIN world 的 7 条取轨途径**全部**走完且都没拿到
     *      baseUrl。这是权威负信号，可以连「模拟点击」一起停掉。
     *   ② `youtubeiBlockedAt` —— youtubei 兜底失败（403 / 0 轨）。这**只能停 youtubei**：
     *      实测有轨视频的 baseUrl 也要 pot 令牌才返回数据（0 token），而它的真实数据
     *      恰恰是「模拟点击 → 播放器自己请求 timedtext → 零拷贝截获」拿到的。
     *      把 0 token 当「无字幕」去停点击，会把好好的有轨视频打到完全没字幕。
     */
    /** vid → MAIN world 确认「无任何字幕轨」的时间戳 */
    const noTracksConfirmed = new Map<string, number>();
    /** vid → youtubei 兜底失败（403 / 0 轨）的时间戳 */
    const youtubeiBlockedAt = new Map<string, number>();
    const TRACK_FETCH_BACKOFF_MS = 5 * 60_000;
    /** REQUEST_TRACKS → MAIN world 的最小间隔 */
    let lastRequestTracksAt = 0;
    const REQUEST_TRACKS_MIN_INTERVAL_MS = 1000;
    /** 已确认返回 0 token 的 baseUrl → 记录时间戳，避免同一轮反复从 json3 + XML 各试一遍 */
    const emptyTrackUrlAt = new Map<string, number>();
    /** 零拷贝窗口：超过这个时长仍未截获到原生字幕，才允许对同一 baseUrl 再试一次 */
    const ZERO_COPY_RETRY_WINDOW_MS = 8000;
    /** 「候选轨全在冷却」这条 debug 日志的抑制窗口，避免每 600ms 广播刷一次 */
    let lastAllCooledLogAt = 0;
    /**
     * 正在等待回包的 vid（单飞：突发探测会连发 6 次，同一视频只允许一条在途请求）。
     * 注意：必须在这里声明 —— `detectCurrentVideoAndLoad()` 在启动阶段就会被
     * `main()` 调用，声明位置晚于该调用点会触发 TDZ（Cannot access before initialization），
     * 直接把整段内容脚本打挂。
     */
    let trackFetchInFlight = '';

    /**
     * 当前字幕轨的元信息（kind / vssId），只喂给 `detectLyricTrack` 的 asr-kind 信号。
     * 拿不到时留空 —— 那一路信号权重仅 1/13，不影响判定（实测样本无需 hint 也能过线）。
     */
    let currentTrackHint: LyricTrackHint = {};

    /**
     * 相邻两段歌词显示重叠时，前一段提前多少毫秒收尾（v0.5.0 卡拉OK）。
     * 理由：两行同时点亮会让人分不清在唱哪句；80ms 足够避开浮层渲染的一帧误差。
     */
    const KARAOKE_TAIL_GAP_MS = 80;
    /** 歌词轨重建次数：只在日志里出现，便于确认「设置到达 / 改开关」是否触发了重建 */
    let karaokeBuildCount = 0;
    /** 上一次挂给翻译队列的句子数组引用（仅歌词轨用于去重挂载，见 startPreTranslationPipeline） */
    let lastAttachedSentences: SubtitleSentence[] | null = null;

    // 1. 同步实例化核心管理器
    translationQueue = new TranslationQueue(settings, {
      batchSize: 8,
      onSentenceUpdated: () => {
        if (overlay) overlay.setSentences(currentSentences);
        if (document.pictureInPictureElement && document.pictureInPictureElement === videoElement) {
          refreshPipCues();
        }
      },
      /* 队列是播放中最频繁的发消息方：它先发现「上下文已死」就立刻做一次性降级 */
      onContextInvalidated: () => {
        handleContextInvalidated();
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
      const prevLyricKaraoke = settings?.lyricKaraoke;
      settings = s;
      updateNativeSubtitleVisibility();
      if (buttonManager) buttonManager.setEnabled(settings.enabled);
      if (translationQueue) translationQueue.updateSettings(settings);
      if (overlay) overlay.updateSettings(settings);
      /**
       * 启动竞态（v0.5.0）：首毫秒用的是 DEFAULT_SETTINGS（lyricKaraoke=false），
       * 若字幕在 storage 回读之前就到了，句子会按 0.4.3 形态建好。
       * 这里只在「开关确实开着」且「现有句子还没带歌词窗口」时补一次重建，
       * 关闭时这段完全不触发，VOD 行为不变。
       */
      if (
        prevLyricKaraoke !== settings.lyricKaraoke &&
        settings.lyricKaraoke === true &&
        lastCaptionData &&
        currentSentences.length > 0 &&
        !currentSentences.some((s) => !!s.karaokeWindows)
      ) {
        console.log('[LyricKaraoke] 设置异步到达且开关已开启，按歌词轨重建句子');
        reSegmentAndReload(lastCaptionData);
        return;
      }
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
        const prevLyricKaraoke = settings?.lyricKaraoke;
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
            prevAutoPunct !== settings.autoPunctuation ||
            /* v0.5.0：卡拉OK开关变化要重建句子结构（62 行 vs 1166 句是两套形态） */
            prevLyricKaraoke !== settings.lyricKaraoke)
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
            safeSendMessage({ type: 'SAVE_SETTINGS', payload: newSettings }, (r) => {
              if (!r.ok && r.reason === 'invalidated') handleContextInvalidated();
            });
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
        // 上下文已失效（插件被重载/更新）：老脚本再发消息只会刷未捕获异常
        if (contextInvalidated || !isExtensionAlive()) {
          handleContextInvalidated();
          return;
        }
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
      currentTrackHint = {};
      lastAttachedSentences = null;
      // 让正在执行的 AI 全篇精翻立即失效，避免把上一部视频的译文写到新视频缓存里
      aiRunToken++;
      isFullAiRunning = false;
      watchdogRearms = 0;
      // 注意：负缓存**不在这里清**。它按 vid 建键，天然按视频隔离；清掉反而会让
      // 「MAIN world 的 video_id 与 URL 短暂打架」这类抖动退化成每 250ms 一轮的热循环
      // （实测过一次 390 次 youtubei 的回归）。过期交给时间戳，用户重新进同一视频时
      // 由 5 分钟窗口控制，不会永久封死。
      emptyTrackUrlAt.clear();
      lastAllCooledLogAt = 0;
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
        if (contextInvalidated || !isExtensionAlive()) {
          handleContextInvalidated();
          return;
        }
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
     * 扩展被重载/更新后的一次性降级。
     *
     * 老内容脚本的 chrome.runtime 已经作废：任何 sendMessage 都会同步抛
     * `Extension context invalidated.`。这里**只清运行态**（定时器 / 观察器 / 在途锁），
     * 负缓存（`noTracksConfirmed` / `youtubeiBlockedAt`）按 vid + 时间戳过期，与上下文无关，
     * 一律不动 —— 清掉只会让刷新后的无轨视频重新走一轮请求风暴。
     * 也不自动 `location.reload()`：用户正在看的内容会丢。
     */
    function handleContextInvalidated() {
      if (contextInvalidated) return;
      contextInvalidated = true;
      console.warn(
        '[YT-Sub-Translator] 扩展上下文已失效（插件被重载/更新）。已停止全部请求与探测，请刷新页面恢复翻译。'
      );

      // 1. 停掉所有周期性 ticker 与待执行的节流回调
      if (urlWatchdogTimer) {
        clearInterval(urlWatchdogTimer);
        urlWatchdogTimer = null;
      }
      stopCaptionsWatchdog();
      if (playerSyncTimer) {
        clearTimeout(playerSyncTimer);
        playerSyncTimer = null;
      }
      if (domCaptionTimer) {
        clearTimeout(domCaptionTimer);
        domCaptionTimer = null;
      }
      if (liveTranslateTimer) {
        clearTimeout(liveTranslateTimer);
        liveTranslateTimer = null;
      }

      // 2. 断开观察器（它们还在触发就会继续尝试发消息）
      if (playerObserver) {
        playerObserver.disconnect();
        playerObserver = null;
      }
      if (captionObserver) {
        captionObserver.disconnect();
        captionObserver = null;
        captionObserverTarget = null;
      }

      // 3. 释放运行态单飞锁 / 在途标志
      //    关键：A1/A3 的 trackFetchInFlight 依赖「回包」释放。上下文失效后回包永不到来，
      //    不主动清就等于把该 vid 的取轨永久封死（比退避更糟）。
      trackFetchInFlight = '';
      trackCascadeActive = false;
      currentLoadingTrackUrl = '';
      // 让正在跑的 AI 全篇循环在下一个 await 处立即退出，不会把失败结果写进本地缓存
      isFullAiRunning = false;
      aiRunToken++;

      // 4. 只提示一次：复用浮层既有的 toast（没有浮层时退化为上面那条 console.warn）
      if (overlay) {
        overlay.showToast('插件已更新，请刷新页面');
      }
    }

    /**
     * 该 vid 是否已被 MAIN world 权威判定为「没有任何字幕轨」。
     * 只有这种判定才能连「模拟点击」一起停掉 —— 见文件顶部两层负缓存的说明。
     */
    function isNoTracksConfirmed(vid: string): boolean {
      return isFresh(noTracksConfirmed, vid);
    }

    /** 该 vid 的 youtubei 兜底是否处于失败冷却中（只影响 youtubei，不影响点击） */
    function isYoutubeiBlocked(vid: string): boolean {
      return isFresh(youtubeiBlockedAt, vid);
    }

    /** 带过期的时间戳查询：过期即删，绝不永久封死 */
    function isFresh(store: Map<string, number>, vid: string): boolean {
      if (!vid) return false;
      const at = store.get(vid);
      if (!at) return false;
      if (Date.now() - at >= TRACK_FETCH_BACKOFF_MS) {
        store.delete(vid);
        return false;
      }
      return true;
    }

    /** 记一条 vid 级负缓存。reason 只进日志（debug，避免预期失败刷 error 级）。 */
    function markBlocked(store: Map<string, number>, vid: string, reason: string, label: string) {
      // 注意：这里**不**校验 vid === currentVideoId。要记的是「我们刚为哪条视频发过请求」，
      // 而不是「现在已经切到哪条」。MAIN world 的 video_id 与 URL 短暂打架时若校验，
      // 回包永远记不上账，缓存失效 → 又变成一轮轮重发（实测 390 次 youtubei 的根因）。
      if (!vid) return;
      if (store.has(vid)) return;
      store.set(vid, Date.now());
      console.debug(
        `[YT-Sub-Translator] ${label}，${Math.round(TRACK_FETCH_BACKOFF_MS / 60000)} 分钟内不再重试 (${reason}) vid=${vid}`
      );
    }

    /** MAIN world 已确认无轨 → youtubei 与模拟点击都停 */
    function markNoTracksConfirmed(vid: string, reason: string) {
      markBlocked(noTracksConfirmed, vid, reason, '该视频暂无字幕轨');
    }

    /** youtubei 兜底失败 → 只停 youtubei，模拟点击继续（有轨视频靠它取数据） */
    function markYoutubeiBlocked(vid: string, reason: string) {
      markBlocked(youtubeiBlockedAt, vid, reason, 'youtubei 兜底无结果');
    }

    /**
     * 单条 baseUrl 是否已确认 0 token。
     * 零拷贝窗口（8s）过后允许重试一次 —— 宁可慢，也不能永远不重试。
     */
    function isEmptyTrackUrl(baseUrl: string): boolean {
      const at = emptyTrackUrlAt.get(baseUrl);
      if (!at) return false;
      if (Date.now() - at >= ZERO_COPY_RETRY_WINDOW_MS) {
        emptyTrackUrlAt.delete(baseUrl);
        return false;
      }
      return true;
    }

    /**
     * 视频检测主函数（借鉴沉浸式翻译多通道融合秒级检出）
     */
    function detectCurrentVideoAndLoad() {
      // 上下文已失效后所有探测都短路：突发探测的 setTimeout 仍在排队，不能被漏掉
      if (contextInvalidated) return;
      const vid = getVideoIdFromUrl();
      if (!vid) return;

      if (vid !== currentVideoId) {
        handleVideoChange(vid);
        return;
      }

      if (currentSentences.length > 0) return;

      const now = Date.now();

      // 策略 1: 请求 MAIN world bridge 脚本（广播音轨 + 唤醒原生字幕管线）
      // REQUEST_TRACKS 限频 ≥1000ms：它由突发探测（6 次）+ 8 轮看门狗反复触发
      if (now - lastRequestTracksAt >= REQUEST_TRACKS_MIN_INTERVAL_MS) {
        lastRequestTracksAt = now;
        window.postMessage({ source: 'YT_SUB_TRANSLATOR_CONTENT', action: 'REQUEST_TRACKS' }, '*');
      }
      // MAIN world 已权威确认无轨就不再模拟点击：点一次等于让播放器白跑一轮 timedtext。
      // 注意这里**只看** noTracksConfirmed —— youtubei 的 0 token 不能用来停点击。
      if (!isNoTracksConfirmed(vid)) {
        window.postMessage({ source: 'YT_SUB_TRANSLATOR_CONTENT', action: 'TRIGGER_SUBTITLES' }, '*');
      }

      // 策略 2: 直接扫描当前页面 DOM script 标签
      const domTracks = scanTracksFromDomScripts();
      if (domTracks && domTracks.length > 0) {
        console.log('[YT-Sub-Translator] Found caption tracks from DOM scripts:', domTracks.length);
        handleCaptionTracks(domTracks);
        return;
      }

      // 策略 3: 若前两项未生效，通过后台 YouTubei API 双模式兜底
      // 已确认无轨 / 该 vid 的 youtubei 正在冷却 → 直接跳过
      // （这就是原来 14~22 次 403 的来源）
      if (isNoTracksConfirmed(vid) || isYoutubeiBlocked(vid)) return;
      // 单飞：handleVideoChange 会连发 6 次探测，同一视频只允许一条在途请求
      if (trackFetchInFlight === vid) return;
      trackFetchInFlight = vid;

      safeSendMessage<{
        success?: boolean;
        skipped?: boolean;
        error?: string;
        tracks?: YouTubeCaptionTrack[];
      }>(
        {
          type: 'FETCH_TRACKS_BY_VIDEO_ID',
          payload: {
            videoId: vid,
            apiKey: cachedHostClientInfo.apiKey,
            clientVersion: cachedHostClientInfo.clientVersion,
            visitorData: cachedHostClientInfo.visitorData
          }
        },
        (r) => {
          // 先释放单飞锁：无论成功/失败/上下文失效，这个 vid 都不能被永久卡住
          if (trackFetchInFlight === vid) trackFetchInFlight = '';
          // 上下文已失效：既不能当「无字幕」记账，也不能继续待在这里
          if (!r.ok) {
            if (r.reason === 'invalidated') handleContextInvalidated();
            return;
          }
          const res = r.response;
          if (res && res.success && res.tracks && res.tracks.length > 0 && currentSentences.length === 0) {
            console.log('[YT-Sub-Translator] Fetched tracks via YouTubei fallback:', res.tracks.length);
            handleCaptionTracks(res.tracks, currentSourceLang);
            return;
          }
          // `skipped` = 请求根本没发出去（页面还没给出 apiKey），属瞬时状态，不能当负信号：
          // 否则会在 clientInfo 到达前就把这条视频判成「无字幕」。
          if (res?.skipped) return;
          // 完全没有回包（SW 被回收 / 上下文失效）同样不是「无字幕」的证据
          if (!res) return;
          // 403 / 返回 0 轨：都不是可重试的瞬时错误，记账（只停 youtubei 这条通道）
          markYoutubeiBlocked(vid, res?.success === false ? `youtubei: ${res.error || 'failed'}` : 'youtubei: 0 tracks');
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
        } else if (Array.isArray(tracks) && tracks.length === 0 && currentSentences.length === 0) {
          /*
           * `tracks: []` 是负信号：MAIN world 的 7 条取轨途径**全部**走完且都拿不到
           * baseUrl 才会广播空数组。以前这里直接丢弃，于是内容脚本永远不知道「无字幕」，
           * 只能一轮轮重发 youtubei 请求（403 风暴）。
           *
           * 但「空数组」不等于「确认无轨」：SPA 切视频的前一两秒，播放器里还是上一条视频
           * （getVideoData() 与地址栏不一致、playerResponse 也没就绪），此时广播的空数组
           * 只是「还没准备好」。所以只有**播放器自报的 video_id 与地址栏一致**时才认账，
           * 否则会把真正有字幕的视频误判成无轨（实测会把 SPA 跳过去的视频打成 0 句）。
           */
          const urlVid = getVideoIdFromUrl();
          const playerVid = typeof videoData?.video_id === 'string' ? videoData.video_id : '';
          if (urlVid && playerVid && playerVid === urlVid) {
            markNoTracksConfirmed(urlVid, 'MAIN world confirmed no tracks');
          }
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
          safeSendMessage<{ success?: boolean; data?: Json3CaptionData; error?: string }>(
            { type: 'FETCH_CAPTIONS', payload: { url } },
            (r) => {
              if (!r.ok) {
                if (r.reason === 'invalidated') handleContextInvalidated();
                return;
              }
              const response = r.response;
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
      // 已确认 0 token 的 baseUrl 直接跳过：无轨/慢网时每轮都从 json3 + XML 各试一遍
      // 正是「Json3 empty events」「returned 0 tokens」刷屏的来源。
      const usableTracks = candidateTracks.filter((t) => !isEmptyTrackUrl(t.baseUrl));
      const maxAttempts = Math.min(usableTracks.length, MAX_CANDIDATES);

      if (usableTracks.length === 0) {
        // 单飞锁直接释放，不再发任何请求：等零拷贝截获（或 8s 窗口过期后再试）。
        trackCascadeActive = false;
        // 广播可能每 600ms 来一次，这条 debug 5s 内只打一条
        if (Date.now() - lastAllCooledLogAt >= 5000) {
          lastAllCooledLogAt = Date.now();
          console.debug(
            `[YT-Sub-Translator] 候选轨均已确认 0 token，跳过本轮拉取 (${candidateTracks.length} 条全在冷却)，等待零拷贝截获`
          );
        }
        return;
      }

      console.log(`[YT-Sub-Translator] Candidate tracks (${usableTracks.length} usable / ${candidateTracks.length} total), will try ${maxAttempts}:`, usableTracks.slice(0, maxAttempts).map(t => `${t.languageCode}[${t.kind || 'manual'}]`));

      let currentIndex = 0;

      const finishCascade = () => {
        trackCascadeActive = false;
      };

      /**
       * 候选轨全灭后给「零拷贝截获」留 8 秒窗口：
       * 窗口内截获到原生字幕就不必记账；窗口过了仍然 0 token，才把该 vid 的
       * **youtubei 兜底**记进冷却（不碰模拟点击 —— 有轨视频正是靠点击才拿到数据）。
       */
      const cascadeVid = currentVideoId;
      const armNoTrackVerdict = () => {
        setTimeout(() => {
          if (
            cascadeVid &&
            cascadeVid === currentVideoId &&
            currentSentences.length === 0 &&
            lastCaptionTokenCount === 0
          ) {
            markYoutubeiBlocked(cascadeVid, 'all candidates 0 tokens, no zero-copy in 8s');
          }
        }, ZERO_COPY_RETRY_WINDOW_MS);
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
            armNoTrackVerdict();
          }
          return;
        }

        const track = usableTracks[currentIndex];
        currentIndex++;
        /* 歌词轨判定的 asr-kind 信号用：这条轨自己声明的类型（拿不到就留空） */
        currentTrackHint = { kind: track.kind, vssId: track.vssId };

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

        safeSendMessage<{ success?: boolean; data?: Json3CaptionData; error?: string }>(
          { type: 'FETCH_CAPTIONS', payload: { url: fetchUrl } },
          (r) => {
            // 上下文已失效：不能再往下一跳，否则会一直递归发消息（异常被吞但请求空转）
            if (!r.ok && r.reason === 'invalidated') {
              handleContextInvalidated();
              return;
            }
            const response = r.ok ? r.response : null;
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
                // 记住这条 baseUrl：本轮（及之后 8s 内）不再为它反复发请求
                emptyTrackUrlAt.set(track.baseUrl, Date.now());
                console.warn(`[YT-Sub-Translator] Track [${track.languageCode}] returned 0 tokens. Falling back to next candidate...`);
              }
            } else {
              emptyTrackUrlAt.set(track.baseUrl, Date.now());
              console.warn(`[YT-Sub-Translator] Track [${track.languageCode}] fetch failed:`, response?.error);
            }

            // 失败或该轨 0 tokens 时，自动尝试下一个候选音轨！
            tryFetchCandidate();
          }
        );
      };

      tryFetchCandidate();
    }

    /**
     * 歌词轨卡拉OK是否生效（默认关闭 = 与 0.4.3 逐字节一致）
     * 严格 `=== true`：老版本存下来的设置里没有这一项，任何真值性质的脏数据都不该打开它。
     */
    function isKaraokeOn(): boolean {
      return settings?.lyricKaraoke === true;
    }

    /**
     * 尝试按「歌词轨」建句子。
     *
     * 返回 `null` 时调用方必须走 0.4.3 原管线 —— 这是 VOD 红线的落点：
     * 开关关闭时本函数**在第一步就返回**，不读 data、不打日志、无任何副作用。
     *
     * 建句口径（与需求逐条对应）：
     *   1. **一行一句**：`dedupeLyricEvents` 折叠后的 62 行 = 62 个翻译单元，
     *      而不是 1238 个 event / 1166 个断句 —— 同一段歌词只翻一次；
     *   2. **一段显示一个窗口**：副歌在 20s / 200s 各出现一次时是同一条句子、
     *      两个 `karaokeWindows`，渲染层按窗口时间重复显示，不重复请求翻译；
     *   3. 每个窗口的逐字时间由 `buildLineCharTimings` 现算（估算节奏），再交给
     *      `extractLineColors` + `attachCharColors`：有官方笔色时**透传颜色**、
     *      并在窗口容差内用真实字级时间覆盖估算值；无笔色时原样保留估算
     *      （等价 0.4.3 / v0.5.0 无笔色轨的行为）；
     *   4. 相邻窗口重叠时，前一段提前 `KARAOKE_TAIL_GAP_MS` 收尾。
     */
    function tryBuildKaraokeSentences(data: Json3CaptionData): SubtitleSentence[] | null {
      if (!isKaraokeOn()) return null;

      let verdict;
      try {
        verdict = detectLyricTrack(data, currentTrackHint);
      } catch (e) {
        console.warn('[LyricKaraoke] 歌词轨判定异常，回落标准断句管线:', e);
        return null;
      }

      if (!verdict.isLyric) {
        console.log(
          `[LyricKaraoke] 识别为非歌词轨 (confidence=${verdict.confidence.toFixed(2)})，走 0.4.3 标准断句管线`
        );
        return null;
      }

      /* v0.5.0 渲染层：`hasHighlight` **不再是 karaoke 路径的门禁**。
         它比的是「跨 event 文本互补」这种形态的高亮，判 false 只说明没有那种形态，
         **不代表没有逐字着色** —— 实测 karaoke 轨的逐字分层发生在单个 event 内部
         （已唱前缀逐字一色、未唱后缀 `#FEFEFE`），这条轨就是 `hasHighlight=false` 的反例。
         所以路径只由 `isLyric && settings.lyricKaraoke` 决定，检测结果仅留作日志。 */
      try {
        const highlight = detectKaraokeHighlight(data);
        console.log(`[LyricKaraoke] 高亮检测：${highlight.detail}（仅日志，不作门禁）`);
      } catch (e) {
        console.warn('[LyricKaraoke] 高亮检测异常（仅日志，不影响 karaoke 路径）:', e);
      }

      const { lines, stats } = dedupeLyricEvents(data);
      if (lines.length === 0) return null;

      /* 1. 把所有行的所有显示段摊平、按开始时间排序 —— 重叠判定必须跨行做 */
      interface Slot {
        line: LyricLine;
        startMs: number;
        endMs: number;
        frameCount: number;
      }
      const slots: Slot[] = [];
      for (const line of lines) {
        for (const d of line.displays) {
          slots.push({ line, startMs: d.startMs, endMs: d.endMs, frameCount: d.frameCount });
        }
      }
      slots.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

      /* 2. 相邻显示重叠：以 startMs 较后者为准，前一段提前 80ms 收尾 */
      let trimmed = 0;
      for (let i = 0; i < slots.length - 1; i++) {
        const cur = slots[i];
        const next = slots[i + 1];
        if (next.startMs < cur.endMs) {
          trimmed++;
          const target = Math.max(cur.startMs + 1, next.startMs - KARAOKE_TAIL_GAP_MS);
          cur.endMs = Math.max(cur.startMs + 1, Math.min(cur.endMs, target));
        }
      }

      /* 3. 每个窗口现算逐字时间（用裁剪后的区间，保证末字与收尾对齐），
            再叠官方笔色（颜色透传；窗口对齐时连真实字级时间一起用） */
      const windowsByLine = new Map<LyricLine, KaraokeWindow[]>();
      const colorStats = { rainbow: 0, chars: 0, realTime: 0 };
      /**
       * `extractLineColors` 每次都会把整条轨的 event 扫一遍（O(事件数)），而
       * 「一行显示多段」（副歌重复）会命中同一个 `line.key`、结果完全相同。
       * 按 key 记忆化：调用次数从「显示段数(143)」降到「不同歌词行数(≈40)」。
       */
      const colorInfoByKey = new Map<string, LineColorInfo>();
      for (const slot of slots) {
        const estimated = buildLineCharTimings(slot.line, {
          startMs: slot.startMs,
          endMs: slot.endMs,
          frameCount: slot.frameCount
        });
        /**
         * ⚠️ 这里必须传 `data`（进 `dedupeLyricEvents` **之前**的原始 json3）：
         * 笔色在 `data.pens[].fcForeColor` + `segs[].pPenId` 上，而
         * `toCaptionData()` 产出的清洗副本**不含 pens / pPenId**，传清洗后的数据
         * 会让 `extractLineColors` 恒返回空 → 静默失去全部颜色。
         */
        let info = colorInfoByKey.get(slot.line.key);
        if (!info) {
          info = extractLineColors(data, slot.line);
          colorInfoByKey.set(slot.line.key, info);
        }
        const charTimings = attachCharColors(estimated, info);

        const list = windowsByLine.get(slot.line) || [];
        if (list.length === 0) {
          // 每行只打一行（同一行的多个显示窗口共用同一份笔色，重复打没信息量）
          const hit = info.colors.reduce((n, c) => (c ? n + 1 : n), 0);
          colorStats.chars += hit;
          if (info.isRainbow) colorStats.rainbow++;
          if (charTimings.some((t) => t.source === 'pen' && !t.estimated)) colorStats.realTime++;
          console.log(
            `[LyricKaraoke] 笔色｜「${slot.line.text.slice(0, 20)}」` +
              `rainbow=${info.isRainbow} main=${info.mainColor ?? '无'} ` +
              `命中 ${hit}/${info.colors.length} 字｜轮次 ${info.passCount}｜` +
              `着色窗口 ${info.windowStartMs}–${info.windowEndMs}ms`
          );
        }
        list.push({
          startMs: slot.startMs,
          endMs: slot.endMs,
          frameCount: slot.frameCount,
          charTimings,
          estimated: charTimings.some((t) => t.estimated)
        });
        windowsByLine.set(slot.line, list);
      }

      /* 4. 一行一句：句子时间锚在**第一段显示**上（抽屉与二分查找都按它排序） */
      const sentences: SubtitleSentence[] = [];
      for (const line of lines) {
        const wins = windowsByLine.get(line);
        if (!wins || wins.length === 0) continue;
        sentences.push({
          id: sentences.length,
          start: wins[0].startMs,
          end: wins[0].endMs,
          text: line.text,
          status: 'idle',
          lyricTrack: true,
          charTimings: wins[0].charTimings,
          karaokeWindows: wins
        });
      }
      if (sentences.length === 0) return null;
      sentences.sort((a, b) => a.start - b.start || a.id - b.id);
      sentences.forEach((s, i) => (s.id = i));

      /* 翻译单元对比：这是「1166 → 62」的证据，不允许只写在文档里。
         基线用**真正会发给翻译队列的句数**（segmentCaptionTokens 的结果），
         不是 token 数 —— 0.4.3 该样本实测 14012 token → 1166 句。 */
      const baselineTokens = extractCaptionTokens(data);
      const baselineUnits = segmentCaptionTokens(baselineTokens, settings).length;
      const savedPct =
        baselineUnits > 0 ? (100 - (stats.lines / baselineUnits) * 100).toFixed(1) : '0.0';
      console.log(
        `[LyricKaraoke] ✓ #${++karaokeBuildCount} 识别歌词轨 confidence=${verdict.confidence.toFixed(2)}｜` +
          `${stats.inputEvents} event → 去重 ${stats.lines} 行 / ${stats.displays} 段显示｜` +
          `翻译单元 ${stats.lines} 句（0.4.3 按 event 断句是 ${baselineUnits} 句/${baselineTokens.length} token，减少 ${savedPct}%）｜` +
          `重叠裁剪 ${trimmed} 处（前段提前 ${KARAOKE_TAIL_GAP_MS}ms）｜` +
          `笔色 ${colorStats.chars} 字（${colorStats.rainbow} 行彩虹）｜真实字级时间 ${colorStats.realTime} 行`
      );

      return sentences;
    }

    /**
     * 歌词轨「清洗 + 去重」，与是否逐字高亮**无关**。
     *
     * 这一步修的是数据质量问题，不是渲染效果问题：
     *   - ruby 注音内联在正文里（`反(はん)射(しゃ)るface`），不剥掉就会把读音
     *     当正文送进翻译 —— 这是"字幕对不上内容"的主因；
     *   - 88.5% 的 event 是滚动窗口重复帧，直接进管线会被切成 1166 句碎片。
     *
     * 输出「每段显示一个 event」，交给标准断句/翻译管线，副歌重复出现照常显示，
     * 译文靠缓存命中不重复请求。无高亮时走这条，有高亮时才走逐字路径。
     */
    function cleanLyricCaptionData(data: Json3CaptionData): Json3CaptionData | null {
      try {
        const verdict = detectLyricTrack(data, currentTrackHint);
        if (!verdict.isLyric) return null;
        const { lines, stats } = dedupeLyricEvents(data);
        if (lines.length === 0) return null;
        const cleaned = toCaptionData(lines);
        console.log(
          `[LyricTrack] 歌词轨清洗：${stats.inputEvents} event → ${lines.length} 行 / ${stats.displays} 段` +
            `（已剥离 ruby 注音与重复帧）`
        );
        return cleaned;
      } catch (e) {
        console.warn('[LyricTrack] 清洗异常，使用原始数据:', e);
        return null;
      }
    }

    /**
     * ASR 轨逐词高亮（v0.5.0，**纯展示**）。
     *
     * 与歌词轨的区别，这里必须说清，否则以后一定改混：
     *   - 歌词轨：文本已知、去重成 62 行、走 `tryBuildKaraokeSentences`；
     *   - ASR 轨：文本逐词长出来、句子边界不稳定，**翻译与断句完全不动**，
     *     只是给每句挂一份从帧序列推断出的逐字时间，渲染层复用 `k-char`。
     *
     * 推断不可靠（覆盖率 < 30% 或一帧都对不上）就**不挂**，该句退回普通渲染，
     * 避免"高亮乱跳"比"没有高亮"更糟。
     */
    function attachAsrWordTimings(sentences: SubtitleSentence[], data: Json3CaptionData): number {
      /* v0.5.0 阶段 B：逐词显现是独立机制，不再受 lyricKaraoke 前置门控 */
      if (currentTrackHint?.kind !== 'asr') return 0;
      if (sentences.length === 0) return 0;
      /**
       * v0.5.0 阶段 B：正式开关 `asrWordReveal`（DEFAULT_SETTINGS 里默认 true）。
       * 显式置 false 时完全回到旧版行为 —— 不挂任何 karaokeWindows、不打 lyricTrack
       * 标记，翻译 / 断句 / 缓存键一行不动。本函数只作用于
       * currentTrackHint.kind === 'asr' 的普通自动字幕轨，与歌词轨笔色机制分开。
       *
       * 仍保留「全挂或全不挂」：浮层一旦发现 karaokeWindows 就整体切逐字渲染，
       * 部分句子没窗口会在索引里查不到 → 实测「字幕整条消失」。
       */
      if (settings?.asrWordReveal !== true) return 0;

      // 先全部算一遍，再决定挂不挂 —— **不允许「部分挂」**：
      // 浮层一旦发现有句子带 karaokeWindows 就整体切到逐字渲染，
      // 没挂窗口的句子在索引里查不到 → 直接不显示（实测：字幕整条消失）。
      const built: Array<{
        s: SubtitleSentence;
        timings: CharTiming[];
        coverage: number;
        frames: number;
        source: 'offset' | 'inferred' | 'estimated';
        distinctAnchors: number;
        wordCount: number;
        /** 时间表是否来自**官方词级时间戳**（seg.tOffsetMs）—— 逐词高亮配色的唯一依据 */
        wordLevel: boolean;
      }> = [];
      for (const s of sentences) {
        try {
          const r = buildAsrCharTimings(data, s.start, s.end, s.text);
          built.push({ s, ...r });
        } catch {
          built.push({
            s, timings: [], coverage: 0, frames: 0,
            source: 'estimated', distinctAnchors: 0, wordCount: 0, wordLevel: false
          });
        }
      }

      /*
       * 真实 ASR 轨在 json3 里常常是「每句一个 event、整句一次给全」，
       * 逐词出现是播放器自己渲染的，并不写进数据。那种情况下拿不到真实帧时间，
       * `buildAsrCharTimings` 会退回均分（estimated=true）—— 视觉上仍是逐字推进。
       * 所以这里**不再因为覆盖率低而整体放弃**：只要每句都有 timings 就全挂，
       * 保证索引完整（残缺索引正是上一轮「字幕整条消失」的根因）。
       */
      let hit = 0;
      let cov = 0;
      const bySource = { offset: 0, inferred: 0, estimated: 0 };
      let anchorsTotal = 0;
      let wordsTotal = 0;
      for (const b of built) {
        if (b.timings.length === 0) continue;
        b.s.charTimings = b.timings;
        /**
         * 必须打上 `lyricTrack` 标记 —— `overlay.isKaraokeActive()` 现在的守卫是
         * 「至少有一句带 lyricTrack 才走逐字渲染」。ASR 句子不打这个标记，
         * 即使挂了 karaokeWindows 也不会被渲染成逐字（改造后曾因此完全不生效）。
         */
        b.s.lyricTrack = true;
        /* 阶段 B 解耦：标明时间表来自普通 ASR 词级时间，overlay 据此按 asrWordReveal 分流，
           不再被 lyricKaraoke 顺带关掉；lyricTrack 仍保留供「至少一句带标记」守卫使用。 */
        b.s.asrTimed = true;
        /**
         * v0.5.0 任务·渲染层：**逐词高亮配色的能力标记**。
         * `wordLevel === true` ⇔ 时间表真的来自官方词级时间戳（`source === 'offset'`）
         * ⇒ 同一个词的字符共享同一个 `startMs` ⇒ 渲染层可以「整词一起亮」。
         * 帧前缀推断（inferred）/ 均分兜底（estimated）都是 `wordLevel === false`，
         * **不适用**逐词高亮配色 —— 它们是字级近似，不冒充词级。
         * 渲染层（overlay.ts）据此决定要不要给 span 加 `.k-word` class。
         */
        b.s.wordLevel = b.wordLevel === true;
        b.s.karaokeWindows = [
          {
            startMs: b.s.start,
            endMs: b.s.end,
            frameCount: b.frames,
            charTimings: b.timings,
            estimated: b.timings.some((t) => t.estimated)
          }
        ];
        hit++;
        cov += b.coverage;
        bySource[b.source]++;
        anchorsTotal += b.distinctAnchors;
        wordsTotal += b.wordCount;
      }
      console.log(
        `[AsrHighlight] ${hit}/${sentences.length} 句挂上逐字时间；` +
          `官方词时间 ${bySource.offset} 句 / 帧推断 ${bySource.inferred} 句 / ` +
          `均分兜底 ${bySource.estimated} 句，词锚点合计 ${anchorsTotal}` +
          `（官方词 ${wordsTotal} 个），平均覆盖率 ${((cov / Math.max(1, hit)) * 100).toFixed(0)}%`
      );
      return hit;
    }

    function processCaptionData(rawData: Json3CaptionData) {
      /* v0.5.0：先试逐字路径（需要「识别为歌词轨 + 确有当前字高亮」两个条件） */
      const karaoke = tryBuildKaraokeSentences(rawData);
      if (karaoke) {
        currentSentences = karaoke;
        updateNativeSubtitleVisibility();
        if (overlay) {
          overlay.setTrackEmpty(false);
          overlay.setSentences(currentSentences, true);
          overlay.resetAiProgress();
        }
        void restoreAiTrackThenStartPipeline();
        return;
      }

      /* 没走高亮路径时，歌词轨仍要清洗 —— 否则会退回 1166 句碎片 + 读音污染 */
      const data = cleanLyricCaptionData(rawData) ?? rawData;

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

      /* v0.5.0：ASR 轨挂逐字时间 —— 只改渲染的时间表，翻译与断句一行不动 */
      attachAsrWordTimings(sentences, data);

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
      /* 歌词轨：开关开着且识别成立时按「一行一句 + 多显示窗口」重建，其余情况与 0.4.3 一致 */
      const karaoke = tryBuildKaraokeSentences(data);
      const sentences = karaoke || segmentCaptionTokens(extractCaptionTokens(data), settings);
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

      safeSendMessage<{ success?: boolean; translations?: string[]; error?: string }>(
        {
          type: 'TRANSLATE_BATCH',
          payload: {
            texts: [target.text],
            targetLang: settings.targetLang,
            settings
          }
        },
        (r) => {
          if (!r.ok && r.reason === 'invalidated') handleContextInvalidated();
          const res = r.ok ? r.response : null;
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

      /**
       * v0.5.0（仅歌词轨）：`TranslationQueue.setSentences()` 会把内部代际自增，
       * 于是**在途批次的结果会被丢弃**（`gen !== this.generation` → return），
       * 那一批句子就永远卡在 `translating`、再也不会被重派。
       *
       * 歌词轨是 62 句的常驻数组，启动时会被「恢复 AI 整轨」与「重建后重挂」两条链
       * 各挂一次 —— 实测第一个批次（第一句歌词）因此丢掉译文。这里对歌词轨按数组
       * 引用去重挂载；普通字幕路径保持 0.4.3 原样（每次都重挂）。
       */
      const isKaraoke = currentSentences.some((s) => !!s.karaokeWindows);
      if (!isKaraoke || lastAttachedSentences !== currentSentences) {
        translationQueue.setSentences(currentSentences);
        lastAttachedSentences = currentSentences;
      }
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
            safeSendMessage<any>(
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
              (r) => {
                if (r.ok) {
                  resolve(r.response);
                  return;
                }
                // 上下文失效：不再抛异常，按本批失败处理（降级后 aiRunToken 已变，循环会立刻退出）
                if (r.reason === 'invalidated') handleContextInvalidated();
                resolve({
                  success: false,
                  error: r.message || (r.reason === 'invalidated' ? '插件已更新，请刷新页面' : '网络连接超时')
                });
              }
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
            safeSendMessage<{ success?: boolean; translations?: string[]; error?: string }>(
              {
                type: 'TRANSLATE_BATCH',
                payload: {
                  texts: [fullText],
                  targetLang: settings.targetLang,
                  settings
                }
              },
              (r) => {
                if (!r.ok) {
                  if (r.reason === 'invalidated') handleContextInvalidated();
                  return;
                }
                const res = r.response;
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
