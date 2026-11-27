import { mainMath } from './morph';
import { compileExpression, evaluateConstant, frameFunction, plainMath, type Fn } from './plot';
import { statedNumbers } from './verify';

/*
 * The verifier: the device's own check of a worked solution, with no model involved. It reads the
 * exercise from the student's note, recognises what kind of task it is, and tests the final answer
 * with arithmetic: an equation's answers are put back into it, a derivative is compared with the
 * slope of the function, an integral with a numeric integration. When it cannot tell, it says
 * nothing rather than guess.
 */

export type CheckStatus = 'verified' | 'mismatch';

export type SolutionCheck =
  | {
      kind: 'equation';
      status: CheckStatus;
      /** Each answer the solution gives, the value of left side minus right side there, and whether it holds. */
      values: { x: number; y: number; ok: boolean }[];
      /** Where the equation really holds, as far as the device can find them. */
      roots: number[];
    }
  | {
      kind: 'derivative' | 'antiderivative';
      status: CheckStatus;
      /** How many sample points were compared. */
      points: number;
      /** The point that disagrees most, when there is one. */
      worst: { x: number; expected: number; stated: number } | null;
    }
  | {
      kind: 'derivative_at';
      status: CheckStatus;
      at: number;
      computed: number;
      stated: number;
    }
  | {
      /** A calculation with no unknown, such as sin(π/6) = 1/2: both sides are evaluated. */
      kind: 'integral' | 'arithmetic';
      status: CheckStatus;
      computed: number;
      stated: number;
    };

type Task =
  | { kind: 'integral'; f: Fn; a: number; b: number }
  | { kind: 'antiderivative'; f: Fn }
  | { kind: 'derivative'; f: Fn; at: number | null }
  | { kind: 'equation'; F: Fn };

const MATH = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
const mathOf = (text: string): string[] => [...text.matchAll(MATH)].map((m) => (m[1] ?? m[2]).trim());
/** The math of a note: its $...$ pieces, or the whole text when it has none. */
const mathPieces = (text: string): string[] => {
  const pieces = mathOf(text);
  return pieces.length > 0 ? pieces : text.split('\n');
};

const MAX_EXPR = 200;

/** Takes off one pair of brackets around the whole expression: "(x^3 + 1)" but not "(x+1)(x-1)". */
function unwrap(source: string): string {
  const s = source.trim();
  if (!/^[[(]/.test(s)) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '(' || s[i] === '[') depth += 1;
    else if (s[i] === ')' || s[i] === ']') depth -= 1;
    if (depth === 0 && i < s.length - 1) return s;
  }
  return depth === 0 ? s.slice(1, -1) : s;
}
const fnOf = (source: string, requireVariable = true): Fn | null =>
  compileExpression(source.trim(), { maxChars: MAX_EXPR, requireVariable });
const unbrace = (s: string) => s.trim().replace(/^\{([^{}]*)\}$/, '$1');
const tidyIntegral = (s: string) =>
  s
    .replace(/∫/g, '\\int ')
    .replace(/\\mathrm\s*\{\s*d\s*\}/g, 'd')
    .replace(/\\[dt]?frac\s*\{\s*d\s*\}\s*\{\s*d\s*x\s*\}/g, '\\ddx ');

