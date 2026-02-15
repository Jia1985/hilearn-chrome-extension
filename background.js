// background.js (MV3 service worker)

// ---- CONFIG ----
// Default values (can be overridden in options)
const DEFAULT_OBSIDIAN_BASE = "http://127.0.0.1:27124";
const DEFAULT_NOTE_PATH = "Vocab-2.md";

// Diagnostic: service worker startup
console.log("ðŸŸ¢ [Background] Service worker starting up (background.js loaded)");
function safeSendMessage(tabId, payload, cb) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, (response) => {
    if (chrome.runtime.lastError) return;
    if (cb) cb(response);
    // ignore "Receiving end does not exist"
  });
}


// Toggle logic for enabling/disabling the extension (toolbar badge + broadcast)
// Use a single unified storage key so all parts of the extension see the same state.
const STORAGE_KEY = "enableExtension";

// Backwards-compatible key name (some code used the old key). Keep for safety.
const EXT_ENABLED_KEY = "enableExtension";

async function getEnabled() {
  const res = await chrome.storage.sync.get({ [STORAGE_KEY]: true });
  return res[STORAGE_KEY];
}

async function setEnabled(value) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: value });
  return value;
}

async function updateBadge(enabled) {
  try {
    await chrome.action.setBadgeText({ text: enabled ? "ON" : "OFF" });
  } catch (e) {
    console.warn('âšª [Background] Failed to set badge text', e);
  }
}

async function broadcastEnabled(enabled) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {safeSendMessage(tab.id, { type: "EXTENSION_TOGGLE", enabled }); } catch (e) {}
    }
  } catch (e) {
    console.warn('âšª [Background] broadcastEnabled failed', e);
  }
}

// Set badge on startup/install
chrome.runtime.onInstalled.addListener(async () => {
  const enabled = await getEnabled();
  await updateBadge(enabled);
});
chrome.runtime.onStartup.addListener(async () => {
  const enabled = await getEnabled();
  await updateBadge(enabled);
});

// Keep service worker alive — MV3 workers are killed after ~30s idle.
// A repeating alarm every 20s prevents that.
chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // no-op: simply handling the alarm keeps the worker alive
  }
});

// Click toolbar icon to toggle
chrome.action.onClicked.addListener(async () => {
  const current = await getEnabled();
  const next = await setEnabled(!current);
  await updateBadge(next);
  // Also set the global extension enabled flag so content/background handlers can check it
  try { await chrome.storage.sync.set({ [EXT_ENABLED_KEY]: next }); } catch (e) {}
  await broadcastEnabled(next);
});

// Background translation cache (persisted to chrome.storage.local)
const bgTranslationCache = new Map();

// Load cache from storage on startup
chrome.storage.local.get(['translationCache'], (res) => {
  try {
    const obj = res?.translationCache || {};
    const entries = Object.entries(obj || {});
    for (const [k, v] of entries) {
      bgTranslationCache.set(k, v);
    }
    console.log('ðŸ” [BG Cache] Loaded translation cache entries:', bgTranslationCache.size);
  } catch (e) {
    console.warn('ðŸ” [BG Cache] Failed to load cache from storage:', e);
  }
});

function persistBgCache() {
  try {
    const obj = Object.fromEntries(bgTranslationCache);
    chrome.storage.local.set({ translationCache: obj }, () => {
      if (chrome.runtime.lastError) {
        console.warn('ðŸ” [BG Cache] Failed to persist cache:', chrome.runtime.lastError.message);
      } else {
        console.log('ðŸ” [BG Cache] Persisted cache, entries:', Object.keys(obj).length);
      }
    });
  } catch (e) {
    console.warn('ðŸ” [BG Cache] persist error:', e);
  }
}

