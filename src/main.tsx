import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@fontsource/caveat/600.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { deviceStatus, refreshDevice, subscribeDevice } from './ai/device';
import { App } from './App';
import { kickQueue, recoverInterrupted } from './core/queue';
import { getLang } from './core/settings';
import { hasAccountSession } from './firebase/auth';
import { loadRemoteConfig } from './firebase/remoteConfig';
import { I18nProvider } from './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

registerSW({ immediate: true });

async function boot() {
  // Queued behind any other tab that is working the queue, so boot does not wait for that tab.
  void recoverInterrupted();
  await refreshDevice(getLang());
  kickQueue();
  // Sync and the Firebase Auth and Firestore SDKs load only for someone who signed in before.
  if (hasAccountSession()) {
    void import('./firebase/sync').then((sync) => sync.initSync()).catch(() => undefined);
  }
  await loadRemoteConfig();
}
void boot();

// "Al rato" in practice: anything waiting resumes as soon as a route opens up.
window.addEventListener('online', kickQueue);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshDevice(getLang()).then(kickQueue);
});

// Either the text model or the vision model becoming ready can unblock a waiting note.
let lastDeviceState = deviceStatus();
subscribeDevice(() => {
  const next = deviceStatus();
  const becameReady =
    (next.text === 'ready' && lastDeviceState.text !== 'ready') ||
    (next.vision === 'ready' && lastDeviceState.vision !== 'ready');
  if (becameReady) kickQueue();
  lastDeviceState = next;
});
