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



;// CONCATENATED MODULE: ./Extensions/common/vote-client.js
const DEFAULT_API_BASE_URL = "https://returnyoutubedislikeapi.com";
const USER_ID_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VALID_VOTE_VALUES = new Set([-1, 0, 1]);

class VoteClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "VoteClientError";
    this.status = options.status;
    this.cause = options.cause;
  }
}

function countLeadingZeroes(bytes, limit = Infinity) {
  let zeroes = 0;

  for (const originalValue of bytes) {
    let value = originalValue;
    if (value === 0) {
      zeroes += 8;
    } else {
      let count = 1;
      if (value >>> 4 === 0) {
        count += 4;
        value <<= 4;
      }
      if (value >>> 6 === 0) {
        count += 2;
        value <<= 2;
      }
      zeroes += count - (value >>> 7);
      break;
    }

    if (zeroes >= limit) break;
  }

  return zeroes;
}

function generateUserId(cryptoImpl = globalThis.crypto, length = 36) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new TypeError("User ID length must be a positive integer");
  }
  if (!cryptoImpl?.getRandomValues) {
    throw new VoteClientError("Web Crypto random generation is unavailable");
  }

  const values = new Uint32Array(length);
  cryptoImpl.getRandomValues(values);
  let result = "";
  for (const value of values) {
    result += USER_ID_CHARSET[value % USER_ID_CHARSET.length];
  }
  return result;
}

function decodeBase64(value) {
  if (typeof atob !== "function") {
    throw new VoteClientError("Base64 decoding is unavailable");
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  if (typeof btoa !== "function") {
    throw new VoteClientError("Base64 encoding is unavailable");
  }
  return btoa(String.fromCharCode(...bytes));
}

async function solvePuzzle(puzzle, cryptoImpl = globalThis.crypto, maxAttempts) {
  if (!puzzle || typeof puzzle.challenge !== "string" || !Number.isInteger(puzzle.difficulty)) {
    throw new VoteClientError("The API returned an invalid puzzle");
  }
  if (!cryptoImpl?.subtle?.digest) {
    throw new VoteClientError("Web Crypto hashing is unavailable");
  }

  const challenge = decodeBase64(puzzle.challenge);
  if (challenge.length !== 16) {
    throw new VoteClientError("The API returned an invalid puzzle challenge");
  }

  const attempts = maxAttempts ?? Math.pow(2, puzzle.difficulty) * 3;
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new VoteClientError("The puzzle attempt limit is invalid");
  }

  const buffer = new ArrayBuffer(20);
  const byteView = new Uint8Array(buffer);
  const integerView = new Uint32Array(buffer);
  byteView.set(challenge, 4);

  for (let counter = 0; counter < attempts; counter++) {
    integerView[0] = counter;
    const hash = await cryptoImpl.subtle.digest("SHA-512", buffer);
    if (countLeadingZeroes(new Uint8Array(hash), puzzle.difficulty) >= puzzle.difficulty) {
      return { solution: encodeBase64(byteView.slice(0, 4)) };
    }
  }

  return null;
}

function isConfirmedCredential(value) {
  return Boolean(value?.userId && value.registrationConfirmed === true);
}

