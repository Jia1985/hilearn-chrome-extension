// Always initialize the content script so it can respond to runtime toggle messages.
initTranslation();

function initTranslation() {

function getSelectedText() {
  const sel = window.getSelection();
  return sel ? sel.toString() : "";
}

// Diagnostics: indicate content script loaded
console.log("🔵 [Content Script] Loaded - ready to translate and save");

function sendSaveToObsidian(selectedText) {
  console.log("🔵 [Content Script] sendSaveToObsidian called");
  console.log("🔵 [Content Script] Selected text:", selectedText);
  
  const payload = {
    selectedText: selectedText || getSelectedText(),
    pageTitle: document.title,
    url: location.href,
  };

  console.log("🔵 [Content Script] Payload prepared:", {
    selectedText: payload.selectedText,
    pageTitle: payload.pageTitle,
    url: payload.url
  });

  console.log("🔵 [Content Script] Sending message to background script...");
  
  chrome.runtime.sendMessage(
    { type: "OBSIDIAN_APPEND", payload },
    (res) => {
      console.log("🔵 [Content Script] Received response from background script:", res);
      
      if (chrome.runtime.lastError) {
        const errorMsg = `Message error: ${chrome.runtime.lastError.message}`;
        console.error("🔴 [Content Script] ERROR:", errorMsg);
        alert(errorMsg);
        return;
      }
      if (res?.ok) {
        console.log("✅ [Content Script] SUCCESS - Saved to Obsidian:", payload.selectedText);
        // Show brief success indicator
        showNotification("✅ Saved to Obsidian!", payload.selectedText.substring(0, 50));
      } else {
        const errorMsg = `❌ Obsidian save failed: ${res?.error || "Unknown error"}`;
        console.error("🔴 [Content Script] FAILED:", errorMsg);
        alert(errorMsg + "\n\nCheck the browser console (F12) for more details.");
      }
    }
  );
}

// Chip UI for showing save status
function showChip(message, type = "info") {
  console.log("🔵 [Content Script] showChip called with:", message, type);

  // Remove existing chip if any
  const existingChip = document.getElementById("vocab-saver-chip");
  if (existingChip) existingChip.remove();

  const chip = document.createElement("div");
  chip.id = "vocab-saver-chip";
  chip.dataset.vocabExt = "1";

  const styles = {
    info: { bg: "#4285f4", icon: "⏳", text: "Saving..." },
    success: { bg: "#2E7D32", icon: "✅", text: "Saved!" },
    error: { bg: "#ea4335", icon: "❌", text: "Failed" }
  };

  const style = styles[type] || styles.info;
  chip.innerHTML = `<span>${message || style.text}</span><span style="margin-left:8px">${style.icon}</span>`;
  chip.style.cssText = `position:fixed; top:20px; right:20px; background:${style.bg}; color:#fff; padding:4px 16px; border-radius:100px; box-shadow:0 4px 12px rgba(0,0,0,0.15); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14px; font-weight:500; z-index:1000000; display:inline-flex; align-items:center; pointer-events:none;`;

  // Ensure animation styles exist
  if (!document.getElementById("vocab-saver-styles")) {
  const ss = document.createElement('style');
  ss.id = 'vocab-saver-styles';
  ss.dataset.vocabExt = "1";
  ss.textContent = `@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}`;
  document.head.appendChild(ss);
  }

  document.body.appendChild(chip);
  const delay = type === "error" ? 5000 : type === "success" ? 3000 : 2000;
  setTimeout(() => { chip.style.animation = 'slideOut 0.3s ease-out'; setTimeout(() => chip.remove(), 300); }, delay);
  return chip;
}

// Translation tooltip UI
let translationTooltip = null;
let translationTimeout = null;
let currentWord = null;
let lastHoveredWord = null;
// Selection translation timers/state
let translateTimer = null;
let lastSelectionText = "";
// Active tooltip tracking for click/selection hiding logic
let activeTooltipEl = null;
let activeSelectionText = "";

function showTranslationTooltip(arg, eOrX, maybeY) {
  // Accept either (word, translation, x, y) legacy signature or
  // ({word, meaning, isLoading}, event)
  let word, meaning, isLoading, x, y;
  let anchorRect = null;

  if (typeof arg === 'object' && arg !== null && arg.word) {
    word = arg.word;
    meaning = arg.meaning || '';
    isLoading = !!arg.isLoading;
    if (eOrX?.anchorRect) {
  anchorRect = eOrX.anchorRect;
} else if (eOrX && eOrX.clientX !== undefined) {
  x = eOrX.clientX;
  y = eOrX.clientY;
}

  } else {
    // legacy: showTranslationTooltip(word, translation, x, y)
    word = arg;
    meaning = eOrX || '';
    x = maybeY || 0; // in legacy calls maybeY is actually x, but keep best-effort
    y = arguments[3] || 0;
    isLoading = false;
  }
   


  console.log('🔵 [Content Script] showTranslationTooltip called for:', word, 'coords:', x, y, 'isLoading:', isLoading);
  if (translationTooltip) {
    // Reuse existing tooltip if same word (update will handle content)
    try {
      const contentEl = translationTooltip.querySelector('#vocab-tooltip-content');
      if (contentEl && contentEl.dataset && contentEl.dataset.word === word) {
        // Already showing the same word; update meaning or loading state
        updateTranslationTooltip({ word, meaning, isLoading });
        return;
      }
      translationTooltip.remove();
      translationTooltip = null;
    } catch (e) {
      translationTooltip = null;
    }
  }
  if (!word) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'vocab-translation-tooltip';
  tooltip.dataset.vocabExt = "1";
  // Start hidden/zeroed so we can measure and then position precisely
  tooltip.style.cssText = `position:fixed; left:0px; top:0px; background:rgba(0,0,0,0.85); color:white; border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,0.35); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif; z-index:1000001; pointer-events:auto; max-width:320px; backdrop-filter:blur(6px); padding:0; visibility:hidden;`;

  // Tweak visual properties to reduce the "covers text" feeling
  try {
    tooltip.style.maxWidth = "280px"; // stops huge blocks
    tooltip.style.pointerEvents = "auto"; // keeps it interactive/clickable
    tooltip.style.transformOrigin = "top center"; // nicer scale/animation origin
    tooltip.style.backdropFilter = "blur(6px)"; // subtle lift
  } catch (e) {}

  // Inner structure: content container + arrow
  const box = document.createElement('div');
  box.dataset.vocabExt = "1";
  box.style.cssText = 'border-radius:8px; overflow:hidden;';

  const content = document.createElement('div');
  content.id = 'vocab-tooltip-content';
  content.dataset.vocabExt = "1";
  content.dataset.word = word;
  content.style.cssText = 'padding:8px 12px; min-width:80px;';

  const arrow = document.createElement('div');
  arrow.id = 'vocab-tooltip-arrow';
  arrow.dataset.vocabExt = "1";
  // Arrow will be absolutely positioned relative to tooltip
  arrow.style.cssText = 'position:absolute; width:0; height:0; left:50%; transform:translateX(-50%);';

  function renderContentTo(el) {
    if (isLoading) {
      el.innerHTML = `<div style="font-size:12px;color:rgba(255,255,255,0.85);margin-bottom:6px">${word}</div><div style="font-size:14px;color:rgba(255,255,255,0.72)">Translating…</div>`;
    } else {
      el.innerHTML = `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:6px">${word}</div><div style="font-size:16px;font-weight:500;color:white">${meaning||''}</div>`;
    }
  }

  renderContentTo(content);
  box.appendChild(content);
  tooltip.appendChild(box);
  tooltip.appendChild(arrow);

  if (!document.getElementById('vocab-translation-styles')) {
  const s = document.createElement('style');
  s.id='vocab-translation-styles';
  s.dataset.vocabExt = "1";
  s.textContent = `@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}@keyframes fadeOut{from{opacity:1}to{opacity:0}}`;
  document.head.appendChild(s);
  }

  try {
    document.body.appendChild(tooltip);
    console.log('🔵 [Content Script] tooltip appended to body (hidden for measurement)');
  } catch (appendErr) {
    console.error('🔵 [Content Script] Failed to append tooltip to body:', appendErr);
    return;
  }

  translationTooltip = tooltip;
  try { activeTooltipEl = tooltip; } catch (e) {}

  // Measure and place: prefer above the cursor, fall back below if not enough space
  const rect = tooltip.getBoundingClientRect();
  const tooltipWidth = rect.width;
  const tooltipHeight = rect.height;
  const pad = 10;
  let left = (x || 0) - tooltipWidth / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tooltipWidth - pad));

  // Prefer above
  let top = (y || 0) - tooltipHeight - 12;
  let arrowUp = false; // arrow pointing down when tooltip is above
  if (top < 8) {
    // put below
    top = (y || 0) + 12;
    arrowUp = true; // arrow on top pointing up
  }
  // NEW: rect-based positioning
  if (anchorRect) {
  requestAnimationFrame(() => {
    positionTooltipNearRect(tooltip, anchorRect, 10);
    tooltip.style.visibility = 'visible';
    tooltip.style.animation = 'fadeIn 0.25s ease-out';
  });
  return;
}
  // Existing fallback (keep this)
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.visibility = 'visible';
  tooltip.style.animation = 'fadeIn 0.25s ease-out';

  // Position arrow
  const arrowSize = 8;
  arrow.style.top = arrowUp ? '0px' : `calc(100% - 1px)`;
  if (arrowUp) {
    // small upward-pointing triangle at top
    arrow.style.borderLeft = `${arrowSize}px solid transparent`;
    arrow.style.borderRight = `${arrowSize}px solid transparent`;
    arrow.style.borderBottom = `${arrowSize}px solid rgba(0,0,0,0.85)`;
    arrow.style.transform = 'translateX(-50%) translateY(-50%)';
  } else {
    // downward-pointing triangle at bottom
    arrow.style.borderLeft = `${arrowSize}px solid transparent`;
    arrow.style.borderRight = `${arrowSize}px solid transparent`;
    arrow.style.borderTop = `${arrowSize}px solid rgba(0,0,0,0.85)`;
    arrow.style.transform = 'translateX(-50%) translateY(50%)';
  }

  if (translationTimeout) clearTimeout(translationTimeout);
  // If not loading, auto-hide after a short while
  if (!isLoading) translationTimeout = setTimeout(() => hideTranslationTooltip(), 3000);
}

