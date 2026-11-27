import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import type { VisualSpec } from '../core/types';
import { curvePath, projector, VIEW_H as H, VIEW_W as W, visualModel, type VisualModel, type Window } from '../core/visual';
import { useI18n } from '../i18n';
import { FunctionGraph } from './Board';

/*
 * The pictures under a worked solution, in the spirit of animated math videos: two curves meeting,
 * an area filled by rectangles that become the integral, secants turning into a tangent, a point on
 * the unit circle drawing the sine wave, a curve traced by a moving point. The solver only names the
 * picture and its formulas; every coordinate is computed and drawn here, on the device. They start
 * once the board is written (--total for CSS, `delayMs` for the ones driven by script).
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

function useNumber() {
  const { lang } = useI18n();
  return useMemo(() => {
    const format = new Intl.NumberFormat(lang, { maximumFractionDigits: 3 });
    return (v: number) => format.format(Math.abs(v) < 1e-9 ? 0 : v).replace('-', '−');
  }, [lang]);
}

function Gradients({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#38bdf8" />
        <stop offset="0.5" stopColor="#a78bfa" />
        <stop offset="1" stopColor="#f472b6" />
      </linearGradient>
      <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fde047" />
        <stop offset="1" stopColor="#fb923c" />
      </linearGradient>
    </defs>
  );
}

function Axes({ w }: { w: Window }) {
  const { px, py } = projector(w);
  return (
    <>
      {w.y0 <= 0 && w.y1 >= 0 && <line className="axis" x1={0} y1={py(0)} x2={W} y2={py(0)} />}
      {w.x0 <= 0 && w.x1 >= 0 && <line className="axis" x1={px(0)} y1={0} x2={px(0)} y2={H} />}
    </>
  );
}

type Model<K extends VisualModel['kind']> = Extract<VisualModel, { kind: K }>;

function Intersection({ model, label }: { model: Model<'intersection'>; label: string }) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const { px, py } = projector(model.window);
  return (
    <svg className="graph visual" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Gradients id={id} />
      <Axes w={model.window} />
      <path className="curve" d={curvePath(model.f, model.window)} pathLength={1} stroke={`url(#${id}-a)`} />
      <path className="curve curve-2" d={curvePath(model.g, model.window)} pathLength={1} stroke={`url(#${id}-b)`} />
      {model.points.map((p, i) => (
        <g key={i} className="root" style={{ '--i': i } as CSSProperties}>
          <circle cx={px(p.x)} cy={py(p.y)} r={5.5} />
          <text x={px(p.x)} y={py(p.y) - 12 < 12 ? py(p.y) + 22 : py(p.y) - 12}>
            ({show(p.x)}, {show(p.y)})
          </text>
        </g>
      ))}
    </svg>
  );
}

const BARS = 8;

function Area({ model, label }: { model: Model<'area'>; label: string }) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const { px, py } = projector(model.window);
  const { f, a, b } = model;
  const width = (b - a) / BARS;
  const bars = Array.from({ length: BARS }, (_, i) => {
    const v = f(a + (i + 0.5) * width);
    if (!Number.isFinite(v)) return null;
    const top = Math.max(-H, Math.min(2 * H, py(v)));
    return { x: px(a + i * width), w: px(a + (i + 1) * width) - px(a + i * width), y: Math.min(top, py(0)), h: Math.abs(top - py(0)), neg: v < 0 };
  });
  const fill = `M${px(a).toFixed(1)} ${py(0).toFixed(1)} ${curvePath(f, model.window, a, b, 120).replace(/^M/, 'L')} L${px(b).toFixed(1)} ${py(0).toFixed(1)} Z`;
  return (
    <svg className="graph visual" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Gradients id={id} />
      <Axes w={model.window} />
      {bars.map(
        (bar, i) =>
          bar && (
            <rect
              key={i}
              className={bar.neg ? 'riemann neg' : 'riemann'}
              style={{ '--i': i } as CSSProperties}
              x={bar.x}
              y={bar.y}
              width={Math.max(0, bar.w - 1)}
              height={bar.h}
            />
          ),
      )}
      <path className="area-fill" d={fill} />
      <line className="bound" x1={px(a)} y1={0} x2={px(a)} y2={H} />
      <line className="bound" x1={px(b)} y1={0} x2={px(b)} y2={H} />
      <path className="curve" d={curvePath(f, model.window)} pathLength={1} stroke={`url(#${id}-a)`} />
      {model.value !== null && (
        <text className="label" x={px((a + b) / 2)} y={16}>
          ∫ = {show(model.value)}
        </text>
      )}
    </svg>
  );
}

function Tangent({ model, label }: { model: Model<'tangent'>; label: string }) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const { px, py } = projector(model.window);
  const { f, a, fa, m, window: w } = model;
  const line = (slope: number) => ({ x1: px(w.x0), y1: py(fa + slope * (w.x0 - a)), x2: px(w.x1), y2: py(fa + slope * (w.x1 - a)) });
  const secants = [2.2, 1.1, 0.45]
    .map((h) => (f(a + h) - fa) / h)
    .filter((s) => Number.isFinite(s))
    .map(line);
  return (
    <svg className="graph visual" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Gradients id={id} />
      <Axes w={w} />
      <path className="curve" d={curvePath(f, w)} pathLength={1} stroke={`url(#${id}-a)`} />
      {secants.map((s, i) => (
        <line key={i} className="secant" style={{ '--i': i } as CSSProperties} {...s} />
      ))}
      <line className="tangent-line" pathLength={1} {...line(m)} />
      <g className="root" style={{ '--i': 0 } as CSSProperties}>
        <circle cx={px(a)} cy={py(fa)} r={5.5} />
      </g>
      <text className="label" x={W / 2} y={16}>
        f′({show(a)}) = {show(m)}
      </text>
    </svg>
  );
}

/** The point goes once around the circle and draws the wave as it goes, then settles on the angle. */
function UnitCircle({ model, label, delayMs, instant }: { model: Model<'unit_circle'>; label: string; delayMs: number; instant: boolean }) {
  const id = useId().replace(/:/g, '');
  const show = useNumber();
  const progress = useProgress(4600, delayMs, instant);
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

  const waveY = (t: number) => cy - R * Math.max(-2.4, Math.min(2.4, value(t)));
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
  const linkX = progress >= 1 ? waveXAt(target) : waveXAt(drawn);
  const arcEnd = { x: cx + 15 * Math.cos(shown), y: cy - 15 * Math.sin(shown) };
  const degrees = (shown * 180) / Math.PI;
  return (
    <svg className="graph visual unit" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Gradients id={id} />
      <line className="axis" x1={cx - R - 8} y1={cy} x2={W - 4} y2={cy} />
      <line className="axis" x1={cx} y1={cy - R - 8} x2={cx} y2={cy + R + 8} />
      <circle className="ring" cx={cx} cy={cy} r={R} />
      {shown > 0.02 && (
        <path className="arc" d={`M${cx + 15} ${cy} A15 15 0 ${shown > Math.PI ? 1 : 0} 0 ${arcEnd.x.toFixed(1)} ${arcEnd.y.toFixed(1)}`} />
      )}
      <path className="wave" d={wave.trim()} stroke={`url(#${id}-a)`} />
      <line className="radius" x1={cx} y1={cy} x2={px} y2={py} />
      {trig === 'cos' && <line className="bar-cos" x1={cx} y1={cy} x2={px} y2={cy} />}
      {trig === 'sin' && <line className="bar-sin" x1={px} y1={cy} x2={px} y2={py} />}
      {trig === 'tan' && (
        // The tangent is the height where the radius, extended, meets the line touching the circle at (1, 0).
        <>
          <line className="link" x1={cx} y1={cy} x2={cx + R} y2={cy - R * Math.max(-1.5, Math.min(1.5, Math.tan(theta)))} />
          <line className="bar-sin" x1={cx + R} y1={cy} x2={cx + R} y2={cy - R * Math.max(-1.5, Math.min(1.5, Math.tan(theta)))} />
        </>
      )}
      {trig === 'sin' && <line className="link" x1={px} y1={py} x2={linkX} y2={waveY(progress >= 1 ? target : drawn)} />}
      <circle className="point" cx={px} cy={py} r={5} />
      <circle className="point" cx={linkX} cy={waveY(progress >= 1 ? target : drawn)} r={4} />
      {progress >= 1 && angle !== null && (
        <text className="label still" x={waveX0 + waveW / 2} y={16}>
          θ = {show(Math.round(degrees * 10) / 10)}° · {trig} θ = {show(value(target))}
        </text>
      )}
    </svg>
  );
}

