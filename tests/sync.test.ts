// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blankCapture,
  deleteCapture,
  editLabels,
  editText,
  setPrivate,
  SYNC_ATTEMPTED,
  SYNC_OUTBOX_KEY,
  SYNC_OWNER_KEY,
  SYNC_REMOVED,
  type CloudDelete,
} from '../src/core/captures';
import { setCloudConsent } from '../src/core/consent';
import { db, kvGet, kvSet } from '../src/core/db';
import type { Capture, Receipt } from '../src/core/types';
import { RC_DEFAULTS } from '../src/firebase/remoteConfig';
import {
  decideMerge,
  documentBytes,
  fitBlob,
  fitPhotos,
  isSyncable,
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_CHARS,
  MAX_THUMB_BYTES,
  mergeRemote,
  NoteTooLargeError,
  parseNote,
  PrivateNoteError,
  serializeNote,
  SyncEngine,
  type Cursor,
  type NoteBlobs,
  type NoteFields,
  type Page,
  type RemoteHandlers,
  type RemoteNote,
  type RemoteStore,
  type RemoteTombstone,
} from '../src/firebase/sync';

vi.mock('../src/firebase/app', async () => {
  const { initializeApp } = await import('firebase/app');
  return {
    firebaseApp: initializeApp({ apiKey: 'test-key', projectId: 'test-project', appId: '1:1:web:3' }, 'sync-test'),
    isCloudConfigured: true,
    isFirebaseConfigured: true,
  };
});

const UID = 'student-a';
const SECRET = 'MY-PRIVATE-EXAM-ANSWERS';

const photo = (size = 16) => new Blob([new Uint8Array(size).fill(7)], { type: 'image/jpeg' });

const note = (over: Partial<Capture> = {}): Capture =>
  blankCapture({ image: photo(), thumb: photo(), text: 'V(s) = max', textBy: 'ai', status: 'ready', ...over });

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });
const notFound = () => Object.assign(new Error('missing'), { code: 'not-found' });

/** An in-memory server that behaves like our security rules. */
class FakeCloud implements RemoteStore {
  notes = new Map<string, RemoteNote>();
  marks = new Map<string, RemoteTombstone>();
  /** Everything that was ever sent to this server. */
  received: { fields: NoteFields; blobs: NoteBlobs | null }[] = [];
  removals: string[] = [];
  beforePut: ((fields: NoteFields) => Promise<void> | void) | null = null;
  failNextPut: unknown = null;
  private clock = 10_000;
  private handlers: RemoteHandlers[] = [];

  async put(fields: NoteFields, blobs: NoteBlobs | null, { revive }: { revive: boolean }) {
    await this.beforePut?.(fields);
    if (this.failNextPut) {
      const failure = this.failNextPut;
      this.failNextPut = null;
      throw failure;
    }
    this.received.push({ fields, blobs });
    const existing = this.notes.get(fields.id);
    if (!blobs) {
      if (!existing) throw notFound();
      if (fields.updatedAt < existing.fields.updatedAt) throw denied();
      this.notes.set(fields.id, { fields, blobs: existing.blobs, at: ++this.clock });
      return;
    }
    if (existing && fields.updatedAt < existing.fields.updatedAt) throw denied();
    if (!existing && this.marks.has(fields.id) && !revive) throw denied();
    if (revive) this.marks.delete(fields.id);
    this.notes.set(fields.id, { fields, blobs, at: ++this.clock });
  }

  async remove(ids: string[], options: { wiped?: boolean } = {}) {
    for (const id of ids) {
      this.removals.push(id);
      this.notes.delete(id);
      this.marks.set(id, { id, wiped: Boolean(options.wiped), at: ++this.clock });
    }
  }

  async pageNotes(sinceMs: number): Promise<Page<RemoteNote>> {
    return { items: [...this.notes.values()].filter((n) => n.at >= sinceMs), next: null };
  }

  async pageTombstones(sinceMs: number): Promise<Page<RemoteTombstone>> {
    return { items: [...this.marks.values()].filter((m) => m.at >= sinceMs), next: null };
  }

