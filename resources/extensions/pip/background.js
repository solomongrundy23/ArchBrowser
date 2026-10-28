let autoPipTabId = null;
let pipActiveTabId = null; // whichever tab actually has a floating PiP window right now, however it got there

async function safeSendMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    return null;
  }
}

async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) { /* already injected, or a restricted page — ignore */ }
}

// --- Classic Mode: lets the user revert the icon to its old
// instant-toggle behavior (no popup at all) for anyone who preferred
// the pre-update UX. chrome.action.setPopup('') removes the popup,
// which makes onClicked start firing again; setting it back to
// 'popup.html' restores the new popup-based UI. The hotkey (see
// commands handler below) is the only way back into settings once
// the popup is removed from the icon, so it must keep working
// regardless of which mode is active.
async function applyClassicModeSetting() {
  const { classicMode } = await chrome.storage.local.get({ classicMode: false });
  await chrome.action.setPopup({ popup: classicMode ? '' : 'popup.html' });
}

chrome.runtime.onInstalled.addListener(applyClassicModeSetting);
chrome.runtime.onStartup.addListener(applyClassicModeSetting);

// Only fires while Classic Mode has removed the popup — restores the
// original one-click-toggles-PiP behavior from before this update.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
    ensureInjected(tab.id).then(() => safeSendMessage(tab.id, { action: "toggle_pip" }));
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'notify_pip_entered' && sender.tab) {
    pipActiveTabId = sender.tab.id;
    return;
  }
  if (request.action === 'notify_pip_left' && sender.tab && sender.tab.id === pipActiveTabId) {
    pipActiveTabId = null;
    return;
  }

  if (request.action === 'set_classic_mode') {
    (async () => {
      await chrome.storage.local.set({ classicMode: request.enabled });
      await applyClassicModeSetting();
      sendResponse({ success: true });
    })();
    return true;
  }

  // The popup calls this on open to figure out which tab to talk to —
  // prefer the tab that's actually showing the floating PiP window
  // (the user has usually switched away from it by the time they open
  // the popup), falling back to whatever tab is currently active.
  if (request.action === 'get_target_tab') {
    (async () => {
      let tabId = pipActiveTabId;
      let isPip = !!pipActiveTabId;

      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
          tabId = tab.id;
        }
      }

      if (tabId) await ensureInjected(tabId);
      const { classicMode } = await chrome.storage.local.get({ classicMode: false });
      sendResponse({ tabId: tabId || null, isPip, classicMode });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pipActiveTabId === tabId) pipActiveTabId = null;
  if (autoPipTabId === tabId) autoPipTabId = null;
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const activeTabId = activeInfo.tabId;

  if (autoPipTabId && autoPipTabId === activeTabId) {
    await safeSendMessage(activeTabId, { action: "exit_auto_pip" });
    autoPipTabId = null;
    return;
  }
  chrome.tabs.query({ audible: true }, async (tabs) => {
    for (let tab of tabs) {
      if (tab.id !== activeTabId && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {

        const response = await safeSendMessage(tab.id, { action: "check_and_enter_auto_pip" });

        if (response && response.success) {
          autoPipTabId = tab.id;
          break;
        }
        else if (!response) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          }).then(async () => {
            const retryResponse = await safeSendMessage(tab.id, { action: "check_and_enter_auto_pip" });
            if (retryResponse && retryResponse.success) {
              autoPipTabId = tab.id;
            }
          }).catch(() => {});
        }
      }
    }
  });
});

chrome.commands?.onCommand?.addListener((command) => {
  if (command === "toggle_practice_panel") {
    // This is the escape hatch back into settings — it must work
    // even when Classic Mode has removed the popup from the icon
    // itself, so make sure a popup is actually set before opening it.
    chrome.action.setPopup({ popup: 'popup.html' })
      .then(() => chrome.action.openPopup())
      .catch(() => {});
    return;
  }

  let targetTabId = autoPipTabId;

  if (targetTabId) {
    safeSendMessage(targetTabId, { action: command });
  } else {
    chrome.tabs.query({ audible: true }, (tabs) => {
      if (tabs.length > 0) {
        safeSendMessage(tabs[0].id, { action: command });
      }
    });
  }
});