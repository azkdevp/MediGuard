// background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log("[MediGuard] Installed");
});

// Toolbar icon → open as a small app window (no auto-close)
chrome.action.onClicked.addListener(() => openPopupWindow());

// Message from content/popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.cmd === "OPEN_POPUP_WINDOW") {
    openPopupWindow();
    sendResponse?.({ ok: true });
  }
});

function openPopupWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 420,
    height: 680,
    top: 120,
    left: 120
  });
}
