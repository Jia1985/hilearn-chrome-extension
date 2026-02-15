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

// Vocab detail popup state
let vocabDetailPopup = null;
let popupOpen = false;
let tooltipHovered = false;

// HTML escape helper
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  // Make tooltip interactive: hover to keep open, click to open detail popup
  tooltip.style.cursor = 'pointer';
  tooltip.addEventListener('mouseenter', () => {
    tooltipHovered = true;
    if (translationTimeout) { clearTimeout(translationTimeout); translationTimeout = null; }
    showClickHint(tooltip);
  });
  tooltip.addEventListener('mouseleave', () => {
    tooltipHovered = false;
    if (!popupOpen) {
      translationTimeout = setTimeout(() => hideTranslationTooltip(), 1500);
    }
  });
  // Stop mousedown from propagating so document-level handlers don't interfere
  tooltip.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const wordEl = tooltip.querySelector('#vocab-tooltip-content');
    const clickedWord = wordEl?.dataset?.word;
    if (clickedWord) {
      openVocabDetailPopup(clickedWord, tooltip);
    }
  });

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
    document.getElementById("vocab-detail-popup")?.remove();
    document.getElementById("vocab-panel")?.remove();
    document.getElementById("vocab-selection-popover")?.remove();
    vocabDetailPopup = null;
    popupOpen = false;

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

// --- Vocab Detail Popup ---

// Fetch detailed vocab data from background service worker
async function fetchVocabDetail(word) {
  if (!word) return null;
  const cleanWord = word.trim().toLowerCase();

  // Try port-based communication first
  try {
    if (chrome?.runtime?.connect) {
      const port = chrome.runtime.connect({ name: 'vocab-detail-port' });
      const detail = await new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) { settled = true; try { port.disconnect(); } catch {} resolve(null); }
        }, 5000);

        port.onMessage.addListener((msg) => {
          if (settled) return;
          if (msg?.type === 'VOCAB_DETAIL_RESULT') {
            settled = true;
            clearTimeout(timeout);
            try { port.disconnect(); } catch {}
            resolve(msg.detail || null);
          }
        });

        port.postMessage({ type: 'FETCH_VOCAB_DETAIL', word: cleanWord });
      });

      if (detail) return detail;
    }
  } catch (e) {
    console.warn('[Content] fetchVocabDetail port failed:', e);
  }

  // Fallback: sendMessage
  try {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_VOCAB_DETAIL', word: cleanWord },
        (response) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response?.detail || null);
        }
      );
    });
  } catch (e) {
    console.warn('[Content] fetchVocabDetail sendMessage failed:', e);
    return null;
  }
}

// Popup HTML: loading state
function buildPopupLoadingHTML(word) {
  return `
    <div style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:20px; font-weight:600;">${escapeHTML(word)}</div>
      <div class="vocab-popup-close" style="cursor:pointer; font-size:20px; color:rgba(255,255,255,0.5); padding:4px 8px; line-height:1;">&times;</div>
    </div>
    <div style="padding:32px 20px; text-align:center; color:rgba(255,255,255,0.5); font-size:13px;">
      <div style="margin-bottom:8px; font-size:18px;">⏳</div>
      Loading details...
    </div>
  `;
}

// Popup HTML: error state
function buildPopupErrorHTML(word, errorMsg) {
  return `
    <div style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:20px; font-weight:600;">${escapeHTML(word)}</div>
      <div class="vocab-popup-close" style="cursor:pointer; font-size:20px; color:rgba(255,255,255,0.5); padding:4px 8px; line-height:1;">&times;</div>
    </div>
    <div style="padding:24px 20px; text-align:center; color:rgba(255,255,255,0.45); font-size:13px;">
      ${escapeHTML(errorMsg)}
    </div>
  `;
}