  watch(_cursor: Cursor, handlers: RemoteHandlers) {
    this.handlers.push(handlers);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handlers);
    };
  }

  emitNote(item: RemoteNote) {
    this.handlers.forEach((h) => h.onNotes([item]));
  }

  async readNote(id: string) {
    return this.notes.get(id) ?? null;
  }

  async readTombstone(id: string) {
    return this.marks.get(id) ?? null;
  }

  async listNoteIds(max: number) {
    return [...this.notes.keys()].slice(0, max);
  }

  /** A write made by another device, straight into the cloud. */
  seed(capture: Capture) {
    const item: RemoteNote = {
      fields: serializeNote(capture),
      blobs: { image: new Uint8Array([1, 2, 3]), thumb: new Uint8Array([4, 5]) },
      at: ++this.clock,
    };
    this.notes.set(capture.id, item);
    return item;
  }
}

function engineFor(cloud: RemoteStore, over: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) {
  return new SyncEngine({ uid: UID, enabled: true, getRemote: async () => cloud, ...over });
}

/** The parts of the browser the sync engine and the queue read. */
const browser = { onLine: true, language: 'en' };

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
}

let cloud: FakeCloud;
let engines: SyncEngine[];

function track(engine: SyncEngine) {
  engines.push(engine);
  return engine;
}

beforeEach(async () => {
  vi.stubGlobal('navigator', browser);
  vi.stubGlobal('localStorage', memoryStorage());
  browser.onLine = true;
  await Promise.all([db.captures.clear(), db.aids.clear(), db.cards.clear(), db.usage.clear(), db.kv.clear()]);
  await kvSet(SYNC_OWNER_KEY, UID);
  cloud = new FakeCloud();
  engines = [];
  // No AI in these tests unless one asks for it: the queue parks anything it finds.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
});

afterEach(() => {
  engines.forEach((engine) => engine.stop());
  vi.unstubAllGlobals();
});

const everythingSent = () => JSON.stringify(cloud.received.map((r) => r.fields));

describe('a private note can never be serialized', () => {
  it('refuses to serialize a private note', () => {
    expect(() => serializeNote(note({ isPrivate: true, text: SECRET }))).toThrow(PrivateNoteError);
  });

  it('fails closed on a row with no privacy flag', () => {
    const malformed = note() as Partial<Capture>;
    delete malformed.isPrivate;
    expect(() => serializeNote(malformed as Capture)).toThrow(PrivateNoteError);
    expect(isSyncable(malformed as Capture)).toBe(false);
  });

  it('refuses every truthy spelling of private', () => {
    for (const value of [true, 1, 'true', {}] as unknown[]) {
      expect(() => serializeNote(note({ isPrivate: value as boolean }))).toThrow(PrivateNoteError);
      expect(isSyncable(note({ isPrivate: value as boolean }))).toBe(false);
    }
  });

  it('sends only an explicit list of fields, never device data', () => {
    const receipt = { task: 'read', source: 'on_device' } as unknown as Receipt;
    const fields = serializeNote(
      note({ receipts: [receipt], waitReason: 'cloud_unavailable', errorCode: 'network', attempts: 3, nextAttemptAt: 9, syncedAt: 5 }),
    );
    expect(Object.keys(fields).sort()).toEqual(
      [
        'analyzedRevision', 'comment', 'createdAt', 'id', 'isPrivate', 'isSample', 'kind', 'legibility', 'locked',
        'needsKeys', 'revision', 'schema', 'status', 'subject', 'teaches', 'teachesKeys', 'text', 'textBy', 'title',
        'topic', 'updatedAt',
      ].sort(),
    );
    expect(fields.isPrivate).toBe(false);
  });

  it('a new local field cannot leak by accident', () => {
    const fields = serializeNote({ ...note(), futureSecret: SECRET } as Capture);
    expect(JSON.stringify(fields)).not.toContain(SECRET);
  });

  it('turns device-only states into a waiting note another device can pick up', () => {
    expect(serializeNote(note({ status: 'processing' })).status).toBe('queued');
    expect(serializeNote(note({ status: 'failed' })).status).toBe('queued');
    expect(serializeNote(note({ status: 'needs_review' })).status).toBe('needs_review');
  });

  it('never accepts a cloud document marked private', () => {
    const fields = serializeNote(note());
    expect(parseNote(fields.id, { ...fields })).not.toBeNull();
    expect(parseNote(fields.id, { ...fields, isPrivate: true })).toBeNull();
    expect(parseNote(fields.id, { ...fields, isPrivate: undefined })).toBeNull();
  });

  it('ignores malformed cloud documents', () => {
    const fields = serializeNote(note());
    expect(parseNote('other-id', { ...fields })).toBeNull();
    expect(parseNote(fields.id, { ...fields, schema: 99 })).toBeNull();
    expect(parseNote(fields.id, { ...fields, status: 'processing' })).toBeNull();
    expect(parseNote(fields.id, { ...fields, teaches: [1, 2] })).toBeNull();
    expect(parseNote(fields.id, { ...fields, updatedAt: 'yesterday' })).toBeNull();
  });
});

