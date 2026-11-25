import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getLang, setLang as persistLang } from '../core/settings';
import type { Lang } from '../core/types';
import { en, type MessageKey } from './en';
import { es } from './es';

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, es };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let message: string = dictionaries[lang][key] ?? en[key];
  if (vars) for (const [name, value] of Object.entries(vars)) message = message.replaceAll(`{${name}}`, String(value));
  return message;
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = getLang();
    document.documentElement.lang = initial;
    document.title = translate(initial, 'app.title');
    return initial;
  });
  const setLang = useCallback((next: Lang) => {
    persistLang(next);
    document.title = translate(next, 'app.title');
    setLangState(next);
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside provider');
  return value;
}
