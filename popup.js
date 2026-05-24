"use strict";

const STORAGE_KEY = "settings";

const DEFAULT_SETTINGS = {
  enableReplyEnterSend: true,
  enablePostEnterSend: false,
  autoOpenReplyAfterLike: false,
  collapseRetweets: true,
  autoLikeOnReply: false,
  greeting: {
    enabled: true,
    ranges: [
      {
        id: "default-morning",
        enabled: true,
        start: "05:00",
        end: "12:00",
        random: false,
        messages: ["おはようございます"]
      }
    ]
  }
};

const ids = [
  "enableReplyEnterSend",
  "enablePostEnterSend",
  "autoOpenReplyAfterLike",
  "collapseRetweets",
  "autoLikeOnReply",
  "greetingEnabled"
];

const controls = Object.fromEntries(
  ids.map((id) => [id, document.getElementById(id)])
);

const openOptionsButton = document.getElementById("openOptions");
const status = document.getElementById("status");

init();

async function init() {
  const settings = await loadSettings();
  setViewFromSettings(settings);

  for (const id of ids) {
    controls[id].addEventListener("change", saveFromView);
  }

  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function setViewFromSettings(settings) {
  controls.enableReplyEnterSend.checked = settings.enableReplyEnterSend;
  controls.enablePostEnterSend.checked = settings.enablePostEnterSend;
  controls.autoOpenReplyAfterLike.checked = settings.autoOpenReplyAfterLike;
  controls.collapseRetweets.checked = settings.collapseRetweets;
  controls.autoLikeOnReply.checked = settings.autoLikeOnReply;
  controls.greetingEnabled.checked = settings.greeting.enabled;
}

async function saveFromView() {
  const settings = await loadSettings();
  const next = normalizeSettings({
    ...settings,
    enableReplyEnterSend: controls.enableReplyEnterSend.checked,
    enablePostEnterSend: controls.enablePostEnterSend.checked,
    autoOpenReplyAfterLike: controls.autoOpenReplyAfterLike.checked,
    collapseRetweets: controls.collapseRetweets.checked,
    autoLikeOnReply: controls.autoLikeOnReply.checked,
    greeting: {
      ...settings.greeting,
      enabled: controls.greetingEnabled.checked
    }
  });

  await storageSet({ [STORAGE_KEY]: next });
  showStatus("保存しました");
}

async function loadSettings() {
  const loaded = await storageGet(STORAGE_KEY);
  if (!loaded || typeof loaded !== "object") {
    await storageSet({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    return clone(DEFAULT_SETTINGS);
  }
  return normalizeSettings(loaded);
}

function normalizeSettings(raw) {
  const base = clone(DEFAULT_SETTINGS);
  const merged = {
    ...base,
    ...raw,
    greeting: {
      ...base.greeting,
      ...(raw.greeting || {})
    }
  };

  merged.enableReplyEnterSend = Boolean(merged.enableReplyEnterSend);
  merged.enablePostEnterSend = Boolean(merged.enablePostEnterSend);
  merged.autoOpenReplyAfterLike = Boolean(merged.autoOpenReplyAfterLike);
  merged.collapseRetweets = Boolean(merged.collapseRetweets);
  merged.autoLikeOnReply = Boolean(merged.autoLikeOnReply);
  merged.greeting.enabled = Boolean(merged.greeting.enabled);
  merged.greeting.ranges = Array.isArray(merged.greeting.ranges)
    ? merged.greeting.ranges
    : clone(base.greeting.ranges);
  return merged;
}

function showStatus(message) {
  status.textContent = message;
  window.clearTimeout(showStatus.timerId);
  showStatus.timerId = window.setTimeout(() => {
    status.textContent = "";
  }, 1200);
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
