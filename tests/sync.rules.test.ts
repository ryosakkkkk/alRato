// @vitest-environment node
//
// Security rules and the real sync engine, against the Firestore emulator. Skipped
// unless the emulator is running, so `npm test` needs neither Java nor a project.
//
//   firebase emulators:exec --only firestore --project demo-alrato "npx vitest run tests/sync.rules.test.ts"
//
// Needs @firebase/rules-unit-testing. `demo-` projects cannot reach real Firebase.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Dexie from 'dexie';
import * as firestoreSdk from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankCapture, deleteCapture, setPrivate, SYNC_OWNER_KEY } from '../src/core/captures';
import { db, kvSet } from '../src/core/db';
import { kickQueue } from '../src/core/queue';
import type { Capture } from '../src/core/types';
import {
  createFirestoreRemote,
  MAX_IMAGE_BYTES,
  MAX_TEXT_CHARS,
  MAX_THUMB_BYTES,
  SyncEngine,
} from '../src/firebase/sync';

const { Bytes, deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } =
  firestoreSdk;
type Firestore = firestoreSdk.Firestore;

vi.mock('../src/firebase/app', async () => {
  const { initializeApp } = await import('firebase/app');
  return {
    firebaseApp: initializeApp({ apiKey: 'test-key', projectId: 'demo-alrato', appId: '1:1:web:4' }, 'rules-test'),
    isCloudConfigured: false,
    isFirebaseConfigured: true,
  };
});
vi.mock('../src/core/queue', () => ({ kickQueue: vi.fn(), recoverInterrupted: vi.fn() }));

interface RulesContext {
  firestore(): unknown;
}
interface RulesEnvironment {
  authenticatedContext(uid: string): RulesContext;
  unauthenticatedContext(): RulesContext;
  withSecurityRulesDisabled(run: (context: RulesContext) => Promise<void>): Promise<void>;
  clearFirestore(): Promise<void>;
  cleanup(): Promise<void>;
}
interface RulesKit {
  initializeTestEnvironment(config: {
    projectId: string;
    firestore: { rules: string; host: string; port: number };
  }): Promise<RulesEnvironment>;
  assertFails(operation: Promise<unknown>): Promise<unknown>;
  assertSucceeds<T>(operation: Promise<T>): Promise<T>;
}

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
vi.setConfig({ testTimeout: 30_000 });

/** The kit is not a dependency of the app, so it may live in the git-ignored tools folder. */
async function loadKit(): Promise<RulesKit> {
  const local = resolve(process.cwd(), '.local/rules-test/node_modules/@firebase/rules-unit-testing/dist/esm/index.esm.js');
  const specifier = existsSync(local) ? pathToFileURL(local).href : '@firebase/rules-unit-testing';
  return (await import(/* @vite-ignore */ specifier)) as RulesKit;
}

const NOW = Date.now();
const bytes = (size: number, fill = 9) => Bytes.fromUint8Array(new Uint8Array(size).fill(fill));

function validNote(id: string, over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    id,
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    serverUpdatedAt: serverTimestamp(),
    image: bytes(1000),
    thumb: bytes(100, 8),
    comment: '',
    text: 'V(s) = max',
    textBy: 'ai',
    legibility: 'high',
    kind: 'board',
    title: 'Bellman',
    subject: 'RL',
    topic: 'MDP',
    teaches: ['bellman equation'],
    teachesKeys: ['bellman equation'],
    needsKeys: ['expected value'],
    status: 'ready',
    revision: 1,
    analyzedRevision: 1,
    locked: {},
    isPrivate: false,
    isSample: false,
    ...over,
  };
}

