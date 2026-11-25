import { liveQuery } from 'dexie';
import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
  QueryConstraint,
  QueryDocumentSnapshot,
  UpdateData,
} from 'firebase/firestore';
import {
  removeNoteRows,
  SYNC_ATTEMPTED,
  SYNC_ENABLED_KEY,
  SYNC_OUTBOX_KEY,
  SYNC_OWNER_KEY,
  SYNC_REMOVED,
  type CloudDelete,
} from '../core/captures';
import { db, kvGet, kvSet } from '../core/db';
import { kickQueue } from '../core/queue';
import type { Capture, CaptureStatus, NoteKind } from '../core/types';
import { firebaseApp, isFirebaseConfigured } from './app';
import { authState, resumeSession, subscribeAuth } from './auth';

/*
 * Opt-in sync, so a board photographed on a phone with no local AI can be studied
 * on a laptop that has Gemini Nano.
 *
 *   users/{uid}/captures/{id}    the note, with its photo and thumbnail as Bytes
 *   users/{uid}/tombstones/{id}  "this note left the cloud", for devices that were offline
 *
 * The device stays the source of truth. The cloud is a mailbox between devices.
 * Private notes never enter this file's wire format: see `serializeNote`.
 */

/* ---------- Wire format ---------- */

export const SYNC_SCHEMA = 1;
export const MAX_IMAGE_BYTES = 700 * 1024;
export const MAX_THUMB_BYTES = 64 * 1024;
export const MAX_TEXT_CHARS = 20_000;
/** Firestore's hard limit is 1,048,576 bytes per document. */
export const MAX_DOC_BYTES = 1_000_000;
const DOC_OVERHEAD_BYTES = 2048;

type WireStatus = Extract<CaptureStatus, 'queued' | 'ready' | 'needs_review'>;

/** Everything that may leave the device, spelled out. Nothing else can be sent. */
export interface NoteFields {
  schema: typeof SYNC_SCHEMA;
  id: string;
  createdAt: number;
  updatedAt: number;
  comment: string;
  text: string;
  textBy: Capture['textBy'];
  legibility: Capture['legibility'];
  kind: NoteKind;
  title: string;
  subject: string;
  topic: string;
  teaches: string[];
  teachesKeys: string[];
  needsKeys: string[];
  status: WireStatus;
  revision: number;
  analyzedRevision: number;
  locked: Capture['locked'];
  isPrivate: false;
  isSample: boolean;
}

export interface NoteBlobs {
  image: Uint8Array;
  thumb: Uint8Array;
}

export class PrivateNoteError extends Error {
  constructor(id: string) {
    super(`Refused to serialize private note ${id}`);
    this.name = 'PrivateNoteError';
  }
}

export class NoteTooLargeError extends Error {
  constructor(id: string) {
    super(`Note ${id} does not fit in a Firestore document`);
    this.name = 'NoteTooLargeError';
  }
}

const LOCK_KEYS = ['kind', 'subject', 'title', 'topic'] as const;

function canonicalLocks(locked: Capture['locked']): Capture['locked'] {
  const out: Capture['locked'] = {};
  for (const key of LOCK_KEYS) if (locked[key]) out[key] = true;
  return out;
}

/** Device-local states become "waiting", so another device can pick the note up. */
const toWireStatus = (status: CaptureStatus): WireStatus =>
  status === 'ready' || status === 'needs_review' ? status : 'queued';

/**
 * Whether a note may leave this device at all. Fails closed on malformed data.
 * The built-in samples are excluded because every device can generate its own.
 */
export const isSyncable = (note: Pick<Capture, 'id' | 'isPrivate'>): boolean =>
  note.isPrivate === false && !note.id.startsWith('sample-');

/**
 * The only way a note becomes data for the network, and it refuses private notes.
 * Fields are copied one by one, so a new local field can never leak by accident.
 */
export function serializeNote(note: Capture): NoteFields {
  if (note.isPrivate !== false) throw new PrivateNoteError(note.id);
  return {
    schema: SYNC_SCHEMA,
    id: note.id,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    comment: note.comment,
    text: note.text,
    textBy: note.textBy,
    legibility: note.legibility,
    kind: note.kind,
    title: note.title,
    subject: note.subject,
    topic: note.topic,
    teaches: [...note.teaches],
    teachesKeys: [...note.teachesKeys],
    needsKeys: [...note.needsKeys],
    status: toWireStatus(note.status),
    revision: note.revision,
    analyzedRevision: note.analyzedRevision,
    locked: canonicalLocks(note.locked),
    isPrivate: false,
    isSample: note.isSample,
  };
}

const KINDS: readonly unknown[] = ['board', 'formula', 'exercise', 'question', 'other'];
const TEXT_BY: readonly unknown[] = ['none', 'ai', 'student'];
const LEGIBILITY: readonly unknown[] = ['high', 'medium', 'low', null];
const STATUSES: readonly unknown[] = ['queued', 'ready', 'needs_review'];

const isString = (value: unknown): value is string => typeof value === 'string';
const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

