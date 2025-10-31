// popup.js — MediGuard AI 

let lastReport = null;
let readingUtterance = null;
let modelSession = null;

/* ----------------------------- UTILITIES ----------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const log = (...a) => console.log("[MediGuard]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendlyAISetupHelp(which) {
  return `Chrome ${which} not available.
Make sure:
1) You're on Chrome 144+.
2) “Experimental AI features” is ON (chrome://flags).
3) Model fully downloaded in chrome://on-device-internals (Status: Ready).
4) Restart Chrome after enabling features.`;
}

function cleanFDAText(text) {
  if (!text) return "";
  return text
    .replace(/```json|```/g, "") // remove markdown fences
    .replace(/\s+/g, " ") // collapse extra spaces/newlines
    .replace(/([a-z])([A-Z])/g, "$1. $2") // insert missing periods
    .replace(/([.,])([A-Za-z])/g, "$1 $2") // add missing space after punctuation
    .trim();
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

/* ------------------ Proofreader API for inputs ------------------ */
async function cleanUserInput(input) {
  if (!window.ai?.languageModel) return input; // fallback
  try {
    const proofreader = await ai.languageModel.create({ model: "proofreader" });
    const out = await proofreader.prompt(`Fix spelling and grammar only. Keep terms unchanged if already valid medical/drug names:\n${input}`);
    return out?.trim() || input;
  } catch (err) {
    log("Proofreader failed:", err);
    return input;
  }
}

/* --------------------- STATUS BADGE (always visible) --------------------- */
function ensureStatusBadge() {
  let badge = $("#status-badge");
  if (badge) return badge;

  const analyzeBtn = $("#analyze-btn");
  badge = document.createElement("div");
  badge.id = "status-badge";
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  badge.className = "status-badge";
  badge.innerHTML = `
    <span id="badge-nano" class="chip">Nano: <em>checking…</em></span>
    <span id="badge-hybrid" class="chip">Hybrid: <em>OFF</em></span>
    <span id="badge-fda" class="chip">FDA: <em>idle</em></span>
  `;
  analyzeBtn?.parentNode?.insertBefore(badge, analyzeBtn);
  return badge;
}

function updateBadge({ nano, hybrid, fda }) {
  const bn = $("#badge-nano");
  const bh = $("#badge-hybrid");
  const bf = $("#badge-fda");

  if (nano) {
    bn.innerHTML =
      nano === "available"
        ? `Nano: <strong>Ready</strong> ✅`
        : nano === "downloading"
        ? `Nano: <strong>Downloading…</strong> ⏳`
        : `Nano: <strong>Unavailable</strong> ⚠️`;
  }
  if (typeof hybrid === "boolean") {
    bh.innerHTML = `Hybrid: <strong>${hybrid ? "ON" : "OFF"}</strong>`;
    bh.classList.toggle("chip-on", hybrid);
  }
  if (fda) {
    const map = {
      idle: "idle",
      fetching: "fetching…",
      ok: "label found",
      none: "not found",
      error: "error",
    };
    bf.innerHTML = `FDA: <strong>${map[fda] || fda}</strong>`;
    bf.classList.remove("chip-warn", "chip-ok");
    if (fda === "ok") bf.classList.add("chip-ok");
    if (fda === "none" || fda === "error") bf.classList.add("chip-warn");
  }
}

/* ---------------------- PROMPT API INITIALIZATION ---------------------- */
function normalizeAvailability(av) {
  // API has varied between string and object in docs; normalize to {state}
  if (typeof av === "string") {
    if (av === "unavailable") return { state: "unavailable" };
    if (av === "downloadable") return { state: "downloading" };
    return { state: "available" };
  }
  // object form (future-friendly)
  if (av?.available === "no") return { state: "unavailable", reason: av.reason };
  if (av?.available === "after-download") return { state: "downloading" };
  return { state: "available" };
}

