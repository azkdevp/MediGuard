document.getElementById("save").addEventListener("click", async () => {
  const key = (document.getElementById("key").value || "").trim();
  await chrome.storage.local.set({ geminiApiKey: key });
  document.getElementById("status").style.display = "inline";
  setTimeout(() => (document.getElementById("status").style.display = "none"), 1500);
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("geminiApiKey");
  document.getElementById("key").value = "";
  alert("Key removed.");
});

// prefill if exists
(async () => {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (geminiApiKey) document.getElementById("key").value = geminiApiKey;
})();
