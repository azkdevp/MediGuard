// background.js — MediGuard AI (MV3 Background, Prompt API compliant)

// ------------------------------------------------------
// Lifecycle
// ------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  console.log("[MediGuard] Installed ✅");
});

console.log("[MediGuard] 🔄 Background service worker started (MV3).");
console.log("[MediGuard] Note: The Prompt API (LanguageModel) is only available in popup or content scripts.");

// ------------------------------------------------------
// Toolbar icon → open popup window
// ------------------------------------------------------
chrome.action.onClicked.addListener(() => openPopupWindow());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Allow popup trigger
  if (msg?.cmd === "OPEN_POPUP_WINDOW") {
    openPopupWindow();
    sendResponse?.({ ok: true });
  }

  // Diagnostic logs from popup.js
  if (msg?.cmd === "PROMPT_STATUS_UPDATE") {
    const ts = new Date().toLocaleString();
    console.log(`[MediGuard] 🧠 Prompt API status update @ ${ts}:`, msg.status);
  }

  // Logs hybrid cloud fallback or other info
  if (msg?.cmd === "HYBRID_EVENT_LOG") {
    const ts = new Date().toLocaleString();
    console.log(`[MediGuard] 🌐 Hybrid Mode Event @ ${ts}:`, msg.details);
  }

  sendResponse?.({ ok: true });
  return true;
});

// ------------------------------------------------------
// Helper: open extension popup window
// ------------------------------------------------------
function openPopupWindow() {
  try {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 420,
      height: 680,
      top: 120,
      left: 120
    });
  } catch (err) {
    console.error("[MediGuard] Failed to open popup:", err);
  }
}

// ------------------------------------------------------
// Background heartbeat (keep-alive to prevent early unload)
// ------------------------------------------------------
try {
  chrome.alarms.create("keepAlive", { periodInMinutes: 4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepAlive") {
      console.debug("[MediGuard] ⏱️ Background heartbeat OK");
    }
  });
} catch (e) {
  console.debug("[MediGuard] Alarms unavailable:", e?.message || e);
}

// ------------------------------------------------------
// Message relay for Prompt API diagnostics
// ------------------------------------------------------
// The background cannot use LanguageModel directly.
// Instead, popup.js checks the model and sends updates here.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "reportPromptStatus" && msg.status) {
    const ts = new Date().toLocaleString();
    console.log(`[MediGuard] 🧩 Prompt API (${msg.status.available}) — ${msg.status.reason || "ready"} @ ${ts}`);
    sendResponse({ ok: true });
  }
  return true;
});