describe('private notes in the sync engine', () => {
  it('never uploads a private note, however many cycles run', async () => {
    const secret = note({ isPrivate: true, text: SECRET, comment: SECRET, title: SECRET });
    const open = note({ text: 'public note' });
    await db.captures.bulkAdd([secret, open]);

    const engine = track(engineFor(cloud));
    for (let i = 0; i < 3; i += 1) await engine.sync();

    expect(cloud.notes.has(open.id)).toBe(true);
    expect(cloud.notes.has(secret.id)).toBe(false);
    expect(everythingSent()).not.toContain(SECRET);
  });

  it('deletes the cloud copy when a synced note becomes private', async () => {
    const shared = note();
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();
    expect(cloud.notes.has(shared.id)).toBe(true);

    await setPrivate(shared.id, true);
    await engine.sync();

    expect(cloud.notes.has(shared.id)).toBe(false);
    expect(cloud.marks.has(shared.id)).toBe(true);
    const local = await db.captures.get(shared.id);
    expect(local).toMatchObject({ isPrivate: true, syncedAt: SYNC_REMOVED });
    expect(await kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, [])).toEqual([]);
  });

  it('keeps the promise to delete across being offline and a restart', async () => {
    const shared = note();
    await db.captures.add(shared);
    await track(engineFor(cloud)).sync();

    browser.onLine = false;
    await setPrivate(shared.id, true);
    const offline = track(engineFor(cloud));
    await offline.sync();
    expect(cloud.notes.has(shared.id)).toBe(true);
    offline.stop();

    browser.onLine = true;
    await track(engineFor(cloud)).sync();
    expect(cloud.notes.has(shared.id)).toBe(false);
  });

  it('deletes the copy even if the note turned private during its upload', async () => {
    const shared = note();
    await db.captures.add(shared);
    cloud.beforePut = async () => {
      cloud.beforePut = null;
      await setPrivate(shared.id, true);
    };
    const engine = track(engineFor(cloud));
    await engine.sync();
    await engine.sync();

    expect(cloud.notes.has(shared.id)).toBe(false);
    expect((await db.captures.get(shared.id))?.isPrivate).toBe(true);
  });

  it('does not upload a note that turned private while its photo was compressing', async () => {
    const shared = note({ image: photo(MAX_IMAGE_BYTES + 10) });
    await db.captures.add(shared);
    const compress = vi.fn(async () => {
      await setPrivate(shared.id, true);
      return photo(100);
    });
    const engine = track(engineFor(cloud, { compress }));
    await engine.sync();
    await engine.sync();

    expect(compress).toHaveBeenCalled();
    expect(cloud.received).toHaveLength(0);
    expect(cloud.notes.has(shared.id)).toBe(false);
  });

  it('deletes a note made private before its first upload finished', async () => {
    const fresh = note();
    await db.captures.add(fresh);
    // Simulates a crash after the upload started but before it was confirmed.
    await db.captures.update(fresh.id, { syncedAt: SYNC_ATTEMPTED });
    cloud.seed(fresh);

    await setPrivate(fresh.id, true);
    await track(engineFor(cloud)).sync();
    expect(cloud.notes.has(fresh.id)).toBe(false);
  });

  it('does not touch the outbox for a note that never reached the cloud', async () => {
    const localOnly = note();
    await db.captures.add(localOnly);
    await setPrivate(localOnly.id, true);
    expect(await kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, [])).toEqual([]);
    await track(engineFor(cloud)).sync();
    expect(cloud.removals).toEqual([]);
  });

  it('a remote version never overwrites a note that is private here', async () => {
    const mine = note({ isPrivate: true, text: 'kept here' });
    await db.captures.add(mine);
    const remote = serializeNote({ ...mine, isPrivate: false, text: 'from the cloud', updatedAt: mine.updatedAt + 1000 });
    expect(decideMerge(mine, remote)).toBe('keep');

    cloud.notes.set(mine.id, { fields: remote, blobs: { image: new Uint8Array([1]), thumb: new Uint8Array([2]) }, at: 99_999 });
    await track(engineFor(cloud)).sync();
    expect(await db.captures.get(mine.id)).toMatchObject({ isPrivate: true, text: 'kept here' });
  });

  it('shares a note again only when the student chooses to', async () => {
    const shared = note();
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();
    await setPrivate(shared.id, true);
    await engine.sync();
    expect(cloud.marks.has(shared.id)).toBe(true);

    await setPrivate(shared.id, false);
    await engine.sync();

    expect(cloud.notes.has(shared.id)).toBe(true);
    expect(cloud.marks.has(shared.id)).toBe(false);
    const again = cloud.received.at(-1)!;
    expect(again.blobs).not.toBeNull();
  });

  it('cancels a pending delete if the note is shared again before it ran', async () => {
    const shared = note();
    await db.captures.add(shared);
    await track(engineFor(cloud)).sync();

    await setPrivate(shared.id, true);
    await setPrivate(shared.id, false);
    expect(await kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, [])).toEqual([]);

    await track(engineFor(cloud)).sync();
    expect(cloud.removals).toEqual([]);
    expect(cloud.notes.has(shared.id)).toBe(true);
  });
});

