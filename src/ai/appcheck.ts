/**
 * App Check refuses a browser after a failed attestation, and the Firebase SDK then waits about a day
 * before it asks again. alRato keeps the same pause: while it lasts, new work does not call the cloud.
 * It finishes on this computer's model when there is one, and waits otherwise. Notes do not fail one
 * by one, and the pause ends by itself. A student who presses Try again ends it on purpose.
 */
export const APP_CHECK_PAUSE_MS = 24 * 60 * 60 * 1000;
const KEY = 'alrato.appCheckPausedUntil.v1';

/** Starts the pause after a refusal. Returns the time it ends. */
export function pauseCloudForAppCheck(now = Date.now()): number {
  const until = now + APP_CHECK_PAUSE_MS;
  localStorage.setItem(KEY, String(until));
  return until;
}

/** The time the pause ends, or null when the cloud may be used. */
export function appCheckPausedUntil(now = Date.now()): number | null {
  const until = Number(localStorage.getItem(KEY));
  return until > now ? until : null;
}

export function isAppCheckPaused(now = Date.now()): boolean {
  return appCheckPausedUntil(now) !== null;
}

/** The student asked for the cloud again. A refusal, if it comes back, pauses it again. */
export function resumeCloudAfterAppCheck(): void {
  localStorage.removeItem(KEY);
}
