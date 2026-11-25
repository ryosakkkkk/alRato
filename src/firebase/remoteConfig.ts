import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import { firebaseApp, isFirebaseConfigured } from './app';

/**
 * Values we can change from the Firebase console without shipping a new build:
 * swap a model that gets deprecated, or tune the router during judging.
 * Model settings are comma-separated: the first is preferred, the rest are backups.
 */
export const RC_DEFAULTS = {
  model_vision: 'gemini-3.5-flash-lite,gemini-3.8-flash,gemini-4-hydrogen',
  model_text: 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash',
  long_input_chars: 3500,
  daily_cloud_cap: 40,
};

export type RemoteValues = typeof RC_DEFAULTS;

let values: RemoteValues = { ...RC_DEFAULTS };

export const remote = (): RemoteValues => values;

export async function loadRemoteConfig(): Promise<void> {
  if (!isFirebaseConfigured || !navigator.onLine) return;
  try {
    const rc = getRemoteConfig(firebaseApp);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
    rc.settings.fetchTimeoutMillis = 6_000;
    rc.defaultConfig = { ...RC_DEFAULTS };
    await fetchAndActivate(rc);
    values = {
      model_vision: getValue(rc, 'model_vision').asString() || RC_DEFAULTS.model_vision,
      model_text: getValue(rc, 'model_text').asString() || RC_DEFAULTS.model_text,
      long_input_chars: getValue(rc, 'long_input_chars').asNumber() || RC_DEFAULTS.long_input_chars,
      daily_cloud_cap: getValue(rc, 'daily_cloud_cap').asNumber() || RC_DEFAULTS.daily_cloud_cap,
    };
  } catch {
    // Remote Config is an optimization. Safe defaults keep the app working.
  }
}
