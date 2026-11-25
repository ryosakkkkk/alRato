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

export function getPreference(): RoutePreference {
  const saved = localStorage.getItem(PREF_KEY);
  return saved === 'local' || saved === 'quality' ? saved : 'balanced';
}

export function setPreference(pref: RoutePreference): void {
  localStorage.setItem(PREF_KEY, pref);
}