function createVoteClient({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  credentialStore,
  cryptoImpl = globalThis.crypto,
  puzzleAttempts = 2,
  votePuzzleAttempts = 3,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!credentialStore?.load || !credentialStore?.save || !credentialStore?.clear) {
    throw new TypeError("credentialStore must provide load, save, and clear");
  }
  if (!Number.isInteger(puzzleAttempts) || puzzleAttempts <= 0) {
    throw new TypeError("puzzleAttempts must be a positive integer");
  }
  if (!Number.isInteger(votePuzzleAttempts) || votePuzzleAttempts <= 0) {
    throw new TypeError("votePuzzleAttempts must be a positive integer");
  }

  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const voteQueues = new Map();
  let registrationPromise = null;
  let registrationIsForced = false;

  async function readJson(response, operation) {
    try {
      return await response.json();
    } catch (error) {
      throw new VoteClientError(`${operation} returned invalid JSON`, { status: response.status, cause: error });
    }
  }

  function isSuccessful(response) {
    if (typeof response.ok === "boolean") return response.ok;
    return response.status >= 200 && response.status < 300;
  }

  async function request(path, options, operation) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, options);
    } catch (error) {
      throw new VoteClientError(`${operation} request failed`, { cause: error });
    }

    if (!response || !Number.isInteger(response.status)) {
      throw new VoteClientError(`${operation} returned an invalid response`);
    }
    return response;
  }

  async function postJson(path, body, operation) {
    const response = await request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      operation,
    );
    return response;
  }

  async function registerNewCredential() {
    const userId = generateUserId(cryptoImpl);

    for (let attempt = 0; attempt < puzzleAttempts; attempt++) {
      const path = `/puzzle/registration?userId=${encodeURIComponent(userId)}`;
      const puzzleResponse = await request(
        path,
        { method: "GET", headers: { Accept: "application/json" } },
        "Registration puzzle",
      );
      if (!isSuccessful(puzzleResponse)) {
        throw new VoteClientError("Registration puzzle request was rejected", { status: puzzleResponse.status });
      }

      const puzzle = await readJson(puzzleResponse, "Registration puzzle");
      const solvedPuzzle = await solvePuzzle(puzzle, cryptoImpl);
      if (!solvedPuzzle) continue;

      const confirmResponse = await postJson(path, solvedPuzzle, "Registration confirmation");
      if (!isSuccessful(confirmResponse)) {
        throw new VoteClientError("Registration confirmation was rejected", { status: confirmResponse.status });
      }
      const confirmed = await readJson(confirmResponse, "Registration confirmation");
      if (confirmed !== true) {
        throw new VoteClientError("Registration confirmation failed");
      }

      const credential = { userId, registrationConfirmed: true };
      await credentialStore.save(credential);
      return { userId };
    }

    throw new VoteClientError("Unable to solve the registration puzzle");
  }

  async function ensureRegisteredInternal(force) {
    if (force) {
      await credentialStore.clear();
    } else {
      const credential = await credentialStore.load();
      if (isConfirmedCredential(credential)) return { userId: credential.userId };
    }
    return registerNewCredential();
  }

  function trackRegistration(work, force) {
    let trackedPromise;
    trackedPromise = work.finally(() => {
      if (registrationPromise === trackedPromise) {
        registrationPromise = null;
        registrationIsForced = false;
      }
    });
    registrationPromise = trackedPromise;
    registrationIsForced = force;
    return trackedPromise;
  }

  function ensureRegistered(options = {}) {
    const force = options.force === true;
    if (!registrationPromise) {
      return trackRegistration(ensureRegisteredInternal(force), force);
    }
    if (!force || registrationIsForced) return registrationPromise;

    const pendingRegistration = registrationPromise;
    return trackRegistration(
      pendingRegistration.catch(() => undefined).then(() => ensureRegisteredInternal(true)),
      true,
    );
  }

  async function performVote(videoId, value, authenticationRetriesRemaining) {
    let { userId } = await ensureRegistered();

    for (let attempt = 0; attempt < votePuzzleAttempts; attempt++) {
      const voteResponse = await postJson("/interact/vote", { userId, videoId, value }, "Vote submission");

      if (voteResponse.status === 401) {
        if (authenticationRetriesRemaining <= 0) {
          throw new VoteClientError("Vote submission was unauthorized after re-registration", { status: 401 });
        }
        ({ userId } = await ensureRegistered({ force: true }));
        return performVote(videoId, value, authenticationRetriesRemaining - 1);
      }
      if (!isSuccessful(voteResponse)) {
        throw new VoteClientError("Vote submission was rejected", { status: voteResponse.status });
      }

      const puzzle = await readJson(voteResponse, "Vote submission");
      const solvedPuzzle = await solvePuzzle(puzzle, cryptoImpl);
      if (!solvedPuzzle) continue;

      const confirmResponse = await postJson(
        "/interact/confirmVote",
        { ...solvedPuzzle, userId, videoId },
        "Vote confirmation",
      );
      if (confirmResponse.status === 401) {
        if (authenticationRetriesRemaining <= 0) {
          throw new VoteClientError("Vote confirmation was unauthorized after re-registration", { status: 401 });
        }
        await ensureRegistered({ force: true });
        return performVote(videoId, value, authenticationRetriesRemaining - 1);
      }
      if (!isSuccessful(confirmResponse)) {
        throw new VoteClientError("Vote confirmation was rejected", { status: confirmResponse.status });
      }

      const confirmed = await readJson(confirmResponse, "Vote confirmation");
      if (confirmed !== true) throw new VoteClientError("Vote confirmation failed");
      return true;
    }

    throw new VoteClientError("Unable to solve the vote puzzle");
  }

  function submitVote(videoId, value) {
    if (typeof videoId !== "string" || !VALID_VIDEO_ID.test(videoId)) {
      return Promise.reject(new TypeError("videoId must be an 11-character YouTube video ID"));
    }
    if (!VALID_VOTE_VALUES.has(value)) {
      return Promise.reject(new TypeError("value must be -1, 0, or 1"));
    }

    const previous = voteQueues.get(videoId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => performVote(videoId, value, 1));
    voteQueues.set(videoId, current);
    current.then(
      () => {
        if (voteQueues.get(videoId) === current) voteQueues.delete(videoId);
      },
      () => {
        if (voteQueues.get(videoId) === current) voteQueues.delete(videoId);
      },
    );
    return current;
  }

  return { ensureRegistered, submitVote };
}



