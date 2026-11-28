import { memo, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { VisualKind, VisualSpec } from '../core/types';
import {
  curvePath,
  integrate,
  niceTicks,
  prettyFormula,
  projector,
  slope,
  superscriptNumber,
  subscriptNumber,
  VIEW_H as H,
  VIEW_W as W,
  visualModel,
  type VisualModel,
  type Window,
} from '../core/visual';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

/*
 * The pictures under a worked solution, made the way the "what is math?" videos are made: a scene
 * driven by time. A tracer draws each curve with a neon glow and a short trail, the numbers it
 * passes through are read out live, and a small HUD frames it all: the scene's name and a clock at
 * the top, the formula and a timeline at the bottom. The solver only names the picture and its
 * formulas; every coordinate is computed here, on the device. A scene starts once the board above
 * it is written (`delayMs`) and jumps to its last frame when the student asks to see everything.
 */

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Progress from 0 to 1 over `ms`, starting after `delayMs`. Jumps to 1 when the student asked to see everything. */
function useProgress(ms: number, delayMs: number, instant: boolean): number {
  const [progress, setProgress] = useState(instant ? 1 : 0);
  useEffect(() => {
    if (instant || reducedMotion()) {
      setProgress(1);
      return;
    }
    setProgress(0);
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const k = Math.min(1, (now - start) / ms);
      setProgress(k);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [ms, delayMs, instant]);
  return progress;
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
/** The part of the progress that falls between `from` and `to`, as 0 to 1. */
const phase = (p: number, from: number, to: number) => Math.min(1, Math.max(0, (p - from) / (to - from)));

function useNumber() {
  const { lang } = useI18n();
  return useMemo(() => {
    const format = new Intl.NumberFormat(lang, { maximumFractionDigits: 3 });
    return (v: number) => (Number.isFinite(v) ? format.format(Math.abs(v) < 1e-9 ? 0 : v).replace('-', '−') : '—');
  }, [lang]);
}

/** One pure colour per element, no gradients: cyan for the curve, amber for a second one or a tangent. */
const CYAN = '#22d3ee';
const AMBER = '#fbbf24';
const AREA = 'rgb(34 211 238 / 0.24)';

/** The neon glow every scene shares. Memoized, like the grid: only the moving parts redraw each frame. */
const Defs = memo(function Defs({ id }: { id: string }) {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
});

/** A faint grid, the axes with tick marks, and a few tick labels, like a plotting instrument. */
const Grid = memo(function Grid({ w }: { w: Window }) {
  const show = useNumber();
  const { px, py } = projector(w);
  const xs = niceTicks(w.x0, w.x1, 6);
  const ys = niceTicks(w.y0, w.y1, 4);
  const axisY = w.y0 <= 0 && w.y1 >= 0 ? py(0) : null;
  const axisX = w.x0 <= 0 && w.x1 >= 0 ? px(0) : null;
  return (
    <g className="scene-grid">
      {xs.map((x) => (
        <line key={`gx${x}`} x1={px(x)} y1={0} x2={px(x)} y2={H} />
      ))}
      {ys.map((y) => (
        <line key={`gy${y}`} x1={0} y1={py(y)} x2={W} y2={py(y)} />
      ))}
      {axisY !== null && <line className="scene-axis" x1={0} y1={axisY} x2={W} y2={axisY} />}
      {axisX !== null && <line className="scene-axis" x1={axisX} y1={0} x2={axisX} y2={H} />}
      {axisY !== null &&
        xs.map((x) => (
          <g key={`tx${x}`}>
            <line className="scene-axis" x1={px(x)} y1={axisY - 3} x2={px(x)} y2={axisY + 3} />
            {x !== 0 && (
              <text className="scene-tick" x={px(x)} y={Math.min(H - 3, axisY + 12)}>
                {show(x)}
              </text>
            )}
          </g>
        ))}
    </g>
  );
});

interface SceneProps {
  kind: VisualKind;
  label: string;
  formula: string;
  progress: number;
  duration: number;
  readouts: string[];
  children: ReactNode;
}

/** The frame of every scene: name and clock above, the plot with its live readouts, formula and timeline below. */
function Scene({ kind, label, formula, progress, duration, readouts, children }: SceneProps) {
  const { t } = useI18n();
  return (
    <figure className="scene" role="img" aria-label={label}>
      <div className="scene-hud" aria-hidden="true">
        <span className="scene-brand">
          <b>alRato</b> · {t(`scene.${kind}` as MessageKey)}
        </span>
        <span className="scene-clock">t = {((progress * duration) / 1000).toFixed(2)} s</span>
      </div>
      <div className="scene-stage">
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {children}
        </svg>
        {readouts.length > 0 && (
          <div className="scene-readouts" aria-hidden="true">
            {readouts.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
        )}
      </div>
      <div className="scene-foot" aria-hidden="true">
        <span className="scene-formula">{formula}</span>
        <span className="scene-timeline">
          <i style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
    </figure>
  );
}

type Model<K extends VisualModel['kind']> = Extract<VisualModel, { kind: K }>;

interface Timed {
  delayMs: number;
  instant: boolean;
}

/** A glowing point with a soft halo: the tracer that draws a curve. */
function Tracer({ x, y, glow, color = '#fff' }: { x: number; y: number; glow: string; color?: string }) {
  return (
    <g className="scene-tracer" filter={`url(#${glow})`}>
      <circle cx={x} cy={y} r={7} className="scene-halo" />
      <circle cx={x} cy={y} r={3.4} fill={color} />
    </g>
  );
}

/** One function, drawn by a tracer from left to right; each zero lights up as the tracer reaches it. */
function GraphScene({ model, spec, label, delayMs, instant }: { model: Model<'graph'>; spec: VisualSpec; label: string } & Timed) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const duration = 3200;
  const progress = useProgress(duration, delayMs, instant);
  const { f, window: w, roots } = model;
  const { px, py } = projector(w);
  const xt = w.x0 + (w.x1 - w.x0) * ease(progress);
  const yt = f(xt);
  const done = progress >= 1;
  const passed = roots.filter((r) => r <= xt + 1e-9);
  const readouts = done
    ? roots.length > 0
      ? ['f(x) = 0', roots.map((r) => `x = ${show(r)}`).join(' · ')]
      : []
    : [`x = ${show(xt)}`, `f(x) = ${show(yt)}`];
  return (
    <Scene kind="graph" label={label} formula={`y = ${prettyFormula(spec.f)}`} progress={progress} duration={duration} readouts={readouts}>
      <Defs id={id} />
      <Grid w={w} />
      <path className="scene-curve" d={curvePath(f, w, w.x0, Math.max(w.x0 + 1e-6, xt), 240)} stroke={CYAN} filter={`url(#${id}-glow)`} />
      {!done && Number.isFinite(yt) && (
        <>
          <line className="scene-drop" x1={px(xt)} y1={py(yt)} x2={px(xt)} y2={py(Math.min(w.y1, Math.max(w.y0, 0)))} />
          <Tracer x={px(xt)} y={py(yt)} glow={`${id}-glow`} />
        </>
      )}
      {passed.map((r, i) => (
        <g key={i} className="scene-root" style={{ '--x': `${px(r)}px`, '--y': `${py(0)}px` } as CSSProperties}>
          <circle className="scene-ring" cx={px(r)} cy={py(0)} r={6} />
          <circle className="scene-dot" cx={px(r)} cy={py(0)} r={5} filter={`url(#${id}-glow)`} />
          <text className="scene-label" x={px(r)} y={py(0) + 20 <= H - 2 ? py(0) + 20 : py(0) - 12}>
            {show(r)}
          </text>
        </g>
      ))}
    </Scene>
  );
}

/** Two functions drawn together; each point where they meet lights up with its coordinates. */
function IntersectionScene({ model, spec, label, delayMs, instant }: { model: Model<'intersection'>; spec: VisualSpec; label: string } & Timed) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const duration = 3400;
  const progress = useProgress(duration, delayMs, instant);
  const { f, g, window: w, points } = model;
  const { px, py } = projector(w);
  const xt = w.x0 + (w.x1 - w.x0) * ease(progress);
  const done = progress >= 1;
  const passed = points.filter((p) => p.x <= xt + 1e-9);
  const readouts = done
    ? points.map((p) => `(${show(p.x)}, ${show(p.y)})`)
    : [`x = ${show(xt)}`, `f − g = ${show(f(xt) - g(xt))}`];
  const end = Math.max(w.x0 + 1e-6, xt);
  return (
    <Scene
      kind="intersection"
      label={label}
      formula={`y = ${prettyFormula(spec.f)}   ·   y = ${prettyFormula(spec.g ?? '')}`}
      progress={progress}
      duration={duration}
      readouts={readouts}
    >
      <Defs id={id} />
      <Grid w={w} />
      <path className="scene-curve" d={curvePath(f, w, w.x0, end, 240)} stroke={CYAN} filter={`url(#${id}-glow)`} />
      <path className="scene-curve" d={curvePath(g, w, w.x0, end, 240)} stroke={AMBER} filter={`url(#${id}-glow)`} />
      {!done && Number.isFinite(f(xt)) && <Tracer x={px(xt)} y={py(f(xt))} glow={`${id}-glow`} />}
      {!done && Number.isFinite(g(xt)) && <Tracer x={px(xt)} y={py(g(xt))} glow={`${id}-glow`} color="#fde047" />}
      {passed.map((p, i) => (
        <g key={i} className="scene-root">
          <circle className="scene-ring" cx={px(p.x)} cy={py(p.y)} r={6} />
          <circle className="scene-dot" cx={px(p.x)} cy={py(p.y)} r={5} filter={`url(#${id}-glow)`} />
          <text className="scene-label" x={px(p.x)} y={py(p.y) - 12 < 12 ? py(p.y) + 22 : py(p.y) - 12}>
            ({show(p.x)}, {show(p.y)})
          </text>
        </g>
      ))}
    </Scene>
  );
}

const BARS = 8;

/** ∫₀² when both bounds are whole numbers, otherwise the bounds in brackets. */
function integralSign(a: number, b: number, show: (v: number) => string): string {
  return Number.isInteger(a) && Number.isInteger(b) ? `∫${subscriptNumber(a)}${superscriptNumber(b)}` : `∫[${show(a)}, ${show(b)}]`;
}

/** The curve first, then the area under it fills from a to b while the integral counts up. */
function AreaScene({ model, spec, label, delayMs, instant }: { model: Model<'area'>; spec: VisualSpec; label: string } & Timed) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const duration = 4200;
  const progress = useProgress(duration, delayMs, instant);
  const { f, a, b, window: w, value } = model;
  const { px, py } = projector(w);
  const drawn = w.x0 + (w.x1 - w.x0) * ease(phase(progress, 0, 0.3));
  const xs = a + (b - a) * ease(phase(progress, 0.3, 0.95));
  const sweeping = progress >= 0.3;
  const partial = sweeping && xs > a ? integrate(f, a, xs, 200) : 0;
  const done = progress >= 1;
  const width = (b - a) / BARS;
  const fill =
    xs > a
      ? `M${px(a).toFixed(1)} ${py(0).toFixed(1)} ${curvePath(f, w, a, xs, 120).replace(/^M/, 'L')} L${px(xs).toFixed(1)} ${py(0).toFixed(1)} Z`
      : '';
  const readouts = done ? [`∫ = ${show(value ?? 0)}`] : sweeping ? [`x = ${show(xs)}`, `∫ = ${show(partial ?? 0)}`] : [`x = ${show(drawn)}`];
  return (
    <Scene
      kind="area"
      label={label}
      formula={`${integralSign(a, b, show)} ${prettyFormula(spec.f)} dx`}
      progress={progress}
      duration={duration}
      readouts={readouts}
    >
      <Defs id={id} />
      <Grid w={w} />
      {sweeping &&
        Array.from({ length: BARS }, (_, i) => {
          const left = a + i * width;
          if (left + width / 2 > xs) return null;
          const v = f(left + width / 2);
          if (!Number.isFinite(v)) return null;
          const top = Math.max(-H, Math.min(2 * H, py(v)));
          return (
            <rect
              key={i}
              className="scene-bar"
              x={px(left)}
              y={Math.min(top, py(0))}
              width={Math.max(0, px(left + width) - px(left) - 1)}
              height={Math.abs(top - py(0))}
            />
          );
        })}
      {fill && <path className="scene-fill" d={fill} fill={AREA} />}
      <line className="scene-bound" x1={px(a)} y1={0} x2={px(a)} y2={H} />
      <line className="scene-bound" x1={px(b)} y1={0} x2={px(b)} y2={H} />
      <path className="scene-curve" d={curvePath(f, w, w.x0, Math.max(w.x0 + 1e-6, drawn), 240)} stroke={CYAN} filter={`url(#${id}-glow)`} />
      {sweeping && !done && Number.isFinite(f(xs)) && (
        <>
          <line className="scene-drop" x1={px(xs)} y1={py(f(xs))} x2={px(xs)} y2={py(0)} />
          <Tracer x={px(xs)} y={py(f(xs))} glow={`${id}-glow`} />
        </>
      )}
      {!sweeping && Number.isFinite(f(drawn)) && <Tracer x={px(drawn)} y={py(f(drawn))} glow={`${id}-glow`} />}
    </Scene>
  );
}

/** The curve, then a point that slides to x = a carrying its tangent line, its slope read out live. */
function TangentScene({ model, spec, label, delayMs, instant }: { model: Model<'tangent'>; spec: VisualSpec; label: string } & Timed) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const duration = 4000;
  const progress = useProgress(duration, delayMs, instant);
  const { f, a, m, window: w } = model;
  const { px, py } = projector(w);
  const drawn = w.x0 + (w.x1 - w.x0) * ease(phase(progress, 0, 0.35));
  const start = w.x0 + (w.x1 - w.x0) * 0.12;
  const slide = phase(progress, 0.35, 1);
  const xt = slide > 0 ? start + (a - start) * ease(slide) : start;
  const yt = f(xt);
  const mt = slide >= 1 ? m : slope(f, xt);
  // The tangent as a segment of fixed length on screen, whatever the slope.
  const sx = px(xt + 1) - px(xt);
  const sy = py(yt + mt) - py(yt);
  const len = Math.hypot(sx, sy) || 1;
  const half = 70;
  const ux = (sx / len) * half;
  const uy = (sy / len) * half;
  const showTangent = progress >= 0.35 && Number.isFinite(yt) && Number.isFinite(mt);
  const done = progress >= 1;
  const readouts = done ? [`x = ${show(a)}`, `f′(${show(a)}) = ${show(m)}`] : progress >= 0.35 ? [`x = ${show(xt)}`, `m = ${show(mt)}`] : [];
  return (
    <Scene
      kind="tangent"
      label={label}
      formula={`y = ${prettyFormula(spec.f)}   ·   x = ${show(a)}`}
      progress={progress}
      duration={duration}
      readouts={readouts}
    >
      <Defs id={id} />
      <Grid w={w} />
      <path className="scene-curve" d={curvePath(f, w, w.x0, Math.max(w.x0 + 1e-6, drawn), 240)} stroke={CYAN} filter={`url(#${id}-glow)`} />
      {showTangent && (
        <>
          <line className="scene-tangent" x1={px(xt) - ux} y1={py(yt) - uy} x2={px(xt) + ux} y2={py(yt) + uy} filter={`url(#${id}-glow)`} />
          <Tracer x={px(xt)} y={py(yt)} glow={`${id}-glow`} color={done ? '#34d399' : '#fff'} />
        </>
      )}
      {progress < 0.35 && Number.isFinite(f(drawn)) && <Tracer x={px(drawn)} y={py(f(drawn))} glow={`${id}-glow`} />}
    </Scene>
  );
}

