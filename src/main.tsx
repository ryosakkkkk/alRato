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
  await recoverInterrupted();
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

let lastDeviceState = deviceStatus().text;
subscribeDevice(() => {
  const next = deviceStatus().text;
  if (next === 'ready' && lastDeviceState !== 'ready') kickQueue();
  lastDeviceState = next;
});
