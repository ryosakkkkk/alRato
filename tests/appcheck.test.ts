import { beforeEach, describe, expect, it } from 'vitest';
import {
  APP_CHECK_PAUSE_MS,
  appCheckPausedUntil,
  isAppCheckPaused,
  pauseCloudForAppCheck,
  resumeCloudAfterAppCheck,
} from '../src/ai/appcheck';

beforeEach(() => localStorage.clear());

describe('the App Check pause', () => {
  it('lasts about a day after a refusal', () => {
    const now = 1_000_000;
    expect(pauseCloudForAppCheck(now)).toBe(now + APP_CHECK_PAUSE_MS);
    expect(isAppCheckPaused(now + 1)).toBe(true);
    expect(appCheckPausedUntil(now)).toBe(now + APP_CHECK_PAUSE_MS);
    expect(isAppCheckPaused(now + APP_CHECK_PAUSE_MS)).toBe(false);
  });

  it('ends as soon as the student asks for the cloud again', () => {
    pauseCloudForAppCheck();
    resumeCloudAfterAppCheck();
    expect(isAppCheckPaused()).toBe(false);
  });

  it('is off when nothing was refused', () => {
    expect(isAppCheckPaused()).toBe(false);
    expect(appCheckPausedUntil()).toBeNull();
  });
});