/** The point goes once around the circle and draws the wave as it goes, then settles on the angle. */
function UnitCircleScene({ model, label, delayMs, instant }: { model: Model<'unit_circle'>; label: string } & Timed) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const duration = 4600;
  const progress = useProgress(duration, delayMs, instant);
  const { trig, angle } = model;
  const value = (t: number) => (trig === 'sin' ? Math.sin(t) : trig === 'cos' ? Math.cos(t) : Math.tan(t));
  const cx = 64;
  const cy = 85;
  const R = 52;
  const waveX0 = 140;
  const waveW = 150;
  const target = angle === null ? 0 : ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Most of the time sweeps a full turn; the rest carries the point on to the angle of the exercise.
  const sweep = Math.min(1, progress / 0.8);
  const settle = angle === null ? 0 : ease(Math.max(0, (progress - 0.8) / 0.2));
  const theta = sweep * 2 * Math.PI + settle * target;
  const drawn = Math.min(theta, 2 * Math.PI);
  const shown = progress >= 1 ? target : theta % (2 * Math.PI);

  const clip = (v: number) => Math.max(-2.4, Math.min(2.4, v));
  const waveY = (t: number) => cy - R * clip(value(t));
  const waveXAt = (t: number) => waveX0 + (t / (2 * Math.PI)) * waveW;
  let wave = '';
  let pen = false;
  for (let k = 0; k <= 160; k += 1) {
    const t = (drawn * k) / 160;
    const v = value(t);
    if (!Number.isFinite(v) || Math.abs(v) > 2.4) {
      pen = false;
      continue;
    }
    wave += `${pen ? 'L' : 'M'}${waveXAt(t).toFixed(1)} ${waveY(t).toFixed(1)} `;
    pen = true;
  }
  const px = cx + R * Math.cos(theta);
  const py = cy - R * Math.sin(theta);
  const along = progress >= 1 ? target : drawn;
  const linkX = waveXAt(along);
  const arcEnd = { x: cx + 15 * Math.cos(shown), y: cy - 15 * Math.sin(shown) };
  const degrees = (shown * 180) / Math.PI;
  const tanEnd = cy - R * Math.max(-1.5, Math.min(1.5, Math.tan(theta)));
  return (
    <Scene
      kind="unit_circle"
      label={label}
      formula={`y = ${trig} θ`}
      progress={progress}
      duration={duration}
      readouts={[`θ = ${show(shown)} rad · ${show(Math.round(degrees * 10) / 10)}°`, `${trig} θ = ${show(value(shown))}`]}
    >
      <Defs id={id} />
      <g className="scene-grid">
        <line className="scene-axis" x1={cx - R - 8} y1={cy} x2={W - 4} y2={cy} />
        <line className="scene-axis" x1={cx} y1={cy - R - 8} x2={cx} y2={cy + R + 8} />
      </g>
      <circle className="scene-ring-circle" cx={cx} cy={cy} r={R} filter={`url(#${id}-glow)`} />
      {shown > 0.02 && (
        <path className="scene-arc" d={`M${cx + 15} ${cy} A15 15 0 ${shown > Math.PI ? 1 : 0} 0 ${arcEnd.x.toFixed(1)} ${arcEnd.y.toFixed(1)}`} />
      )}
      <path className="scene-curve scene-wave" d={wave.trim()} stroke={CYAN} filter={`url(#${id}-glow)`} />
      <line className="scene-radius" x1={cx} y1={cy} x2={px} y2={py} />
      {trig === 'cos' && <line className="scene-bar-cos" x1={cx} y1={cy} x2={px} y2={cy} filter={`url(#${id}-glow)`} />}
      {trig === 'sin' && <line className="scene-bar-sin" x1={px} y1={cy} x2={px} y2={py} filter={`url(#${id}-glow)`} />}
      {trig === 'tan' && (
        <>
          <line className="scene-drop" x1={cx} y1={cy} x2={cx + R} y2={tanEnd} />
          <line className="scene-bar-sin" x1={cx + R} y1={cy} x2={cx + R} y2={tanEnd} filter={`url(#${id}-glow)`} />
        </>
      )}
      {trig === 'sin' && <line className="scene-drop" x1={px} y1={py} x2={linkX} y2={waveY(along)} />}
      <Tracer x={px} y={py} glow={`${id}-glow`} color="#f472b6" />
      <Tracer x={linkX} y={waveY(along)} glow={`${id}-glow`} />
    </Scene>
  );
}