describe('deleting a note', () => {
  it('deletes its cloud copy', async () => {
    const shared = note();
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();

    await deleteCapture(shared.id);
    await engine.sync();

    expect(cloud.notes.has(shared.id)).toBe(false);
    expect(cloud.marks.has(shared.id)).toBe(true);
    expect(await db.captures.get(shared.id)).toBeUndefined();
  });

  it('still deletes the cloud copy while sync is switched off', async () => {
    const shared = note();
    await db.captures.add(shared);
    await track(engineFor(cloud)).sync();

    const switchedOff = track(engineFor(cloud, { enabled: false }));
    await deleteCapture(shared.id);
    await switchedOff.sync();

    expect(cloud.notes.has(shared.id)).toBe(false);
    expect(cloud.received).toHaveLength(1);
  });

  it('waits for the right account before deleting', async () => {
    const shared = note();
    await db.captures.add(shared);
    await track(engineFor(cloud)).sync();
    await deleteCapture(shared.id);

    const otherAccount = new FakeCloud();
    await track(engineFor(otherAccount, { uid: 'student-b' })).sync();
    expect(otherAccount.removals).toEqual([]);
    expect(await kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, [])).toHaveLength(1);

    await track(engineFor(cloud)).sync();
    expect(cloud.notes.has(shared.id)).toBe(false);
  });

  it('does not bring back a note deleted here while the delete is pending', async () => {
    const shared = note();
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();
    const inCloud = cloud.notes.get(shared.id)!;

    browser.onLine = false;
    await deleteCapture(shared.id);
    browser.onLine = true;
    cloud.emitNote(inCloud);
    await engine.sync();

    expect(await db.captures.get(shared.id)).toBeUndefined();
    expect(cloud.notes.has(shared.id)).toBe(false);
  });
});

