import type { Auth } from 'firebase/auth';
import { getLang } from '../core/settings';
import { firebaseApp, isFirebaseConfigured } from './app';

/** Holds no personal data. It only tells the next boot that loading the SDK is worthwhile. */
const SESSION_KEY = 'alrato.session';
const REDIRECT_KEY = 'alrato.redirecting';

export interface Account {
  uid: string;
  email: string | null;
  name: string | null;
}

export type AuthState =
  /** The SDK has not been loaded, which is the normal state for anyone not signed in. */
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'signed_out' }
  | { phase: 'signed_in'; account: Account };

export type SignInResult = 'ok' | 'cancelled' | 'redirecting' | 'network' | 'unauthorized_domain' | 'failed';

type AuthSdk = typeof import('firebase/auth');

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Without storage the app still works. Sign-in just is not remembered.
  }
}

/** Whether this browser has a session or a sign-in redirect to finish. */
export const hasAccountSession = (): boolean =>
  isFirebaseConfigured && (readFlag(SESSION_KEY) || readFlag(REDIRECT_KEY));

let state: AuthState = hasAccountSession() ? { phase: 'loading' } : { phase: 'idle' };
const listeners = new Set<() => void>();

export const authState = (): AuthState => state;

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: AuthState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

let loading: Promise<{ sdk: AuthSdk; auth: Auth }> | null = null;

/** Loads Firebase Auth on demand, so it stays out of the first load. */
function loadAuth(): Promise<{ sdk: AuthSdk; auth: Auth }> {
  if (!isFirebaseConfigured) return Promise.reject(new Error('firebase_not_configured'));
  loading ??= (async () => {
    const sdk = await import('firebase/auth');
    const auth = sdk.getAuth(firebaseApp);
    auth.languageCode = getLang();
    sdk.onAuthStateChanged(auth, (user) => {
      writeFlag(SESSION_KEY, Boolean(user));
      publish(
        user
          ? { phase: 'signed_in', account: { uid: user.uid, email: user.email, name: user.displayName } }
          : { phase: 'signed_out' },
      );
    });
    return { sdk, auth };
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Fetches the SDK early so the sign-in popup can open within the user's click. */
export function preloadAuth(): void {
  if (isFirebaseConfigured) void import('firebase/auth').catch(() => undefined);
}

/** Restores a previous session on startup. Costs nothing for students who never signed in. */
export async function resumeSession(): Promise<void> {
  if (!hasAccountSession()) return;
  try {
    const { sdk, auth } = await loadAuth();
    if (readFlag(REDIRECT_KEY)) {
      writeFlag(REDIRECT_KEY, false);
      await sdk.getRedirectResult(auth);
    }
  } catch {
    writeFlag(REDIRECT_KEY, false);
    if (state.phase === 'loading') publish({ phase: 'signed_out' });
  }
}

export async function signIn(): Promise<SignInResult> {
  let loaded: { sdk: AuthSdk; auth: Auth };
  try {
    loaded = await loadAuth();
  } catch {
    return 'network';
  }
  const { sdk, auth } = loaded;
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await sdk.signInWithPopup(auth, provider);
    return 'ok';
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancelled';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      writeFlag(REDIRECT_KEY, true);
      try {
        await sdk.signInWithRedirect(auth, provider);
        return 'redirecting';
      } catch {
        writeFlag(REDIRECT_KEY, false);
        return 'failed';
      }
    }
    if (code === 'auth/network-request-failed') return 'network';
    if (code === 'auth/unauthorized-domain') return 'unauthorized_domain';
    return 'failed';
  }
}

export async function signOutAccount(): Promise<void> {
  const { sdk, auth } = await loadAuth();
  await sdk.signOut(auth);
}
