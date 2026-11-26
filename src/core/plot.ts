/**
 * A small, safe reader for the function the model asks us to draw under a full solution.
 * There is no eval: only numbers, x, + − × ÷ ^, parentheses, pi, e and a few named functions.
 * Anything else makes the plot disappear, never the solution.
 */
export type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
// Longest names first, so "sqrt" is not read as "s" + "qrt" and "exp" not as "e" + "xp".
const NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length);

export const MAX_PLOT_CHARS = 80;

type Token =
  | { t: 'num'; v: number }
  | { t: 'x' }
  | { t: 'const'; v: number }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' }
  | { t: '(' }
  | { t: ')' };

/** "y = x^2 + 2x", "f(x)=…" and "x^2+2x=3" all become a single expression that equals zero at the answers. */
function normalize(source: string): string | null {
  let s = source
    .toLowerCase()
    .replace(/\$/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\left|\\right/g, '')
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\\/g, '')
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/\*\*/g, '^')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
  s = s.replace(/^(y|f\(x\))=/, '');
  const sides = s.split('=');
  if (sides.length > 2 || sides.some((side) => !side)) return null;
  if (sides.length === 2) s = `(${sides[0]})-(${sides[1]})`;
  return s;
}

function tokenize(s: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      out.push({ t: 'num', v });
      i = j;
    } else if (/[a-z]/.test(c)) {
      const name = NAMES.find((n) => s.startsWith(n, i));
      if (!name) return null;
      if (name === 'x') out.push({ t: 'x' });
      else if (name in FUNCS) out.push({ t: 'fn', v: name });
      else out.push({ t: 'const', v: CONSTS[name] });
      i += name.length;
    } else if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      out.push({ t: 'op', v: c });
      i += 1;
    } else if (c === '(' || c === '[') {
      out.push({ t: '(' });
      i += 1;
    } else if (c === ')' || c === ']') {
      out.push({ t: ')' });
      i += 1;
    } else {
      return null;
    }
  }
  return out;
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Fn | null {
    const fn = this.expr();
    return fn && this.i === this.tokens.length ? fn : null;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private isOp(v: string): boolean {
    const tok = this.peek();
    return tok?.t === 'op' && tok.v === v;
  }

  private startsFactor(): boolean {
    const tok = this.peek();
    return !!tok && (tok.t === 'num' || tok.t === 'x' || tok.t === 'const' || tok.t === 'fn' || tok.t === '(');
  }

  private expr(): Fn | null {
    if (++this.depth > 40) return null;
    let left = this.term();
    while (left && (this.isOp('+') || this.isOp('-'))) {
      const minus = this.isOp('-');
      this.i += 1;
      const right = this.term();
      if (!right) return null;
      const a = left;
      left = minus ? (x) => a(x) - right(x) : (x) => a(x) + right(x);
    }
    this.depth -= 1;
    return left;
  }

  /** Products, quotients, and implicit products such as 2x, 3(x+1) or (x+3)(x-1). */
  private term(): Fn | null {
    let left = this.unary();
    while (left) {
      if (this.isOp('*') || this.isOp('/')) {
        const divide = this.isOp('/');
        this.i += 1;
        const right = this.unary();
        if (!right) return null;
        const a = left;
        left = divide ? (x) => a(x) / right(x) : (x) => a(x) * right(x);
      } else if (this.startsFactor()) {
        const right = this.power();
        if (!right) return null;
        const a = left;
        left = (x) => a(x) * right(x);
      } else {
        break;
      }
    }
    return left;
  }

  /** A leading minus binds looser than a power: -x^2 is -(x^2). */
  private unary(): Fn | null {
    if (this.isOp('-') || this.isOp('+')) {
      const minus = this.isOp('-');
      this.i += 1;
      const inner = this.unary();
      if (!inner) return null;
      return minus ? (x) => -inner(x) : inner;
    }
    return this.power();
  }

  private power(): Fn | null {
    const base = this.atom();
    if (!base || !this.isOp('^')) return base;
    this.i += 1;
    const exponent = this.unary();
    if (!exponent) return null;
    return (x) => Math.pow(base(x), exponent(x));
  }

  private atom(): Fn | null {
    const tok = this.peek();
    if (!tok) return null;
    this.i += 1;
    switch (tok.t) {
      case 'num':
      case 'const': {
        const v = tok.v;
        return () => v;
      }
      case 'x':
        return (x) => x;
      case 'fn': {
        const f = FUNCS[tok.v];
        const arg = this.peek()?.t === '(' ? this.atom() : this.power();
        if (!arg) return null;
        return (x) => f(arg(x));
      }
      case '(': {
        const inner = this.expr();
        if (!inner || this.peek()?.t !== ')') return null;
        this.i += 1;
        return inner;
      }
      default:
        return null;
    }
  }
}