// Popup HTML: full content with tabs
function buildPopupContentHTML(detail) {
  const phoneticHTML = detail.phonetic
    ? `<span style="font-size:13px; color:rgba(255,255,255,0.45); margin-left:8px; font-weight:400;">/${escapeHTML(detail.phonetic)}/</span>`
    : '';

  const speakerHTML = `<span class="vocab-popup-speaker" style="cursor:pointer; margin-left:8px; font-size:16px; color:rgba(255,255,255,0.5); transition:color 0.15s;" title="Listen">🔊</span>`;

  // Build definitions pane
  let defsHTML = '';
  if (detail.definitions && detail.definitions.length > 0) {
    for (const def of detail.definitions) {
      defsHTML += `<div style="margin-bottom:14px;">`;
      defsHTML += `<span style="display:inline-block; background:rgba(66,133,244,0.15); color:#8ab4f8; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:500; letter-spacing:0.3px; text-transform:lowercase;">${escapeHTML(def.pos)}</span>`;
      if (def.definition) {
        defsHTML += `<div style="font-size:13px; color:rgba(255,255,255,0.6); margin:6px 0 2px; line-height:1.4;">${escapeHTML(def.definition)}</div>`;
      }
      if (def.meanings && def.meanings.length > 0) {
        defsHTML += `<div style="font-size:14px; color:rgba(255,255,255,0.95); margin-top:4px; line-height:1.5;">${def.meanings.map(m => escapeHTML(m)).join('，')}</div>`;
      }
      defsHTML += `</div>`;
    }
  } else {
    defsHTML = `<div style="color:rgba(255,255,255,0.35); font-size:13px; padding:12px 0;">No definitions available.</div>`;
  }

  // Build examples pane
  let examplesHTML = '';
  if (detail.examples && detail.examples.length > 0) {
    for (const ex of detail.examples) {
      // ex contains <b> tags around the word — sanitize but keep <b>
      const sanitized = ex.replace(/<(?!\/?b>)[^>]*>/gi, '');
      examplesHTML += `<div style="margin-bottom:10px; padding:10px 12px; background:rgba(255,255,255,0.03); border-left:2px solid rgba(66,133,244,0.3); border-radius:0 6px 6px 0; font-size:13px; color:rgba(255,255,255,0.8); line-height:1.6;">${sanitized}</div>`;
    }
  } else {
    examplesHTML = `<div style="color:rgba(255,255,255,0.35); font-size:13px; padding:12px 0;">No examples available.</div>`;
  }

  // Build phrases/synonyms pane
  let phrasesHTML = '';
  if (detail.synonyms && detail.synonyms.length > 0) {
    phrasesHTML += `<div style="font-size:11px; color:rgba(255,255,255,0.35); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Synonyms</div>`;
    for (const synGroup of detail.synonyms) {
      phrasesHTML += `<div style="margin-bottom:12px;">`;
      phrasesHTML += `<span style="display:inline-block; background:rgba(66,133,244,0.15); color:#8ab4f8; padding:2px 8px; border-radius:4px; font-size:11px; margin-bottom:6px;">${escapeHTML(synGroup.pos)}</span>`;
      phrasesHTML += `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:6px;">`;
      for (const w of synGroup.words) {
        phrasesHTML += `<span style="background:rgba(255,255,255,0.06); padding:4px 10px; border-radius:12px; font-size:12px; color:rgba(255,255,255,0.75);">${escapeHTML(w)}</span>`;
      }
      phrasesHTML += `<div></div>`;
    }
  }
  if (detail.alternatives && detail.alternatives.length > 0) {
    phrasesHTML += `<div style="margin-top:${detail.synonyms?.length ? '16' : '0'}px;"><div style="font-size:11px; color:rgba(255,255,255,0.35); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Alternative translations</div>`;
    phrasesHTML += `<div style="display:flex; flex-wrap:wrap; gap:6px;">`;
    for (const alt of detail.alternatives) {
      phrasesHTML += `<span style="background:rgba(255,255,255,0.06); padding:4px 10px; border-radius:12px; font-size:13px; color:rgba(255,255,255,0.75);">${escapeHTML(alt)}</span>`;
    }
    phrasesHTML += `<div></div>`;
  }
  if (!phrasesHTML) {
    phrasesHTML = `<div style="color:rgba(255,255,255,0.35); font-size:13px; padding:12px 0;">No phrases available.</div>`;
  }

  return `
    <div style="padding:14px 18px 10px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
        <span style="font-size:20px; font-weight:600;">${escapeHTML(detail.word)}</span>
        ${phoneticHTML}
        ${speakerHTML}
      </div>
      <div class="vocab-popup-close" style="cursor:pointer; font-size:20px; color:rgba(255,255,255,0.5); padding:4px 8px; line-height:1; flex-shrink:0;">&times;</div>
    </div>
    <div style="padding:8px 18px 10px; font-size:15px; color:rgba(255,255,255,0.85); border-bottom:1px solid rgba(255,255,255,0.06);">
      ${escapeHTML(detail.translation)}
    </div>
    <div class="vocab-popup-tabs" style="display:flex; border-bottom:1px solid rgba(255,255,255,0.06); padding:0 14px; gap:0;">
      <div class="vocab-tab active" data-tab="definitions" style="padding:9px 12px; font-size:13px; cursor:pointer; color:rgba(255,255,255,0.9); border-bottom:2px solid #8ab4f8; margin-bottom:-1px; transition:color 0.15s;">解释</div>
      <div class="vocab-tab" data-tab="examples" style="padding:9px 12px; font-size:13px; cursor:pointer; color:rgba(255,255,255,0.45); border-bottom:2px solid transparent; margin-bottom:-1px; transition:color 0.15s;">例子</div>
      <div class="vocab-tab" data-tab="phrases" style="padding:9px 12px; font-size:13px; cursor:pointer; color:rgba(255,255,255,0.45); border-bottom:2px solid transparent; margin-bottom:-1px; transition:color 0.15s;">常用短语</div>
    </div>
    <div class="vocab-popup-tab-content" style="padding:14px 18px; overflow-y:auto; flex:1; max-height:260px;">
      <div class="vocab-tab-pane" data-pane="definitions">${defsHTML}</div>
      <div class="vocab-tab-pane" data-pane="examples" style="display:none;">${examplesHTML}</div>
      <div class="vocab-tab-pane" data-pane="phrases" style="display:none;">${phrasesHTML}</div>
    </div>
    <div style="padding:10px 18px 14px; border-top:1px solid rgba(255,255,255,0.06);">
      <button class="vocab-save-obsidian" style="width:100%; padding:8px 0; background:rgba(66,133,244,0.1); color:#8ab4f8; border:1px solid rgba(66,133,244,0.25); border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; font-family:inherit; transition:all 0.15s;">Save to Obsidian</button>
    </div>
  `;
}

