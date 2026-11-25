/**
 * The student's decision about sending notes to cloud AI. It is stored only on this device.
 *
 * alRato runs on the free tier of the Gemini Developer API, whose terms say Google may use
 * submitted content to improve its products, that human reviewers may read it, that users
 * must be 18 or older, and that it cannot be offered in the EEA, Switzerland or the UK.
 * Nothing is sent to the cloud until the student has read that and agreed.
 */
export type CloudConsent = 'unknown' | 'granted' | 'declined';

const KEY = 'alrato.cloudConsent.v1';

const listeners = new Set<() => void>();
let promptOpen = false;
let askedThisSession = false;

export function getCloudConsent(): CloudConsent {
  const saved = localStorage.getItem(KEY);
  return saved === 'granted' || saved === 'declined' ? saved : 'unknown';
}

export function setCloudConsent(value: Exclude<CloudConsent, 'unknown'>): void {
  localStorage.setItem(KEY, value);
  promptOpen = false;
  listeners.forEach((listener) => listener());
}

export const isConsentPromptOpen = (): boolean => promptOpen;

/** Opens the consent sheet from anywhere in the app. */
export function openConsentPrompt(): void {
  if (promptOpen) return;
  promptOpen = true;
  listeners.forEach((listener) => listener());
}

/**
 * Called when a note needs the cloud and the student has not decided. It asks once per
 * session, so a dismissed sheet does not come back on every retry. The note offers it again.
 */
export function requestConsent(): void {
  if (askedThisSession || getCloudConsent() !== 'unknown') return;
  askedThisSession = true;
  openConsentPrompt();
}

export function closeConsentPrompt(): void {
  if (!promptOpen) return;
  promptOpen = false;
  listeners.forEach((listener) => listener());
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