/** Cloud data is untrusted input. Anything malformed or marked private is ignored. */
export function parseNote(id: string, raw: Record<string, unknown>): NoteFields | null {
  const locked = raw.locked;
  if (
    raw.schema !== SYNC_SCHEMA ||
    raw.id !== id ||
    raw.isPrivate !== false ||
    !isInt(raw.createdAt) ||
    !isInt(raw.updatedAt) ||
    !isString(raw.comment) ||
    !isString(raw.text) ||
    !TEXT_BY.includes(raw.textBy) ||
    !LEGIBILITY.includes(raw.legibility) ||
    !KINDS.includes(raw.kind) ||
    !isString(raw.title) ||
    !isString(raw.subject) ||
    !isString(raw.topic) ||
    !isStringList(raw.teaches) ||
    !isStringList(raw.teachesKeys) ||
    !isStringList(raw.needsKeys) ||
    !STATUSES.includes(raw.status) ||
    !isInt(raw.revision) ||
    !isInt(raw.analyzedRevision) ||
    typeof raw.isSample !== 'boolean' ||
    typeof locked !== 'object' ||
    locked === null
  ) {
    return null;
  }
  return {
    schema: SYNC_SCHEMA,
    id,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    comment: raw.comment,
    text: raw.text,
    textBy: raw.textBy as Capture['textBy'],
    legibility: raw.legibility as Capture['legibility'],
    kind: raw.kind as NoteKind,
    title: raw.title,
    subject: raw.subject,
    topic: raw.topic,
    teaches: raw.teaches,
    teachesKeys: raw.teachesKeys,
    needsKeys: raw.needsKeys,
    status: raw.status as WireStatus,
    revision: raw.revision,
    analyzedRevision: raw.analyzedRevision,
    locked: canonicalLocks(locked as Capture['locked']),
    isPrivate: false,
    isSample: raw.isSample,
  };
}

/* ---------- Last writer wins ---------- */

export type MergeDecision = 'apply' | 'keep' | 'mark_clean';

const sameFields = (a: NoteFields, b: NoteFields): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Compares by `updatedAt`. A note private on this device is never overwritten. */
export function decideMerge(local: Capture | undefined, remote: NoteFields): MergeDecision {
  if (!local) return 'apply';
  if (local.isPrivate !== false) return 'keep';
  if (remote.updatedAt < local.updatedAt) return 'keep';
  if (remote.updatedAt === local.updatedAt && sameFields(serializeNote(local), remote)) return 'mark_clean';
  return 'apply';
}

/** Builds the local row for a remote version, keeping what belongs to this device. */
export function mergeRemote(local: Capture | undefined, remote: NoteFields, photos: { image: Blob; thumb: Blob }): Capture {
  const textChanged = !local || local.text !== remote.text || local.comment !== remote.comment;
  const highest = Math.max(local?.revision ?? 1, remote.revision);
  // A new revision makes the queue drop any answer in flight for the old text.
  const revision = local && textChanged && highest === local.revision ? highest + 1 : highest;
  const keepsWorking = local?.status === 'processing' && remote.status === 'queued' && revision === local.revision;
  const { schema: _schema, ...fields } = remote;
  return {
    ...fields,
    // The original photo may be sharper than the copy compressed for the cloud.
    image: local?.image ?? photos.image,
    thumb: local?.thumb ?? photos.thumb,
    status: keepsWorking ? 'processing' : remote.status,
    waitReason: null,
    errorCode: null,
    attempts: 0,
    nextAttemptAt: 0,
    revision,
    analyzedRevision: remote.analyzedRevision >= remote.revision ? revision : remote.analyzedRevision,
    // Receipts prove what ran on this device, so they never travel.
    receipts: local?.receipts ?? [],
    isPrivate: false,
    syncedAt: remote.updatedAt,
  };
}

/* ---------- Photos within the document limit ---------- */

export type Compressor = (source: Blob, maxSide: number, quality: number) => Promise<Blob>;

const IMAGE_LADDER: readonly (readonly [number, number])[] = [
  [1600, 0.72],
  [1400, 0.66],
  [1200, 0.6],
  [1000, 0.55],
  [800, 0.5],
  [640, 0.45],
];
const THUMB_LADDER: readonly (readonly [number, number])[] = [
  [480, 0.6],
  [360, 0.55],
  [240, 0.5],
];

async function reencode(source: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))), 'image/jpeg', quality);
    });
  } finally {
    bitmap.close();
  }
}

/** Returns the bytes as they are when they fit, or the best recompression that does. */
export async function fitBlob(
  source: Blob,
  maxBytes: number,
  ladder: readonly (readonly [number, number])[],
  compress: Compressor = reencode,
): Promise<Uint8Array> {
  if (source.size <= maxBytes) return new Uint8Array(await source.arrayBuffer());
  for (const [side, quality] of ladder) {
    const smaller = await compress(source, side, quality);
    if (smaller.size <= maxBytes) return new Uint8Array(await smaller.arrayBuffer());
  }
  throw new NoteTooLargeError('photo');
}

