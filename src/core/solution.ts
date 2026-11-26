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

/**
 * Splits a worked solution into steps, one per non-empty line. The stepper draws its own
 * markers, so a leading "1." or "-" is taken off the text. Returns no steps when the answer has
 * fewer than two lines: a single paragraph reads better as plain text.
 */
export function splitSolution(text: string): SolutionLine[] {
  const lines: SolutionLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const numbered = NUMBERED.exec(line);
    const bullet = numbered ? null : BULLET.exec(line);
    const body = (numbered ? (numbered[2] ?? '') : bullet ? (bullet[1] ?? '') : line).trim();
    if (!body) continue;
    lines.push({ n: numbered ? Number(numbered[1]) : null, text: body });
  }
  return lines.length >= 2 ? lines : [];
}
