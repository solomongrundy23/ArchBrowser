'use strict';

// Скрываем следы автоматизации и добавляем «шум» к популярным способам
// фингерпринтинга. Скрипт выполняется в MAIN-мире страницы до её скриптов.
const { webFrame, ipcRenderer, contextBridge } = require('electron');

const fpEnabled = process.argv.includes('--arch-fp=1');

const STEALTH = String.raw`
(() => {
  if (window.__archStealth) return;
  try { Object.defineProperty(window, '__archStealth', { value: true }); } catch (e) {}
  const define = (obj, prop, getter) => {
    try { Object.defineProperty(obj, prop, { get: getter, configurable: true, enumerable: true }); } catch (e) {}
  };

  // --- Автоматизация ---
  define(Navigator.prototype, 'webdriver', () => false);
  define(Navigator.prototype, 'doNotTrack', () => '1');
  try { delete Navigator.prototype.webdriver; } catch (e) {}

  // --- Железо (усреднённые значения, чтобы не выделяться) ---
  define(Navigator.prototype, 'hardwareConcurrency', () => 8);
  define(Navigator.prototype, 'deviceMemory', () => 8);
  define(Navigator.prototype, 'maxTouchPoints', () => 0);

  // --- Батарея ---
  try {
    if (navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
        addEventListener() {}, removeEventListener() {},
        onchargingchange: null, onchargingtimechange: null,
        ondischargingtimechange: null, onlevelchange: null,
      });
    }
  } catch (e) {}

  // --- Canvas: невидимый шум ±1 в младших битах ---
  const seed = 0x9e3779b9 ^ (Date.now() & 0xffffffff);
  const perturb = (data) => {
    for (let i = 0; i < data.length; i += 4) {
      const n = ((seed + i * 2654435761) >>> 0) % 3;
      const d = n - 1;
      data[i] = (data[i] + d) & 255;
      data[i + 1] = (data[i + 1] + d) & 255;
      data[i + 2] = (data[i + 2] + d) & 255;
    }
  };

  try {
    const C2D = CanvasRenderingContext2D.prototype;
    const origGet = C2D.getImageData;
    C2D.getImageData = function (...args) {
      const result = origGet.apply(this, args);
      try {
        if (result.width >= 16 && result.height >= 16 && result.width * result.height <= 4194304) {
          perturb(result.data);
        }
      } catch (e) {}
      return result;
    };
  } catch (e) {}

  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      try {
        const w = this.width, h = this.height;
        if (w >= 16 && h >= 16 && w * h <= 4194304) {
          const ctx = this.getContext('2d');
          if (ctx) {
            const img = CanvasRenderingContext2D.prototype.getImageData.call(ctx, 0, 0, w, h);
            perturb(img.data);
            ctx.putImageData(img, 0, 0);
          }
        }
      } catch (e) {}
      return origToDataURL.apply(this, args);
    };
  } catch (e) {}

  try {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
      try {
        const w = this.width, h = this.height;
        if (w >= 16 && h >= 16 && w * h <= 4194304) {
          const ctx = this.getContext('2d');
          if (ctx) {
            const img = CanvasRenderingContext2D.prototype.getImageData.call(ctx, 0, 0, w, h);
            perturb(img.data);
            ctx.putImageData(img, 0, 0);
          }
        }
      } catch (e) {}
      return origToBlob.call(this, cb, ...rest);
    };
  } catch (e) {}

  // --- WebGL: подменяем вендора/рендерер ---
  try {
    const patchGL = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = function (param) {
        if (param === 37445) return 'Google Inc. (Intel)';
        if (param === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return orig.call(this, param);
      };
    };
    if (window.WebGLRenderingContext) patchGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // --- Аудио ---
  try {
    if (window.AnalyserNode) {
      const origFloat = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function (arr) {
        origFloat.call(this, arr);
        for (let i = 0; i < arr.length; i++) arr[i] += (Math.random() - 0.5) * 1e-6;
      };
    }
  } catch (e) {}

  // --- Прочее ---
})();
`;