async function initPromptAPI(noteEl) {
  if (!window.LanguageModel) {
    setText(noteEl, "❌ Built-in Prompt API not available. Enable Experimental AI features.");
    updateBadge({ nano: "unavailable" });
    return null;
  }

  try {
    const raw = await LanguageModel.availability();
    const status = normalizeAvailability(raw);
    log("LanguageModel availability →", status);

    if (status.state === "unavailable") {
      setText(
        noteEl,
        `⏳ Gemini Nano not available (${status.reason || "downloading or disabled"}).`
      );
      updateBadge({ nano: "unavailable" });
      return null;
    }
    if (status.state === "downloading") {
      setText(noteEl, "⏳ Downloading Gemini Nano… keep Chrome open until ready.");
      updateBadge({ nano: "downloading" });
      return null;
    }

    // Ready → create session
    modelSession = await LanguageModel.create({
      initialPrompts: [
        {
          role: "system",
          content:
            "You are MediGuard AI, a concise, privacy-preserving pharmacist assistant. Output in strict JSON when asked.",
        },
      ],
    });
    setText(noteEl, "✅ Gemini Nano active (on-device).");
    updateBadge({ nano: "available" });
    log("✅ On-device Gemini Nano session ready");
    return modelSession;
  } catch (err) {
    log("❌ Prompt API initialization failed:", err);
    setText(noteEl, "⚠️ Gemini Nano unavailable — using fallback.");
    updateBadge({ nano: "unavailable" });
    return null;
  }
}

/* --------------------------- DOM BOOTSTRAP --------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  log("Popup loaded ✅");

  const container = $(".container");
  if (!container) return;

  // Always-visible status
  ensureStatusBadge();

  const offlineNote = $("#offline-note");
  const analyzeBtn = $("#analyze-btn");
  const hybridToggle = $("#hybrid-toggle");
  const langSelect = $("#language");
  const simplifyBtn = $("#simplify-btn");
  const translateBtn = $("#translate-btn");
  const detectBtn = $("#detect-btn");
  const closeBtn = $("#close-btn");

  closeBtn?.addEventListener("click", () => window.close());

  // Do NOT close on outside click (better UX for extension popups)
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) e.stopPropagation();
  });

  // Restore prefs
  const stored = await chrome.storage.local.get([
    "hybridEnabled",
    "preferredLang",
    "geminiApiKey",
  ]);
  if (hybridToggle) hybridToggle.checked = !!stored.hybridEnabled;
  if (langSelect && stored.preferredLang) langSelect.value = stored.preferredLang;
  updateBadge({ hybrid: !!stored.hybridEnabled });

  hybridToggle?.addEventListener("change", (e) => {
    const on = !!e.target.checked;
    chrome.storage.local.set({ hybridEnabled: on });
    updateBadge({ hybrid: on });
  });
  langSelect?.addEventListener("change", (e) =>
    chrome.storage.local.set({ preferredLang: e.target.value })
  );

  // Init Prompt API
  await initPromptAPI(offlineNote);

  // Wire actions
  analyzeBtn?.addEventListener("click", analyzeDrug);
  simplifyBtn?.addEventListener("click", simplifyText);
  translateBtn?.addEventListener("click", translateText);
  detectBtn?.addEventListener("click", detectDrugFromPhoto);
});

/* ----------------------------- ANALYSIS ----------------------------- */
function setAnalyzing(on) {
  const btn = $("#analyze-btn");
  if (!btn) return;
  btn.classList.toggle("btn-analyzing", !!on);
  btn.disabled = !!on;
  btn.setAttribute("aria-busy", on ? "true" : "false");
  btn.innerHTML = on ? `<span class="spin"></span> Analyzing…` : `Analyze Safety`;
}

