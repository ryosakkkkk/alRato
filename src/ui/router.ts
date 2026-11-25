import { useSyncExternalStore } from 'react';

const currentPath = () => window.location.hash.replace(/^#/, '') || '/';

const savedPosition = (): number | undefined => (window.history.state as { alRato?: number } | null)?.alRato;

/**
 * Every history entry remembers how deep it is. The browser's own back and forward
 * buttons restore it, so our Back button always knows whether there is somewhere to go.
 */
let position = savedPosition() ?? 0;
if (savedPosition() === undefined) window.history.replaceState({ alRato: position }, '');

window.addEventListener('hashchange', () => {
  const saved = savedPosition();
  if (saved === undefined) {
    position += 1;
    window.history.replaceState({ alRato: position }, '');
  } else {
    position = saved;
  }
});

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export const usePath = (): string => useSyncExternalStore(subscribe, currentPath);

export function go(path: string): void {
  window.location.hash = path;
  window.scrollTo({ top: 0 });
}

/** Returns to the previous screen, or home when the app was opened on a deep link. */
export function goBack(fallback = '/'): void {
  if (position > 0) window.history.back();
  else go(fallback);
}