if (fpEnabled) {
  try {
    webFrame.executeJavaScript(STEALTH).catch(() => {});
  } catch {}
}

// --------------------------------------------------------------- Client Hints
// Electron не отдаёт navigator.userAgentData (в Chrome он есть всегда), а
// заголовок Sec-CH-UA не содержит бренда «Google Chrome». Для антибот-защиты
// (Cloudflare Turnstile, DDoS-Guard) это верный признак бота: сайт бесконечно
// крутит проверку. Приводим подсказки клиента к обычному Chrome.
const CHROME_FULL = String(process.versions.chrome || '152.0.0.0');
const CHROME_MAJOR = CHROME_FULL.split('.')[0];

const CLIENT_HINTS = String.raw`
(() => {
  if (window.__archCH) return;
  try { Object.defineProperty(window, '__archCH', { value: true }); } catch (e) {}
  const full = '__FULL__';
  const major = '__MAJOR__';
  const brands = [
    { brand: 'Not)A;Brand', version: '24' },
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
  ];
  const fullList = [
    { brand: 'Not)A;Brand', version: '24.0.0.0' },
    { brand: 'Chromium', version: full },
    { brand: 'Google Chrome', version: full },
  ];
  const uaData = {
    brands,
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues(hints) {
      const all = {
        architecture: 'x86',
        bitness: '64',
        brands,
        formFactors: ['Desktop'],
        fullVersionList: fullList,
        mobile: false,
        model: '',
        platform: 'Windows',
        platformVersion: '15.0.0',
        uaFullVersion: full,
        wow64: false,
      };
      const out = {};
      const want = Array.isArray(hints) ? hints : [];
      for (const key of want) if (key in all) out[key] = all[key];
      if (!want.length) return Promise.resolve(all);
      return Promise.resolve(out);
    },
    toJSON() {
      return { brands, mobile: false, platform: 'Windows' };
    },
  };
  try {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => uaData,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // Язык системы (ru / en-US) не совпадает с заголовком Accept-Language —
  // для проверок на бота это расхождение.
  try {
    Object.defineProperty(Navigator.prototype, 'language', { get: () => 'ru-RU', configurable: true });
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => ['ru-RU', 'ru', 'en-US', 'en'],
      configurable: true,
    });
  } catch (e) {}

  // В Chrome на любой странице есть window.chrome.csi/loadTimes, в Electron — нет.
  try {
    const c = window.chrome || {};
    if (typeof c.csi !== 'function') {
      c.csi = () => ({
        onloadT: performance.timing.domContentLoadedEventEnd,
        startE: performance.timing.navigationStart,
        pageT: performance.now(),
        tran: 15,
      });
    }
    if (typeof c.loadTimes !== 'function') {
      c.loadTimes = () => ({
        commitLoadTime: performance.timing.responseStart / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
        finishLoadTime: performance.timing.loadEventEnd / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: performance.timing.responseStart / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: performance.timing.navigationStart / 1000,
        startLoadTime: performance.timing.navigationStart / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      });
    }
    if (!window.chrome) Object.defineProperty(window, 'chrome', { value: c, configurable: true });
  } catch (e) {}
})();
`
  .replace('__FULL__', CHROME_FULL)
  .replace('__MAJOR__', CHROME_MAJOR);

try {
  webFrame.executeJavaScript(CLIENT_HINTS).catch(() => {});
} catch {}

// Внутренние страницы (arch://) получают системную тему и акцент Windows.
function applyArchTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (!root) return;
  const mode = theme.mode || (theme.dark ? 'dark' : 'light');
  root.dataset.theme = theme.name || 'original';
  root.dataset.mode = mode;
  root.dataset.appearance = theme.appearance || 'system';
  root.style.colorScheme = mode;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-contrast', theme.accentContrast);
  if (theme.accent2) root.style.setProperty('--accent-2', theme.accent2);
  root.classList.toggle('festive-theme', !!theme.festive);
  if (theme.daysToNewYear !== undefined) {
    root.dataset.days = String(theme.daysToNewYear);
  }
  try {
    window.dispatchEvent(new CustomEvent('arch-theme', { detail: theme }));
  } catch (e) {}
}

