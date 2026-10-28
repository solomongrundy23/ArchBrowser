if (window.__pipContentLoaded) {
  // Already injected into this page — background.js re-injects on
  // every icon click / command, and re-declaring top-level bindings
  // a second time would throw "Identifier has already been declared".
} else {
window.__pipContentLoaded = true;

function getActiveVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;

  return videos.reduce((largest, current) => {
    const largestArea = largest.offsetWidth * largest.offsetHeight;
    const currentArea = current.offsetWidth * current.offsetHeight;
    return currentArea > largestArea ? current : largest;
  }, videos[0]);
}

// Netflix (and reportedly some other streamers) force-inject this
// HTML attribute specifically to block native PiP. It's purely a
// player-UX flag — removing it doesn't touch decoding/DRM at all,
// same requestPictureInPicture() call as before, just unblocked.
function unlockPipAttribute(video) {
  if (video && video.disablePictureInPicture) {
    video.disablePictureInPicture = false;
  }
}

// Track PiP enter/exit via the native events — fires regardless of
// HOW PiP was triggered (icon, auto-detect, or the browser's own PiP
// button), so background.js always knows which tab actually has the
// floating window right now — needed because once PiP is active the
// user typically switches away to a different tab.
const pipTrackedVideos = new WeakSet();
function trackPipEvents(video) {
  if (pipTrackedVideos.has(video)) return;
  pipTrackedVideos.add(video);
  video.addEventListener('enterpictureinpicture', () => {
    try {
      chrome.runtime.sendMessage({ action: 'notify_pip_entered' }).catch(() => {});
    } catch (e) { /* extension context invalidated — stale script after a reload during testing, harmless */ }
  });
  video.addEventListener('leavepictureinpicture', () => {
    try {
      chrome.runtime.sendMessage({ action: 'notify_pip_left' }).catch(() => {});
    } catch (e) { /* same as above */ }
  });
}

function unlockAndTrackAllVideos() {
  document.querySelectorAll('video').forEach((v) => {
    unlockPipAttribute(v);
    trackPipEvents(v);
  });
}

unlockAndTrackAllVideos();
const pipUnlockObserver = new MutationObserver(() => unlockAndTrackAllVideos());
pipUnlockObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['disablepictureinpicture']
});

// ============================================================
// A-B Loop / Practice Mode — state lives here, driven by messages
// from the toolbar popup (no more injected on-page panel — the
// popup is visible regardless of which tab is currently focused,
// which an in-page panel could never be while PiP has pulled the
// user's attention to a different tab).
// ============================================================

let practiceState = { pointA: null, pointB: null, looping: false, speed: 1.0 };
let practiceRafId = null;

function practiceLoopTick() {
  const video = getActiveVideo();
  if (video && practiceState.looping && practiceState.pointA !== null && practiceState.pointB !== null) {
    if (video.currentTime >= practiceState.pointB) {
      video.currentTime = practiceState.pointA;
    }
  }
  practiceRafId = requestAnimationFrame(practiceLoopTick);
}

function ensurePracticeLoopRunning() {
  if (!practiceRafId) practiceRafId = requestAnimationFrame(practiceLoopTick);
}

function applySpeed(video, speed) {
  practiceState.speed = speed;
  video.playbackRate = speed;
  // Explicitly preserve natural pitch rather than the chipmunk/demon
  // effect of a raw sample-rate change.
  try { video.preservesPitch = true; } catch (e) {}
  try { video.mozPreservesPitch = true; } catch (e) {}
  try { video.webkitPreservesPitch = true; } catch (e) {}
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_practice_state') {
    sendResponse({ success: true, state: practiceState });
    return true;
  }

  if (request.action === 'practice_set_a' || request.action === 'practice_set_b') {
    const video = getActiveVideo();
    if (!video) { sendResponse({ success: false, reason: 'no_video' }); return true; }
    if (request.action === 'practice_set_a') practiceState.pointA = video.currentTime;
    else practiceState.pointB = video.currentTime;
    sendResponse({ success: true, state: practiceState });
    return true;
  }

  if (request.action === 'practice_toggle_loop') {
    if (practiceState.pointA === null || practiceState.pointB === null) {
      sendResponse({ success: false, reason: 'points_not_set' });
      return true;
    }
    practiceState.looping = !practiceState.looping;
    if (practiceState.looping) ensurePracticeLoopRunning();
    sendResponse({ success: true, state: practiceState });
    return true;
  }

  if (request.action === 'practice_set_speed') {
    const video = getActiveVideo();
    if (!video) { sendResponse({ success: false, reason: 'no_video' }); return true; }
    applySpeed(video, request.speed);
    sendResponse({ success: true, state: practiceState });
    return true;
  }

  if (request.action === 'practice_clear') {
    practiceState = { pointA: null, pointB: null, looping: false, speed: 1.0 };
    if (practiceRafId) { cancelAnimationFrame(practiceRafId); practiceRafId = null; }
    const video = getActiveVideo();
    if (video) video.playbackRate = 1.0;
    sendResponse({ success: true, state: practiceState });
    return true;
  }

  const video = getActiveVideo();

  if (!video) {
    sendResponse({ success: false, reason: "no_video" });
    return true;
  }

  unlockPipAttribute(video);

  if (request.action === "toggle_pip") {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    } else {
      video.requestPictureInPicture()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    }
  }
  else if (request.action === "check_and_enter_auto_pip") {
    const isPlaying = !!(video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2);

    if (isPlaying && !document.pictureInPictureElement) {
      video.requestPictureInPicture()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    } else {
      sendResponse({ success: false, reason: "not_playing_or_already_pip" });
    }
  }
  else if (request.action === "exit_auto_pip") {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    } else {
      sendResponse({ success: false, reason: "not_in_pip" });
    }
  }
  else if (request.action === "trigger_play_pause") {
    if (video.paused) { video.play(); } else { video.pause(); }
    sendResponse({ success: true });
  }
  else if (request.action === "trigger_rewind") {
    video.currentTime = Math.max(0, video.currentTime - 10);
    sendResponse({ success: true });
  }
  return true;
});

} // end double-injection guard