// Helper function to test API connectivity
async function testApiConnectivity(baseUrl, apiKey) {
  console.log("ðŸ” [API Test] Testing API connectivity...");
  
  const tests = [
    { url: `${baseUrl}/openapi`, description: "OpenAPI endpoint" },
    { url: `${baseUrl}/vault`, description: "Vault root" },
    { url: `${baseUrl}/vault/`, description: "Vault root with slash" },
    { url: `${baseUrl}/notes`, description: "Notes endpoint" },
    { url: `${baseUrl}/files`, description: "Files endpoint" },
  ];
  
  for (const test of tests) {
    try {
      console.log(`ðŸ” [API Test] Testing: ${test.description} (${test.url})`);
      const res = await fetch(test.url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });
      console.log(`ðŸ” [API Test] ${test.description}: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text().substring(0, 200);
        console.log(`ðŸ” [API Test] Response preview:`, text);
      }
    } catch (err) {
      console.log(`ðŸ” [API Test] ${test.description}: FAILED - ${err.message}`);
    }
  }
}

// Translate a word in the background to avoid CORS issues from content scripts
async function translateInBackground(word) {
  if (!word || word.trim().length === 0) return null;
  const cleanWord = word.trim().toLowerCase();
  if (cleanWord.length < 2) return null;

  // Try Google Translate first
  // Check background cache first
  if (bgTranslationCache.has(cleanWord)) {
    const cached = bgTranslationCache.get(cleanWord);
    console.log('ðŸ” [BG Translate] Cache hit for', cleanWord, '->', cached);
    return cached;
  }

  try {
    const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(cleanWord)}`;
    console.log("ðŸ” [BG Translate] Fetching Google Translate:", googleUrl);
    const res = await fetch(googleUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
    console.log("ðŸ” [BG Translate] Google status:", res.status);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data[0] && data[0][0] && data[0][0][0]) {
        const translation = data[0][0][0];
        console.log("ðŸ” [BG Translate] Google translation:", translation);
        bgTranslationCache.set(cleanWord, translation);
        persistBgCache();
        return translation;
      }
      console.warn("ðŸ” [BG Translate] Google returned unexpected shape", data);
    } else {
      const text = await res.text().catch(() => '');
      console.warn("ðŸ” [BG Translate] Google non-OK:", res.status, text.substring(0,200));
    }
  } catch (e) {
    console.warn("ðŸ” [BG Translate] Google fetch failed:", e.message || e);
  }

  // Fallback to LibreTranslate
  try {
    const libreUrl = 'https://libretranslate.de/translate';
    console.log("ðŸ” [BG Translate] Trying LibreTranslate for:", cleanWord);
    const res2 = await fetch(libreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: cleanWord, source: 'auto', target: 'zh', format: 'text' }),
    });
    console.log("ðŸ” [BG Translate] LibreTranslate status:", res2.status);
    if (res2.ok) {
      const j = await res2.json().catch(() => null);
      if (j && j.translatedText) {
        console.log("ðŸ” [BG Translate] LibreTranslate translation:", j.translatedText);
        return j.translatedText;
      }
      console.warn("ðŸ” [BG Translate] LibreTranslate unexpected shape:", j);
    } else {
      const txt = await res2.text().catch(() => '');
      console.warn("ðŸ” [BG Translate] LibreTranslate non-OK:", res2.status, txt.substring(0,200));
    }
  } catch (e2) {
    console.warn("ðŸ” [BG Translate] LibreTranslate fetch failed:", e2.message || e2);
  }

  return null;
}

// --- Detailed Vocab Lookup (enhanced Google Translate params) ---

