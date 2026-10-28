(() => {
    const e = "custom_options_list",
        t = "spoofer_list",
        n = "use_per_tab",
        a = "permanent_override",
        r = "no_spoof";

    function i(e, t) {
        return typeof e == typeof t && (null === e || null === t ? e === t : e instanceof Array ? t instanceof Array && e.length === t.length && e.every(((e, n) => i(e, t[n]))) : "object" == typeof e ? i(Object.keys(e).toSorted(), Object.keys(t).toSorted()) && Object.entries(e).every((([e, n]) => i(n, t[e]))) : e === t)
    }
    class o {
        constructor(e, t, n, a, r, i) {
            this.title = e, this.ua_string = t, this.vendor = n, this.badge = a, this.is_preset = r, this.append_to_default_ua = !1, this.group = i, this.is_managed = !1, this.key = ""
        }
    }
    class s {
        constructor(e, t) {
            this.domain = e, this.user_agent = t, this.is_managed = !1, this.key = ""
        }
    }

    function c() {
        return chrome.storage.local
    }
    async function l() {
        const e = await chrome.storage.local.get("OtherSettings").then((e => e?.OtherSettings?.spoof_per_tab ?? null));
        return null != e ? e : (await chrome.storage.local.get(n))[n]
    }
    async function u() {
        const e = await chrome.storage.local.get("OtherSettings").then((e => e?.OtherSettings?.spoof_override ?? null));
        return null != e ? e : !!(await c().get(a))[a]
    }
    async function d() {
        return c().get(e).then((({
            [e]: t
        }) => t || []))
    }
    async function h() {
        const [e, t] = await Promise.all([p(), d()]);
        if (!t || 0 === t.length) return e;
        const n = await c().get(t);
        return e.concat(Object.values(n))
    }

    function g({
        title: e,
        ua_string: t,
        vendor: n,
        badge: a,
        append: r
    }, i) {
        return Object.assign(new o, {
            is_managed: !0,
            title: e,
            ua_string: t,
            vendor: n,
            badge: a,
            append_to_default_ua: r,
            group: "Managed",
            key: void 0 !== i ? "cm_" + i : void 0
        })
    }
    async function p() {
        return ((await chrome.storage.local.get("UserAgents"))?.UserAgents || []).map(((e, t) => g(e, t)))
    }
    async function f(t) {
        if (!t || 0 === t.length) return;
        if (await chrome.storage.local.get("EditRights").then((e => e?.EditRights?.user_agents ?? null))) return;
        const n = await d();
        let a = 0;
        if (n && n.length > 0)
            for (let e = 0; e < n.length; e++) {
                const t = parseInt(n[e].substring("c_".length));
                t >= a && (a = t)
            }
        for (let e = 0; e < t.length; e++) t[e].key = "c_" + (a + 1 + e);
        await c().set({
            ...Object.fromEntries(t.map((e => [e.key, e]))),
            [e]: n.concat(t.map((e => e.key)))
        })
    }
    async function m() {
        return c().get(t).then((({
            [t]: e
        }) => e || []))
    }
    async function w() {
        const e = await async function() {
            return ((await chrome.storage.local.get("PermanentSpoofs"))?.PermanentSpoofs || []).map((({
                domain: e,
                user_agent: t
            }, n) => Object.assign(new s, {
                domain: e,
                is_managed: !0,
                key: "sm_" + n,
                user_agent: g(t, void 0)
            })))
        }(), t = await m();
        if (!t || 0 === t.length) return e;
        const n = await c().get(t);
        return e.concat(Object.values(n))
    }
    async function _() {
        return (await chrome.storage.session.get("hotlist"))?.hotlist || {}
    }
    const y = chrome.declarativeNetRequest.MAX_NUMBER_OF_SESSION_RULES,
        M = new RegExp("^(https?://)?((([a-zd]([a-zd-]*[a-zd])*).)+[a-z]{2,}|((d{1,3}.){3}d{1,3}))(:d+)?(/[-a-zd%_.~+]*)*$", "i");

    function b(e) {
        return M.test(e)
    }

    function S(e, t) {
        if (e = e.toLowerCase(), t = t.toLowerCase(), b(e)) {
            if (/^https?:/.test(e)) return t === e;
            let n = t.replace(/^\w+:\/\//, "");
            for (; !/^[:\/]/.test(n);) {
                if (n = n.replace(/^\./, ""), n.startsWith(e)) return !0;
                n = n.replace(/^\w+/, "")
            }
            return !1
        }
        return new RegExp(e).test(t)
    }
    async function I(e) {
        for (const t of await w())
            if (S(t.domain, e.href)) return t.user_agent?.badge || "";
        return ""
    }
    async function O(e) {
        const t = await async function(e) {
            return e ? (await l() || (e = r), (await _())[e] || null) : null
        }(e);
        if (t) {
            return (await (n = t, c().get(n).then((({
                [n]: e
            }) => e))))?.badge || ""
        }
        var n;
        return ""
    }
    async function v(e) {
        if (!e || !e.id) return "";
        const {
            id: t
        } = e;
        const raw = e.url || e.pendingUrl || "";
        if (!raw || !/^https?:/i.test(raw)) return "";
        let n;
        try {
            n = new URL(raw);
        } catch (err) {
            return "";
        }
        return n.hash = "", n.username = "", n.password = "", /https?:/.test(n) ? await u() ? await I(n) || await O(t) : await O(t) || await I(n) : ""
    }
    async function E(e) {
        e && e.id && await chrome.action.setBadgeText({
            tabId: e.id,
            text: await v(e)
        })
    }
    let A = !1;
    chrome.storage.onChanged.addListener((function(e, t) {
        for (let [t, n] of Object.entries(e));
        A && z()
    })), chrome.runtime.onMessage.addListener(((e, t, n) => {
        if ("service_worker" === e.target) return "setCurrent" === e.action ? (async function(e) {
            const [t] = await chrome.tabs.query({
                currentWindow: !0,
                active: !0
            });
            t && (await async function(e, t) {
                if (!e || !e.id) return;
                if (0 == await chrome.storage.local.get("OtherSettings").then((e => e?.OtherSettings?.hotlist_enabled ?? null))) return;
                const n = await l() ? e.id : r,
                    a = await _();
                await chrome.storage.session.set({
                    hotlist: {
                        ...a,
                        [n]: t
                    }
                })
            }(t, e), await z(), E(t), chrome.tabs.reload(t.id, {
                bypassCache: !0
            }, (() => {})), chrome.tabs.update(t.id, {
                selected: !0
            }))
        }(e.ua_index).then(n), !0) : void 0
    }));
    const W = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"];

    function k(e, t, n, a, r, i) {
        return {
            id: e,
            priority: i,
            condition: {
                ...(o = t, o ? b(o) ? /^https?:/.test(o) ? {
                    urlFilter: `|${o}|`,
                    isUrlFilterCaseSensitive: !1
                } : {
                    urlFilter: `||${o}`,
                    isUrlFilterCaseSensitive: !1
                } : {
                    regexFilter: o,
                    isUrlFilterCaseSensitive: !1
                } : {}),
                tabIds: n ? [+n] : void 0,
                resourceTypes: W
            },
            action: {
                type: "modifyHeaders",
                requestHeaders: [{
                    header: "User-Agent",
                    operation: r ? "append" : "set",
                    value: r ? ` ${a}` : a
                }]
            }
        };
        var o
    }

    function x(e, t, n, a) {
        const i = e.map((({
                domain: e,
                key: t,
                user_agent: {
                    ua_string: n,
                    append_to_default_ua: a
                }
            }) => {
                return {
                    id: (r = t, +r.replace(/^sm?_/, "") + (/^s_/.test(r) ? 0 : y)),
                    domain: e,
                    ua_string: n,
                    append: a,
                    priority: 100
                };
                var r
            })),
            o = Math.max(0, ...i.map((e => e.id))),
            s = Object.entries(n).flatMap((([e, n]) => {
                const i = a.find((e => e.key === n));
                return i ? [{
                    id: e === r ? o + 1 : +e,
                    ua_string: i.ua_string,
                    tab_id: e === r ? void 0 : e,
                    priority: t ? 90 : 110
                }] : []
            }));
        return i.concat(s).flatMap((({
            id: e,
            domain: t,
            tab_id: n,
            ua_string: a,
            append: r,
            priority: i
        }) => a ? [k(e, t, n, a, r, i)] : []))
    }
    let T = !1,
        L = null;

    function z() {
        return L ? (T = !0, L) : (L = (async () => {
            do {
                T = !1;
                const [e, t, n, a, r] = await Promise.all([w(), chrome.declarativeNetRequest.getSessionRules(), u(), _(), h()]), o = x(e, n, a, r);
                i(t, o) || await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: t.map((e => e.id)),
                    addRules: o
                })
            } while (T);
            L = null
        })(), L)
    }
    chrome.tabs.onActivated.addListener((function(e) {
        chrome.tabs.get(e.tabId, (function(e) {
            E(e)
        }))
    })), chrome.tabs.onUpdated.addListener((function(e, t, n) {
        E(n)
    }));
    const C = async function() {
        await async function() {
            const {
                local_storage_migrated: e
            } = await chrome.storage.local.get("local_storage_migrated");
            if (e) return;
            await chrome.offscreen.createDocument({
                url: "screenHelper.html",
                reasons: ["LOCAL_STORAGE"],
                justification: "migrating localStorage config to chrome.storage.local"
            });
            const t = await chrome.runtime.sendMessage({
                action: "getLocalStorageValues",
                target: "offscreen_document"
            });
            await chrome.storage.local.set({
                ...t,
                local_storage_migrated: chrome.runtime.getManifest().version
            }), await chrome.offscreen.closeDocument()
        }(), await new Promise((e => {
            chrome.storage.local.get("use_sync", (({
                use_sync: t
            }) => {
                t ? chrome.storage.local.get((t => {
                    chrome.storage.local.set({
                        ...t,
                        use_sync: !1
                    }, (() => {
                        e()
                    }))
                })) : e()
            }))
        }))
    }().then(z).then((() => {
        A = !0
    }));
    chrome.runtime.onInstalled.addListener((async function(t) {
        await C;
        const n = await d();
        n && 0 != n.length || await async function(t) {
            const n = new Array;
            n.push(new o("Default", "", "", "", !0, "Chrome")), n.push(new o("Windows Firefox 33", "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:33.0) Gecko/20120101 Firefox/33.0", "Mozilla, Inc.", "FFW", !0, "Firefox")), n.push(new o("Mac Firefox 33", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10; rv:33.0) Gecko/20100101 Firefox/33.0", "Mozilla, Inc.", "FFM", !0, "Firefox")), n.push(new o("Opera 12.14", "Opera/9.80 (Windows NT 6.0) Presto/2.12.388 Version/12.14", "Mozilla, Inc.", "O12", !0, "Opera")), n.push(new o("Mac Safari 7", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_3) AppleWebKit/537.75.14 (KHTML, like Gecko) Version/7.0.3 Safari/7046A194A", "Apple, Inc.", "S7", !0, "Safari")), n.push(new o("Internet Explorer 6", "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.0; WOW64; Trident/4.0; SLCC1)", "Microsoft", "IE6", !0, "Internet Explorer")), n.push(new o("Internet Explorer 7", "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0; WOW64; Trident/4.0; SLCC1)", "Microsoft", "IE7", !0, "Internet Explorer")), n.push(new o("Internet Explorer 8", "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.0; WOW64; Trident/4.0; SLCC1)", "Microsoft", "IE8", !0, "Internet Explorer")), n.push(new o("Internet Explorer 9", "Mozilla/5.0 (MSIE 9.0; Windows NT 6.1; Trident/5.0)", "Microsoft", "IE9", !0, "Internet Explorer")), n.push(new o("Internet Explorer 10", "Mozilla/5.0 (MSIE 10.0; Windows NT 6.1; Trident/5.0)", "Microsoft", "IE10", !0, "Internet Explorer")), n.push(new o("iPhone 6", "Mozilla/5.0 (iPhone; CPU iPhone OS 6_0 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10A5376e Safari/8536.25", "Apple, Inc.", "IP6", !0, "iOS")), n.push(new o("iPad", "Mozilla/5.0 (iPad; CPU OS 6_0 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10A5376e Safari/8536.25", "Apple, Inc.", "iPad", !0, "iOS")), n.push(new o("Android KitKat", "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.114 Mobile Safari/537.36", "", "AND", !0, "Android")), n.push(new o("Windows Phone 8", "Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 920)", "", "WP7", !0, "Windows Phone"));
            {
                const t = await h(),
                    a = [];
                for (let e = 0; e < t.length; e++) a.push(t[e].key);
                a && a.length > 0 && await c().remove([...a, e]), await f(n)
            }
            return n
        }()
    }))
})();