export async function fitPhotos(note: Pick<Capture, 'image' | 'thumb'>, compress?: Compressor): Promise<NoteBlobs> {
  const [image, thumb] = await Promise.all([
    fitBlob(note.image, MAX_IMAGE_BYTES, IMAGE_LADDER, compress),
    fitBlob(note.thumb, MAX_THUMB_BYTES, THUMB_LADDER, compress),
  ]);
  return { image, thumb };
}

/** A conservative size: JSON is never smaller than Firestore's encoding of the same fields. */
export function documentBytes(fields: NoteFields, blobs: NoteBlobs | null): number {
  const photos = blobs ? blobs.image.length + blobs.thumb.length : MAX_IMAGE_BYTES + MAX_THUMB_BYTES;
  return new TextEncoder().encode(JSON.stringify(fields)).length + photos + DOC_OVERHEAD_BYTES;
}

function assertFits(fields: NoteFields, blobs: NoteBlobs | null): void {
  if (fields.text.length > MAX_TEXT_CHARS || documentBytes(fields, blobs) > MAX_DOC_BYTES) {
    throw new NoteTooLargeError(fields.id);
  }
}

/* ---------- The cloud, behind a small interface ---------- */

export interface RemoteNote {
  fields: NoteFields;
  blobs: NoteBlobs;
  /** Server time of the write, used only as a download cursor. */
  at: number;
}

export interface RemoteTombstone {
  id: string;
  wiped: boolean;
  at: number;
}

export interface Page<T> {
  items: T[];
  next: unknown | null;
}

export interface Cursor {
  notes: number;
  tombstones: number;
}

export interface RemoteHandlers {
  onNotes: (items: RemoteNote[]) => void;
  onTombstones: (items: RemoteTombstone[]) => void;
  onError: (error: unknown) => void;
}

export interface RemoteStore {
  /** With photos, writes the whole note. Without, updates a note the cloud already has. */
  put(fields: NoteFields, blobs: NoteBlobs | null, options: { revive: boolean }): Promise<void>;
  /** Deletes the notes and leaves a tombstone for each, atomically. */
  remove(ids: string[], options?: { wiped?: boolean }): Promise<void>;
  pageNotes(sinceMs: number, after: unknown): Promise<Page<RemoteNote>>;
  pageTombstones(sinceMs: number, after: unknown): Promise<Page<RemoteTombstone>>;
  watch(cursor: Cursor, handlers: RemoteHandlers): () => void;
  readNote(id: string): Promise<RemoteNote | null>;
  readTombstone(id: string): Promise<RemoteTombstone | null>;
  listNoteIds(max: number): Promise<string[]>;
}

type FirestoreSdk = typeof import('firebase/firestore');