function setRiskGlow(el, risk, pct) {
  el.classList.remove("risk-safe", "risk-caution", "risk-danger");
  const bar = $("#confidence-bar");
  const label = $("#risk-index-value");
  let color = "#6b7280",
    shadow = "none";

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

  // smooth animate bar to pct
  const start = parseInt(bar.style.width || "0", 10) || 0;
  const end = Math.max(0, Math.min(100, Math.round(pct)));
  const t0 = performance.now();
  const DUR = 450;

  function tick(t) {
    const k = Math.min(1, (t - t0) / DUR);
    const v = Math.round(start + (end - start) * k);
    bar.style.width = `${v}%`;
    $("#confidence-bar-container").setAttribute("aria-valuenow", String(v));
    setText($("#risk-index-value"), `${v}%`);
    if (k < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

function safeJsonIn(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function analyzeDrug() {
  // Clean inputs with Proofreader
  const age = $("#age").value.trim();
  const gender = $("#gender").value.trim();
  let conditions = ($("#conditions").value || "").trim().toLowerCase();
  let drug = ($("#drug").value || "").trim().toLowerCase();
  if (!drug) return alert("Enter a drug name first.");
  drug = await cleanUserInput(drug);
  conditions = await cleanUserInput(conditions);

  const riskEl = $("#risk");
  const summaryEl = $("#summary");
  const fdaEl = $("#fda-snippet");
  const resultBox = $("#result");

  resultBox.classList.remove("hidden", "risk-safe", "risk-caution", "risk-danger");
  resultBox.classList.add("loading");
  setText(riskEl, "⏳ Analyzing with MediGuard AI…");
  setText(summaryEl, "");
  setText(fdaEl, "");
  setAnalyzing(true);
  updateBadge({ fda: "fetching" });

  const { hybridEnabled } = await chrome.storage.local.get("hybridEnabled");
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");

  // FDA first (for better reasoning context)
  let fda = null;
  if (hybridEnabled) {
    try {
      fda = await fetchOpenFDAFull(drug);
      updateBadge({ fda: fda?.snippet ? "ok" : "none" });
    } catch {
      updateBadge({ fda: "error" });
    }
  } else {
    updateBadge({ fda: "idle" });
  }

  // Reasoning cascade: on-device → cloud → local rules
  let reasoning = null;

  // ---------- On-device (Prompt API) with structured JSON ----------
  if (modelSession) {
    try {
      const prompt = `
Return STRICT JSON only:
{
 "risk": "Safe|Caution|Danger",
 "risk_index": 0-100,
 "summary": "1-line headline (human-readable)",
 "why": "short explanation why it's rated this way",
 "advice": "action user should take",
 "signals": ["condition match","FDA warnings","known interactions"]
}

Patient:
- Age: ${age || "N/A"}
- Gender: ${gender || "N/A"}
- Conditions: ${conditions || "none"}
Drug: ${drug}
FDA excerpt: ${fda?.snippet ? fda.snippet.slice(0, 600) : "none"}
Be concise, factual, and conservative. Prefer FDA labeling. Never invent FDA text.`;

      const reply = await modelSession.prompt(prompt);
      const parsed = safeJsonIn(reply);
      if (parsed?.risk) reasoning = normalizeReasoningV2(parsed);
      log("🧠 Structured output (on-device):", parsed);
    } catch (err) {
      log("⚠️ On-device reasoning failed:", err);
    }
  }

  // ---------- Cloud fallback (Gemini) with the same schema ----------
  if (!reasoning && geminiApiKey) {
    reasoning = await analyzeWithGeminiCloud({
      age,
      gender,
      conditions,
      drug,
      fdaSnippet: fda?.snippet || null,
      geminiKey: geminiApiKey,
    });
  }

  // ---------- Local rules (last resort) ----------
  if (!reasoning) {
    reasoning = await localReasoning(drug, conditions, fda?.snippet || null);
  }

  // ---------- Render (Upgraded UX) ----------
  const pct = clamp01(reasoning.riskIndex) * 100;
  setRiskGlow(resultBox, reasoning.risk.toLowerCase(), pct);

  // Risk label
  setText(riskEl, `${reasoning.riskIcon} ${reasoning.risk}`);

  // Subtitles + CTA line
  const subtitles = {
    Safe: "🟢 Low-risk for most people.",
    Caution: "🟠 May need doctor advice.",
    Danger: "🔴 Avoid unless prescribed.",
  };
  const guidance = {
    Safe: "You can generally use this medication as directed.",
    Caution: "Check with a pharmacist before use.",
    Danger: "Seek a doctor’s advice before taking this.",
  };

  // Signals as chips
  const signalsHTML = (reasoning.signals || [])
    .slice(0, 6)
    .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
    .join(" ");

  // Structured block
  const structuredHTML = `
    <div class="summary-block">
      <p><strong>✅ Summary:</strong> ${escapeHtml(reasoning.summary)}</p>
      <p><strong>💡 Why:</strong> ${escapeHtml(reasoning.why)}</p>
      <p><strong>📋 Advice:</strong> ${escapeHtml(reasoning.advice)}</p>
      ${
        signalsHTML
          ? `<div class="signals-row" aria-label="Signals">🔎 ${signalsHTML}</div>`
          : ""
      }
    </div>
    <p class="risk-subtitle">${subtitles[reasoning.risk] || ""}</p>
    <p class="confidence-line">${guidance[reasoning.risk] || ""}</p>
  `;

  // Render the structured block into #summary
  summaryEl.innerHTML = structuredHTML;

  // FDA snippet (plain)
  setText(
    fdaEl,
    fda?.snippet
      ? "📄 " + cleanFDAText(fda.snippet).slice(0, 350) + (fda.snippet.length > 350 ? "…" : "")
      : hybridEnabled
      ? "FDA label not found."
      : "Offline Mode — using curated local rules."
  );

  resultBox.classList.remove("loading");
  setAnalyzing(false);

  // Track last report (keep your existing fields)
  lastReport = {
    timestamp: new Date().toLocaleString(),
    drug,
    age,
    gender,
    conditions,
    hybrid: hybridEnabled,
    risk: reasoning.risk,
    summary: `${reasoning.summary} ${reasoning.why ? "— " + reasoning.why : ""} ${reasoning.advice ? " | " + reasoning.advice : ""}`.trim(),
    fdaSnippet: fda?.snippet || (hybridEnabled ? "No FDA data." : "Offline."),
  };

  // Ensure Download + Read buttons exist and show
  ensureActionButtons();
  $("#download-btn").style.display = "inline-block";
  $("#read-btn").style.display = "inline-block";

  // Prepare "plain" string for view toggles (beneath structured block)
  const plainOriginal =
    `Summary: ${reasoning.summary}\nWhy: ${reasoning.why}\nAdvice: ${reasoning.advice}`
      .replace(/\n{2,}/g, "\n")
      .trim();

  // Store the plain original in a data attr for toggling
  summaryEl.dataset.plainOriginal = plainOriginal;

  // Mount the view toggle under the structured summary (your existing UI)
  ensureViewToggle();
  // Set the "Original" view text to the plain original (not the HTML block)
  originalText = plainOriginal;
  simplifiedText = "";
  translatedText = "";
  switchView("original");
}

/* ---------------- normalizeReasoningV2 (structured) ---------------- */
function normalizeReasoningV2(parsed) {
  const risk = String(parsed.risk || "Safe");
  const icon = /danger/i.test(risk)
    ? "🔴"
    : /caution/i.test(risk)
    ? "🟠"
    : "🟢";
  const ri =
    typeof parsed.risk_index === "number"
      ? Math.max(0, Math.min(100, parsed.risk_index)) / 100
      : /danger/i.test(risk)
      ? 0.2
      : /caution/i.test(risk)
      ? 0.55
      : 0.9;
  return {
    risk,
    riskIcon: icon,
    riskIndex: ri,
    summary: parsed.summary || (parsed.reason || "No summary provided."),
    why: parsed.why || parsed.reason || "",
    advice: parsed.advice || "",
    signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6) : [],
  };
}

/* --------------------------- CLOUD FALLBACK --------------------------- */
async function analyzeWithGeminiCloud({ age, gender, conditions, drug, fdaSnippet, geminiKey }) {
  const prompt = `
Return STRICT JSON ONLY:
{
 "risk":"Safe|Caution|Danger",
 "risk_index": 0-100,
 "summary": "1-line headline (human-readable)",
 "why": "short explanation why it's rated this way",
 "advice": "action user should take",
 "signals": ["condition match","FDA warnings","known interactions"]
}
Age:${age||"N/A"}, Gender:${gender||"N/A"}, Conditions:${conditions||"none"}, Drug:${drug}
FDA:${fdaSnippet || "none"}
Conservative if conflicts; prefer FDA labeling; never invent FDA text.`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 350 }
        }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = safeJsonIn(text);
    if (parsed?.risk) return normalizeReasoningV2(parsed);
  } catch (err) {
    log("Cloud fallback failed:", err);
  }
  return null;
}