function parseDetailedResponse(data, word) {
  const result = {
    word: word,
    translation: '',
    phonetic: '',
    definitions: [],
    examples: [],
    synonyms: [],
    alternatives: []
  };

  try {
    // data[0]: translation segments (dt=t)
    if (data[0] && data[0][0]) {
      result.translation = data[0][0][0] || '';
      // Phonetic may be at data[0][0][3] (romanization of source)
      if (data[0][0][3]) {
        result.phonetic = data[0][0][3];
      }
    }

    // data[1]: bilingual dictionary entries (dt=bd)
    if (data[1] && Array.isArray(data[1])) {
      for (const entry of data[1]) {
        if (entry && entry[0] && Array.isArray(entry[1])) {
          result.definitions.push({
            pos: entry[0],
            meanings: entry[1].slice(0, 5),
            definition: ''
          });
        }
      }
    }

    // data[11]: romanization (dt=rm) — more reliable phonetic source
    if (data[11] && data[11][0] && data[11][0][0]) {
      result.phonetic = data[11][0][0];
    }

    // data[12]: monolingual definitions (dt=md)
    if (data[12] && Array.isArray(data[12])) {
      for (const section of data[12]) {
        if (!section || !section[0]) continue;
        const pos = section[0];
        const defs = section[1];
        if (!Array.isArray(defs)) continue;

        let defEntry = result.definitions.find(d => d.pos === pos);
        if (!defEntry) {
          defEntry = { pos, meanings: [], definition: '' };
          result.definitions.push(defEntry);
        }
        if (defs[0] && defs[0][0]) {
          defEntry.definition = defs[0][0];
        }
      }
    }

    // data[13]: examples (dt=ex)
    if (data[13] && data[13][0] && Array.isArray(data[13][0])) {
      for (const ex of data[13][0]) {
        if (ex && ex[0]) {
          result.examples.push(ex[0]);
        }
      }
      result.examples = result.examples.slice(0, 5);
    }

    // data[14]: synonyms (dt=ss)
    if (data[14] && Array.isArray(data[14])) {
      for (const synGroup of data[14]) {
        if (!synGroup || !synGroup[0]) continue;
        const pos = synGroup[0];
        const wordGroups = synGroup[1];
        if (!Array.isArray(wordGroups)) continue;
        const words = [];
        for (const wg of wordGroups) {
          if (Array.isArray(wg[0])) {
            words.push(...wg[0].slice(0, 3));
          }
        }
        if (words.length > 0) {
          result.synonyms.push({ pos, words: words.slice(0, 6) });
        }
      }
    }

    // data[5]: alternative translations (dt=at)
    if (data[5] && data[5][0] && data[5][0][2] && Array.isArray(data[5][0][2])) {
      for (const alt of data[5][0][2]) {
        if (alt && alt[0] && alt[0] !== result.translation) {
          result.alternatives.push(alt[0]);
        }
      }
      result.alternatives = result.alternatives.slice(0, 5);
    }
  } catch (e) {
    console.warn('[BG] parseDetailedResponse error:', e);
  }

  return result;
}