/** The function in `source`, or null when it is not something we can draw safely. */
export function compileFunction(source: string): Fn | null {
  if (!source || source.length > MAX_PLOT_CHARS) return null;
  const normalized = normalize(source);
  if (!normalized || !normalized.includes('x')) return null;
  const tokens = tokenize(normalized);
  if (!tokens || tokens.length === 0) return null;
  const fn = new Parser(tokens).parse();
  if (!fn) return null;
  // A function that is undefined almost everywhere is not worth a graph.
  let finite = 0;
  for (let x = -10; x <= 10; x += 0.5) if (Number.isFinite(fn(x))) finite += 1;
  return finite >= 10 ? fn : null;
}

export interface PlotFrame {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Where the curve crosses zero, left to right, at most four. */
  roots: number[];
}

function bisect(fn: Fn, a: number, b: number): number {
  let fa = fn(a);
  for (let k = 0; k < 60; k += 1) {
    const m = (a + b) / 2;
    const fm = fn(m);
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return (a + b) / 2;
}

/** Chooses a window that shows the answers with some room around them, and finds those answers. */
export function frameFunction(fn: Fn): PlotFrame {
  const roots: number[] = [];
  const step = 0.01;
  let prevX = -12;
  let prevY = fn(prevX);
  for (let x = -12 + step; x <= 12 + 1e-9; x += step) {
    const y = fn(x);
    if (Number.isFinite(y) && Number.isFinite(prevY)) {
      const jump = Math.abs(y - prevY) > 50; // a pole such as 1/x is not a root
      if (y === 0) roots.push(x);
      else if (prevY !== 0 && Math.sign(y) !== Math.sign(prevY) && !jump) roots.push(bisect(fn, prevX, x));
    }
    prevX = x;
    prevY = y;
  }
  const clean = roots
    .map((r) => Math.round(r * 1e6) / 1e6)
    .filter((r, i, all) => i === 0 || Math.abs(r - all[i - 1]) > 1e-3)
    .slice(0, 4);

  let x0 = -5;
  let x1 = 5;
  if (clean.length > 0) {
    const lo = Math.min(...clean);
    const hi = Math.max(...clean);
    const pad = Math.max(1.5, Math.max(hi - lo, 2) * 0.4);
    x0 = lo - pad;
    x1 = hi + pad;
  }

  const ys: number[] = [];
  for (let k = 0; k <= 300; k += 1) {
    const y = fn(x0 + ((x1 - x0) * k) / 300);
    if (Number.isFinite(y)) ys.push(y);
  }
  ys.sort((a, b) => a - b);
  // Percentiles keep a vertical asymptote from flattening the rest of the curve.
  let y0 = ys.length ? ys[Math.floor(ys.length * 0.03)] : -1;
  let y1 = ys.length ? ys[Math.ceil(ys.length * 0.97) - 1] : 1;
  y0 = Math.min(y0, 0);
  y1 = Math.max(y1, 0);
  if (y1 - y0 < 1e-6) {
    y0 -= 1;
    y1 += 1;
  }
  const padY = (y1 - y0) * 0.12;
  return { x0, x1, y0: y0 - padY, y1: y1 + padY, roots: clean };
}
