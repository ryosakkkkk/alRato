/**
 * A small, safe reader for the math the model and the student write: the function drawn under a
 * full solution, the equation the device checks, the bounds of an integral. There is no eval: only
 * numbers, one variable, + − × ÷ ^, parentheses, pi, e and a few named functions. Anything else
 * makes the drawing or the check disappear, never the solution.
 */
export type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  // Spanish textbooks write "sen" and "tg".
  sen: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  tg: Math.tan,
  cot: (v) => 1 / Math.tan(v),
  sec: (v) => 1 / Math.cos(v),
  csc: (v) => 1 / Math.sin(v),
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const BASE_NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS)];

/** Longest names first, so "sqrt" is not read as "s" + "qrt" and "tan" not as "t" + "an". */
const namesFor = (variable: string) => [...BASE_NAMES, variable].sort((a, b) => b.length - a.length);

export const MAX_PLOT_CHARS = 80;

type Token =
  | { t: 'num'; v: number }
  | { t: 'var' }
  | { t: 'const'; v: number }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' }
  | { t: '(' }
  | { t: ')' };

/** Rewrites the LaTeX a note or a model uses into plain notation: \frac{a}{b} becomes ((a)/(b)). */
export function plainMath(source: string): string {
  let s = source
    .replace(/\\(?:left|right|displaystyle|limits)/g, '')
    .replace(/\\(?:quad|qquad|[,;:! ])/g, ' ')
    .replace(/\\operatorname\{([a-zA-Z]+)\}/g, '\\$1')
    .replace(/\\[lr]vert|\\mid/g, '|')
    .replace(/\|([^|]+)\|/g, 'abs($1)');
  // Innermost groups first, so nested fractions, roots and exponents unwrap one level per pass.
  for (let pass = 0; pass < 12; pass += 1) {
    const next = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
      .replace(/\^\s*\{([^{}]*)\}/g, '^($1)');
    if (next === s) break;
    s = next;
  }
  return s;
}

/** "y = x^2 + 2x", "f(x)=…" and "x^2+2x=3" all become a single expression that equals zero at the answers. */
function normalize(source: string, variable: string): string | null {
  let s = plainMath(source)
    .toLowerCase()
    .replace(/\$/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\\/g, '')
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/\*\*/g, '^')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
  s = s.replace(new RegExp(`^(y|[fgh]\\(${variable}\\))=`), '');
  const sides = s.split('=');
  if (sides.length > 2 || sides.some((side) => !side)) return null;
  if (sides.length === 2) s = `(${sides[0]})-(${sides[1]})`;
  return s;
}

function tokenize(s: string, variable: string): Token[] | null {
  const names = namesFor(variable);
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
      const name = names.find((n) => s.startsWith(n, i));
      if (!name) return null;
      if (name === variable) out.push({ t: 'var' });
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
    return !!tok && (tok.t === 'num' || tok.t === 'var' || tok.t === 'const' || tok.t === 'fn' || tok.t === '(');
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
      case 'var':
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

export interface ExpressionOptions {
  /** The variable's name: x for functions, t for curves given by x(t) and y(t). */
  variable?: string;
  /** A constant such as pi/6 has no variable; a function to draw must have one. */
  requireVariable?: boolean;
  maxChars?: number;
}

/** The expression in `source` as a function of its variable, or null when it cannot be read safely. */
export function compileExpression(source: string, options: ExpressionOptions = {}): Fn | null {
  const { variable = 'x', requireVariable = true, maxChars = MAX_PLOT_CHARS } = options;
  if (!source || source.length > maxChars) return null;
  const normalized = normalize(source, variable);
  if (!normalized) return null;
  const tokens = tokenize(normalized, variable);
  if (!tokens || tokens.length === 0) return null;
  if (requireVariable && !tokens.some((token) => token.t === 'var')) return null;
  return new Parser(tokens).parse();
}

/** The value of a constant expression such as "pi/6", "-\frac{3}{2}" or "2sqrt(3)", or null. */
export function evaluateConstant(source: string): number | null {
  const fn = compileExpression(source.trim(), { requireVariable: false, maxChars: 60 });
  if (!fn) return null;
  const value = fn(0);
  // A constant must not depend on the variable at all.
  return Number.isFinite(value) && fn(1.2345) === value ? value : null;
}

/** The function in `source`, or null when it is not something we can draw safely. */
export function compileFunction(source: string, maxChars = MAX_PLOT_CHARS): Fn | null {
  const fn = compileExpression(source, { maxChars });
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
