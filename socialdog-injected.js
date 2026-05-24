(() => {
  "use strict";

  if (window.__socialcatSocialDogBridgeActive) {
    return;
  }
  window.__socialcatSocialDogBridgeActive = true;

  const EVENT_NAME = "socialcat:socialdog-api";
  const USERS_API_PATH = "/user_list/api_get_users";
  const MENTIONS_API_PATH = "/user_list/api_get_mentions";

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  function normalizeUrl(rawUrl) {
    try {
      return new URL(String(rawUrl || ""), location.href).href;
    } catch (_) {
      return String(rawUrl || "");
    }
  }

  function getPathname(rawUrl) {
    try {
      return new URL(rawUrl, location.href).pathname;
    } catch (_) {
      return "";
    }
  }

  function isTargetApi(rawUrl) {
    const path = getPathname(rawUrl);
    return path === USERS_API_PATH || path === MENTIONS_API_PATH;
  }

  function parseJsonSafe(text) {
    if (typeof text !== "string" || text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function dispatchPayload(url, payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: {
          url,
          payload
        }
      })
    );
  }

  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(...args) {
      const input = args[0];
      const requestUrl = input instanceof Request ? input.url : String(input || "");
      const normalizedUrl = normalizeUrl(requestUrl);

      return originalFetch.apply(this, args).then((response) => {
        if (!isTargetApi(normalizedUrl)) {
          return response;
        }
        try {
          response
            .clone()
            .text()
            .then((text) => {
              const payload = parseJsonSafe(text);
              dispatchPayload(normalizedUrl, payload);
            })
            .catch(() => {});
        } catch (_) {}
        return response;
      });
    };
  }

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__socialcatRequestUrl = normalizeUrl(url);
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    this.addEventListener("load", () => {
      const requestUrl = this.__socialcatRequestUrl || "";
      if (!isTargetApi(requestUrl)) {
        return;
      }
      let payload = null;
      if (this.responseType === "json") {
        payload = this.response && typeof this.response === "object" ? this.response : null;
      } else if (!this.responseType || this.responseType === "text") {
        payload = parseJsonSafe(this.responseText || "");
      }
      dispatchPayload(requestUrl, payload);
    });

    return originalXhrSend.apply(this, args);
  };
})();
