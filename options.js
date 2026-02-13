// Load saved settings
chrome.storage.sync.get(["obsidianApiKey", "obsidianApiBase", "obsidianNotePath"], (result) => {
  if (result.obsidianApiKey) {
    document.getElementById("apiKey").value = result.obsidianApiKey;
  }
  if (result.obsidianApiBase) {
    document.getElementById("apiBase").value = result.obsidianApiBase;
  } else {
    document.getElementById("apiBase").value = "http://127.0.0.1:27124";
  }
  if (result.obsidianNotePath) {
    document.getElementById("notePath").value = result.obsidianNotePath;
  } else {
    document.getElementById("notePath").value = "Vocab-2.md";
  }
});

// Inline translation toggle
const enableCheckbox = document.getElementById("enableTranslation");
// Load saved value (default: true)
chrome.storage.sync.get({ enableExtension: true }, (res) => {
  try { enableCheckbox.checked = !!res.enableExtension; } catch (e) {}
});

// Save on change (persist unified key)
enableCheckbox.addEventListener("change", () => {
  chrome.storage.sync.set({ enableExtension: !!enableCheckbox.checked });
});

// Save settings
document.getElementById("optionsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const apiKey = document.getElementById("apiKey").value.trim();
  const apiBase = document.getElementById("apiBase").value.trim();
  const notePath = document.getElementById("notePath").value.trim();
  const statusEl = document.getElementById("status");

  if (!apiKey) {
    showStatus("Please enter an API key", "error");
    return;
  }
  if (!apiBase) {
    showStatus("Please enter an API base URL", "error");
    return;
  }
  if (!notePath) {
    showStatus("Please enter a note path", "error");
    return;
  }

  chrome.storage.sync.set({
    obsidianApiKey: apiKey,
    obsidianApiBase: apiBase,
    obsidianNotePath: notePath
  }, () => {
    showStatus("✅ Settings saved successfully!", "success");
  });
});

function showStatus(message, type) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = "block";
  setTimeout(() => {
    statusEl.style.display = "none";
  }, 3000);
}