// Positioning helper: place tooltip near an anchor rect (selection bounding rect)
function positionTooltipNearRect(tooltipEl, anchorRect, gap = 10, margin = 8) {
  try {
    // Measure tooltip (must be in DOM to measure)
    const tt = tooltipEl.getBoundingClientRect();

    // Prefer above the selection
    let top = anchorRect.top - tt.height - gap;

    // If not enough space above, place below
    if (top < margin) {
      top = anchorRect.bottom + gap;
    }

    // If still overflows bottom, clamp
    const maxTop = window.innerHeight - tt.height - margin;
    top = Math.min(Math.max(top, margin), maxTop);

    // Center horizontally relative to selection
    let left = anchorRect.left + (anchorRect.width / 2) - (tt.width / 2);

    // Clamp left/right within viewport
    const maxLeft = window.innerWidth - tt.width - margin;
    left = Math.min(Math.max(left, margin), maxLeft);

    // Apply (use fixed positioning for viewport anchoring)
    tooltipEl.style.position = "fixed";
    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  } catch (e) {
    // fail silently — positioning is best-effort
  }
}

function updateTranslationTooltip(payload) {
  // payload: { word, meaning, isLoading }
  try {
    if (!translationTooltip) return;
    if (!payload || !payload.word) return;
    const contentEl = translationTooltip.querySelector('#vocab-tooltip-content');
    if (!contentEl) return;
    // Only update if the existing tooltip matches this word
    if (contentEl.dataset && contentEl.dataset.word && contentEl.dataset.word !== payload.word) return;
    contentEl.dataset.word = payload.word;
    if (payload.isLoading) {
      contentEl.innerHTML = `<div style="font-size:12px;color:rgba(255,255,255,0.85);margin-bottom:6px">${payload.word}</div><div style="font-size:14px;color:rgba(255,255,255,0.72)">Translating…</div>`;
    } else {
      contentEl.innerHTML = `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:6px">${payload.word}</div><div style="font-size:16px;font-weight:500;color:white">${payload.meaning||''}</div>`;
    }

    // Reflow position in case size changed
    try {
      const rect = translationTooltip.getBoundingClientRect();
      const tooltipWidth = rect.width;
      const tooltipHeight = rect.height;
      // Attempt to keep the tooltip centered on previous coordinates (if available)
      // We'll clamp within viewport
      let left = parseInt(translationTooltip.style.left || '0', 10);
      left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));
      let top = parseInt(translationTooltip.style.top || '0', 10);
      if (top < 8) top = 8;
      translationTooltip.style.left = `${Math.round(left)}px`;
      translationTooltip.style.top = `${Math.round(top)}px`;
    } catch (e) {}

    if (translationTimeout) { clearTimeout(translationTimeout); translationTimeout = null; }
    if (!payload.isLoading) translationTimeout = setTimeout(() => hideTranslationTooltip(), 3500);
  } catch (err) {
    console.warn('🔵 [Content Script] updateTranslationTooltip error:', err);
  }
}
function hideTranslationTooltip() {
  console.log('🔵 [Content Script] hideTranslationTooltip called');
  if (!translationTooltip) return;
  try { translationTooltip.style.animation = 'fadeOut 0.12s ease-out'; setTimeout(() => { if (translationTooltip) { translationTooltip.remove(); translationTooltip = null; } }, 120); } catch (e) { try { translationTooltip.remove(); } catch (e2) {} translationTooltip = null; }
  if (translationTimeout) { clearTimeout(translationTimeout); translationTimeout = null; }
  currentWord = null;
  lastSelectionText = "";
  activeSelectionText = "";

}

