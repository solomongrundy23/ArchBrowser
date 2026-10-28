/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 150:
/***/ (function(module, exports) {

var __WEBPACK_AMD_DEFINE_FACTORY__, __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;(function (global, factory) {
  if (true) {
    !(__WEBPACK_AMD_DEFINE_ARRAY__ = [module], __WEBPACK_AMD_DEFINE_FACTORY__ = (factory),
		__WEBPACK_AMD_DEFINE_RESULT__ = (typeof __WEBPACK_AMD_DEFINE_FACTORY__ === 'function' ?
		(__WEBPACK_AMD_DEFINE_FACTORY__.apply(exports, __WEBPACK_AMD_DEFINE_ARRAY__)) : __WEBPACK_AMD_DEFINE_FACTORY__),
		__WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
  } else { var mod; }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (module) {
  /* webextension-polyfill - v0.10.0 - Fri Aug 12 2022 19:42:44 */

  /* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */

  /* vim: set sts=2 sw=2 et tw=80: */

  /* This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
  "use strict";

  if (!globalThis.chrome?.runtime?.id) {
    throw new Error("This script should only be loaded in a browser extension.");
  }

  if (typeof globalThis.browser === "undefined" || Object.getPrototypeOf(globalThis.browser) !== Object.prototype) {
    const CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE = "The message port closed before a response was received."; // Wrapping the bulk of this polyfill in a one-time-use function is a minor
    // optimization for Firefox. Since Spidermonkey does not fully parse the
    // contents of a function until the first time it's called, and since it will
    // never actually need to be called, this allows the polyfill to be included
    // in Firefox nearly for free.

    const wrapAPIs = extensionAPIs => {
      // NOTE: apiMetadata is associated to the content of the api-metadata.json file
      // at build time by replacing the following "include" with the content of the
      // JSON file.
      const apiMetadata = {
        "alarms": {
          "clear": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "clearAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "get": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "bookmarks": {
          "create": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getChildren": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getRecent": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getSubTree": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getTree": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "move": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeTree": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "search": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        },
        "browserAction": {
          "disable": {
            "minArgs": 0,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "enable": {
            "minArgs": 0,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "getBadgeBackgroundColor": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getBadgeText": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getPopup": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getTitle": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "openPopup": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "setBadgeBackgroundColor": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setBadgeText": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setIcon": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "setPopup": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setTitle": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          }
        },
        "browsingData": {
          "remove": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "removeCache": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeCookies": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeDownloads": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeFormData": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeHistory": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeLocalStorage": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removePasswords": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removePluginData": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "settings": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "commands": {
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "contextMenus": {
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        },
        "cookies": {
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAllCookieStores": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "set": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "devtools": {
          "inspectedWindow": {
            "eval": {
              "minArgs": 1,
              "maxArgs": 2,
              "singleCallbackArg": false
            }
          },
          "panels": {
            "create": {
              "minArgs": 3,
              "maxArgs": 3,
              "singleCallbackArg": true
            },
            "elements": {
              "createSidebarPane": {
                "minArgs": 1,
                "maxArgs": 1
              }
            }
          }
        },
        "downloads": {
          "cancel": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "download": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "erase": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getFileIcon": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "open": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "pause": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeFile": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "resume": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "search": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "show": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          }
        },
        "extension": {
          "isAllowedFileSchemeAccess": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "isAllowedIncognitoAccess": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "history": {
          "addUrl": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "deleteAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "deleteRange": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "deleteUrl": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getVisits": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "search": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "i18n": {
          "detectLanguage": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAcceptLanguages": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "identity": {
          "launchWebAuthFlow": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "idle": {
          "queryState": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "management": {
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getSelf": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "setEnabled": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "uninstallSelf": {
            "minArgs": 0,
            "maxArgs": 1
          }
        },
        "notifications": {
          "clear": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "create": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getPermissionLevel": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        },
        "pageAction": {
          "getPopup": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getTitle": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "hide": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setIcon": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "setPopup": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setTitle": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "show": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          }
        },
        "permissions": {
          "contains": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "request": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "runtime": {
          "getBackgroundPage": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getPlatformInfo": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "openOptionsPage": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "requestUpdateCheck": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "sendMessage": {
            "minArgs": 1,
            "maxArgs": 3
          },
          "sendNativeMessage": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "setUninstallURL": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "sessions": {
          "getDevices": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getRecentlyClosed": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "restore": {
            "minArgs": 0,
            "maxArgs": 1
          }
        },
        "storage": {
          "local": {
            "clear": {
              "minArgs": 0,
              "maxArgs": 0
            },
            "get": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "getBytesInUse": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "remove": {
              "minArgs": 1,
              "maxArgs": 1
            },
            "set": {
              "minArgs": 1,
              "maxArgs": 1
            }
          },
          "managed": {
            "get": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "getBytesInUse": {
              "minArgs": 0,
              "maxArgs": 1
            }
          },
          "sync": {
            "clear": {
              "minArgs": 0,
              "maxArgs": 0
            },
            "get": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "getBytesInUse": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "remove": {
              "minArgs": 1,
              "maxArgs": 1
            },
            "set": {
              "minArgs": 1,
              "maxArgs": 1
            }
          }
        },
        "tabs": {
          "captureVisibleTab": {
            "minArgs": 0,
            "maxArgs": 2
          },
          "create": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "detectLanguage": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "discard": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "duplicate": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "executeScript": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getCurrent": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getZoom": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getZoomSettings": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "goBack": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "goForward": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "highlight": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "insertCSS": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "move": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "query": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "reload": {
            "minArgs": 0,
            "maxArgs": 2
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeCSS": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "sendMessage": {
            "minArgs": 2,
            "maxArgs": 3
          },
          "setZoom": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "setZoomSettings": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "update": {
            "minArgs": 1,
            "maxArgs": 2
          }
        },
        "topSites": {
          "get": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "webNavigation": {
          "getAllFrames": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getFrame": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "webRequest": {
          "handlerBehaviorChanged": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "windows": {
          "create": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "get": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getCurrent": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getLastFocused": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        }
      };

      if (Object.keys(apiMetadata).length === 0) {
        throw new Error("api-metadata.json has not been included in browser-polyfill");
      }
      /**
       * A WeakMap subclass which creates and stores a value for any key which does
       * not exist when accessed, but behaves exactly as an ordinary WeakMap
       * otherwise.
       *
       * @param {function} createItem
       *        A function which will be called in order to create the value for any
       *        key which does not exist, the first time it is accessed. The
       *        function receives, as its only argument, the key being created.
       */


      class DefaultWeakMap extends WeakMap {
        constructor(createItem, items = undefined) {
          super(items);
          this.createItem = createItem;
        }

        get(key) {
          if (!this.has(key)) {
            this.set(key, this.createItem(key));
          }

          return super.get(key);
        }

      }
      /**
       * Returns true if the given object is an object with a `then` method, and can
       * therefore be assumed to behave as a Promise.
       *
       * @param {*} value The value to test.
       * @returns {boolean} True if the value is thenable.
       */


      const isThenable = value => {
        return value && typeof value === "object" && typeof value.then === "function";
      };
      /**
       * Creates and returns a function which, when called, will resolve or reject
       * the given promise based on how it is called:
       *
       * - If, when called, `chrome.runtime.lastError` contains a non-null object,
       *   the promise is rejected with that value.
       * - If the function is called with exactly one argument, the promise is
       *   resolved to that value.
       * - Otherwise, the promise is resolved to an array containing all of the
       *   function's arguments.
       *
       * @param {object} promise
       *        An object containing the resolution and rejection functions of a
       *        promise.
       * @param {function} promise.resolve
       *        The promise's resolution function.
       * @param {function} promise.reject
       *        The promise's rejection function.
       * @param {object} metadata
       *        Metadata about the wrapped method which has created the callback.
       * @param {boolean} metadata.singleCallbackArg
       *        Whether or not the promise is resolved with only the first
       *        argument of the callback, alternatively an array of all the
       *        callback arguments is resolved. By default, if the callback
       *        function is invoked with only a single argument, that will be
       *        resolved to the promise, while all arguments will be resolved as
       *        an array if multiple are given.
       *
       * @returns {function}
       *        The generated callback function.
       */


      const makeCallback = (promise, metadata) => {
        return (...callbackArgs) => {
          if (extensionAPIs.runtime.lastError) {
            promise.reject(new Error(extensionAPIs.runtime.lastError.message));
          } else if (metadata.singleCallbackArg || callbackArgs.length <= 1 && metadata.singleCallbackArg !== false) {
            promise.resolve(callbackArgs[0]);
          } else {
            promise.resolve(callbackArgs);
          }
        };
      };

      const pluralizeArguments = numArgs => numArgs == 1 ? "argument" : "arguments";
      /**
       * Creates a wrapper function for a method with the given name and metadata.
       *
       * @param {string} name
       *        The name of the method which is being wrapped.
       * @param {object} metadata
       *        Metadata about the method being wrapped.
       * @param {integer} metadata.minArgs
       *        The minimum number of arguments which must be passed to the
       *        function. If called with fewer than this number of arguments, the
       *        wrapper will raise an exception.
       * @param {integer} metadata.maxArgs
       *        The maximum number of arguments which may be passed to the
       *        function. If called with more than this number of arguments, the
       *        wrapper will raise an exception.
       * @param {boolean} metadata.singleCallbackArg
       *        Whether or not the promise is resolved with only the first
       *        argument of the callback, alternatively an array of all the
       *        callback arguments is resolved. By default, if the callback
       *        function is invoked with only a single argument, that will be
       *        resolved to the promise, while all arguments will be resolved as
       *        an array if multiple are given.
       *
       * @returns {function(object, ...*)}
       *       The generated wrapper function.
       */


      const wrapAsyncFunction = (name, metadata) => {
        return function asyncFunctionWrapper(target, ...args) {
          if (args.length < metadata.minArgs) {
            throw new Error(`Expected at least ${metadata.minArgs} ${pluralizeArguments(metadata.minArgs)} for ${name}(), got ${args.length}`);
          }

          if (args.length > metadata.maxArgs) {
            throw new Error(`Expected at most ${metadata.maxArgs} ${pluralizeArguments(metadata.maxArgs)} for ${name}(), got ${args.length}`);
          }

          return new Promise((resolve, reject) => {
            if (metadata.fallbackToNoCallback) {
              // This API method has currently no callback on Chrome, but it return a promise on Firefox,
              // and so the polyfill will try to call it with a callback first, and it will fallback
              // to not passing the callback if the first call fails.
              try {
                target[name](...args, makeCallback({
                  resolve,
                  reject
                }, metadata));
              } catch (cbError) {
                console.warn(`${name} API method doesn't seem to support the callback parameter, ` + "falling back to call it without a callback: ", cbError);
                target[name](...args); // Update the API method metadata, so that the next API calls will not try to
                // use the unsupported callback anymore.

                metadata.fallbackToNoCallback = false;
                metadata.noCallback = true;
                resolve();
              }
            } else if (metadata.noCallback) {
              target[name](...args);
              resolve();
            } else {
              target[name](...args, makeCallback({
                resolve,
                reject
              }, metadata));
            }
          });
        };
      };
      /**
       * Wraps an existing method of the target object, so that calls to it are
       * intercepted by the given wrapper function. The wrapper function receives,
       * as its first argument, the original `target` object, followed by each of
       * the arguments passed to the original method.
       *
       * @param {object} target
       *        The original target object that the wrapped method belongs to.
       * @param {function} method
       *        The method being wrapped. This is used as the target of the Proxy
       *        object which is created to wrap the method.
       * @param {function} wrapper
       *        The wrapper function which is called in place of a direct invocation
       *        of the wrapped method.
       *
       * @returns {Proxy<function>}
       *        A Proxy object for the given method, which invokes the given wrapper
       *        method in its place.
       */


      const wrapMethod = (target, method, wrapper) => {
        return new Proxy(method, {
          apply(targetMethod, thisObj, args) {
            return wrapper.call(thisObj, target, ...args);
          }

        });
      };

      let hasOwnProperty = Function.call.bind(Object.prototype.hasOwnProperty);
      /**
       * Wraps an object in a Proxy which intercepts and wraps certain methods
       * based on the given `wrappers` and `metadata` objects.
       *
       * @param {object} target
       *        The target object to wrap.
       *
       * @param {object} [wrappers = {}]
       *        An object tree containing wrapper functions for special cases. Any
       *        function present in this object tree is called in place of the
       *        method in the same location in the `target` object tree. These
       *        wrapper methods are invoked as described in {@see wrapMethod}.
       *
       * @param {object} [metadata = {}]
       *        An object tree containing metadata used to automatically generate
       *        Promise-based wrapper functions for asynchronous. Any function in
       *        the `target` object tree which has a corresponding metadata object
       *        in the same location in the `metadata` tree is replaced with an
       *        automatically-generated wrapper function, as described in
       *        {@see wrapAsyncFunction}
       *
       * @returns {Proxy<object>}
       */

      const wrapObject = (target, wrappers = {}, metadata = {}) => {
        let cache = Object.create(null);
        let handlers = {
          has(proxyTarget, prop) {
            return prop in target || prop in cache;
          },

          get(proxyTarget, prop, receiver) {
            if (prop in cache) {
              return cache[prop];
            }

            if (!(prop in target)) {
              return undefined;
            }

            let value = target[prop];

            if (typeof value === "function") {
              // This is a method on the underlying object. Check if we need to do
              // any wrapping.
              if (typeof wrappers[prop] === "function") {
                // We have a special-case wrapper for this method.
                value = wrapMethod(target, target[prop], wrappers[prop]);
              } else if (hasOwnProperty(metadata, prop)) {
                // This is an async method that we have metadata for. Create a
                // Promise wrapper for it.
                let wrapper = wrapAsyncFunction(prop, metadata[prop]);
                value = wrapMethod(target, target[prop], wrapper);
              } else {
                // This is a method that we don't know or care about. Return the
                // original method, bound to the underlying object.
                value = value.bind(target);
              }
            } else if (typeof value === "object" && value !== null && (hasOwnProperty(wrappers, prop) || hasOwnProperty(metadata, prop))) {
              // This is an object that we need to do some wrapping for the children
              // of. Create a sub-object wrapper for it with the appropriate child
              // metadata.
              value = wrapObject(value, wrappers[prop], metadata[prop]);
            } else if (hasOwnProperty(metadata, "*")) {
              // Wrap all properties in * namespace.
              value = wrapObject(value, wrappers[prop], metadata["*"]);
            } else {
              // We don't need to do any wrapping for this property,
              // so just forward all access to the underlying object.
              Object.defineProperty(cache, prop, {
                configurable: true,
                enumerable: true,

                get() {
                  return target[prop];
                },

                set(value) {
                  target[prop] = value;
                }

              });
              return value;
            }

            cache[prop] = value;
            return value;
          },

          set(proxyTarget, prop, value, receiver) {
            if (prop in cache) {
              cache[prop] = value;
            } else {
              target[prop] = value;
            }

            return true;
          },

          defineProperty(proxyTarget, prop, desc) {
            return Reflect.defineProperty(cache, prop, desc);
          },

          deleteProperty(proxyTarget, prop) {
            return Reflect.deleteProperty(cache, prop);
          }

        }; // Per contract of the Proxy API, the "get" proxy handler must return the
        // original value of the target if that value is declared read-only and
        // non-configurable. For this reason, we create an object with the
        // prototype set to `target` instead of using `target` directly.
        // Otherwise we cannot return a custom object for APIs that
        // are declared read-only and non-configurable, such as `chrome.devtools`.
        //
        // The proxy handlers themselves will still use the original `target`
        // instead of the `proxyTarget`, so that the methods and properties are
        // dereferenced via the original targets.

        let proxyTarget = Object.create(target);
        return new Proxy(proxyTarget, handlers);
      };
      /**
       * Creates a set of wrapper functions for an event object, which handles
       * wrapping of listener functions that those messages are passed.
       *
       * A single wrapper is created for each listener function, and stored in a
       * map. Subsequent calls to `addListener`, `hasListener`, or `removeListener`
       * retrieve the original wrapper, so that  attempts to remove a
       * previously-added listener work as expected.
       *
       * @param {DefaultWeakMap<function, function>} wrapperMap
       *        A DefaultWeakMap object which will create the appropriate wrapper
       *        for a given listener function when one does not exist, and retrieve
       *        an existing one when it does.
       *
       * @returns {object}
       */


      const wrapEvent = wrapperMap => ({
        addListener(target, listener, ...args) {
          target.addListener(wrapperMap.get(listener), ...args);
        },

        hasListener(target, listener) {
          return target.hasListener(wrapperMap.get(listener));
        },

        removeListener(target, listener) {
          target.removeListener(wrapperMap.get(listener));
        }

      });

      const onRequestFinishedWrappers = new DefaultWeakMap(listener => {
        if (typeof listener !== "function") {
          return listener;
        }
        /**
         * Wraps an onRequestFinished listener function so that it will return a
         * `getContent()` property which returns a `Promise` rather than using a
         * callback API.
         *
         * @param {object} req
         *        The HAR entry object representing the network request.
         */


        return function onRequestFinished(req) {
          const wrappedReq = wrapObject(req, {}
          /* wrappers */
          , {
            getContent: {
              minArgs: 0,
              maxArgs: 0
            }
          });
          listener(wrappedReq);
        };
      });
      const onMessageWrappers = new DefaultWeakMap(listener => {
        if (typeof listener !== "function") {
          return listener;
        }
        /**
         * Wraps a message listener function so that it may send responses based on
         * its return value, rather than by returning a sentinel value and calling a
         * callback. If the listener function returns a Promise, the response is
         * sent when the promise either resolves or rejects.
         *
         * @param {*} message
         *        The message sent by the other end of the channel.
         * @param {object} sender
         *        Details about the sender of the message.
         * @param {function(*)} sendResponse
         *        A callback which, when called with an arbitrary argument, sends
         *        that value as a response.
         * @returns {boolean}
         *        True if the wrapped listener returned a Promise, which will later
         *        yield a response. False otherwise.
         */


        return function onMessage(message, sender, sendResponse) {
          let didCallSendResponse = false;
          let wrappedSendResponse;
          let sendResponsePromise = new Promise(resolve => {
            wrappedSendResponse = function (response) {
              didCallSendResponse = true;
              resolve(response);
            };
          });
          let result;

          try {
            result = listener(message, sender, wrappedSendResponse);
          } catch (err) {
            result = Promise.reject(err);
          }

          const isResultThenable = result !== true && isThenable(result); // If the listener didn't returned true or a Promise, or called
          // wrappedSendResponse synchronously, we can exit earlier
          // because there will be no response sent from this listener.

          if (result !== true && !isResultThenable && !didCallSendResponse) {
            return false;
          } // A small helper to send the message if the promise resolves
          // and an error if the promise rejects (a wrapped sendMessage has
          // to translate the message into a resolved promise or a rejected
          // promise).


          const sendPromisedResult = promise => {
            promise.then(msg => {
              // send the message value.
              sendResponse(msg);
            }, error => {
              // Send a JSON representation of the error if the rejected value
              // is an instance of error, or the object itself otherwise.
              let message;

              if (error && (error instanceof Error || typeof error.message === "string")) {
                message = error.message;
              } else {
                message = "An unexpected error occurred";
              }

              sendResponse({
                __mozWebExtensionPolyfillReject__: true,
                message
              });
            }).catch(err => {
              // Print an error on the console if unable to send the response.
              console.error("Failed to send onMessage rejected reply", err);
            });
          }; // If the listener returned a Promise, send the resolved value as a
          // result, otherwise wait the promise related to the wrappedSendResponse
          // callback to resolve and send it as a response.


          if (isResultThenable) {
            sendPromisedResult(result);
          } else {
            sendPromisedResult(sendResponsePromise);
          } // Let Chrome know that the listener is replying.


          return true;
        };
      });

      const wrappedSendMessageCallback = ({
        reject,
        resolve
      }, reply) => {
        if (extensionAPIs.runtime.lastError) {
          // Detect when none of the listeners replied to the sendMessage call and resolve
          // the promise to undefined as in Firefox.
          // See https://github.com/mozilla/webextension-polyfill/issues/130
          if (extensionAPIs.runtime.lastError.message === CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE) {
            resolve();
          } else {
            reject(new Error(extensionAPIs.runtime.lastError.message));
          }
        } else if (reply && reply.__mozWebExtensionPolyfillReject__) {
          // Convert back the JSON representation of the error into
          // an Error instance.
          reject(new Error(reply.message));
        } else {
          resolve(reply);
        }
      };

      const wrappedSendMessage = (name, metadata, apiNamespaceObj, ...args) => {
        if (args.length < metadata.minArgs) {
          throw new Error(`Expected at least ${metadata.minArgs} ${pluralizeArguments(metadata.minArgs)} for ${name}(), got ${args.length}`);
        }

        if (args.length > metadata.maxArgs) {
          throw new Error(`Expected at most ${metadata.maxArgs} ${pluralizeArguments(metadata.maxArgs)} for ${name}(), got ${args.length}`);
        }

        return new Promise((resolve, reject) => {
          const wrappedCb = wrappedSendMessageCallback.bind(null, {
            resolve,
            reject
          });
          args.push(wrappedCb);
          apiNamespaceObj.sendMessage(...args);
        });
      };

      const staticWrappers = {
        devtools: {
          network: {
            onRequestFinished: wrapEvent(onRequestFinishedWrappers)
          }
        },
        runtime: {
          onMessage: wrapEvent(onMessageWrappers),
          onMessageExternal: wrapEvent(onMessageWrappers),
          sendMessage: wrappedSendMessage.bind(null, "sendMessage", {
            minArgs: 1,
            maxArgs: 3
          })
        },
        tabs: {
          sendMessage: wrappedSendMessage.bind(null, "sendMessage", {
            minArgs: 2,
            maxArgs: 3
          })
        }
      };
      const settingMetadata = {
        clear: {
          minArgs: 1,
          maxArgs: 1
        },
        get: {
          minArgs: 1,
          maxArgs: 1
        },
        set: {
          minArgs: 1,
          maxArgs: 1
        }
      };
      apiMetadata.privacy = {
        network: {
          "*": settingMetadata
        },
        services: {
          "*": settingMetadata
        },
        websites: {
          "*": settingMetadata
        }
      };
      return wrapObject(extensionAPIs, staticWrappers, apiMetadata);
    }; // The build process adds a UMD wrapper around this file, which makes the
    // `module` variable available.


    module.exports = wrapAPIs(chrome);
  } else {
    module.exports = globalThis.browser;
  }
});
//# sourceMappingURL=browser-polyfill.js.map


/***/ }),