const PAGE_SIZE = 20;
const BATCH_NOTES = 200;
/** Server timestamps can land slightly out of order. Re-reading a little is harmless. */
const CURSOR_OVERLAP_MS = 120_000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createFirestoreRemote(sdk: FirestoreSdk, firestore: Firestore, uid: string): RemoteStore {
  const notes = sdk.collection(firestore, 'users', uid, 'captures');
  const marks = sdk.collection(firestore, 'users', uid, 'tombstones');
  const since = (ms: number) => sdk.Timestamp.fromMillis(Math.max(0, ms));

  function toNote(snapshot: DocumentSnapshot<DocumentData>): RemoteNote | null {
    const data = snapshot.data();
    if (!data) return null;
    const fields = parseNote(snapshot.id, data);
    if (!fields || !(data.image instanceof sdk.Bytes) || !(data.thumb instanceof sdk.Bytes)) return null;
    const at = data.serverUpdatedAt instanceof sdk.Timestamp ? data.serverUpdatedAt.toMillis() : 0;
    return { fields, blobs: { image: data.image.toUint8Array(), thumb: data.thumb.toUint8Array() }, at };
  }

  function toMark(snapshot: DocumentSnapshot<DocumentData>): RemoteTombstone | null {
    const data = snapshot.data();
    if (!data) return null;
    const at = data.deletedAt instanceof sdk.Timestamp ? data.deletedAt.toMillis() : 0;
    return { id: snapshot.id, wiped: data.wiped === true, at };
  }

  const present = <T>(item: T | null): item is T => item !== null;

  async function page<T>(
    source: typeof notes,
    field: string,
    sinceMs: number,
    after: unknown,
    parse: (snapshot: DocumentSnapshot<DocumentData>) => T | null,
  ): Promise<Page<T>> {
    const constraints: QueryConstraint[] = [
      sdk.where(field, '>=', since(sinceMs)),
      sdk.orderBy(field),
      ...(after ? [sdk.startAfter(after as QueryDocumentSnapshot)] : []),
      sdk.limit(PAGE_SIZE),
    ];
    const result = await sdk.getDocsFromServer(sdk.query(source, ...constraints));
    const next = result.docs.length === PAGE_SIZE ? result.docs[result.docs.length - 1] : null;
    return { items: result.docs.map(parse).filter(present), next };
  }

  return {
    // A transaction rather than a batch on purpose: it fails when offline instead of
    // waiting in a local queue, where it could land after the note turned private.
    async put(fields, blobs, { revive }) {
      const ref = sdk.doc(notes, fields.id);
      const stamped = { ...fields, serverUpdatedAt: sdk.serverTimestamp() };
      await sdk.runTransaction(firestore, async (write) => {
        if (blobs) {
          if (revive) write.delete(sdk.doc(marks, fields.id));
          write.set(ref, {
            ...stamped,
            image: sdk.Bytes.fromUint8Array(blobs.image),
            thumb: sdk.Bytes.fromUint8Array(blobs.thumb),
          });
        } else {
          write.update(ref, stamped as UpdateData<DocumentData>);
        }
      });
    },

    async remove(ids, options = {}) {
      for (const group of chunks(ids, BATCH_NOTES)) {
        const batch = sdk.writeBatch(firestore);
        for (const id of group) {
          batch.delete(sdk.doc(notes, id));
          batch.set(sdk.doc(marks, id), {
            deletedAt: sdk.serverTimestamp(),
            ...(options.wiped ? { wiped: true } : {}),
          });
        }
        await batch.commit();
      }
    },

    pageNotes: (sinceMs, after) => page(notes, 'serverUpdatedAt', sinceMs, after, toNote),
    pageTombstones: (sinceMs, after) => page(marks, 'deletedAt', sinceMs, after, toMark),

    watch(cursor, handlers) {
      const listen = <T>(
        source: typeof notes,
        field: string,
        fromMs: number,
        parse: (snapshot: DocumentSnapshot<DocumentData>) => T | null,
        deliver: (items: T[]) => void,
      ) =>
        sdk.onSnapshot(
          sdk.query(source, sdk.where(field, '>', since(fromMs))),
          (snapshot) => {
            const items = snapshot
              .docChanges()
              .filter((change) => change.type !== 'removed' && !change.doc.metadata.hasPendingWrites)
              .map((change) => parse(change.doc))
              .filter(present);
            if (items.length > 0) deliver(items);
          },
          handlers.onError,
        );
      const stopNotes = listen(notes, 'serverUpdatedAt', cursor.notes - CURSOR_OVERLAP_MS, toNote, handlers.onNotes);
      const stopMarks = listen(marks, 'deletedAt', cursor.tombstones - CURSOR_OVERLAP_MS, toMark, handlers.onTombstones);
      return () => {
        stopNotes();
        stopMarks();
      };
    },

    readNote: async (id) => toNote(await sdk.getDocFromServer(sdk.doc(notes, id))),
    readTombstone: async (id) => toMark(await sdk.getDocFromServer(sdk.doc(marks, id))),

    async listNoteIds(max) {
      const result = await sdk.getDocsFromServer(sdk.query(notes, sdk.limit(max)));
      return result.docs.map((snapshot) => snapshot.id);
    },
  };
}

/* ---------- The sync engine ---------- */

export type SyncPhase = 'off' | 'starting' | 'syncing' | 'synced' | 'offline' | 'standby' | 'error';

const cursorKey = (uid: string) => `sync.cursor.${uid}`;

const WAKE_DELAY_MS = 1200;
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 300_000;

/** How the server says no to a write, as opposed to being unreachable. */
const REFUSALS = new Set(['permission-denied', 'not-found', 'failed-precondition']);

const errorCode = (error: unknown): string => (error as { code?: string } | null)?.code ?? '';
const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;
const versionKey = (note: Pick<Capture, 'id' | 'updatedAt'>) => `${note.id}@${note.updatedAt}`;
const outboxFrom = (row: { value: unknown } | undefined): CloudDelete[] => (row?.value as CloudDelete[]) ?? [];

export interface SyncEngineOptions {
  uid: string;
  enabled: boolean;
  getRemote: () => Promise<RemoteStore>;
  database?: typeof db;
  compress?: Compressor;
  onPhase?: (phase: SyncPhase, detail: { tooLarge: number }) => void;
  /** Another device deleted the cloud copy, so this one must stop uploading. */
  onWipedElsewhere?: () => void;
}

export class SyncEngine {
  private readonly database: typeof db;
  private enabled: boolean;
  private started = false;
  private stopped = false;
  private running = false;
  private again = false;
  private retries = 0;
  private caughtUp = false;
  private queueTouched = false;
  private wipedElsewhere = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unwatch: (() => void) | undefined;
  private unobserve: (() => void) | undefined;
  private remoteStore: Promise<RemoteStore> | undefined;
  private inbox: { notes: RemoteNote[]; tombstones: RemoteTombstone[] } = { notes: [], tombstones: [] };
  /** Versions the server refused for good. They wait until the note changes. */
  private readonly refused = new Set<string>();
  private readonly tooLarge = new Set<string>();
  private readonly onOnline = () => this.wake(0);
  private readonly onOffline = () => this.report('offline');
  private settled: Promise<void> = Promise.resolve();
  private finish: () => void = () => undefined;
  private readonly finished = new Promise<void>((resolve) => {
    this.finish = resolve;
  });