describe('two devices', () => {
  class Laptop extends Dexie {
    captures!: Dexie.Table<Capture, string>;
    aids!: Dexie.Table<never, string>;
    cards!: Dexie.Table<never, string>;
    usage!: Dexie.Table<never, number>;
    kv!: Dexie.Table<{ key: string; value: unknown }, string>;

    constructor() {
      super(`laptop-${Math.random()}`);
      this.version(1).stores({
        captures: 'id, status, createdAt, updatedAt, subject, nextAttemptAt',
        aids: 'id, captureId, [captureId+revision], createdAt',
        cards: 'id, captureId, dueAt',
        usage: '++id, at, source, task',
        kv: 'key',
      });
    }
  }

  let laptop: Laptop;
  const laptopEngine = (over: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) =>
    track(engineFor(cloud, { database: laptop as unknown as typeof db, ...over }));

  beforeEach(() => {
    laptop = new Laptop();
  });

  afterEach(async () => {
    laptop.close();
    await Dexie.delete(laptop.name);
  });

  it('moves a note and its photo from the phone to the laptop', async () => {
    const shared = note({ image: photo(1234), thumb: photo(55) });
    await db.captures.add(shared);
    await track(engineFor(cloud)).sync();
    await laptopEngine().sync();

    const copy = await laptop.captures.get(shared.id);
    expect(copy).toMatchObject({ text: shared.text, syncedAt: shared.updatedAt, isPrivate: false });
    expect(copy!.image.size).toBe(1234);
    expect(copy!.thumb.size).toBe(55);
  });

  it('a stale device cannot bring back a note made private elsewhere', async () => {
    const shared = note({ text: SECRET });
    await db.captures.add(shared);
    const phone = track(engineFor(cloud));
    await phone.sync();
    const laptopSide = laptopEngine();
    await laptopSide.sync();
    expect(await laptop.captures.get(shared.id)).toBeDefined();

    await setPrivate(shared.id, true);
    await phone.sync();
    const sentBefore = cloud.received.length;

    await laptopSide.sync();
    await laptopEngine().sync();

    expect(await laptop.captures.get(shared.id)).toBeUndefined();
    expect(cloud.notes.has(shared.id)).toBe(false);
    expect(cloud.received).toHaveLength(sentBefore);
  });

  it('removes the copy before pushing, even for a device that was offline', async () => {
    const shared = note();
    await db.captures.add(shared);
    const phone = track(engineFor(cloud));
    await phone.sync();
    await laptopEngine().sync();

    // The laptop edits it offline, while the phone marks it private.
    await laptop.captures.update(shared.id, { text: 'edited offline', updatedAt: shared.updatedAt + 5000 });
    await setPrivate(shared.id, true);
    await phone.sync();

    await laptopEngine().sync();

    // The work survives, but only on the laptop, and it can never go back up.
    const kept = await laptop.captures.get(shared.id);
    expect(kept).toMatchObject({ text: 'edited offline', isPrivate: true, syncedAt: SYNC_REMOVED });
    expect(cloud.notes.has(shared.id)).toBe(false);
    expect(everythingSent()).not.toContain('edited offline');
  });

  it('if the delete lands mid-push, the server refusal settles it safely', async () => {
    const shared = note();
    await db.captures.add(shared);
    const phone = track(engineFor(cloud));
    await phone.sync();
    const laptopSide = laptopEngine();
    await laptopSide.sync();

    await laptop.captures.update(shared.id, { text: 'late edit', updatedAt: shared.updatedAt + 5000 });
    await setPrivate(shared.id, true);
    await phone.sync();
    // The laptop is already caught up, so its live listener has not delivered the tombstone yet.
    await laptopSide.sync();

    expect(cloud.notes.has(shared.id)).toBe(false);
    expect(await laptop.captures.get(shared.id)).toMatchObject({ isPrivate: true, syncedAt: SYNC_REMOVED });
  });

  it('a deletion reaches the other device', async () => {
    const shared = note();
    await db.captures.add(shared);
    const phone = track(engineFor(cloud));
    await phone.sync();
    await laptopEngine().sync();

    await deleteCapture(shared.id);
    await phone.sync();
    await laptopEngine().sync();

    expect(await laptop.captures.get(shared.id)).toBeUndefined();
  });

  it('a note shared again comes back on the other device', async () => {
    const shared = note();
    await db.captures.add(shared);
    const phone = track(engineFor(cloud));
    await phone.sync();
    await laptopEngine().sync();

    await setPrivate(shared.id, true);
    await phone.sync();
    await laptopEngine().sync();
    expect(await laptop.captures.get(shared.id)).toBeUndefined();

    await setPrivate(shared.id, false);
    await phone.sync();
    await laptopEngine().sync();
    expect(await laptop.captures.get(shared.id)).toMatchObject({ isPrivate: false });
  });

  it('ignores a stale tombstone for a note that was shared again', async () => {
    const shared = note();
    await db.captures.add(shared);
    const phone = track(engineFor(cloud));
    await phone.sync();
    const laptopSide = laptopEngine();
    await laptopSide.sync();

    const staleMark: RemoteTombstone = { id: shared.id, wiped: false, at: 1 };
    const handlers = (cloud as unknown as { handlers: RemoteHandlers[] }).handlers;
    handlers.forEach((h) => h.onTombstones([staleMark]));
    await laptopSide.sync();

    expect(await laptop.captures.get(shared.id)).toBeDefined();
  });

  it('wiping the cloud stops the other device without touching its notes', async () => {
    const shared = note();
    await db.captures.add(shared);
    await track(engineFor(cloud)).sync();
    await laptopEngine().sync();

    await cloud.remove([shared.id], { wiped: true });
    const onWipedElsewhere = vi.fn();
    await laptopEngine({ onWipedElsewhere }).sync();

    expect(onWipedElsewhere).toHaveBeenCalledTimes(1);
    expect(await laptop.captures.get(shared.id)).toMatchObject({ text: shared.text, syncedAt: SYNC_REMOVED });
    expect(cloud.notes.size).toBe(0);
  });

  it('turning sync back on after a wipe uploads the notes again', async () => {
    const shared = note();
    await db.captures.add(shared);
    await db.captures.update(shared.id, { syncedAt: SYNC_REMOVED });
    cloud.marks.set(shared.id, { id: shared.id, wiped: true, at: 5 });

    await track(engineFor(cloud)).sync();

    expect(cloud.notes.has(shared.id)).toBe(true);
    expect(cloud.marks.has(shared.id)).toBe(false);
  });
});

