import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/inter';
import '@fontsource/caveat/600.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { deviceStatus, refreshDevice, subscribeDevice } from './ai/device';
import { checkLocalModel, localStatus, subscribeLocal } from './ai/localModel';
import { App } from './App';
import { kickQueue, recoverInterrupted } from './core/queue';
import { applyTheme, getLang } from './core/settings';
import { hasAccountSession } from './firebase/auth';
import { loadRemoteConfig } from './firebase/remoteConfig';
import { I18nProvider } from './i18n';

// Before the first render, so the chosen theme is there from the first frame.
applyTheme();

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
  // Gemini Nano, and on a phone the local model the student may have downloaded. A slow GPU check
  // never holds the queue: if the local model turns out to be ready later, it wakes the queue itself.
  const localCheck = checkLocalModel();
  await Promise.all([refreshDevice(getLang()), Promise.race([localCheck, new Promise((resolve) => setTimeout(resolve, 1500))])]);
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

// The phone's local model finishing its download can unblock a private note whose text the student wrote.
let localWasReady = localStatus().state === 'ready';
subscribeLocal(() => {
  const ready = localStatus().state === 'ready';
  if (ready && !localWasReady) kickQueue();
  localWasReady = ready;
});