/***/ 351:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */



const browser = __webpack_require__(150);
const additionalPermission = {"origins": ["<all_urls>"]};
const getAllCookies = browser.cookies.getAll;
const removeCookie = browser.cookies.remove;
const onBeforeSendHeaders = browser.webRequest.onBeforeSendHeaders;
const onSendHeaders = browser.webRequest.onSendHeaders;
const onHeadersReceived = browser.webRequest.onHeadersReceived;

function getUrl(domain, path, isSecure)
{
  return "http" + (isSecure ? "s" : "") + "://" + domain + path;
}
function addRequestListener(sendHeaders, headersReceived)
{
  const urls = {urls: ["<all_urls>"]};
  onSendHeaders.addListener(sendHeaders, urls, ["requestHeaders"]);
  onHeadersReceived.addListener(headersReceived, urls, ["responseHeaders"]);
}

function removeRequestListener(sendHeaders, headersReceived)
{
  onSendHeaders.removeListener(sendHeaders);
  onHeadersReceived.removeListener(headersReceived);
}

function updateRequestObj(details, actionType)
{
  const {url, type} = details;
  return {texts: {url, type}, data: {type: actionType}, request: details};
}

/*******************************************************************************
 * Block user agent
 ******************************************************************************/
function addBlockAgentListener()
{
  browser.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: ["block-agent"]
  });
}

