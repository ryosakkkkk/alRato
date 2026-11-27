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
/** A new key: choices saved while dark was the default are not carried over, so everyone starts in white. */
const THEME_KEY = 'alrato.appearance';

/** White is the default look. Dark stays one tap away in Your AI > Appearance. */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The browser and phone bars take the colour of the page, so the app reads as one surface. */
export const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#07070c' };

export function applyTheme(theme: Theme = getTheme()): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
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
