import type { LanguageModelCreateCoreOptions } from 'firebase/ai';
import type { Lang } from '../core/types';

/** State of Gemini Nano in this browser, for one set of inputs. */
export type DeviceState = 'ready' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

export interface DeviceStatus {
  text: DeviceState;
  vision: DeviceState;
  progress: number | null;
}

interface PromptApi {
  availability(options: LanguageModelCreateCoreOptions): Promise<string>;
}

const promptApi = (): PromptApi | undefined =>
  (globalThis as unknown as { LanguageModel?: PromptApi }).LanguageModel;

export const hasPromptApi = (): boolean => typeof promptApi()?.availability === 'function';

export function expectedIO(needsImage: boolean, lang: Lang): LanguageModelCreateCoreOptions {
  // System prompts are in English; notes and answers can be English or Spanish.
  const languages = lang === 'en' ? ['en', 'es'] : ['en', 'es'];
  return {
    expectedInputs: needsImage
      ? [{ type: 'text', languages }, { type: 'image' }]
      : [{ type: 'text', languages }],
    expectedOutputs: [{ type: 'text', languages: [lang] }],
  };
}

async function probe(needsImage: boolean, lang: Lang): Promise<DeviceState> {
  const api = promptApi();
  if (!api) return 'unsupported';
  try {
    const value = await api.availability(expectedIO(needsImage, lang));
    if (value === 'available') return 'ready';
    if (value === 'downloadable' || value === 'downloading') return value;
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

let status: DeviceStatus = { text: 'unsupported', vision: 'unsupported', progress: null };
const listeners = new Set<() => void>();

export const deviceStatus = (): DeviceStatus => status;

export function subscribeDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: DeviceStatus): void {
  const changed = next.text !== status.text || next.vision !== status.vision || next.progress !== status.progress;
  status = next;
  if (changed) listeners.forEach((l) => l());
}

export async function refreshDevice(lang: Lang): Promise<DeviceStatus> {
  const [text, vision] = await Promise.all([probe(false, lang), probe(true, lang)]);
  publish({ text, vision, progress: text === 'ready' ? null : status.progress });
  return status;
}

export function reportDownloadProgress(fraction: number): void {
  publish({ ...status, text: 'downloading', progress: Math.min(1, Math.max(0, fraction)) });
}

/** Whether the connection is one the student probably pays for by the megabyte. */
export function isMeteredConnection(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; type?: string } }
  ).connection;
  if (!connection) return false;
  return (
    Boolean(connection.saveData) ||
    connection.type === 'cellular' ||
    ['slow-2g', '2g', '3g'].includes(connection.effectiveType ?? '')
  );
}
