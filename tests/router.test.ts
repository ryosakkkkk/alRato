import { InferenceMode } from 'firebase/ai';
import { describe, expect, it } from 'vitest';
import { decideRoute, type RouteContext } from '../src/ai/router';

const base: RouteContext = {
  task: 'help',
  isPrivate: false,
  online: true,
  metered: false,
  device: 'ready',
  cloudConfigured: true,
  cloudConsent: 'granted',
  cloudCapReached: false,
  preference: 'balanced',
  inputChars: 800,
  longInputChars: 3500,
};

describe('decideRoute', () => {
  it('keeps private notes on the device', () => {
    expect(decideRoute({ ...base, isPrivate: true })).toEqual({
      kind: 'run',
      mode: InferenceMode.ONLY_ON_DEVICE,
      reason: 'private_note',
    });
  });

  it.each(['unsupported', 'unavailable', 'downloadable', 'downloading'] as const)(
    'parks a private note when the device model is %s, even online',
    (device) => {
      expect(decideRoute({ ...base, isPrivate: true, device })).toEqual({
        kind: 'wait',
        reason: 'private_needs_device',
      });
    },
  );

  it('works offline with a local model', () => {
    expect(decideRoute({ ...base, online: false })).toMatchObject({
      mode: InferenceMode.ONLY_ON_DEVICE,
      reason: 'offline',
    });
  });

  it('queues when there is no model and no connection', () => {
    expect(decideRoute({ ...base, online: false, device: 'unavailable' })).toEqual({
      kind: 'wait',
      reason: 'offline_no_model',
    });
  });

  it('uses the cloud path when the device has no model', () => {
    expect(decideRoute({ ...base, device: 'unsupported' })).toMatchObject({
      mode: InferenceMode.PREFER_ON_DEVICE,
      reason: 'no_local_model',
    });
  });

  it('prefers cloud vision to read photos on a normal connection', () => {
    expect(decideRoute({ ...base, task: 'read' })).toMatchObject({
      mode: InferenceMode.PREFER_IN_CLOUD,
      reason: 'vision_quality',
    });
  });

  it('organizes a note in the cloud, because the kind and the links depend on it', () => {
    expect(decideRoute({ ...base, task: 'analyze' })).toMatchObject({
      mode: InferenceMode.PREFER_IN_CLOUD,
      reason: 'classify_quality',
    });
  });

  it('keeps hints on the device even when the cloud is available', () => {
    expect(decideRoute({ ...base, task: 'help' })).toMatchObject({
      mode: InferenceMode.PREFER_ON_DEVICE,
      reason: 'everyday_local',
    });
  });

  it('protects paid mobile data by reading photos locally', () => {
    expect(decideRoute({ ...base, task: 'read', metered: true })).toMatchObject({
      mode: InferenceMode.PREFER_ON_DEVICE,
      reason: 'save_data',
    });
  });

  it('runs everyday tasks on the device', () => {
    expect(decideRoute(base)).toMatchObject({ mode: InferenceMode.PREFER_ON_DEVICE, reason: 'everyday_local' });
  });

  it('sends long inputs to the cloud', () => {
    expect(decideRoute({ ...base, inputChars: 5000 })).toMatchObject({
      mode: InferenceMode.PREFER_IN_CLOUD,
      reason: 'long_input',
    });
  });

  it('falls back to the device when the daily cloud cap is reached', () => {
    expect(decideRoute({ ...base, cloudCapReached: true })).toMatchObject({
      mode: InferenceMode.ONLY_ON_DEVICE,
      reason: 'cloud_cap',
    });
  });

  it.each(['unknown', 'declined'] as const)('never picks a cloud route when consent is %s', (cloudConsent) => {
    const withDevice = decideRoute({ ...base, task: 'read', cloudConsent });
    expect(withDevice).toMatchObject({ kind: 'run', mode: InferenceMode.ONLY_ON_DEVICE });
    expect(decideRoute({ ...base, cloudConsent, preference: 'quality' })).toMatchObject({
      mode: InferenceMode.ONLY_ON_DEVICE,
    });
  });

  it('waits for an answer when the cloud is the only route', () => {
    expect(decideRoute({ ...base, device: 'unsupported', cloudConsent: 'unknown' })).toEqual({
      kind: 'wait',
      reason: 'needs_consent',
    });
    expect(decideRoute({ ...base, device: 'unsupported', cloudConsent: 'declined' })).toEqual({
      kind: 'wait',
      reason: 'cloud_declined',
    });
  });

  it('honors the student preference', () => {
    expect(decideRoute({ ...base, task: 'read', preference: 'local' })).toMatchObject({ reason: 'user_local' });
    expect(decideRoute({ ...base, preference: 'quality' })).toMatchObject({
      mode: InferenceMode.PREFER_IN_CLOUD,
      reason: 'user_quality',
    });
  });
});
