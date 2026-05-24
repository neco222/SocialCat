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

  const AUTO_INSERT_DATA_KEY = "socialcatGreetingInserted";
  const AUTO_INSERT_VALUE_KEY = "socialcatGreetingValue";
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

  init();

  async function init() {
    settings = await loadSettings();
    lastRouteKey = getRouteKey();
    installRouteWatcher();
    applyRetweetCollapse();

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClick, true);

    chrome.storage.onChanged.addListener(onStorageChanged);
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
    };

    window.addEventListener("popstate", onRouteMaybeChanged, true);
    window.addEventListener("hashchange", onRouteMaybeChanged, true);

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
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }
    settings = normalizeSettings(changes[STORAGE_KEY].newValue);
    applyRetweetCollapse();
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

    const message = pickGreetingForNow(settings.greeting.ranges, new Date());
    if (!message) {
      return;
    }

    insertTextIntoEditor(editor, message);
    editor.dataset[AUTO_INSERT_DATA_KEY] = "1";
    editor.dataset[AUTO_INSERT_VALUE_KEY] = message;
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
    return `${location.pathname}|${location.search}`;
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
