import type { InferenceMode } from 'firebase/ai';
import type { SolutionCheck } from './verifier';

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
  /** App Check refused this browser, so cloud AI waits for the pause to end. */
  | 'app_check_paused'
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
  | 'solution_quality'
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
  /** Function of x drawn under a full solution. Only the last level may have one: a graph shows the answer. */
  plot?: string | null;
  /** The picture the solver chose for a full solution, drawn on the device. */
  visual?: VisualSpec | null;
  /** The method the solver planned, in a few words. */
  plan?: string;
  /** The device's own check of a full solution; null when it could not tell. Absent on older aids. */
  check?: SolutionCheck | null;
  /** True when the device found a mistake and the solver wrote a corrected solution. */
  repaired?: boolean;
  /** Every model call behind this aid, in order: the first attempt and, if any, the correction. */
  attempts?: Receipt[];
  /** Concepts from the student's history that the tutor was told about. */
  memory?: string[];
}

/** The kinds of picture the device can draw under a solution, as in an animated math video. */
export type VisualKind = 'graph' | 'intersection' | 'area' | 'tangent' | 'unit_circle' | 'parametric';

export interface VisualSpec {
  kind: VisualKind;
  /** A function of x; x(t) for a curve; "sin", "cos" or "tan" for the unit circle. */
  f: string;
  /** The second function, or y(t) for a curve. */
  g?: string;
  /** The start of an interval, the point of a tangent, or the angle on the unit circle. */
  a?: number;
  b?: number;
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