ipcRenderer.on('arch-theme', (_event, theme) => {
  if (location.protocol !== 'arch:') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyArchTheme(theme), { once: true });
  } else {
    applyArchTheme(theme);
  }
});

if (location.protocol === 'arch:') {
  // Preload выполняется до появления documentElement, поэтому начальную тему
  // применяем только после разбора документа — иначе страница остаётся без
  // data-theme, и праздничный блок не показывается.
  const whenReady = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  };
  ipcRenderer.invoke('theme:get')
    .then((theme) => whenReady(() => applyArchTheme(theme)))
    .catch(() => {});
  // Заголовки RSS-лент для нижнего блока новой вкладки.
  ipcRenderer.invoke('rss:list').then((data) => {
    const items = (data && data.items) || [];
    whenReady(() => {
      try {
        window.dispatchEvent(new CustomEvent('arch-rss', { detail: items }));
      } catch (e) {}
    });
  }).catch(() => {});
}

ipcRenderer.on('arch-rss', (_event, items) => {
  try {
    window.dispatchEvent(new CustomEvent('arch-rss', { detail: items || [] }));
  } catch (e) {}
});

// Внутренние страницы сообщают основному окну о состоянии таймера и будильника,
// чтобы индикатор появлялся в панели инструментов рядом с кнопкой VPN.
if (location.protocol === 'arch:') {
  try {
    contextBridge.exposeInMainWorld('archHost', {
      publishTimer: (state) => {
        try { ipcRenderer.send('arch:timer-state', state); } catch (e) {}
      },
      // Кнопка «Открыть через VPN» на странице ошибки: направляем сайт
      // через туннель и повторяем загрузку.
      retryThroughVpn: (url) => ipcRenderer.invoke('tab:retry-vpn', { url }),
    });
  } catch (e) {}
}