describe('last writer wins', () => {
  const remoteVersion = (base: Capture, over: Partial<Capture>) => serializeNote({ ...base, ...over });

  it('applies a newer version and ignores an older one', () => {
    const local = note({ updatedAt: 2000, createdAt: 1000 });
    expect(decideMerge(local, remoteVersion(local, { updatedAt: 3000, text: 'newer' }))).toBe('apply');
    expect(decideMerge(local, remoteVersion(local, { updatedAt: 1000, text: 'older' }))).toBe('keep');
  });

  it('treats its own echo as the same version', () => {
    const local = note({ status: 'processing' });
    expect(decideMerge(local, serializeNote(local))).toBe('mark_clean');
  });

  it('settles a same-millisecond conflict on the cloud version', () => {
    const local = note();
    expect(decideMerge(local, remoteVersion(local, { text: 'other device' }))).toBe('apply');
  });

  it('writes nothing when nothing changed', async () => {
    const shared = note();
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();
    await engine.sync();
    await engine.sync();
    expect(cloud.received).toHaveLength(1);
  });

  it('sends the photo once, then only metadata', async () => {
    const shared = note();
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();
    await editLabels(shared.id, { title: 'New title' });
    await engine.sync();

    expect(cloud.received).toHaveLength(2);
    expect(cloud.received[0].blobs).not.toBeNull();
    expect(cloud.received[1].blobs).toBeNull();
    expect(cloud.notes.get(shared.id)?.fields.title).toBe('New title');
  });

  it('adopts a newer cloud version when the server refuses a stale write', async () => {
    const shared = note({ updatedAt: 5000, createdAt: 1000 });
    await db.captures.add(shared);
    const engine = track(engineFor(cloud));
    await engine.sync();

    cloud.seed({ ...shared, updatedAt: 9000, text: 'written elsewhere' });
    await db.captures.update(shared.id, { text: 'stale edit', updatedAt: 7000 });
    await engine.sync();

    expect(await db.captures.get(shared.id)).toMatchObject({ text: 'written elsewhere', updatedAt: 9000, syncedAt: 9000 });
  });

  it('does not retry forever a version the server refuses', async () => {
    const shared = note();
    await db.captures.add(shared);
    cloud.failNextPut = denied();
    const put = vi.spyOn(cloud, 'put');
    const engine = track(engineFor(cloud));
    await engine.sync();
    const calls = put.mock.calls.length;
    await engine.sync();
    await engine.sync();
    expect(put.mock.calls.length).toBe(calls);

    await editText(shared.id, 'fixed text');
    await db.captures.update(shared.id, { status: 'ready' });
    await engine.sync();
    expect(cloud.notes.get(shared.id)?.fields.text).toBe('fixed text');
  });

  it('retries a transient failure', async () => {
    const shared = note();
    await db.captures.add(shared);
    cloud.failNextPut = Object.assign(new Error('down'), { code: 'unavailable' });
    const phases: string[] = [];
    const engine = track(engineFor(cloud, { onPhase: (phase) => phases.push(phase) }));
    await engine.sync();
    expect(phases.at(-1)).toBe('offline');
    await engine.sync();
    expect(cloud.notes.has(shared.id)).toBe(true);
    expect(phases.at(-1)).toBe('synced');
  });

  it('keeps device-only data and the sharper original photo on merge', () => {
    const receipt = { task: 'read', source: 'on_device', at: 1 } as unknown as Receipt;
    const original = photo(999);
    const local = note({ receipts: [receipt], image: original });
    const remote = remoteVersion(local, { updatedAt: local.updatedAt + 1, title: 'From laptop' });
    const merged = mergeRemote(local, remote, { image: photo(10), thumb: photo(10) });

    expect(merged.receipts).toEqual([receipt]);
    expect(merged.image).toBe(original);
    expect(merged.title).toBe('From laptop');
    expect(merged.syncedAt).toBe(remote.updatedAt);
  });

  it('a changed text gets a new revision, so a late AI answer is dropped', () => {
    const local = note({ revision: 4, analyzedRevision: 4 });
    const remote = remoteVersion(local, { text: 'edited elsewhere', revision: 2, analyzedRevision: 2, updatedAt: local.updatedAt + 1 });
    const merged = mergeRemote(local, remote, { image: photo(), thumb: photo() });
    expect(merged.revision).toBe(5);
    expect(merged.analyzedRevision).toBe(5);
  });

  it('keeps a running AI task when only labels changed elsewhere', () => {
    const local = note({ status: 'processing', revision: 2 });
    const remote = remoteVersion(local, { status: 'queued', title: 'label', updatedAt: local.updatedAt + 1 });
    expect(mergeRemote(local, remote, { image: photo(), thumb: photo() }).status).toBe('processing');
  });
});