// Hide active tooltip (used by outside click/selection-change handlers)
function hideActiveTooltip() {
  try {
    // Use the animated hide if possible
    hideTranslationTooltip();
  } catch (e) {}
  try { if (activeTooltipEl) activeTooltipEl.remove(); } catch (e) {}
  activeTooltipEl = null;
  activeSelectionText = "";
}

// Cleanup any UI this extension injected into the page.
function cleanupInjectedUI() {
  try {
    // 1) Remove tooltip/panels/popovers (anything you injected)
    document.querySelectorAll('[data-vocab-ext="1"]').forEach(el => el.remove());

    // 2) Remove overlays by known IDs if you used them
    document.getElementById("vocab-translation-tooltip")?.remove();
    document.getElementById("vocab-panel")?.remove();
    document.getElementById("vocab-selection-popover")?.remove();

    // 3) Unwrap word spans (if you wrapped words)
    // If you ever wrap words like <span class="lr-word">text</span>, unwrap them:
    document.querySelectorAll("span.vocab-word, span.lr-word, span[data-vocab-word]").forEach(span => {
      try {
        const text = document.createTextNode(span.textContent || "");
        span.replaceWith(text);
      } catch (e) {}
    });

    // 4) Clear selection (optional but feels clean)
    try { window.getSelection()?.removeAllRanges?.(); } catch (e) {}
  } catch (err) {
    console.warn('🔵 [Content Script] cleanupInjectedUI error:', err);
  }
}

