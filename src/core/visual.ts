import { compileExpression, compileFunction, frameFunction, type Fn } from './plot';
import type { VisualSpec } from './types';

/*
 * The geometry behind the pictures under a solution: where the curves go, where they meet, how much
 * area they hold. Pure numbers, computed on the device; the drawing itself is in ui/Visuals.tsx.
 */

export const VIEW_W = 300;
export const VIEW_H = 170;

export interface Window {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Simpson's rule. Null when the function is not finite somewhere on the interval. */
export function integrate(f: Fn, a: number, b: number, n = 1000): number | null {
  const steps = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / steps;
  let sum = f(a) + f(b);
  for (let k = 1; k < steps; k += 1) sum += f(a + k * h) * (k % 2 === 1 ? 4 : 2);
  const value = (sum * h) / 3;
  return Number.isFinite(value) ? value : null;
}

export function slope(f: Fn, x: number): number {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f(x + h) - f(x - h)) / (2 * h);
}

/** The vertical range that shows these functions on [x0, x1], ignoring the extremes of an asymptote. */
export function yRange(fns: Fn[], x0: number, x1: number, includeZero = true): { y0: number; y1: number } {
  const ys: number[] = [];
  for (const fn of fns) {
    for (let k = 0; k <= 240; k += 1) {
      const y = fn(x0 + ((x1 - x0) * k) / 240);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
  ys.sort((a, b) => a - b);
  let y0 = ys.length ? ys[Math.floor(ys.length * 0.03)] : -1;
  let y1 = ys.length ? ys[Math.ceil(ys.length * 0.97) - 1] : 1;
  if (includeZero) {
    y0 = Math.min(y0, 0);
    y1 = Math.max(y1, 0);
  }
  if (y1 - y0 < 1e-6) {
    y0 -= 1;
    y1 += 1;
  }
  const pad = (y1 - y0) * 0.14;
  return { y0: y0 - pad, y1: y1 + pad };
}

export interface Projector {
  px: (x: number) => number;
  py: (y: number) => number;
}

export function projector(w: Window): Projector {
  return {
    px: (x) => ((x - w.x0) / (w.x1 - w.x0)) * VIEW_W,
    py: (y) => ((w.y1 - y) / (w.y1 - w.y0)) * VIEW_H,
  };
}

/** An SVG path of y = fn(x) across the window. The pen lifts at gaps and at asymptotes. */
export function curvePath(fn: Fn, w: Window, from = w.x0, to = w.x1, samples = 240): string {
  const { px, py } = projector(w);
  const span = w.y1 - w.y0;
  let d = '';
  let pen = false;
  let prev: number | null = null;
  for (let k = 0; k <= samples; k += 1) {
    const x = from + ((to - from) * k) / samples;
    const y = fn(x);
    if (!Number.isFinite(y)) {
      pen = false;
      prev = null;
      continue;
    }
    if (prev !== null && Math.abs(y - prev) > span) pen = false;
    const cy = Math.max(-VIEW_H, Math.min(2 * VIEW_H, py(y)));
    d += `${pen ? 'L' : 'M'}${px(x).toFixed(1)} ${cy.toFixed(1)} `;
    pen = true;
    prev = y;
  }
  return d.trim();
}

/** Where f and g meet, from the zeros of f − g, with a window around them. */
export function meetings(f: Fn, g: Fn): { points: { x: number; y: number }[]; window: Window } {
  const frame = frameFunction((x) => f(x) - g(x));
  const points = frame.roots.map((x) => ({ x, y: f(x) })).filter((p) => Number.isFinite(p.y));
  const x0 = frame.x0;
  const x1 = frame.x1;
  return { points, window: { x0, x1, ...yRange([f, g], x0, x1) } };
}

/** Points of a curve x(t), y(t), and a window with the same scale on both axes so circles stay round. */
export function curvePoints(xt: Fn, yt: Fn, a: number, b: number, samples = 400): { points: [number, number][]; window: Window } {
  const points: [number, number][] = [];
  for (let k = 0; k <= samples; k += 1) {
    const t = a + ((b - a) * k) / samples;
    const x = xt(t);
    const y = yt(t);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e6 && Math.abs(y) < 1e6) points.push([x, y]);
  }
  if (points.length < 2) return { points, window: { x0: -1, x1: 1, y0: -1, y1: 1 } };
  let x0 = Math.min(...points.map((p) => p[0]));
  let x1 = Math.max(...points.map((p) => p[0]));
  let y0 = Math.min(...points.map((p) => p[1]));
  let y1 = Math.max(...points.map((p) => p[1]));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // Fit the larger extent and keep one unit the same length across and up.
  const half = Math.max((x1 - x0) / 2 / VIEW_W, (y1 - y0) / 2 / VIEW_H, 1e-6) * 1.15;
  x0 = cx - half * VIEW_W;
  x1 = cx + half * VIEW_W;
  y0 = cy - half * VIEW_H;
  y1 = cy + half * VIEW_H;
  return { points, window: { x0, x1, y0, y1 } };
}

/** Everything a picture needs, or null when its formulas cannot be read. */
export type VisualModel =
  | { kind: 'graph'; f: Fn; window: Window; roots: number[] }
  | { kind: 'intersection'; f: Fn; g: Fn; window: Window; points: { x: number; y: number }[] }
  | { kind: 'area'; f: Fn; window: Window; a: number; b: number; value: number | null }
  | { kind: 'tangent'; f: Fn; window: Window; a: number; fa: number; m: number }
  | { kind: 'unit_circle'; trig: 'sin' | 'cos' | 'tan'; angle: number | null }
  | { kind: 'parametric'; points: [number, number][]; window: Window };

export function visualModel(spec: VisualSpec): VisualModel | null {
  switch (spec.kind) {
    case 'graph': {
      const f = compileFunction(spec.f);
      if (!f) return null;
      const frame = frameFunction(f);
      return { kind: 'graph', f, window: frame, roots: frame.roots };
    }
    case 'intersection': {
      const f = compileFunction(spec.f);
      const g = spec.g ? compileFunction(spec.g) : null;
      if (!f || !g) return null;
      const { points, window } = meetings(f, g);
      return { kind: 'intersection', f, g, window, points };
    }
    case 'area': {
      const f = compileFunction(spec.f);
      if (!f || spec.a === undefined || spec.b === undefined) return null;
      const pad = Math.max(1, (spec.b - spec.a) * 0.3);
      const x0 = spec.a - pad;
      const x1 = spec.b + pad;
      return { kind: 'area', f, a: spec.a, b: spec.b, value: integrate(f, spec.a, spec.b), window: { x0, x1, ...yRange([f], x0, x1) } };
    }
    case 'tangent': {
      const f = compileFunction(spec.f);
      if (!f || spec.a === undefined) return null;
      const fa = f(spec.a);
      const m = slope(f, spec.a);
      if (!Number.isFinite(fa) || !Number.isFinite(m)) return null;
      // Centred on the point, tall enough for the curve to bend visibly around it, not for its far ends.
      const x0 = spec.a - 2.2;
      const x1 = spec.a + 2.2;
      let reach = 1;
      for (let k = 0; k <= 40; k += 1) {
        const y = f(spec.a - 1.4 + (2.8 * k) / 40);
        if (Number.isFinite(y)) reach = Math.max(reach, Math.abs(y - fa));
      }
      reach = Math.max(reach, Math.abs(m) * 1.2);
      return { kind: 'tangent', f, a: spec.a, fa, m, window: { x0, x1, y0: fa - reach * 1.25, y1: fa + reach * 1.25 } };
    }
    case 'unit_circle':
      return { kind: 'unit_circle', trig: spec.f === 'cos' || spec.f === 'tan' ? spec.f : 'sin', angle: spec.a ?? null };
    case 'parametric': {
      const xt = compileExpression(spec.f, { variable: 't' });
      const yt = spec.g ? compileExpression(spec.g, { variable: 't' }) : null;
      if (!xt || !yt) return null;
      const { points, window } = curvePoints(xt, yt, spec.a ?? 0, spec.b ?? 2 * Math.PI);
      return points.length >= 2 ? { kind: 'parametric', points, window } : null;
    }
  }
}

/** Round tick values for an axis: steps of 1, 2 or 5 times a power of ten, about `count` of them. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const SUPERSCRIPTS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const SUBSCRIPTS: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋' };

/** "x^2+2x-3" reads as "x² + 2x − 3": the plain notation the solver writes, set for a caption. */
export function prettyFormula(plain: string): string {
  return plain
    .replace(/\s+/g, '')
    .replace(/\^(\d)/g, (_, d: string) => SUPERSCRIPTS[d])
    .replace(/\*\*/g, '^')
    .replace(/\*/g, '·')
    .replace(/sqrt/g, '√')
    .replace(/pi/g, 'π')
    .replace(/([^eE(^])([+-])/g, '$1 $2 ')
    .replace(/-/g, '−');
}

/** A bound written under or over an integral sign: ₀ for 0, otherwise the plain number. */
export function subscriptNumber(value: number): string {
  const text = String(Math.round(value * 1000) / 1000);
  return /^-?\d+$/.test(text) ? [...text].map((c) => SUBSCRIPTS[c] ?? c).join('') : text;
}

/** A bound written over an integral sign: ² for 2. */
export function superscriptNumber(value: number): string {
  const text = String(Math.round(value * 1000) / 1000);
  return /^-?\d+$/.test(text) ? [...text].map((c) => (c === '-' ? '⁻' : SUPERSCRIPTS[c] ?? c)).join('') : text;
}