// Text-to-Speech
function speakWord(word) {
  if (!word) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('[Content] speechSynthesis failed:', e);
  }
}

// Build enriched save text from vocab detail
function buildObsidianSaveText(detail) {
  let text = detail.word;
  if (detail.phonetic) text += ` /${detail.phonetic}/`;
  text += ` — ${detail.translation}`;
  if (detail.definitions && detail.definitions.length > 0) {
    const defSummary = detail.definitions
      .map(d => `(${d.pos}) ${d.meanings.join(', ')}`)
      .join('; ');
    text += ` | ${defSummary}`;
  }
  return text;
}

// Attach interactions to the popup (tabs, TTS, save, close)
function attachPopupInteractions(popup, detail) {
  // Close button
  popup.querySelector('.vocab-popup-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideVocabDetailPopup();
  });

  // Tab switching
  const tabs = popup.querySelectorAll('.vocab-tab');
  const panes = popup.querySelectorAll('.vocab-tab-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabName = tab.dataset.tab;
      tabs.forEach(t => {
        t.style.color = 'rgba(255,255,255,0.45)';
        t.style.borderBottomColor = 'transparent';
        t.classList.remove('active');
      });
      tab.style.color = 'rgba(255,255,255,0.9)';
      tab.style.borderBottomColor = '#8ab4f8';
      tab.classList.add('active');
      panes.forEach(p => {
        p.style.display = p.dataset.pane === tabName ? '' : 'none';
      });
    });
  });

  // Text-to-Speech
  const speaker = popup.querySelector('.vocab-popup-speaker');
  if (speaker) {
    speaker.addEventListener('click', (e) => {
      e.stopPropagation();
      speakWord(detail.word);
    });
    speaker.addEventListener('mouseenter', () => { speaker.style.color = 'rgba(255,255,255,0.85)'; });
    speaker.addEventListener('mouseleave', () => { speaker.style.color = 'rgba(255,255,255,0.5)'; });
  }

  // Save to Obsidian
  const saveBtn = popup.querySelector('.vocab-save-obsidian');
  if (saveBtn) {
    saveBtn.addEventListener('mouseenter', () => {
      saveBtn.style.background = 'rgba(66,133,244,0.2)';
    });
    saveBtn.addEventListener('mouseleave', () => {
      saveBtn.style.background = 'rgba(66,133,244,0.1)';
    });
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const saveText = buildObsidianSaveText(detail);
      sendSaveToObsidian(saveText);
      saveBtn.textContent = '✓ Saved!';
      saveBtn.style.background = 'rgba(46,125,50,0.2)';
      saveBtn.style.color = '#81c784';
      saveBtn.style.borderColor = 'rgba(46,125,50,0.4)';
      setTimeout(() => {
        if (saveBtn.isConnected) {
          saveBtn.textContent = 'Save to Obsidian';
          saveBtn.style.background = 'rgba(66,133,244,0.1)';
          saveBtn.style.color = '#8ab4f8';
          saveBtn.style.borderColor = 'rgba(66,133,244,0.25)';
        }
      }, 2000);
    });
  }

  // Prevent events from propagating to page
  popup.addEventListener('mousedown', (e) => e.stopPropagation());
  popup.addEventListener('click', (e) => e.stopPropagation());
}

