/**
 * 运行在 YouTube 页面主环境 (MAIN world) 的辅助脚本
 * 用于访问 YouTube 播放器实例及其内部 API
 */

export const INJECTED_BRIDGE_CODE = `
(function() {
  if (window.__YT_SUB_TRANSLATOR_BRIDGE_INJECTED__) return;
  window.__YT_SUB_TRANSLATOR_BRIDGE_INJECTED__ = true;

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function getCaptionTracks() {
    const player = getPlayer();
    let tracks = null;

    if (player && typeof player.getCaptionTrackList === 'function') {
      try {
        tracks = player.getCaptionTrackList();
      } catch (e) {}
    }

    if (!tracks || tracks.length === 0) {
      const response = (player && typeof player.getPlayerResponse === 'function') 
        ? player.getPlayerResponse() 
        : window.ytInitialPlayerResponse;
      tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
    }

    return tracks;
  }

  function broadcastTracks(reason) {
    const tracks = getCaptionTracks();
    const player = getPlayer();
    const videoData = player?.getVideoData?.() || null;

    window.postMessage({
      source: 'YT_SUB_TRANSLATOR_MAIN',
      type: 'CAPTION_TRACKS_FOUND',
      tracks: tracks || [],
      videoData: videoData,
      reason: reason || 'poll'
    }, '*');
  }

  // 监听来自 Content Script 的指令
  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === 'YT_SUB_TRANSLATOR_CONTENT') {
      if (event.data.action === 'REQUEST_TRACKS') {
        broadcastTracks('request');
      } else if (event.data.action === 'SEEK_TO') {
        const player = getPlayer();
        if (player && typeof player.seekTo === 'function') {
          player.seekTo(event.data.seconds, true);
        }
      }
    }
  });

  // 监听 YouTube SPA 路由与播放器变动事件
  window.addEventListener('yt-navigate-finish', function() {
    setTimeout(function() { broadcastTracks('yt-navigate-finish'); }, 800);
    setTimeout(function() { broadcastTracks('yt-navigate-finish-delayed'); }, 2000);
  });

  // 周期性轮询检测播放器就绪 (最多轮询数次)
  let attempts = 0;
  const interval = setInterval(function() {
    attempts++;
    const tracks = getCaptionTracks();
    if (tracks && tracks.length > 0) {
      broadcastTracks('initial_ready');
      clearInterval(interval);
    } else if (attempts > 15) {
      clearInterval(interval);
    }
  }, 1000);

  // 首次广播
  setTimeout(function() { broadcastTracks('init'); }, 500);
})();
`;