function removeBlockAgentListener()
{
  browser.declarativeNetRequest.updateEnabledRulesets({
    disableRulesetIds: ["block-agent"]
  });
}

function removeStartDot(string)
{
  return string.replace(/^\./, "");
}

async function deleteCookies()
{
  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  const cookies = await browser.cookies.getAll({});
  for (const cookie of cookies)
  {
    const url = getUrl(cookie.domain, cookie.path, cookie.secure);
    const domainWhitelist = cookieWhitelist[removeStartDot(cookie.domain)];
    if (!domainWhitelist || (!domainWhitelist.cookies.includes(cookie.name) &&
        !domainWhitelist.domainWhitelist))
    {
      removeCookie({ "url": url, "name": cookie.name });
    }
  }
}

module.exports = {additionalPermission, getAllCookies,
                  removeCookie, getUrl, addRequestListener,
                  removeRequestListener, updateRequestObj,
                  addBlockAgentListener, removeBlockAgentListener,
                  deleteCookies};


/***/ }),

/***/ 199:
/***/ ((module) => {

/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */

const privacyData = {
  websites:
    ["thirdPartyCookiesAllowed", "hyperlinkAuditingEnabled",
     "referrersEnabled", "protectedContentEnabled"],
  services:
    ["alternateErrorPagesEnabled", "autofillEnabled",
     "hotwordSearchEnabled", "passwordSavingEnabled",
     "safeBrowsingEnabled",
     "safeBrowsingExtendedReportingEnabled",
     "searchSuggestEnabled", "spellingServiceEnabled",
     "translationServiceEnabled"],
  network:
    ["networkPredictionEnabled"]
};

// https://developer.chrome.com/extensions/browsingData#type-DataTypeSet
const browsingData = ["removeAll", "appcache", "cache", "cookies", "downloads",
                      "fileSystems", "formData", "history", "indexedDB",
                      "localStorage", "serverBoundCertificates", "passwords",
                      "pluginData", "serviceWorkers", "webSQL"];

module.exports = {privacyData, browsingData};


/***/ }),