// Position popup using a pre-captured anchor rect (or center on screen)
function positionPopupWithRect(popupEl, anchorRect) {
  requestAnimationFrame(() => {
    const popupRect = popupEl.getBoundingClientRect();
    const margin = 12;

    if (anchorRect && anchorRect.width > 0) {
      // Prefer below the anchor
      let top = anchorRect.bottom + 8;
      let left = anchorRect.left + (anchorRect.width / 2) - (popupRect.width / 2);

      // If not enough space below, try above
      if (top + popupRect.height > window.innerHeight - margin) {
        top = anchorRect.top - popupRect.height - 8;
      }
      // If still no space, center vertically
      if (top < margin) {
        top = Math.max(margin, (window.innerHeight - popupRect.height) / 2);
      }

      // Clamp horizontally
      left = Math.max(margin, Math.min(left, window.innerWidth - popupRect.width - margin));

      popupEl.style.left = `${Math.round(left)}px`;
      popupEl.style.top = `${Math.round(top)}px`;
    } else {
      // Center on screen
      popupEl.style.left = `${Math.round((window.innerWidth - popupRect.width) / 2)}px`;
      popupEl.style.top = `${Math.round((window.innerHeight - popupRect.height) / 2)}px`;
    }
  });
}

// Hide and remove the vocab detail popup
function hideVocabDetailPopup() {
  if (!vocabDetailPopup) return;
  try {
    vocabDetailPopup.style.animation = 'fadeOut 0.15s ease-out';
    const ref = vocabDetailPopup;
    setTimeout(() => {
      try { ref.remove(); } catch {}
    }, 150);
  } catch (e) {
    try { vocabDetailPopup.remove(); } catch {}
  }
  vocabDetailPopup = null;
  popupOpen = false;
}

