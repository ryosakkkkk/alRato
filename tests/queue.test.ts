import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestHelp } from '../src/ai/help';
import { blankCapture, deleteCapture, editLabels, editText, retryCapture, setPrivate } from '../src/core/captures';
import { setCloudConsent } from '../src/core/consent';
import { db } from '../src/core/db';
import { kickQueue, recoverInterrupted } from '../src/core/queue';
import type { Capture } from '../src/core/types';

vi.mock('../src/firebase/app', async () => {
  const { initializeApp } = await import('firebase/app');
  return {
    firebaseApp: initializeApp({ apiKey: 'test-key', projectId: 'test-project', appId: '1:1:web:2' }, 'queue-test'),
    isCloudConfigured: true,
    isFirebaseConfigured: true,
  };
});

// jsdom Blobs do not survive IndexedDB here, and these tests do not care about image bytes.
vi.mock('../src/core/image', () => ({ blobToBase64: async () => 'eA==' }));

const analysis = (title: string) =>
  JSON.stringify({
    kind: 'exercise',
    title,
    subject: 'Aprendizaje por refuerzo',
    topic: 'Bellman',
    teaches: ['ecuación de Bellman'],
    teaches_en: ['bellman equation'],
    needs_en: ['expected value'],
    needs_review: false,
  });

const cloud = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const stub = {} as Blob;
const seed = async (over: Partial<Capture> = {}) => {
  const capture = blankCapture({ image: stub, thumb: stub, text: 'V(s) = max', textBy: 'ai', ...over });
  await db.captures.add(capture);
  return capture.id;
};

async function until(check: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

let fetchMock: ReturnType<typeof vi.fn>;
let online: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await Promise.all([db.captures.clear(), db.aids.clear(), db.cards.clear(), db.usage.clear()]);
  localStorage.clear();
  setCloudConsent('granted');
  fetchMock = vi.fn(async () => cloud(analysis('Bellman')));
  vi.stubGlobal('fetch', fetchMock);
  online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  online.mockRestore();
  vi.unstubAllGlobals();
});

const status = async (id: string) => (await db.captures.get(id))?.status;

describe('capture queue', () => {
  it('organizes a queued note', async () => {
    const id = await seed();
    kickQueue();
    await until(async () => (await status(id)) === 'ready');
    const c = await db.captures.get(id);
    expect(c).toMatchObject({ kind: 'exercise', title: 'Bellman', needsKeys: ['expected value'], analyzedRevision: 1 });
    expect(c?.receipts.at(-1)?.source).toBe('in_cloud');
  });

  it('parks the note offline and resumes when the connection returns', async () => {
    online.mockReturnValue(false);
    const id = await seed();
    kickQueue();
    await until(async () => (await db.captures.get(id))?.waitReason === 'offline_no_model');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await status(id)).toBe('queued');

    online.mockReturnValue(true);
    kickQueue();
    await until(async () => (await status(id)) === 'ready');
  });

  it('never processes a private note without a local model', async () => {
    const id = await seed({ isPrivate: true });
    kickQueue();
    await until(async () => (await db.captures.get(id))?.waitReason === 'private_needs_device');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops a late answer when the student edited the text meanwhile', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    fetchMock.mockImplementation(async () => cloud(analysis('Fresh analysis')));

    const id = await seed();
    kickQueue();
    await until(async () => fetchMock.mock.calls.length === 1);
    await editText(id, 'corrected text');
    release(cloud(analysis('Stale analysis')));

    await until(async () => (await status(id)) === 'ready');
    const c = await db.captures.get(id);
    expect(c?.title).toBe('Fresh analysis');
    expect(c?.text).toBe('corrected text');
    expect(c?.revision).toBe(2);
    expect(c?.analyzedRevision).toBe(2);
  });

  it('sends nothing more to the cloud once the note is marked private mid-flight', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));

    // No text yet, so the first call reads the photo.
    const id = await seed({ text: '', textBy: 'none' });
    kickQueue();
    await until(async () => fetchMock.mock.calls.length === 1);
    await setPrivate(id, true);
    release(cloud('{"text":"transcribed in the cloud","legibility":"high"}'));

    await until(async () => (await db.captures.get(id))?.waitReason === 'private_needs_device');
    const c = await db.captures.get(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ status: 'queued', text: '', isPrivate: true });
  });

  it('never overwrites a label the student set by hand', async () => {
    const id = await seed();
    await editLabels(id, { title: 'My own title' });
    kickQueue();
    await until(async () => (await status(id)) === 'ready');
    const c = await db.captures.get(id);
    expect(c?.title).toBe('My own title');
    expect(c?.subject).toBe('Aprendizaje por refuerzo');
  });

  it('retries a rate-limited call, then stays recoverable', async () => {
    // Every backup model is rate-limited too, so the note stays queued.
    fetchMock.mockImplementation(async () => new Response('{"error":{"code":429,"message":"quota"}}', { status: 429 }));
    const id = await seed();
    kickQueue();
    await until(async () => (await db.captures.get(id))?.errorCode === 'rate_limited');
    const c = await db.captures.get(id);
    expect(c).toMatchObject({ status: 'queued', attempts: 1 });
    expect(c!.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('marks invalid output as failed and allows a manual retry', async () => {
    fetchMock.mockImplementationOnce(async () => cloud('this is not json'));
    const id = await seed();
    kickQueue();
    await until(async () => (await status(id)) === 'failed');
    expect((await db.captures.get(id))?.errorCode).toBe('invalid_output');

    await retryCapture(id);
    await until(async () => (await status(id)) === 'ready');
  });

  it('recovers notes interrupted by closing the tab', async () => {
    const id = await seed({ status: 'processing' });
    await recoverInterrupted();
    expect(await status(id)).toBe('queued');
  });

  it('removes links to a deleted note', async () => {
    const source = await seed({ status: 'ready' });
    const other = await seed({ status: 'ready' });
    await db.aids.add({
      id: 'aid',
      captureId: other,
      revision: 1,
      action: 'hint',
      level: 1,
      body: 'b',
      link: { captureId: source, why: 'w' },
      practice: null,
      receipt: {} as never,
      promptVersion: 'x',
      createdAt: 1,
    });
    await deleteCapture(source);
    expect((await db.aids.get('aid'))?.link).toBeNull();
  });
});

describe('hint requests', () => {
  const hint = (help: string) =>
    cloud(JSON.stringify({ help, source_id: '', connection: '', practice_q: 'q', practice_a: 'a' }));

  it('pays for a hint once, even when it is requested twice at the same time', async () => {
    fetchMock.mockImplementation(async () => hint('Look at what multiplies the bracket.'));
    const id = await seed({ status: 'ready', kind: 'exercise' });
    const [first, second] = await Promise.all([requestHelp(id, 1), requestHelp(id, 1)]);
    expect(first.id).toBe(second.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Asking again later reuses the stored hint.
    await requestHelp(id, 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.aids.count()).toBe(1);
  });

  it('drops a hint when the note is marked private while the model is answering', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const id = await seed({ status: 'ready', kind: 'exercise' });
    const pending = requestHelp(id, 1);
    await until(async () => fetchMock.mock.calls.length === 1);
    await setPrivate(id, true);
    release(hint('An answer that arrived too late.'));
    await expect(pending).rejects.toMatchObject({ failure: 'stale' });
    expect(await db.aids.count()).toBe(0);
  });
});