/* ------------------------------ FDA API ------------------------------ */
/** Aggressive but safe FDA fetcher (brand + generic; merges useful fields) */
async function fetchOpenFDAFull(drug) {
  const q = encodeURIComponent(`"${drug}"`);
  // Try brand_name + generic_name; if no results, try substring search
  const urls = [
    `https://api.fda.gov/drug/label.json?search=openfda.brand_name:${q}+openfda.generic_name:${q}&limit=1`,
    `https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(drug)}+openfda.generic_name:${encodeURIComponent(drug)}&limit=1`,
  ];

  const firstOk = async (us) => {
    for (const u of us) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const data = await r.json();
        const row = data?.results?.[0];
        if (row) return row;
      } catch {
        // continue
      }
    }
    return null;
  };

  const row = await firstOk(urls);
  if (!row) return { snippet: null };

  // Collect commonly relevant fields
  const fields = [
    "warnings",
    "warnings_and_cautions",
    "contraindications",
    "precautions",
    "drug_interactions",
    "adverse_reactions",
    "indications_and_usage",
  ];
  const parts = [];
  for (const f of fields) {
    const v = row[f];
    if (Array.isArray(v) && v[0]) parts.push(`${f.replaceAll("_", " ")}: ${v[0]}`);
  }
  const snippet = parts.join("\n\n").trim() || row.description?.[0] || null;
  return { snippet };
}

