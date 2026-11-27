import { InferenceMode } from 'firebase/ai';
import type { Capture, Receipt, StudyAid, VisualSpec } from '../core/types';
import { verifySolution } from '../core/verifier';
import { AgentTrace } from './Agent';
import { SolutionSteps } from './SolutionSteps';

/*
 * Development only (#/dev/visuals): every kind of picture and device check, with no model call, so
 * the animations can be reviewed and recorded. The production build never includes this file.
 */

interface Example {
  title: string;
  note: string;
  solution: string;
  visual: VisualSpec;
}

const EXAMPLES: Example[] = [
  {
    title: 'Ecuación cuadrática',
    note: 'Resuelve: $-x^2-2x=-3$',
    solution: '1. Pasamos todo a un lado: $x^2 + 2x - 3 = 0$\n2. Factorizamos: $(x+3)(x-1) = 0$\n3. Las soluciones son $x = -3$ y $x = 1$',
    visual: { kind: 'graph', f: 'x^2+2x-3' },
  },
  {
    title: 'Integral definida',
    note: 'Calcula $\\int_0^2 x^2\\,dx$',
    solution: '1. Una antiderivada de $x^2$ es $\\frac{x^3}{3}$\n2. Evaluamos en los límites: $\\frac{2^3}{3} - \\frac{0^3}{3} = \\frac{8}{3}$\n3. Resultado: $\\int_0^2 x^2\\,dx = \\frac{8}{3}$',
    visual: { kind: 'area', f: 'x^2', a: 0, b: 2 },
  },
  {
    title: 'Derivada en un punto',
    note: "Halla $f'(1)$ si $f(x) = x^3 - 2x$",
    solution: "1. Derivamos: $f'(x) = 3x^2 - 2$\n2. Evaluamos en $x = 1$: $3(1)^2 - 2 = 1$\n3. Resultado: $f'(1) = 1$",
    visual: { kind: 'tangent', f: 'x^3-2x', a: 1 },
  },
  {
    title: 'Trigonometría',
    note: 'Calcula $\\sin\\left(\\frac{\\pi}{6}\\right)$',
    solution: '1. El ángulo $\\frac{\\pi}{6}$ son $30°$\n2. En el círculo unitario, la altura del punto es el seno\n3. Resultado: $\\sin\\left(\\frac{\\pi}{6}\\right) = \\frac{1}{2}$',
    visual: { kind: 'unit_circle', f: 'sin', a: Math.PI / 6 },
  },
  {
    title: 'Sistema de ecuaciones',
    note: 'Resuelve el sistema $y = 2x + 1$, $y = x^2 - 2$',
    solution: '1. Igualamos: $x^2 - 2 = 2x + 1$\n2. Ordenamos: $x^2 - 2x - 3 = 0$\n3. Las soluciones son $x = 3$ y $x = -1$',
    visual: { kind: 'intersection', f: '2x+1', g: 'x^2-2' },
  },
  {
    title: 'Curva paramétrica',
    note: 'Dibuja la curva $x = \\sin(3t)$, $y = \\sin(2t)$',
    solution: '1. Es una curva de Lissajous\n2. Frecuencias $3$ y $2$\n3. Se cierra en $t = 2\\pi$',
    visual: { kind: 'parametric', f: 'sin(3t)', g: 'sin(2t)', a: 0, b: 2 * Math.PI },
  },
  {
    title: 'Respuesta equivocada (la detecta el dispositivo)',
    note: 'Resuelve: $x^2 + 2x - 3 = 0$',
    solution: '1. Factorizamos: $(x+3)(x-1) = 0$\n2. Las soluciones son $x = 2$ y $x = -3$',
    visual: { kind: 'graph', f: 'x^2+2x-3' },
  },
];

const receipt = (task: Receipt['task'], source: Receipt['source'], model: string, latencyMs: number): Receipt => ({
  task,
  source,
  mode: InferenceMode.PREFER_IN_CLOUD,
  reason: 'solution_quality',
  latencyMs,
  bytesSent: 0,
  imageSent: false,
  model,
  at: 0,
});

export default function DevGallery() {
  return (
    <div className="stack">
      <h1 className="page-title">Visuals</h1>
      {EXAMPLES.map((example, i) => {
        const lines = example.solution.split('\n');
        const check = verifySolution(example.note, lines[lines.length - 1].replace(/^\d+\.\s*/, ''), example.visual.f);
        const capture = { receipts: [receipt('read', 'in_cloud', 'gemini-3.5-flash-lite', 1800), receipt('analyze', 'in_cloud', 'gemini-3.5-flash-lite', 900)], textBy: 'ai' } as unknown as Capture;
        const aid = {
          plan: 'Factorizar y usar el producto nulo',
          memory: ['factorización'],
          attempts: [receipt('help', 'in_cloud', 'gemini-3.8-flash', 4100)],
          receipt: receipt('help', 'in_cloud', 'gemini-3.8-flash', 4100),
          check,
          repaired: false,
          visual: example.visual,
        } as unknown as StudyAid;
        return (
          <article key={i} className="aid">
            <h3>{example.title}</h3>
            <SolutionSteps text={example.solution} visual={example.visual} check={check} />
            {i === 0 && <AgentTrace capture={capture} aid={aid} />}
          </article>
        );
      })}
    </div>
  );
}
