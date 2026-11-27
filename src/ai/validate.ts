import { compileExpression, compileFunction, evaluateConstant, MAX_PLOT_CHARS } from '../core/plot';
import type { NoteKind, VisualSpec } from '../core/types';
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
  /** The picture to draw under a full solution, only when every part of it can be read safely. */
  visual: VisualSpec | null;
  /** The solver's method in a few words. */
  plan: string;
}

const invalid = (detail: string) => new AlRatoAiError('invalid_output', detail);

/**
 * Models sometimes write LaTeX inside JSON without doubling the backslash. "\gamma" is then not a
 * valid JSON escape and the whole answer would be lost, so a backslash that starts no JSON escape
 * is doubled before parsing. Valid JSON never has such a backslash, so nothing correct changes.
 */
function escapeStrayBackslashes(json: string): string {
  // Valid escapes, "\\" included, are read as whole pairs, so the second backslash of "\\sum" is never doubled.
  return json.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (match, escape: string | undefined) =>
    escape === undefined ? '\\\\' : match,
  );
}

/**
 * The other half of the same mistake: "\rho", "\theta", "\beta" and "\frac" are valid JSON escapes,
 * so they arrive as a carriage return, a tab, a backspace or a form feed followed by letters. Those
 * characters never belong in a note, so they become the backslash they came from. A line feed is
 * turned back only inside inline $...$ math that closes on the same line, as in "$\nu$", because a
 * real line break cannot occur there.
 */
export function repairLatex(text: string): string {
  const fixed = text
    .replace(/\r(?=[a-zA-Z])/g, '\\r')
    .replace(/\t(?=[a-zA-Z])/g, '\\t')
    .replace(/\u0008(?=[a-zA-Z])/g, '\\b')
    .replace(/\f(?=[a-zA-Z])/g, '\\f');
  if (!fixed.includes('\n') || !fixed.includes('$')) return fixed;
  let out = '';
  let inMath = false;
  for (let i = 0; i < fixed.length; i += 1) {
    const c = fixed[i];
    if (c === '$') {
      if (fixed[i + 1] === '$') {
        out += '$$';
        i += 1;
        continue;
      }
      inMath = !inMath;
    } else if (c === '\n') {
      const rest = fixed.slice(i + 1);
      const close = rest.indexOf('$');
      const nextBreak = rest.indexOf('\n');
      if (inMath && /^[a-zA-Z]/.test(rest) && close >= 0 && (nextBreak < 0 || close < nextBreak)) {
        out += '\\n';
        continue;
      }
      inMath = false;
    }
    out += c;
  }
  return out;
}

export function parseJson(raw: string): Record<string, unknown> {
  const unfenced = escapeStrayBackslashes(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
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
  typeof value === 'string' ? repairLatex(value).trim().slice(0, max) : '';

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
  const legacyPlot = plotSource && compileFunction(plotSource) ? plotSource : null;
  const visual = validateVisual(raw.visual) ?? (legacyPlot ? { kind: 'graph' as const, f: legacyPlot } : null);
  // The plain graph keeps its old field too, so the device check of older solutions still finds it.
  const plot = legacyPlot ?? (visual?.kind === 'graph' ? visual.f : null);

  return { body, link, practice, plot, visual, plan: str(raw.plan, 80) };
}

const constantOf = (value: unknown): number | null =>
  typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'string' && value.trim() ? evaluateConstant(value) : null;

/**
 * The picture a solver asked for, checked piece by piece: every formula must be one the device can
 * read safely and every number must make sense. Anything else is dropped, never the solution.
 */
export function validateVisual(raw: unknown): VisualSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const f = str(v.f, MAX_PLOT_CHARS);
  const g = str(v.g, MAX_PLOT_CHARS);
  const a = constantOf(v.a);
  const b = constantOf(v.b);
  switch (v.kind) {
    case 'graph':
      return compileFunction(f) ? { kind: 'graph', f } : null;
    case 'intersection':
      return compileFunction(f) && compileFunction(g) ? { kind: 'intersection', f, g } : null;
    case 'area':
      return compileFunction(f) && a !== null && b !== null && a < b && b - a <= 60 ? { kind: 'area', f, a, b } : null;
    case 'tangent': {
      const fn = compileFunction(f);
      if (!fn) return null;
      return a !== null && Number.isFinite(fn(a)) && Math.abs(a) <= 50 ? { kind: 'tangent', f, a } : { kind: 'graph', f };
    }
    case 'unit_circle': {
      const trig = /tan|tg/i.test(f) ? 'tan' : /cos/i.test(f) ? 'cos' : 'sin';
      return a !== null && Math.abs(a) <= 100 ? { kind: 'unit_circle', f: trig, a } : { kind: 'unit_circle', f: trig };
    }
    case 'parametric': {
      const x = compileExpression(f, { variable: 't' });
      const y = compileExpression(g, { variable: 't' });
      const from = a ?? 0;
      const to = b ?? 2 * Math.PI;
      return x && y && from < to && to - from <= 200 ? { kind: 'parametric', f, g, a: from, b: to } : null;
    }
    default:
      return null;
  }
}