/* ---------------------------- LOCAL RULES ---------------------------- */
async function localReasoning(drug, conditions, fdaSnippet) {
  const localDB = {
    ibuprofen: { caution: ["asthma", "hypertension"], danger: ["ulcer", "pregnancy"] },
    acetaminophen: { caution: ["alcohol"], danger: ["liver"] },
    naproxen: { caution: ["hypertension"], danger: ["ulcer", "pregnancy"] },
  };
  const profile = localDB[drug];
  let risk = "Safe",
    icon = "🟢",
    reason = "No major issues detected.",
    ri = 0.9;

  if (profile) {
    if (profile.danger.some((c) => conditions.includes(c))) {
      risk = "Danger";
      icon = "🔴";
      reason = "May worsen existing condition. Avoid unless prescribed.";
      ri = 0.2;
    } else if (profile.caution.some((c) => conditions.includes(c))) {
      risk = "Caution";
      icon = "🟠";
      reason = "Monitor or seek advice before use.";
      ri = 0.55;
    }
  }
  if (fdaSnippet) reason += " FDA: " + fdaSnippet.substring(0, 100) + "...";

  return {
    risk,
    riskIcon: icon,
    summary: reason,
    why: "",
    advice: "",
    riskIndex: ri,
    signals: []
  };
}