  constructor(private readonly options: SyncEngineOptions) {
    this.database = options.database ?? db;
    this.enabled = options.enabled;
  }

  /** True while another tab holds the sync lock and this one is waiting for it. */
  get isStandby(): boolean {
    return !this.started && !this.stopped;
  }

  /** Resolves once the engine has been stopped. */
  whenStopped(): Promise<void> {
    return this.finished;
  }

  start(): void {
    if (this.stopped || this.started) return;
    this.started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    this.unobserve = this.observeLocalChanges();
    this.wake(0);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    this.detachWatch();
    this.unobserve?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
    this.finish();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.detachWatch();
      this.caughtUp = false;
      this.inbox = { notes: [], tombstones: [] };
    }
    this.wake(0);
  }

  /** Schedules a cycle. A tab waiting for the sync lock stays quiet until it gets it. */
  wake(delay = WAKE_DELAY_MS): void {
    if (this.stopped || !this.started) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delay);
  }

  /** Waits for the cycle in progress, if any. */
  idle(): Promise<void> {
    return this.settled;
  }

  /** Runs one full cycle. Safe to call at any time: concurrent calls merge into one. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.settled;
    }
    this.running = true;
    this.settled = this.runCycles();
    return this.settled;
  }

  private async runCycles(): Promise<void> {
    try {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again && !this.stopped);
      this.retries = 0;
    } catch (error) {
      this.onFailure(error);
    } finally {
      this.running = false;
    }
  }

  private get active(): boolean {
    return this.enabled && !this.stopped;
  }

  private report(phase: SyncPhase): void {
    if (!this.stopped) this.options.onPhase?.(phase, { tooLarge: this.tooLarge.size });
  }

  private onFailure(error: unknown): void {
    if (this.stopped) return;
    const code = errorCode(error);
    this.report(!isOnline() || code === 'unavailable' ? 'offline' : 'error');
    this.retries += 1;
    this.wake(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.retries - 1)));
  }

  private remote(): Promise<RemoteStore> {
    this.remoteStore ??= this.options.getRemote().catch((error: unknown) => {
      this.remoteStore = undefined;
      throw error;
    });
    return this.remoteStore;
  }

  private observeLocalChanges(): () => void {
    const { database } = this;
    let first = true;
    const subscription = liveQuery(async () => {
      const [updated, statuses, outbox, enabledFor] = await Promise.all([
        database.captures.orderBy('updatedAt').keys(),
        database.captures.orderBy('status').keys(),
        database.kv.get(SYNC_OUTBOX_KEY),
        database.kv.get(SYNC_ENABLED_KEY),
      ]);
      return { updated, statuses, outbox, enabledFor: enabledFor?.value };
    }).subscribe({
      next: ({ enabledFor }) => {
        const shouldRun = enabledFor === this.options.uid;
        if (shouldRun !== this.enabled) this.setEnabled(shouldRun);
        else if (!first) this.wake();
        first = false;
      },
      error: () => undefined,
    });
    return () => subscription.unsubscribe();
  }

  private async cycle(): Promise<void> {
    if (this.stopped) return;
    if (!isOnline()) {
      this.report('offline');
      return;
    }
    if (!this.enabled) {
      // Sync may be off, but a promise to delete a cloud copy still stands.
      await this.flushDeletes();
      this.report('off');
      return;
    }

    this.report(this.caughtUp ? 'syncing' : 'starting');
    await this.flushDeletes();
    if (!this.caughtUp) await this.catchUp();
    await this.drainInbox();
    if (this.stopWhenWiped()) return;
    await this.pushDirty();
    await this.flushDeletes();
    if (this.active) this.report('synced');
  }

  private stopWhenWiped(): boolean {
    if (!this.wipedElsewhere) return false;
    this.wipedElsewhere = false;
    this.setEnabled(false);
    this.options.onWipedElsewhere?.();
    return true;
  }

  /* ----- Deletions: always first ----- */

  private async pendingDeletes(): Promise<string[]> {
    const outbox = outboxFrom(await this.database.kv.get(SYNC_OUTBOX_KEY));
    return outbox.filter((entry) => entry.uid === this.options.uid).map((entry) => entry.id);
  }

  private async flushDeletes(): Promise<void> {
    const ids = await this.pendingDeletes();
    if (ids.length === 0) return;
    await (await this.remote()).remove(ids);

    const { database } = this;
    const done = new Set(ids);
    await database.transaction('rw', database.captures, database.kv, async () => {
      const outbox = outboxFrom(await database.kv.get(SYNC_OUTBOX_KEY));
      await database.kv.put({
        key: SYNC_OUTBOX_KEY,
        value: outbox.filter((entry) => !(entry.uid === this.options.uid && done.has(entry.id))),
      });
      for (const id of ids) await database.captures.update(id, { syncedAt: SYNC_REMOVED });
    });
  }

  /* ----- Downloads ----- */

  private async readCursor(): Promise<Cursor> {
    const row = await this.database.kv.get(cursorKey(this.options.uid));
    return (row?.value as Cursor | undefined) ?? { notes: 0, tombstones: 0 };
  }

  private async advanceCursor(field: keyof Cursor, items: { at: number }[]): Promise<void> {
    if (items.length === 0) return;
    const latest = Math.max(...items.map((item) => item.at));
    const cursor = await this.readCursor();
    if (latest <= cursor[field]) return;
    await this.database.kv.put({ key: cursorKey(this.options.uid), value: { ...cursor, [field]: latest } });
  }

  private async catchUp(): Promise<void> {
    const remote = await this.remote();
    const start = await this.readCursor();

    // Removals come first, so an upload can never race a deletion it has not seen.
    let after: unknown = null;
    do {
      const page = await remote.pageTombstones(start.tombstones - CURSOR_OVERLAP_MS, after);
      for (const mark of page.items) await this.applyTombstone(mark);
      await this.advanceCursor('tombstones', page.items);
      after = page.next;
    } while (after !== null && this.active);

    after = null;
    do {
      const page = await remote.pageNotes(start.notes - CURSOR_OVERLAP_MS, after);
      for (const note of page.items) await this.applyNote(note);
      await this.advanceCursor('notes', page.items);
      after = page.next;
    } while (after !== null && this.active);

    this.flushQueueKick();
    if (!this.active) return;
    this.detachWatch();
    this.unwatch = remote.watch(await this.readCursor(), {
      onNotes: (items) => {
        this.inbox.notes.push(...items);
        this.wake(0);
      },
      onTombstones: (items) => {
        this.inbox.tombstones.push(...items);
        this.wake(0);
      },
      onError: (error) => {
        this.detachWatch();
        this.caughtUp = false;
        this.onFailure(error);
      },
    });
    this.caughtUp = true;
  }

  private detachWatch(): void {
    this.unwatch?.();
    this.unwatch = undefined;
  }

  private async drainInbox(): Promise<void> {
    while (this.inbox.tombstones.length > 0 || this.inbox.notes.length > 0) {
      const { notes, tombstones } = this.inbox;
      this.inbox = { notes: [], tombstones: [] };
      for (const mark of tombstones) await this.applyTombstone(mark);
      await this.advanceCursor('tombstones', tombstones);
      for (const note of notes) await this.applyNote(note, { fromLiveStream: true });
      await this.advanceCursor('notes', notes);
    }
    this.flushQueueKick();
  }

  private flushQueueKick(): void {
    if (!this.queueTouched) return;
    this.queueTouched = false;
    kickQueue();
  }

  private async applyNote(item: RemoteNote, { fromLiveStream = false } = {}): Promise<void> {
    const { database } = this;
    const { fields } = item;
    // Notes and tombstones arrive on separate streams, so a note unknown here may be
    // a stale snapshot of something already removed. It must not come back as a ghost.
    if (fromLiveStream && !(await database.captures.get(fields.id))) {
      if (await (await this.remote()).readTombstone(fields.id)) return;
    }
    const photos = {
      image: new Blob([item.blobs.image as BlobPart], { type: 'image/jpeg' }),
      thumb: new Blob([item.blobs.thumb as BlobPart], { type: 'image/jpeg' }),
    };
    const nowQueued = await database.transaction('rw', database.captures, database.kv, async () => {
      const local = await database.captures.get(fields.id);
      if (!local) {
        // Deleted here a moment ago: this copy is on its way out of the cloud.
        const outbox = outboxFrom(await database.kv.get(SYNC_OUTBOX_KEY));
        if (outbox.some((entry) => entry.id === fields.id)) return false;
      }
      const decision = decideMerge(local, fields);
      if (decision === 'keep') return false;
      if (decision === 'mark_clean') {
        if (local && local.syncedAt !== local.updatedAt) {
          await database.captures.update(local.id, { syncedAt: local.updatedAt });
        }
        return false;
      }
      const merged = mergeRemote(local, fields, photos);
      await database.captures.put(merged);
      return merged.status === 'queued';
    });
    if (nowQueued) this.queueTouched = true;
  }

  /**
   * A note left the cloud from another device. A clean copy leaves here too. A copy
   * with unsaved work stays, but only on this device: uploading it would undo the
   * student's decision, and that decision may have been to make it private.
   */
  private async applyTombstone(mark: RemoteTombstone): Promise<void> {
    const { database } = this;
    const stillSynced = (note: Capture | undefined): note is Capture =>
      Boolean(note) && note!.isPrivate === false && note!.syncedAt !== undefined && note!.syncedAt !== SYNC_REMOVED;

    if (!stillSynced(await database.captures.get(mark.id))) return;
    // The note may have been shared again after this tombstone was written.
    if (!(await (await this.remote()).readTombstone(mark.id))) return;

    await database.transaction('rw', database.captures, database.aids, database.cards, async () => {
      const note = await database.captures.get(mark.id);
      if (!stillSynced(note)) return;
      if (mark.wiped) await database.captures.update(mark.id, { syncedAt: SYNC_REMOVED });
      else if (note.syncedAt === note.updatedAt) await removeNoteRows(mark.id, database);
      else await database.captures.update(mark.id, { isPrivate: true, syncedAt: SYNC_REMOVED });
    });
    if (mark.wiped) this.wipedElsewhere = true;
  }

  /* ----- Uploads ----- */

  private async pushDirty(): Promise<void> {
    const dirty = await this.database.captures
      .filter((note) => isSyncable(note) && note.status !== 'processing' && note.syncedAt !== note.updatedAt)
      .toArray();
    for (const note of dirty) {
      if (!this.active) return;
      if (this.refused.has(versionKey(note))) continue;
      // A note made private while this list runs is deleted before anything else goes up.
      await this.flushDeletes();
      await this.pushOne(note.id);
    }
  }

  private async pushOne(id: string): Promise<void> {
    const { database } = this;
    const note = await database.transaction('rw', database.captures, async () => {
      const current = await database.captures.get(id);
      if (!current || !isSyncable(current) || current.status === 'processing') return null;
      if (current.syncedAt === current.updatedAt) return null;
      // Recorded before the upload, so a later "make private" knows a copy may exist.
      if (current.syncedAt === undefined) await database.captures.update(id, { syncedAt: SYNC_ATTEMPTED });
      return current;
    });
    if (!note || this.refused.has(versionKey(note))) return;

    const hasCloudPhoto = note.syncedAt !== undefined && note.syncedAt > SYNC_ATTEMPTED;
    let blobs: NoteBlobs | null = null;
    try {
      const fields = serializeNote(note);
      if (!hasCloudPhoto) blobs = await fitPhotos(note, this.options.compress);
      assertFits(fields, blobs);

      // Compressing takes a moment, and the student may have acted in the meantime.
      const latest = await database.captures.get(id);
      if (!latest || !isSyncable(latest) || latest.updatedAt !== note.updatedAt) {
        this.again = true;
        return;
      }
      await (await this.remote()).put(fields, blobs, { revive: note.syncedAt === SYNC_REMOVED });
      this.tooLarge.delete(id);
      await database.captures.update(id, { syncedAt: note.updatedAt });
    } catch (error) {
      if (error instanceof NoteTooLargeError) {
        this.tooLarge.add(id);
        this.refused.add(versionKey(note));
        return;
      }
      if (!REFUSALS.has(errorCode(error))) throw error;
      await this.reconcile(note, blobs !== null);
    }
  }

  /** The server refused a write. Finds out why, and settles this note without looping. */
  private async reconcile(note: Capture, wroteWholeNote: boolean): Promise<void> {
    const remote = await this.remote();
    const mark = await remote.readTombstone(note.id);
    if (mark) {
      await this.applyTombstone(mark);
    } else {
      const current = await remote.readNote(note.id);
      if (current) {
        await this.applyNote(current);
        this.flushQueueKick();
      } else if (!wroteWholeNote) {
        // The cloud copy is gone. Upload the whole note, photo included, on the next pass.
        await this.database.captures.update(note.id, { syncedAt: SYNC_ATTEMPTED });
        this.again = true;
        return;
      }
    }
    const after = await this.database.captures.get(note.id);
    if (after && after.updatedAt === note.updatedAt && after.syncedAt !== after.updatedAt) {
      this.refused.add(versionKey(note));
    }
  }
}

