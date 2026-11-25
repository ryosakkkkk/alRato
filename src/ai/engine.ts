import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
  type Part,
} from 'firebase/ai';
import { db } from '../core/db';
import { getCloudConsent, requestConsent } from '../core/consent';
import { blobToBase64 } from '../core/image';
import { getLang, getPreference } from '../core/settings';
import type { AiTask, InferenceOrigin, Lang, Receipt, RouteReason } from '../core/types';
import { firebaseApp, isCloudConfigured } from '../firebase/app';
import { remote } from '../firebase/remoteConfig';
import { expectedIO, hasPromptApi, isMeteredConnection, refreshDevice, reportDownloadProgress } from './device';
import { AlRatoAiError, classifyError, WaitForRoute } from './errors';
import { decideRoute } from './router';
import { parseJson } from './validate';

const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

/** A stuck request must never leave a note "processing" forever. */
const CLOUD_TIMEOUT_MS = 30_000;
const DEVICE_TIMEOUT_MS = 120_000;

/** Parses a Remote Config model setting: the first model is preferred, the rest are backups. */
export function cloudModels(setting: string): string[] {
  return setting
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

const modelsFor = (task: AiTask): string[] =>
  cloudModels(task === 'read' ? remote().model_vision : remote().model_text);

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AlRatoAiError('device_failed', 'deadline')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** The receipt must explain what actually happened, even if the SDK took the other route. */
function honestReason(planned: RouteReason, source: InferenceOrigin): RouteReason {
  if (source === 'on_device') {
    if (planned === 'no_local_model') return 'everyday_local';
    if (planned === 'vision_quality' || planned === 'long_input' || planned === 'user_quality') return 'no_cloud';
  } else if (planned === 'everyday_local' || planned === 'save_data' || planned === 'user_local') {
    return 'no_local_model';
  }
  return planned;
}

export interface GenerateRequest<T> {
  task: AiTask;
  system: string;
  prompt: string;
  image?: Blob;
  schema: object;
  parse: (raw: Record<string, unknown>) => T;
  isPrivate: boolean;
  maxOutputTokens: number;
}

export interface GenerateResult<T> {
  data: T;
  receipt: Receipt;
}

function buildModel<T>(req: GenerateRequest<T>, mode: InferenceMode, lang: Lang, cloudModel: string): GenerativeModel {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: cloudModel,
      systemInstruction: req.system,
      generationConfig: {
        temperature: req.task === 'help' ? 0.4 : 0.1,
        maxOutputTokens: req.maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: req.schema as never,
      },
    },
    onDeviceParams: {
      createOptions: {
        ...expectedIO(Boolean(req.image), lang),
        // The SDK forwards `systemInstruction` only to the cloud, so Nano gets it here.
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: req.system }] }],
      },
      promptOptions: { responseConstraint: req.schema },
    },
  }, { timeout: CLOUD_TIMEOUT_MS });
}

async function buildParts(req: GenerateRequest<unknown>): Promise<{ parts: Part[]; imageBytes: number }> {
  const parts: Part[] = [{ type: 'text', text: req.prompt }];
  if (!req.image) return { parts, imageBytes: 0 };
  const data = await blobToBase64(req.image);
  parts.push({ type: 'inlineData', inlineData: { data, mimeType: 'image/jpeg' } });
  return { parts, imageBytes: data.length };
}

async function cloudCallsToday(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return db.usage.where('at').aboveOrEqual(startOfDay.getTime()).filter((u) => u.source === 'in_cloud').count();
}

interface Attempt {
  rawText: string;
  source: InferenceOrigin;
  latencyMs: number;
  model: string;
}

/**
 * Privacy gate. In SDK 13.4, a browser without the Prompt API gets no Chrome adapter,
 * and `callCloudOrDevice` then sends the request to the cloud even for ONLY_ON_DEVICE.
 * alRato must never let a private note take that path, so we refuse before the SDK runs.
 */
export function assertOnDevicePossible(mode: InferenceMode): void {
  if (mode === InferenceMode.ONLY_ON_DEVICE && !hasPromptApi()) {
    throw new AlRatoAiError('privacy_gate', 'ONLY_ON_DEVICE requested but the Prompt API is missing');
  }
}

async function attempt<T>(
  req: GenerateRequest<T>,
  mode: InferenceMode,
  parts: Part[],
  lang: Lang,
  cloudModel: string,
): Promise<Attempt> {
  assertOnDevicePossible(mode);
  const started = performance.now();
  const result = await withDeadline(
    buildModel(req, mode, lang, cloudModel).generateContent(parts),
    mode === InferenceMode.ONLY_IN_CLOUD ? CLOUD_TIMEOUT_MS + 2_000 : DEVICE_TIMEOUT_MS,
  );
  const rawText = result.response.text();
  const source: InferenceOrigin =
    result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud';

  // Second line of defense: if a private note ever came back from the cloud, discard it.
  if (req.isPrivate && source !== 'on_device') {
    throw new AlRatoAiError('privacy_gate', 'Private note answered by the cloud');
  }
  return { rawText, source, latencyMs: Math.round(performance.now() - started), model: cloudModel };
}

