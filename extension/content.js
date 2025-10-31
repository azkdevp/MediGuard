// content.js — inject FAB that opens our popup in a small window
(() => {
  if (window.__mediGuardFabInjected) return;
  window.__mediGuardFabInjected = true;

  const btn = document.createElement("button");
  btn.textContent = "⚕️";
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "linear-gradient(135deg,#1a73e8,#673ab7)",
    color: "#fff",
    fontSize: "24px",
    border: "none",
    cursor: "pointer",
    zIndex: 2147483647,
    boxShadow: "0 4px 14px rgba(26,115,232,0.25)",
  });
  btn.title = "Open MediGuard AI";

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.08)";
    btn.style.boxShadow = "0 6px 20px rgba(26,115,232,0.35)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
    btn.style.boxShadow = "0 4px 14px rgba(26,115,232,0.25)";
  });

  btn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ cmd: "OPEN_POPUP_WINDOW" });
  });

  document.documentElement.appendChild(btn);
})();