// ---------------------------------------------------------------- скелетон загрузки
// Пока страница грузится, показываем прототип с эффектом боке, чтобы вместо
// белого экрана не было пустоты.
const SKELETON_CSS = `
#arch-skeleton{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;
  background:var(--sk-bg,#101216);color:var(--sk-fg,#8a90a0);transition:opacity .28s ease}
#arch-skeleton.arch-out{opacity:0}
#arch-skeleton .arch-bokeh{position:absolute;inset:-25%}
#arch-skeleton .arch-bokeh i{position:absolute;display:block;border-radius:50%;
  filter:blur(48px);opacity:.42;animation:arch-bokeh 17s ease-in-out infinite}
#arch-skeleton .arch-bokeh i:nth-child(1){width:340px;height:340px;left:6%;top:12%;background:var(--sk-accent,#736cb2);animation-duration:19s}
#arch-skeleton .arch-bokeh i:nth-child(2){width:280px;height:280px;left:52%;top:4%;background:var(--sk-accent-2,#4d7cc4);animation-duration:23s;animation-delay:-4s}
#arch-skeleton .arch-bokeh i:nth-child(3){width:300px;height:300px;left:78%;top:26%;background:var(--sk-accent,#8f5bb5);animation-duration:21s;animation-delay:-8s}
#arch-skeleton .arch-bokeh i:nth-child(4){width:260px;height:260px;left:24%;top:58%;background:var(--sk-accent-2,#3f9d8f);animation-duration:25s;animation-delay:-2s}
#arch-skeleton .arch-bokeh i:nth-child(5){width:220px;height:220px;left:62%;top:66%;background:var(--sk-accent,#736cb2);animation-duration:20s;animation-delay:-11s}
#arch-skeleton .arch-bokeh i:nth-child(6){width:240px;height:240px;left:86%;top:72%;background:var(--sk-accent-2,#c07a4a);animation-duration:27s;animation-delay:-6s}
#arch-skeleton .arch-bokeh i:nth-child(7){width:200px;height:200px;left:40%;top:82%;background:var(--sk-accent,#5b6bd6);animation-duration:22s;animation-delay:-14s}
#arch-skeleton .arch-bokeh i:nth-child(8){width:190px;height:190px;left:8%;top:84%;background:var(--sk-accent-2,#49a06b);animation-duration:24s;animation-delay:-9s}
@keyframes arch-bokeh{0%,100%{transform:translate3d(0,0,0) scale(1)}33%{transform:translate3d(4%,-5%,0) scale(1.12)}66%{transform:translate3d(-4%,4%,0) scale(.92)}}
#arch-skeleton .arch-body{position:absolute;inset:0;padding:7vh 6vw;display:flex;flex-direction:column;gap:16px}
#arch-skeleton .arch-bar{height:46px;border-radius:14px;background:currentColor;opacity:.10}
#arch-skeleton .arch-title{height:34px;width:38%;border-radius:10px;background:currentColor;opacity:.14}
#arch-skeleton .arch-line{height:15px;border-radius:8px;background:currentColor;opacity:.11}
#arch-skeleton .arch-line.arch-w70{width:70%}
#arch-skeleton .arch-line.arch-w45{width:45%}
#arch-skeleton .arch-cards{display:flex;gap:16px;margin-top:10px;flex-wrap:wrap}
#arch-skeleton .arch-cards i{display:block;height:132px;flex:1 1 220px;border-radius:16px;background:currentColor;opacity:.09}
#arch-skeleton .arch-shimmer{position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,var(--sk-shimmer,rgba(255,255,255,.07)) 50%,transparent 70%);
  animation:arch-sweep 2.4s ease-in-out infinite}
@keyframes arch-sweep{0%{transform:translateX(-60%)}100%{transform:translateX(60%)}}
`;

const SKELETON_HTML = `
<div class="arch-bokeh"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
<div class="arch-body">
  <div class="arch-bar"></div>
  <div class="arch-title"></div>
  <div class="arch-line arch-w70"></div>
  <div class="arch-line arch-w45"></div>
  <div class="arch-cards"><i></i><i></i><i></i></div>
  <div class="arch-line arch-w70"></div>
  <div class="arch-line"></div>
</div>
<div class="arch-shimmer"></div>
`;

