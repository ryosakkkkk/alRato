import type { InferenceMode } from 'firebase/ai';

export type Lang = 'en' | 'es';
export type NoteKind = 'board' | 'formula' | 'exercise' | 'question' | 'other';
export type CaptureStatus = 'queued' | 'processing' | 'ready' | 'needs_review' | 'failed';
export type AiTask = 'read' | 'analyze' | 'help';
export type InferenceOrigin = 'on_device' | 'in_cloud';
export type HelpAction = 'key_ideas' | 'explain' | 'hint' | 'answer';
export type RoutePreference = 'balanced' | 'local' | 'quality';

/** Why a capture is parked instead of being processed right now. */
export type WaitReason =
  | 'private_needs_device'
  | 'offline_no_model'
  | 'cloud_unavailable'
  | 'cloud_cap_no_model'
  /** The cloud is the only route and the student has not answered the consent sheet yet. */
  | 'needs_consent'
  /** The cloud is the only route and the student chose to keep everything on this device. */
  | 'cloud_declined';

/** Why the router picked a given inference mode. Shown to the student. */
export type RouteReason =
  | 'private_note'
  | 'offline'
  | 'no_cloud'
  | 'cloud_cap'
  | 'no_local_model'
  | 'user_local'
  | 'user_quality'
  | 'save_data'
  | 'vision_quality'
  | 'classify_quality'
  | 'long_input'
  | 'everyday_local'
  | 'device_failed_fallback';

/** Proof of where one AI answer was produced and what left the device. */
export interface Receipt {
  task: AiTask;
  /** Reported by the SDK (`response.inferenceSource`), never inferred. */
  source: InferenceOrigin;
  mode: InferenceMode;
  reason: RouteReason;
  latencyMs: number;
  /** Bytes of prompt and image sent over the network. Zero when on-device. */
  bytesSent: number;
  imageSent: boolean;
  model: string;
  at: number;
}

export interface Capture {
  id: string;
  createdAt: number;
  updatedAt: number;
  image: Blob;
  thumb: Blob;
  comment: string;
  text: string;
  textBy: 'none' | 'ai' | 'student';
  legibility: 'high' | 'medium' | 'low' | null;
  kind: NoteKind;
  title: string;
  subject: string;
  topic: string;
  /** Concepts this note explains, in the student's language. */
  teaches: string[];
  /** The same concepts as canonical English terms, so notes match across languages. */
  teachesKeys: string[];
  /** Prior knowledge this note depends on, as canonical English terms. */
  needsKeys: string[];
  status: CaptureStatus;
  waitReason: WaitReason | null;
  errorCode: string | null;
  attempts: number;
  nextAttemptAt: number;
  /** Incremented on every student edit. Late AI answers for an older revision are dropped. */
  revision: number;
  analyzedRevision: number;
  /** Fields the student set by hand. AI suggestions never overwrite them. */
  locked: Partial<Record<'kind' | 'title' | 'subject' | 'topic', boolean>>;
  isPrivate: boolean;
  isSample: boolean;
  receipts: Receipt[];
  /** Firestore sync bookkeeping. */
  syncedAt?: number;
}

export interface StudyAid {
  id: string;
  captureId: string;
  revision: number;
  action: HelpAction;
  level: number;
  body: string;
  link: { captureId: string; why: string } | null;
  practice: { question: string; answer: string } | null;
  receipt: Receipt;
  promptVersion: string;
  createdAt: number;
  /** True when the note was private at the time, so the hint may have drawn on other private notes. */
  madeWhilePrivate?: boolean;
}

export type ReviewResult = 'remembered' | 'needed_help';

export interface Card {
  id: string;
  captureId: string;
  question: string;
  answer: string;
  box: number;
  dueAt: number;
  lastResult: ReviewResult | null;
  reps: number;
  createdAt: number;
}

export interface UsageEvent {
  id?: number;
  at: number;
  task: AiTask;
  source: InferenceOrigin;
  latencyMs: number;
  bytesSent: number;
  bytesKept: number;
}