;// CONCATENATED MODULE: ./Extensions/combined/src/vote-client-adapter.js
function createStorageCaller(storageArea, getLastError = () => undefined) {
  return function call(methodName, ...args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);
      const callback = (result) => {
        const lastError = getLastError();
        if (lastError) {
          rejectOnce(new Error(lastError.message || String(lastError)));
        } else {
          resolveOnce(result);
        }
      };

      try {
        const maybePromise = storageArea[methodName](...args, callback);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolveOnce, rejectOnce);
        }
      } catch (callbackError) {
        try {
          const maybePromise = storageArea[methodName](...args);
          Promise.resolve(maybePromise).then(resolveOnce, rejectOnce);
        } catch (promiseError) {
          rejectOnce(promiseError ?? callbackError);
        }
      }
    });
  };
}

function createBrowserCredentialStore(storageArea, getLastError) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new TypeError("A browser storage area is required");
  }

  const call = createStorageCaller(storageArea, getLastError);
  return {
    async load() {
      const result = await call("get", ["userId", "registrationConfirmed"]);
      if (!result?.userId || result.registrationConfirmed !== true) return null;
      return { userId: result.userId, registrationConfirmed: true };
    },

    async save(credentials) {
      await call("set", {
        userId: credentials.userId,
        registrationConfirmed: credentials.registrationConfirmed === true,
      });
    },

    async clear() {
      if (typeof storageArea.remove === "function") {
        await call("remove", ["userId", "registrationConfirmed"]);
      } else {
        await call("set", { userId: null, registrationConfirmed: false });
      }
    },
  };
}

const SYNTHETIC_DISLIKE_KEY_PREFIX = "rydSyntheticDislikedShort:";

function syntheticDislikeKey(videoId) {
  if (typeof videoId !== "string" || videoId.length === 0) {
    throw new TypeError("videoId must be a non-empty string");
  }
  return `${SYNTHETIC_DISLIKE_KEY_PREFIX}${videoId}`;
}

function createBrowserSyntheticDislikeStore(storageArea, getLastError) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new TypeError("A browser storage area is required");
  }

  const call = createStorageCaller(storageArea, getLastError);
  return {
    async isDisliked(videoId) {
      const key = syntheticDislikeKey(videoId);
      const result = await call("get", [key]);
      return result?.[key] === true;
    },

    async setDisliked(videoId, disliked) {
      const key = syntheticDislikeKey(videoId);
      if (typeof disliked !== "boolean") {
        throw new TypeError("disliked must be a boolean");
      }
      if (disliked || typeof storageArea.remove !== "function") {
        await call("set", { [key]: disliked });
      } else {
        await call("remove", [key]);
      }
    },
  };
}



;// CONCATENATED MODULE: ./Extensions/combined/src/github-auth.js


function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createPkce(cryptoApi = globalThis.crypto) {
  const verifier = base64Url(cryptoApi.getRandomValues(new Uint8Array(32)));
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

const API_ERRORS = new Set([
  "github_not_configured",
  "not_contributor",
  "github_pkce_required",
  "github_invalid_state",
  "github_token_exchange_failed",
  "github_identity_failed",
]);

async function readAuthResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error || data?.success === false) {
    if (API_ERRORS.has(data?.error)) throw new Error(data.error);
    if (data?.error === "Disallowed redirectUri") throw new Error("github_redirect_rejected");
    if (response.status === 404 || response.status === 503) throw new Error("github_unavailable");
    if (response.status === 429) throw new Error("github_rate_limited");
    throw new Error("github_login_failed");
  }
  if (!data) throw new Error("github_invalid_response");
  return data;
}