/***/ 382:
/***/ ((module) => {

/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */

function registerActionListener(target, callback)
{
  target.addEventListener("keyup", (ev) =>
  {
    onKeyUp(ev, callback);
  }, false);

  target.addEventListener("click", (ev) =>
  {
    onClick(ev, callback);
  }, false);
}

function onKeyUp(ev, callback)
{
  const {key} = ev;
  const {activeElem} = document;
  let actions = null;

  switch (key)
  {
    case " ":
    case "Enter":
      actions = activeElem.dataset.keyAction;
      break;
    case "Delete":
    case "Backspace":
      actions = activeElem.dataset.keyDelete;
      break;
    case "ArrowUp":
      actions = activeElem.dataset.keyUp;
      break;
    case "ArrowDown":
      actions = activeElem.dataset.keyDown;
      break;
    case "ArrowRight":
      actions = activeElem.dataset.keyRight;
      break;
    case "ArrowLeft":
      actions = activeElem.dataset.keyLeft;
      break;
    case "Escape":
      actions = activeElem.dataset.keyQuite;
      break;
  }

  if (!actions)
    return;

  // TODO: Fix duplication
  ev.preventDefault;
  actions.split(",").forEach(function(action)
  {
    callback(action, activeElem);
  });
}

function onClick(ev, callback)
{
  let element = ev.target;
  let actions = null;

  while (true)
  {
    if (!element)
      break;

    if (element.hasAttribute("data-action"))
    {
      actions = element.getAttribute("data-action");
      break;
    }

    element = element.parentElement;
  }

  if (!actions)
    return;

  ev.preventDefault;
  actions.split(",").forEach(function(action)
  {
    callback(action, element);
  });
}

module.exports = {registerActionListener};


/***/ }),

/***/ 858:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */

const {$, getMessage, $$} = __webpack_require__(91);
const {additionalPermission} = __webpack_require__(351);
const browser = __webpack_require__(150);

async function _createPmToggle(accessor)
{
  const content = $("#settings-list").content;
  const listElem = document.importNode(content, true);
  const dialog = document.querySelector("pm-dialog.info");
  const pmToggle = listElem.querySelector("pm-toggle");
  pmToggle.setAttribute("text", await getMessage(accessor));
  pmToggle.setAttribute("description", await getMessage(accessor + "_desc"));
  pmToggle.addEventListener("info", (e) =>
  {
    const {text, description} = e.target;
    dialog.showDialog(text, {description});
  });

  pmToggle.dataset.access = accessor;
  return [pmToggle, listElem];
}

