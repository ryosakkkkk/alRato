import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { AlRatoAiError } from './errors';

/*
 * The local model for phones. Chrome's built-in Gemini Nano (Firebase AI Logic's on-device side)
 * only runs on desktop Chrome, so on a phone alRato can run a small open model on the phone's own
 * GPU through WebGPU (WebLLM). The student downloads it once, on purpose; after that, hints work
 * offline and private notes never need the cloud. It only handles text: reading a photo still
 * needs a vision model, on the device or in the cloud.
 */

export interface LocalOption {
  id: string;
  /** What the student sees. */
  label: string;
  maker: string;
  sizeMB: number;
  /** The weights use 16-bit floats, which not every phone GPU can run. */
  needsF16: boolean;
}

/** Best first. Gemma is Google's open model; Qwen is the lighter choice for GPUs without 16-bit floats. */
export const LOCAL_MODELS: LocalOption[] = [
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B', maker: 'Google', sizeMB: 602, needsF16: true },
  { id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', label: 'Qwen2.5 0.5B', maker: 'Alibaba', sizeMB: 290, needsF16: false },
];

export type LocalState = 'checking' | 'unsupported' | 'available' | 'downloading' | 'ready' | 'failed';

export interface LocalStatus {
  state: LocalState;
  /** 0 to 1 while downloading. */
  progress: number | null;
  /** The model that is downloaded, or being downloaded. */
  modelId: string | null;
  label: string;
  /** The models this device can run. */
  options: LocalOption[];
}

const KEY = 'alrato.localModel';

const savedId = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const labelOf = (id: string | null) => LOCAL_MODELS.find((m) => m.id === id)?.label ?? '';

let status: LocalStatus = { state: 'checking', progress: null, modelId: savedId(), label: labelOf(savedId()), options: [] };
const listeners = new Set<() => void>();

export const localStatus = (): LocalStatus => status;

export function subscribeLocal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: Partial<LocalStatus>): void {
  status = { ...status, ...next };
  status.label = labelOf(status.modelId);
  listeners.forEach((listener) => listener());
}

interface GpuLike {
  requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null>;
}

let checked: Promise<LocalStatus> | null = null;

/** Finds out once whether this device has WebGPU, and which local models it can run. */
export function checkLocalModel(): Promise<LocalStatus> {
  checked ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
    if (!adapter) {
      publish({ state: 'unsupported', options: [] });
      return status;
    }
    const f16 = adapter.features.has('shader-f16');
    const options = LOCAL_MODELS.filter((m) => !m.needsF16 || f16);
    const saved = savedId();
    const kept = saved && options.some((m) => m.id === saved) ? saved : null;
    publish({ state: options.length === 0 ? 'unsupported' : kept ? 'ready' : 'available', options, modelId: kept });
    return status;
  })();
  return checked;
}

/** True when a downloaded local model can take a text task right now. */
export const localModelReady = (): boolean => status.state === 'ready' && Boolean(status.modelId);

let engine: MLCEngineInterface | null = null;
let engineId: string | null = null;
let loading: Promise<MLCEngineInterface> | null = null;

/** Loads the model into the GPU. The first time it downloads it; later it comes from the browser's cache. */
function loadEngine(modelId: string, onProgress?: (fraction: number) => void): Promise<MLCEngineInterface> {
  if (engine && engineId === modelId) return Promise.resolve(engine);
  loading ??= (async () => {
    const webllm = await import('@mlc-ai/web-llm');
    const loaded = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => onProgress?.(report.progress),
    });
    engine = loaded;
    engineId = modelId;
    return loaded;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Downloads a local model. Called only from a button the student pressed, with the size shown. */
export async function downloadLocalModel(modelId: string): Promise<void> {
  publish({ state: 'downloading', progress: 0, modelId });
  try {
    await loadEngine(modelId, (fraction) => publish({ progress: Math.min(1, Math.max(0, fraction)) }));
    localStorage.setItem(KEY, modelId);
    publish({ state: 'ready', progress: null, modelId });
  } catch (error) {
    publish({ state: 'failed', progress: null, modelId: null });
    throw error;
  }
}

/** Frees the space the model takes. */
export async function removeLocalModel(): Promise<void> {
  const id = status.modelId;
  await engine?.unload().catch(() => undefined);
  engine = null;
  engineId = null;
  localStorage.removeItem(KEY);
  if (id) {
    const webllm = await import('@mlc-ai/web-llm');
    await webllm.deleteModelAllInfoInCache(id).catch(() => undefined);
  }
  publish({ state: status.options.length > 0 ? 'available' : 'unsupported', modelId: null, progress: null });
}

/** The id that goes on a receipt for an answer made by the local model. */
export const localReceiptModel = (): string => `${labelOf(status.modelId).toLowerCase().replace(/\s+/g, '-')}-webgpu`;

export interface LocalRequest {
  system: string;
  prompt: string;
  schema: object;
  maxTokens: number;
  temperature: number;
}

/**
 * One text task on the local model, constrained to the same JSON Schema the cloud and Gemini Nano
 * get, so every route returns the same shape. Small models follow a schema far better when the
 * grammar enforces it than when they are only asked to.
 */
export async function localGenerate(req: LocalRequest): Promise<string> {
  const id = status.modelId;
  if (!id || status.state !== 'ready') throw new AlRatoAiError('device_failed', 'no local model');
  try {
    const model = await loadEngine(id);
    // Some small models have no system role, so the instructions lead the user message instead.
    const reply = await model.chat.completions.create({
      messages: [{ role: 'user', content: `${req.system}\n\n${req.prompt}` }],
      response_format: { type: 'json_object', schema: JSON.stringify(req.schema) },
      max_tokens: Math.min(req.maxTokens, 1024),
      temperature: req.temperature,
    });
    const text = reply.choices[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('empty');
    return text;
  } catch (error) {
    throw error instanceof AlRatoAiError ? error : new AlRatoAiError('device_failed', String(error));
  }
}