describe('notes from another device join the queue', () => {
  const analysis = JSON.stringify({
    kind: 'exercise',
    title: 'Bellman',
    subject: 'Reinforcement learning',
    topic: 'Bellman',
    teaches: ['Bellman equation'],
    teaches_en: ['bellman equation'],
    needs_en: ['expected value'],
    needs_review: false,
  });

  it('processes a queued note pulled from the phone, then syncs the result back', async () => {
    setCloudConsent('granted');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: analysis }] }, finishReason: 'STOP' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const fromPhone = note({ status: 'queued', title: '', createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000 });
    cloud.seed(fromPhone);

    const engine = track(engineFor(cloud));
    await engine.sync();

    const end = Date.now() + 3000;
    while (Date.now() < end && (await db.captures.get(fromPhone.id))?.status !== 'ready') {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await db.captures.get(fromPhone.id))?.status).toBe('ready');

    await engine.sync();
    expect(cloud.notes.get(fromPhone.id)?.fields).toMatchObject({ status: 'ready', title: 'Bellman' });
  });

  it('does not upload a note while this device is still working on it', async () => {
    const busy = note({ status: 'processing' });
    await db.captures.add(busy);
    await track(engineFor(cloud)).sync();
    expect(cloud.received).toHaveLength(0);
  });
});

