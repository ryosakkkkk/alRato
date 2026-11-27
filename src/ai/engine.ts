import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
  type HybridParams,
  type Part,
} from 'firebase/ai';
import { db } from '../core/db';
import { getCloudConsent, requestConsent } from '../core/consent';
import { blobToBase64 } from '../core/image';
import { getLang, getPreference } from '../core/settings';
import type { AiTask, InferenceOrigin, Lang, Receipt, RouteReason } from '../core/types';
import { firebaseApp, isCloudConfigured } from '../firebase/app';
import { remote } from '../firebase/remoteConfig';
import { expectedIO, hasPromptApi, isMeteredConnection, refreshDevice, reportDownloadProgress, type DeviceState } from './device';
import { localGenerate, localModelReady, localReceiptModel } from './localModel';
import { AlRatoAiError, classifyError, WaitForRoute, type AiFailure } from './errors';
import { allModelsExhausted, isModelExhausted, markModelExhausted } from './quota';
import { isAppCheckPaused, pauseCloudForAppCheck } from './appcheck';
import { decideRoute } from './router';
import { parseJson } from './validate';

const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

/**
 * A cloud call must never hold an interaction for long. Reading a photo is slower than
 * organizing or hinting, so it gets more time.
 */
const CLOUD_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 30_000;
/** On-device inference has no network timeout, and CPU-only machines are slow. */
const DEVICE_TIMEOUT_MS = 180_000;

const cloudTimeout = (task: AiTask): number => (task === 'read' ? READ_TIMEOUT_MS : CLOUD_TIMEOUT_MS);