/* ---------- App-wide state ---------- */

export interface SyncStatus {
  phase: SyncPhase;
  tooLarge: number;
  stoppedElsewhere: boolean;
  lastSyncAt: number | null;
}

let status: SyncStatus = { phase: 'off', tooLarge: 0, stoppedElsewhere: false, lastSyncAt: null };
const listeners = new Set<() => void>();

export const syncStatus = (): SyncStatus => status;

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(patch: Partial<SyncStatus>): void {
  const next = { ...status, ...patch };
  if (
    next.phase === status.phase &&
    next.tooLarge === status.tooLarge &&
    next.stoppedElsewhere === status.stoppedElsewhere &&
    next.lastSyncAt === status.lastSyncAt
  ) {
    return;
  }
  status = next;
  listeners.forEach((listener) => listener());
}

let firestoreLoad: Promise<{ sdk: FirestoreSdk; firestore: Firestore }> | null = null;

/** Firestore is loaded on demand. Dexie is the durable store, so its cache stays in memory. */
function loadFirestore(): Promise<{ sdk: FirestoreSdk; firestore: Firestore }> {
  firestoreLoad ??= import('firebase/firestore')
    .then((sdk) => ({ sdk, firestore: sdk.initializeFirestore(firebaseApp, { localCache: sdk.memoryLocalCache() }) }))
    .catch((error: unknown) => {
      firestoreLoad = null;
      throw error;
    });
  return firestoreLoad;
}