// Helper: get selection bounding rect and text
function getSelectionInfo() {
  try {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;

    // Optional: avoid translating super long selections
    // if (text.length > 120) return null;

    return { text, rect };
  } catch (e) {
    return null;
  }
}

// Helper: check if selection is a single sentence (guardrail)
function isSingleSentence(text) {
  if (!text) return false;

  // Normalize whitespace
  const cleaned = text.replace(/\s+/g, " ").trim();

  // Count sentence-ending punctuation
  const sentenceEndings = cleaned.match(/[.!?。？！]/g) || [];

  return sentenceEndings.length <= 1;
}

// Request translation for a given selection/text and show tooltip
async function requestTranslation(text, coords) {
  if (!text || !text.trim()) return;
  // Prevent repeating the same translation (compare full selection)
  if (text === lastSelectionText) return;
  lastSelectionText = text;
  const word = text.trim();

  // Determine coords from selection if not provided
  let clientX = window.innerWidth / 2;
  let clientY = window.innerHeight / 2;
  let selInfo = null;
  if (coords && coords.clientX !== undefined) {
    clientX = coords.clientX; clientY = coords.clientY;
  } else {
    selInfo = getSelectionInfo();
    if (selInfo && selInfo.rect) {
      clientX = selInfo.rect.left + selInfo.rect.width / 2;
      clientY = selInfo.rect.bottom;
    }
  }

  
  try { activeSelectionText = (text || '').toString().trim(); } catch (e) {}

  try {
    const selInfo = getSelectionInfo();
    const anchorRect = selInfo?.rect;

    const translation = await translateWord(word);
    if (translation) {
      try { localTranslationCache.set(word, translation); } catch (e) {}
      showTranslationTooltip({ word: text, meaning: translation, isLoading: false }, { anchorRect: selInfo?.rect }

      );
    
  

    } else {
      showTranslationTooltip({ word: text, meaning: '—', isLoading: false }, { anchorRect: selInfo?.rect }
    );

      setTimeout(() => hideTranslationTooltip(), 1200);
    }
  } catch (err) {
    console.error('🔵 [Content Script] requestTranslation error:', err);
    showTranslationTooltip(
  { word: text, meaning: "Error", isLoading: false },
  { anchorRect }
);


    setTimeout(() => hideTranslationTooltip(), 1500);
  }
}

