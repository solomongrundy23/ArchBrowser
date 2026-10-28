/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
var __webpack_exports__ = {};

;// CONCATENATED MODULE: ./Extensions/combined/src/config.js
const PROD_API_URL = "https://returnyoutubedislikeapi.com";
const DEV_API_URL = PROD_API_URL;

const runtime = typeof chrome !== "undefined" ? chrome.runtime : null;
const manifest = typeof runtime?.getManifest === "function" ? runtime.getManifest() : null;
const isDevelopment = !manifest || !("update_url" in manifest);

const extensionChangelogUrl =
  runtime && typeof runtime.getURL === "function"
    ? runtime.getURL("changelog/4/changelog_4.0.html")
    : "https://returnyoutubedislike.com/changelog/4/changelog_4.0.html";

const config = {
  apiUrl: isDevelopment ? DEV_API_URL : PROD_API_URL,

  voteDisabledIconName: "icon_hold128.png",
  defaultIconName: "icon128.png",

  links: {
    website: "https://returnyoutubedislike.com",
    github: "https://github.com/Anarios/return-youtube-dislike",
    discord: "https://discord.gg/mYnESY4Md5",
    donate: "https://returnyoutubedislike.com/donate",
    faq: "https://returnyoutubedislike.com/faq",
    help: "https://returnyoutubedislike.com/help",
    changelog: extensionChangelogUrl,
  },

  defaultExtConfig: {
    disableVoteSubmission: false,
    disableLogging: true,
    coloredThumbs: false,
    coloredBar: false,
    colorTheme: "classic",
    numberDisplayFormat: "compactShort",
    numberDisplayReformatLikes: false,
    hidePremiumTeaser: false,
    hideClutterButtons: false,
  },
};

function getApiUrl() {
  return config.apiUrl;
}