async function firestoreRemote(uid: string): Promise<RemoteStore> {
  const { sdk, firestore } = await loadFirestore();
  return createFirestoreRemote(sdk, firestore, uid);
}

let engine: SyncEngine | null = null;
let engineUid: string | null = null;

/** Only one tab per browser talks to the cloud. The others take over if it closes. */
function runExclusive(uid: string, current: SyncEngine): void {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) {
    current.start();
    return;
  }
  void locks
    .request(`alrato-sync-${uid}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      current.start();
      await current.whenStopped();
      return true;
    })
    .then((held) => {
      if (held || engine !== current) return;
      publish({ phase: 'standby' });
      void locks.request(`alrato-sync-${uid}`, async () => {
        if (engine !== current) return;
        current.start();
        await current.whenStopped();
      });
    });
}

async function attach(uid: string | null): Promise<void> {
  if (uid === engineUid) return;
  engine?.stop();
  engine = null;
  engineUid = uid;
  if (!uid) {
    publish({ phase: 'off', tooLarge: 0 });
    return;
  }
  const enabled = (await kvGet<string | null>(SYNC_ENABLED_KEY, null)) === uid;
  if (engineUid !== uid) return;
  const current = new SyncEngine({
    uid,
    enabled,
    getRemote: () => firestoreRemote(uid),
    onPhase: (phase, { tooLarge }) => {
      publish({ phase, tooLarge, ...(phase === 'synced' ? { lastSyncAt: Date.now() } : {}) });
    },
    onWipedElsewhere: () => {
      void kvSet(SYNC_ENABLED_KEY, null);
      publish({ stoppedElsewhere: true });
    },
  });
  engine = current;
  publish({ phase: enabled ? 'starting' : 'off' });
  runExclusive(uid, current);
}

const signedInUid = (): string | null => {
  const auth = authState();
  return auth.phase === 'signed_in' ? auth.account.uid : null;
};

let initialized = false;

/** Connects sync to the account. Call only when Firebase is configured. */
export function initSync(): void {
  if (!isFirebaseConfigured || initialized) return;
  initialized = true;
  subscribeAuth(() => void attach(signedInUid()));
  void attach(signedInUid());
  void resumeSession();
}

/** Notes pulled for one account must not count as synced for another. */
async function forgetCloudState(): Promise<void> {
  await db.transaction('rw', db.captures, db.kv, async () => {
    await db.captures.toCollection().modify((note) => {
      delete note.syncedAt;
    });
    await db.kv.where('key').startsWith('sync.cursor.').delete();
  });
}

/** How many notes turning sync on would upload. For a new account, that is all of them. */
export async function countToUpload(): Promise<number> {
  const uid = signedInUid();
  const owner = await kvGet<string | null>(SYNC_OWNER_KEY, null);
  const notes = await db.captures.filter(isSyncable).toArray();
  return owner && owner !== uid ? notes.length : notes.filter((note) => note.syncedAt !== note.updatedAt).length;
}

export async function enableSync(): Promise<void> {
  const uid = signedInUid();
  if (!uid) throw new Error('not_signed_in');
  const owner = await kvGet<string | null>(SYNC_OWNER_KEY, null);
  if (owner && owner !== uid) await forgetCloudState();
  await kvSet(SYNC_OWNER_KEY, uid);
  await kvSet(SYNC_ENABLED_KEY, uid);
  publish({ stoppedElsewhere: false, phase: engine?.isStandby ? 'standby' : 'starting' });
  engine?.setEnabled(true);
}

export async function disableSync(): Promise<void> {
  await kvSet(SYNC_ENABLED_KEY, null);
  engine?.setEnabled(false);
  publish({ phase: 'off' });
}

/** Called after "erase this device", so sync cannot quietly refill or misread an empty library. */
export async function afterLocalErase(): Promise<void> {
  await kvSet(SYNC_ENABLED_KEY, null);
  engine?.setEnabled(false);
  await engine?.idle();
  await db.kv.where('key').startsWith('sync.cursor.').delete();
  publish({ phase: 'off' });
}

/**
 * Removes every note of this account from the cloud. Notes on this device stay.
 * Tombstones marked `wiped` make other devices stop syncing and keep their copies.
 */
export async function deleteCloudCopy(): Promise<void> {
  const uid = signedInUid();
  if (!uid) throw new Error('not_signed_in');
  await kvSet(SYNC_ENABLED_KEY, null);
  engine?.setEnabled(false);
  await engine?.idle();

  const remote = await firestoreRemote(uid);
  const inCloud = (note: Capture) => note.syncedAt !== undefined && note.syncedAt !== SYNC_REMOVED;
  const known = (await db.captures.filter(inCloud).primaryKeys()) as string[];
  await remote.remove(known, { wiped: true });
  for (;;) {
    const remaining = await remote.listNoteIds(50);
    if (remaining.length === 0) break;
    await remote.remove(remaining, { wiped: true });
  }
  await db.transaction('rw', db.captures, db.kv, async () => {
    await db.captures.filter(inCloud).modify({ syncedAt: SYNC_REMOVED });
    await db.kv.delete(cursorKey(uid));
    const outbox = outboxFrom(await db.kv.get(SYNC_OUTBOX_KEY));
    await db.kv.put({ key: SYNC_OUTBOX_KEY, value: outbox.filter((entry) => entry.uid !== uid) });
  });
  publish({ phase: 'off', stoppedElsewhere: false });
}