async function addPrivacyToggle(accessor, privacyObject, parentItem)
{
  const [pmToggle, listElem] = await _createPmToggle(accessor);
  parentItem.appendChild(listElem);

  _updateSettingButton(pmToggle, (await privacyObject.get({})).value);
  pmToggle.addEventListener("change", async() =>
  {
    const details = await privacyObject.get({});
    if (details.levelOfControl == "controllable_by_this_extension" ||
    details.levelOfControl == "controlled_by_this_extension")
    {
      try
      {
        await privacyObject.set({ value: !details.value });
      }
      catch ({message})
      {
        if (message ==
          "Can't modify regular settings from an incognito context.")
        {
          alert(await getMessage("regularSettingChangeIncognito_error"));
        }
        else
        {
          alert(message);
        }
      }
    }
    else
    {
      //TODO: Inform user if control level is not controlable by
      //extension details.levelOfControl
    }
  }, false);

  privacyObject.onChange.addListener((detail) =>
  {
    _updateSettingButton(accessor, detail.value);
  });

  return listElem;
}

async function addStorageToggle(accessor, parentItem, callback)
{
  const [pmToggle, listElem] = await _createPmToggle(accessor);
  parentItem.appendChild(listElem);

  const state = await getSettingListData(accessor);
  _updateSettingButton(pmToggle, state === true);
  pmToggle.addEventListener("change", async() =>
  {
    const currentState = await getSettingListData(accessor);
    await setSettingListData(accessor, !currentState);
  }, false);

  if (callback)
  {
    new Listener().on(accessor, (active)=>
    {
      callback(active);
    });
  }
}

async function addPermissionToggle(accessor, parentItem)
{
  const [pmToggle, listElem] = await _createPmToggle(accessor);
  parentItem.appendChild(listElem);

  const isGranted = await browser.permissions.contains(additionalPermission);
  _updateSettingButton(accessor, isGranted);

  pmToggle.addEventListener("click", async() =>
  {
    if (await browser.permissions.contains(additionalPermission))
      browser.permissions.remove(additionalPermission);
    else
      browser.permissions.request(additionalPermission);
  }, false);

  browser.permissions.onAdded.addListener(() =>
  {
    _updateSettingButton(accessor, true); // Currently called multiple times
  });
  browser.permissions.onRemoved.addListener(() =>
  {
    _updateSettingButton(accessor, false);
  });
}

async function setSettingListData(name, value)
{
  const data = await browser.storage.local.get("settingList");
  if (!data.settingList)
    data.settingList = {};
  data.settingList[name] = value;
  await browser.storage.local.set(data);
}

async function getSettingListData(name)
{
  const data = await browser.storage.local.get("settingList");
  const settingList = data["settingList"];
  if (!settingList)
    return;
  return settingList[name];
}

async function resetSettingListData(settingNames)
{
  if (!Array.isArray(settingNames))
  {
    await setSettingListData(settingNames, false);
    return;
  }
  settingNames.forEach(async(settingName) =>
  {
    await setSettingListData(settingName, false);
  });
}

function _updateSettingButton(setting, state)
{
  if (typeof setting == "string")
  {
    $$("[data-access='" + setting + "']").forEach((settingItem) =>
    {
      _updateSettingButton(settingItem, state);
    });
  }
  else
  {
    setting.setEnabled(state);
  }
}

browser.storage.onChanged.addListener((data) =>
{
  if ("settingList" in data)
  {
    const {newValue} = data.settingList;
    for (const accessor in newValue)
      _updateSettingButton(accessor, newValue[accessor]);
  }
});

/**
 * Change listener for settingList in the local storage
 */
class Listener
{
  constructor()
  {
    this.settingList = {};
    browser.storage.onChanged.addListener(this._onChage.bind(this));
  }

  /**
   * Set a listener
   * @param {String} settingName setting name (ex.: cookies)
   * @param {Function} callback function to call on a setting value change
   */
  async on(settingName, callback)
  {
    if (!this.settingList[settingName])
      this.settingList[settingName] = {};
    this.settingList[settingName].value = await getSettingListData(settingName);
    this.settingList[settingName].callback = callback;
  }

  _onChage({settingList})
  {
    if (!settingList)
      return;

    const {newValue} = settingList;
    for (const settingName in this.settingList)
    {
      if (newValue[settingName] !== this.settingList[settingName].value)
      {
        this.settingList[settingName].value = newValue[settingName];
        this.settingList[settingName].callback(newValue[settingName]);
      }
    }
  }
}

module.exports = {addPrivacyToggle, addStorageToggle,
  addPermissionToggle, getSettingListData, resetSettingListData,
  Listener};


/***/ }),

/***/ 91:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */


const browser = __webpack_require__(150);

function $(selector, parent)
{
  return (parent || document).querySelector(selector);
}

function $$(selector, parent)
{
  return (parent || document).querySelectorAll(selector);
}

async function getMessage(text)
{
  return (await browser.i18n.getMessage(text)) || text;
}

module.exports = {$, $$, getMessage};


/***/ }),

/***/ 817:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */



const {$, getMessage} = __webpack_require__(91);
const {registerActionListener} = __webpack_require__(382);
const {deleteCookies, additionalPermission} = __webpack_require__(351);
const permittedUrls = additionalPermission.origins[0];
const {addStorageToggle, addPermissionToggle,
      getSettingListData} = __webpack_require__(858);
const browser = __webpack_require__(150);

let cookieWhitelistTitle = "";
let domainWhitelistTitle = "";
getMessage("whitelistSublistCookie").then(msg => cookieWhitelistTitle = msg);
getMessage("whitelistCookieDomain").then(msg => domainWhitelistTitle = msg);

const activeTabCookieId = "activeTabCookies";

let pmTable = null;
let cookieDialog = null;
let removeCookieDialog = null;
document.addEventListener("DOMContentLoaded" , async() =>
{
  $("#search-domain").addEventListener("search", populateDomainList, false);
  $("#search-domain").addEventListener("keyup", function(ev)
  {
    if (ev.key != "Enter" && ev.key != "Escape")
      populateDomainList();
  }, false);
  pmTable = document.querySelector("pm-table");
  pmTable.setListener(onCookiesAction);

  const cookiesTab = $("#panel-cookies");
  const leftSettingList = $("ul.settings-list:nth-of-type(1)", cookiesTab);
  const rightSettingList = $("ul.settings-list:nth-of-type(2)", cookiesTab);

  addPermissionToggle("additionalPermissions", leftSettingList);
  permissionChange(await browser.permissions.contains(additionalPermission));

  browser.permissions.onAdded.addListener(({origins}) =>
  {
    if (origins.includes(permittedUrls))
      permissionChange(true);
  });

  browser.permissions.onRemoved.addListener(({origins}) =>
  {
    if (origins.includes(permittedUrls))
      permissionChange(false);
  });

  addStorageToggle(activeTabCookieId, rightSettingList, (active) =>
  {
    if (active)
      updateFilterToActiveDomain();
  });

  cookieDialog = document.querySelector("pm-dialog.cookies");
  removeCookieDialog = document.querySelector("pm-dialog.delete-cookies");

  registerActionListener($("#cookiesContainer"), onCookiesAction);
  registerActionListener(cookieDialog, onCookiesAction);
  registerActionListener(removeCookieDialog, onCookiesAction);
}, false);

async function permissionChange(granted)
{
  disableControls(!granted);
  if (granted)
  {
    const state = await getSettingListData(activeTabCookieId);
    if (state)
      updateFilterToActiveDomain();
    else
      populateDomainList();
  }
}

async function getCookiesCountForDomain()
{
  const cookies = await browser.cookies.getAll({});
  return cookies.reduce((acc, {domain}) =>
  {
    const genericDomain =  removeStartDot(domain);
    if (acc[genericDomain])
      acc[genericDomain] = ++acc[genericDomain];
    else
      acc[genericDomain] = 1;
    return acc;
  }, {});
}

