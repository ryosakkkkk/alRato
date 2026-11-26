import { compileFunction, frameFunction } from './plot';

/**
 * The hybrid check: the cloud model writes the solution, and this device verifies its answers by
 * putting them into the function itself. No model is involved, so the check is exact and private.
 */
export interface AnswerCheck {
  /** Each answer the solution gives, with the value of the function there (zero when it is right). */
  values: { x: number; y: number }[];
}

/** Numbers stated in a line, ignoring exponents and subscripts, with \frac{a}{b} read as a / b. */
export function statedNumbers(line: string): number[] {
  const math = [...line.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]).join(' ') || line;
  const plain = math
    .replace(/\\[dt]?frac\{(-?[\d.,]+)\}\{(-?[\d.,]+)\}/g, (_, a: string, b: string) =>
      String(Number(a.replace(',', '.')) / Number(b.replace(',', '.'))),
    )
    .replace(/[\^_]\{[^}]*\}/g, ' ')
    .replace(/[\^_]\S/g, ' ')
    .replace(/\{,\}/g, ',');
  return [...plain.matchAll(/([−-]\s*)?(\d+(?:[.,]\d+)?)/g)].map((m) => {
    const value = Number(m[2].replace(',', '.'));
    return m[1] ? -value : value;
  });
}

/**
 * Checks the final line of a solution against the function the model named. It only says
 * something when every zero of the function is among the stated answers; otherwise it stays quiet
 * rather than guess.
 */
export function checkAnswers(plot: string, finalLine: string): AnswerCheck | null {
  const fn = compileFunction(plot);
  if (!fn) return null;
  const { roots } = frameFunction(fn);
  if (roots.length === 0) return null;
  const numbers = statedNumbers(finalLine);
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
  const answers = roots.map((r) => numbers.find((n) => close(n, r)));
  if (answers.some((a) => a === undefined)) return null;
  return { values: (answers as number[]).map((x) => ({ x, y: fn(x) })) };
}
