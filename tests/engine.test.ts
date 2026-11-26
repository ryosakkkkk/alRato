import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOnDevicePossible, generate, resetModelCache, type GenerateRequest } from '../src/ai/engine';
import { WaitForRoute } from '../src/ai/errors';
import { isModelExhausted } from '../src/ai/quota';
import { isAppCheckPaused, pauseCloudForAppCheck } from '../src/ai/appcheck';
import { READ_SCHEMA } from '../src/ai/schemas';
import { validateRead, type ReadOutput } from '../src/ai/validate';
import { setCloudConsent } from '../src/core/consent';
import { db } from '../src/core/db';
import { firebaseApp } from '../src/firebase/app';

vi.mock('../src/firebase/app', async () => {
  const { initializeApp } = await import('firebase/app');
  return {
    firebaseApp: initializeApp({ apiKey: 'test-key', projectId: 'test-project', appId: '1:1:web:1' }, 'engine-test'),
    isCloudConfigured: true,
    isFirebaseConfigured: true,
  };
});

const CLOUD_JSON = '{"text":"from the cloud","legibility":"high"}';
const NANO_JSON = '{"text":"from nano","legibility":"medium"}';

function cloudResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const request = (over: Partial<GenerateRequest<ReadOutput>> = {}): GenerateRequest<ReadOutput> => ({
  task: 'analyze',
  system: 'SYSTEM PROMPT',
  prompt: 'hello note',
  schema: READ_SCHEMA,
  parse: validateRead,
  isPrivate: false,
  maxOutputTokens: 100,
  ...over,
});

function installNano(prompt: (...args: unknown[]) => Promise<string>, availability = 'available') {
  const create = vi.fn(async () => ({ prompt, destroy: vi.fn() }));
  const api = { availability: vi.fn(async () => availability), create };
  vi.stubGlobal('LanguageModel', api);
  (window as unknown as { LanguageModel: unknown }).LanguageModel = api;
  return api;
}

function removeNano() {
  vi.stubGlobal('LanguageModel', undefined);
  delete (window as unknown as { LanguageModel?: unknown }).LanguageModel;
  delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
}

let fetchMock: ReturnType<typeof vi.fn>;
let online: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await db.usage.clear();
  localStorage.clear();
  resetModelCache();
  setCloudConsent('granted');
  removeNano();
  fetchMock = vi.fn(async () => cloudResponse(CLOUD_JSON));
  vi.stubGlobal('fetch', fetchMock);
  online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  online.mockRestore();
  vi.unstubAllGlobals();
  removeNano();
});