describe('document size', () => {
  it('sends photos untouched when they fit', async () => {
    const compress = vi.fn();
    const bytes = await fitBlob(photo(1000), 2000, [[100, 0.5]], compress);
    expect(bytes.length).toBe(1000);
    expect(compress).not.toHaveBeenCalled();
  });

  it('recompresses step by step until the photo fits', async () => {
    const sizes = [5000, 3000, 900];
    const compress = vi.fn(async () => photo(sizes.shift()!));
    const bytes = await fitBlob(photo(9000), 1000, [[1600, 0.7], [1200, 0.6], [800, 0.5], [640, 0.4]], compress);
    expect(bytes.length).toBe(900);
    expect(compress).toHaveBeenCalledTimes(3);
  });

  it('gives up rather than sending something too large', async () => {
    await expect(fitBlob(photo(9000), 1000, [[800, 0.5]], async () => photo(5000))).rejects.toBeInstanceOf(NoteTooLargeError);
  });

  it('keeps the largest allowed note safely under the 1 MiB Firestore limit', () => {
    const fields = serializeNote(
      note({
        // Worst case for UTF-8: four bytes per character.
        text: '𝛴'.repeat(Math.floor(MAX_TEXT_CHARS / 2)),
        comment: '𝛴'.repeat(100),
        title: 'x'.repeat(70),
        teaches: Array.from({ length: 12 }, () => 'y'.repeat(50)),
      }),
    );
    const blobs = { image: new Uint8Array(MAX_IMAGE_BYTES), thumb: new Uint8Array(MAX_THUMB_BYTES) };
    expect(documentBytes(fields, blobs)).toBeLessThan(MAX_DOC_BYTES);
    expect(MAX_DOC_BYTES).toBeLessThan(1_048_576);
  });

  it('holds back a note that cannot fit instead of failing the whole sync', async () => {
    const huge = note({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) });
    const fine = note();
    await db.captures.bulkAdd([huge, fine]);
    const phases: { tooLarge: number }[] = [];
    await track(engineFor(cloud, { onPhase: (_p, detail) => phases.push(detail) })).sync();

    expect(cloud.notes.has(huge.id)).toBe(false);
    expect(cloud.notes.has(fine.id)).toBe(true);
    expect(phases.at(-1)?.tooLarge).toBe(1);
  });

  it('compresses an oversized photo before upload', async () => {
    const big = note({ image: photo(MAX_IMAGE_BYTES + 1) });
    await db.captures.add(big);
    const compress = vi.fn(async () => photo(1024));
    await track(engineFor(cloud, { compress })).sync();
    expect(cloud.notes.get(big.id)?.blobs.image.length).toBe(1024);
    // The student keeps the original on this device.
    expect((await db.captures.get(big.id))?.image.size).toBe(MAX_IMAGE_BYTES + 1);
  });

  it('fits both photos at once', async () => {
    const blobs = await fitPhotos({ image: photo(10), thumb: photo(5) });
    expect([blobs.image.length, blobs.thumb.length]).toEqual([10, 5]);
  });
});

describe('sample notes', () => {
  it('are not uploaded, because every device can generate its own', async () => {
    const seeded = note({ id: 'sample-weighted-en', isSample: true });
    await db.captures.add(seeded);
    await track(engineFor(cloud)).sync();
    expect(cloud.received).toHaveLength(0);
  });
});

describe('deployment files stay in step with the code', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

  it('security rules enforce the same limits as the client', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain(`note.image.size() <= ${MAX_IMAGE_BYTES}`);
    expect(rules).toContain(`note.thumb.size() <= ${MAX_THUMB_BYTES}`);
    expect(rules).toContain(`note.text.size() <= ${MAX_TEXT_CHARS}`);
    expect(rules).toContain('note.isPrivate == false');
  });

  it('security rules accept exactly the fields the client sends', () => {
    const rules = read('firestore.rules');
    const list = /function noteKeys\(\) \{\s*return \[([^\]]+)\]/.exec(rules)![1];
    const allowed = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const sent = [...Object.keys(serializeNote(note())), 'image', 'thumb', 'serverUpdatedAt'].sort();
    expect(allowed).toEqual(sent);
  });

  it('the Remote Config template matches the defaults in code', () => {
    const template = JSON.parse(read('remoteconfig.template.json')) as {
      parameters: Record<string, { defaultValue: { value: string }; valueType: string }>;
    };
    expect(Object.keys(template.parameters).sort()).toEqual(Object.keys(RC_DEFAULTS).sort());
    for (const [key, value] of Object.entries(RC_DEFAULTS)) {
      expect(template.parameters[key].defaultValue.value).toBe(String(value));
      expect(template.parameters[key].valueType).toBe(typeof value === 'number' ? 'NUMBER' : 'STRING');
    }
  });

  it('hosting caches hashed assets forever and never the app shell', () => {
    const { hosting } = JSON.parse(read('firebase.json')) as {
      hosting: { public: string; headers: { source: string; headers: { key: string; value: string }[] }[] };
    };
    const headerFor = (source: string, key: string) =>
      hosting.headers.find((h) => h.source === source)?.headers.find((h) => h.key === key)?.value;

    expect(hosting.public).toBe('dist');
    expect(headerFor('/assets/**', 'Cache-Control')).toContain('immutable');
    expect(headerFor('/index.html', 'Cache-Control')).toBe('no-cache');
    expect(headerFor('/', 'Cache-Control')).toBe('no-cache');
    expect(headerFor('/sw.js', 'Cache-Control')).toBe('no-cache');
    expect(headerFor('**', 'Permissions-Policy')).toBe('camera=(self)');
  });
});