function showNotification(message, body) {
  // Try to show a browser notification
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(message, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='50' font-size='50'>📝</text></svg>" });
  } else if ("Notification" in window && Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        new Notification(message, { body });
      }
    });
  }
}



// Translation cache to avoid repeated API calls
const translationCache = new Map();
// Small in-memory cache local to the content script to avoid re-requesting
// translations during the same page session.
const localTranslationCache = new Map();

// Translate word to Chinese (with improved diagnostics and fallback)
async function translateWord(word) {
  if (!word || word.trim().length === 0) return null;

  const cleanWord = word.trim().toLowerCase();

  // Skip if it's already Chinese or too short
  if (cleanWord.length < 2) return null;

  // Check cache first
  if (translationCache.has(cleanWord)) {
    return translationCache.get(cleanWord);
  }

  // Try background proxy first using a long-lived port (more reliable than sendMessage)
  // Try background proxy first using a long-lived port (more reliable than sendMessage)
  try {
    console.log("🔁 [Translate] Attempting background proxy for:", cleanWord);
    if (chrome && chrome.runtime && chrome.runtime.connect) {
      // Attempt to connect & request translation with retries in case the service worker was restarting
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const port = chrome.runtime.connect({ name: 'vocab-translate-port' });
          const translationFromBg = await new Promise((resolve) => {
            let settled = false;
            const timeout = setTimeout(() => {
              if (!settled) {
                settled = true;
                try { port.disconnect(); } catch (e) {}
                resolve(null);
              }
            }, 3000); // 3s timeout

            port.onMessage.addListener((msg) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              try { port.disconnect(); } catch (e) {}
              if (msg && msg.translation) {
                resolve(msg.translation);
              } else {
                resolve(null);
              }
            });

            // Send request
            try {
              port.postMessage({ type: 'TRANSLATE_REQUEST', word: cleanWord });
            } catch (e) {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                try { port.disconnect(); } catch (ee) {}
                resolve(null);
              }
            }
          });

          if (translationFromBg) {
            translationCache.set(cleanWord, translationFromBg);
            return translationFromBg;
          }
        } catch (connErr) {
          console.warn(`🔁 [Translate] port attempt ${attempt} failed:`, connErr?.message || connErr);
        }

        // Short backoff before retrying
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  } catch (bgErr) {
    console.warn('🔁 [Translate] Background translate proxy failed (outer):', bgErr);
  }

  // Primary attempt: Google Translate (public endpoint)
  const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(cleanWord)}`;

  try {
    console.log("🔁 [Translate] Attempting Google Translate for:", cleanWord, googleUrl);
    const response = await fetch(googleUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    console.log("🔁 [Translate] Google response status:", response.status);

    if (response.ok) {
      const data = await response.json().catch((e) => {
        console.error("🔁 [Translate] Failed to parse Google JSON:", e);
        return null;
      });

      if (data && data[0] && data[0][0] && data[0][0][0]) {
        const translation = data[0][0][0];
        translationCache.set(cleanWord, translation);
        return translation;
      }
      console.warn("🔁 [Translate] Google returned unexpected shape:", data);
    } else {
      // Read body for diagnostics (best-effort)
      const text = await response.text().catch(() => "");
      console.warn("🔁 [Translate] Google translate non-OK response:", response.status, text.substring(0, 200));
    }
  } catch (err) {
    console.error("🔁 [Translate] Google translate fetch failed:", err);
  }

  // Fallback: LibreTranslate public instance (may or may not be available)
  try {
    const libreUrl = 'https://libretranslate.de/translate';
    console.log("🔁 [Translate] Trying fallback LibreTranslate for:", cleanWord);
    const res2 = await fetch(libreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: cleanWord, source: 'auto', target: 'zh', format: 'text' }),
    });

    console.log("🔁 [Translate] LibreTranslate response status:", res2.status);
    if (res2.ok) {
      const j = await res2.json().catch((e) => {
        console.error("🔁 [Translate] Failed to parse LibreTranslate JSON:", e);
        return null;
      });
      if (j && j.translatedText) {
        translationCache.set(cleanWord, j.translatedText);
        return j.translatedText;
      }
      console.warn("🔁 [Translate] LibreTranslate returned unexpected shape:", j);
    } else {
      const txt = await res2.text().catch(() => '');
      console.warn("🔁 [Translate] LibreTranslate non-OK:", res2.status, txt.substring(0, 200));
    }
  } catch (err2) {
    console.error("🔁 [Translate] LibreTranslate fetch failed:", err2);
  }

  // If all attempts failed, return null
  return null;
}

// Get word at cursor position - improved accuracy
function getWordAtPoint(x, y) {
  let range = null;
  
  // Use the most accurate method available
  if (document.caretRangeFromPoint) {
    // Chrome, Safari, Edge
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    // Firefox
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }
  
  if (!range) return null;
  
  // Get the text node and offset
  const textNode = range.startContainer;
  if (textNode.nodeType !== Node.TEXT_NODE) return null;
  
  const text = textNode.textContent;
  const offset = range.startOffset;
  
  // Find word boundaries
  // Word characters: letters, numbers, hyphens, apostrophes
  const wordRegex = /[a-zA-Z0-9\-']+/g;
  let match;
  
  while ((match = wordRegex.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    
    // Check if cursor is within this word
    if (offset >= start && offset <= end) {
      const word = match[0];
      // Only return if it's a valid word (at least 2 characters)
      if (word.length >= 2) {
        return word;
      }
    }
  }
  
  return null;
}

// Initialize selection-based translation: translate only when the user
// explicitly selects text (mouse selection or keyboard selection).
// translateSelectedText is used by event handlers below (attached/detached via attachTranslationListeners)
function translateSelectedText(trigger) {
  const info = getSelectionInfo();
  if (!info) return;

  const { text, rect } = info;

  // Guardrail: only translate one sentence
  if (!isSingleSentence(text)) {
    showTranslationTooltip(
      { word: "⚠️ Too much text", meaning: "Please select only one sentence at a time.", isLoading: false },
      { anchorRect: rect }
    );
    setTimeout(() => hideTranslationTooltip(), 2500);
    return;
  }

  // Mark active selection text for hide/dedupe logic
  try { activeSelectionText = text; } catch (e) {}


  // Request translation via shared function
  requestTranslation(text, { clientX: rect.left + rect.width / 2, clientY: rect.bottom });
}

// --- Runtime toggle state and attach/detach listener wiring ---
let translationEnabled = true;
let listenersAttached = false;
// mirrored generic flags for external callers
let enabled = true;
let attached = false;

function enableTranslation() {
  translationEnabled = true;
  if (!listenersAttached) {
    attachTranslationListeners();
    listenersAttached = true;
    attached = true;
  }
  enabled = true;
}

function disableTranslation() {
  translationEnabled = false;
  detachTranslationListeners();
  listenersAttached = false;
  try { hideTranslationTooltip?.(); } catch (e) {}
  attached = false;
  enabled = false;
}

function attachAllListeners() {
  // convenience wrapper
  attachTranslationListeners();
}

function detachAllListeners() {
  // convenience wrapper
  detachTranslationListeners();
}

function disableAll() {
  enabled = false;

  // Stop responding immediately
  detachAllListeners();

  // Remove everything already injected
  cleanupInjectedUI();

  attached = false;
}

function enableAll() {
  enabled = true;
  if (!attached) {
    attachAllListeners();
    attached = true;
  }
}

// Event handlers (keep references so removeEventListener works)
function onMouseUp(e) {
  if (!enabled) return;
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => translateSelectedText("mouseup"), 0);
}

function onSelectionChange(e) {
  if (!enabled) return;
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => translateSelectedText("selectionchange"), 120);

  // Active tooltip selection-change detection (previously a separate listener)
  if (!activeTooltipEl) return;
  clearTimeout(selHideTimer);
  selHideTimer = setTimeout(() => {
    const text = window.getSelection()?.toString().trim() || "";
    if (!text) {
      hideActiveTooltip();
      return;
    }
    if (text !== activeSelectionText) {
      hideActiveTooltip();
    }
  }, 80);
}

function onMouseDown(e) {
  if (!enabled) return;
  // If tooltip not open, ignore the click-outside handling below
  if (!activeTooltipEl && !translationTooltip) return;

  // Click inside tooltip -> keep
  if (e.target?.closest?.("#vocab-translation-tooltip")) return;

  // Otherwise hide active tooltip immediately
  hideActiveTooltip();

  // If selection collapses after click, hide selection tooltip
  setTimeout(() => {
    const selText = window.getSelection()?.toString().trim();
    if (!selText) {
      lastSelectionText = "";
      hideTranslationTooltip();
    }
  }, 0);
}

function onKeyDown(e) { if (e.key === "Escape") { lastSelectionText = ""; hideTranslationTooltip(); try { window.getSelection()?.removeAllRanges?.(); } catch (e) {} } }
function onScroll() { hideTranslationTooltip(); }

function attachTranslationListeners() {
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("scroll", onScroll, { passive: true });
}

function detachTranslationListeners() {
  document.removeEventListener("mouseup", onMouseUp);
  document.removeEventListener("selectionchange", onSelectionChange);
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("mousedown", onMouseDown);
  document.removeEventListener("scroll", onScroll, { passive: true });
}

// Initialize enabled/disabled based on storage and listen for background toggle
chrome.storage.sync.get({ enableExtension: true }, (res) => {
  try {
    if (res.enableExtension) enableTranslation(); else disableTranslation();
  } catch (e) { enableTranslation(); }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "EXTENSION_TOGGLE") {
    msg.enabled ? enableAll() : disableAll();
  }
});

// (scroll/keydown handlers for selection are attached inside initSelectionTranslation)

// Active tooltip hide helpers: outside click and live selection-change detection
let selHideTimer = null;
// click/selection-change hide behavior is now handled inside attachTranslationListeners

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("🔵 [Content Script] Message received from background:", msg);
  
  if (msg?.type === "SAVE_TO_OBSIDIAN") {
    if (!enabled) {
      console.log("🔵 [Content Script] Ignoring SAVE_TO_OBSIDIAN because extension is disabled");
      return;
    }
    console.log("🔵 [Content Script] Processing SAVE_TO_OBSIDIAN request");
    console.log("🔵 [Content Script] Selected text from message:", msg.selectedText);
    sendSaveToObsidian(msg.selectedText);
  } else if (msg?.type === "SHOW_CHIP") {
    // Show chip UI based on status
    console.log("🔵 [Content Script] Received SHOW_CHIP message:", msg);
    console.log("🔵 [Content Script] Showing chip with message:", msg.message, "type:", msg.chipType);
    showChip(msg.message, msg.chipType || "info");
    console.log("🔵 [Content Script] Chip should be visible now");
  } else {
    console.log("🔵 [Content Script] Ignoring message type:", msg?.type);
   }
 });
 
 // Handle one-off translate requests from background (context menu)
 chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
   if (msg?.type === 'TRANSLATE_SELECTION') {
     try {
      if (!enabled) { sendResponse({ ok: false, error: 'Extension is OFF' }); return; }
       const selected = msg.selectedText || getSelectedText();
       const word = (selected || '').split(/\s+/)[0] || selected;
       console.log('🔵 [Content Script] TRANSLATE_SELECTION for:', word);
  const translation = await translateWord(word);
  try { if (translation) localTranslationCache.set(word, translation); } catch (e) {}
  showTranslationTooltip({ word, meaning: translation || '—', isLoading: false }, { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
  try { activeSelectionText = (selected || '').toString().trim(); } catch (e) {}
       sendResponse({ ok: true, translation });
     } catch (err) {
       console.error('🔵 [Content Script] TRANSLATE_SELECTION error:', err);
       sendResponse({ ok: false, error: String(err) });
     }
     return true;
   }
 });

  } // end initTranslation