/** A curve x(t), y(t), drawn by a tracer with a bright trail, then left glowing. */
function ParametricScene({ model, spec, label, delayMs, instant }: { model: Model<'parametric'>; spec: VisualSpec; label: string } & Timed) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const duration = 4200;
  const progress = useProgress(duration, delayMs, instant);
  const { points, window: w } = model;
  const { px, py } = projector(w);
  const n = points.length;
  const head = Math.max(1, Math.round(progress * (n - 1)));
  const path = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`)
      .join(' ');
  const trail = Math.max(0, head - Math.round(n * 0.08));
  const [hx, hy] = points[Math.min(n - 1, head)];
  const t = (spec.a ?? 0) + ((spec.b ?? 2 * Math.PI) - (spec.a ?? 0)) * (head / (n - 1));
  const done = progress >= 1;
  return (
    <Scene
      kind="parametric"
      label={label}
      formula={`( ${prettyFormula(spec.f)}, ${prettyFormula(spec.g ?? '')} )`}
      progress={progress}
      duration={duration}
      readouts={[`t = ${show(t)}`, `(x, y) = (${show(hx)}, ${show(hy)})`]}
    >
      <Defs id={id} />
      <Grid w={w} />
      <path className="scene-curve scene-dim" d={path(0, head)} stroke={CYAN} filter={`url(#${id}-glow)`} />
      {!done && <path className="scene-curve scene-trail" d={path(trail, head)} filter={`url(#${id}-glow)`} />}
      {!done && <Tracer x={px(hx)} y={py(hy)} glow={`${id}-glow`} />}
    </Scene>
  );
}

