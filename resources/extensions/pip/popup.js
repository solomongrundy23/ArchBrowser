document.addEventListener('DOMContentLoaded', () => {
  const pipStatusEl = document.getElementById('pipStatus');
  const pipToggleBtn = document.getElementById('pipToggleBtn');
  const practiceControls = document.getElementById('practiceControls');
  const emptyNote = document.getElementById('emptyNote');
  const setABtn = document.getElementById('setA');
  const setBBtn = document.getElementById('setB');
  const labelA = document.getElementById('labelA');
  const labelB = document.getElementById('labelB');
  const loopBtn = document.getElementById('loopBtn');
  const speedSlider = document.getElementById('speedSlider');
  const speedValue = document.getElementById('speedValue');
  const clearBtn = document.getElementById('clearBtn');
  const rateLink = document.getElementById('rateLink');
  const classicModeToggle = document.getElementById('classicModeToggle');

  const rateOverlay = document.getElementById('rateOverlay');
  const rateNowBtn = document.getElementById('rateNowBtn');
  const rateLaterBtn = document.getElementById('rateLaterBtn');
  const RATE_URL = 'https://chromewebstore.google.com/detail/eaoeedfbomdkpjfoiohbgmocffnebjnd/reviews';

  let targetTabId = null;

  updateSpeedTrackFill(parseFloat(speedSlider.value));

  init();
  maybeShowRateModal();

  // Counts POPUP OPENS, not raw icon clicks — the modal can only
  // ever be shown here, so that's the meaningful number regardless
  // of whether Classic Mode is on (which opens this popup far less
  // often, since icon clicks go straight to toggling PiP instead).
  async function maybeShowRateModal() {
    const data = await chrome.storage.local.get({
      popupOpenCount: 0,
      nextRateMilestone: 7,
      ratingDone: false
    });
    const newCount = data.popupOpenCount + 1;
    await chrome.storage.local.set({ popupOpenCount: newCount });

    // Handlers are bound unconditionally so the modal can never end up
    // visible-but-unresponsive, regardless of the milestone check below.
    rateNowBtn.onclick = async () => {
      await chrome.storage.local.set({ ratingDone: true });
      chrome.tabs.create({ url: RATE_URL });
      rateOverlay.hidden = true;
    };
    rateLaterBtn.onclick = async () => {
      await chrome.storage.local.set({ nextRateMilestone: data.nextRateMilestone * 3 });
      rateOverlay.hidden = true;
    };

    if (!data.ratingDone && newCount >= data.nextRateMilestone) {
      rateOverlay.hidden = false;
    }
  }

  async function init() {
    const { tabId, isPip, classicMode } = await chrome.runtime.sendMessage({ action: 'get_target_tab' });
    targetTabId = tabId;

    classicModeToggle.checked = classicMode;
    if (classicMode) {
      // We only got here via the hotkey escape-hatch (Classic Mode
      // removes the popup from the icon itself) — re-apply that
      // setting now so future icon clicks go back to instant-toggle.
      // This doesn't affect the popup instance that's already open.
      chrome.runtime.sendMessage({ action: 'set_classic_mode', enabled: true });
    }

    if (isPip) {
      pipStatusEl.textContent = 'Floating now';
      pipStatusEl.classList.add('live');
    }

    if (!targetTabId) {
      showEmpty();
      return;
    }

    refreshPracticeState();
  }

  function showEmpty() {
    pipToggleBtn.disabled = true;
    practiceControls.hidden = true;
    emptyNote.hidden = false;
  }

  function formatTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateSpeedTrackFill(value) {
    const min = parseFloat(speedSlider.min);
    const max = parseFloat(speedSlider.max);
    const pct = ((value - min) / (max - min)) * 100;
    speedSlider.style.background =
      `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--off) ${pct}%, var(--off) 100%)`;
  }

  function renderState(state) {
    labelA.textContent = formatTime(state.pointA);
    labelB.textContent = formatTime(state.pointB);
    loopBtn.disabled = state.pointA === null || state.pointB === null;
    loopBtn.textContent = 'Loop: ' + (state.looping ? 'ON' : 'OFF');
    loopBtn.classList.toggle('on', state.looping);
    speedSlider.value = state.speed;
    speedValue.textContent = state.speed.toFixed(2) + 'x';
    updateSpeedTrackFill(state.speed);
  }

  function send(action, extra) {
    return chrome.tabs.sendMessage(targetTabId, Object.assign({ action }, extra || {}));
  }

  async function refreshPracticeState() {
    try {
      const res = await send('get_practice_state');
      if (res && res.success) renderState(res.state);
      else showEmpty();
    } catch (e) {
      showEmpty();
    }
  }

  pipToggleBtn.addEventListener('click', async () => {
    if (!targetTabId) return;
    await send('toggle_pip');
    window.close();
  });

  setABtn.addEventListener('click', async () => {
    const res = await send('practice_set_a');
    if (res && res.success) renderState(res.state);
  });

  setBBtn.addEventListener('click', async () => {
    const res = await send('practice_set_b');
    if (res && res.success) renderState(res.state);
  });

  loopBtn.addEventListener('click', async () => {
    const res = await send('practice_toggle_loop');
    if (res && res.success) renderState(res.state);
  });

  speedSlider.addEventListener('input', async (e) => {
    const speed = parseFloat(e.target.value);
    speedValue.textContent = speed.toFixed(2) + 'x';
    updateSpeedTrackFill(speed);
    await send('practice_set_speed', { speed });
  });

  clearBtn.addEventListener('click', async () => {
    const res = await send('practice_clear');
    if (res && res.success) renderState(res.state);
  });

  classicModeToggle.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({ action: 'set_classic_mode', enabled: classicModeToggle.checked });
  });

  rateLink.addEventListener('click', (e) => {
    e.preventDefault();
    // TODO: swap in the real Chrome Web Store reviews URL once published.
    chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/eaoeedfbomdkpjfoiohbgmocffnebjnd/reviews' });
  });
});