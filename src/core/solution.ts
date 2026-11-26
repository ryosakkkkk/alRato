/** One line of a worked solution: a numbered step, a bullet or a plain sentence. */
export interface SolutionLine {
  /** The number the model wrote for this step, when it wrote one. */
  n: number | null;
  /** The line without its list marker. Keeps the $...$ math for MathText. */
  text: string;
}

// The text after a marker is optional, so a bare "1." or "-" is recognised and then skipped as empty.
const NUMBERED = /^(\d{1,2})[.)](?:\s+(.*))?$/;
const BULLET = /^[-*•](?:\s+(.*))?$/;
const MATH = /(\$\$[^$]+\$\$|\$[^$\n]+\$)/;

/**
 * Splits a paragraph into sentences, never inside $...$ math, so "0.7 · 11 = 7.7" stays whole.
 * A sentence ends at . ! or ? followed by a space and a capital letter or an opening mark.
 */
function sentences(paragraph: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of paragraph.split(MATH)) {
    if (MATH.test(piece) && piece.startsWith('$')) {
      current += piece;
      continue;
    }
    const parts = piece.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/);
    parts.forEach((part, i) => {
      if (i > 0) {
        out.push(current);
        current = '';
      }
      current += part;
    });
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function lineOf(raw: string): SolutionLine | null {
  const line = raw.trim();
  if (!line) return null;
  const numbered = NUMBERED.exec(line);
  const bullet = numbered ? null : BULLET.exec(line);
  const body = (numbered ? (numbered[2] ?? '') : bullet ? (bullet[1] ?? '') : line).trim();
  return body ? { n: numbered ? Number(numbered[1]) : null, text: body } : null;
}

/**
 * Splits a worked solution into steps. The model is asked for one step per line; when it writes
 * one paragraph instead ("First, … Next, … Finally, …"), its sentences become the steps. The stepper
 * draws its own markers, so a leading "1." or "-" is taken off. Returns no steps when there is no
 * sequence at all (a single sentence), so the caller can show plain text.
 */
export function splitSolution(text: string): SolutionLine[] {
  let lines = text.split('\n').map(lineOf).filter((line): line is SolutionLine => line !== null);
  if (lines.length === 1) {
    lines = sentences(lines[0].text).map((sentence) => ({ n: null, text: sentence }));
  }
  return lines.length >= 2 ? lines : [];
}
