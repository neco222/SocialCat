(() => {
  "use strict";

  const REQUEST_TYPE = "socialcat:fetch-socialdog-tweet-owner";
  const TWEET_RESULT_BASE = "https://cdn.syndication.twimg.com/tweet-result";
  const ownerCache = new Map();
  const pendingRequests = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== REQUEST_TYPE) {
      return false;
    }

    const tweetId = normalizeStatusId(message.tweetId);
    if (!tweetId) {
      sendResponse({ ok: false });
      return false;
    }

    if (ownerCache.has(tweetId)) {
      sendResponse({ ok: true, owner: ownerCache.get(tweetId) });
      return false;
    }

    getTweetOwner(tweetId)
      .then((owner) => {
        if (owner) {
          ownerCache.set(tweetId, owner);
          trimCache();
          sendResponse({ ok: true, owner });
          return;
        }
        sendResponse({ ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });

    return true;
  });

  async function getTweetOwner(tweetId) {
    if (pendingRequests.has(tweetId)) {
      return pendingRequests.get(tweetId);
    }

    const promise = fetchTweetOwner(tweetId).finally(() => {
      pendingRequests.delete(tweetId);
    });
    pendingRequests.set(tweetId, promise);
    return promise;
  }

  async function fetchTweetOwner(tweetId) {
    const endpoint = `${TWEET_RESULT_BASE}?id=${encodeURIComponent(tweetId)}&token=0`;
    const response = await fetch(endpoint, {
      method: "GET",
      credentials: "omit"
    });
    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const user = json && typeof json === "object" && json.user && typeof json.user === "object"
      ? json.user
      : null;
    const screenName =
      user && typeof user.screen_name === "string"
        ? user.screen_name.toLowerCase()
        : "";
    const userId = normalizeStatusId(user && user.id_str ? user.id_str : "");
    const inReplyToUserId = normalizeStatusId(
      json && typeof json === "object" ? json.in_reply_to_user_id_str || "" : ""
    );
    const inReplyToScreenName =
      json && typeof json === "object" && typeof json.in_reply_to_screen_name === "string"
        ? json.in_reply_to_screen_name.toLowerCase()
        : "";

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

  function trimCache() {
    const maxSize = 600;
    if (ownerCache.size <= maxSize) {
      return;
    }
    const excess = ownerCache.size - maxSize;
    const keys = ownerCache.keys();
    for (let i = 0; i < excess; i += 1) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      ownerCache.delete(next.value);
    }
  }
})();
