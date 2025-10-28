// popup.js — MediGuard AI (Chrome Built-in AI + Hybrid + Multimodal + A11y)
// Now with: reliable feature detection, timeouts, clearer errors, and safer fallbacks.

let lastReport = null;
let readingUtterance = null;

// ---------- SMALL UTILITIES ----------
const hasAI = () => typeof self !== "undefined" && typeof self.ai !== "undefined";

function toast(msg) {
  // minimal, non-blocking notice
  console.log("[MediGuard]", msg);
  // If you have a UI toast element, write to it here. For now, use alert for critical.
}

async function createWithTimeout(factory, ms = 8000, label = "AI") {
  // Prevent hangs while the model downloads / API stalls.
  return await Promise.race([
    factory(),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))
  ]);
}

function friendlyAISetupHelp(which) {
  return `Chrome ${which} not available.

Make sure:
1) You're on Chrome 138+.
2) “Experimental AI features” is ON (chrome://flags).
3) The model finished downloading (Chrome will do this in the background).
4) You added the origin trial tokens (already in manifest) and reloaded the extension.

If you just enabled flags, fully quit & reopen Chrome.`;
}

// ---------- DOM BOOTSTRAP ----------
document.addEventListener("DOMContentLoaded", async () => {
  const analyzeBtn   = document.getElementById("analyze-btn");
  const hybridToggle = document.getElementById("hybrid-toggle");
  const simplifyBtn  = document.getElementById("simplify-btn");
  const translateBtn = document.getElementById("translate-btn");
  const langSelect   = document.getElementById("language");
  const detectBtn    = document.getElementById("detect-btn");
  const modeBanner   = document.getElementById("mode-banner");
  const offlineNote  = document.getElementById("offline-note");

  // --- Create buttons dynamically (download + read aloud) ---
  const downloadBtn = document.createElement("button");
  downloadBtn.id = "download-btn";
  downloadBtn.textContent = "⬇️ Download Report";
  downloadBtn.style.display = "none";
  downloadBtn.className = "download-btn mini-btn";
  document.querySelector(".container").appendChild(downloadBtn);

  const readBtn = document.createElement("button");
  readBtn.id = "read-btn";
  readBtn.textContent = "🔊 Read Aloud";
  readBtn.style.display = "none";
  readBtn.className = "mini-btn";
  document.querySelector(".container").appendChild(readBtn);

  // Settings & initial banners
  const { hybridEnabled } = await chrome.storage.local.get("hybridEnabled");
  const { preferredLang } = await chrome.storage.local.get("preferredLang");
  const { geminiApiKey }  = await chrome.storage.local.get("geminiApiKey");

  hybridToggle.checked = !!hybridEnabled;
  if (preferredLang && langSelect) langSelect.value = preferredLang;

  // Offline fallback banner if no Gemini key (local features still run)
  if (!geminiApiKey && offlineNote) {
    offlineNote.style.display = "block";
    offlineNote.textContent = "⚙️ Running locally — Gemini Nano active.";
  }
  updateModeBanner(modeBanner, hybridToggle.checked);

  hybridToggle.addEventListener("change", e => {
    chrome.storage.local.set({ hybridEnabled: e.target.checked });
    updateModeBanner(modeBanner, e.target.checked);
  });
  langSelect?.addEventListener("change", e =>
    chrome.storage.local.set({ preferredLang: e.target.value })
  );

  // Events
  analyzeBtn.addEventListener("click", analyzeDrug);
  downloadBtn.addEventListener("click", downloadReport);
  readBtn.addEventListener("click", toggleReadAloud);
  simplifyBtn?.addEventListener("click", simplifyText);
  translateBtn?.addEventListener("click", translateText);
  detectBtn?.addEventListener("click", detectDrugFromPhoto);

  // A11y live regions
  const riskEl = document.getElementById("risk");
  riskEl?.setAttribute("aria-live", "polite");
});

// ---------- MODE BANNER ----------
function updateModeBanner(el, hybridOn) {
  if (!el) return;
  el.textContent = hybridOn
    ? "Hybrid: Using live FDA data."
    : "Offline local reasoning.";
}

