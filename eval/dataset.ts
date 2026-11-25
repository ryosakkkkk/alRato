/**
 * Live evaluation set. Every text is written the way alRato's READ step returns a board
 * photo: plain lines, math in LaTeX between $ signs. Notes mix Spanish and English on
 * purpose, because a student's library does.
 *
 * The set is small so that one run stays far below the free daily quota of the
 * Gemini Developer API.
 */
export type EvalKind = 'board' | 'formula' | 'exercise' | 'question' | 'other';

export interface EvalNote {
  id: string;
  text: string;
  comment?: string;
  /** Any of these labels counts as correct. */
  kinds: EvalKind[];
}

export interface EvalCase {
  note: EvalNote;
  /** Ids of library notes that are a correct "Connected to your note". Empty means no link is correct. */
  links: string[];
  /** When true, linking nothing is also acceptable. */
  linkOptional?: boolean;
  /** Patterns that reveal the final answer. They must not appear in hint levels 1 to 3. */
  answer?: RegExp[];
}

/** Notes the student already has. They go through the same ANALYZE step as new notes. */
export const LIBRARY: EvalNote[] = [
  {
    id: 'weighted',
    kinds: ['formula'],
    text: 'Promedio ponderado\n$\\bar{x} = \\frac{\\sum_i w_i x_i}{\\sum_i w_i}$\ndonde:\n- $x_i$: valor u observación\n- $w_i$: peso (por ejemplo, una probabilidad)\nCada valor se multiplica por su peso.',
  },
  {
    id: 'derivative',
    kinds: ['formula', 'board'],
    text: "Derivada\n$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}$\nReglas: $(x^n)' = n x^{n-1}$, $(\\sin x)' = \\cos x$, $(e^x)' = e^x$\nLa derivada mide la razón de cambio instantánea.",
  },
  {
    id: 'conditional',
    kinds: ['formula'],
    text: 'Conditional probability\n$P(A|B) = \\frac{P(A \\cap B)}{P(B)}$\nRead: probability of A given that B happened.\nIf A and B are independent: $P(A|B) = P(A)$',
  },
  {
    id: 'ohm',
    kinds: ['formula'],
    text: 'Ley de Ohm\n$V = I \\cdot R$\n- $V$: voltaje (voltios)\n- $I$: corriente (amperios)\n- $R$: resistencia (ohmios)',
  },
  {
    id: 'logarithms',
    kinds: ['formula', 'board'],
    text: 'Logaritmos\n$\\log_b(x) = y \\iff b^y = x$\nPropiedades: $\\log(ab) = \\log a + \\log b$, $\\log(a^n) = n \\log a$\n$\\log_2 8 = 3$ porque $2^3 = 8$',
  },
  {
    id: 'product-rule',
    kinds: ['formula'],
    text: "Product rule\n$(uv)' = u'v + uv'$\nExample: $(x^2 \\sin x)' = 2x \\sin x + x^2 \\cos x$",
  },
  {
    id: 'kinematics',
    kinds: ['formula', 'board'],
    text: 'MRUV\n$v = v_0 + a t$\n$x = x_0 + v_0 t + \\frac{1}{2} a t^2$\n$v^2 = v_0^2 + 2 a \\Delta x$\nAceleración constante.',
  },
  {
    id: 'mole',
    kinds: ['formula', 'board'],
    text: 'El mol\n1 mol = $6.022 \\times 10^{23}$ partículas (número de Avogadro)\nMasa molar: gramos por mol. $n = \\frac{m}{M}$\nEj.: $M(H_2O) = 18$ g/mol',
  },
  {
    id: 'french-revolution',
    kinds: ['board'],
    text: 'Revolución francesa (1789)\nCausas: crisis económica, desigualdad, absolutismo.\nToma de la Bastilla: 14 de julio de 1789.\nDeclaración de los Derechos del Hombre y del Ciudadano.',
  },
];