async function populateDomainList()
{
  pmTable.empty();
  const searchExpression = new RegExp($("#search-domain").value);
  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  const isWhitelisted = (domain) =>
  {
    return cookieWhitelist[domain] && cookieWhitelist[domain].domainWhitelist;
  };
  const domainObjs = [];
  const domainCounts =  await getCookiesCountForDomain();
  for (const domain in domainCounts)
  {
    if (!searchExpression.test(domain))
      continue;

    const count = domainCounts[domain];
    domainObjs.push(createDomainObj(domain, count, isWhitelisted(domain)));
  }
  document.querySelector("pm-table").addItems(domainObjs);
}

function setCookiesNum(cookienum)
{
  return cookienum + " Cookies";
}

/**
 * Create a Table List Item Structure Object
 * @param {String} domain Domain name
 * @param {Number} cookienum Number of domain cookies
 * @param {Boolean} whitelist specifies whether domain is whitelisted
 */
function createDomainObj(domain, cookienum, whitelist)
{
  return {
    id: domain,
    texts: {
      domain: domain,
      cookienum: setCookiesNum(cookienum)
    },
    titles: {
      whitelist: domainWhitelistTitle
    },
    dataset: {whitelist}
  };
}

async function isCookieWhitelisted(domain, cookie)
{
  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  return cookieWhitelist[domain] && cookieWhitelist[domain].cookies &&
          cookieWhitelist[domain].cookies.includes(cookie);
}

async function isDomainWhitelisted(domain)
{
  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  return cookieWhitelist && cookieWhitelist[domain] && cookieWhitelist[domain].domainWhitelist;
}

async function setWhitelistDomain(domain, value)
{
  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  if (!(domain in cookieWhitelist))
    cookieWhitelist[domain] = {domainWhitelist: value, cookies: []};
  else
    cookieWhitelist[domain].domainWhitelist = value;
  await browser.storage.local.set({cookieWhitelist});
}

async function toggleWhitelistCookie(domain, cookie)
{
  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  if (!(domain in cookieWhitelist))
    cookieWhitelist[domain] = {domainWhitelist: false, cookies: [cookie]};
  else if (cookieWhitelist[domain].cookies.includes(cookie))
    cookieWhitelist[domain].cookies = cookieWhitelist[domain].cookies.filter(el => el !== cookie);
  else
    cookieWhitelist[domain].cookies.push(cookie);
  await browser.storage.local.set({cookieWhitelist});
}

async function removeWhitelistCookie(domain, cookie)
{
  if (!await isCookieWhitelisted(domain, cookie))
    return;

  const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
  cookieWhitelist[domain].cookies = cookieWhitelist[domain].cookies.filter(el => el !== cookie);
  await browser.storage.local.set({cookieWhitelist});
}

async function onCookiesAction(action, item, parentItem)
{
  pmTable = document.querySelector("pm-table");
  switch (action)
  {
    case "get-cookies":
    {
      const subitems = item.subItems;
      if (subitems)
      {
        onCookiesAction("close-expanded-domain", null, item);
        return;
      }
      const domain = item.id;
      const cookies = await browser.cookies.getAll({domain});

      for (const cookie of cookies)
      {
        // Filter subdomains matched cookies
        if (cookie.domain.indexOf(domain) > 1)
          continue;

        const isWhitelisted = await isCookieWhitelisted(domain, cookie.name);
        pmTable.addItems([createCookieSubitemObj(cookie, isWhitelisted)], domain);
      }
      const subitemId = pmTable.getItem(domain).subItems[0].id;
      pmTable.selectItem(subitemId, domain);
      break;
    }
    case "close-expanded-domain":
    {
      pmTable.empty(parentItem.id);
      break;
    }
    case "whitelist-domain":
    {
      const domain = item.texts.domain;
      const currentValue = await isDomainWhitelisted(domain);
      await setWhitelistDomain(domain, !currentValue);
      break;
    }
    case "whitelist-cookie":
    {
      const cookie = item.texts.name;
      const domain = parentItem.texts.domain;
      await toggleWhitelistCookie(domain, cookie);
      break;
    }
    case "delete-domain":
    {
      const domain = item.texts.domain;
      const cookies = await browser.cookies.getAll({domain});
      for (const cookie of cookies)
      {
        const url = getUrl(cookie.domain, cookie.path, cookie.secure);
        browser.cookies.remove({"url": url, "name": cookie.name});
      }
      break;
    }
    case "delete-cookie":
    {
      const domain = parentItem.texts.domain;
      const cookies = await browser.cookies.getAll({domain});
      for (const cookie of cookies)
      {
        // Filter subdomains matched cookies
        if (cookie.domain.indexOf(domain) > 1)
          continue;

        if (item.texts.name === cookie.name)
        {
          const url = getUrl(domain, cookie.path, cookie.secure);
          browser.cookies.remove({url, "name": cookie.name});
        }
      }
      break;
    }
    case "edit-cookie": {
      const cookieName = item.texts.name;
      const url = getUrl(parentItem.texts.domain,
                         item.dataset.path,
                         item.dataset.secure);
      const {name, value, domain, path, hostOnly, httpOnly, secure,
              session, storeId,
              expirationDate} = await browser.cookies.get({url, name: cookieName});
      let date, time = "";
      if (expirationDate)
      {
        const dateTime = new Date(expirationDate * 1000);
        // <input type="date"> supports -> yyyy-mm-dd
        const convertMonth = (month) => month < 9 ? `0${month + 1}` : month + 1;
        const convertDate = (date) => date < 10 ? `0${date}` : date;
        const year = dateTime.getFullYear();
        const month = convertMonth(dateTime.getMonth());
        const day = convertDate(dateTime.getDate());
        date = `${year}-${month}-${day}`;
        // <input type="time"> supports -> hh:mm:ss
        const twoDigits = (value) => value < 10 ? `0${value}` : value;
        const hour = twoDigits(dateTime.getHours());
        const minute = twoDigits(dateTime.getMinutes());
        const second = twoDigits(dateTime.getSeconds());
        time = `${hour}:${minute}:${second}`;
      }
      const title = await getMessage("editCookie");
      const actionBtn = await getMessage("cookieDialog_update");
      const data = {
        name, value, path, hostOnly, httpOnly, session, storeId, secure,
        actionBtn,
        domain: removeStartDot(domain),
        expirationDate: date,
        expirationTime: time
      };
      resetDialog();
      getDialogField("name").setAttribute("disabled", "disabled");
      getDialogField("domain").setAttribute("disabled", "disabled");
      cookieDialog.classList.remove("add");
      cookieDialog.showDialog(title, data);
      break;
    }
    case "add-cookie": {
      resetDialog();
      const title = await getMessage("addCookie");
      getDialogField("name").removeAttribute("disabled");
      getDialogField("domain").removeAttribute("disabled");
      const actionBtn = await getMessage("cookieDialog_add");
      cookieDialog.classList.add("add");
      cookieDialog.showDialog(title, {actionBtn});
      break;
    }
    case "update-cookie": {
      if (!cookieDialog.querySelector("form").reportValidity())
        return;

      const time = getDialogField("expirationTime").value;
      const date = getDialogField("expirationDate").value;
      const dateTime = time ? `${date}T${time}` : date;

      const cookie = {
        "url": getUrl(getDialogField("domain").value,
                      getDialogField("path").value,
                      getDialogField("secure").checked),
        "path": getDialogField("path").value,
        "domain": getDialogField("domain").value,
        "name": getDialogField("name").value,
        "value": getDialogField("value").value,
        "secure": getDialogField("secure").checked,
        "httpOnly": getDialogField("httpOnly").checked,
        "storeId": getDialogField("storeId").value,
        "expirationDate": new Date(dateTime).getTime() / 1000
      };

      if (getDialogField("hostOnly").checked)
      {
        // Omitted domain makes host-only cookie
        delete cookie.domain;
      }
      if (getDialogField("session").checked)
      {
        // Omitted expirationDate makes session cookie
        delete cookie.expirationDate;
      }
      if (await browser.cookies.set(cookie))
      {
        cookieDialog.closeDialog();
      }
      break;
    }
    case "open-cookie-removal-dialog": {
      const title = await getMessage("deleteAll");
      removeCookieDialog.showDialog(title);
      break;
    }
    case "delete-all-cookies": {
      deleteCookies();
      removeCookieDialog.closeDialog();
      break;
    }
  }
}