// ---------- MAIN ----------
async function analyzeDrug() {
  const age        = document.getElementById("age").value.trim();
  const gender     = document.getElementById("gender").value.trim();
  const conditions = (document.getElementById("conditions").value || "").trim().toLowerCase();
  const drug       = (document.getElementById("drug").value || "").trim().toLowerCase();
  if (!drug) return alert("Enter a drug name first.");

  const riskEl     = document.getElementById("risk");
  const summaryEl  = document.getElementById("summary");
  const fdaEl      = document.getElementById("fda-snippet");
  const resultBox  = document.getElementById("result");
  const downloadBtn= document.getElementById("download-btn");
  const readBtn    = document.getElementById("read-btn");
  const bar        = document.getElementById("confidence-bar");
  const barWrap    = document.getElementById("confidence-bar-container");
  const pctLabel   = document.getElementById("risk-index-value");

  resultBox.classList.remove("hidden", "risk-safe", "risk-caution", "risk-danger");
  resultBox.classList.add("loading");
  riskEl.innerText = "⏳ Analyzing with MediGuard AI...";
  summaryEl.innerText = "";
  fdaEl.innerText = "";
  downloadBtn.style.display = "none";
  readBtn.style.display = "none";

  bar.style.width = "0%";
  bar.style.background = "#6b7280";
  barWrap.setAttribute("aria-valuenow", "0");
  pctLabel.textContent = "--%";

  const { hybridEnabled } = await chrome.storage.local.get("hybridEnabled");
  const { geminiApiKey }  = await chrome.storage.local.get("geminiApiKey");

  let fdaSnippet = hybridEnabled ? await fetchOpenFDA(drug) : null;
  let reasoning;
  try {
    reasoning = geminiApiKey
      ? await analyzeWithGemini({ age, gender, conditions, drug, fdaSnippet, geminiKey: geminiApiKey })
      : await localReasoning(drug, conditions, fdaSnippet);
  } catch {
    reasoning = await localReasoning(drug, conditions, fdaSnippet);
  }

  // risk label + summary
  riskEl.innerText = `${reasoning.riskIcon} ${reasoning.risk}`;
  summaryEl.innerText = reasoning.summary;
  fdaEl.innerText = fdaSnippet
    ? "📄 " + fdaSnippet.slice(0, 300) + (fdaSnippet.length > 300 ? "…" : "")
    : "Offline Mode — using curated local rules.";

  // visual risk index
  const pct = computeRiskIndexPercent(reasoning.risk, conditions);
  setRiskGlow(resultBox, reasoning.risk.toLowerCase(), pct);
  bar.style.width = `${pct}%`;
  barWrap.setAttribute("aria-valuenow", String(pct));
  pctLabel.textContent = `${pct}%`;

  resultBox.classList.remove("loading");

  lastReport = {
    timestamp: new Date().toLocaleString(),
    drug, age, gender, conditions, hybrid: hybridEnabled,
    risk: reasoning.risk, summary: reasoning.summary,
    fdaSnippet: fdaSnippet || "No FDA data."
  };
  downloadBtn.style.display = "inline-block";
  readBtn.style.display = "inline-block";
}