function getApiEndpoint(endpoint) {
  return `${config.apiUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
}

function getChangelogUrl() {
  return config.links?.changelog ?? extensionChangelogUrl;
}



;// CONCATENATED MODULE: ./Extensions/combined/src/github-login-error.js
const GITHUB_ERROR_MESSAGES = {
  github_not_configured: "githubLoginUnavailable",
  github_unavailable: "githubLoginUnavailable",
  not_contributor: "githubLoginNotContributor",
  github_redirect_rejected: "githubLoginBrowserUnavailable",
  github_invalid_state: "githubLoginExpired",
  github_pkce_required: "githubLoginUpdateRequired",
  github_rate_limited: "githubLoginRateLimited",
  github_authorization_denied: "githubLoginDenied",
};

function getGitHubLoginErrorMessage(error, getMessage) {
  const key = Object.prototype.hasOwnProperty.call(GITHUB_ERROR_MESSAGES, error)
    ? GITHUB_ERROR_MESSAGES[error]
    : "githubLoginCompleteFailed";
  return getMessage(key);
}

;// CONCATENATED MODULE: ./Extensions/combined/src/data-collection-permissions.js
const AUTHENTICATION_DATA_PERMISSION = "authenticationInfo";
const ACCOUNT_DATA_PERMISSIONS = Object.freeze([AUTHENTICATION_DATA_PERMISSION]);
const AUTHENTICATION_DATA_DESCRIPTOR = Object.freeze({
  data_collection: ACCOUNT_DATA_PERMISSIONS,
});

function getRuntimeApi() {
  if (typeof browser !== "undefined" && browser?.runtime) return browser.runtime;
  if (typeof chrome !== "undefined" && chrome?.runtime) return chrome.runtime;
  return null;
}

function getPermissionsApi() {
  if (typeof browser !== "undefined" && browser?.permissions) return browser.permissions;
  if (typeof chrome !== "undefined" && chrome?.permissions) return chrome.permissions;
  return null;
}

function usesFirefoxDataCollectionConsent() {
  const manifest = getRuntimeApi()?.getManifest?.();
  return Boolean(manifest?.browser_specific_settings?.gecko?.data_collection_permissions);
}

function callFirefoxPermissionMethod(methodName) {
  const permissions = getPermissionsApi();
  const method = permissions?.[methodName];
  if (typeof method !== "function") return Promise.resolve(false);

  try {
    return Promise.resolve(method.call(permissions, AUTHENTICATION_DATA_DESCRIPTOR)).then(Boolean, () => false);
  } catch (_) {
    return Promise.resolve(false);
  }
}

function queryBackgroundForAuthenticationDataPermission() {
  const runtime = getRuntimeApi();
  if (typeof runtime?.sendMessage !== "function") return Promise.resolve(false);

  if (typeof browser !== "undefined" && browser?.runtime === runtime) {
    try {
      return Promise.resolve(runtime.sendMessage({ message: "ryd_has_authentication_consent" }))
        .then((response) => response?.granted === true)
        .catch(() => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  return new Promise((resolve) => {
    try {
      runtime.sendMessage({ message: "ryd_has_authentication_consent" }, (response) => {
        if (runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(response?.granted === true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function hasAuthenticationDataPermission({ queryBackground = true } = {}) {
  if (!usesFirefoxDataCollectionConsent()) return Promise.resolve(true);
  if (typeof getPermissionsApi()?.contains === "function") return callFirefoxPermissionMethod("contains");
  return queryBackground ? queryBackgroundForAuthenticationDataPermission() : Promise.resolve(false);
}

function requestAuthenticationDataPermission() {
  if (!usesFirefoxDataCollectionConsent()) return Promise.resolve(true);

  // Keep this direct request as the first operation in the login click stack.
  // Firefox requires optional data-collection consent requests to originate from a user gesture.
  return callFirefoxPermissionMethod("request");
}

function authenticationDataPermissionWasRemoved(removedPermissions) {
  return ACCOUNT_DATA_PERMISSIONS.some((permission) => removedPermissions?.data_collection?.includes(permission));
}

function onAuthenticationDataPermissionRemoved(listener) {
  const event = getPermissionsApi()?.onRemoved;
  if (!usesFirefoxDataCollectionConsent() || typeof event?.addListener !== "function") return () => {};

  const wrapped = (removedPermissions) => {
    if (authenticationDataPermissionWasRemoved(removedPermissions)) listener();
  };
  event.addListener(wrapped);
  return () => event.removeListener?.(wrapped);
}



;// CONCATENATED MODULE: ./Extensions/combined/popup.js




/*   Config   */
const popup_config = {
  advanced: false,
  disableVoteSubmission: false,
  disableLogging: true,
  coloredThumbs: false,
  coloredBar: false,
  colorTheme: "classic",
  numberDisplayFormat: "compactShort",
  showTooltipPercentage: false,
  tooltipPercentageMode: "dash_like",
  numberDisplayReformatLikes: false,
  hidePremiumTeaser: false,
  hideClutterButtons: false,
  showAdvancedMessage:
    '<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><rect fill="none" height="24" width="24"/><path d="M19.5,12c0-0.23-0.01-0.45-0.03-0.68l1.86-1.41c0.4-0.3,0.51-0.86,0.26-1.3l-1.87-3.23c-0.25-0.44-0.79-0.62-1.25-0.42 l-2.15,0.91c-0.37-0.26-0.76-0.49-1.17-0.68l-0.29-2.31C14.8,2.38,14.37,2,13.87,2h-3.73C9.63,2,9.2,2.38,9.14,2.88L8.85,5.19 c-0.41,0.19-0.8,0.42-1.17,0.68L5.53,4.96c-0.46-0.2-1-0.02-1.25,0.42L2.41,8.62c-0.25,0.44-0.14,0.99,0.26,1.3l1.86,1.41 C4.51,11.55,4.5,11.77,4.5,12s0.01,0.45,0.03,0.68l-1.86,1.41c-0.4,0.3-0.51,0.86-0.26,1.3l1.87,3.23c0.25,0.44,0.79,0.62,1.25,0.42 l2.15-0.91c0.37,0.26,0.76,0.49,1.17,0.68l0.29,2.31C9.2,21.62,9.63,22,10.13,22h3.73c0.5,0,0.93-0.38,0.99-0.88l0.29-2.31 c0.41-0.19,0.8-0.42,1.17-0.68l2.15,0.91c0.46,0.2,1,0.02,1.25-0.42l1.87-3.23c0.25-0.44,0.14-0.99-0.26-1.3l-1.86-1.41 C19.49,12.45,19.5,12.23,19.5,12z M12.04,15.5c-1.93,0-3.5-1.57-3.5-3.5s1.57-3.5,3.5-3.5s3.5,1.57,3.5,3.5S13.97,15.5,12.04,15.5z"/></svg>',
  hideAdvancedMessage:
    '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none" opacity=".87"/><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm4.3 14.3c-.39.39-1.02.39-1.41 0L12 13.41 9.11 16.3c-.39.39-1.02.39-1.41 0-.39-.39-.39-1.02 0-1.41L10.59 12 7.7 9.11c-.39-.39-.39-1.02 0-1.41.39-.39 1.02-.39 1.41 0L12 10.59l2.89-2.89c.39-.39 1.02-.39 1.41 0 .39.39.39 1.02 0 1.41L13.41 12l2.89 2.89c.38.38.38 1.02 0 1.41z"/></svg>',
  links: config.links,
};

/*   Change language   */
function localizeHtmlPage() {
  //Localize by replacing __MSG_***__ meta tags
  var objects = document.getElementsByTagName("html");
  for (var j = 0; j < objects.length; j++) {
    var obj = objects[j];

    var valStrH = obj.innerHTML.toString();
    var valNewH = valStrH.replace(/__MSG_(\w+)__/g, function (match, v1) {
      return v1 ? chrome.i18n.getMessage(v1) : "";
    });

    if (valNewH != valStrH) {
      obj.innerHTML = valNewH;
    }
  }
}

localizeHtmlPage();

/*   Links   */
createLink(popup_config.links.website, "link_website");
createLink(popup_config.links.github, "link_github");
createLink(popup_config.links.discord, "link_discord");
createLink(popup_config.links.faq, "link_faq");
createLink(popup_config.links.donate, "link_donate");
createLink(popup_config.links.help, "link_help");
createLink(popup_config.links.changelog, "link_changelog");

function createLink(url, id) {
  document.getElementById(id).addEventListener("click", () => {
    chrome.tabs.create({ url: url });
  });
}

document.getElementById("disable_vote_submission").addEventListener("click", (ev) => {
  chrome.storage.local.set({ disableVoteSubmission: ev.target.checked });
});

document.getElementById("disable_logging").addEventListener("click", (ev) => {
  chrome.storage.local.set({ disableLogging: ev.target.checked });
});

document.getElementById("colored_thumbs").addEventListener("click", (ev) => {
  chrome.storage.local.set({ coloredThumbs: ev.target.checked });
});

document.getElementById("colored_bar").addEventListener("click", (ev) => {
  chrome.storage.local.set({ coloredBar: ev.target.checked });
});

document.getElementById("color_theme").addEventListener("click", (ev) => {
  chrome.storage.local.set({ colorTheme: ev.target.value });
});

document.getElementById("number_format").addEventListener("change", (ev) => {
  chrome.storage.local.set({ numberDisplayFormat: ev.target.value });
});

document.getElementById("show_tooltip_percentage").addEventListener("click", (ev) => {
  chrome.storage.local.set({ showTooltipPercentage: ev.target.checked });
});

document.getElementById("tooltip_percentage_mode").addEventListener("change", (ev) => {
  chrome.storage.local.set({ tooltipPercentageMode: ev.target.value });
});

document.getElementById("number_reformat_likes").addEventListener("click", (ev) => {
  chrome.storage.local.set({ numberDisplayReformatLikes: ev.target.checked });
});

document.getElementById("hide_premium_teaser").addEventListener("click", (ev) => {
  chrome.storage.local.set({ hidePremiumTeaser: ev.target.checked });
});

document.getElementById("hide_clutter_buttons").addEventListener("click", (ev) => {
  chrome.storage.local.set({ hideClutterButtons: ev.target.checked });
});

function initPatreonAuth() {
  const loggedOutView = document.getElementById("patreon-logged-out");
  const loggedInView = document.getElementById("patreon-logged-in");
  const loginBtn = document.getElementById("patreon-login-btn");
  const githubLoginBtn = document.getElementById("github-login-btn");
  const logoutBtn = document.getElementById("patreon-logout-btn");
  const userAvatar = document.getElementById("patreon-user-avatar");
  const userName = document.getElementById("patreon-user-name");
  const userTier = document.getElementById("patreon-tier");
  let authenticationGeneration = 0;
  const initialGeneration = authenticationGeneration;

  chrome.storage.local.get(["patreonUser", "patreonSessionToken"], async (data) => {
    if (initialGeneration !== authenticationGeneration) return;
    const cachedUser = data.patreonUser;
    const sessionToken = data.patreonSessionToken;

    if (sessionToken && cachedUser) {
      const granted = await hasAuthenticationDataPermission();
      if (initialGeneration !== authenticationGeneration) return;
      if (!granted) {
        chrome.storage.local.remove(["patreonAuthenticated", "patreonUser", "patreonSessionToken"]);
        showLoggedOutView();
        return;
      }

      // Show cached state immediately to avoid flicker on popup reopen.
      showLoggedInView(cachedUser);

      verifySession(sessionToken, initialGeneration).then(async (result) => {
        if (initialGeneration !== authenticationGeneration) return;
        const stillGranted = await hasAuthenticationDataPermission();
        if (initialGeneration !== authenticationGeneration || !stillGranted) return;
        if (result.status === "valid") {
          if (result.membershipTier && result.membershipTier !== cachedUser.membershipTier) {
            const updatedUser = { ...cachedUser, membershipTier: result.membershipTier, hasActiveMembership: true };
            showLoggedInView(updatedUser);
            chrome.storage.local.set({ patreonUser: updatedUser });
          } else if (cachedUser.hasActiveMembership !== true) {
            const updatedUser = { ...cachedUser, hasActiveMembership: true };
            showLoggedInView(updatedUser);
            chrome.storage.local.set({ patreonUser: updatedUser });
          }
        } else if (result.status === "inactive") {
          const updatedUser = {
            ...cachedUser,
            hasActiveMembership: false,
            membershipTier: result.membershipTier || cachedUser.membershipTier || "none",
          };
          showLoggedInView(updatedUser);
          chrome.storage.local.set({ patreonUser: updatedUser });
        } else if (result.status === "error") {
          console.warn("Patreon session verification skipped:", result.reason || "network_error");
        } else {
          showLoggedOutView();
          chrome.storage.local.remove(["patreonUser", "patreonSessionToken"]);
        }
      });
    } else {
      showLoggedOutView();
    }
  });

  function showLoggedOutView() {
    loggedOutView.style.display = "block";
    loggedInView.style.display = "none";
    userAvatar.removeAttribute("src");
    userAvatar.style.display = "none";
    userName.textContent = "";
    userTier.textContent = "";
  }

  function showLoggedInView(user) {
    loggedOutView.style.display = "none";
    loggedInView.style.display = "block";

    userName.textContent = user.fullName || user.email || chrome.i18n.getMessage("patreonUserFallback");

    if (user.imageUrl) {
      userAvatar.src = user.imageUrl;
      userAvatar.style.display = "block";
    } else {
      userAvatar.src = "";
      userAvatar.style.display = "none";
    }

    const tierLabels = {
      premium: chrome.i18n.getMessage("patreonTierPremium"),
      supporter: chrome.i18n.getMessage("patreonTierSupporter"),
      basic: chrome.i18n.getMessage("patreonTierBasic"),
      none: chrome.i18n.getMessage("patreonTierNone"),
    };

    userTier.textContent = tierLabels[user.membershipTier] || chrome.i18n.getMessage("patreonTierChecking");

    if (user.hasActiveMembership) {
      userTier.style.color = "#f96854";
    } else {
      userTier.style.color = "var(--lightGrey)";
    }
  }

  async function verifySession(token, generation) {
    try {
      if (!(await hasAuthenticationDataPermission()) || generation !== authenticationGeneration) {
        return { status: "consent_required" };
      }

      const response = await fetch(getApiEndpoint("/api/auth/verify"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionToken: token }),
      });

      const data = await response.json().catch(() => null);
      if (!data) {
        return { status: "error", reason: "invalid_response" };
      }

      const failureReason = typeof data.failureReason === "string" ? data.failureReason : null;
      const membershipTier = typeof data.membershipTier === "string" ? data.membershipTier : null;

      if (data.valid === true) {
        return { status: "valid", membershipTier };
      }

      if (failureReason === "membershipinactive") {
        return { status: "inactive", membershipTier };
      }

      if (failureReason === "expired" || failureReason === "legacyformat") {
        return { status: "expired", membershipTier };
      }

      if (failureReason === "invalid") {
        return { status: "invalid", membershipTier, failureReason };
      }

      if (!failureReason) {
        return { status: "error", reason: "unknown_failure" };
      }

      return { status: "error", reason: failureReason };
    } catch (error) {
      console.error("Session verification failed:", error);
      return { status: "error", reason: "network_error" };
    }
  }

  // Wrapper for cross-browser identity API
  function getIdentityApi() {
    if (typeof browser !== "undefined" && browser.identity) return browser.identity; // prefer Firefox promise API
    if (typeof chrome !== "undefined" && chrome.identity) return chrome.identity;
    return null;
  }

  function launchWebAuthFlow(url) {
    try {
      if (
        typeof browser !== "undefined" &&
        browser.identity &&
        typeof browser.identity.launchWebAuthFlow === "function"
      ) {
        // Promise-based API (Firefox)
        return browser.identity.launchWebAuthFlow({ url, interactive: true });
      }
    } catch (_) {}

    const chromeId = (typeof chrome !== "undefined" && chrome.identity) || null;
    if (!chromeId || typeof chromeId.launchWebAuthFlow !== "function") {
      return Promise.reject(new Error("identity API not available"));
    }
    // Callback-based API (Chrome)
    return new Promise((resolve, reject) => {
      chromeId.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(err);
        else resolve(responseUrl);
      });
    });
  }

  function extractOAuthParams(responseUrl) {
    try {
      const u = new URL(responseUrl);
      let code = u.searchParams.get("code");
      let state = u.searchParams.get("state");
      if (!code && u.hash) {
        const hashParams = new URLSearchParams(u.hash.startsWith("#") ? u.hash.substring(1) : u.hash);
        code = hashParams.get("code");
        state = state || hashParams.get("state");
      }
      return { code, state };
    } catch (_) {
      return { code: null, state: null };
    }
  }

  // Request identity permission immediately within the user click (no awaits prior)
  function ensureIdentityPermission(onResult) {
    try {
      const mf = chrome && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
      // If manifest cannot request identity dynamically (e.g., Firefox), proceed if API is available
      if (mf && (!Array.isArray(mf.optional_permissions) || !mf.optional_permissions.includes("identity"))) {
        const id = getIdentityApi();
        onResult(Boolean(id && typeof id.getRedirectURL === "function"));
        return;
      }

      const perms =
        (typeof chrome !== "undefined" && chrome.permissions) ||
        (typeof browser !== "undefined" && browser.permissions);
      if (!perms || !perms.contains) return onResult(false);
      const afterContains = (has) => {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) has = false;
        if (has) return onResult(true);
        if (!perms.request) return onResult(false);
        const reqResult = perms.request({ permissions: ["identity"] }, (granted) => {
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) return onResult(false);
          onResult(Boolean(granted));
        });
        // Firefox may return a promise
        if (reqResult && typeof reqResult.then === "function") {
          reqResult.then((granted) => onResult(Boolean(granted))).catch(() => onResult(false));
        }
      };
      const result = perms.contains({ permissions: ["identity"] }, afterContains);
      if (result && typeof result.then === "function") {
        result.then(afterContains).catch(() => onResult(false));
      }
    } catch (_) {
      onResult(false);
    }
  }

  loginBtn.addEventListener("click", () => {
    const generation = ++authenticationGeneration;
    const continueLogin = (consentGranted) => {
      if (generation !== authenticationGeneration) return;
      if (!consentGranted) {
        alert(chrome.i18n.getMessage("patreonPermissionRequired"));
        return;
      }

      ensureIdentityPermission((granted) => {
        if (generation !== authenticationGeneration) return;
        const identityNow = getIdentityApi();
        if (!granted || !identityNow || typeof identityNow.getRedirectURL !== "function") {
          alert(chrome.i18n.getMessage("patreonPermissionRequired"));
          return;
        }
        // Delegate OAuth to background so it persists if the popup closes
        chrome.runtime.sendMessage({ message: "patreon_oauth_login" }, async (resp) => {
          if (generation !== authenticationGeneration) return;
          if (chrome.runtime && chrome.runtime.lastError) {
            console.error("Login failed:", chrome.runtime.lastError.message);
            alert(chrome.i18n.getMessage("patreonLoginStartFailed"));
            return;
          }
          if (resp && resp.success) {
            const stillGranted = await hasAuthenticationDataPermission();
            if (generation !== authenticationGeneration || !stillGranted) return;
            const user = resp.user;
            showLoggedInView(user);
          } else {
            console.error("Login failed:", resp && resp.error);
            alert(chrome.i18n.getMessage("patreonLoginCompleteFailed"));
          }
        });
      });
    };

    if (!usesFirefoxDataCollectionConsent()) {
      continueLogin(true);
      return;
    }

    requestAuthenticationDataPermission().then(continueLogin);
  });

  if (githubLoginBtn) {
    githubLoginBtn.addEventListener("click", () => {
      const generation = ++authenticationGeneration;
      const continueLogin = (consentGranted) => {
        if (generation !== authenticationGeneration) return;
        if (!consentGranted) {
          alert(chrome.i18n.getMessage("patreonPermissionRequired"));
          return;
        }

        ensureIdentityPermission((granted) => {
          if (generation !== authenticationGeneration) return;
          const identityNow = getIdentityApi();
          if (!granted || !identityNow || typeof identityNow.getRedirectURL !== "function") {
            alert(chrome.i18n.getMessage("patreonPermissionRequired"));
            return;
          }

          chrome.runtime.sendMessage({ message: "github_oauth_login" }, async (resp) => {
            if (generation !== authenticationGeneration) return;
            if (chrome.runtime && chrome.runtime.lastError) {
              console.error("GitHub login failed:", chrome.runtime.lastError.message);
              alert(chrome.i18n.getMessage("githubLoginStartFailed"));
              return;
            }
            if (resp && resp.success) {
              const stillGranted = await hasAuthenticationDataPermission();
              if (generation !== authenticationGeneration || !stillGranted) return;
              const user = resp.user;
              showLoggedInView(user);
            } else {
              console.error("GitHub login failed:", resp && resp.error);
              alert(getGitHubLoginErrorMessage(resp?.error, (key) => chrome.i18n.getMessage(key)));
            }
          });
        });
      };

      if (!usesFirefoxDataCollectionConsent()) {
        continueLogin(true);
        return;
      }

      requestAuthenticationDataPermission().then(continueLogin);
    });
  }

  onAuthenticationDataPermissionRemoved(() => {
    authenticationGeneration++;
    chrome.storage.local.remove(["patreonAuthenticated", "patreonUser", "patreonSessionToken"]);
    showLoggedOutView();
  });

  logoutBtn.addEventListener("click", () => {
    authenticationGeneration++;
    showLoggedOutView();
    chrome.storage.local.remove(["patreonAuthenticated", "patreonUser", "patreonSessionToken"]);
    chrome.runtime.sendMessage({ message: "patreon_logout" });
  });
}

initPatreonAuth();

/*   Advanced Toggle   */
const advancedToggle = document.getElementById("advancedToggle");
advancedToggle.addEventListener("click", () => {
  const adv = document.getElementById("advancedSettings");
  if (popup_config.advanced) {
    adv.style.transform = "scale(1.1)";
    adv.style.pointerEvents = "none";
    adv.style.opacity = "0";
    advancedToggle.innerHTML = popup_config.showAdvancedMessage;
  } else {
    adv.style.transform = "scale(1)";
    adv.style.pointerEvents = "auto";
    adv.style.opacity = "1";
    advancedToggle.innerHTML = popup_config.hideAdvancedMessage;
  }
  popup_config.advanced = !popup_config.advanced;
});

initConfig();

function initConfig() {
  initializeDisableVoteSubmission();
  initializeDisableLogging();
  initializeVersionNumber();
  initializeColoredThumbs();
  initializeColoredBar();
  initializeColorTheme();
  initializeNumberDisplayFormat();
  initializeTooltipPercentage();
  initializeTooltipPercentageMode();
  initializeNumberDisplayReformatLikes();
  initializeHidePremiumTeaser();
  initializeHideClutterButtons();
}

function initializeVersionNumber() {
  const version = chrome.runtime.getManifest().version;
  document.getElementById("ext-version").innerHTML = "v" + version;
}

function initializeDisableVoteSubmission() {
  chrome.storage.local.get(["disableVoteSubmission"], (res) => {
    handleDisableVoteSubmissionChangeEvent(res.disableVoteSubmission);
  });
}

function initializeDisableLogging() {
  chrome.storage.local.get(["disableLogging"], (res) => {
    handleDisableLoggingChangeEvent(res.disableLogging);
  });
}

function initializeColoredThumbs() {
  chrome.storage.local.get(["coloredThumbs"], (res) => {
    handleColoredThumbsChangeEvent(res.coloredThumbs);
  });
}

function initializeColoredBar() {
  chrome.storage.local.get(["coloredBar"], (res) => {
    handleColoredBarChangeEvent(res.coloredBar);
  });
}

function initializeColorTheme() {
  chrome.storage.local.get(["colorTheme"], (res) => {
    handleColorThemeChangeEvent(res.colorTheme);
  });
}

function initializeTooltipPercentage() {
  chrome.storage.local.get(["showTooltipPercentage"], (res) => {
    handleShowTooltipPercentageChangeEvent(res.showTooltipPercentage);
  });
}

function initializeTooltipPercentageMode() {
  chrome.storage.local.get(["tooltipPercentageMode"], (res) => {
    handleTooltipPercentageModeChangeEvent(res.tooltipPercentageMode);
  });
}

function initializeNumberDisplayFormat() {
  chrome.storage.local.get(["numberDisplayFormat"], (res) => {
    handleNumberDisplayFormatChangeEvent(res.numberDisplayFormat);
  });
  updateNumberDisplayFormatContent();
}

function updateNumberDisplayFormatContent() {
  let testValue = 123456;
  document.getElementById("number_format_compactShort").innerHTML =
    getNumberFormatter("compactShort").format(testValue);
  document.getElementById("number_format_compactLong").innerHTML = getNumberFormatter("compactLong").format(testValue);
  document.getElementById("number_format_standard").innerHTML = getNumberFormatter("standard").format(testValue);
}

function initializeNumberDisplayReformatLikes() {
  chrome.storage.local.get(["numberDisplayReformatLikes"], (res) => {
    handleNumberDisplayReformatLikesChangeEvent(res.numberDisplayReformatLikes);
  });
}

function initializeHidePremiumTeaser() {
  chrome.storage.local.get(["hidePremiumTeaser"], (res) => {
    handleHidePremiumTeaserChangeEvent(res.hidePremiumTeaser);
  });
}

function initializeHideClutterButtons() {
  chrome.storage.local.get(["hideClutterButtons"], (res) => {
    if (res.hideClutterButtons === undefined) {
      chrome.storage.local.set({ hideClutterButtons: false });
    }
    handleHideClutterButtonsChangeEvent(res.hideClutterButtons);
  });
}

chrome.storage.onChanged.addListener(storageChangeHandler);

function storageChangeHandler(changes, area) {
  if (changes.disableVoteSubmission !== undefined) {
    handleDisableVoteSubmissionChangeEvent(changes.disableVoteSubmission.newValue);
  }
  if (changes.disableLogging !== undefined) {
    handleDisableLoggingChangeEvent(changes.disableLogging.newValue);
  }
  if (changes.coloredThumbs !== undefined) {
    handleColoredThumbsChangeEvent(changes.coloredThumbs.newValue);
  }
  if (changes.coloredBar !== undefined) {
    handleColoredBarChangeEvent(changes.coloredBar.newValue);
  }
  if (changes.colorTheme !== undefined) {
    handleColorThemeChangeEvent(changes.colorTheme.newValue);
  }
  if (changes.numberDisplayFormat !== undefined) {
    handleNumberDisplayFormatChangeEvent(changes.numberDisplayFormat.newValue);
  }
  if (changes.showTooltipPercentage !== undefined) {
    handleShowTooltipPercentageChangeEvent(changes.showTooltipPercentage.newValue);
  }
  if (changes.numberDisplayReformatLikes !== undefined) {
    handleNumberDisplayReformatLikesChangeEvent(changes.numberDisplayReformatLikes.newValue);
  }
  if (changes.hidePremiumTeaser !== undefined) {
    handleHidePremiumTeaserChangeEvent(changes.hidePremiumTeaser.newValue);
  }
  if (changes.hideClutterButtons !== undefined) {
    handleHideClutterButtonsChangeEvent(changes.hideClutterButtons.newValue);
  }
}

function handleDisableVoteSubmissionChangeEvent(value) {
  popup_config.disableVoteSubmission = value;
  document.getElementById("disable_vote_submission").checked = value;
}

function handleDisableLoggingChangeEvent(value) {
  popup_config.disableLogging = value;
  document.getElementById("disable_logging").checked = value;
}

function handleColoredThumbsChangeEvent(value) {
  popup_config.coloredThumbs = value;
  document.getElementById("colored_thumbs").checked = value;
}

function handleColoredBarChangeEvent(value) {
  popup_config.coloredBar = value;
  document.getElementById("colored_bar").checked = value;
}

function handleColorThemeChangeEvent(value) {
  if (!value) {
    value = "classic";
  }
  popup_config.colorTheme = value;
  document.getElementById("color_theme").querySelector('option[value="' + value + '"]').selected = true;
  updateColorThemePreviewContent(value);
}

function updateColorThemePreviewContent(themeName) {
  document.getElementById("color_theme_example_like").style.backgroundColor = getColorFromTheme(themeName, true);
  document.getElementById("color_theme_example_dislike").style.backgroundColor = getColorFromTheme(themeName, false);
}

function handleNumberDisplayFormatChangeEvent(value) {
  popup_config.numberDisplayFormat = value;
  document.getElementById("number_format").querySelector('option[value="' + value + '"]').selected = true;
}

function handleShowTooltipPercentageChangeEvent(value) {
  popup_config.showTooltipPercentage = value;
  document.getElementById("show_tooltip_percentage").checked = value;
}

function handleTooltipPercentageModeChangeEvent(value) {
  if (!value) {
    value = "dash_like";
  }
  popup_config.tooltipPercentageMode = value;

  document.getElementById("tooltip_percentage_mode").querySelector('option[value="' + value + '"]').selected = true;
}

function handleNumberDisplayReformatLikesChangeEvent(value) {
  popup_config.numberDisplayReformatLikes = value;
  document.getElementById("number_reformat_likes").checked = value;
}

function handleHidePremiumTeaserChangeEvent(value) {
  const normalized = value === true;
  popup_config.hidePremiumTeaser = normalized;
  document.getElementById("hide_premium_teaser").checked = normalized;
}

function handleHideClutterButtonsChangeEvent(value) {
  const normalized = value === true;
  popup_config.hideClutterButtons = normalized;
  document.getElementById("hide_clutter_buttons").checked = normalized;
}

function getNumberFormatter(optionSelect) {
  let formatterNotation;
  let formatterCompactDisplay;
  let userLocales;
  try {
    userLocales = new URL(
      Array.from(document.querySelectorAll("head > link[rel='search']"))
        ?.find((n) => n?.getAttribute("href")?.includes("?locale="))
        ?.getAttribute("href"),
    )?.searchParams?.get("locale");
  } catch {}

  switch (optionSelect) {
    case "compactLong":
      formatterNotation = "compact";
      formatterCompactDisplay = "long";
      break;
    case "standard":
      formatterNotation = "standard";
      formatterCompactDisplay = "short";
      break;
    case "compactShort":
    default:
      formatterNotation = "compact";
      formatterCompactDisplay = "short";
  }
  const formatter = Intl.NumberFormat(document.documentElement.lang || userLocales || navigator.language, {
    notation: formatterNotation,
    compactDisplay: formatterCompactDisplay,
  });
  return formatter;
}

function getColorFromTheme(colorTheme, voteIsLike) {
  let colorString;
  switch (colorTheme) {
    case "accessible":
      if (voteIsLike === true) {
        colorString = "dodgerblue";
      } else {
        colorString = "gold";
      }
      break;
    case "neon":
      if (voteIsLike === true) {
        colorString = "aqua";
      } else {
        colorString = "magenta";
      }
      break;
    case "classic":
    default:
      if (voteIsLike === true) {
        colorString = "lime";
      } else {
        colorString = "red";
      }
  }
  return colorString;
}

/******/ })()
;