/** The picture the solver asked for, or nothing when its formulas cannot be read. */
export function MathVisual({ spec, delayMs, instant }: { spec: VisualSpec; delayMs: number; instant: boolean }) {
  const { t } = useI18n();
  const model = useMemo(() => visualModel(spec), [spec]);
  const show = useNumber();
  if (!model) return null;
  const timed = { delayMs, instant };
  switch (model.kind) {
    case 'graph':
      return <GraphScene model={model} spec={spec} label={t('solution.graph', { f: spec.f })} {...timed} />;
    case 'intersection':
      return <IntersectionScene model={model} spec={spec} label={t('visual.intersection', { f: spec.f, g: spec.g ?? '' })} {...timed} />;
    case 'area':
      return <AreaScene model={model} spec={spec} label={t('visual.area', { f: spec.f, a: show(model.a), b: show(model.b) })} {...timed} />;
    case 'tangent':
      return <TangentScene model={model} spec={spec} label={t('visual.tangent', { f: spec.f, a: show(model.a) })} {...timed} />;
    case 'unit_circle':
      return <UnitCircleScene model={model} label={t('visual.unitCircle', { f: model.trig })} {...timed} />;
    case 'parametric':
      return <ParametricScene model={model} spec={spec} label={t('visual.parametric', { f: spec.f, g: spec.g ?? '' })} {...timed} />;
  }
}