export const CASES: EvalCase[] = [
  {
    // The demo case. The comment points at the insight: probabilities act as weights.
    note: {
      id: 'bellman',
      kinds: ['exercise'],
      text: "Ecuación de Bellman\n$V(s) = \\sum_{s'} P(s'|s)[r(s,s') + \\gamma V(s')]$\ndonde:\n- $V(s)$: valor del estado s\n- $P(s'|s)$: probabilidad de transición\n- $r(s,s')$: recompensa\n- $\\gamma$: factor de descuento ($0 < \\gamma < 1$)\nEjercicio: calcula $V(s)$ si $P = 0.7$, $r = 2$, $\\gamma = 0.9$, $V(s') = 10$",
      comment: 'No entendí por qué la probabilidad multiplica todo',
    },
    links: ['weighted', 'conditional'],
    answer: [/7[.,]7\b/],
  },
  {
    note: {
      id: 'chain-rule',
      kinds: ['exercise', 'formula'],
      text: "Regla de la cadena\n$(f(g(x)))' = f'(g(x)) \\cdot g'(x)$\nEjercicio: deriva $y = \\sin(x^2)$",
    },
    links: ['derivative'],
    answer: [/2\s*x\s*(\\cdot|·|\*)?\s*\\?cos/],
  },
  {
    note: {
      id: 'bayes',
      kinds: ['exercise', 'formula'],
      text: "Bayes' theorem\n$P(A|B) = \\frac{P(B|A) P(A)}{P(B)}$\nExercise: a test is 99% sensitive, has 5% false positives, and the disease prevalence is 1%. Find P(sick | positive).",
    },
    links: ['conditional'],
    answer: [/0[.,]16[67]/, /16[.,][67]\s*\\?%/, /\b1\/6\b/, /\\frac\{1\}\{6\}/],
  },
  {
    note: {
      id: 'series-circuit',
      kinds: ['exercise'],
      text: 'Circuito en serie\n$R_{eq} = R_1 + R_2 + R_3$\nEjercicio: tres resistencias de 2 Ω, 3 Ω y 5 Ω en serie con una fuente de 20 V. Halla la corriente.',
    },
    links: ['ohm'],
    answer: [/\b2\s*(A\b|amperios|amperes|amps)/i],
  },
  {
    // The helpful prior note is in the other language.
    note: {
      id: 'binary-search',
      kinds: ['question', 'board'],
      text: 'Binary search\nEach step halves the search space: $n \\to n/2 \\to n/4 \\dots \\to 1$\nSteps needed: $k$ where $n / 2^k = 1$\nQuestion: why is the running time $O(\\log n)$?',
    },
    links: ['logarithms'],
  },
  {
    note: {
      id: 'by-parts',
      kinds: ['exercise', 'formula'],
      text: 'Integration by parts\n$\\int u\\,dv = uv - \\int v\\,du$\nExercise: $\\int x e^x dx$',
    },
    links: ['product-rule', 'derivative'],
    answer: [/x\s*e\^\{?x\}?\s*-\s*e\^\{?x\}?/, /e\^\{?x\}?\s*\(\s*x\s*-\s*1\s*\)/, /\(\s*x\s*-\s*1\s*\)\s*e\^/],
  },
  {
    note: {
      id: 'vertical-throw',
      kinds: ['exercise'],
      text: 'Tiro vertical\nSe lanza una pelota hacia arriba con $v_0 = 20$ m/s. $g = 10$ m/s².\n¿Cuál es la altura máxima?',
    },
    links: ['kinematics'],
    answer: [/\b20\s*(m\b(?!\/)|metros)/i],
  },
  {
    note: {
      id: 'stoichiometry',
      kinds: ['exercise'],
      text: 'Estequiometría\n$2H_2 + O_2 \\to 2H_2O$\nEjercicio: ¿cuántos gramos de agua se forman con 4 g de $H_2$? ($M(H_2) = 2$ g/mol)',
    },
    links: ['mole'],
    answer: [/\b36\s*(g\b|gramos)/i],
  },
  {
    note: {
      id: 'constant-derivative',
      kinds: ['question'],
      text: '¿Por qué la derivada de una constante es cero?',
    },
    links: ['derivative'],
  },
  {
    note: {
      id: 'variance',
      kinds: ['exercise', 'formula'],
      text: 'Varianza\n$\\sigma^2 = \\frac{1}{N}\\sum (x_i - \\mu)^2$\nEjercicio: calcula la varianza de 2, 4, 6.',
    },
    links: ['weighted'],
    linkOptional: true,
    answer: [/2[.,]6[67]/, /\b8\/3\b/, /\\frac\{8\}\{3\}/],
  },
  {
    // Nothing in the library helps. Linking the other history note would be wrong.
    note: {
      id: 'generation-98',
      kinds: ['board', 'other'],
      text: 'Generación del 98\nAutores: Unamuno, Machado, Baroja, Azorín.\nTema: la preocupación por España tras el desastre de 1898.',
    },
    links: [],
  },
  {
    note: {
      id: 'meeting',
      kinds: ['other'],
      text: 'Reminders: project deadline Friday, bring the laptop, room B-204.',
    },
    links: [],
  },
];

/** The two notes the in-app demo loads, for checking the exact demo path. */
export const DEMO_LIBRARY_IDS = ['weighted', 'ohm'];