/** Tries each cloud model in order when one is overloaded or times out. */
async function attemptWithBackups<T>(
  req: GenerateRequest<T>,
  mode: InferenceMode,
  parts: Part[],
  lang: Lang,
): Promise<Attempt> {
  const models = modelsFor(req.task);
  let last: AlRatoAiError | undefined;
  for (const model of models) {
    try {
      return await attempt(req, mode, parts, lang, model);
    } catch (error) {
      last = classifyError(error);
      if (!last.transient || mode === InferenceMode.ONLY_ON_DEVICE || !navigator.onLine) throw last;
    }
  }
  throw last ?? new AlRatoAiError('config', 'no cloud model configured');
}

/** Runs one AI task through the hybrid router and returns validated data with a receipt. */
export async function generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
  const lang = getLang();
  const device = await refreshDevice(lang);
  const decision = decideRoute({
    task: req.task,
    isPrivate: req.isPrivate,
    online: navigator.onLine,
    metered: isMeteredConnection(),
    device: req.image ? device.vision : device.text,
    cloudConfigured: isCloudConfigured,
    cloudConsent: getCloudConsent(),
    cloudCapReached: (await cloudCallsToday()) >= remote().daily_cloud_cap,
    preference: getPreference(),
    inputChars: req.system.length + req.prompt.length,
    longInputChars: remote().long_input_chars,
  });

  if (decision.kind === 'wait') {
    if (decision.reason === 'needs_consent') requestConsent();
    throw new WaitForRoute(decision.reason);
  }

  const { parts, imageBytes } = await buildParts(req);
  const canRetryInCloud = () =>
    !req.isPrivate && navigator.onLine && isCloudConfigured && getCloudConsent() === 'granted';

  let mode = decision.mode;
  let reason: RouteReason = decision.reason;
  let result: Attempt;

  const deviceReady = (req.image ? device.vision : device.text) === 'ready';

  try {
    result = await attemptWithBackups(req, mode, parts, lang);
  } catch (error) {
    const failure = classifyError(error);
    if (failure.failure === 'device_failed' && mode !== InferenceMode.ONLY_ON_DEVICE && canRetryInCloud()) {
      // The SDK does not fall back when the on-device call itself fails, so we do.
      mode = InferenceMode.ONLY_IN_CLOUD;
      reason = 'device_failed_fallback';
      result = await attemptWithBackups(req, mode, parts, lang);
    } else if (failure.transient && mode === InferenceMode.PREFER_IN_CLOUD && deviceReady) {
      // Every cloud model is down or slow, and the SDK only rescues some of those errors.
      mode = InferenceMode.ONLY_ON_DEVICE;
      reason = 'no_cloud';
      result = await attempt(req, mode, parts, lang, modelsFor(req.task)[0]).catch((e) => {
        throw classifyError(e);
      });
    } else {
      throw failure;
    }
  }

  let data: T;
  try {
    data = req.parse(parseJson(result.rawText));
  } catch (error) {
    // Nano sometimes returns weak JSON. Retry in the cloud when the note is allowed to go there.
    if (result.source !== 'on_device' || !canRetryInCloud()) throw classifyError(error);
    mode = InferenceMode.ONLY_IN_CLOUD;
    reason = 'device_failed_fallback';
    result = await attemptWithBackups(req, mode, parts, lang);
    data = req.parse(parseJson(result.rawText));
  }

  const payloadBytes = new TextEncoder().encode(req.system + req.prompt).length + imageBytes;
  const inCloud = result.source === 'in_cloud';
  const receipt: Receipt = {
    task: req.task,
    source: result.source,
    mode,
    reason: honestReason(reason, result.source),
    latencyMs: result.latencyMs,
    bytesSent: inCloud ? payloadBytes : 0,
    imageSent: inCloud && imageBytes > 0,
    model: inCloud ? result.model : 'gemini-nano',
    at: Date.now(),
  };

  await db.usage.add({
    at: receipt.at,
    task: req.task,
    source: result.source,
    latencyMs: result.latencyMs,
    bytesSent: receipt.bytesSent,
    bytesKept: inCloud ? 0 : payloadBytes,
  });

  return { data, receipt };
}

/**
 * Starts the Gemini Nano download. Chrome requires this to follow a user gesture,
 * so it is only ever called from a button handler.
 */
export async function setupDeviceModel(): Promise<void> {
  const lang = getLang();
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: modelsFor('help')[0] },
    onDeviceParams: { createOptions: expectedIO(true, lang) },
  });
  await model.initializeDeviceModel((fraction) => reportDownloadProgress(fraction));
  await refreshDevice(lang);
}
