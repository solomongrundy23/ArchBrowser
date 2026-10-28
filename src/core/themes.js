'use strict';

// Темы оформления.
//
// Светлый/тёмный режим — отдельная настройка (appearance), поэтому каждая
// тема существует в двух вариантах. CSS-палитры заданы в style.css и
// newtab.html: базовые поверхности берутся из режима, а тема задаёт акцент
// и оттенок поверхностей.

const THEMES = {
  // «Оригинальная» — нейтральный фон и акцентные элементы системы.
  original: {
    id: 'original',
    title: 'Оригинальная',
    neutral: true,
    accent: '',
    usesSystemAccent: true,
  },
  // Та же тема, но с системным акцентом в оформлении.
  accent: {
    id: 'accent',
    title: 'Акцентная',
    accent: '',
    usesSystemAccent: true,
  },
  // Стеклянные полупрозрачные поверхности с акцентом системы (macOS).
  liquidglass: {
    id: 'liquidglass',
    title: 'Liquid Glass',
    neutral: true,
    accent: '',
    usesSystemAccent: true,
    glass: true,
  },
  cyberpunk: {
    id: 'cyberpunk',
    title: 'Киберпанк',
    accent: '#ffd60a',
    accent2: '#3b82f6',
  },
  newyear: {
    id: 'newyear',
    title: 'Новый год',
    accent: '#e63946',
    accent2: '#37b24d',
    festive: true,
    holiday: { month: 1, day: 1, title: 'Новый год' },
  },
  christmas: {
    id: 'christmas',
    title: 'Рождество',
    accent: '#c1121f',
    accent2: '#2d6a4f',
    festive: true,
    holiday: { month: 1, day: 7, title: 'Рождество' },
  },
  winter: {
    id: 'winter',
    title: 'Зима',
    accent: '#3a7bd5',
    accent2: '#8fc7f5',
  },
  summer: {
    id: 'summer',
    title: 'Лето',
    accent: '#ef8b22',
    accent2: '#26a69a',
  },
  autumn: {
    id: 'autumn',
    title: 'Осень',
    accent: '#d97706',
    accent2: '#b45309',
  },
  spring: {
    id: 'spring',
    title: 'Весна',
    accent: '#db7093',
    accent2: '#7bc47f',
  },
  silver: {
    id: 'silver',
    title: 'Серебро',
    accent: '#aeb8c6',
    accent2: '#7d8899',
  },
  gold: {
    id: 'gold',
    title: 'Золото',
    accent: '#d4af37',
    accent2: '#9a7420',
  },
  umbrella: {
    id: 'umbrella',
    title: 'Umbrella Corp',
    accent: '#e53935',
    accent2: '#f5f5f5',
  },
  neon: {
    id: 'neon',
    title: 'Неон',
    accent: '#22d3ee',
    accent2: '#ff4fa3',
  },
  amoled: {
    id: 'amoled',
    title: 'AMOLED',
    accent: '#a78bfa',
    accent2: '#22d3ee',
  },
  silenthill: {
    id: 'silenthill',
    title: 'Silent Hill',
    accent: '#a8b5a2',
    accent2: '#c0503a',
  },
  // Праздники России и календарные праздники. Для них работает
  // автоматическое включение за 7 дней до даты и выключение через 7 дней.
  feb14: {
    id: 'feb14',
    title: 'День всех влюблённых',
    accent: '#ff4d8d',
    accent2: '#ff9ec4',
    festive: true,
    holiday: { month: 2, day: 14, title: 'День всех влюблённых' },
  },
  feb23: {
    id: 'feb23',
    title: 'День защитника Отечества',
    accent: '#e0b34a',
    accent2: '#4f6b4a',
    festive: true,
    holiday: { month: 2, day: 23, title: 'День защитника Отечества' },
  },
  mar8: {
    id: 'mar8',
    title: 'Международный женский день',
    accent: '#ff6fa5',
    accent2: '#8fd694',
    festive: true,
    holiday: { month: 3, day: 8, title: 'Международный женский день' },
  },
  may1: {
    id: 'may1',
    title: 'Праздник Весны и Труда',
    accent: '#e63946',
    accent2: '#6fbf73',
    festive: true,
    holiday: { month: 5, day: 1, title: 'Праздник Весны и Труда' },
  },
  may9: {
    id: 'may9',
    title: 'День Победы',
    accent: '#d99a2b',
    accent2: '#3f4a3a',
    festive: true,
    holiday: { month: 5, day: 9, title: 'День Победы' },
  },
  jun12: {
    id: 'jun12',
    title: 'День России',
    accent: '#2f6fd0',
    accent2: '#e63946',
    festive: true,
    holiday: { month: 6, day: 12, title: 'День России' },
  },
  nov4: {
    id: 'nov4',
    title: 'День народного единства',
    accent: '#c0392b',
    accent2: '#2f6fd0',
    festive: true,
    holiday: { month: 11, day: 4, title: 'День народного единства' },
  },
  halloween: {
    id: 'halloween',
    title: 'Хэллоуин',
    accent: '#ff8c1a',
    accent2: '#8b5cf6',
    festive: true,
    holiday: { month: 10, day: 31, title: 'Хэллоуин' },
  },
};

// Режим оформления: следует за системой или задан вручную.
const APPEARANCES = ['system', 'light', 'dark'];

const THEME_IDS = Object.keys(THEMES);

function isThemeId(value) {
  return THEME_IDS.includes(String(value || ''));
}

function isAppearance(value) {
  return APPEARANCES.includes(String(value || ''));
}

// Темы, которые перекрашивают поверхности (а не только акцент).
const TINTED_THEMES = THEME_IDS.filter((id) => !THEMES[id].neutral && id !== 'accent');

// Праздничные темы с датами.
const HOLIDAY_THEMES = THEME_IDS
  .filter((id) => THEMES[id].holiday)
  .map((id) => ({ id, ...THEMES[id].holiday }));

const HOLIDAY_WINDOW_DAYS = 7;

// Сколько дней осталось до Нового года (для новогодней темы).
function daysUntilNewYear(now = new Date()) {
  const year = now.getFullYear();
  let next = new Date(year + 1, 0, 1);
  if (now.getTime() < new Date(year, 0, 1).getTime()) next = new Date(year, 0, 1);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.ceil((next.getTime() - start.getTime()) / 86400000));
}

// Тема праздника, который сейчас в окне «7 дней до … 7 дней после».
// Если окна пересекаются (Новый год и Рождество), побеждает тот праздник,
// чей период начался позже: так Рождество закрывает новогоднюю тему 31 декабря.
function activeHolidayTheme(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best = null;
  for (const holiday of HOLIDAY_THEMES) {
    for (let delta = -1; delta <= 1; delta++) {
      const year = today.getFullYear() + delta;
      const date = new Date(year, holiday.month - 1, holiday.day);
      const start = date.getTime() - HOLIDAY_WINDOW_DAYS * 86400000;
      const end = date.getTime() + HOLIDAY_WINDOW_DAYS * 86400000 + 86399999;
      const time = today.getTime();
      if (time < start || time > end) continue;
      if (!best || start > best.start) {
        best = { id: holiday.id, start, end, date, title: holiday.title };
      }
    }
  }
  return best;
}

module.exports = {
  THEMES,
  THEME_IDS,
  TINTED_THEMES,
  APPEARANCES,
  HOLIDAY_THEMES,
  HOLIDAY_WINDOW_DAYS,
  isThemeId,
  isAppearance,
  daysUntilNewYear,
  activeHolidayTheme,
};
