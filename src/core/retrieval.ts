import type { Capture } from './types';
import { clip, conceptKey, tokenize } from './text';

export interface Candidate {
  captureId: string;
  title: string;
  snippet: string;
  score: number;
}

export const MAX_CANDIDATES = 3;
export const MIN_SCORE = 2;
const SNIPPET_CHARS = 260;

type Searchable = Pick<
  Capture,
  'id' | 'title' | 'topic' | 'subject' | 'text' | 'teaches' | 'teachesKeys' | 'needsKeys'
>;

/** 1 for the same concept, 0.6 when one phrase contains the other, otherwise 0. */
function phraseMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(' ');
  const tb = new Set(b.split(' '));
  const shared = ta.filter((t) => tb.has(t)).length;
  return shared > 0 && shared === Math.min(ta.length, tb.size) ? 0.6 : 0;
}

function bestOverlap(wanted: string[], offered: string[]): number {
  let total = 0;
  for (const w of wanted) {
    let best = 0;
    for (const o of offered) best = Math.max(best, phraseMatch(w, o));
    total += best;
  }
  return total;
}

function termFrequencies(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function searchableText(note: Searchable): string {
  return [note.title, note.topic, note.teaches.join(' '), note.text].join(' ');
}

function cosine(a: Map<string, number>, b: Map<string, number>, idf: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, freq] of a) {
    const weight = freq * (idf.get(term) ?? 1);
    normA += weight * weight;
    const other = b.get(term);
    if (other) dot += weight * other * (idf.get(term) ?? 1);
  }
  for (const [term, freq] of b) {
    const weight = freq * (idf.get(term) ?? 1);
    normB += weight * weight;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/**
 * Finds earlier notes that could help with `current`. Runs fully on the device.
 *
 * The strongest signal is prerequisite matching: what this note *needs* against
 * what older notes *teach*. That links "Bellman equation" to "weighted average"
 * even when the two notes share almost no words.
 */
export function rankCandidates<T extends Searchable>(
  current: Searchable,
  library: T[],
  limit = MAX_CANDIDATES,
): Candidate[] {
  const others = library.filter((n) => n.id !== current.id && n.text.trim().length > 0);
  if (others.length === 0) return [];

  const docs = others.map((n) => termFrequencies(searchableText(n)));
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, df] of documentFrequency) idf.set(term, Math.log(1 + (others.length + 1) / (df + 0.5)));

  const currentTerms = termFrequencies(searchableText(current));
  const needs = current.needsKeys.map(conceptKey);
  const teaches = current.teachesKeys.map(conceptKey);
  const sameTopic = conceptKey(current.topic);
  const sameSubject = conceptKey(current.subject);

  return others
    .map((note, index) => {
      const noteTeaches = note.teachesKeys.map(conceptKey);
      let score = 0;
      score += 5 * bestOverlap(needs, noteTeaches);
      score += 2 * bestOverlap(teaches, noteTeaches);
      if (sameTopic && conceptKey(note.topic) === sameTopic) score += 1.5;
      if (sameSubject && conceptKey(note.subject) === sameSubject) score += 0.5;
      score += 3 * cosine(currentTerms, docs[index], idf);
      return {
        captureId: note.id,
        title: note.title || note.topic,
        snippet: clip(note.text, SNIPPET_CHARS),
        score: Math.round(score * 100) / 100,
      };
    })
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Library search: matches words in any order, ignoring case and accents. */
export function searchNotes<T extends Searchable>(query: string, library: T[]): T[] {
  const terms = tokenize(query);
  if (terms.length === 0) return library;
  return library.filter((note) => {
    const haystack = new Set(tokenize([searchableText(note), note.subject].join(' ')));
    return terms.every((term) => [...haystack].some((word) => word.startsWith(term)));
  });
}