async function fetchDetailedTranslation(word) {
  if (!word || word.trim().length === 0) return null;
  const cleanWord = word.trim().toLowerCase();

  // Use sl=en for ASCII words, sl=auto otherwise
  const isAscii = /^[\x00-\x7F]+$/.test(cleanWord);
  const sl = isAscii ? 'en' : 'auto';

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=zh-CN`
    + `&dt=t&dt=bd&dt=md&dt=ex&dt=ss&dt=at&dt=rm`
    + `&q=${encodeURIComponent(cleanWord)}`;

  try {
    console.log('[BG] fetchDetailedTranslation for:', cleanWord);
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      console.warn('[BG] fetchDetailedTranslation non-OK:', res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data) return null;

    return parseDetailedResponse(data, cleanWord);
  } catch (e) {
    console.warn('[BG] fetchDetailedTranslation failed:', e);
    return null;
  }
}

// Use a long-lived port connection to handle translation requests reliably
chrome.runtime.onConnect.addListener((port) => {
  let disconnected = false;

  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  try {
    console.log("ðŸ” [BG] Port connected:", port.name);

    port.onMessage.addListener(async (msg) => {
      if (msg?.type === "FETCH_VOCAB_DETAIL") {
        console.log("[BG] Port FETCH_VOCAB_DETAIL for:", msg.word);
        try {
          const detail = await fetchDetailedTranslation(msg.word);
          if (disconnected) return;
          try { port.postMessage({ type: 'VOCAB_DETAIL_RESULT', detail }); } catch {}
        } catch (err) {
          if (disconnected) return;
          try { port.postMessage({ type: 'VOCAB_DETAIL_RESULT', detail: null, error: String(err) }); } catch {}
        }
        return;
      }

      if (msg?.type !== "TRANSLATE_REQUEST") return;

      console.log("ðŸ” [BG] Port TRANSLATE_REQUEST for:", msg.word);

      try {
        const translation = await translateInBackground(msg.word);
        if (disconnected) return;
        try { port.postMessage({ translation }); } catch {}
      } catch (err) {
        if (disconnected) return;
        try { port.postMessage({ translation: null, error: String(err) }); } catch {}
      }
    });
  } catch (e) {
    console.error("ðŸ” [BG] onConnect handler error:", e);
  }
});


async function appendToObsidian({ apiKey, selectedText, pageTitle, url, apiBase, notePath }) {
  console.log("ðŸŸ¡ [API Call] appendToObsidian function called");
  console.log("ðŸŸ¡ [API Call] Parameters:", {
    hasApiKey: !!apiKey,
    selectedText: selectedText?.substring(0, 50),
    pageTitle,
    url,
    apiBase,
    notePath
  });
  
  // Basic cleanup
  const text = (selectedText || "").replace(/\s+/g, " ").trim();
  const title = (pageTitle || "").replace(/\s+/g, " ").trim();

  console.log("ðŸŸ¡ [API Call] Cleaned text:", text);
  console.log("ðŸŸ¡ [API Call] Cleaned title:", title);

  if (!text) {
    console.error("ðŸŸ¡ [API Call] ERROR: No selected text to save");
    throw new Error("No selected text to save.");
  }

  // Build the exact line format you chose
  const line = `- **${text}** â€” ${title || new URL(url).hostname} Â· [source](${url})\n`;
  console.log("ðŸŸ¡ [API Call] Formatted line to save:", line);

  // Use provided values or defaults
  const baseUrl = apiBase || DEFAULT_OBSIDIAN_BASE;
  const targetNote = notePath || DEFAULT_NOTE_PATH;
  try{
  // First, test API connectivity to discover available endpoints
  await testApiConnectivity(baseUrl, apiKey);
  
  // Try different endpoint formats - Obsidian Local REST API might use different paths
  // Common formats:
  // 1. /vault/{path} with ?append=true query param
  // 2. /vault/{path} with PUT method (read existing, append, write back)
  // 3. /vault/{path}/append endpoint
  // 4. /notes/{path} or /files/{path}
  
  const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
  const endpointBase = `${baseUrl.replace(/\/$/, "")}/vault/${encodeURIComponent(notePath)}`;
  const endpoint = endpointBase;


  console.log("ðŸŸ¡ [API Call] Configuration:", {
    baseUrl,
    targetNote,
    endpoint,
    method: "POST with append query",
    text: text.substring(0, 50) + "...",
    hasApiKey: !!apiKey
  });

  // Try only the supported Local REST API endpoints for files
  const endpointsToTry = [
  {
    url: `${endpointBase}?append=true`,
    method: "POST",
    description: `POST ${endpointBase}?append=true`
  },
  {
    url: endpointBase,
    method: "PUT",
    description: `PUT ${endpointBase} (overwrite)`,
    needsRead: false
  }
];


    
    let res;
    let lastError;
    
    for (const endpointConfig of endpointsToTry) {
      try {
        console.log(`ðŸŸ¡ [API Call] Trying: ${endpointConfig.description}`);
        console.log(`ðŸŸ¡ [API Call] URL: ${endpointConfig.url}`);
        console.log(`ðŸŸ¡ [API Call] Method: ${endpointConfig.method}`);
        
        let requestBody = line;
        
        // If PUT and needs to read first
        if (endpointConfig.method === "PUT" && endpointConfig.needsRead) {
          console.log("ðŸŸ¡ [API Call] Reading existing file first...");
          try {
            // Extract base URL without query params for GET
            const getUrl = endpointConfig.url.split('?')[0];
            const getRes = await fetch(getUrl, {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
              },
            });
            
            let existingContent = "";
            if (getRes.ok) {
              existingContent = await getRes.text();
              console.log("ðŸŸ¡ [API Call] Existing content length:", existingContent.length);
            } else {
              console.log("ðŸŸ¡ [API Call] File doesn't exist yet (will create new)");
            }
            
            requestBody = existingContent + (existingContent && !existingContent.endsWith('\n') ? '\n' : '') + line;
            console.log("ðŸŸ¡ [API Call] New content length:", requestBody.length);
          } catch (readErr) {
            console.warn("ðŸŸ¡ [API Call] Couldn't read existing file, will create new:", readErr.message);
            requestBody = line;
          }
        }
        
        res = await fetch(endpointConfig.url, {
          method: endpointConfig.method,
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "text/plain",
          },
          body: requestBody,
        });
        
        console.log(`ðŸŸ¡ [API Call] Response from ${endpointConfig.description}:`, res.status, res.statusText);
        
        // If we got a response (even if error), break and check it
        if (res.status !== 404) {
          break;
        }
        
      } catch (fetchErr) {
        console.warn(`ðŸŸ¡ [API Call] ${endpointConfig.description} failed:`, fetchErr.message);
        lastError = fetchErr;
        continue; // Try next endpoint
      }
    }
    
    
    if (!res) {
      throw lastError || new Error("All endpoint attempts failed");
    }

    console.log("ðŸŸ¡ [API Call] Final response status:", res.status, res.statusText);
    console.log("ðŸŸ¡ [API Call] Response ok:", res.ok);
    console.log("ðŸŸ¡ [API Call] Response headers:", Object.fromEntries(res.headers.entries()));

    let responseText = "";
    try {
      responseText = await res.text();
    } catch {
      responseText = "";
    }

    console.log("ðŸŸ¡ [API Call] Response body:", responseText.substring(0, 200));

    if (!res.ok) {
      console.error("ðŸŸ¡ [API Call] ERROR - API returned non-OK status:", {
        status: res.status,
        statusText: res.statusText,
        body: responseText
      });
      throw new Error(`Obsidian API error ${res.status}: ${responseText || res.statusText}`);
    }

    console.log("ðŸŸ¡ [API Call] âœ… SUCCESS - Successfully saved to Obsidian!");
    return true;
  } catch (err) {
    console.error("[Vocab Saver] Error saving to Obsidian:", err);
    throw err;
  }


    
    if (err.name === "TypeError" && (err.message.includes("fetch") || err.message.includes("Failed to fetch"))) {
      const detailedError = `Cannot connect to Obsidian API at ${baseUrl} (writing ${targetNote}).\n\n` +
        `Possible issues:\n` +
        `1. Is the Obsidian API server running?\n` +
        `2. SSL certificate issue? Try using HTTP instead of HTTPS in settings\n` +
        `3. Wrong port? Currently using: ${baseUrl}\n` +
        `4. Check if the API is accessible in your browser`;
      console.error("[Vocab Saver] Network error:", detailedError);
      throw new Error(detailedError);
       }
       throw err;
  }


// Create context menu - run on install and startup
function createContextMenu() {
  // Safety: some environments may not have contextMenus API available
  if (!chrome.contextMenus) return;

  try {
    chrome.contextMenus.removeAll(() => {
      try {
        chrome.contextMenus.create({
          id: "saveToObsidian",
          title: "Save to Obsidian",
          contexts: ["selection"]
        });
      } catch (e) {
        console.warn('âšª [Background] Failed to create saveToObsidian context menu', e);
      }

      try {
        chrome.contextMenus.create({
          id: "translateSelection",
          title: "Translate selection",
          contexts: ["selection"]
        });
      } catch (e) {
        console.warn('âšª [Background] Failed to create translateSelection context menu', e);
      }
    });
  } catch (err) {
    console.warn('âšª [Background] createContextMenu failed', err);
  }
}

// Create on install
chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

// Also create on startup (in case extension was already installed)
createContextMenu();

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log("ðŸŸ¢ [Background] Context menu clicked!");
  console.log("ðŸŸ¢ [Background] Menu item ID:", info.menuItemId);
  console.log("ðŸŸ¢ [Background] Selected text:", info.selectionText);
  console.log("ðŸŸ¢ [Background] Tab ID:", tab.id);
  console.log("ðŸŸ¢ [Background] Tab URL:", tab.url);
  console.log("ðŸŸ¢ [Background] Tab title:", tab.title);
  
  if (info.menuItemId === "saveToObsidian" && info.selectionText) {
    console.log("ðŸŸ¢ [Background] Processing save request directly...");
    
    // Show "Saving..." chip immediately
    try {
      console.log("ðŸŸ¢ [Background] Sending SHOW_CHIP message to content script...");
      safeSendMessage(tab.id, {
        type: "SHOW_CHIP",
        message: "Saving...",
        chipType: "info"
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("ðŸŸ¢ [Background] Could not send chip message:", chrome.runtime.lastError.message);
        } else {
          console.log("ðŸŸ¢ [Background] Chip message sent successfully");
        }
      });
    } catch (e) {
      console.warn("ðŸŸ¢ [Background] Error sending chip message:", e);
    }
    
    try {
      // Get settings from storage
      console.log("ðŸŸ¢ [Background] Step 1: Getting settings from storage...");
      const result = await chrome.storage.sync.get([
        "obsidianApiKey",
        "obsidianApiBase",
        "obsidianNotePath"
      ]);
      
      console.log("ðŸŸ¢ [Background] Storage result:", {
        hasApiKey: !!result.obsidianApiKey,
        apiBase: result.obsidianApiBase,
        notePath: result.obsidianNotePath
      });
      
      const apiKey = result.obsidianApiKey;
      const apiBase = result.obsidianApiBase;
      const notePath = result.obsidianNotePath;
      
      if (!apiKey) {
        const errorMsg = "API key not set";
        console.error("ðŸŸ¢ [Background] ERROR:", errorMsg);
        // Show error chip
        try {
          safeSendMessage(tab.id, {
            type: "SHOW_CHIP",
            message: errorMsg,
            chipType: "error"
          });
        } catch (e) {}
        // Try to show notification or alert
        chrome.notifications.create({
          type: "basic",
          iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text>âš ï¸</text></svg>",
          title: "Vocab Saver Error",
          message: "Please set your API key in extension options"
        });
        return;
      }

      console.log("ðŸŸ¢ [Background] Step 2: Calling appendToObsidian function...");
      console.log("ðŸŸ¢ [Background] Payload:", {
        selectedText: info.selectionText,
        pageTitle: tab.title,
        url: tab.url
      });
      
      await appendToObsidian({
        apiKey,
        selectedText: info.selectionText,
        pageTitle: tab.title,
        url: tab.url,
        apiBase,
        notePath
      });
      
      console.log("ðŸŸ¢ [Background] âœ… Successfully saved to Obsidian!");
      
      // Show success chip (best-effort)
      safeSendMessage(tab.id, {
      type: "SHOW_CHIP",
      message: "Saved to Obsidian!",
      chipType: "success"
    });

      
      // Show success notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text>âœ…</text></svg>",
        title: "Vocab Saver",
        message: `Saved: "${info.selectionText.substring(0, 50)}..."`
      });
      
    } catch (err) {
      const errorMsg = String(err?.message || err);
      console.error("ðŸŸ¢ [Background] ERROR in save process:", errorMsg);
      console.error("ðŸŸ¢ [Background] Full error:", err);
      
      // Show error chip
      try {
        console.log("ðŸŸ¢ [Background] Sending error chip message...");
        safeSendMessage(tab.id, {
          type: "SHOW_CHIP",
          message: "Save failed",
          chipType: "error"
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("ðŸŸ¢ [Background] Could not send error chip:", chrome.runtime.lastError.message);
          } else {
            console.log("ðŸŸ¢ [Background] Error chip sent");
          }
        });
      } catch (e) {
        console.warn("ðŸŸ¢ [Background] Error sending error chip:", e);
      }
      
      // Show error notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text>âŒ</text></svg>",
        title: "Vocab Saver Error",
        message: errorMsg.substring(0, 100)
      });
    }
  } else {
    console.log("ðŸŸ¢ [Background] Ignoring context menu click - wrong menu item or no selection");
  }
});



// Handle OBSIDIAN_APPEND messages from the content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "OBSIDIAN_APPEND") return;

  console.log("[Background] Received OBSIDIAN_APPEND message from content script");

  const { selectedText, pageTitle, url } = msg.payload || {};

  (async () => {
    try {
      const result = await chrome.storage.sync.get([
        "obsidianApiKey",
        "obsidianApiBase",
        "obsidianNotePath"
      ]);

      const apiKey = result.obsidianApiKey;
      if (!apiKey) {
        sendResponse({ ok: false, error: "API key not set. Please configure it in extension options." });
        return;
      }

      await appendToObsidian({
        apiKey,
        selectedText,
        pageTitle,
        url,
        apiBase: result.obsidianApiBase,
        notePath: result.obsidianNotePath
      });

      sendResponse({ ok: true });
    } catch (err) {
      console.error("[Background] OBSIDIAN_APPEND error:", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});

// Handle FETCH_VOCAB_DETAIL messages from the content script (fallback for port failures)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "FETCH_VOCAB_DETAIL") return;

  console.log("[BG] onMessage FETCH_VOCAB_DETAIL for:", msg.word);

  fetchDetailedTranslation(msg.word).then(detail => {
    sendResponse({ detail });
  }).catch(err => {
    console.warn("[BG] FETCH_VOCAB_DETAIL error:", err);
    sendResponse({ detail: null, error: String(err) });
  });

  return true; // async
});
