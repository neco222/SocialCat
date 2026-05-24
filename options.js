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

const elements = {
  enableReplyEnterSend: document.getElementById("enableReplyEnterSend"),
  enablePostEnterSend: document.getElementById("enablePostEnterSend"),
  autoOpenReplyAfterLike: document.getElementById("autoOpenReplyAfterLike"),
  collapseRetweets: document.getElementById("collapseRetweets"),
  autoLikeOnReply: document.getElementById("autoLikeOnReply"),
  greetingEnabled: document.getElementById("greetingEnabled"),
  ranges: document.getElementById("ranges"),
  addRange: document.getElementById("addRange"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  rangeTemplate: document.getElementById("rangeTemplate")
};

init();

async function init() {
  const settings = await loadSettings();
  render(settings);

  elements.addRange.addEventListener("click", () => {
    addRangeItem({
      id: makeId(),
      enabled: true,
      start: "05:00",
      end: "12:00",
      random: false,
      messages: ["おはようございます"]
    });
  });

  elements.save.addEventListener("click", saveSettings);
}

function render(settings) {
  elements.enableReplyEnterSend.checked = settings.enableReplyEnterSend;
  elements.enablePostEnterSend.checked = settings.enablePostEnterSend;
  elements.autoOpenReplyAfterLike.checked = settings.autoOpenReplyAfterLike;
  elements.collapseRetweets.checked = settings.collapseRetweets;
  elements.autoLikeOnReply.checked = settings.autoLikeOnReply;
  elements.greetingEnabled.checked = settings.greeting.enabled;

  elements.ranges.innerHTML = "";
  settings.greeting.ranges.forEach((range) => addRangeItem(range));
}

function addRangeItem(range) {
  const node = elements.rangeTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = range.id || makeId();
  node.querySelector(".start-time").value = normalizeTime(range.start, "05:00");
  node.querySelector(".end-time").value = normalizeTime(range.end, "12:00");
  node.querySelector(".range-enabled").checked = range.enabled !== false;
  node.querySelector(".range-random").checked = Boolean(range.random);
  node.querySelector(".messages").value = (Array.isArray(range.messages) ? range.messages : [])
    .filter((line) => typeof line === "string")
    .join("\n");

  node.querySelector(".delete-range").addEventListener("click", () => {
    node.remove();
  });

  elements.ranges.appendChild(node);
}

async function saveSettings() {
  const settings = collectSettingsFromView();
  await storageSet({ [STORAGE_KEY]: settings });
  showStatus("保存しました。");
}

function collectSettingsFromView() {
  const rangeNodes = Array.from(elements.ranges.querySelectorAll(".range-item"));
  const ranges = rangeNodes.map((node) => {
    const rawMessages = node
      .querySelector(".messages")
      .value.split("\n")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return {
      id: node.dataset.id || makeId(),
      enabled: node.querySelector(".range-enabled").checked,
      start: normalizeTime(node.querySelector(".start-time").value, "05:00"),
      end: normalizeTime(node.querySelector(".end-time").value, "12:00"),
      random: node.querySelector(".range-random").checked,
      messages: rawMessages.length > 0 ? rawMessages : ["おはようございます"]
    };
  });

  return normalizeSettings({
    enableReplyEnterSend: elements.enableReplyEnterSend.checked,
    enablePostEnterSend: elements.enablePostEnterSend.checked,
    autoOpenReplyAfterLike: elements.autoOpenReplyAfterLike.checked,
    collapseRetweets: elements.collapseRetweets.checked,
    autoLikeOnReply: elements.autoLikeOnReply.checked,
    greeting: {
      enabled: elements.greetingEnabled.checked,
      ranges
    }
  });
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

  const rawRanges = Array.isArray(merged.greeting.ranges)
    ? merged.greeting.ranges
    : base.greeting.ranges;
  const ranges = rawRanges
    .map((range, index) => normalizeRange(range, index))
    .filter(Boolean);

  merged.greeting.ranges = ranges.length > 0 ? ranges : clone(base.greeting.ranges);
  merged.enableReplyEnterSend = Boolean(merged.enableReplyEnterSend);
  merged.enablePostEnterSend = Boolean(merged.enablePostEnterSend);
  merged.autoOpenReplyAfterLike = Boolean(merged.autoOpenReplyAfterLike);
  merged.collapseRetweets = Boolean(merged.collapseRetweets);
  merged.autoLikeOnReply = Boolean(merged.autoLikeOnReply);
  merged.greeting.enabled = Boolean(merged.greeting.enabled);
  return merged;
}

function normalizeRange(range, index) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const rawMessages = Array.isArray(range.messages)
    ? range.messages
    : typeof range.messages === "string"
    ? [range.messages]
    : [];
  const messages = rawMessages
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return {
    id: typeof range.id === "string" && range.id.length > 0 ? range.id : `range-${Date.now()}-${index}`,
    enabled: range.enabled !== false,
    start: normalizeTime(range.start, "05:00"),
    end: normalizeTime(range.end, "12:00"),
    random: Boolean(range.random),
    messages: messages.length > 0 ? messages : ["おはようございます"]
  };
}

function normalizeTime(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? value : fallback;
}

function showStatus(message) {
  elements.status.textContent = message;
  window.clearTimeout(showStatus.timerId);
  showStatus.timerId = window.setTimeout(() => {
    elements.status.textContent = "";
  }, 1500);
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

function makeId() {
  return `range-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