function installSkeleton() {
  const scheme = location.protocol;
  if (scheme !== 'http:' && scheme !== 'https:') return;
  let node = null;
  let pending = true;

  const build = () => {
    if (node || !document.documentElement) return false;
    node = document.createElement('div');
    node.id = 'arch-skeleton';
    node.innerHTML = SKELETON_HTML;
    const style = document.createElement('style');
    style.textContent = SKELETON_CSS;
    node.appendChild(style);
    document.documentElement.appendChild(node);
    try {
      const dark = window.matchMedia('(prefers-color-scheme: light)').matches;
      node.classList.toggle('arch-light', !dark);
    } catch (e) {}
    // Цвета берём из темы браузера, чтобы прототип совпадал с оформлением.
    ipcRenderer.invoke('theme:get').then((theme) => {
      try {
        if (!theme || !node) return;
        node.style.setProperty('--sk-bg', theme.dark ? '#141414' : '#f6f6f6');
        node.style.setProperty('--sk-fg', theme.dark ? '#8a90a0' : '#8b8b8b');
        node.style.setProperty('--sk-accent', theme.accent || '#736cb2');
        node.style.setProperty('--sk-accent-2', theme.accent2 || theme.accent || '#4d7cc4');
        node.style.setProperty('--sk-shimmer', theme.dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)');
      } catch (e) {}
    }).catch(() => {});
    return true;
  };

  const tryBuild = () => {
    if (!pending || node) return;
    if (build()) return;
    try {
      const observer = new MutationObserver(() => {
        if (build()) observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    } catch (e) {}
  };

  // Прототип показываем только если страница грузится дольше 140 мс,
  // иначе быстрые страницы мерцали бы вместо белого экрана.
  const timer = setTimeout(tryBuild, 140);
  const remove = () => {
    pending = false;
    clearTimeout(timer);
    if (!node) return;
    const target = node;
    node = null;
    target.classList.add('arch-out');
    setTimeout(() => {
      try { if (target.parentNode) target.parentNode.removeChild(target); } catch (e) {}
    }, 320);
  };

  if (document.readyState === 'complete') {
    remove();
  } else {
    // Снимаем прототип, как только страница отрисовала свой HTML. Раньше ждали
    // событие load целиком, и если какой-то ресурс висел (антибот-проверка,
    // медленный счётчик), заглушка оставалась на экране навсегда.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(remove, 80), { once: true });
    } else {
      setTimeout(remove, 80);
    }
    window.addEventListener('load', () => setTimeout(remove, 60), { once: true });
    // Страховка: что бы ни случилось, дольше 12 секунд заглушка не живёт.
    setTimeout(remove, 12000);
  }
}

// ---------------------------------------------------------------- пульт медиа
// Следим за <video>/<audio> на странице: сообщаем основному процессу, что
// играет, чтобы пульт в панели инструментов управлял этим воспроизведением.
(function trackMedia() {
  if (location.protocol === 'arch:') return;
  let last = '';
  const report = () => {
    try {
      const media = [...document.querySelectorAll('video, audio')]
        .filter((el) => !el.paused || el.readyState > 0)
        .sort((a, b) => (b.currentTime || 0) - (a.currentTime || 0))[0];
      if (!media) {
        const empty = JSON.stringify({ active: false });
        if (empty === last) return;
        last = empty;
        ipcRenderer.send('media:page-state', { active: false });
        return;
      }
      const meta = (navigator.mediaSession && navigator.mediaSession.metadata) || null;
      const state = {
        active: true,
        title: (meta && meta.title) || media.getAttribute('title') || document.title || '',
        artist: (meta && meta.artist) || '',
        playing: !media.paused && !media.ended,
        duration: Number.isFinite(media.duration) ? media.duration : 0,
        position: Number(media.currentTime) || 0,
      };
      const json = JSON.stringify(state);
      if (json === last) return;
      last = json;
      ipcRenderer.send('media:page-state', state);
    } catch (e) {}
  };
  setInterval(report, 1000);
  document.addEventListener('play', report, true);
  document.addEventListener('pause', report, true);
  document.addEventListener('loadedmetadata', report, true);
  report();
})();

installSkeleton();

// ---------------------------------------------------------------- режим чтения
// Извлекает основной текст страницы и показывает его в спокойном виде.
const READER_CODE = String.raw`
(() => {
  if (window.__archReader) return;
  const BAD = /(^|[-_\s])(nav|menu|sidebar|footer|header|comment|comments|share|social|widget|promo|advert|ads|banner|breadcrumb|pagination|popup|modal|cookie|subscribe|newsletter|related|recommend|tags|categories|toolbar|masthead|newsletter|recirc)([-_\s]|$)/i;
  const POSITIVE = /(^|[-_\s])(article|articlebody|post|content|entry|main|story|prose|body|text|blog|news)([-_\s]|$)/i;

  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const linkDensity = (el) => {
    const total = textOf(el).length || 1;
    let linked = 0;
    for (const a of el.querySelectorAll('a')) linked += textOf(a).length;
    return linked / total;
  };

  function score(el) {
    const text = textOf(el);
    if (text.length < 220) return -1;
    const paragraphs = el.querySelectorAll('p').length;
    if (!paragraphs) return -1;
    let value = text.length * (1 + Math.min(paragraphs, 20) * 0.08);
    value *= 1 - Math.min(linkDensity(el), 0.9);
    const tag = ((el.id || '') + ' ' + (el.className || '')).toString();
    if (BAD.test(tag)) value *= 0.25;
    if (POSITIVE.test(tag)) value *= 1.4;
    return value;
  }

  function bestContainer() {
    const candidates = document.querySelectorAll('article, main, [role="main"], .post, .article, .content, section, div');
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      const value = score(el);
      if (value > bestScore) {
        bestScore = value;
        best = el;
      }
    }
    return best;
  }

  function clean(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe, form, button, input, select, textarea, svg, video, audio, canvas, object, embed, nav, aside').forEach((el) => el.remove());
    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        // В режиме чтения фон и цвета задаёт сам читатель, а не пёстрый сайт.
        if (/^on/i.test(attr.name) || attr.name === 'style') {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === 'A' && el.getAttribute('href')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noreferrer noopener');
      }
    });
    return clone;
  }

  function buildOverlay(container, title) {
    const parse = (value) => {
      const m = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
      if (!m) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] == null ? 1 : Number(m[4]) };
    };
    const luminance = (value) => {
      const p = parse(value);
      if (!p) return 1;
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
    };
    const opaque = (value) => {
      const p = parse(value);
      return !!p && p.a > 0.5;
    };
    let bg = container ? getComputedStyle(container).backgroundColor : '';
    if (!opaque(bg)) bg = getComputedStyle(document.body).backgroundColor;
    if (!opaque(bg)) bg = getComputedStyle(document.documentElement).backgroundColor;
    if (!opaque(bg)) bg = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#101014' : '#fbfaf8';
    const dark = luminance(bg) < 0.45;
    let fg = getComputedStyle(container || document.body).color;
    if (!fg || (parse(fg) && parse(fg).a < 0.5) || Math.abs(luminance(fg) - luminance(bg)) < 0.28) {
      fg = dark ? '#e8e8e8' : '#1b1b1b';
    }
    const bgRgb = parse(bg);
    if (bgRgb) bg = 'rgb(' + Math.round(bgRgb.r) + ', ' + Math.round(bgRgb.g) + ', ' + Math.round(bgRgb.b) + ')';
    const fgRgb = parse(fg);
    if (fgRgb) fg = 'rgb(' + Math.round(fgRgb.r) + ', ' + Math.round(fgRgb.g) + ', ' + Math.round(fgRgb.b) + ')';
    const link = dark ? '#8ab4ff' : '#1250a0';
    const border = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)';
    const buttonBg = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.06)';
    const muted = dark ? 'rgba(255,255,255,.65)' : 'rgba(0,0,0,.6)';
    const codeBg = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';

    const overlay = document.createElement('div');
    overlay.id = 'arch-reader';
    overlay.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483646', 'background:' + bg,
      'color:' + fg, 'color-scheme:' + (dark ? 'dark' : 'light'), 'overflow:auto',
      'font:16px/1.72 Georgia, "Times New Roman", serif',
      'padding:48px 24px 96px', 'box-sizing:border-box',
    ].join(';'));
    const style = document.createElement('style');
    style.textContent = [
      '#arch-reader a{color:' + link + '}',
      '#arch-reader a:hover{opacity:.82}',
      '#arch-reader img{max-width:100%;height:auto}',
      '#arch-reader pre,#arch-reader code{background:' + codeBg + ';color:' + fg + ';border-radius:5px}',
      '#arch-reader code{padding:1px 5px}',
      '#arch-reader pre{padding:12px;overflow:auto}',
      '#arch-reader blockquote{margin-left:0;padding-left:16px;border-left:3px solid ' + border + ';color:' + muted + '}',
      '#arch-reader h1,#arch-reader h2,#arch-reader h3,#arch-reader h4{color:' + fg + '}',
      '#arch-reader hr{border-color:' + border + '}',
      '#arch-reader table{border-collapse:collapse;max-width:100%}',
      '#arch-reader td,#arch-reader th{border:1px solid ' + border + ';padding:4px 8px}',
    ].join('\n');
    const article = document.createElement('article');
    article.setAttribute('style', 'max-width:720px;margin:0 auto;');
    const h = document.createElement('h1');
    h.setAttribute('style', 'font:700 30px/1.25 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;margin:0 0 18px;letter-spacing:-.4px;color:' + fg + ';');
    h.textContent = title || document.title || '';
    const body = document.createElement('div');
    body.setAttribute('style', 'font-size:18px;');
    body.appendChild(clean(container));
    article.appendChild(h);
    article.appendChild(body);
    const close = document.createElement('button');
    close.setAttribute('style', [
      'position:fixed', 'top:18px', 'right:22px', 'z-index:2', 'border:1px solid ' + border,
      'background:' + buttonBg, 'color:' + fg, 'border-radius:999px', 'padding:8px 16px', 'cursor:pointer',
      'font:13px "Segoe UI Variable Text", system-ui, sans-serif',
    ].join(';'));
    close.textContent = 'Выйти из режима чтения';
    close.addEventListener('click', () => window.__archReader.toggle());
    overlay.appendChild(style);
    overlay.appendChild(article);
    overlay.appendChild(close);
    return overlay;
  }

  window.__archReader = {
    active: false,
    toggle() {
      const existing = document.getElementById('arch-reader');
      if (existing) {
        existing.remove();
        window.__archReader.active = false;
        document.documentElement.style.overflow = '';
        return false;
      }
      const container = bestContainer();
      if (!container) return false;
      const overlay = buildOverlay(container, document.title);
      document.documentElement.appendChild(overlay);
      window.__archReader.active = true;
      document.documentElement.style.overflow = 'hidden';
      window.scrollTo(0, 0);
      return true;
    },
    available() {
      return !!bestContainer();
    },
  };
})();
`;

// Код режима чтения внедряется, только если функция включена в настройках.
ipcRenderer.invoke('settings:get').then((settings) => {
  if (settings && settings.featureReaderMode === false) return;
  try {
    webFrame.executeJavaScript(READER_CODE).catch(() => {});
  } catch (e) {}
}).catch(() => {
  try {
    webFrame.executeJavaScript(READER_CODE).catch(() => {});
  } catch (e) {}
});

// ---------------------------------------------------------------- поиск медиа
// Сообщаем основному процессу о видео и аудио на странице: прямые ссылки,
// HLS-потоки и сегменты. Это нужно для загрузки роликов с YouTube, Rutube,
// VK Видео, Яндекс Музыки и других сервисов.
(function detectMedia() {
  if (location.protocol === 'arch:') return;
  const seen = new Set();
  const report = (url, kind) => {
    if (!url || !/^https?:/i.test(url)) return;
    const key = url.split('#')[0];
    if (seen.has(key)) return;
    seen.add(key);
    try {
      ipcRenderer.send('media:detected', {
        url: key,
        kind: kind || '',
        title: document.title || '',
      });
    } catch (e) {}
  };

  // Сетевые запросы: видны потоки, манифесты и отдельные сегменты.
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const type = entry.initiatorType || '';
        if (type === 'video' || type === 'audio' || type === 'media') {
          report(entry.name, type === 'audio' ? 'audio' : 'video');
        } else if (/\.(m3u8|mp4|m4v|webm|mp3|m4a|flac|opus|ogg)(?:$|\?)/i.test(entry.name)) {
          report(entry.name, '');
        }
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch (e) {}

  // Элементы <video> и <audio>.
  const scan = () => {
    try {
      for (const el of document.querySelectorAll('video, audio')) {
        const src = el.currentSrc || el.src || '';
        if (src) report(src, el.tagName === 'AUDIO' ? 'audio' : 'video');
        const sources = el.querySelectorAll('source[src]');
        for (const s of sources) report(s.src, el.tagName === 'AUDIO' ? 'audio' : 'video');
      }
    } catch (e) {}
  };
  try {
    new MutationObserver(scan).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  } catch (e) {}
  document.addEventListener('loadedmetadata', scan, true);
  document.addEventListener('play', scan, true);
  scan();
})();