// ---------- MULTIMODAL: detect name from photo ----------
async function detectDrugFromPhoto() {
  const file = document.getElementById("pill-photo").files?.[0];
  if (!file) return alert("Pick a photo of the pill box or label first.");
  const { geminiApiKey }  = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) return alert("Add your Gemini API key in Settings to enable photo detection.");

  const base64 = await fileToBase64(file); // "data:image/...;base64,XXXX"
  const inlineData = base64ToInlineData(base64);

  const prompt = `Extract the drug's brand and generic names from this package image.
Return strict JSON like: {"brand":"...", "generic":"...", "candidates":["...", "..."]}.
If unsure, best-effort guess. Do not add extra text.`;

  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + geminiApiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
        })
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON returned.");
    const parsed = JSON.parse(match[0]);

    const drugInput = document.getElementById("drug");
    const lower = (s) => (s || "").toLowerCase().trim();
    const best = lower(parsed.generic) || lower(parsed.brand) || lower((parsed.candidates||[])[0]) || "";
    if (!best) return alert("Couldn't detect a name. Try a clearer front-of-box photo.");
    drugInput.value = best;
  } catch (e) {
    console.error(e);
    alert("Photo detection failed. Try again with a clearer label.");
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function base64ToInlineData(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = meta.match(/data:(.*?);base64/)[1] || "image/png";
  return { mimeType: mime, data: b64 };
}

// ---------- GEMINI CLOUD (fallback / hybrid) ----------
async function analyzeWithGemini({ age, gender, conditions, drug, fdaSnippet, geminiKey }) {
  const prompt = `
You are MediGuard AI — a pharmacist assistant.
Return ONLY valid JSON like:
{"risk":"Safe|Caution|Danger","reason":"...","advice":"..."}

Patient:
Age: ${age || "N/A"}
Gender: ${gender}
Conditions: ${conditions || "none"}
Drug: ${drug}
Label: ${fdaSnippet || "none"}
Rules: prefer evidence-based safety. If conflicts, lean conservative.
`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + geminiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 250 }
      })
    }
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed = {};
  if (jsonMatch) try { parsed = JSON.parse(jsonMatch[0]); } catch {}

  // conservative guard
  if (!parsed.risk) {
    if (conditions.includes("hypertension") && drug.includes("ibuprofen"))
      parsed = { risk: "Danger", reason: "Ibuprofen may raise blood pressure and strain kidneys.", advice: "Prefer acetaminophen or consult your doctor." };
    else parsed = { risk: "Safe", reason: "No major conflict found for your profile.", advice: "Use as directed on label." };
  }

  const { risk, reason, advice } = parsed;
  const icon = /danger/i.test(risk) ? "🔴" : /caution/i.test(risk) ? "🟠" : /safe/i.test(risk) ? "🟢" : "⚪";
  return { risk, riskIcon: icon, summary: `${reason} ${advice}` };
}

// ---------- LOCAL (on-device) ----------
async function localReasoning(drug, conditions, fdaSnippet) {
  const localDB = {
    ibuprofen:     { caution: ["asthma", "hypertension"], danger: ["ulcer", "pregnancy"] },
    acetaminophen: { caution: ["alcohol"], danger: ["liver"] },
    naproxen:      { caution: ["hypertension"], danger: ["ulcer", "pregnancy"] }
  };
  const profile = localDB[drug];
  let risk = "Safe", icon = "🟢", reason = "No major issues detected.";
  if (profile) {
    if (profile.danger.some(c => conditions.includes(c))) {
      risk = "Danger"; icon = "🔴"; reason = "May worsen existing condition. Avoid unless prescribed.";
    } else if (profile.caution.some(c => conditions.includes(c))) {
      risk = "Caution"; icon = "🟠"; reason = "Monitor or seek advice before use.";
    }
  }
  if (fdaSnippet) reason += " FDA: " + fdaSnippet.substring(0, 100) + "...";
  return { risk, riskIcon: icon, summary: reason };
}