/* ------------------------- MULTIMODAL (PHOTO) ------------------------- */
/** Use cloud API for image → text (Prompt API multimodal is behind origin trial) */
async function detectDrugFromPhoto() {
  const file = $("#pill-photo").files?.[0];
  if (!file) return alert("Select a photo first.");

  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) return alert("Add your Gemini API key in Settings to enable photo detection.");

  const base64 = await fileToBase64(file);
  const [meta, b64] = String(base64).split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "image/png";

  const prompt = `Extract brand and generic drug names from this package image.
Return STRICT JSON: {"brand":"","generic":"","candidates":["..."]}`;

  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
        geminiApiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }],
            },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = safeJsonIn(text);
    const lower = (s) => (s || "").toLowerCase().trim();
    const best =
      lower(parsed?.generic) ||
      lower(parsed?.brand) ||
      lower((parsed?.candidates || [])[0]) ||
      "";
    if (!best) return alert("Couldn't detect a name. Try a clearer front-of-box photo.");
    $("#drug").value = best;
  } catch (e) {
    log("Photo detection failed:", e);
    alert("Detection failed. Try another image.");
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

/* ------------------------- SIMPLIFY / TRANSLATE ------------------------ */
async function simplifyText() {
  const allText = Array.from(document.querySelectorAll(
    "#summary, #fda-snippet, .why, .advice, .risk, .warning"
  ))
    .map(el => el.innerText.trim())
    .filter(Boolean)
    .join("\n");

  const text = allText.trim();
  if (!text) return alert("Nothing to simplify yet!");
  if (!modelSession) return alert(friendlyAISetupHelp("Summarizer"));

  try {
    const out = await modelSession.prompt(`
Simplify the following medical information into plain language for the general public.
Rules:
- Use short, clear sentences.
- Avoid jargon or technical terms.
- Keep it under 3 lines total.
- Maintain all safety meaning.

Text:
${text}
    `);

    const simplified = out
      .split(/\n+/)
      .slice(0, 3)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    simplifiedText = simplified;
    originalText ||= allText;
    ensureViewToggle();
    switchView("simplified");

    // Add UX indicator
    const statusEl = $("#status") || document.createElement("div");
    statusEl.id = "status";
    statusEl.style.fontSize = "12px";
    statusEl.style.color = "#888";
    statusEl.style.textAlign = "center";
    statusEl.style.marginTop = "4px";
    document.querySelector(".view-buttons")?.after(statusEl);
    statusEl.textContent = "Simplified for clarity";
  } catch (err) {
    log("Summarizer failed:", err);
    alert("Simplifier unavailable.");
  }
}

async function translateText() {
  const allText = Array.from(document.querySelectorAll(
    "#summary, #fda-snippet, .why, .advice, .risk, .warning"
  ))
    .map(el => el.innerText.trim())
    .filter(Boolean)
    .join("\n");

  const text = allText.trim();
  const lang = $("#language").value;
  if (!text) return alert("Nothing to translate yet!");
  if (lang === "en") return;
  if (!modelSession) return alert(friendlyAISetupHelp("Translator"));

  try {
    const out = await modelSession.prompt(`Translate to ${lang}:\n${text}\nReturn only the translation.`);
    const translated = (out || text).trim();

    translatedText = translated;
    simplifiedText ||= allText;
    originalText ||= allText;

    ensureViewToggle();
    switchView("translated");

    // Add UX indicator
    const statusEl = $("#status") || document.createElement("div");
    statusEl.id = "status";
    statusEl.style.fontSize = "12px";
    statusEl.style.color = "#888";
    statusEl.style.textAlign = "center";
    statusEl.style.marginTop = "4px";
    document.querySelector(".view-buttons")?.after(statusEl);
    statusEl.textContent = "Translated view (AI-powered)";
  } catch (err) {
    log("Translator failed:", err);
    alert("Translator unavailable.");
  }
}


/* ---------------------- DOWNLOAD + READ ALOUD ---------------------- */
function ensureActionButtons() {
  // Create the buttons if older HTML is missing them
  if (!$("#download-btn")) {
    const btn = document.createElement("button");
    btn.id = "download-btn";
    btn.textContent = "⬇️ Download Report";
    btn.className = "download-btn mini-btn";
    btn.addEventListener("click", downloadReport);
    $(".container").appendChild(btn);
  }
  if (!$("#read-btn")) {
    const btn = document.createElement("button");
    btn.id = "read-btn";
    btn.textContent = "🔊 Read Aloud";
    btn.className = "mini-btn";
    btn.addEventListener("click", toggleReadAloud);
    $(".container").appendChild(btn);
  }
}

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
}

