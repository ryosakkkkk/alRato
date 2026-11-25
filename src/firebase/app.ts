import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

/**
 * Without a project the app still works: capture, library, review and on-device
 * inference need no backend. The placeholder only lets the SDK initialize.
 */
export const firebaseApp: FirebaseApp = initializeApp(
  isFirebaseConfigured ? config : { apiKey: 'local-only', projectId: 'local-only', appId: 'local-only' },
);

function startAppCheck(): boolean {
  if (!isFirebaseConfigured || typeof window === 'undefined' || env.MODE === 'test') return false;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_KEY as string | undefined;
  if (env.DEV) {
    // Debug tokens stay out of production bundles and out of the repository.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = (env.VITE_APPCHECK_DEBUG_TOKEN as string) || true;
  } else if (!siteKey) {
    return false;
  }
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-provider'),
    isTokenAutoRefreshEnabled: true,
  });
  return true;
}

/** Cloud inference needs both a Firebase project and App Check. */
export const isCloudConfigured = startAppCheck();