async function loginWithGitHub({
  redirectUri,
  launchWebAuthFlow,
  requireConsent,
  fetchImpl = globalThis.fetch,
  cryptoApi = globalThis.crypto,
}) {
  await requireConsent();
  const { verifier, challenge } = await createPkce(cryptoApi);
  await requireConsent();
  const start = await readAuthResponse(
    await fetchImpl(
      getApiEndpoint(
        `/api/auth/github/login?redirectUri=${encodeURIComponent(redirectUri)}&codeChallenge=${encodeURIComponent(challenge)}`,
      ),
    ),
  );
  let authUrl;
  try {
    authUrl = new URL(start.authUrl);
  } catch (_) {
    throw new Error("github_invalid_response");
  }
  if (
    authUrl.origin !== "https://github.com" ||
    authUrl.pathname !== "/login/oauth/authorize" ||
    typeof start.state !== "string" ||
    !start.state ||
    start.redirectUri !== redirectUri ||
    authUrl.searchParams.get("state") !== start.state ||
    authUrl.searchParams.get("redirect_uri") !== redirectUri ||
    authUrl.searchParams.get("code_challenge") !== challenge ||
    authUrl.searchParams.get("code_challenge_method") !== "S256"
  ) {
    throw new Error("github_invalid_response");
  }

  await requireConsent();
  const callback = new URL(await launchWebAuthFlow(authUrl.href));
  const expectedRedirect = new URL(redirectUri);
  if (
    callback.origin !== expectedRedirect.origin ||
    callback.pathname !== expectedRedirect.pathname ||
    callback.searchParams.get("state") !== start.state
  ) {
    throw new Error("github_invalid_state");
  }
  if (callback.searchParams.has("error")) throw new Error("github_authorization_denied");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("github_invalid_response");

  await requireConsent();
  const account = await readAuthResponse(
    await fetchImpl(getApiEndpoint("/api/auth/github/exchange"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: start.state, redirectUri, codeVerifier: verifier }),
    }),
  );
  await requireConsent();
  if (account.success !== true || !account.user || !account.sessionToken) throw new Error("github_invalid_response");
  return account;
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



;// CONCATENATED MODULE: ./Extensions/combined/ryd.background.js






const apiUrl = getApiUrl();
const voteDisabledIconName = config.voteDisabledIconName;
const defaultIconName = config.defaultIconName;
let api;
const CHANGELOG_STORAGE_KEY = "lastShownChangelogVersion";
const PENDING_CHANGELOG_STORAGE_KEY = "pendingChangelogVersion";

/** stores extension's global config */
let extConfig = { ...config.defaultExtConfig };
let authenticationGeneration = 0;
let accountStorageQueue = Promise.resolve();

if (isChrome()) api = chrome;
else if (isFirefox()) api = browser;

if (false) {}

const voteClient = createVoteClient({
  apiBaseUrl: apiUrl,
  fetchImpl: (...args) => fetch(...args),
  credentialStore: createBrowserCredentialStore(api.storage.local, () => api.runtime?.lastError),
  cryptoImpl: globalThis.crypto,
});

initExtConfig();
voteClient.ensureRegistered().catch((error) => console.error("Vote registration failed", error));

function broadcastPatreonStatus(authenticated, user, sessionToken, generation = authenticationGeneration) {
  chrome.tabs.query({}, (tabs) => {
    if (generation !== authenticationGeneration) return;
    tabs
      .filter((tab) => tab.url && tab.url.includes("youtube.com"))
      .forEach((tab) => {
        const maybePromise = chrome.tabs.sendMessage(
          tab.id,
          {
            message: "patreon_status_changed",
            authenticated,
            user: authenticated ? user : null,
            sessionToken: authenticated ? sessionToken : null,
          },
          () => {
            if (chrome.runtime.lastError) {
              console.debug("Patreon status broadcast skipped:", chrome.runtime.lastError.message);
            }
          },
        );

        if (maybePromise && typeof maybePromise.catch === "function") {
          maybePromise.catch((error) => {
            console.debug("Patreon status broadcast skipped:", error?.message ?? error);
          });
        }
      });
  });
}

function handlePatreonAuthComplete(user, sessionToken, generation, done) {
  if (!user || !sessionToken || generation !== authenticationGeneration) {
    done?.(false);
    return;
  }

  if (usesFirefoxDataCollectionConsent()) {
    hasAuthenticationDataPermission({ queryBackground: false }).then((granted) => {
      if (granted && generation === authenticationGeneration) persistPatreonAuth(user, sessionToken, generation, done);
      else done?.(false);
    });
    return;
  }

  persistPatreonAuth(user, sessionToken, generation, done);
}

function persistPatreonAuth(user, sessionToken, generation, done) {
  queueAccountStorageMutation((complete) => {
    if (generation !== authenticationGeneration) {
      complete();
      return;
    }
    chrome.storage.local.set(
      {
        patreonAuthenticated: true,
        patreonUser: user,
        patreonSessionToken: sessionToken,
      },
      complete,
    );
  })
    .then(() => {
      if (generation !== authenticationGeneration) {
        done?.(false);
        return;
      }
      broadcastPatreonStatus(true, user, sessionToken, generation);
      done?.(true);
    })
    .catch(() => done?.(false));
}

