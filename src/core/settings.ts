import type { Lang, RoutePreference } from './types';

const LANG_KEY = 'alrato.lang';
const PREF_KEY = 'alrato.routePreference';

function detectLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function getLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'en' || saved === 'es' ? saved : detectLang();
}

export function setLang(lang: Lang): void {
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
}

export type Theme = 'dark' | 'light';
const THEME_KEY = 'alrato.theme';

/** Dark is the default look: the board and the math videos it imitates are dark. */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme = getTheme()): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#07070c' : '#7f9fe0');
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function getPreference(): RoutePreference {
  const saved = localStorage.getItem(PREF_KEY);
  return saved === 'local' || saved === 'quality' ? saved : 'balanced';
}

export function setPreference(pref: RoutePreference): void {
  localStorage.setItem(PREF_KEY, pref);
}