function getDialogField(id)
{
  return cookieDialog.querySelector(`[data-id='${id}']`);
}

function resetDialog()
{
  cookieDialog.querySelector("form").reset();
}

/**
 * Filter cookies list according to the active tab URL
 */
async function updateFilterToActiveDomain()
{
  const tab = await browser.tabs.query({active: true});
  const url = tab[0].url;
  if (url.indexOf("://") > -1)
  {
    const domain = url.split('/')[2].split(':')[0].replace("www.", "");
    $("#search-domain").value = domain;
    populateDomainList();
  }
}

/**
 * Enable/disable control elements
 * @param {Boolean} disabled
 */
function disableControls(disabled)
{
  $("#cookie-controls").childNodes.forEach(function(Node)
  {
    if (Node.nodeType == 1)
      if (disabled)
        Node.setAttribute("disabled", disabled);
      else
        Node.removeAttribute("disabled");
  });
}

function removeStartDot(string)
{
  return string.replace(/^\./, "");
}

function getUrl(domain, path, isSecure)
{
  return "http" + (isSecure ? "s" : "") + "://" + domain + path;
}

function createCookieSubitemObj(cookie, whitelist)
{
  return {
    id: cookie.name,
    texts: {
      name: cookie.name,
      value: cookie.value
    },
    titles: {
        whitelist: cookieWhitelistTitle
    },
    dataset: {whitelist, path: cookie.path, secure: cookie.secure}
  };
}

browser.storage.onChanged.addListener(async({cookieWhitelist}) =>
{
  if (cookieWhitelist)
  {
    const {newValue, oldValue} = cookieWhitelist;

    for (const domain in newValue)
    {
      if (!oldValue[domain])
      {
        if (newValue[domain].domainWhitelist)
        {
          const item = pmTable.getItem(domain);
          if (item)
          {
            item.dataset.whitelist = true;
            pmTable.updateItem(item, domain);
          }
        }
        for (const cookie of newValue[domain].cookies)
        {
          const item = pmTable.getItem(cookie, domain);
          if (item)
          {
            item.dataset.whitelist = true;
            pmTable.updateItem(item, cookie, domain);
          }
        }
      }
      else
      {
        const oldDomainObj = oldValue[domain];
        const newDomainObj = newValue[domain];
        if (newDomainObj.domainWhitelist !== oldDomainObj.domainWhitelist)
        {
          const item = pmTable.getItem(domain);
          if (item)
          {
            item.dataset.whitelist = newDomainObj.domainWhitelist;
            pmTable.updateItem(item, domain);
          }
        }
        const oldCookies = oldDomainObj.cookies;
        const newCookies = newDomainObj.cookies;
        for (const cookie of newCookies)
        {
          if (!oldCookies.includes(cookie))
          {
            const item = pmTable.getItem(cookie, domain);
            if (item)
            {
              item.dataset.whitelist = true;
              pmTable.updateItem(item, cookie, domain);
            }
          }
          oldCookies.splice(oldCookies.indexOf(cookie), 1);
        }
        for (const cookie of oldCookies)
        {
          const item = pmTable.getItem(cookie, domain);
          if (item)
          {
            item.dataset.whitelist = false;
            pmTable.updateItem(item, cookie, domain);
          }
        }
      }
    }
  }
});

browser.cookies.onChanged.addListener(async({cookie, removed}) =>
{
  const domain = removeStartDot(cookie.domain);
  const domainCounts =  await getCookiesCountForDomain();

  if (removed)
  {
    if (!pmTable.getItem(domain))
      return;

    if (!domainCounts[domain])
    {
      pmTable.removeItem(domain);
      const {cookieWhitelist} = await browser.storage.local.get("cookieWhitelist");
      delete cookieWhitelist[domain];
      await browser.storage.local.set({cookieWhitelist});
    }
    else
    {
      pmTable.removeItem(cookie.name, domain);
      removeWhitelistCookie(domain, cookie.name);
      const domainItem = pmTable.getItem(domain);
      domainItem.texts.cookienum = setCookiesNum(domainCounts[domain]);
      pmTable.updateItem(domainItem, domain);
    }
  }
  else
  {
    const isWhitelisted = await isCookieWhitelisted(domain, cookie.name);
    const newItem = createCookieSubitemObj(cookie, isWhitelisted);
    const hasDomainItem = pmTable.getItem(domain);
    const isDomainExpanded = hasDomainItem && hasDomainItem.subItems;
    const hasCookieItem = pmTable.getItem(cookie.name, domain);

    if (hasCookieItem && hasDomainItem)
    {
      pmTable.updateItem(newItem, cookie.name, domain);
    }
    else if (!hasDomainItem)
    {
      const whitelisted = await isDomainWhitelisted(domain);
      const domainItem = createDomainObj(domain, domainCounts[domain],
                                         whitelisted);
      pmTable.addItems([domainItem]);
    }
    else if (isDomainExpanded)
    {
      const domainItem = pmTable.getItem(domain);
      domainItem.texts.cookienum = setCookiesNum(domainCounts[domain]);
      pmTable.updateItem(domainItem, domain);
      pmTable.addItems([newItem], domain);
    }
    else
    {
      const domainItem = pmTable.getItem(domain);
      domainItem.texts.cookienum = setCookiesNum(domainCounts[domain]);
      pmTable.updateItem(domainItem, domain);
    }
  }
});


/***/ }),

/***/ 880:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */



const {$} = __webpack_require__(91);
const {addStorageToggle, addPrivacyToggle} = __webpack_require__(858);
const {privacyData, browsingData} = __webpack_require__(199);
const {registerActionListener} = __webpack_require__(382);
const browser = __webpack_require__(150);

async function generateMainContent()
{
  for (const category in privacyData)
  {
    privacyData[category].forEach(async function(settingName)
    {
      if (!browser.privacy[category][settingName])
        return;

      addPrivacyToggle(settingName, browser.privacy[category][settingName],
                       $("#privacyManagement ul"));
    });
  }

  for (const dataName of browsingData)
    addStorageToggle(dataName, $("#startupClear ul"));
}