function queueAccountStorageMutation(operation) {
  const pending = accountStorageQueue.then(
    () =>
      new Promise((resolve, reject) => {
        operation(() => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      }),
  );
  accountStorageQueue = pending.catch(() => {});
  return pending;
}

function clearPatreonAuth(done) {
  const generation = ++authenticationGeneration;
  broadcastPatreonStatus(false, null, null, generation);
  queueAccountStorageMutation((complete) => {
    chrome.storage.local.remove(["patreonAuthenticated", "patreonUser", "patreonSessionToken"], complete);
  })
    .then(() => done?.())
    .catch((error) => console.error("Account session cleanup failed", error));
}

onAuthenticationDataPermissionRemoved(() => clearPatreonAuth());

async function requireCurrentAuthenticationConsent(generation) {
  if (
    generation !== authenticationGeneration ||
    (usesFirefoxDataCollectionConsent() && !(await hasAuthenticationDataPermission({ queryBackground: false }))) ||
    generation !== authenticationGeneration
  ) {
    throw new Error("authentication data consent removed or sign-in cancelled");
  }
}

function getIdentityApi() {
  if (isFirefox() && browser.identity) return browser.identity;
  if (isChrome() && chrome.identity) return chrome.identity;
  return null;
}

function launchWebAuthFlow(url) {
  try {
    if (isFirefox() && browser.identity && typeof browser.identity.launchWebAuthFlow === "function") {
      return browser.identity.launchWebAuthFlow({ url, interactive: true });
    }
  } catch (_) {}
  return new Promise((resolve, reject) => {
    if (!isChrome() || !chrome.identity || typeof chrome.identity.launchWebAuthFlow !== "function") {
      reject(new Error("identity API not available"));
      return;
    }
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
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

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === "patreon_logout") {
    clearPatreonAuth();
  } else if (request.message === "ryd_has_authentication_consent") {
    hasAuthenticationDataPermission({ queryBackground: false }).then((granted) => sendResponse({ granted }));
    return true;
  } else if (request.message === "ryd_open_tab") {
    const targetUrl = typeof request?.url === "string" ? request.url : null;
    if (!targetUrl) {
      sendResponse?.({ success: false, error: "invalid_url" });
      return;
    }

    try {
      if (api?.tabs?.create) {
        api.tabs.create({ url: targetUrl }, () => {
          if (api.runtime?.lastError) {
            console.debug("Tab open failed:", api.runtime.lastError.message);
          }
        });
        sendResponse?.({ success: true });
        return;
      }
    } catch (error) {
      console.debug("Tab open threw:", error?.message ?? error);
    }

    sendResponse?.({ success: false, error: "tabs_api_unavailable" });
    return;
  } else if (request.message == "set_state") {
    // chrome.identity.getAuthToken({ interactive: true }, function (token) {
    let token = "";
    fetch(getApiEndpoint(`/votes?videoId=${request.videoId}&likeCount=${request.likeCount || ""}`), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => response.json())
      .then((response) => {
        sendResponse(response);
      })
      .catch();
    return true;
  } else if (request.message == "send_links") {
    toSend = toSend.concat(request.videoIds.filter((x) => !sentIds.has(x)));
    if (toSend.length >= 20) {
      fetch(getApiEndpoint("/votes"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toSend),
      });
      for (const toSendUrl of toSend) {
        sentIds.add(toSendUrl);
      }
      toSend = [];
    }
  } else if (request.message == "register") {
    voteClient
      .ensureRegistered()
      .then(({ userId }) => sendResponse?.({ success: true, userId }))
      .catch((error) => sendResponse?.({ success: false, error: error.message }));
    return true;
  } else if (request.message == "send_vote") {
    voteClient
      .submitVote(request.videoId, request.vote)
      .then(() => sendResponse?.({ success: true }))
      .catch((error) => sendResponse?.({ success: false, error: error.message }));
    return true;
  } else if (request.message === "patreon_oauth_login") {
    const generation = ++authenticationGeneration;
    (async () => {
      try {
        await requireCurrentAuthenticationConsent(generation);

        const idApi = getIdentityApi();
        if (
          !idApi ||
          typeof (idApi.getRedirectURL || (isChrome() && chrome.identity && chrome.identity.getRedirectURL)) !==
            "function"
        ) {
          sendResponse({ success: false, error: "identity API not available" });
          return;
        }
        const redirectUri =
          isFirefox() && browser.identity.getRedirectURL
            ? browser.identity.getRedirectURL()
            : isChrome() && chrome.identity.getRedirectURL
              ? chrome.identity.getRedirectURL()
              : "";

        const startRes = await fetch(
          getApiEndpoint(`/api/auth/oauth/login?redirectUri=${encodeURIComponent(redirectUri)}`),
        );
        const startData = await startRes.json();

        await requireCurrentAuthenticationConsent(generation);
        const responseUrl = await launchWebAuthFlow(startData.authUrl);
        const { code, state } = extractOAuthParams(responseUrl);
        if (!code) {
          sendResponse({ success: false, error: "No authorization code received" });
          return;
        }

        await requireCurrentAuthenticationConsent(generation);

        const exchangeRes = await fetch(getApiEndpoint("/api/auth/oauth/exchange"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            state,
            expectedState: startData.state,
            redirectUri: startData.redirectUri || redirectUri,
          }),
        });
        const authData = await exchangeRes.json();
        if (authData && authData.success) {
          handlePatreonAuthComplete(authData.user, authData.sessionToken, generation, (stored) => {
            sendResponse(
              stored
                ? { success: true, user: authData.user }
                : { success: false, error: "authentication data consent removed" },
            );
          });
        } else {
          sendResponse({ success: false, error: (authData && authData.error) || "OAuth exchange failed" });
        }
      } catch (e) {
        console.error("patreon_oauth_login error", e);
        sendResponse({ success: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  } else if (request.message === "github_oauth_login") {
    const generation = ++authenticationGeneration;
    (async () => {
      try {
        await requireCurrentAuthenticationConsent(generation);

        const idApi = getIdentityApi();
        if (
          !idApi ||
          typeof (idApi.getRedirectURL || (isChrome() && chrome.identity && chrome.identity.getRedirectURL)) !==
            "function"
        ) {
          sendResponse({ success: false, error: "identity API not available" });
          return;
        }

        const redirectUri =
          isFirefox() && browser.identity.getRedirectURL
            ? browser.identity.getRedirectURL()
            : isChrome() && chrome.identity.getRedirectURL
              ? chrome.identity.getRedirectURL()
              : "";

        const authData = await loginWithGitHub({
          redirectUri,
          launchWebAuthFlow,
          requireConsent: () => requireCurrentAuthenticationConsent(generation),
        });
        if (authData && authData.success) {
          handlePatreonAuthComplete(authData.user, authData.sessionToken, generation, (stored) => {
            sendResponse(
              stored
                ? { success: true, user: authData.user }
                : { success: false, error: "authentication data consent removed" },
            );
          });
        } else {
          sendResponse({ success: false, error: (authData && authData.error) || "OAuth exchange failed" });
        }
      } catch (e) {
        console.error("github_oauth_login error", e);
        sendResponse({ success: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
});

function openChangelogTab(version) {
  try {
    const url = getChangelogUrl();
    api.tabs.create({ url }, () => {
      if (api.runtime.lastError) {
        console.debug("Changelog tab could not open:", api.runtime.lastError.message);
        return;
      }
      persistChangelogVersion(version);
    });
  } catch (error) {
    console.debug("Failed to open changelog tab", error);
  }
}

function scheduleChangelogVersion(version) {
  const storage = api?.storage?.local;
  if (!storage || typeof storage.set !== "function") {
    return false;
  }
  try {
    const valueToStore = version || true;
    storage.set({ [PENDING_CHANGELOG_STORAGE_KEY]: valueToStore }, () => {
      if (api.runtime.lastError) {
        console.debug("Failed to persist pending changelog version:", api.runtime.lastError.message);
      }
    });
    return true;
  } catch (error) {
    console.debug("Storage set failed for pending changelog version", error);
    return false;
  }
}

function clearPendingChangelogVersion() {
  const storage = api?.storage?.local;
  if (!storage || typeof storage.remove !== "function") {
    return;
  }
  try {
    storage.remove(PENDING_CHANGELOG_STORAGE_KEY, () => {
      if (api.runtime.lastError) {
        console.debug("Failed to clear pending changelog version:", api.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.debug("Storage remove failed for pending changelog version", error);
  }
}

function showPendingChangelogIfNeeded() {
  const storage = api?.storage?.local;
  if (!storage || typeof storage.get !== "function") {
    return;
  }

  try {
    storage.get([PENDING_CHANGELOG_STORAGE_KEY, CHANGELOG_STORAGE_KEY], (result) => {
      if (api.runtime.lastError) {
        console.debug("Changelog storage read failed:", api.runtime.lastError.message);
        return;
      }

      const pendingValue = result?.[PENDING_CHANGELOG_STORAGE_KEY];
      if (pendingValue === undefined || pendingValue === null || pendingValue === "") {
        return;
      }

      const lastShownValue = result?.[CHANGELOG_STORAGE_KEY];
      if (lastShownValue !== undefined && lastShownValue !== null && lastShownValue !== "") {
        clearPendingChangelogVersion();
        return;
      }

      openChangelogTab(typeof pendingValue === "string" ? pendingValue : null);
    });
  } catch (error) {
    console.debug("Storage get failed for pending changelog version", error);
  }
}

function persistChangelogVersion(version) {
  const storage = api?.storage?.local;
  if (!storage || typeof storage.set !== "function") {
    clearPendingChangelogVersion();
    return;
  }
  try {
    const valueToStore = version || true;
    storage.set({ [CHANGELOG_STORAGE_KEY]: valueToStore }, () => {
      if (api.runtime.lastError) {
        console.debug("Failed to persist changelog version:", api.runtime.lastError.message);
        return;
      }
      clearPendingChangelogVersion();
    });
  } catch (error) {
    console.debug("Storage set failed for changelog version", error);
  }
}

function maybeShowChangelog(details) {
  const reason = details?.reason;
  if (!reason) {
    return;
  }

  if (reason === "browser_update" || reason === "chrome_update") {
    return;
  }

  if (reason !== "install" && reason !== "update") {
    return;
  }

  const manifest = api.runtime.getManifest();
  const currentVersion = manifest?.version;
  const storage = api?.storage?.local;
  // Temporary add-ons do not survive a browser restart, so their updates cannot wait for onStartup.
  const showImmediately = reason === "install" || details.temporary === true;

  const showChangelog = () => {
    openChangelogTab(currentVersion || null);
  };

  if (!storage || typeof storage.get !== "function") {
    showChangelog();
    return;
  }

  try {
    storage.get([CHANGELOG_STORAGE_KEY, PENDING_CHANGELOG_STORAGE_KEY], (result) => {
      if (api.runtime.lastError) {
        console.debug("Changelog storage read failed:", api.runtime.lastError.message);
        showChangelog();
        return;
      }

      const hasStoredValue = (value) => value !== undefined && value !== null && value !== "";
      const lastShownValue = result?.[CHANGELOG_STORAGE_KEY];
      const pendingValue = result?.[PENDING_CHANGELOG_STORAGE_KEY];

      if (showImmediately) {
        if (hasStoredValue(pendingValue)) {
          clearPendingChangelogVersion();
        }
        if (!hasStoredValue(lastShownValue)) {
          showChangelog();
        }
        return;
      }

      if (hasStoredValue(lastShownValue)) {
        return;
      }

      if (hasStoredValue(pendingValue)) {
        if (currentVersion && pendingValue !== currentVersion) {
          scheduleChangelogVersion(currentVersion);
        }
        return;
      }

      if (!scheduleChangelogVersion(currentVersion || null)) {
        showChangelog();
      }
    });
  } catch (error) {
    console.debug("Storage get failed for changelog version", error);
    showChangelog();
  }
}

api.runtime.onInstalled.addListener((details) => {
  maybeShowChangelog(details);
});

if (api?.runtime?.onStartup && typeof api.runtime.onStartup.addListener === "function") {
  api.runtime.onStartup.addListener(() => {
    showPendingChangelogIfNeeded();
  });
}

// api.storage.local.get(['lastShowChangelogVersion'], (details) => {
//   if (extConfig.showUpdatePopup === true &&
//     details.lastShowChangelogVersion !== chrome.runtime.getManifest().version
//     ) {
//     // keep it inside get to avoid race condition
//     api.storage.local.set({'lastShowChangelogVersion ': chrome.runtime.getManifest().version});
//     // wait until async get runs & don't steal tab focus
//     api.tabs.create({url: api.runtime.getURL("/changelog/4/changelog_4.0.html"), active: false});
//   }
// });

const sentIds = new Set();
let toSend = [];

function storageChangeHandler(changes, area) {
  if (changes.disableVoteSubmission !== undefined) {
    handleDisableVoteSubmissionChangeEvent(changes.disableVoteSubmission.newValue);
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
  if (changes.numberDisplayReformatLikes !== undefined) {
    handleNumberDisplayReformatLikesChangeEvent(changes.numberDisplayReformatLikes.newValue);
  }
  if (changes.disableLogging !== undefined) {
    handleDisableLoggingChangeEvent(changes.disableLogging.newValue);
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
  extConfig.disableVoteSubmission = value;
  if (value === true) {
    changeIcon(voteDisabledIconName);
  } else {
    changeIcon(defaultIconName);
  }
}

function handleDisableLoggingChangeEvent(value) {
  extConfig.disableLogging = value;
}

function handleNumberDisplayFormatChangeEvent(value) {
  extConfig.numberDisplayFormat = value;
}

function handleShowTooltipPercentageChangeEvent(value) {
  extConfig.showTooltipPercentage = value;
}

function handleTooltipPercentageModeChangeEvent(value) {
  if (!value) {
    value = "dash_like";
  }
  extConfig.tooltipPercentageMode = value;
}

function changeIcon(iconName) {
  if (api.action !== undefined) api.action.setIcon({ path: "/icons/" + iconName });
  else if (api.browserAction !== undefined) api.browserAction.setIcon({ path: "/icons/" + iconName });
  else console.log("changing icon is not supported");
}

function handleColoredThumbsChangeEvent(value) {
  extConfig.coloredThumbs = value;
}

function handleColoredBarChangeEvent(value) {
  extConfig.coloredBar = value;
}

function handleColorThemeChangeEvent(value) {
  if (!value) {
    value = "classic";
  }
  extConfig.colorTheme = value;
}

function handleNumberDisplayReformatLikesChangeEvent(value) {
  extConfig.numberDisplayReformatLikes = value;
}

function handleHidePremiumTeaserChangeEvent(value) {
  extConfig.hidePremiumTeaser = value === true;
}

function handleHideClutterButtonsChangeEvent(value) {
  extConfig.hideClutterButtons = value === true;
}

api.storage.onChanged.addListener(storageChangeHandler);

function initExtConfig() {
  initializeDisableVoteSubmission();
  initializeDisableLogging();
  initializeColoredThumbs();
  initializeColoredBar();
  initializeColorTheme();
  initializeNumberDisplayFormat();
  initializeNumberDisplayReformatLikes();
  initializeTooltipPercentage();
  initializeTooltipPercentageMode();
  initializeHidePremiumTeaser();
  initializeHideClutterButtons();
}

function initializeDisableVoteSubmission() {
  api.storage.local.get(["disableVoteSubmission"], (res) => {
    if (res.disableVoteSubmission === undefined) {
      api.storage.local.set({ disableVoteSubmission: false });
    } else {
      extConfig.disableVoteSubmission = res.disableVoteSubmission;
      if (res.disableVoteSubmission) changeIcon(voteDisabledIconName);
    }
  });
}

function initializeDisableLogging() {
  api.storage.local.get(["disableLogging"], (res) => {
    if (res.disableLogging === undefined) {
      api.storage.local.set({ disableLogging: true });
    } else {
      extConfig.disableLogging = res.disableLogging;
    }
  });
}

function initializeColoredThumbs() {
  api.storage.local.get(["coloredThumbs"], (res) => {
    if (res.coloredThumbs === undefined) {
      api.storage.local.set({ coloredThumbs: false });
    } else {
      extConfig.coloredThumbs = res.coloredThumbs;
    }
  });
}

function initializeColoredBar() {
  api.storage.local.get(["coloredBar"], (res) => {
    if (res.coloredBar === undefined) {
      api.storage.local.set({ coloredBar: false });
    } else {
      extConfig.coloredBar = res.coloredBar;
    }
  });
}

function initializeColorTheme() {
  api.storage.local.get(["colorTheme"], (res) => {
    if (res.colorTheme === undefined) {
      api.storage.local.set({ colorTheme: false });
    } else {
      extConfig.colorTheme = res.colorTheme;
    }
  });
}

function initializeNumberDisplayFormat() {
  api.storage.local.get(["numberDisplayFormat"], (res) => {
    if (res.numberDisplayFormat === undefined) {
      api.storage.local.set({ numberDisplayFormat: "compactShort" });
    } else {
      extConfig.numberDisplayFormat = res.numberDisplayFormat;
    }
  });
}

function initializeTooltipPercentage() {
  api.storage.local.get(["showTooltipPercentage"], (res) => {
    if (res.showTooltipPercentage === undefined) {
      api.storage.local.set({ showTooltipPercentage: false });
    } else {
      extConfig.showTooltipPercentage = res.showTooltipPercentage;
    }
  });
}

function initializeTooltipPercentageMode() {
  api.storage.local.get(["tooltipPercentageMode"], (res) => {
    if (res.tooltipPercentageMode === undefined) {
      api.storage.local.set({ tooltipPercentageMode: "dash_like" });
    } else {
      extConfig.tooltipPercentageMode = res.tooltipPercentageMode;
    }
  });
}

function initializeNumberDisplayReformatLikes() {
  api.storage.local.get(["numberDisplayReformatLikes"], (res) => {
    if (res.numberDisplayReformatLikes === undefined) {
      api.storage.local.set({ numberDisplayReformatLikes: false });
    } else {
      extConfig.numberDisplayReformatLikes = res.numberDisplayReformatLikes;
    }
  });
}

function initializeHidePremiumTeaser() {
  api.storage.local.get(["hidePremiumTeaser"], (res) => {
    if (res.hidePremiumTeaser === undefined) {
      api.storage.local.set({ hidePremiumTeaser: false });
      extConfig.hidePremiumTeaser = false;
    } else {
      extConfig.hidePremiumTeaser = res.hidePremiumTeaser === true;
    }
  });
}

function initializeHideClutterButtons() {
  api.storage.local.get(["hideClutterButtons"], (res) => {
    if (res.hideClutterButtons === undefined) {
      api.storage.local.set({ hideClutterButtons: false });
      extConfig.hideClutterButtons = false;
    } else {
      extConfig.hideClutterButtons = res.hideClutterButtons === true;
    }
  });
}

function isChrome() {
  return typeof chrome !== "undefined" && typeof chrome.runtime !== "undefined";
}

function isFirefox() {
  return typeof browser !== "undefined" && typeof browser.runtime !== "undefined";
}

/******/ })()
;