const INT_DEF = /\\int\s*_\s*(\{[^{}]*\}|[^\s^{}]+)\s*\^\s*(\{[^{}]*\}|[^\s{}]+)\s*(.+?)\s*(?:\\[,;!]\s*)*d\s*x(?![a-z])/;
const INT_INDEF = /\\int\s*(?![_^\s]*[_^])(.+?)\s*(?:\\[,;!]\s*)*d\s*x(?![a-z])/;
const DERIVATIVE_WORDS = /deriv|\\ddx|f\s*'|f\s*\^\s*\{?\s*\\prime|y\s*'|d\s*y\s*\/\s*d\s*x|dy\s*\}\s*\{\s*dx/i;
const EQUATION_WORDS = /resuelv|resolver|soluci|ra[ií]z|ra[ií]ces|ceros?\b|despej|solve|roots?\b|zeros?\b|intersec|corta/i;

/** Recognises the task in a note. Only what the device can check for sure gets a task. */
function detectTask(note: string, modelEquation: string | null): Task | null {
  const pieces = mathPieces(note).map(tidyIntegral);

  for (const piece of pieces) {
    const m = INT_DEF.exec(piece);
    if (!m) continue;
    const a = evaluateConstant(unbrace(m[1]));
    const b = evaluateConstant(unbrace(m[2]));
    const f = fnOf(m[3], false);
    if (a !== null && b !== null && f && a !== b) return { kind: 'integral', f, a, b };
  }
  for (const piece of pieces) {
    const m = INT_INDEF.exec(piece);
    if (!m || /\\int\s*_/.test(piece)) continue;
    const f = fnOf(m[1], false);
    if (f) return { kind: 'antiderivative', f };
  }

  const tidyNote = tidyIntegral(note);
  if (DERIVATIVE_WORDS.test(tidyNote)) {
    let f: Fn | null = null;
    for (const piece of pieces) {
      const afterOperator = /\\ddx\s*(.+)$/.exec(piece);
      const definition = /(?:^|[^'\w])(?:[fgh]\s*\(\s*x\s*\)|y)\s*=\s*([^=]+)$/.exec(piece);
      const source = afterOperator?.[1] ?? definition?.[1];
      if (source && !/'|\\prime/.test(source)) f = fnOf(unwrap(source));
      if (f) break;
    }
    if (f) {
      const point = /[fgh]\s*'\s*\(\s*([^)x]+?)\s*\)/.exec(tidyNote) ?? /(?:en|at)\s+\$?\s*x\s*=\s*([−-]?[\d.,]+)/i.exec(note);
      const at = point ? evaluateConstant(point[1].replace('−', '-')) : null;
      return { kind: 'derivative', f, at };
    }
    return null;
  }

  // A system such as y = 2x + 1, y = x^2 - 2 holds where its two functions meet.
  const parts = pieces.flatMap((piece) => piece.split(/,(?!\d)|;|\\\\|\\quad|&|\\(?:begin|end)\{cases\}/));
  const definitions = parts
    .map((part) => /^\s*(?:[fgh]\s*\(\s*x\s*\)|y)\s*=\s*([^=]+)$/.exec(part)?.[1])
    .filter((rhs): rhs is string => Boolean(rhs && fnOf(rhs)));
  if (definitions.length >= 2) {
    const F = fnOf(`(${plainMath(definitions[0])})-(${plainMath(definitions[1])})`);
    if (F && frameFunction(F).roots.length > 0) return { kind: 'equation', F };
  }

  for (const piece of parts) {
    if (!piece.includes('=')) continue;
    const isDefinition = /^\s*(?:[fgh]\s*\(\s*x\s*\)|y)\s*=/.test(piece);
    if (isDefinition && !EQUATION_WORDS.test(note)) continue;
    const F = fnOf(piece);
    if (F && frameFunction(F).roots.length > 0) return { kind: 'equation', F };
  }
  if (modelEquation && EQUATION_WORDS.test(note)) {
    const F = fnOf(modelEquation);
    if (F) return { kind: 'equation', F };
  }
  return null;
}

/** "x = 1", "x_2 = -3", "x = \frac{-2 \pm 4}{2}", "S = \{1, -3\}": the values the solution states for x. */
export function explicitAnswers(line: string): number[] {
  const math = mathOf(line).join(' ; ') || line;
  const s = plainMath(math)
    .replace(/\\pm|±/g, '±')
    .replace(/\\(?:approx|simeq)|≈/g, '=')
    .replace(/\\text\s*\{[^}]*\}/g, ' ; ')
    .replace(/\\(?:quad|qquad|lor|vee|land|wedge)/g, ' ; ')
    .replace(/\s(?:y|o|ó|u|and|or)\s/g, ' ; ');
  const split = /;|,(?!\d)/;
  const values: number[] = [];
  const evaluate = (raw: string) => {
    const text = raw.replace(/[.:]+\s*$/, '').trim();
    if (!text) return;
    const variants = text.includes('±') ? [text.replace('±', '+'), text.replace('±', '-')] : [text];
    for (const variant of variants) {
      const value = evaluateConstant(variant.replace(/^\+/, ''));
      if (value !== null) values.push(value);
    }
  };
  for (const set of s.matchAll(/\\\{([^{}]*)\\\}/g)) set[1].split(split).forEach(evaluate);
  for (const chunk of s.replace(/\\\{[^{}]*\\\}/g, ' ; ').split(split)) {
    const sides = chunk.split('=');
    if (sides.length < 2) continue;
    if (!/^\s*x\s*(?:_\s*(?:\{[^{}]*\}|\w))?\s*$/i.test(sides[0])) continue;
    evaluate(sides[sides.length - 1]);
  }
  return [...new Set(values.map((v) => Math.round(v * 1e9) / 1e9))];
}

const slopeOf = (f: Fn): Fn => (x) => {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f(x + h) - f(x - h)) / (2 * h);
};

/** An answer rounded to a few decimals still counts: the allowance grows with the slope there. */
function holds(F: Fn, x: number): boolean {
  const y = F(x);
  if (!Number.isFinite(y)) return false;
  const rounding = Math.max(0.006, 0.002 * Math.abs(x));
  const slope = Math.abs(slopeOf(F)(x));
  return Math.abs(y) <= 1e-6 + 1.5 * (Number.isFinite(slope) ? slope : 0) * rounding;
}

function checkEquation(F: Fn, finalLine: string): SolutionCheck | null {
  const { roots } = frameFunction(F);
  const answers = explicitAnswers(finalLine);
  if (answers.length > 0) {
    const values = answers.map((x) => ({ x, y: F(x), ok: holds(F, x) }));
    const status: CheckStatus = values.every((v) => v.ok) ? 'verified' : 'mismatch';
    return { kind: 'equation', status, values, roots };
  }
  // No "x = ..." to read: confirm only when every zero the device finds is among the stated numbers.
  if (roots.length === 0) return null;
  const numbers = statedNumbers(finalLine);
  const found = roots.map((r) => numbers.find((n) => Math.abs(n - r) <= Math.max(0.006, 0.002 * Math.abs(r))));
  if (found.some((n) => n === undefined)) return null;
  return { kind: 'equation', status: 'verified', values: (found as number[]).map((x) => ({ x, y: F(x), ok: true })), roots };
}

const SAMPLES = [-2.3, -1.7, -0.9, -0.35, 0.45, 1.15, 1.85, 2.6];

function compareFunctions(expected: Fn, stated: Fn, kind: 'derivative' | 'antiderivative'): SolutionCheck | null {
  let points = 0;
  let bad = 0;
  let worst: { x: number; expected: number; stated: number } | null = null;
  let worstError = 0;
  for (const x of SAMPLES) {
    const e = expected(x);
    const s = stated(x);
    if (!Number.isFinite(e) || !Number.isFinite(s)) continue;
    points += 1;
    const error = Math.abs(e - s) / (1e-4 + 2e-3 * Math.max(1, Math.abs(e)));
    if (error > 1) {
      bad += 1;
      if (error > worstError) {
        worstError = error;
        worst = { x, expected: e, stated: s };
      }
    }
  }
  if (points < 4) return null;
  if (bad === 0) return { kind, status: 'verified', points, worst: null };
  return bad >= 2 ? { kind, status: 'mismatch', points, worst } : null;
}

/** The result a final line states: the right side of its last equals sign, without "+ C". */
function statedResult(finalLine: string): string | null {
  const math = mainMath(finalLine) ?? finalLine;
  const parts = math.split(/=|\\approx|≈/);
  const rhs = parts[parts.length - 1]
    .replace(/\+\s*(?:\\text\s*\{\s*)?[CcKk](?:\s*\})?\s*[.,]?\s*$/, '')
    .replace(/[.:]+\s*$/, '')
    .trim();
  return rhs || null;
}

function simpson(f: Fn, a: number, b: number): number | null {
  const n = 1000;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let k = 1; k < n; k += 1) sum += f(a + k * h) * (k % 2 === 1 ? 4 : 2);
  const value = (sum * h) / 3;
  return Number.isFinite(value) ? value : null;
}

const close = (computed: number, stated: number) =>
  Math.abs(computed - stated) <= 1e-3 * Math.max(1, Math.abs(computed)) + 0.006;

/**
 * Checks a worked solution against the exercise in the note. `modelEquation` is the function the
 * model said the exercise is about; it is used only when the note itself has no readable equation.
 */
export function verifySolution(note: string, finalLine: string, modelEquation: string | null = null): SolutionCheck | null {
  const task = detectTask(note, modelEquation);
  if (!task) return checkArithmetic(finalLine);
  switch (task.kind) {
    case 'equation':
      return checkEquation(task.F, finalLine);
    case 'integral': {
      const computed = simpson(task.f, task.a, task.b);
      const result = statedResult(finalLine);
      const stated = (result ? evaluateConstant(result) : null) ?? statedNumbers(finalLine).at(-1) ?? null;
      if (computed === null || stated === null) return null;
      return { kind: 'integral', status: close(computed, stated) ? 'verified' : 'mismatch', computed, stated };
    }
    case 'antiderivative': {
      const result = statedResult(finalLine);
      const F = result ? fnOf(result) : null;
      return F ? compareFunctions(task.f, slopeOf(F), 'antiderivative') : null;
    }
    case 'derivative': {
      const result = statedResult(finalLine);
      if (!result) return null;
      const slope = slopeOf(task.f);
      const constant = evaluateConstant(result);
      if (constant !== null && task.at !== null) {
        const computed = slope(task.at);
        if (!Number.isFinite(computed)) return null;
        return { kind: 'derivative_at', status: close(computed, constant) ? 'verified' : 'mismatch', at: task.at, computed, stated: constant };
      }
      const stated = fnOf(result, false);
      return stated ? compareFunctions(slope, stated, 'derivative') : null;
    }
  }
}

/**
 * A final line that is a calculation with no unknown, such as "$\sin(\frac{\pi}{6}) = \frac{1}{2}$" or
 * "$0.7 \cdot 11 = 7.7$": every side is evaluated and they must agree. A side marked ≈ may be rounded.
 */
export function checkArithmetic(finalLine: string): SolutionCheck | null {
  const math = mainMath(finalLine);
  if (!math) return null;
  const sides = math.split(/=|\\approx|≈/).map((side) => side.trim());
  if (sides.length < 2 || sides.some((side) => !side)) return null;
  const values = sides.map((side) => evaluateConstant(side.replace(/[.,:;]+$/, '')));
  if (values.some((v) => v === null)) return null;
  // Only a real calculation is worth confirming: "3 = 3" says nothing.
  if (sides.every((side) => /^[−-]?\s*\d+(?:[.,]\d+)?$/.test(side))) return null;
  const numbers = values as number[];
  const agree = numbers.every((v, i) => i === 0 || close(numbers[0], v));
  return { kind: 'arithmetic', status: agree ? 'verified' : 'mismatch', computed: numbers[0], stated: numbers[numbers.length - 1] };
}

const show = (v: number) => String(Math.round(v * 10000) / 10000);

/** What the device found, in words the model can act on. Used once, to ask for a corrected solution. */
export function repairFeedback(check: SolutionCheck): string {
  switch (check.kind) {
    case 'equation': {
      const wrong = check.values.filter((v) => !v.ok).map((v) => `x = ${show(v.x)} leaves ${show(v.y)}, not 0`);
      const roots = check.roots.length ? ` The device finds the real solutions near ${check.roots.map((r) => `x ≈ ${show(r)}`).join(', ')}.` : '';
      return `A check on the student's device put your final answers back into the equation (left side minus right side): ${wrong.join('; ')}.${roots} Find the mistake and write the corrected solution.`;
    }
    case 'derivative':
    case 'antiderivative': {
      const w = check.worst;
      const what = check.kind === 'derivative' ? 'your derivative' : 'the derivative of your antiderivative';
      return w
        ? `A numeric check on the student's device found that ${what} is wrong: at x = ${show(w.x)} it should be ${show(w.expected)} but yours gives ${show(w.stated)}. Find the mistake and write the corrected solution.`
        : 'A numeric check on the student\'s device found the result is wrong. Find the mistake and write the corrected solution.';
    }
    case 'derivative_at':
      return `A numeric check on the student's device gives a slope of ${show(check.computed)} at x = ${show(check.at)}, but your answer is ${show(check.stated)}. Find the mistake and write the corrected solution.`;
    case 'integral':
      return `A numeric integration on the student's device gives ${show(check.computed)} for this integral, but your answer is ${show(check.stated)}. Find the mistake and write the corrected solution.`;
    case 'arithmetic':
      return `The student's device evaluated your final calculation: the left side is ${show(check.computed)} but you wrote ${show(check.stated)}. Find the mistake and write the corrected solution.`;
  }
}