describe.skipIf(!emulator)('Firestore security rules', () => {
  let kit: RulesKit;
  let env: RulesEnvironment;
  const as = (uid: string) => env.authenticatedContext(uid).firestore() as Firestore;
  const anonymous = () => env.unauthenticatedContext().firestore() as Firestore;
  const noteRef = (store: Firestore, uid: string, id: string) => doc(store, 'users', uid, 'captures', id);
  const markRef = (store: Firestore, uid: string, id: string) => doc(store, 'users', uid, 'tombstones', id);

  beforeAll(async () => {
    kit = await loadKit();
    const [host, port] = emulator!.split(':');
    env = await kit.initializeTestEnvironment({
      projectId: 'demo-alrato',
      firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'), host, port: Number(port) },
    });
  }, 120_000);

  afterAll(async () => {
    await env?.cleanup();
  }, 30_000);

  beforeEach(async () => {
    await env.clearFirestore();
  });

  describe('only the owner gets in', () => {
    it('lets a student write, read and delete their own note', async () => {
      const store = as('alice');
      await kit.assertSucceeds(setDoc(noteRef(store, 'alice', 'n1'), validNote('n1')));
      await kit.assertSucceeds(getDoc(noteRef(store, 'alice', 'n1')));
      await kit.assertSucceeds(getDocs(collection(store, 'users', 'alice', 'captures')));
      await kit.assertSucceeds(deleteDoc(noteRef(store, 'alice', 'n1')));
    });

    it('keeps other students out', async () => {
      await setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1'));
      const bob = as('bob');
      await kit.assertFails(getDoc(noteRef(bob, 'alice', 'n1')));
      await kit.assertFails(getDocs(collection(bob, 'users', 'alice', 'captures')));
      await kit.assertFails(setDoc(noteRef(bob, 'alice', 'n1'), validNote('n1')));
      await kit.assertFails(setDoc(noteRef(bob, 'alice', 'n2'), validNote('n2')));
      await kit.assertFails(deleteDoc(noteRef(bob, 'alice', 'n1')));
    });

    it('keeps signed-out visitors out', async () => {
      await setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1'));
      const visitor = anonymous();
      await kit.assertFails(getDoc(noteRef(visitor, 'alice', 'n1')));
      await kit.assertFails(setDoc(noteRef(visitor, 'alice', 'n2'), validNote('n2')));
    });

    it('denies everything outside a student space', async () => {
      const store = as('alice');
      await kit.assertFails(setDoc(doc(store, 'users', 'alice'), { name: 'x' }));
      await kit.assertFails(setDoc(doc(store, 'public', 'x'), { a: 1 }));
      await kit.assertFails(setDoc(doc(store, 'users', 'alice', 'other', 'x'), { a: 1 }));
      await kit.assertFails(getDoc(doc(store, 'public', 'x')));
    });
  });

  describe('private notes cannot be stored', () => {
    it('rejects a document with isPrivate true', async () => {
      await kit.assertFails(setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1', { isPrivate: true })));
    });

    it('rejects turning a stored note private in place', async () => {
      const store = as('alice');
      await setDoc(noteRef(store, 'alice', 'n1'), validNote('n1'));
      await kit.assertFails(updateDoc(noteRef(store, 'alice', 'n1'), { isPrivate: true, serverUpdatedAt: serverTimestamp() }));
    });

    it('rejects a document with no privacy flag', async () => {
      const { isPrivate: _omitted, ...rest } = validNote('n1');
      await kit.assertFails(setDoc(noteRef(as('alice'), 'alice', 'n1'), rest));
    });

    it('rejects any field the app does not send', async () => {
      for (const extra of [{ receipts: [] }, { waitReason: 'x' }, { syncedAt: 1 }, { secret: 'y' }]) {
        await kit.assertFails(setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1', extra)));
      }
    });
  });

  describe('shape and size', () => {
    const rejects = (over: Record<string, unknown>) => kit.assertFails(setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1', over)));

    it('accepts the largest note the app can produce, under the 1 MiB limit', async () => {
      const largest = validNote('n1', {
        image: bytes(MAX_IMAGE_BYTES),
        thumb: bytes(MAX_THUMB_BYTES),
        text: 'é'.repeat(MAX_TEXT_CHARS),
      });
      await kit.assertSucceeds(setDoc(noteRef(as('alice'), 'alice', 'n1'), largest));
    });

    it('rejects photos and text over the limits', async () => {
      await rejects({ image: bytes(MAX_IMAGE_BYTES + 1) });
      await rejects({ thumb: bytes(MAX_THUMB_BYTES + 1) });
      await rejects({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) });
      await rejects({ image: bytes(0) });
    });

    it('rejects wrong types and values', async () => {
      await rejects({ image: 'not-bytes' });
      await rejects({ status: 'processing' });
      await rejects({ kind: 'podcast' });
      await rejects({ textBy: 'robot' });
      await rejects({ legibility: 'perfect' });
      await rejects({ teaches: 'nope' });
      await rejects({ teaches: Array.from({ length: 13 }, () => 'x') });
      await rejects({ revision: 0 });
      await rejects({ updatedAt: 'today' });
      await rejects({ locked: { secret: true } });
      await rejects({ schema: 2 });
    });

    it('rejects a document stored under another id', async () => {
      await kit.assertFails(setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n2')));
    });

    it('rejects a forged server time', async () => {
      await rejects({ serverUpdatedAt: Timestamp.fromMillis(NOW) });
    });

    it('rejects a clock far in the future, which would win every conflict', async () => {
      await rejects({ updatedAt: NOW + 3 * 86_400_000 });
    });
  });

  describe('last writer wins', () => {
    const update = (updatedAt: number, text: string) =>
      updateDoc(noteRef(as('alice'), 'alice', 'n1'), { updatedAt, text, serverUpdatedAt: serverTimestamp() });

    beforeEach(async () => {
      await setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1'));
    });

    it('accepts a newer version', async () => {
      await kit.assertSucceeds(update(NOW + 1000, 'newer'));
    });

    it('refuses an older version', async () => {
      await kit.assertFails(update(NOW - 1000, 'stale'));
    });

    it('accepts the same version again, so retries are harmless', async () => {
      await kit.assertSucceeds(setDoc(noteRef(as('alice'), 'alice', 'n1'), validNote('n1')));
    });

    it('does not let an update change when the note was created', async () => {
      await kit.assertFails(
        updateDoc(noteRef(as('alice'), 'alice', 'n1'), { createdAt: 1, updatedAt: NOW + 1, serverUpdatedAt: serverTimestamp() }),
      );
    });
  });

  describe('tombstones', () => {
    async function removeNote(store: Firestore, id: string) {
      const batch = writeBatch(store);
      batch.delete(noteRef(store, 'alice', id));
      batch.set(markRef(store, 'alice', id), { deletedAt: serverTimestamp() });
      await batch.commit();
    }

    it('lets a student remove a note and leave a tombstone', async () => {
      const store = as('alice');
      await setDoc(noteRef(store, 'alice', 'n1'), validNote('n1'));
      await kit.assertSucceeds(removeNote(store, 'n1'));
      expect((await getDoc(noteRef(store, 'alice', 'n1'))).exists()).toBe(false);
      expect((await getDoc(markRef(store, 'alice', 'n1'))).exists()).toBe(true);
    });

    it('stops a stale device from bringing a removed note back', async () => {
      const store = as('alice');
      await setDoc(noteRef(store, 'alice', 'n1'), validNote('n1'));
      await removeNote(store, 'n1');
      await kit.assertFails(setDoc(noteRef(store, 'alice', 'n1'), validNote('n1', { updatedAt: NOW + 5000 })));
    });

    it('allows sharing again only by clearing the tombstone in the same batch', async () => {
      const store = as('alice');
      await setDoc(noteRef(store, 'alice', 'n1'), validNote('n1'));
      await removeNote(store, 'n1');

      const batch = writeBatch(store);
      batch.delete(markRef(store, 'alice', 'n1'));
      batch.set(noteRef(store, 'alice', 'n1'), validNote('n1', { updatedAt: NOW + 5000 }));
      await kit.assertSucceeds(batch.commit());
    });

    it('refuses a tombstone while the note still exists', async () => {
      const store = as('alice');
      await setDoc(noteRef(store, 'alice', 'n1'), validNote('n1'));
      await kit.assertFails(setDoc(markRef(store, 'alice', 'n1'), { deletedAt: serverTimestamp() }));
    });

    it('validates the tombstone shape and keeps others out', async () => {
      const store = as('alice');
      await kit.assertFails(setDoc(markRef(store, 'alice', 'n1'), { deletedAt: Timestamp.fromMillis(NOW) }));
      await kit.assertFails(setDoc(markRef(store, 'alice', 'n1'), { deletedAt: serverTimestamp(), note: 'text' }));
      await kit.assertFails(setDoc(markRef(store, 'alice', 'n1'), { deletedAt: serverTimestamp(), wiped: false }));
      await kit.assertSucceeds(setDoc(markRef(store, 'alice', 'n1'), { deletedAt: serverTimestamp(), wiped: true }));
      await kit.assertFails(getDoc(markRef(as('bob'), 'alice', 'n1')));
      await kit.assertFails(setDoc(markRef(as('bob'), 'alice', 'n2'), { deletedAt: serverTimestamp() }));
    });
  });

  describe('the real sync engine against the real rules', () => {
    const SECRET = 'MY-PRIVATE-EXAM-ANSWERS';

    class Laptop extends Dexie {
      captures!: Dexie.Table<Capture, string>;
      aids!: Dexie.Table<never, string>;
      cards!: Dexie.Table<never, string>;
      usage!: Dexie.Table<never, number>;
      kv!: Dexie.Table<{ key: string; value: unknown }, string>;

      constructor() {
        super(`rules-laptop-${Math.random()}`);
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
    let engines: SyncEngine[];
    const photo = (size: number, fill: number) => new Blob([new Uint8Array(size).fill(fill)], { type: 'image/jpeg' });
    const note = (over: Partial<Capture> = {}) =>
      blankCapture({ image: photo(4096, 3), thumb: photo(512, 4), text: 'V(s) = max', textBy: 'ai', status: 'ready', title: 'Bellman', ...over });

    function engineOn(database: typeof db | Laptop, uid = 'alice') {
      const engine = new SyncEngine({
        uid,
        enabled: true,
        database: database as typeof db,
        getRemote: async () => createFirestoreRemote(firestoreSdk, as(uid), uid),
      });
      engines.push(engine);
      return engine;
    }

    /** Everything stored in the emulator for a student, read with rules off. */
    async function cloudDump(uid = 'alice') {
      const out: { notes: Record<string, firestoreSdk.DocumentData>; marks: string[] } = { notes: {}, marks: [] };
      await env.withSecurityRulesDisabled(async (context) => {
        const store = context.firestore() as Firestore;
        for (const snapshot of (await getDocs(collection(store, 'users', uid, 'captures'))).docs) {
          out.notes[snapshot.id] = snapshot.data();
        }
        out.marks = (await getDocs(collection(store, 'users', uid, 'tombstones'))).docs.map((d) => d.id);
      });
      return out;
    }

    async function until(check: () => Promise<boolean>, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('condition not met in time');
    }

    beforeEach(async () => {
      vi.mocked(kickQueue).mockClear();
      await Promise.all([db.captures.clear(), db.aids.clear(), db.cards.clear(), db.kv.clear()]);
      await kvSet(SYNC_OWNER_KEY, 'alice');
      laptop = new Laptop();
      engines = [];
    });

    afterEach(async () => {
      engines.forEach((engine) => engine.stop());
      laptop.close();
      await Dexie.delete(laptop.name);
    });

    it('moves a photo from the phone to the laptop, byte for byte', async () => {
      const shared = note();
      await db.captures.add(shared);
      await engineOn(db).sync();
      await engineOn(laptop).sync();

      const copy = await laptop.captures.get(shared.id);
      expect(copy).toMatchObject({ title: 'Bellman', isPrivate: false, syncedAt: shared.updatedAt });
      const image = new Uint8Array(await copy!.image.arrayBuffer());
      expect(image.length).toBe(4096);
      expect(image.every((b) => b === 3)).toBe(true);
      expect(copy!.thumb.size).toBe(512);
    });

    it('a queued note from the phone wakes the queue on the laptop', async () => {
      const waiting = note({ status: 'queued', text: '', title: '' });
      await db.captures.add(waiting);
      await engineOn(db).sync();
      expect(kickQueue).not.toHaveBeenCalled();

      await engineOn(laptop).sync();
      expect((await laptop.captures.get(waiting.id))?.status).toBe('queued');
      expect(kickQueue).toHaveBeenCalled();
    });

    it('a private note never reaches the server', async () => {
      const secret = note({ isPrivate: true, text: SECRET, comment: SECRET, title: SECRET });
      const open = note({ text: 'public note' });
      await db.captures.bulkAdd([secret, open]);
      const engine = engineOn(db);
      await engine.sync();
      await engine.sync();

      const cloud = await cloudDump();
      expect(Object.keys(cloud.notes)).toEqual([open.id]);
      expect(JSON.stringify(cloud)).not.toContain(SECRET);
    });

    it('making a note private deletes it on the server and from the other device', async () => {
      const shared = note({ text: SECRET });
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      const laptopSide = engineOn(laptop);
      await laptopSide.sync();
      expect(await laptop.captures.get(shared.id)).toBeDefined();

      await setPrivate(shared.id, true);
      await phone.sync();

      let cloud = await cloudDump();
      expect(cloud.notes[shared.id]).toBeUndefined();
      expect(cloud.marks).toEqual([shared.id]);

      await until(async () => {
        await laptopSide.sync();
        return (await laptop.captures.get(shared.id)) === undefined;
      });
      cloud = await cloudDump();
      expect(JSON.stringify(cloud)).not.toContain(SECRET);
    });

    it('a stale laptop with unsaved edits cannot put a private note back', async () => {
      const shared = note();
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      await engineOn(laptop).sync();

      await laptop.captures.update(shared.id, { text: 'edited offline', updatedAt: shared.updatedAt + 5000 });
      await setPrivate(shared.id, true);
      await phone.sync();

      await engineOn(laptop).sync();

      const cloud = await cloudDump();
      expect(cloud.notes[shared.id]).toBeUndefined();
      expect(await laptop.captures.get(shared.id)).toMatchObject({ text: 'edited offline', isPrivate: true });
    });

    it('even a laptop that missed the tombstone is refused by the server', async () => {
      const shared = note();
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      const laptopSide = engineOn(laptop);
      await laptopSide.sync();
      // Stop listening, so this laptop cannot learn about the removal before it pushes.
      (laptopSide as unknown as { detachWatch(): void }).detachWatch();

      await laptop.captures.update(shared.id, { text: 'edited offline', updatedAt: shared.updatedAt + 5000 });
      await setPrivate(shared.id, true);
      await phone.sync();
      await laptopSide.sync();

      const cloud = await cloudDump();
      expect(cloud.notes[shared.id]).toBeUndefined();
      expect(await laptop.captures.get(shared.id)).toMatchObject({ isPrivate: true });
    });

    it('deleting a note deletes it on the server and from the other device', async () => {
      const shared = note();
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      const laptopSide = engineOn(laptop);
      await laptopSide.sync();

      await deleteCapture(shared.id);
      await phone.sync();
      expect((await cloudDump()).notes[shared.id]).toBeUndefined();

      await until(async () => {
        await laptopSide.sync();
        return (await laptop.captures.get(shared.id)) === undefined;
      });
    });

    it('sharing a note again brings it back everywhere', async () => {
      const shared = note();
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      await engineOn(laptop).sync();

      await setPrivate(shared.id, true);
      await phone.sync();
      await engineOn(laptop).sync();
      expect(await laptop.captures.get(shared.id)).toBeUndefined();

      await setPrivate(shared.id, false);
      await phone.sync();
      const cloud = await cloudDump();
      expect(cloud.notes[shared.id]).toBeDefined();
      expect(cloud.marks).toEqual([]);

      await engineOn(laptop).sync();
      expect(await laptop.captures.get(shared.id)).toMatchObject({ isPrivate: false });
    });

    it('resolves a conflict by last writer, on both devices', async () => {
      const shared = note();
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      const laptopSide = engineOn(laptop);
      await laptopSide.sync();

      await laptop.captures.update(shared.id, { title: 'Laptop wins', updatedAt: shared.updatedAt + 2000 });
      await laptopSide.sync();
      await db.captures.update(shared.id, { title: 'Phone is older', updatedAt: shared.updatedAt + 1000 });
      await phone.sync();

      expect((await cloudDump()).notes[shared.id].title).toBe('Laptop wins');
      await until(async () => {
        await phone.sync();
        return (await db.captures.get(shared.id))?.title === 'Laptop wins';
      });
    });

    it('updates after the first upload do not resend the photo', async () => {
      const shared = note();
      await db.captures.add(shared);
      const phone = engineOn(db);
      await phone.sync();
      await db.captures.update(shared.id, { title: 'New title', updatedAt: shared.updatedAt + 1000 });
      await phone.sync();

      const stored = (await cloudDump()).notes[shared.id];
      expect(stored.title).toBe('New title');
      expect((stored.image as firestoreSdk.Bytes).toUint8Array().length).toBe(4096);
    });

    it('pages through a library larger than one download page', async () => {
      const library = Array.from({ length: 45 }, (_, i) => note({ title: `Note ${i}` }));
      await db.captures.bulkAdd(library);
      await engineOn(db).sync();
      expect(Object.keys((await cloudDump()).notes)).toHaveLength(45);

      await engineOn(laptop).sync();
      expect(await laptop.captures.count()).toBe(45);
    }, 60_000);

    it('delivers new notes live to a device that is already connected', async () => {
      const laptopSide = engineOn(laptop);
      await laptopSide.sync();

      const fresh = note({ title: 'Snapped just now' });
      await db.captures.add(fresh);
      await engineOn(db).sync();

      await until(async () => {
        await laptopSide.sync();
        return (await laptop.captures.get(fresh.id))?.title === 'Snapped just now';
      });
    });

    it('never mixes two accounts', async () => {
      const shared = note({ text: 'alice only' });
      await db.captures.add(shared);
      await engineOn(db, 'alice').sync();

      await engineOn(laptop, 'bob').sync();
      expect(await laptop.captures.count()).toBe(0);
      expect(Object.keys((await cloudDump('bob')).notes)).toEqual([]);
    });
  });
});