async function onAction(action)
{
  switch (action)
  {
    case "open-in-incognito": {
      const tab = await browser.tabs.query({active:true});
      if (tab[0].url.toString().indexOf("chrome://") == -1)
        browser.windows.create({url: tab[0].url, incognito: true});
      else
        alert("Sorry you can't run current active page in incognito mode.");
      break;
    }
  }
}

document.addEventListener("DOMContentLoaded" , function()
{
  registerActionListener($("#panel-main"), onAction);
  generateMainContent();
}, false);


/***/ }),

/***/ 275:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */



const {$, getMessage} = __webpack_require__(91);
const {registerActionListener} = __webpack_require__(382);
const {additionalPermission, addRequestListener, removeRequestListener,
       updateRequestObj, addBlockAgentListener, removeBlockAgentListener} = __webpack_require__(351);
const {addStorageToggle, addPermissionToggle, getSettingListData, resetSettingListData} = __webpack_require__(858);
const browser = __webpack_require__(150);

const blockUserAgentId = "blockUserAgent";
const collectHeadersId = "collectHeaders";
const permissionNotificationMsgId = "additionalPermissions_notification";
const filterParams = ["statusLine", "statusCode", "type", "url", "method"];

let tableList = null;

document.addEventListener("DOMContentLoaded" , async function()
{
  const networkTab = $("#panel-network");
  const leftSettingList = $("ul.settings-list:nth-of-type(1)", networkTab);
  const rightSettingList = $("ul.settings-list:nth-of-type(2)", networkTab);

  addPermissionToggle("additionalPermissions", leftSettingList);

  addStorageToggle(blockUserAgentId, leftSettingList, (enabled) =>
  {
    onNetworkSettingChange(blockUserAgentId, enabled, true);
  });
  onNetworkSettingChange(blockUserAgentId,
                         await getSettingListData(blockUserAgentId));

  addStorageToggle(collectHeadersId,rightSettingList, (enabled) =>
  {
    onNetworkSettingChange(collectHeadersId, enabled);
  });
  onNetworkSettingChange(collectHeadersId,
                         await getSettingListData(collectHeadersId), true);

  tableList = document.querySelector("#panel-network pm-table");

  registerActionListener($("#requestsWidget"), onRequestsWidgetAction);
  tableList.setListener(onRequestsWidgetActionComp);
  browser.runtime.sendMessage({message: "getCollectedRequests"}).then((requests) =>
  {
    tableList.addItems(requests);
  });
},false);

async function onNetworkSettingChange(settingName, isActive, permissionChange)
{
  switch(settingName)
  {
    case "blockUserAgent":
      if (isActive)
      {
        const result = await browser.permissions.contains(additionalPermission);
        if (result)
        {
          addBlockAgentListener();
        }
        else
        {
          if (!permissionChange)
            alert(await getMessage(permissionNotificationMsgId));
          await resetSettingListData(settingName);
        }
      }
      else
      {
        removeBlockAgentListener();
      }
      break;
    case "collectHeaders":
      if (isActive)
      {
        const result = await browser.permissions.contains(additionalPermission);
        if (result)
        {
          addRequestListener(onSendHeaders, onHeadersReceived);
        }
        else
        {
          if (!permissionChange)
            alert(await getMessage(permissionNotificationMsgId));
          await resetSettingListData(settingName);
        }
      }
      else
      {
        removeRequestListener(onSendHeaders, onHeadersReceived);
      }
      break;
  }
}

browser.permissions.onRemoved.addListener(async(result) =>
{
  await resetSettingListData([blockUserAgentId, collectHeadersId]);
  removeBlockAgentListener();
  removeRequestListener(onSendHeaders, onHeadersReceived);
});


function onSendHeaders(details)
{
  const itemObj = updateRequestObj(details, "send");
  tableList.addItems([itemObj]);
}


function onHeadersReceived(details)
{
  const itemObj = updateRequestObj(details, "receive");
  tableList.addItems([itemObj]);
}

function onRequestsWidgetActionComp(action, item, parentItem)
{
  switch (action)
  {
    case "get-request":
    {
      if (item.subItems)
      {
        onRequestsWidgetActionComp("close-expanded-request", null, item);
        return;
      }

      const {request} = item;
      for (const param in request)
      {
        const headers = request[param];
        if (param == "requestHeaders" || param == "responseHeaders")
        {
          for (const {name, value} of headers)
          {
            const id = name;
            tableList.addItems([{id, texts: {name, value}}], item.id);
          }
        }
        else if (filterParams.indexOf(param) >= 0)
        {
          const name = param;
          const value = headers;
          tableList.addItems([{id: name, texts: {name, value}}], item.id);
        }
      }
      break;
    }
    case "close-expanded-request":
      tableList.empty(parentItem.id);
      break;
  }
}

async function onRequestsWidgetAction(action, element)
{
  switch (action)
  {
    case "delete-all": {
      await browser.runtime.sendMessage({message: "deleteCollectedNetworkRequests"});
      tableList.empty();
      break;
    }
    case "download-all": {
      const downloadJson = [];
      for (const {request, data} of tableList.items)
      {
        const requestObj = {};
        requestObj["action"] = data.type;
        for (const param in request)
        {
          if (param == "requestHeaders" || param == "responseHeaders")
          {
            requestObj["headers"] = {};
            for (const {name, value} of request[param])
            {
              requestObj["headers"][name] = value;
            }
          }
          else if (filterParams.indexOf(param) >= 0)
          {
            requestObj[param] = request[param];
          }
        }
        downloadJson.push(requestObj);
      }

      //Download requests
      const anchorElem = document.createElement("a");
      anchorElem.setAttribute("href", "data:text/plain;charset=utf-8," +
        encodeURIComponent(JSON.stringify(downloadJson, null, 2)));

      anchorElem.setAttribute("download", "requests.json");
      anchorElem.style.display = 'none';
      document.body.appendChild(anchorElem);
      anchorElem.click();
      document.body.removeChild(anchorElem);
      break;
    }
  }
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be in strict mode.
(() => {
"use strict";
/*
 * This file is part of Privacy Manager.
 * Copyright (C) 2017-present Manvel Saroyan
 * 
 * Privacy Manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Privacy Manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Privacy Manager. If not, see <http://www.gnu.org/licenses/>.
 */



__webpack_require__(817);
__webpack_require__(880);
__webpack_require__(275);

const browser = __webpack_require__(150);
window.browser = browser;

const {getMessage} = __webpack_require__(91);


/*******************************************************************************
 * i18n
 ******************************************************************************/
document.addEventListener("DOMContentLoaded", async function()
{
  document.querySelectorAll("[data-i18n]").forEach(async function(node)
  {
    node.textContent = await getMessage(node.dataset.i18n);
  });

  document.documentElement.lang = await getMessage("@@ui_locale");
}, false);

/*******************************************************************************
 * Init Tabs
 ******************************************************************************/
document.addEventListener("DOMContentLoaded", async() =>
{
  const pmTabPanel = document.querySelector("pm-tab-panel");
  const {lastSelectedTab} = await browser.storage.local.get("lastSelectedTab");
  if (!lastSelectedTab)
    pmTabPanel.select("tab-main");
  else
    pmTabPanel.select(lastSelectedTab);
  pmTabPanel.addEventListener("tabChange", ({detail}) =>
  {
    browser.storage.local.set({"lastSelectedTab": detail});
  });
}, false);

})();

/******/ })()
;