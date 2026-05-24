(function () {
  "use strict";

  if (window.__socialcatContentScriptActive) {
    return;
  }
  window.__socialcatContentScriptActive = true;

  const STORAGE_KEY = "settings";

  const EDITOR_SELECTOR = [
    'div[role="textbox"][contenteditable="true"]',
    'div[data-testid="tweetTextarea_0"][contenteditable="true"]'
  ].join(",");

  const SUBMIT_BUTTON_SELECTOR = [
    'button[data-testid="tweetButton"]',
    'button[data-testid="tweetButtonInline"]'
  ].join(",");

  const REPLY_BUTTON_SELECTOR = 'button[data-testid="reply"]';
  const LIKE_BUTTON_SELECTOR = 'button[data-testid="like"]';
  const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const RETWEET_CONTEXT_SELECTOR = '[data-testid="socialContext"]';
  const SOCIAL_DOG_HOST = "web.social-dog.net";
  const SOCIAL_DOG_API_EVENT = "socialcat:socialdog-api";
  const SOCIAL_DOG_USERS_API_PATH = "/user_list/api_get_users";
  const SOCIAL_DOG_MENTIONS_API_PATH = "/user_list/api_get_mentions";
  const SOCIAL_DOG_NOTICE_ATTRIBUTE = "data-socialcat-reply-notice";
  const X_REPLY_NOTICE_ATTRIBUTE = "data-socialcat-x-reply-notice";
  const X_REPLY_NOTICE_KIND_ATTRIBUTE = "data-socialcat-x-reply-kind";
  const X_REPLY_NOTICE_CLASS = "socialcat-x-reply-notice";
  const X_REPLY_NOTICE_STYLE_ID = "socialcat-x-reply-notice-style";
  const X_NOTIFICATION_CELL_SELECTOR = 'div[data-testid="cellInnerDiv"]';
  const X_NOTIFICATION_ARTICLE_SELECTOR = 'article[data-testid="notification"]';
  const X_REPLYING_TO_PATTERN = /(\u8fd4\u4fe1\u5148:|replying to)/i;
  const X_TWEET_RESULT_BASE = "https://cdn.syndication.twimg.com/tweet-result";
  const X_REPLY_TO_REPLY_PATTERN =
    /(replied to your reply|your reply.*replied|\u3042\u306a\u305f\u306e(?:\u8fd4\u4fe1|\u30ea\u30d7(?:\u30e9\u30a4)?).{0,6}\u8fd4\u4fe1\u3057\u307e\u3057\u305f|\u8fd4\u4fe1\u306b\u8fd4\u4fe1)/i;
  const X_REPLY_TO_POST_PATTERN =
    /(replied to your post|replied to you|replied\b.*\byou\b|\u3042\u306a\u305f\u306e(?:\u30dd\u30b9\u30c8|\u30c4\u30a4\u30fc\u30c8).{0,6}\u8fd4\u4fe1\u3057\u307e\u3057\u305f|\u3042\u306a\u305f\u306b\u8fd4\u4fe1\u3057\u307e\u3057\u305f)/i;
  const X_REPLY_VERB_PATTERN = /(\u8fd4\u4fe1\u3057\u307e\u3057\u305f|replied)/i;
  const X_NON_REPLY_ACTION_PATTERN =
    /(\u3044\u3044\u306d\u3057\u307e\u3057\u305f|\u30ea\u30dd\u30b9\u30c8\u3057\u307e\u3057\u305f|\u30d5\u30a9\u30ed\u30fc\u3055\u308c\u307e\u3057\u305f|liked|reposted|followed)/i;

  const AUTO_INSERT_DATA_KEY = "socialcatGreetingInserted";
  const AUTO_INSERT_VALUE_KEY = "socialcatGreetingValue";
  const GREETING_HIGHLIGHT_CLASS = "socialcat-greeting-highlight";
  const GREETING_STYLE_ID = "socialcat-greeting-style";
  const MORNING_START_MINUTES = 4 * 60;
  const MORNING_END_MINUTES = 12 * 60;
  const OHATSU_TEXT_PATTERN = /(\u304a\u306f|\u304a\u65e9\u3046|good\s*morning|\bgm\b)/i;
  const RETWEET_ID_ATTRIBUTE = "data-socialcat-retweet-id";
  const RETWEET_KEY_ATTRIBUTE = "data-socialcat-retweet-key";
  const RETWEET_EXPANDED_ATTRIBUTE = "data-socialcat-retweet-expanded";
  const RETWEET_COLLAPSED_NODE_ATTRIBUTE = "data-socialcat-retweet-collapsed-node";
  const RETWEET_TOGGLE_HOST_ATTRIBUTE = "data-socialcat-retweet-toggle-host";
  const RETWEET_TARGET_ATTRIBUTE = "data-socialcat-retweet-target";
  const RETWEET_TOGGLE_STATE_ATTRIBUTE = "data-socialcat-retweet-toggle-state";
  const RETWEET_USER_EXPANDED_ATTRIBUTE = "data-socialcat-retweet-user-expanded";
  const RETWEET_LAST_TOGGLE_AT_ATTRIBUTE = "data-socialcat-retweet-last-toggle-at";
  const RETWEET_STYLE_ID = "socialcat-retweet-style";
  const RETWEET_HEIGHT_ANIM_MS = 220;
  const RETWEET_HEIGHT_EASE = "cubic-bezier(0.2, 0, 0, 1)";
  const RETWEET_TOGGLE_DEBOUNCE_MS = 280;
  const RETWEET_USER_EXPAND_GRACE_MS = 1500;
  const PROFILE_ALLOWED_SUBPATHS = new Set(["with_replies", "media", "likes", "highlights", "articles"]);
  const NON_PROFILE_ROOT_PATHS = new Set([
    "home",
    "explore",
    "search",
    "notifications",
    "messages",
    "bookmarks",
    "communities",
    "lists",
    "jobs",
    "i",
    "compose",
    "settings",
    "account",
    "tos",
    "privacy",
    "login",
    "signup",
    "share",
    "intent",
    "hashtag"
  ]);

  const REPLY_WORDS = /(reply|in reply to|返信|リプ)/i;
  const POST_WORDS = /(post|tweet|投稿|ツイート)/i;
  const RETWEET_WORDS = /(reposted|retweet|repost|リポスト|リツイート)/i;

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

  let settings = clone(DEFAULT_SETTINGS);
  let retweetObserver = null;
  let retweetIdCounter = 0;
  let retweetCollapseTimer = null;
  let retweetCollapseRunning = false;
  let retweetCollapseQueued = false;
  let lastRouteKey = "";
  let routeWatcherInstalled = false;
  const expandedRetweetKeys = new Set();
  const recentExpandedRetweetKeys = new Map();
  const socialDogReplyInfoByTweetId = new Map();
  const socialDogParentOwnerByTweetId = new Map();
  const socialDogParentLookupPending = new Set();
  const socialDogOwnHandleCounts = new Map();
  const socialDogMentionFromMeTweetIds = new Set();
  let socialDogTimelineObserver = null;
  let socialDogNoticeTimer = null;
  let socialDogParentLookupRunning = false;
  let socialDogOwnServiceUserId = "";
  let socialDogOwnScreenName = "";
  let xReplyNoticeObserver = null;
  let xReplyNoticeTimer = null;
  const xReplyKindByTweetId = new Map();
  const xReplyLookupPending = new Set();
  let xReplyLookupRunning = false;
  let routeWatchFallbackTimer = null;

  init();

  async function init() {
    if (isSocialDogPage()) {
      initSocialDog();
      return;
    }

    settings = await loadSettings();
    lastRouteKey = getRouteKey();
    installRouteWatcher();
    applyRetweetCollapse();
    applyXReplyNotices();
    ensureGreetingStyles();

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClick, true);

    chrome.storage.onChanged.addListener(onStorageChanged);
  }

  function isSocialDogPage() {
    return location.hostname.toLowerCase() === SOCIAL_DOG_HOST;
  }

  function initSocialDog() {
    injectSocialDogBridgeScript();
    window.addEventListener(SOCIAL_DOG_API_EVENT, onSocialDogApiEvent, true);
    observeSocialDogTimeline();
    scheduleSocialDogNoticeUpdate();
  }

  function injectSocialDogBridgeScript() {
    const scriptId = "socialcat-socialdog-bridge";
    if (document.getElementById(scriptId)) {
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = chrome.runtime.getURL("socialdog-injected.js");
    script.async = false;
    const target = document.head || document.documentElement;
    if (!target) {
      return;
    }
    script.addEventListener(
      "load",
      () => {
        script.remove();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
      },
      { once: true }
    );
    target.appendChild(script);
  }

  function onSocialDogApiEvent(event) {
    const detail = event && event.detail;
    if (!detail || typeof detail !== "object") {
      return;
    }

    const url = typeof detail.url === "string" ? detail.url : "";
    if (!isSocialDogApiUrl(url)) {
      return;
    }

    const payload = detail.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }

    handleSocialDogApiPayload(url, payload);
  }

  function isSocialDogApiUrl(url) {
    const pathname = getPathnameFromUrl(url);
    if (pathname) {
      return pathname === SOCIAL_DOG_USERS_API_PATH || pathname === SOCIAL_DOG_MENTIONS_API_PATH;
    }
    return url.includes(SOCIAL_DOG_USERS_API_PATH) || url.includes(SOCIAL_DOG_MENTIONS_API_PATH);
  }

  function getPathnameFromUrl(url) {
    try {
      return new URL(url, location.href).pathname;
    } catch (_) {
      return "";
    }
  }

  function handleSocialDogApiPayload(url, payload) {
    const pathname = getPathnameFromUrl(url);
    let updated = false;

    if (updateSocialDogOwnUserFromUrl(url)) {
      updated = true;
    }

    if (pathname === SOCIAL_DOG_USERS_API_PATH) {
      updated = updateSocialDogUsersFromPayload(payload) || updated;
    }
    if (pathname === SOCIAL_DOG_MENTIONS_API_PATH) {
      updated = updateSocialDogMentionsFromPayload(payload) || updated;
    }

    if (updated) {
      scheduleSocialDogNoticeUpdate();
    }
  }

  function updateSocialDogOwnUserFromUrl(url) {
    const ownUserId = extractSocialDogLoginServiceUserIdFromUrl(url);
    if (!ownUserId || ownUserId === socialDogOwnServiceUserId) {
      return false;
    }
    socialDogOwnServiceUserId = ownUserId;
    return recomputeAllSocialDogReplyKinds();
  }

  function extractSocialDogLoginServiceUserIdFromUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return normalizeStatusId(parsed.searchParams.get("login_service_user_id") || "");
    } catch (_) {
      return "";
    }
  }

  function updateSocialDogUsersFromPayload(payload) {
    const users = Array.isArray(payload.users) ? payload.users : [];
    let updated = false;
    for (const user of users) {
      if (!user || typeof user !== "object") {
        continue;
      }
      const tweetId = normalizeStatusId(user.tweet_id);
      if (!tweetId) {
        continue;
      }
      const itemType = typeof user.type === "string" ? user.type : "";
      const tweetText = typeof user.tweet_text === "string" ? user.tweet_text : "";
      if (itemType === "mention" && tweetText) {
        if (registerSocialDogOwnScreenNameFromText(tweetText)) {
          updated = true;
        }
      }

      const parentId = normalizeStatusId(user.in_reply_to_status_id);
      const myReplyTweetId = normalizeStatusId(user.user_replied_tweet_id);
      if (itemType === "mention" && parentId && !socialDogParentOwnerByTweetId.has(parentId)) {
        socialDogParentLookupPending.add(parentId);
      }

      const kind = deriveSocialDogReplyKind(itemType, parentId, myReplyTweetId);
      const next = {
        itemType,
        parentId,
        myReplyTweetId,
        kind
      };

      const previous = socialDogReplyInfoByTweetId.get(tweetId);
      if (
        !previous ||
        previous.itemType !== next.itemType ||
        previous.parentId !== next.parentId ||
        previous.myReplyTweetId !== next.myReplyTweetId ||
        previous.kind !== next.kind
      ) {
        socialDogReplyInfoByTweetId.set(tweetId, next);
        updated = true;
      }
    }

    if (socialDogParentLookupPending.size > 0) {
      runSocialDogParentLookups();
    }

    return updated;
  }

  function updateSocialDogMentionsFromPayload(payload) {
    const tweets = Array.isArray(payload.tweets) ? payload.tweets : [];
    let updated = false;
    for (const tweet of tweets) {
      if (!tweet || typeof tweet !== "object") {
        continue;
      }
      if (tweet.type !== "mention_from_me") {
        continue;
      }
      const tweetId = normalizeStatusId(tweet.tweet_id);
      if (!tweetId || socialDogMentionFromMeTweetIds.has(tweetId)) {
        continue;
      }
      socialDogMentionFromMeTweetIds.add(tweetId);
      updated = true;
    }

    if (updated && recomputeAllSocialDogReplyKinds()) {
      return true;
    }
    return updated;
  }

  function deriveSocialDogReplyKind(itemType, parentId, myReplyTweetId) {
    if (itemType !== "mention" || !parentId) {
      return "";
    }

    // Strong signal: this mention replied directly to my reply tweet.
    if (myReplyTweetId && parentId === myReplyTweetId) {
      return "reply_to_my_reply";
    }
    if (socialDogMentionFromMeTweetIds.has(parentId)) {
      return "reply_to_my_reply";
    }

    const parentOwner = socialDogParentOwnerByTweetId.get(parentId);
    const parentOwnerUserId = getSocialDogParentOwnerUserId(parentOwner);
    const parentInReplyToUserId = getSocialDogParentInReplyToUserId(parentOwner);
    if (parentOwnerUserId && socialDogOwnServiceUserId) {
      if (parentOwnerUserId !== socialDogOwnServiceUserId) {
        return "reply_to_my_reply";
      }
      // My tweet can still be a reply to another user's post.
      if (parentInReplyToUserId && parentInReplyToUserId !== socialDogOwnServiceUserId) {
        return "reply_to_my_reply";
      }
      return "reply_to_my_tweet";
    }

    const parentOwnerScreenName = getSocialDogParentOwnerScreenName(parentOwner);
    const parentInReplyToScreenName = getSocialDogParentInReplyToScreenName(parentOwner);
    if (parentOwnerScreenName && socialDogOwnScreenName) {
      if (parentOwnerScreenName !== socialDogOwnScreenName) {
        return "reply_to_my_reply";
      }
      if (parentInReplyToScreenName && parentInReplyToScreenName !== socialDogOwnScreenName) {
        return "reply_to_my_reply";
      }
      return "reply_to_my_tweet";
    }

    // Parent metadata is unresolved: avoid wrong badges until lookup finishes.
    return "";
  }

  function getSocialDogParentOwnerUserId(parentOwner) {
    if (!parentOwner || typeof parentOwner !== "object") {
      return "";
    }
    const id = parentOwner.userId;
    return typeof id === "string" ? id : "";
  }

  function getSocialDogParentOwnerScreenName(parentOwner) {
    if (!parentOwner) {
      return "";
    }
    if (typeof parentOwner === "string") {
      return parentOwner;
    }
    if (typeof parentOwner === "object" && typeof parentOwner.screenName === "string") {
      return parentOwner.screenName;
    }
    return "";
  }

  function getSocialDogParentInReplyToUserId(parentOwner) {
    if (!parentOwner || typeof parentOwner !== "object") {
      return "";
    }
    const id = parentOwner.inReplyToUserId;
    return typeof id === "string" ? id : "";
  }

  function getSocialDogParentInReplyToScreenName(parentOwner) {
    if (!parentOwner || typeof parentOwner !== "object") {
      return "";
    }
    const screenName = parentOwner.inReplyToScreenName;
    return typeof screenName === "string" ? screenName : "";
  }

  function registerSocialDogOwnScreenNameFromText(tweetText) {
    const handle = extractLeadingMentionHandle(tweetText);
    if (!handle) {
      return false;
    }

    const previousCount = socialDogOwnHandleCounts.get(handle) || 0;
    socialDogOwnHandleCounts.set(handle, previousCount + 1);

    let bestHandle = "";
    let bestCount = 0;
    for (const [candidate, count] of socialDogOwnHandleCounts.entries()) {
      if (count > bestCount) {
        bestHandle = candidate;
        bestCount = count;
      }
    }

    if (!bestHandle || bestHandle === socialDogOwnScreenName) {
      return false;
    }
    socialDogOwnScreenName = bestHandle;
    return recomputeAllSocialDogReplyKinds();
  }

  function extractLeadingMentionHandle(text) {
    const match = /^\s*@([A-Za-z0-9_]{1,15})\b/.exec(text);
    if (!match) {
      return "";
    }
    return match[1].toLowerCase();
  }

  function recomputeAllSocialDogReplyKinds() {
    let updated = false;
    for (const [tweetId, info] of socialDogReplyInfoByTweetId.entries()) {
      const nextKind = deriveSocialDogReplyKind(info.itemType, info.parentId, info.myReplyTweetId);
      if (info.kind === nextKind) {
        continue;
      }
      socialDogReplyInfoByTweetId.set(tweetId, {
        ...info,
        kind: nextKind
      });
      updated = true;
    }
    return updated;
  }

  async function runSocialDogParentLookups() {
    if (socialDogParentLookupRunning || socialDogParentLookupPending.size === 0) {
      return;
    }
    socialDogParentLookupRunning = true;
    try {
      while (socialDogParentLookupPending.size > 0) {
        const parentId = socialDogParentLookupPending.values().next().value;
        socialDogParentLookupPending.delete(parentId);
        const owner = await fetchSocialDogTweetOwner(parentId);
        if (owner !== null) {
          socialDogParentOwnerByTweetId.set(parentId, owner);
        } else {
          // Mark as resolved to avoid endless retries for unavailable/deleted tweets.
          socialDogParentOwnerByTweetId.set(parentId, {
            userId: "",
            screenName: "",
            inReplyToUserId: "",
            inReplyToScreenName: ""
          });
        }
      }

      if (recomputeAllSocialDogReplyKinds()) {
        scheduleSocialDogNoticeUpdate();
      }
    } finally {
      socialDogParentLookupRunning = false;
      if (socialDogParentLookupPending.size > 0) {
        runSocialDogParentLookups();
      }
    }
  }

  async function fetchSocialDogTweetOwner(tweetId) {
    const ownerViaBackground = await fetchSocialDogTweetOwnerViaBackground(tweetId);
    if (ownerViaBackground !== undefined) {
      return ownerViaBackground;
    }

    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=0`;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "omit"
      });
      if (!response.ok) {
        return null;
      }
      const json = await response.json();
      return parseSocialDogTweetOwnerFromResult(json);
    } catch (_) {
      return null;
    }
  }

  async function fetchSocialDogTweetOwnerViaBackground(tweetId) {
    if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return undefined;
    }

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "socialcat:fetch-socialdog-tweet-owner",
            tweetId
          },
          (result) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                noReceiver: true
              });
              return;
            }
            resolve(result);
          }
        );
      });

      if (!response || typeof response !== "object") {
        return null;
      }
      if (response.noReceiver) {
        // Background is not available: fall back to page-context fetch.
        return undefined;
      }
      if (response.ok !== true) {
        return null;
      }
      const owner = parseSocialDogTweetOwnerFromResult(response.owner);
      return owner;
    } catch (_) {
      return undefined;
    }
  }

  function parseSocialDogTweetOwnerFromResult(json) {
    if (!json || typeof json !== "object") {
      return null;
    }
    const user = json.user && typeof json.user === "object" ? json.user : null;
    const normalizedScreenNameFromRaw =
      user && typeof user.screen_name === "string"
        ? user.screen_name.toLowerCase()
        : "";
    const normalizedUserIdFromRaw = normalizeStatusId(user && user.id_str ? user.id_str : "");
    const normalizedReplyToUserIdFromRaw = normalizeStatusId(json.in_reply_to_user_id_str || "");
    const normalizedReplyToScreenNameFromRaw =
      typeof json.in_reply_to_screen_name === "string"
        ? json.in_reply_to_screen_name.toLowerCase()
        : "";

    // Background response can already be normalized to these keys.
    const normalizedScreenNameFromNormalized =
      typeof json.screenName === "string" ? json.screenName.toLowerCase() : "";
    const normalizedUserIdFromNormalized = normalizeStatusId(json.userId || "");
    const normalizedReplyToUserIdFromNormalized = normalizeStatusId(json.inReplyToUserId || "");
    const normalizedReplyToScreenNameFromNormalized =
      typeof json.inReplyToScreenName === "string"
        ? json.inReplyToScreenName.toLowerCase()
        : "";

    const screenName = normalizedScreenNameFromNormalized || normalizedScreenNameFromRaw;
    const userId = normalizedUserIdFromNormalized || normalizedUserIdFromRaw;
    const inReplyToUserId =
      normalizedReplyToUserIdFromNormalized || normalizedReplyToUserIdFromRaw;
    const inReplyToScreenName =
      normalizedReplyToScreenNameFromNormalized || normalizedReplyToScreenNameFromRaw;
    if (!screenName && !userId && !inReplyToUserId && !inReplyToScreenName) {
      return null;
    }
    return {
      userId,
      screenName,
      inReplyToUserId,
      inReplyToScreenName
    };
  }

  function normalizeStatusId(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return "";
    }
    return trimmed;
  }

  function observeSocialDogTimeline() {
    if (socialDogTimelineObserver || !document.documentElement) {
      return;
    }
    socialDogTimelineObserver = new MutationObserver(() => {
      scheduleSocialDogNoticeUpdate();
    });
    socialDogTimelineObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function scheduleSocialDogNoticeUpdate() {
    if (socialDogNoticeTimer !== null) {
      return;
    }
    socialDogNoticeTimer = window.setTimeout(() => {
      socialDogNoticeTimer = null;
      applySocialDogReplyNotices();
    }, 120);
  }

  function installRouteWatcher() {
    if (routeWatcherInstalled) {
      return;
    }
    routeWatcherInstalled = true;

    const onRouteMaybeChanged = () => {
      if (!hasRouteChanged()) {
        return;
      }
      applyRetweetCollapse();
      applyXReplyNotices();
    };

    window.addEventListener("popstate", onRouteMaybeChanged, true);
    window.addEventListener("hashchange", onRouteMaybeChanged, true);
    window.addEventListener("pageshow", onRouteMaybeChanged, true);

    // X can navigate via the Navigation API without using History API hooks.
    const nav = window.navigation;
    if (nav && typeof nav.addEventListener === "function") {
      try {
        nav.addEventListener("currententrychange", onRouteMaybeChanged);
      } catch (_) {
        // Ignore unsupported/locked-down environments and keep other watchers.
      }
    }

    const originalPushState = history.pushState;
    history.pushState = function pushStatePatched() {
      const result = originalPushState.apply(this, arguments);
      onRouteMaybeChanged();
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function replaceStatePatched() {
      const result = originalReplaceState.apply(this, arguments);
      onRouteMaybeChanged();
      return result;
    };

    // Fallback in case the page overwrites history hooks after our patch.
    if (routeWatchFallbackTimer === null) {
      routeWatchFallbackTimer = window.setInterval(onRouteMaybeChanged, 500);
    }
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }
    settings = normalizeSettings(changes[STORAGE_KEY].newValue);
    applyRetweetCollapse();
    applyXReplyNotices();
  }

  function onKeyDown(event) {
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }

    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }

    const submitButton = findSubmitButton(editor);
    if (!submitButton || isButtonDisabled(submitButton)) {
      return;
    }

    const composerType = detectComposerType(editor, submitButton);
    const shouldSend =
      composerType === "reply"
        ? settings.enableReplyEnterSend
        : settings.enablePostEnterSend;

    if (!shouldSend) {
      return;
    }

    if (composerType === "reply") {
      maybeAutoLikeOnReply(editor, submitButton);
    }

    event.preventDefault();
    event.stopPropagation();
    submitButton.click();
  }

  function onBeforeInput(event) {
    if (event.defaultPrevented) {
      return;
    }

    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }
    if (editor.dataset[AUTO_INSERT_DATA_KEY] !== "1") {
      return;
    }
    if (!isManualInsertionInput(event)) {
      return;
    }

    const autoInsertedValue = editor.dataset[AUTO_INSERT_VALUE_KEY] || "";
    if (!isAutoInsertedTextStillPresent(editor, autoInsertedValue)) {
      clearAutoInsertState(editor);
      return;
    }

    clearEditorText(editor);
    clearAutoInsertState(editor);
  }

  function onFocusIn(event) {
    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }
    syncGreetingHighlight(editor);
    maybeInsertGreeting(editor);
  }

  function onClick(event) {
    const toggleHost = findRetweetToggleHostFromTarget(event.target);
    if (toggleHost) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const clickedContext = findRetweetContextFromTarget(event.target, toggleHost);
      toggleRetweetFromHost(toggleHost, clickedContext);
      return;
    }

    const button = closestButton(event.target);
    if (!button) {
      return;
    }

    if (isButtonDisabled(button)) {
      return;
    }

    if (settings.autoOpenReplyAfterLike && isLikeButton(button)) {
      window.setTimeout(() => {
        openReplyComposerForTweet(button);
      }, 120);
    }

    if (!isSubmitButton(button)) {
      return;
    }

    const editor = findEditorForSubmitButton(button);
    if (!editor) {
      return;
    }

    const composerType = detectComposerType(editor, button);
    if (composerType === "reply") {
      maybeAutoLikeOnReply(editor, button);
    }
  }

  function maybeInsertGreeting(editor) {
    if (!settings.greeting.enabled) {
      return;
    }
    if (editor.dataset[AUTO_INSERT_DATA_KEY] === "1") {
      return;
    }
    if (!isEditorEmpty(editor)) {
      return;
    }

    const now = new Date();
    const message = pickGreetingForNow(settings.greeting.ranges, now);
    if (!message) {
      return;
    }
    if (!shouldAutoInsertMorningGreeting(editor, message, now)) {
      return;
    }

    insertTextIntoEditor(editor, message);
    editor.dataset[AUTO_INSERT_DATA_KEY] = "1";
    editor.dataset[AUTO_INSERT_VALUE_KEY] = message;
    applyGreetingHighlight(editor);
  }

  function shouldAutoInsertMorningGreeting(editor, message, now) {
    if (!isMorningTime(now)) {
      return false;
    }
    if (!isOhatsuMessage(message)) {
      return false;
    }

    const submitButton = findSubmitButton(editor);
    if (!submitButton) {
      return false;
    }
    return detectComposerType(editor, submitButton) === "post";
  }

  function isMorningTime(now) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes >= MORNING_START_MINUTES && nowMinutes < MORNING_END_MINUTES;
  }

  function isOhatsuMessage(message) {
    if (typeof message !== "string") {
      return false;
    }
    return OHATSU_TEXT_PATTERN.test(message.trim());
  }

  function maybeAutoLikeOnReply(editor, submitButton) {
    if (!settings.autoLikeOnReply) {
      return;
    }
    if (editor.dataset.socialcatReplyLikeAttempted === "1") {
      return;
    }

    const article = findTweetArticleNearComposer(editor, submitButton);
    if (!article) {
      return;
    }

    const likeButton = article.querySelector(LIKE_BUTTON_SELECTOR);
    if (!likeButton || isButtonDisabled(likeButton)) {
      return;
    }

    editor.dataset.socialcatReplyLikeAttempted = "1";
    likeButton.click();

    window.setTimeout(() => {
      delete editor.dataset.socialcatReplyLikeAttempted;
    }, 1500);
  }

  function openReplyComposerForTweet(likeButton) {
    const article = likeButton.closest(TWEET_ARTICLE_SELECTOR);
    if (!article) {
      return;
    }
    const replyButton = article.querySelector(REPLY_BUTTON_SELECTOR);
    if (!replyButton || isButtonDisabled(replyButton)) {
      return;
    }
    replyButton.click();
  }

  function applyRetweetCollapse() {
    if (shouldCollapseRetweetsOnCurrentPage()) {
      ensureRetweetStyles();
      runRetweetCollapse();
      if (!retweetObserver) {
        retweetObserver = new MutationObserver(() => {
          if (hasRouteChanged()) {
            applyRetweetCollapse();
            return;
          }
          scheduleRetweetCollapse();
        });
        retweetObserver.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }
      return;
    }

    if (retweetObserver) {
      retweetObserver.disconnect();
      retweetObserver = null;
    }
    if (retweetCollapseTimer !== null) {
      window.clearTimeout(retweetCollapseTimer);
      retweetCollapseTimer = null;
    }
    retweetCollapseQueued = false;
    retweetCollapseRunning = false;
    clearRetweetCollapseArtifacts();
  }

  function scheduleRetweetCollapse() {
    if (!shouldCollapseRetweetsOnCurrentPage()) {
      return;
    }
    if (retweetCollapseTimer !== null) {
      retweetCollapseQueued = true;
      return;
    }

    retweetCollapseTimer = window.setTimeout(() => {
      retweetCollapseTimer = null;
      runRetweetCollapse();
    }, 180);
  }

  function runRetweetCollapse() {
    if (!shouldCollapseRetweetsOnCurrentPage() || retweetCollapseRunning) {
      return;
    }

    retweetCollapseRunning = true;
    try {
      collapseRetweetsInDocument();
    } finally {
      retweetCollapseRunning = false;
      if (retweetCollapseQueued) {
        retweetCollapseQueued = false;
        scheduleRetweetCollapse();
      }
    }
  }

  function collapseRetweetsInDocument() {
    pruneRecentExpandedRetweetKeys();
    const activeRetweetIds = new Set();
    const tweets = document.querySelectorAll(TWEET_ARTICLE_SELECTOR);
    for (const tweet of tweets) {
      if (!(tweet instanceof HTMLElement)) {
        continue;
      }
      if (!isRetweetArticle(tweet)) {
        continue;
      }

      const context = tweet.querySelector(RETWEET_CONTEXT_SELECTOR);
      if (!(context instanceof HTMLElement)) {
        continue;
      }

      const wrapper = findTweetWrapper(tweet);
      const key = getRetweetContentKey(tweet) || wrapper.getAttribute(RETWEET_KEY_ATTRIBUTE) || "";
      if (key) {
        wrapper.setAttribute(RETWEET_KEY_ATTRIBUTE, key);
      }
      const retweetId = ensureRetweetId(wrapper);

      // Determine expanded state from multiple sources:
      // 1. Article-level user-expanded flag (survives basic wrapper replacement)
      // 2. expandedRetweetKeys Set (content-based key)
      // 3. recent user-expand grace period (survives immediate remount)
      // 4. wrapper attribute (fast path)
      const userExpanded = tweet.getAttribute(RETWEET_USER_EXPANDED_ATTRIBUTE) === "1";
      const hasKeyInSet = Boolean(key && expandedRetweetKeys.has(key));
      const inExpandGrace = Boolean(key && isRetweetInUserExpandGrace(key));
      const wrapperExpanded = wrapper.getAttribute(RETWEET_EXPANDED_ATTRIBUTE) === "1";
      
      let isExpanded = userExpanded || hasKeyInSet || inExpandGrace || wrapperExpanded;

      upsertRetweetToggle(context, retweetId, isExpanded);
      setRetweetExpandedState(wrapper, tweet, context, isExpanded);
      activeRetweetIds.add(retweetId);
    }

    removeStaleRetweetToggles(activeRetweetIds);
  }

  function clearRetweetCollapseArtifacts() {
    restoreCollapsedNodes(document);
    clearArticleHeightAnimations(document);
    removeRetweetToggles();
    // Remove article-level user-expanded flags
    const userExpandedArticles = document.querySelectorAll(`[${RETWEET_USER_EXPANDED_ATTRIBUTE}="1"]`);
    for (const el of userExpandedArticles) {
      if (el instanceof HTMLElement) {
        el.removeAttribute(RETWEET_USER_EXPANDED_ATTRIBUTE);
      }
    }
    const wrappers = document.querySelectorAll(`[${RETWEET_ID_ATTRIBUTE}]`);
    for (const wrapper of wrappers) {
      if (!(wrapper instanceof HTMLElement)) {
        continue;
      }
      wrapper.removeAttribute(RETWEET_ID_ATTRIBUTE);
      wrapper.removeAttribute(RETWEET_KEY_ATTRIBUTE);
      wrapper.removeAttribute(RETWEET_EXPANDED_ATTRIBUTE);
    }
    expandedRetweetKeys.clear();
    recentExpandedRetweetKeys.clear();
  }

  function shouldCollapseRetweetsOnCurrentPage() {
    if (!settings.collapseRetweets) {
      return false;
    }
    if (isStatusDetailPage()) {
      return false;
    }
    return isHomeTimelinePage() || isProfileTimelinePage();
  }

  function hasRouteChanged() {
    const current = getRouteKey();
    if (current === lastRouteKey) {
      return false;
    }
    lastRouteKey = current;
    return true;
  }

  function getRouteKey() {
    return `${location.pathname}|${location.search}|${location.hash}`;
  }

  function isStatusDetailPage() {
    return /\/status\/\d+/i.test(location.pathname);
  }

  function isHomeTimelinePage() {
    const path = trimTrailingSlash(location.pathname.toLowerCase());
    return path === "/home";
  }

  function isProfileTimelinePage() {
    const path = trimTrailingSlash(location.pathname.toLowerCase());
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      return false;
    }

    const first = parts[0];
    if (NON_PROFILE_ROOT_PATHS.has(first)) {
      return false;
    }

    if (parts.length === 1) {
      return true;
    }
    if (parts.length === 2 && PROFILE_ALLOWED_SUBPATHS.has(parts[1])) {
      return true;
    }
    return false;
  }

  function trimTrailingSlash(path) {
    if (path.length > 1 && path.endsWith("/")) {
      return path.slice(0, -1);
    }
    return path;
  }

  function ensureRetweetStyles() {
    if (document.getElementById(RETWEET_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = RETWEET_STYLE_ID;
    style.textContent = `
      [${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"] {
        cursor: pointer;
        position: relative;
        padding-right: 1.1em;
      }
      [${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"]::after {
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        pointer-events: none;
        font-size: 0.82em;
        line-height: 1;
        opacity: 0.78;
      }
      [${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"][${RETWEET_TOGGLE_STATE_ATTRIBUTE}="collapsed"]::after {
        content: "\\25BC";
      }
      [${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"][${RETWEET_TOGGLE_STATE_ATTRIBUTE}="expanded"]::after {
        content: "\\25B2";
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureGreetingStyles() {
    if (document.getElementById(GREETING_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = GREETING_STYLE_ID;
    style.textContent = `
      .${GREETING_HIGHLIGHT_CLASS} {
        border: 1px solid #86efac !important;
        box-shadow: 0 0 0 2px rgba(187, 247, 208, 0.9) !important;
        border-radius: 10px !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureRetweetId(wrapper) {
    const existing = wrapper.getAttribute(RETWEET_ID_ATTRIBUTE);
    if (existing) {
      return existing;
    }
    retweetIdCounter += 1;
    const id = `sc-rt-${Date.now()}-${retweetIdCounter}`;
    wrapper.setAttribute(RETWEET_ID_ATTRIBUTE, id);
    return id;
  }

  function upsertRetweetToggle(context, retweetId, isExpanded) {
    const host = findRetweetToggleHost(context);
    host.setAttribute(RETWEET_TOGGLE_HOST_ATTRIBUTE, "1");
    host.setAttribute(RETWEET_TARGET_ATTRIBUTE, retweetId);
    host.setAttribute(RETWEET_TOGGLE_STATE_ATTRIBUTE, isExpanded ? "expanded" : "collapsed");
    host.setAttribute("title", isExpanded ? "クリックで折りたたみ" : "クリックで展開");
  }

  function removeStaleRetweetToggles(activeRetweetIds) {
    const hosts = document.querySelectorAll(`[${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"]`);
    for (const host of hosts) {
      if (!(host instanceof HTMLElement)) {
        continue;
      }
      const targetId = host.getAttribute(RETWEET_TARGET_ATTRIBUTE);
      if (!targetId || activeRetweetIds.has(targetId)) {
        continue;
      }
      host.removeAttribute(RETWEET_TOGGLE_HOST_ATTRIBUTE);
      host.removeAttribute(RETWEET_TARGET_ATTRIBUTE);
      host.removeAttribute(RETWEET_TOGGLE_STATE_ATTRIBUTE);
      host.removeAttribute(RETWEET_LAST_TOGGLE_AT_ATTRIBUTE);
      host.removeAttribute("title");
    }
  }

  function toggleRetweetFromHost(host, preferredContext) {
    const now = Date.now();
    const lastToggleAtRaw = host.getAttribute(RETWEET_LAST_TOGGLE_AT_ATTRIBUTE);
    const lastToggleAt = lastToggleAtRaw ? Number.parseInt(lastToggleAtRaw, 10) : 0;
    if (Number.isFinite(lastToggleAt) && now - lastToggleAt < RETWEET_TOGGLE_DEBOUNCE_MS) {
      return;
    }
    host.setAttribute(RETWEET_LAST_TOGGLE_AT_ATTRIBUTE, String(now));

    const context =
      preferredContext instanceof HTMLElement
        ? preferredContext
        : findRetweetContextFromHost(host);
    if (!(context instanceof HTMLElement)) {
      return;
    }
    const article = context.closest(TWEET_ARTICLE_SELECTOR);
    if (!(article instanceof HTMLElement)) {
      return;
    }
    const wrapper = findTweetWrapper(article);
    const targetId = ensureRetweetId(wrapper);
    const key = getRetweetContentKey(article) || wrapper.getAttribute(RETWEET_KEY_ATTRIBUTE) || "";
    if (key) {
      wrapper.setAttribute(RETWEET_KEY_ATTRIBUTE, key);
    }
    if (host.getAttribute(RETWEET_TARGET_ATTRIBUTE) !== targetId) {
      host.setAttribute(RETWEET_TARGET_ATTRIBUTE, targetId);
    }

    // Read current state from both article and wrapper to survive React re-renders
    const isExpanded =
      article.getAttribute(RETWEET_USER_EXPANDED_ATTRIBUTE) === "1" ||
      wrapper.getAttribute(RETWEET_EXPANDED_ATTRIBUTE) === "1";
    const nextExpanded = !isExpanded;

    // Mark article directly — this survives wrapper element replacement by React
    if (nextExpanded) {
      article.setAttribute(RETWEET_USER_EXPANDED_ATTRIBUTE, "1");
    } else {
      article.removeAttribute(RETWEET_USER_EXPANDED_ATTRIBUTE);
    }

    if (key) {
      if (nextExpanded) {
        expandedRetweetKeys.add(key);
        recentExpandedRetweetKeys.set(key, now);
      } else {
        expandedRetweetKeys.delete(key);
        recentExpandedRetweetKeys.delete(key);
      }
    }

    setRetweetExpandedState(wrapper, article, context, nextExpanded);
    upsertRetweetToggle(context, targetId, nextExpanded);
  }

  function setRetweetExpandedState(wrapper, article, context, isExpanded) {
    const previousExpanded = wrapper.getAttribute(RETWEET_EXPANDED_ATTRIBUTE) === "1";
    wrapper.setAttribute(RETWEET_EXPANDED_ATTRIBUTE, isExpanded ? "1" : "0");
    if (previousExpanded === isExpanded) {
      // Re-apply state for newly mounted nodes without retriggering a full animation.
      if (isExpanded) {
        restoreCollapsedNodes(article);
      } else {
        collapseTweetToContext(article, context);
      }
      return;
    }

    if (isExpanded) {
      animateArticleHeightChange(article, () => {
        restoreCollapsedNodes(article);
      });
      return;
    }
    animateArticleHeightChange(article, () => {
      collapseTweetToContext(article, context);
    });
  }

  function collapseTweetToContext(article, context) {
    restoreCollapsedNodes(article);

    let node = findRetweetToggleHost(context);
    while (node && node !== article) {
      const parent = node.parentElement;
      if (!parent) {
        break;
      }

      const siblings = Array.from(parent.children);
      for (const sibling of siblings) {
        if (!(sibling instanceof HTMLElement) || sibling === node) {
          continue;
        }
        collapseNode(sibling);
      }

      node = parent;
    }
  }

  function collapseNode(node) {
    if (node.getAttribute(RETWEET_COLLAPSED_NODE_ATTRIBUTE) === "1") {
      return;
    }
    node.setAttribute(RETWEET_COLLAPSED_NODE_ATTRIBUTE, "1");
    // Hiding visually without using display: none.
    // display: none causes IntersectionObserver to report invisible,
    // which makes React unmount the content and breaks the retweet key.
    node.style.height = "1px";
    node.style.overflow = "hidden";
    node.style.opacity = "0.001";
    node.style.margin = "0";
    node.style.padding = "0";
    node.style.border = "none";
  }

  function animateArticleHeightChange(article, mutateFn) {
    clearArticleHeightAnimation(article);

    const from = Math.max(1, article.getBoundingClientRect().height);
    article.style.overflow = "hidden";
    article.style.height = `${from}px`;
    article.style.transition = `height ${RETWEET_HEIGHT_ANIM_MS}ms ${RETWEET_HEIGHT_EASE}`;

    mutateFn();

    const to = Math.max(1, article.getBoundingClientRect().height);
    if (Math.abs(to - from) < 1) {
      clearArticleHeightAnimation(article);
      return;
    }

    article.style.height = `${from}px`;
    void article.offsetHeight;
    article.style.height = `${to}px`;

    const cleanup = () => {
      clearArticleHeightAnimation(article);
    };

    const onEnd = (event) => {
      if (event.target !== article || event.propertyName !== "height") {
        return;
      }
      article.removeEventListener("transitionend", onEnd);
      cleanup();
    };

    article.addEventListener("transitionend", onEnd);
    const timerId = window.setTimeout(() => {
      article.removeEventListener("transitionend", onEnd);
      cleanup();
    }, RETWEET_HEIGHT_ANIM_MS + 80);
    article.dataset.socialcatHeightAnimTimer = String(timerId);
  }

  function clearArticleHeightAnimation(article) {
    const timerRaw = article.dataset.socialcatHeightAnimTimer;
    if (timerRaw) {
      const timerId = Number.parseInt(timerRaw, 10);
      if (Number.isFinite(timerId)) {
        window.clearTimeout(timerId);
      }
      delete article.dataset.socialcatHeightAnimTimer;
    }
    article.style.height = "";
    article.style.overflow = "";
    article.style.transition = "";
  }

  function clearArticleHeightAnimations(root) {
    const articles = root.querySelectorAll(TWEET_ARTICLE_SELECTOR);
    for (const article of articles) {
      if (!(article instanceof HTMLElement)) {
        continue;
      }
      clearArticleHeightAnimation(article);
    }
  }

  function restoreCollapsedNodes(root) {
    const collapsed = root.querySelectorAll(`[${RETWEET_COLLAPSED_NODE_ATTRIBUTE}="1"]`);
    for (const node of collapsed) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      node.style.height = "";
      node.style.overflow = "";
      node.style.opacity = "";
      node.style.margin = "";
      node.style.padding = "";
      node.style.border = "";
      node.removeAttribute(RETWEET_COLLAPSED_NODE_ATTRIBUTE);
    }
  }

  function removeRetweetToggles() {
    const hosts = document.querySelectorAll(`[${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"]`);
    for (const host of hosts) {
      if (!(host instanceof HTMLElement)) {
        continue;
      }
      host.removeAttribute(RETWEET_TOGGLE_HOST_ATTRIBUTE);
      host.removeAttribute(RETWEET_TARGET_ATTRIBUTE);
      host.removeAttribute(RETWEET_TOGGLE_STATE_ATTRIBUTE);
      host.removeAttribute(RETWEET_LAST_TOGGLE_AT_ATTRIBUTE);
      host.removeAttribute("title");
    }
  }

  function findRetweetToggleHost(context) {
    const article = context.closest(TWEET_ARTICLE_SELECTOR);
    let node = context;
    while (node && node !== article) {
      if (node instanceof HTMLElement && isRetweetToggleHostCandidate(node, context)) {
        return node;
      }
      node = node.parentElement;
    }

    const parent = context.parentElement;
    if (parent instanceof HTMLElement) {
      return parent;
    }
    return context;
  }

  function isRetweetToggleHostCandidate(candidate, context) {
    if (!candidate.contains(context)) {
      return false;
    }

    const candidateRect = candidate.getBoundingClientRect();
    const contextRect = context.getBoundingClientRect();

    if (candidateRect.width <= contextRect.width + 12) {
      return false;
    }

    // Keep click area around the social-context row and avoid grabbing the whole tweet card.
    if (candidateRect.height > Math.max(contextRect.height + 20, 56)) {
      return false;
    }

    return true;
  }

  function findRetweetContextFromHost(host) {
    if (host.matches(RETWEET_CONTEXT_SELECTOR)) {
      return host;
    }
    const found = host.querySelector(RETWEET_CONTEXT_SELECTOR);
    return found instanceof HTMLElement ? found : null;
  }

  function findRetweetContextFromTarget(target, host) {
    if (!(target instanceof Element)) {
      return null;
    }
    const context = target.closest(RETWEET_CONTEXT_SELECTOR);
    if (!(context instanceof HTMLElement)) {
      return null;
    }
    if (host.contains(context)) {
      return context;
    }
    return null;
  }

  function applySocialDogReplyNotices() {
    const anchors = document.querySelectorAll(
      [
        '.user_list_sidebar_user_timeline_time a[href*="/status/"]',
        '.sc-bnMgcM.bFqtzZ a[href*="/status/"]'
      ].join(",")
    );
    const activeContainers = new Set();

    for (const anchor of anchors) {
      if (!(anchor instanceof HTMLAnchorElement)) {
        continue;
      }

      const tweetId = extractStatusIdFromHref(anchor.getAttribute("href") || "");
      if (!tweetId) {
        continue;
      }

      const container = findSocialDogNoticeContainer(anchor);
      if (!container) {
        continue;
      }
      activeContainers.add(container);

      const replyInfo = socialDogReplyInfoByTweetId.get(tweetId);
      if (!replyInfo || !replyInfo.parentId || !replyInfo.kind) {
        removeSocialDogReplyNotice(container);
        continue;
      }

      const isMatched = replyInfo.kind === "reply_to_my_reply";
      upsertSocialDogReplyNotice(container, isMatched);
    }

    const allNotices = document.querySelectorAll(`[${SOCIAL_DOG_NOTICE_ATTRIBUTE}="1"]`);
    for (const notice of allNotices) {
      if (!(notice instanceof HTMLElement)) {
        continue;
      }
      const container = notice.parentElement;
      if (!(container instanceof HTMLElement)) {
        continue;
      }
      if (activeContainers.has(container)) {
        continue;
      }
      removeSocialDogReplyNotice(container);
    }
  }

  function findSocialDogNoticeContainer(anchor) {
    const timeWrap = anchor.closest(".user_list_sidebar_user_timeline_time");
    if (timeWrap instanceof HTMLElement && timeWrap.parentElement instanceof HTMLElement) {
      return timeWrap.parentElement;
    }

    const compactContainer = anchor.closest(".sc-bnMgcM.bFqtzZ");
    if (compactContainer instanceof HTMLElement) {
      return compactContainer;
    }

    return anchor.parentElement instanceof HTMLElement ? anchor.parentElement : null;
  }

  function upsertSocialDogReplyNotice(container, isMatched) {
    let notice = container.querySelector(".my_reply_notice");
    if (!(notice instanceof HTMLElement)) {
      notice = document.createElement("div");
      const existingNotice = container.querySelector(".friendship_update_message:not(.my_reply_notice)");
      if (existingNotice instanceof HTMLElement) {
        notice.className = `${existingNotice.className} my_reply_notice`;
      } else {
        notice.className = "friendship_update_message my_reply_notice";
      }
    }

    notice.setAttribute("color", "warning");
    notice.setAttribute(SOCIAL_DOG_NOTICE_ATTRIBUTE, "1");
    const noticeBackground = isMatched ? "#16a34a" : "#2563eb";
    const noticeBorder = isMatched ? "#15803d" : "#1d4ed8";
    notice.style.background = noticeBackground;
    notice.style.color = "white";
    notice.style.border = `1px solid ${noticeBorder}`;
    notice.style.borderRadius = "999px";
    notice.style.padding = "4px 10px";
    notice.style.fontWeight = "700";
    notice.style.display = "inline-block";
    notice.style.maxWidth = "100%";
    notice.style.minWidth = "0";
    notice.style.boxSizing = "border-box";
    notice.style.whiteSpace = "normal";
    notice.style.overflowWrap = "anywhere";
    notice.style.wordBreak = "break-word";
    notice.style.lineHeight = "1.35";
    notice.style.flexShrink = "1";
    notice.textContent = isMatched
      ? "\u30ea\u30d7\u306b\u8fd4\u4fe1\u3055\u308c\u307e\u3057\u305f"
      : "\u30ea\u30d7\u30e9\u30a4\u304c\u5c4a\u304d\u307e\u3057\u305f";

    if (container.matches(".sc-bnMgcM.bFqtzZ")) {
      container.style.flexWrap = "wrap";
      container.style.rowGap = "6px";
      container.style.columnGap = "8px";
    }

    const timeWrap = container.querySelector(".user_list_sidebar_user_timeline_time");
    if (timeWrap instanceof HTMLElement) {
      container.insertBefore(notice, timeWrap);
      return;
    }
    const statusLink = container.querySelector('a[href*="/status/"]');
    if (statusLink instanceof HTMLElement) {
      container.insertBefore(notice, statusLink);
      return;
    }
    if (!container.contains(notice)) {
      container.insertBefore(notice, container.firstChild);
    }
  }

  function removeSocialDogReplyNotice(container) {
    const notices = container.querySelectorAll(".my_reply_notice");
    for (const notice of notices) {
      if (!(notice instanceof HTMLElement)) {
        continue;
      }
      if (notice.getAttribute(SOCIAL_DOG_NOTICE_ATTRIBUTE) !== "1") {
        continue;
      }
      notice.remove();
    }
  }

  function applyXReplyNotices() {
    if (shouldApplyXReplyNoticesOnCurrentPage()) {
      ensureXReplyNoticeStyles();
      runXReplyNotices();
      if (!xReplyNoticeObserver && document.documentElement) {
        xReplyNoticeObserver = new MutationObserver(() => {
          if (!shouldApplyXReplyNoticesOnCurrentPage()) {
            applyXReplyNotices();
            return;
          }
          scheduleXReplyNoticeUpdate();
        });
        xReplyNoticeObserver.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }
      return;
    }

    if (xReplyNoticeObserver) {
      xReplyNoticeObserver.disconnect();
      xReplyNoticeObserver = null;
    }
    if (xReplyNoticeTimer !== null) {
      window.clearTimeout(xReplyNoticeTimer);
      xReplyNoticeTimer = null;
    }
    clearXReplyNotices();
  }

  function shouldApplyXReplyNoticesOnCurrentPage() {
    const path = trimTrailingSlash(location.pathname.toLowerCase());
    return path === "/notifications" || path.startsWith("/notifications/");
  }

  function scheduleXReplyNoticeUpdate() {
    if (xReplyNoticeTimer !== null) {
      return;
    }
    xReplyNoticeTimer = window.setTimeout(() => {
      xReplyNoticeTimer = null;
      runXReplyNotices();
    }, 160);
  }

  function runXReplyNotices() {
    if (!shouldApplyXReplyNoticesOnCurrentPage()) {
      clearXReplyNotices();
      return;
    }

    const cells = document.querySelectorAll(X_NOTIFICATION_CELL_SELECTOR);
    const activeContainers = new Set();
    for (const cell of cells) {
      if (!(cell instanceof HTMLElement)) {
        continue;
      }

      const container = findXReplyNoticeContainer(cell);
      if (!container) {
        continue;
      }
      activeContainers.add(container);

      const kind = detectXReplyKindFromCell(cell);
      if (!kind) {
        removeXReplyNotice(container);
        continue;
      }
      upsertXReplyNotice(container, kind);
    }

    const notices = document.querySelectorAll(`[${X_REPLY_NOTICE_ATTRIBUTE}="1"]`);
    for (const notice of notices) {
      if (!(notice instanceof HTMLElement)) {
        continue;
      }
      const container = notice.parentElement;
      if (!(container instanceof HTMLElement)) {
        continue;
      }
      if (activeContainers.has(container)) {
        continue;
      }
      notice.remove();
    }
  }

  function detectXReplyKindFromText(text) {
    if (typeof text !== "string") {
      return "";
    }
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) {
      return "";
    }
    if (X_NON_REPLY_ACTION_PATTERN.test(normalized)) {
      return "";
    }
    if (!X_REPLY_VERB_PATTERN.test(normalized)) {
      return "";
    }
    if (X_REPLY_TO_REPLY_PATTERN.test(normalized)) {
      return "reply_to_my_reply";
    }
    if (X_REPLY_TO_POST_PATTERN.test(normalized)) {
      return "reply_to_my_tweet";
    }
    if (/\u3042\u306a\u305f\u306e(?:\u8fd4\u4fe1|\u30dd\u30b9\u30c8|\u30c4\u30a4\u30fc\u30c8)|\u3042\u306a\u305f\u306b|your (?:reply|post)|to you/.test(normalized)) {
      return "reply_to_my_tweet";
    }
    return "";
  }

  function detectXReplyKindFromCell(cell) {
    if (!(cell instanceof HTMLElement)) {
      return "";
    }

    const notificationArticle = cell.querySelector(X_NOTIFICATION_ARTICLE_SELECTOR);
    if (notificationArticle instanceof HTMLElement) {
      return detectXReplyKindFromText(notificationArticle.textContent || "");
    }

    const tweetArticle = cell.querySelector(TWEET_ARTICLE_SELECTOR);
    if (tweetArticle instanceof HTMLElement) {
      return detectXReplyKindFromTweetArticle(tweetArticle);
    }

    return detectXReplyKindFromText(cell.textContent || "");
  }

  function detectXReplyKindFromTweetArticle(article) {
    if (!(article instanceof HTMLElement)) {
      return "";
    }

    const text = article.textContent || "";
    if (!text || !X_REPLYING_TO_PATTERN.test(text)) {
      return "";
    }

    const tweetId = getStatusIdFromTweetArticle(article);
    if (!tweetId) {
      return "";
    }

    if (xReplyKindByTweetId.has(tweetId)) {
      return xReplyKindByTweetId.get(tweetId) || "";
    }

    queueXReplyKindLookup(tweetId);
    return "";
  }

  function getStatusIdFromTweetArticle(article) {
    if (!(article instanceof HTMLElement)) {
      return "";
    }

    const primaryStatusLink = article.querySelector('a[href*="/status/"] time');
    if (primaryStatusLink instanceof Element) {
      const anchor = primaryStatusLink.closest("a");
      if (anchor instanceof HTMLAnchorElement) {
        const primaryId = extractStatusIdFromHref(anchor.getAttribute("href") || "");
        if (primaryId) {
          return primaryId;
        }
      }
    }

    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement)) {
        continue;
      }
      const id = extractStatusIdFromHref(link.getAttribute("href") || "");
      if (id) {
        return id;
      }
    }
    return "";
  }

  function queueXReplyKindLookup(tweetId) {
    if (!tweetId || xReplyKindByTweetId.has(tweetId)) {
      return;
    }
    xReplyLookupPending.add(tweetId);
    runXReplyKindLookups();
  }

  async function runXReplyKindLookups() {
    if (xReplyLookupRunning) {
      return;
    }
    xReplyLookupRunning = true;
    try {
      while (xReplyLookupPending.size > 0) {
        const tweetId = xReplyLookupPending.values().next().value;
        xReplyLookupPending.delete(tweetId);
        const kind = await resolveXReplyKindFromTweetId(tweetId);
        xReplyKindByTweetId.set(tweetId, kind || "");
      }
    } finally {
      xReplyLookupRunning = false;
    }
    scheduleXReplyNoticeUpdate();
  }

  async function resolveXReplyKindFromTweetId(tweetId) {
    const result = await fetchXTweetResult(tweetId);
    return deriveXReplyKindFromTweetResult(result);
  }

  async function fetchXTweetResult(tweetId) {
    const endpoint = `${X_TWEET_RESULT_BASE}?id=${encodeURIComponent(tweetId)}&token=0`;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "omit"
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  function deriveXReplyKindFromTweetResult(result) {
    if (!result || typeof result !== "object") {
      return "";
    }

    const inReplyToStatusId = normalizeStatusId(result.in_reply_to_status_id_str || "");
    if (!inReplyToStatusId) {
      return "";
    }

    const parent = result.parent && typeof result.parent === "object" ? result.parent : null;
    if (!parent) {
      return "reply_to_my_tweet";
    }

    const inReplyToUserId = normalizeStatusId(result.in_reply_to_user_id_str || "");
    const parentUser =
      parent.user && typeof parent.user === "object" ? parent.user : null;
    const parentUserId = normalizeStatusId(parentUser && parentUser.id_str ? parentUser.id_str : "");
    const parentInReplyToStatusId = normalizeStatusId(parent.in_reply_to_status_id_str || "");

    if (inReplyToUserId && parentUserId && inReplyToUserId === parentUserId) {
      return parentInReplyToStatusId ? "reply_to_my_reply" : "reply_to_my_tweet";
    }

    if (parentInReplyToStatusId) {
      return "reply_to_my_reply";
    }
    return "reply_to_my_tweet";
  }

  function findXReplyNoticeContainer(cell) {
    if (!(cell instanceof HTMLElement)) {
      return null;
    }
    const tweetPlacement = cell.querySelector('div[data-testid="tweet"]');
    if (tweetPlacement instanceof HTMLElement) {
      return tweetPlacement;
    }
    const article = cell.querySelector(TWEET_ARTICLE_SELECTOR);
    if (article instanceof HTMLElement) {
      const placement = article.closest('div[data-testid="tweet"]');
      if (placement instanceof HTMLElement) {
        return placement;
      }
    }
    return cell;
  }

  function upsertXReplyNotice(container, kind) {
    let notice = container.querySelector(`.${X_REPLY_NOTICE_CLASS}`);
    if (!(notice instanceof HTMLElement)) {
      notice = document.createElement("div");
      notice.className = X_REPLY_NOTICE_CLASS;
    }

    notice.setAttribute(X_REPLY_NOTICE_ATTRIBUTE, "1");
    notice.setAttribute(X_REPLY_NOTICE_KIND_ATTRIBUTE, kind);
    notice.textContent =
      kind === "reply_to_my_reply"
        ? "\u30ea\u30d7\u306b\u8fd4\u4fe1\u3055\u308c\u307e\u3057\u305f"
        : "\u30ea\u30d7\u30e9\u30a4\u304c\u5c4a\u304d\u307e\u3057\u305f";

    if (!container.contains(notice)) {
      container.insertBefore(notice, container.firstChild);
    }
  }

  function removeXReplyNotice(container) {
    const notices = container.querySelectorAll(`.${X_REPLY_NOTICE_CLASS}`);
    for (const notice of notices) {
      if (!(notice instanceof HTMLElement)) {
        continue;
      }
      if (notice.getAttribute(X_REPLY_NOTICE_ATTRIBUTE) !== "1") {
        continue;
      }
      notice.remove();
    }
  }

  function clearXReplyNotices() {
    const notices = document.querySelectorAll(`[${X_REPLY_NOTICE_ATTRIBUTE}="1"]`);
    for (const notice of notices) {
      if (notice instanceof HTMLElement) {
        notice.remove();
      }
    }
  }

  function ensureXReplyNoticeStyles() {
    if (document.getElementById(X_REPLY_NOTICE_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = X_REPLY_NOTICE_STYLE_ID;
    style.textContent = `
      .${X_REPLY_NOTICE_CLASS} {
        display: inline-block;
        margin: 4px 0 8px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
        color: #fff;
        max-width: 100%;
        box-sizing: border-box;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .${X_REPLY_NOTICE_CLASS}[${X_REPLY_NOTICE_KIND_ATTRIBUTE}="reply_to_my_reply"] {
        background: #16a34a;
        border: 1px solid #15803d;
      }
      .${X_REPLY_NOTICE_CLASS}[${X_REPLY_NOTICE_KIND_ATTRIBUTE}="reply_to_my_tweet"] {
        background: #2563eb;
        border: 1px solid #1d4ed8;
      }
    `;
    const parent = document.head || document.documentElement;
    if (!parent) {
      return;
    }
    parent.appendChild(style);
  }

  function getRetweetContentKey(article) {
    const primaryStatusLink = article.querySelector('a[href*="/status/"] time');
    if (primaryStatusLink instanceof Element) {
      const anchor = primaryStatusLink.closest("a");
      if (anchor instanceof HTMLAnchorElement) {
        const primaryId = extractStatusIdFromHref(anchor.getAttribute("href") || "");
        if (primaryId) {
          return `status:${primaryId}`;
        }
      }
    }

    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement)) {
        continue;
      }
      const id = extractStatusIdFromHref(link.getAttribute("href") || "");
      if (id) {
        return `status:${id}`;
      }
    }

    // Fallback key using stable text parts that do not depend on counters.
    const contextText = normalizeKeyText(article.querySelector(RETWEET_CONTEXT_SELECTOR)?.textContent || "");
    const userNameNode = article.querySelector('[data-testid="User-Name"]');
    const headerText = userNameNode ? normalizeKeyText(userNameNode.textContent || "") : "";
    const bodyNode = article.querySelector('[data-testid="tweetText"]');
    const bodyText = bodyNode ? normalizeKeyText(bodyNode.textContent || "").slice(0, 120) : "";
    
    const parts = [];
    if (contextText) {
      parts.push(`c:${contextText}`);
    }
    if (headerText) {
      parts.push(`u:${headerText}`);
    }
    if (bodyText) {
      parts.push(`t:${bodyText}`);
    }

    if (parts.length === 0) {
      return "";
    }
    return `fallback:${parts.join("|")}`;
  }

  function normalizeKeyText(text) {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function extractStatusIdFromHref(href) {
    const idMatch = href.match(/\/status\/(\d+)/i);
    if (!idMatch) {
      return "";
    }
    return idMatch[1];
  }

  function isRetweetInUserExpandGrace(key) {
    const expandedAt = recentExpandedRetweetKeys.get(key);
    if (!expandedAt) {
      return false;
    }
    if (Date.now() - expandedAt > RETWEET_USER_EXPAND_GRACE_MS) {
      recentExpandedRetweetKeys.delete(key);
      return false;
    }
    return true;
  }

  function pruneRecentExpandedRetweetKeys() {
    const now = Date.now();
    for (const [key, expandedAt] of recentExpandedRetweetKeys.entries()) {
      if (now - expandedAt > RETWEET_USER_EXPAND_GRACE_MS) {
        recentExpandedRetweetKeys.delete(key);
      }
    }
  }

  function findRetweetToggleHostFromTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    const host = target.closest(`[${RETWEET_TOGGLE_HOST_ATTRIBUTE}="1"]`);
    return host instanceof HTMLElement ? host : null;
  }

  function isRetweetArticle(article) {
    const context = article.querySelector(RETWEET_CONTEXT_SELECTOR);
    if (!context) {
      return false;
    }
    const contextText = (context.textContent || "").toLowerCase();
    return RETWEET_WORDS.test(contextText);
  }

  function findTweetWrapper(article) {
    // Use the outer placement container when available, fallback to article itself.
    const placement = article.closest('div[data-testid="placementTracking"]');
    return placement instanceof HTMLElement ? placement : article;
  }

  function findTweetArticleNearComposer(editor, submitButton) {
    const dialog = editor.closest('div[role="dialog"]');
    if (dialog) {
      const articles = Array.from(dialog.querySelectorAll(TWEET_ARTICLE_SELECTOR));
      if (articles.length > 0) {
        return pickClosestElement(submitButton || editor, articles);
      }
    }

    let node = editor.parentElement;
    while (node && node !== document.body) {
      const articles = node.querySelectorAll(TWEET_ARTICLE_SELECTOR);
      if (articles.length > 0) {
        const closest = pickClosestElement(submitButton || editor, articles);
        if (closest) {
          return closest;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function pickGreetingForNow(ranges, now) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const activeRanges = ranges.filter((range) => {
      if (!range.enabled) {
        return false;
      }
      const startMinutes = toMinutes(range.start);
      const endMinutes = toMinutes(range.end);
      return isInTimeRange(nowMinutes, startMinutes, endMinutes);
    });

    for (const range of activeRanges) {
      const messages = range.messages.filter((msg) => msg.length > 0);
      if (messages.length === 0) {
        continue;
      }
      if (range.random && messages.length > 1) {
        return messages[Math.floor(Math.random() * messages.length)];
      }
      return messages[0];
    }
    return null;
  }

  function isInTimeRange(current, start, end) {
    if (start === end) {
      return true;
    }
    if (start < end) {
      return current >= start && current < end;
    }
    return current >= start || current < end;
  }

  function toMinutes(value) {
    const [hoursRaw, minutesRaw] = value.split(":");
    const hours = Number.parseInt(hoursRaw, 10);
    const minutes = Number.parseInt(minutesRaw, 10);
    return hours * 60 + minutes;
  }

  function insertTextIntoEditor(editor, text) {
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      document.execCommand("insertText", false, text);
    } else {
      range.insertNode(document.createTextNode(text));
    }

    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      })
    );
  }

  function clearEditorText(editor) {
    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.deleteContents();
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editor.textContent = "";
    }

    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
        data: null
      })
    );
  }

  function clearAutoInsertState(editor) {
    delete editor.dataset[AUTO_INSERT_DATA_KEY];
    delete editor.dataset[AUTO_INSERT_VALUE_KEY];
    clearGreetingHighlight(editor);
  }

  function applyGreetingHighlight(editor) {
    editor.classList.add(GREETING_HIGHLIGHT_CLASS);
  }

  function clearGreetingHighlight(editor) {
    editor.classList.remove(GREETING_HIGHLIGHT_CLASS);
  }

  function syncGreetingHighlight(editor) {
    if (editor.dataset[AUTO_INSERT_DATA_KEY] !== "1") {
      clearGreetingHighlight(editor);
      return;
    }

    const autoInsertedValue = editor.dataset[AUTO_INSERT_VALUE_KEY] || "";
    if (!isAutoInsertedTextStillPresent(editor, autoInsertedValue)) {
      clearAutoInsertState(editor);
      return;
    }

    applyGreetingHighlight(editor);
  }

  function isManualInsertionInput(event) {
    const type = typeof event.inputType === "string" ? event.inputType : "";
    if (!type.startsWith("insert")) {
      return false;
    }
    if (type === "insertLineBreak" || type === "insertParagraph") {
      return false;
    }
    return true;
  }

  function isAutoInsertedTextStillPresent(editor, autoInsertedValue) {
    if (!autoInsertedValue) {
      return false;
    }
    const current = normalizeEditorText(editor.innerText || editor.textContent || "");
    const inserted = normalizeEditorText(autoInsertedValue);
    return current === inserted;
  }

  function normalizeEditorText(text) {
    return text.replace(/\u200B/g, "").replace(/\r/g, "").trim();
  }

  function isEditorEmpty(editor) {
    const raw = editor.innerText || editor.textContent || "";
    return normalizeEditorText(raw).length === 0;
  }

  function findEditor(target) {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    if (target.matches(EDITOR_SELECTOR)) {
      return target;
    }
    return target.closest(EDITOR_SELECTOR);
  }

  function findEditorForSubmitButton(button) {
    let node = button;
    while (node && node !== document.body) {
      const localCandidate = pickClosestElement(button, node.querySelectorAll(EDITOR_SELECTOR));
      if (localCandidate) {
        return localCandidate;
      }
      node = node.parentElement;
    }
    return pickClosestElement(button, document.querySelectorAll(EDITOR_SELECTOR));
  }

  function findSubmitButton(editor) {
    let node = editor;
    while (node && node !== document.body) {
      const localCandidate = pickClosestElement(
        editor,
        node.querySelectorAll(SUBMIT_BUTTON_SELECTOR)
      );
      if (localCandidate) {
        return localCandidate;
      }
      node = node.parentElement;
    }
    return pickClosestElement(editor, document.querySelectorAll(SUBMIT_BUTTON_SELECTOR));
  }

  function closestButton(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    if (target instanceof HTMLButtonElement) {
      return target;
    }
    return target.closest("button");
  }

  function isSubmitButton(button) {
    return button.matches(SUBMIT_BUTTON_SELECTOR);
  }

  function isLikeButton(button) {
    return button.matches(LIKE_BUTTON_SELECTOR);
  }

  function detectComposerType(editor, submitButton) {
    const combined = [
      submitButton.getAttribute("aria-label") || "",
      submitButton.textContent || "",
      editor.getAttribute("aria-label") || "",
      location.pathname,
      location.search
    ]
      .join(" ")
      .toLowerCase();

    if (REPLY_WORDS.test(combined)) {
      return "reply";
    }
    if (POST_WORDS.test(combined)) {
      return "post";
    }
    if (isLikelyReplyByLocation()) {
      return "reply";
    }
    return "post";
  }

  function isLikelyReplyByLocation() {
    const params = new URLSearchParams(location.search);
    if (params.has("reply_to")) {
      return true;
    }
    return /\/status\/\d+/i.test(location.pathname);
  }

  function pickClosestElement(reference, candidates) {
    const visible = Array.from(candidates).filter((candidate) => {
      if (!(candidate instanceof HTMLElement)) {
        return false;
      }
      if (!isVisible(candidate)) {
        return false;
      }
      return true;
    });

    if (visible.length === 0) {
      return null;
    }
    if (visible.length === 1) {
      return visible[0];
    }

    const refRect = reference.getBoundingClientRect();
    const refX = refRect.left + refRect.width / 2;
    const refY = refRect.top + refRect.height / 2;

    visible.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const aDx = aRect.left + aRect.width / 2 - refX;
      const aDy = aRect.top + aRect.height / 2 - refY;
      const bDx = bRect.left + bRect.width / 2 - refX;
      const bDy = bRect.top + bRect.height / 2 - refY;
      return aDx * aDx + aDy * aDy - (bDx * bDx + bDy * bDy);
    });

    return visible[0];
  }

  function isButtonDisabled(button) {
    return button.disabled || button.getAttribute("aria-disabled") === "true";
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

    const normalizedRanges = rawRanges
      .map((range, index) => normalizeRange(range, index))
      .filter(Boolean);

    if (normalizedRanges.length === 0) {
      normalizedRanges.push(normalizeRange(base.greeting.ranges[0], 0));
    }

    merged.greeting.ranges = normalizedRanges;
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
    const start = normalizeTime(range.start, "05:00");
    const end = normalizeTime(range.end, "12:00");
    const rawMessages = Array.isArray(range.messages)
      ? range.messages
      : typeof range.messages === "string"
      ? [range.messages]
      : [];
    const messages = rawMessages
      .map((message) => (typeof message === "string" ? message.trim() : ""))
      .filter((message) => message.length > 0);

    return {
      id:
        typeof range.id === "string" && range.id.length > 0
          ? range.id
          : `range-${Date.now()}-${index}`,
      enabled: range.enabled !== false,
      start,
      end,
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

  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
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
})();