/** A curve x(t), y(t), drawn once and then traced by a moving point. */
function Parametric({ model, label, delayMs, instant }: { model: Model<'parametric'>; label: string; delayMs: number; instant: boolean }) {
  const id = useId().replace(/:/g, '');
  const progress = useProgress(3200, delayMs + 1300, instant);
  const { px, py } = projector(model.window);
  const d = model.points.map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join(' ');
  const [dx, dy] = model.points[Math.min(model.points.length - 1, Math.round(progress * (model.points.length - 1)))];
  return (
    <svg className="graph visual" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Gradients id={id} />
      <Axes w={model.window} />
      <path className="curve" d={d} pathLength={1} stroke={`url(#${id}-a)`} />
      {progress > 0 && <circle className="point" cx={px(dx)} cy={py(dy)} r={5} />}
    </svg>
  );
}

/** The picture the solver asked for, or nothing when its formulas cannot be read. */
export function MathVisual({ spec, delayMs, instant }: { spec: VisualSpec; delayMs: number; instant: boolean }) {
  const { t } = useI18n();
  const model = useMemo(() => visualModel(spec), [spec]);
  const show = useNumber();
  if (!model) return null;
  switch (model.kind) {
    case 'graph':
      return <FunctionGraph source={spec.f} label={t('solution.graph', { f: spec.f })} />;
    case 'intersection':
      return <Intersection model={model} label={t('visual.intersection', { f: spec.f, g: spec.g ?? '' })} />;
    case 'area':
      return <Area model={model} label={t('visual.area', { f: spec.f, a: show(model.a), b: show(model.b) })} />;
    case 'tangent':
      return <Tangent model={model} label={t('visual.tangent', { f: spec.f, a: show(model.a) })} />;
    case 'unit_circle':
      return <UnitCircle model={model} label={t('visual.unitCircle', { f: model.trig })} delayMs={delayMs} instant={instant} />;
    case 'parametric':
      return <Parametric model={model} label={t('visual.parametric', { f: spec.f, g: spec.g ?? '' })} delayMs={delayMs} instant={instant} />;
  }
}