// Open the vocab detail popup
async function openVocabDetailPopup(word, tooltipEl) {
  console.log('[Vocab] openVocabDetailPopup called for:', word);
  if (popupOpen) hideVocabDetailPopup();

  // Cancel tooltip auto-hide
  if (translationTimeout) { clearTimeout(translationTimeout); translationTimeout = null; }

  // Capture tooltip position BEFORE we hide it (since hide removes it from DOM)
  let tooltipRect = null;
  if (tooltipEl && tooltipEl.isConnected) {
    try { tooltipRect = tooltipEl.getBoundingClientRect(); } catch (e) {}
  }

  // Create popup container
  const popup = document.createElement('div');
  popup.id = 'vocab-detail-popup';
  popup.dataset.vocabExt = '1';
  popup.style.cssText = `
    position: fixed;
    z-index: 1000002;
    background: rgba(20, 20, 24, 0.96);
    color: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif;
    max-width: 420px;
    min-width: 300px;
    width: 380px;
    max-height: 480px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(12px);
    animation: fadeIn 0.2s ease-out;
    pointer-events: auto;
    visibility: hidden;
  `;

  // Show loading state
  popup.innerHTML = buildPopupLoadingHTML(word);
  document.body.appendChild(popup);

  vocabDetailPopup = popup;
  popupOpen = true;

  // Position using the captured tooltip rect
  positionPopupWithRect(popup, tooltipRect);
  popup.style.visibility = 'visible';

  // Close button handler for loading state
  popup.querySelector('.vocab-popup-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideVocabDetailPopup();
  });
  popup.addEventListener('mousedown', (e) => e.stopPropagation());
  popup.addEventListener('click', (e) => e.stopPropagation());

  // Hide the tooltip now
  hideTranslationTooltip();

  // Fetch detailed data
  try {
    const detail = await fetchVocabDetail(word);
    if (!vocabDetailPopup || !popupOpen) return; // popup was closed during fetch

    if (detail) {
      popup.innerHTML = buildPopupContentHTML(detail);
      attachPopupInteractions(popup, detail);
      // Re-position after content change (size may differ)
      positionPopupWithRect(popup, tooltipRect);
    } else {
      popup.innerHTML = buildPopupErrorHTML(word, 'Could not fetch detailed information.');
      popup.querySelector('.vocab-popup-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideVocabDetailPopup();
      });
    }
  } catch (err) {
    if (vocabDetailPopup && popupOpen) {
      popup.innerHTML = buildPopupErrorHTML(word, String(err));
      popup.querySelector('.vocab-popup-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideVocabDetailPopup();
      });
    }
  }
}

// Show "Click for details" hint on tooltip hover
function showClickHint(tooltipEl) {
  if (tooltipEl.querySelector('.vocab-click-hint')) return;
  const hint = document.createElement('div');
  hint.className = 'vocab-click-hint';
  hint.dataset.vocabExt = '1';
  hint.style.cssText = 'font-size:10px; color:#8ab4f8; text-align:center; padding:3px 0 5px; border-top:1px solid rgba(255,255,255,0.08); margin-top:5px; text-decoration:underline; text-underline-offset:2px;';
  hint.textContent = 'Click for details';
  hint.addEventListener('mouseenter', () => { hint.style.color = '#aecbfa'; });
  hint.addEventListener('mouseleave', () => { hint.style.color = '#8ab4f8'; });
  const contentBox = tooltipEl.querySelector('#vocab-tooltip-content');
  if (contentBox) contentBox.appendChild(hint);
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
  // Don't trigger new translations while popup is open or tooltip is hovered
  if (popupOpen || tooltipHovered) return;
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => translateSelectedText("mouseup"), 0);
}

function onSelectionChange(e) {
  if (!enabled) return;
  // Don't trigger new translations while popup is open or tooltip is hovered
  if (popupOpen || tooltipHovered) return;

  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => translateSelectedText("selectionchange"), 120);

  // Active tooltip selection-change detection (previously a separate listener)
  if (!activeTooltipEl) return;
  clearTimeout(selHideTimer);
  selHideTimer = setTimeout(() => {
    // Don't hide if popup is open or tooltip is being interacted with
    if (popupOpen || tooltipHovered) return;
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
  // If nothing open, ignore
  if (!activeTooltipEl && !translationTooltip && !vocabDetailPopup) return;

  // Click inside tooltip -> keep
  if (e.target?.closest?.("#vocab-translation-tooltip")) return;
  // Click inside detail popup -> keep
  if (e.target?.closest?.("#vocab-detail-popup")) return;

  // Otherwise hide popup and tooltip
  hideVocabDetailPopup();
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

function onKeyDown(e) {
  if (e.key === "Escape") {
    if (popupOpen) {
      hideVocabDetailPopup();
      return; // close popup first; let user press Escape again to clear tooltip/selection
    }
    lastSelectionText = "";
    hideTranslationTooltip();
    try { window.getSelection()?.removeAllRanges?.(); } catch (e) {}
  }
}
function onScroll() { hideTranslationTooltip(); hideVocabDetailPopup(); }

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
