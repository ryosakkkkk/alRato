import { compileFunction, MAX_PLOT_CHARS } from '../core/plot';
import type { NoteKind } from '../core/types';
import { AlRatoAiError } from './errors';

export interface ReadOutput {
  text: string;
  legibility: 'high' | 'medium' | 'low';
}

export interface AnalysisOutput {
  kind: NoteKind;
  title: string;
  subject: string;
  topic: string;
  teaches: string[];
  teachesKeys: string[];
  needsKeys: string[];
  needsReview: boolean;
}

export interface HelpOutput {
  body: string;
  link: { captureId: string; why: string } | null;
  practice: { question: string; answer: string } | null;
  /** A function of x to draw under the solution, only when it can be read safely. */
  plot: string | null;
}

const invalid = (detail: string) => new AlRatoAiError('invalid_output', detail);

export function parseJson(raw: string): Record<string, unknown> {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw invalid('no_json_object');
  try {
    const value: unknown = JSON.parse(unfenced.slice(start, end + 1));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    throw invalid('malformed_json');
  }
  throw invalid('not_an_object');
}

const str = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const list = (value: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map((v) => str(v, maxLen)).filter(Boolean))].slice(0, maxItems)
    : [];

export function validateRead(raw: Record<string, unknown>): ReadOutput {
  const text = str(raw.text, 6000);
  if (!text) throw invalid('empty_text');
  const legibility = raw.legibility === 'high' || raw.legibility === 'low' ? raw.legibility : 'medium';
  return { text, legibility };
}

const KINDS: NoteKind[] = ['board', 'formula', 'exercise', 'question', 'other'];

export function validateAnalysis(raw: Record<string, unknown>): AnalysisOutput {
  const title = str(raw.title, 70);
  const subject = str(raw.subject, 50);
  const topic = str(raw.topic, 60);
  if (!title || !subject) throw invalid('missing_labels');
  return {
    kind: KINDS.includes(raw.kind as NoteKind) ? (raw.kind as NoteKind) : 'other',
    title,
    subject,
    topic: topic || title,
    teaches: list(raw.teaches, 5, 50),
    teachesKeys: list(raw.teaches_en, 6, 50).map((k) => k.toLowerCase()),
    needsKeys: list(raw.needs_en, 6, 50).map((k) => k.toLowerCase()),
    needsReview: raw.needs_review === true,
  };
}

/**
 * The model may cite a prior note only by an id we offered. Anything else is
 * dropped, so a hallucinated reference can never become a link.
 */
export function validateHelp(raw: Record<string, unknown>, candidateIds: readonly string[]): HelpOutput {
  const body = str(raw.help, 2400);
  if (!body) throw invalid('empty_help');

  const sourceId = str(raw.source_id, 64);
  const why = str(raw.connection, 320);
  const link = sourceId && why && candidateIds.includes(sourceId) ? { captureId: sourceId, why } : null;

  const question = str(raw.practice_q, 240);
  const answer = str(raw.practice_a, 320);
  const practice = question && answer ? { question, answer } : null;

  const plotSource = str(raw.plot, MAX_PLOT_CHARS);
  const plot = plotSource && compileFunction(plotSource) ? plotSource : null;

  return { body, link, practice, plot };
}
