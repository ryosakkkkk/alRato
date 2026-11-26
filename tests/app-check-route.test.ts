import { InferenceMode } from 'firebase/ai';
import { describe, expect, it } from 'vitest';
import { decideRoute, type RouteContext } from '../src/ai/router';

const base: RouteContext = {
  task: 'help',
  isPrivate: false,
  online: true,
  metered: false,
  device: 'unavailable',
  cloudConfigured: true,
  cloudConsent: 'granted',
  cloudCapReached: false,
  cloudPaused: true,
  preference: 'balanced',
  inputChars: 800,
  longInputChars: 3500,
};

describe('routing while the cloud is paused after an App Check refusal', () => {
  it('finishes on this computer when it has a local model', () => {
    expect(decideRoute({ ...base, device: 'ready' })).toMatchObject({
      kind: 'run',
      mode: InferenceMode.ONLY_ON_DEVICE,
      reason: 'no_cloud',
    });
  });

  it('waits, with its own reason, when there is no local model', () => {
    expect(decideRoute(base)).toEqual({ kind: 'wait', reason: 'app_check_paused' });
  });

  it('keeps the cloud route when the cloud is not paused', () => {
    expect(decideRoute({ ...base, cloudPaused: false })).toMatchObject({ kind: 'run' });
  });
});