// ---------- FDA (Hybrid) ----------
async function fetchOpenFDA(drug) {
  try {
    const q = encodeURIComponent(drug);
    const res = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:${q}+openfda.generic_name:${q}&limit=1`);
    const data = await res.json();
    return (
      data.results?.[0]?.warnings?.[0] ||
      data.results?.[0]?.indications_and_usage?.[0] ||
      data.results?.[0]?.description?.[0] ||
      "No FDA label found."
    );
  } catch { return "FDA API unavailable."; }
}

// ---------- SIMPLIFY (Built-in Summarizer API) ----------
async function simplifyText() {
  const summaryEl = document.getElementById("summary");
  const text = summaryEl.innerText.trim();
  if (!text) return alert("Nothing to simplify yet!");

  if (!hasAI()) {
    alert(friendlyAISetupHelp("Summarizer"));
    return;
  }

  try {
    const summarizer = await createWithTimeout(
      () => ai.summarizer.create({ sharedContext: "mediguard" }),
      8000,
      "Summarizer"
    );
    const output = await summarizer.summarize(text);
    summaryEl.innerText = output || text;
  } catch (e) {
    console.warn("Built-in summarizer failed:", e);
    alert(friendlyAISetupHelp("Summarizer"));
  }
}

// ---------- TRANSLATE (Built-in Translator API) ----------
async function translateText() {
  const summaryEl = document.getElementById("summary");
  const text = summaryEl.innerText.trim();
  if (!text) return alert("Nothing to translate yet!");
  const lang = document.getElementById("language").value;
  if (lang === "en") return;

  if (!hasAI()) {
    alert(friendlyAISetupHelp("Translator"));
    return;
  }

  try {
    const translator = await createWithTimeout(
      () => ai.translator.create({ targetLanguage: lang }),
      8000,
      "Translator"
    );
    const translated = await translator.translate(text);
    summaryEl.innerText = translated || text;
  } catch (e) {
    console.warn("Built-in translator failed:", e);
    alert(friendlyAISetupHelp("Translator"));
  }
}

// ---------- READ ALOUD ----------
function toggleReadAloud() {
  const summaryEl = document.getElementById("summary");
  const btn = document.getElementById("read-btn");
  if (!summaryEl.innerText.trim()) return;
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    btn.textContent = "🔊 Read Aloud";
    return;
  }
  readingUtterance = new SpeechSynthesisUtterance(summaryEl.innerText);
  readingUtterance.rate = 1;
  readingUtterance.pitch = 1;
  readingUtterance.onend = () => (btn.textContent = "🔊 Read Aloud");
  btn.textContent = "⏹ Stop";
  speechSynthesis.speak(readingUtterance);
}

// ---------- DOWNLOAD ----------
function downloadReport() {
  if (!lastReport) return alert("Analyze first!");
  const report = `
🧠 MediGuard AI Safety Report
Generated: ${lastReport.timestamp}

👤 Profile
• Age: ${lastReport.age}
• Gender: ${lastReport.gender}
• Conditions: ${lastReport.conditions}
• Hybrid Mode: ${lastReport.hybrid ? "ON" : "OFF"}

💊 Drug: ${lastReport.drug}
⚠️ Risk: ${lastReport.risk}
🩺 Summary: ${lastReport.summary}

📄 FDA Snippet:
${lastReport.fdaSnippet}
`;
  const blob = new Blob([report], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `MediGuard_${lastReport.drug}_Report.txt`;
  a.click();
  URL.revokeObjectURL(a.href);

  if (window.jspdf) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(report, 180);
    doc.text(lines, 10, 10);
    doc.save(`MediGuard_${lastReport.drug}.pdf`);
  }
}

// ---------- RISK GLOW + % ----------
function setRiskGlow(el, risk, pct) {
  el.classList.remove("risk-safe", "risk-caution", "risk-danger");
  const bar = document.getElementById("confidence-bar");
  const label = document.getElementById("risk-index-value");
  let color = "#6b7280", shadow = "none";

  if (risk.includes("danger")) {
    el.classList.add("risk-danger");
    color = "#ef4444";
    shadow = "0 0 12px rgba(239,68,68,.45)";
  } else if (risk.includes("caution")) {
    el.classList.add("risk-caution");
    color = "#f59e0b";
    shadow = "0 0 12px rgba(245,158,11,.35)";
  } else if (risk.includes("safe")) {
    el.classList.add("risk-safe");
    color = "#22c55e";
    shadow = "0 0 12px rgba(34,197,94,.35)";
  }

  bar.style.background = color;
  bar.style.boxShadow = shadow;
  label.style.color = color;
}

function computeRiskIndexPercent(risk, conditions) {
  const n = (conditions || "").split(",").map(s => s.trim()).filter(Boolean).length;
  const penalty = Math.min(n * 3, 12); // up to -12%
  if (/danger/i.test(risk))  return Math.max(5, 25 - penalty);
  if (/caution/i.test(risk)) return Math.max(10, 60 - penalty);
  return Math.max(20, 95 - penalty);
}

// ---------- CLOSE BUTTON & outside clicks ----------
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => window.close());
});
document.addEventListener("click", (e) => {
  if (!document.querySelector(".container").contains(e.target)) e.stopPropagation();
});
