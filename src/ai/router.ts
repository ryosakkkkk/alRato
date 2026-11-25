import { InferenceMode } from 'firebase/ai';
import type { CloudConsent } from '../core/consent';
import type { AiTask, RoutePreference, RouteReason, WaitReason } from '../core/types';
import type { DeviceState } from './device';

export interface RouteContext {
  task: AiTask;
  isPrivate: boolean;
  online: boolean;
  metered: boolean;
  /** Gemini Nano state for the modality this task needs (text or image). */
  device: DeviceState;
  cloudConfigured: boolean;
  /** Nothing goes to the cloud unless the student said yes. */
  cloudConsent: CloudConsent;
  cloudCapReached: boolean;
  preference: RoutePreference;
  inputChars: number;
  longInputChars: number;
}

export type RouteDecision =
  | { kind: 'run'; mode: InferenceMode; reason: RouteReason }
  | { kind: 'wait'; reason: WaitReason };

const run = (mode: InferenceMode, reason: RouteReason): RouteDecision => ({ kind: 'run', mode, reason });
const wait = (reason: WaitReason): RouteDecision => ({ kind: 'wait', reason });

/**
 * The hybrid policy of alRato. Firebase AI Logic executes the mode; this decides
 * which mode each task deserves.
 *
 *  - Private notes never leave the device. If it cannot run them, they wait.
 *  - The cloud needs the student's consent. Without it, the note runs locally or waits.
 *  - No usable cloud: run on-device, or wait in the queue.
 *  - Reading a photo favors the cloud because handwriting and math need the best vision.
 *  - Short, frequent tasks (organize, hint) favor the device: instant, free, private.
 *  - On paid mobile data the device is preferred even for photos.
 */
export function decideRoute(c: RouteContext): RouteDecision {
  const deviceReady = c.device === 'ready';

  if (c.isPrivate) {
    return deviceReady ? run(InferenceMode.ONLY_ON_DEVICE, 'private_note') : wait('private_needs_device');
  }

  const consented = c.cloudConsent === 'granted';
  const cloudUsable = c.online && c.cloudConfigured && consented && !c.cloudCapReached;
  if (!cloudUsable) {
    if (deviceReady) {
      const reason: RouteReason = !c.online
        ? 'offline'
        : c.cloudConsent === 'declined'
          ? 'user_local'
          : c.cloudCapReached
            ? 'cloud_cap'
            : 'no_cloud';
      return run(InferenceMode.ONLY_ON_DEVICE, reason);
    }
    if (!c.online) return wait('offline_no_model');
    if (c.cloudConfigured && !consented) {
      return wait(c.cloudConsent === 'declined' ? 'cloud_declined' : 'needs_consent');
    }
    return wait(c.cloudCapReached ? 'cloud_cap_no_model' : 'cloud_unavailable');
  }

  // PREFER_ON_DEVICE here still lets the SDK pick up a model that finished downloading.
  if (!deviceReady) return run(InferenceMode.PREFER_ON_DEVICE, 'no_local_model');
  if (c.preference === 'local') return run(InferenceMode.PREFER_ON_DEVICE, 'user_local');
  if (c.preference === 'quality') return run(InferenceMode.PREFER_IN_CLOUD, 'user_quality');

  if (c.task === 'read') {
    return c.metered
      ? run(InferenceMode.PREFER_ON_DEVICE, 'save_data')
      : run(InferenceMode.PREFER_IN_CLOUD, 'vision_quality');
  }
  if (c.inputChars > c.longInputChars) return run(InferenceMode.PREFER_IN_CLOUD, 'long_input');
  return run(InferenceMode.PREFER_ON_DEVICE, 'everyday_local');
}