/** Parses a Remote Config model setting: the first model is preferred, the rest are backups. */
export function cloudModels(setting: string): string[] {
  return setting
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Each role gets the model it is best at: reading photos and organizing notes go to fast vision and
 * text models, and a full worked solution goes to the strongest reasoning model first.
 */
const modelsFor = (task: AiTask, deepReasoning = false): string[] =>
  cloudModels(task === 'read' ? remote().model_vision : deepReasoning ? remote().model_reasoning : remote().model_text);

function withDeadline<T>(work: Promise<T>, ms: number, failure: AiFailure): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AlRatoAiError(failure, 'deadline', failure === 'network')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** The receipt must explain what actually happened, even if the SDK took the other route. */
function honestReason(planned: RouteReason, source: InferenceOrigin): RouteReason {
  if (source === 'on_device') {
    if (planned === 'no_local_model') return 'everyday_local';
    if (
      planned === 'vision_quality' ||
      planned === 'classify_quality' ||
      planned === 'solution_quality' ||
      planned === 'long_input' ||
      planned === 'user_quality'
    ) {
      return 'no_cloud';
    }
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
  /**
   * Checked just before a request could leave the device. The note's privacy may have changed while
   * the request was being prepared, and a note that became private must never reach the cloud.
   */
  stillPublic?: () => Promise<boolean>;
  maxOutputTokens: number;
  /** The full worked solution, which the router sends to the cloud first when it may. */
  deepReasoning?: boolean;
}

export interface GenerateResult<T> {
  data: T;
  receipt: Receipt;
}

/** The SDK parameters of one request. The same parameters always describe the same model. */
function modelParams<T>(req: GenerateRequest<T>, mode: InferenceMode, lang: Lang, cloudModel: string): HybridParams {
  return {
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
  };
}

/**
 * The SDK creates one Chrome session per request, and it destroys the previous session only
 * when the same model object serves the next request. Reusing one model per configuration keeps
 * on-device sessions from piling up. A model that is busy, or that failed, is never shared.
 */
const MODEL_CACHE_LIMIT = 12;
interface CachedModel {
  model: GenerativeModel;
  busy: boolean;
}
const modelCache = new Map<string, CachedModel>();

/** Forgets every cached model. Tests use it to start from a clean state. */
export function resetModelCache(): void {
  modelCache.clear();
}

interface Lease {
  model: GenerativeModel;
  /** Call once the request is over. `ok` is false when the request was abandoned mid-way. */
  done: (ok: boolean) => void;
}

function leaseModel<T>(
  req: GenerateRequest<T>,
  mode: InferenceMode,
  lang: Lang,
  cloudModel: string,
  timeoutMs: number,
): Lease {
  const key = JSON.stringify({ params: modelParams(req, mode, lang, cloudModel), timeoutMs });
  const hit = modelCache.get(key);
  if (hit && !hit.busy) {
    hit.busy = true;
    return {
      model: hit.model,
      done: (ok) => {
        hit.busy = false;
        if (!ok && modelCache.get(key) === hit) modelCache.delete(key);
      },
    };
  }
  const model = getGenerativeModel(ai, modelParams(req, mode, lang, cloudModel), { timeout: timeoutMs });
  // The cached model is serving another request right now, so this one gets its own.
  if (hit) return { model, done: () => undefined };
  const entry: CachedModel = { model, busy: true };
  modelCache.set(key, entry);
  evictIdle();
  return {
    model,
    done: (ok) => {
      entry.busy = false;
      if (!ok && modelCache.get(key) === entry) modelCache.delete(key);
    },
  };
}

function evictIdle(): void {
  for (const [key, entry] of modelCache) {
    if (modelCache.size <= MODEL_CACHE_LIMIT) return;
    if (!entry.busy) modelCache.delete(key);
  }
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
  local: boolean,
): Promise<Attempt> {
  // On a phone, the text tasks the router gives the device go to the local model (WebGPU).
  if (local && (mode === InferenceMode.ONLY_ON_DEVICE || mode === InferenceMode.PREFER_ON_DEVICE)) {
    const started = performance.now();
    const rawText = await withDeadline(
      localGenerate({
        system: req.system,
        prompt: req.prompt,
        schema: req.schema,
        maxTokens: req.maxOutputTokens,
        temperature: req.task === 'help' ? 0.4 : 0.1,
      }),
      DEVICE_TIMEOUT_MS,
      'device_failed',
    ).catch((error: unknown) => {
      // Whatever went wrong on the GPU, it is a device failure: the router may then try the cloud.
      throw error instanceof AlRatoAiError ? error : new AlRatoAiError('device_failed', String(error));
    });
    return { rawText, source: 'on_device', latencyMs: Math.round(performance.now() - started), model: localReceiptModel() };
  }
  assertOnDevicePossible(mode);
  if (mode !== InferenceMode.ONLY_ON_DEVICE && req.stillPublic && !(await req.stillPublic())) {
    throw new AlRatoAiError('stale', 'The note became private before the request was sent');
  }
  const started = performance.now();
  const timeoutMs = cloudTimeout(req.task);
  const lease = leaseModel(req, mode, lang, cloudModel, timeoutMs);
  const deadline =
    mode === InferenceMode.ONLY_IN_CLOUD
      ? { ms: timeoutMs + 2_000, failure: 'network' as const }
      : { ms: DEVICE_TIMEOUT_MS, failure: 'device_failed' as const };
  const run = async () => {
    try {
      const value = await withDeadline(lease.model.generateContent(parts), deadline.ms, deadline.failure);
      lease.done(true);
      return value;
    } catch (error) {
      lease.done(false);
      throw error;
    }
  };
  const result = await run();
  const rawText = result.response.text();
  const source: InferenceOrigin =
    result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud';

  // Second line of defense: a note that must stay on the device never gets a cloud answer.
  if ((req.isPrivate || mode === InferenceMode.ONLY_ON_DEVICE) && source !== 'on_device') {
    throw new AlRatoAiError('privacy_gate', 'A device-only request was answered by the cloud');
  }
  return { rawText, source, latencyMs: Math.round(performance.now() - started), model: source === 'on_device' ? 'gemini-nano' : cloudModel };
}

/**
 * Tries each cloud model in order. A model that is overloaded, slow or out of free requests
 * for today is skipped. A device-only request never reaches the cloud, so quotas do not apply.
 */
async function attemptWithBackups<T>(
  req: GenerateRequest<T>,
  mode: InferenceMode,
  parts: Part[],
  lang: Lang,
  local: boolean,
): Promise<Attempt> {
  const chain = modelsFor(req.task, req.deepReasoning);
  if (mode === InferenceMode.ONLY_ON_DEVICE) {
    return attempt(req, mode, parts, lang, chain[0] ?? '', local);
  }
  const models = chain.filter((model) => !isModelExhausted(model));
  if (models.length === 0) throw new WaitForRoute('cloud_cap_no_model');
  let last: AlRatoAiError | undefined;
  for (const model of models) {
    try {
      return await attempt(req, mode, parts, lang, model, local);
    } catch (error) {
      if (error instanceof WaitForRoute) throw error;
      last = classifyError(error);
      if (last.failure === 'quota_daily') {
        markModelExhausted(model);
        continue;
      }
      if (!last.transient || !navigator.onLine) throw last;
    }
  }
  if (last?.failure === 'quota_daily') throw new WaitForRoute('cloud_cap_no_model');
  throw last ?? new AlRatoAiError('config', 'no cloud model configured');
}

/** Runs one AI task through the hybrid router and returns validated data with a receipt. */
export async function generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
  const lang = getLang();
  const device = await refreshDevice(lang);
  const chain = modelsFor(req.task, req.deepReasoning);
  // Gemini Nano for this modality, or else the phone's local model, which reads text only.
  const nano: DeviceState = req.image ? device.vision : device.text;
  const local = !req.image && nano !== 'ready' && localModelReady();
  const onDevice: DeviceState = local ? 'ready' : nano;
  const decision = decideRoute({
    task: req.task,
    isPrivate: req.isPrivate,
    online: navigator.onLine,
    metered: isMeteredConnection(),
    device: onDevice,
    cloudConfigured: isCloudConfigured,
    cloudConsent: getCloudConsent(),
    cloudCapReached: (await cloudCallsToday()) >= remote().daily_cloud_cap || allModelsExhausted(chain),
    cloudPaused: isAppCheckPaused(),
    preference: getPreference(),
    inputChars: req.system.length + req.prompt.length,
    longInputChars: remote().long_input_chars,
    deepReasoning: req.deepReasoning,
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

  const deviceReady = onDevice === 'ready';

  try {
    result = await attemptWithBackups(req, mode, parts, lang, local);
  } catch (error) {
    if (error instanceof WaitForRoute) throw error;
    const failure = classifyError(error);
    if (failure.failure === 'quota_daily') throw new WaitForRoute('cloud_cap_no_model');
    if (failure.failure === 'device_failed' && mode !== InferenceMode.ONLY_ON_DEVICE && canRetryInCloud()) {
      // The SDK does not fall back when the on-device call itself fails, so we do.
      mode = InferenceMode.ONLY_IN_CLOUD;
      reason = 'device_failed_fallback';
      result = await attemptWithBackups(req, mode, parts, lang, local);
    } else if (failure.failure === 'app_check') {
      // App Check refused this browser. Pause the cloud here, and finish this note on the device when it can.
      pauseCloudForAppCheck();
      if (mode === InferenceMode.ONLY_ON_DEVICE || !deviceReady) throw failure;
      mode = InferenceMode.ONLY_ON_DEVICE;
      reason = 'no_cloud';
      result = await attempt(req, mode, parts, lang, chain[0] ?? '', local).catch((e) => {
        throw classifyError(e);
      });
    } else if (failure.transient && mode === InferenceMode.PREFER_IN_CLOUD && deviceReady) {
      // Every cloud model is down or slow, and the SDK only rescues some of those errors.
      mode = InferenceMode.ONLY_ON_DEVICE;
      reason = 'no_cloud';
      result = await attempt(req, mode, parts, lang, chain[0] ?? '', local).catch((e) => {
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
    result = await attemptWithBackups(req, mode, parts, lang, local);
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
    model: result.model,
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