describe('a note that turns private while its cloud request is prepared', () => {
  it('sends nothing to the cloud and reports the answer as stale', async () => {
    await expect(generate(request({ stillPublic: async () => false }))).rejects.toMatchObject({ failure: 'stale' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still uses the cloud while the note stays public', async () => {
    const result = await generate(request({ stillPublic: async () => true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data.text).toBe('from the cloud');
  });
});

describe('an App Check refusal', () => {
  it('pauses the cloud and finishes on the device when this computer can', async () => {
    installNano(async () => NANO_JSON);
    fetchMock.mockImplementation(
      async () => new Response('{"error":{"code":403,"message":"App Check token is invalid"}}', { status: 403 }),
    );
    const { data, receipt } = await generate(request());
    expect(data.text).toBe('from nano');
    expect(receipt.source).toBe('on_device');
    expect(receipt.reason).toBe('no_cloud');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes no cloud call during the pause, and waits when there is no local model', async () => {
    pauseCloudForAppCheck();
    await expect(generate(request())).rejects.toMatchObject({ reason: 'app_check_paused' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails the note and pauses the cloud when this computer cannot finish it', async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"error":{"code":403,"message":"App Check token is invalid"}}', { status: 403 }),
    );
    await expect(generate(request())).rejects.toMatchObject({ failure: 'app_check' });
    expect(isAppCheckPaused()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Firebase SDK behavior we guard against', () => {
  it('ONLY_ON_DEVICE reaches the network when the browser has no Prompt API', async () => {
    const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    const raw = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, inCloudParams: { model: 'gemini-test' } });
    await raw.generateContent('private text');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('privacy gate', () => {
  it('refuses ONLY_ON_DEVICE without the Prompt API', () => {
    expect(() => assertOnDevicePossible(InferenceMode.ONLY_ON_DEVICE)).toThrow(/Prompt API/);
  });

  it('never sends a private note to the network when there is no local model', async () => {
    await expect(generate(request({ isPrivate: true }))).rejects.toBeInstanceOf(WaitForRoute);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs a private note on the device with zero bytes sent', async () => {
    const nanoPrompt = vi.fn(async () => NANO_JSON);
    installNano(nanoPrompt);
    const { data, receipt } = await generate(request({ isPrivate: true }));
    expect(data.text).toBe('from nano');
    expect(receipt).toMatchObject({ source: 'on_device', mode: InferenceMode.ONLY_ON_DEVICE, bytesSent: 0, imageSent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry a failed private note in the cloud', async () => {
    installNano(async () => {
      throw new DOMException('nope', 'NotSupportedError');
    });
    await expect(generate(request({ isPrivate: true }))).rejects.toMatchObject({ failure: 'device_failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cloud consent', () => {
  it('sends nothing to the cloud before the student agrees', async () => {
    localStorage.clear();
    await expect(generate(request())).rejects.toMatchObject({ reason: 'needs_consent' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing to the cloud after the student declines', async () => {
    setCloudConsent('declined');
    await expect(generate(request())).rejects.toMatchObject({ reason: 'cloud_declined' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still runs on the device without consent, and does not fall back to the cloud', async () => {
    setCloudConsent('declined');
    installNano(async () => {
      throw new DOMException('model crashed', 'UnknownError');
    });
    await expect(generate(request())).rejects.toMatchObject({ failure: 'device_failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs on the device with consent undecided, with nothing sent', async () => {
    localStorage.clear();
    installNano(async () => NANO_JSON);
    const { receipt } = await generate(request({ task: 'read' }));
    expect(receipt).toMatchObject({ source: 'on_device', mode: InferenceMode.ONLY_ON_DEVICE, bytesSent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hybrid routing through the real SDK', () => {
  it('gives Gemini Nano the system prompt and the response schema', async () => {
    const nanoPrompt = vi.fn(async () => NANO_JSON);
    const api = installNano(nanoPrompt);
    await generate(request({ task: 'help' }));
    const createOptions = api.create.mock.calls[0] as unknown as [{ initialPrompts: { role: string; content: { value: string }[] }[] }];
    expect(createOptions[0].initialPrompts[0].role).toBe('system');
    expect(createOptions[0].initialPrompts[0].content[0].value).toBe('SYSTEM PROMPT');
    expect((nanoPrompt.mock.calls[0] as unknown[])[1]).toEqual({ responseConstraint: READ_SCHEMA });
  });

  it('reports the cloud as the source when there is no local model', async () => {
    const { data, receipt } = await generate(request());
    expect(data.text).toBe('from the cloud');
    expect(receipt).toMatchObject({ source: 'in_cloud', reason: 'no_local_model', imageSent: false });
    expect(receipt.bytesSent).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('works in airplane mode with a local model', async () => {
    online.mockReturnValue(false);
    installNano(async () => NANO_JSON);
    const { receipt } = await generate(request());
    expect(receipt).toMatchObject({ source: 'on_device', reason: 'offline', bytesSent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits in the queue with no model and no connection', async () => {
    online.mockReturnValue(false);
    await expect(generate(request())).rejects.toMatchObject({ reason: 'offline_no_model' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the cloud when the on-device call fails', async () => {
    installNano(async () => {
      throw new DOMException('model crashed', 'UnknownError');
    });
    const { data, receipt } = await generate(request({ task: 'help' }));
    expect(data.text).toBe('from the cloud');
    expect(receipt).toMatchObject({ source: 'in_cloud', reason: 'device_failed_fallback' });
  });

  it('retries in the cloud when Nano returns malformed output', async () => {
    installNano(async () => 'not json at all');
    const { receipt } = await generate(request());
    expect(receipt.source).toBe('in_cloud');
  });

  it('tries the next cloud model when the first is overloaded', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('{"error":{"code":500,"message":"high demand"}}', { status: 500 }),
    );
    const { data, receipt } = await generate(request());
    expect(data.text).toBe('from the cloud');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-3.5-flash-lite');
    expect(String(fetchMock.mock.calls[1][0])).toContain('gemini-3.1-flash-lite');
    expect(receipt.model).toBe('gemini-3.1-flash-lite');
  });

  it('treats a request timeout as temporary and moves to the next model', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new DOMException('Timeout has expired.', 'AbortError');
    });
    const { receipt } = await generate(request());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(receipt.model).toBe('gemini-3.1-flash-lite');
  });

  it('treats a dropped connection as temporary, so the note stays retryable', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(generate(request())).rejects.toMatchObject({ failure: 'network', transient: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not waste backup models on a permission error', async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"error":{"code":403,"message":"App Check token is invalid"}}', { status: 403 }),
    );
    await expect(generate(request())).rejects.toMatchObject({ failure: 'app_check' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finishes on the device when every cloud model times out', async () => {
    installNano(async () => NANO_JSON);
    fetchMock.mockImplementation(async () => {
      throw new DOMException('Timeout has expired.', 'AbortError');
    });
    const { data, receipt } = await generate(request({ task: 'read' }));
    expect(data.text).toBe('from nano');
    expect(receipt).toMatchObject({ source: 'on_device', reason: 'no_cloud', bytesSent: 0 });
  });

  it('explains the real route when the SDK rescues a cloud failure on the device', async () => {
    installNano(async () => NANO_JSON);
    fetchMock.mockImplementation(
      async () => new Response('{"error":{"code":503,"message":"overloaded"}}', { status: 503 }),
    );
    const { receipt } = await generate(request({ task: 'read' }));
    expect(receipt).toMatchObject({ source: 'on_device', reason: 'no_cloud' });
  });

  it('records usage so the student can see what stayed on the device', async () => {
    installNano(async () => NANO_JSON);
    await generate(request({ task: 'help' }));
    const [event] = await db.usage.toArray();
    expect(event.source).toBe('on_device');
    expect(event.bytesSent).toBe(0);
    expect(event.bytesKept).toBeGreaterThan(0);
  });

  it('stops using the cloud at the daily cap', async () => {
    await db.usage.bulkAdd(
      Array.from({ length: 80 }, () => ({
        at: Date.now(),
        task: 'help' as const,
        source: 'in_cloud' as const,
        latencyMs: 1,
        bytesSent: 1,
        bytesKept: 0,
      })),
    );
    await expect(generate(request())).rejects.toMatchObject({ reason: 'cloud_cap_no_model' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('daily quotas and backup models', () => {
  const perDayBody = JSON.stringify({
    error: {
      code: 429,
      message: 'Quota exceeded for metric: generate_content_free_tier_requests',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '500' }],
        },
      ],
    },
  });

  it('moves to a backup model after a daily quota error, and stops asking the exhausted model', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(perDayBody, { status: 429 }));
    const { receipt } = await generate(request());
    expect(receipt.model).toBe('gemini-3.1-flash-lite');
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-3.5-flash-lite');
    expect(String(fetchMock.mock.calls[1][0])).toContain('gemini-3.1-flash-lite');
    expect(isModelExhausted('gemini-3.5-flash-lite')).toBe(true);

    fetchMock.mockClear();
    const second = await generate(request());
    expect(second.receipt.model).toBe('gemini-3.1-flash-lite');
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-3.1-flash-lite');
  });

  it('waits for tomorrow when every cloud model is out for the day', async () => {
    fetchMock.mockImplementation(async () => new Response(perDayBody, { status: 429 }));
    await expect(generate(request())).rejects.toMatchObject({ reason: 'cloud_cap_no_model' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('answers on the device when every cloud model is out for the day', async () => {
    const until = Date.now() + 3_600_000;
    localStorage.setItem(
      'alrato.cloudQuotaOut.v1',
      JSON.stringify({ 'gemini-3.5-flash-lite': until, 'gemini-3.1-flash-lite': until, 'gemini-3.8-flash': until }),
    );
    installNano(async () => NANO_JSON);
    const { receipt } = await generate(request());
    expect(receipt).toMatchObject({ source: 'on_device', reason: 'cloud_cap', bytesSent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a private note on the device even when the cloud quota is gone', async () => {
    const until = Date.now() + 3_600_000;
    localStorage.setItem(
      'alrato.cloudQuotaOut.v1',
      JSON.stringify({ 'gemini-3.5-flash-lite': until, 'gemini-3.1-flash-lite': until, 'gemini-3.8-flash': until }),
    );
    installNano(async () => NANO_JSON);
    const { receipt } = await generate(request({ isPrivate: true }));
    expect(receipt).toMatchObject({ source: 'on_device', bytesSent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('on-device sessions', () => {
  it('reuses one on-device model for repeated requests, so each previous session is destroyed', async () => {
    const destroy = vi.fn();
    const create = vi.fn(async () => ({ prompt: vi.fn(async () => NANO_JSON), destroy }));
    const api = { availability: vi.fn(async () => 'available'), create };
    vi.stubGlobal('LanguageModel', api);
    (window as unknown as { LanguageModel: unknown }).LanguageModel = api;
    for (let i = 0; i < 3; i += 1) {
      await generate(request({ isPrivate: true }));
    }
    expect(create).toHaveBeenCalledTimes(3);
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