function toggleReadAloud() {
  // Read the current view text (plain), not the HTML
  const viewText =
    currentView === "translated" ? translatedText
      : currentView === "simplified" ? simplifiedText
      : originalText;

  const btn = $("#read-btn");
  const textToRead = (viewText || $("#summary").innerText || "").trim();
  if (!textToRead) return;

  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    btn.textContent = "🔊 Read Aloud";
    return;
  }
  readingUtterance = new SpeechSynthesisUtterance(textToRead);
  readingUtterance.rate = 1;
  readingUtterance.pitch = 1;
  readingUtterance.onend = () => (btn.textContent = "🔊 Read Aloud");
  btn.textContent = "⏹ Stop";
  speechSynthesis.speak(readingUtterance);
}

/* -------- VIEW TOGGLE (Original / Simplified / Translated) ---------- */
let originalText = "";
let simplifiedText = "";
let translatedText = "";
let currentView = "original";

function ensureViewToggle() {
  if ($("#view-toggle")) return;
  const wrap = document.createElement("div");
  wrap.className = "view-toggle-wrap";
  wrap.innerHTML = `
    <div id="view-toggle" class="view-toggle">
      <button data-view="original" class="active">Original</button>
      <button data-view="simplified">Simplified</button>
      <button data-view="translated">Translated</button>
    </div>
    <div id="view-status" class="view-status" aria-live="polite"></div>
  `;
  $("#result").appendChild(wrap);

  $$("#view-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view))
  );
}

function switchView(view) {
  currentView = view;
  $$("#view-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));

  // We only update the visible text paragraph for the view status,
  // keeping the structured summary block intact above.
  const summaryEl = $("#summary");
  const status = $("#view-status");

  const map = {
    original: originalText,
    simplified: simplifiedText || originalText,
    translated: translatedText || simplifiedText || originalText,
  };

  // Show the selected view text right under the structured block:
  // We render a lightweight <div id="view-text"> after the structured HTML.
  let viewTextDiv = $("#view-text");
  if (!viewTextDiv) {
    viewTextDiv = document.createElement("div");
    viewTextDiv.id = "view-text";
    viewTextDiv.style.marginTop = "8px";
    viewTextDiv.style.fontSize = "13px";
    viewTextDiv.style.color = "#475569";
    viewTextDiv.style.whiteSpace = "pre-wrap";
    summaryEl.appendChild(viewTextDiv);
  }

  const textForView = map[view] || "";
  viewTextDiv.classList.add("fade-out");
  setTimeout(() => {
    viewTextDiv.textContent = textForView;
    viewTextDiv.classList.remove("fade-out");
    viewTextDiv.classList.add("fade-in");

    if (view === "translated" && translatedText) {
      const langName = $("#language option:checked")?.textContent || "selected language";
      status.textContent = `Translated to ${langName} ✓`;
    } else if (view === "simplified" && simplifiedText) {
      status.textContent = `Simplified view ✓`;
    } else {
      status.textContent = "";
    }
  }, 150);
}

/* ---------------------- Helpers ---------------------- */
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
