#!/usr/bin/env node
/**
 * End-to-end proof that alRato works as a product, in the real installed Chrome.
 *
 *   node scripts/e2e.mjs                    every journey, phone and desktop, English and Spanish
 *   node scripts/e2e.mjs --only=A,F         some journeys
 *   node scripts/e2e.mjs --viewport=phone --lang=es
 *   node scripts/e2e.mjs --no-build         reuse the last e2e build
 *
 * Real: the production build, its service worker, IndexedDB, the Firebase AI Logic SDK with
 * its hybrid dispatch, App Check, camera permissions and Chrome itself.
 * Fake, on purpose: the answers from the network (Gemini, App Check, Remote Config) and, in the
 * on-device scenarios, the Prompt API behind `window.LanguageModel`. No Gemini model runs here,
 * so these tests prove the product's behavior around the models, never the quality of a model.
 *
 * Nothing can reach the real network. Chrome runs with DNS switched off, and every request that
 * is not the local preview server is answered or refused by the interception in this file.
 * Only the Chrome and preview processes started here are ever closed.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, '.local');
const PROFILE = join(LOCAL, 'e2e-profile');
const SHOTS = join(LOCAL, 'shots');
const ASSETS = join(LOCAL, 'e2e-assets');
const TEMP_DIR = join(LOCAL, 'tmp');
const REPORT = join(LOCAL, 'e2e-report.json');
const DIST = '.local/e2e-dist';
const ENV_FILE = join(ROOT, '.env.e2e');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PORT = 4180;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const FAKE_ENV = `# Obviously fake values for scripts/e2e.mjs. Git-ignored, and never a real project.
VITE_FIREBASE_API_KEY=fake-e2e-api-key
VITE_FIREBASE_AUTH_DOMAIN=alrato-e2e.invalid
VITE_FIREBASE_PROJECT_ID=alrato-e2e-fake
VITE_FIREBASE_STORAGE_BUCKET=alrato-e2e-fake.invalid
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000e2e0fake
VITE_RECAPTCHA_ENTERPRISE_KEY=fake-e2e-recaptcha-site-key
VITE_APPCHECK_DEBUG_TOKEN=
`;

const VIEWPORTS = {
  phone: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
  desktop: { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false },
};
const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';

const argv = process.argv.slice(2);
const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const ONLY = option('only')?.toUpperCase().split(',') ?? null;
const VIEWPORT_NAMES = option('viewport') ? [option('viewport')] : Object.keys(VIEWPORTS);
const LANGS = option('lang') ? [option('lang')] : ['en', 'es'];
const SKIP_BUILD = argv.includes('--no-build');
const VERBOSE = argv.includes('--verbose');

const childEnv = {
  ...process.env,
  TEMP: TEMP_DIR,
  TMP: TEMP_DIR,
  npm_config_cache: join(LOCAL, 'npm-cache'),
};

/* ------------------------------------------------------------------ */
/* Interface strings                                                   */
/* ------------------------------------------------------------------ */

function loadMessages(file) {
  const source = readFileSync(join(ROOT, 'src', 'i18n', file), 'utf8');
  const messages = {};
  for (const [, key, value] of source.matchAll(/^\s*'([\w.]+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)) {
    messages[key] = value.replace(/\\(.)/g, '$1');
  }
  return messages;
}

const MESSAGES = { en: loadMessages('en.ts'), es: loadMessages('es.ts') };
if (Object.keys(MESSAGES.en).length < 200 || Object.keys(MESSAGES.en).length !== Object.keys(MESSAGES.es).length) {
  throw new Error('Could not read every interface string from src/i18n');
}

function translate(lang, key, vars = {}) {
  let message = MESSAGES[lang][key];
  if (message === undefined) throw new Error(`No "${key}" in ${lang}.ts`);
  for (const [name, value] of Object.entries(vars)) message = message.replaceAll(`{${name}}`, String(value));
  return message;
}

// The consent sheet keeps its legal wording in one place, inside the component.
const CONSENT = {
  en: { title: 'Before alRato uses cloud AI', agree: 'I am 18+ and I agree', decline: 'Keep everything on this device' },
  es: { title: 'Antes de usar la IA en la nube', agree: 'Tengo 18+ y acepto', decline: 'Dejar todo en este dispositivo' },
};

/** Text from one language showing up in the other, or a raw message key. */
function untranslated(strings, lang) {
  const other = lang === 'en' ? 'es' : 'en';
  const exact = new Set();
  const patterns = [];
  for (const [key, text] of Object.entries(MESSAGES[other])) {
    if (text === MESSAGES[lang][key] || text.length < 3) continue;
    if (text.includes('{')) {
      const source = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+');
      patterns.push(new RegExp(`^${source}$`));
    } else {
      exact.add(text);
    }
  }
  return strings.filter(
    (s) => exact.has(s) || patterns.some((p) => p.test(s)) || /^(error|wait|reason|kind|action|ladder|detail|home|ai|sync|nav|common|practice|library|receipt|engine|capture)\.[\w.]+$/.test(s),
  );
}

/* ------------------------------------------------------------------ */
/* Canned model answers                                                */
/* ------------------------------------------------------------------ */

const CANNED = {
  en: {
    read: "Bellman equation\n$V(s) = \\sum_{s'} P(s'|s)\\,[\\, r(s,s') + \\gamma\\, V(s') \\,]$\nwhere:\n- $V(s)$: value of state s\n- $P(s'|s)$: transition probability\n- $r(s,s')$: reward\n- $\\gamma$: discount factor ($0 < \\gamma < 1$)\nExercise: compute $V(s)$ if $P = 0.7$, $r = 2$, $\\gamma = 0.9$, $V(s') = 10$",
    analysis: {
      kind: 'exercise',
      title: 'Bellman equation',
      subject: 'Reinforcement learning',
      topic: 'Value functions',
      teaches: ['Bellman equation', 'Value function'],
      teaches_en: ['bellman equation', 'value function'],
      needs_en: ['weighted average', 'probability'],
      needs_review: false,
    },
    editedTitle: 'Corrected Bellman note',
    hints: [
      'Look at what multiplies the bracket. What does it do to each possible next state?',
      'Treat the probability as a weight: this is a weighted average of future values.',
      "First step: work out the bracket, $r + \\gamma V(s') = 2 + 0.9 \\cdot 10 = 11$. What do you do with it next?",
      'Full solution: the bracket is $11$ and the probability weighs it, so $V(s) = 0.7 \\cdot 11 = 7.7$.',
    ],
    connection: "You already know weighted averages: each value times its weight. Here the probabilities $P(s'|s)$ are those weights.",
    practice: ["What does $P(s'|s)$ do in the Bellman equation?", 'It weights the value of each next state.'],
  },
  es: {
    read: "Ecuación de Bellman\n$V(s) = \\sum_{s'} P(s'|s)\\,[\\, r(s,s') + \\gamma\\, V(s') \\,]$\ndonde:\n- $V(s)$: valor del estado s\n- $P(s'|s)$: probabilidad de transición\n- $r(s,s')$: recompensa\n- $\\gamma$: factor de descuento ($0 < \\gamma < 1$)\nEjercicio: calcula $V(s)$ si $P = 0{,}7$, $r = 2$, $\\gamma = 0{,}9$, $V(s') = 10$",
    analysis: {
      kind: 'exercise',
      title: 'Ecuación de Bellman',
      subject: 'Aprendizaje por refuerzo',
      topic: 'Funciones de valor',
      teaches: ['Ecuación de Bellman', 'Función de valor'],
      teaches_en: ['bellman equation', 'value function'],
      needs_en: ['weighted average', 'probability'],
      needs_review: false,
    },
    editedTitle: 'Apunte de Bellman corregido',
    hints: [
      'Mira qué multiplica al corchete. ¿Qué le hace a cada estado siguiente posible?',
      'Piensa en la probabilidad como un peso: esto es un promedio ponderado de valores futuros.',
      "Primer paso: resuelve el corchete, $r + \\gamma V(s') = 2 + 0{,}9 \\cdot 10 = 11$. ¿Qué haces después con ese valor?",
      'Solución completa: el corchete vale $11$ y la probabilidad lo pondera, así que $V(s) = 0{,}7 \\cdot 11 = 7{,}7$.',
    ],
    connection: "Ya conoces el promedio ponderado: cada valor por su peso. Aquí las probabilidades $P(s'|s)$ son esos pesos.",
    practice: ["¿Qué hace $P(s'|s)$ en la ecuación de Bellman?", 'Pondera el valor de cada estado siguiente.'],
  },
};

/** Marks an edit made by a journey, so the model mock can tell old text from new text. */
const EDIT_MARK = 'E2E-EDITED';

// These two run in Node for the cloud mock and, unchanged, inside the page for the fake Nano.
function taskOf(systemPrompt) {
  if (systemPrompt.startsWith('You transcribe')) return 'read';
  if (systemPrompt.startsWith('You organize')) return 'analyze';
  return 'help';
}

function cannedAnswer(task, prompt, lang, canned, editMark) {
  const c = canned[lang];
  if (task === 'read') return JSON.stringify({ text: c.read, legibility: 'high' });
  if (task === 'analyze') {
    return JSON.stringify({ ...c.analysis, title: prompt.includes(editMark) ? c.editedTitle : c.analysis.title });
  }
  const level = Number(prompt.match(/Level (\d)/)?.[1] ?? 1);
  const prior = prompt.match(/<prior id="([^"]+)"/)?.[1] ?? '';
  return JSON.stringify({
    help: c.hints[level - 1] ?? c.hints[0],
    source_id: prior,
    connection: prior ? c.connection : '',
    practice_q: c.practice[0],
    practice_a: c.practice[1],
  });
}

/* ------------------------------------------------------------------ */
/* Code injected into the page                                         */
/* ------------------------------------------------------------------ */

function pageHelpers() {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    if (!el?.isConnected || el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  };
  const labelOf = (el) =>
    norm(el.getAttribute('aria-label') || el.innerText || el.querySelector('img')?.alt || el.getAttribute('title') || el.value);
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  // An open <dialog> makes the rest of the page inert, just as it is for a real user.
  const scope = (within) => {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) return (within && dialog.querySelector(within)) || dialog;
    return (within && document.querySelector(within)) || document.body;
  };
  const CLICKABLE = 'button, a[href], [role="radio"], label.toggle';

  window.__e2e = {
    norm,
    isVisible,
    text: () => norm(document.body.innerText),
    has: (needle) => norm(document.body.innerText).toLowerCase().includes(norm(needle).toLowerCase()),
    find(text, within) {
      const needle = norm(text).toLowerCase();
      const root = scope(within);
      const items = [root, ...root.querySelectorAll('*')].filter((el) => el.matches(CLICKABLE) && isVisible(el));
      const match = (test) => items.find((el) => test(labelOf(el).toLowerCase()));
      return match((l) => l === needle) ?? match((l) => l.startsWith(needle)) ?? match((l) => l.includes(needle)) ?? null;
    },
    /** Where to tap: only once fonts are in and the element has stopped moving. */
    async point(text, within) {
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      await document.fonts.ready;
      const el = this.find(text, within);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await frame();
      const before = el.getBoundingClientRect();
      await frame();
      await frame();
      const r = el.getBoundingClientRect();
      if (!el.isConnected || Math.abs(r.top - before.top) > 0.5 || Math.abs(r.left - before.left) > 0.5) return null;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const covered = !hit ? 'nothing there' : el.contains(hit) || hit.contains(el) ? null : describe(hit);
      return { x, y, covered, disabled: el.disabled === true, label: labelOf(el).slice(0, 60) };
    },
    selectorText(selector) {
      return [...document.querySelectorAll(selector)].filter(isVisible).map((el) => norm(el.innerText));
    },
    strings() {
      const out = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        const value = norm(walker.currentNode.nodeValue);
        if (!value || !parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) continue;
        if (parent.closest('.katex') || !isVisible(parent)) continue;
        out.add(value);
      }
      for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], img[alt]')) {
        if (!isVisible(el)) continue;
        for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
          const value = norm(el.getAttribute(attr));
          if (value) out.add(value);
        }
      }
      return [...out];
    },
    overflow() {
      const doc = document.documentElement;
      const width = doc.clientWidth;
      const issues = [];
      if (doc.scrollWidth > width + 1) issues.push(`page is ${doc.scrollWidth}px wide in a ${width}px viewport`);
      const clippedInside = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        if (!isVisible(el) || el.closest('svg') || el.closest('[aria-hidden="true"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if ((r.right > width + 1 || r.left < -1) && !clippedInside(el)) {
          issues.push(`${describe(el)} spans ${Math.round(r.left)} to ${Math.round(r.right)} of ${width}px`);
        }
      }
      return issues.slice(0, 6);
    },
    async rows(store) {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('alrato');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const rows = await new Promise((resolve, reject) => {
          const request = database.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return JSON.parse(JSON.stringify(rows, (_, value) => (value instanceof Blob ? `blob:${value.size}` : value)));
      } finally {
        database.close();
      }
    },
  };
}

function fakeNano(canned, editMark, cannedFn, taskFn) {
  const state = { availability: 'available', created: 0, prompts: [], images: 0, failNext: 0 };
  window.__nano = state;
  class Session {
    constructor(options) {
      this.system = options?.initialPrompts?.[0]?.content?.[0]?.value ?? '';
    }
    async prompt(messages) {
      const parts = messages.flatMap((message) => message.content);
      const text = parts.filter((part) => part.type === 'text').map((part) => part.value).join('\n');
      const images = parts.filter((part) => part.type === 'image').length;
      const task = taskFn(this.system);
      state.prompts.push({ task, images });
      state.images += images;
      await new Promise((r) => setTimeout(r, 60));
      if (state.failNext > 0) {
        state.failNext -= 1;
        throw new DOMException('The on-device model crashed.', 'UnknownError');
      }
      const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
      return cannedFn(task, text, lang, canned, editMark);
    }
    destroy() {}
  }
  Object.defineProperty(window, 'LanguageModel', {
    configurable: true,
    writable: true,
    value: {
      availability: async () => state.availability,
      params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
      create: async (options) => {
        state.created += 1;
        return new Session(options);
      },
    },
  });
}

const RECAPTCHA_STUB = `(() => {
  const widgets = new Map();
  let next = 1;
  self.grecaptcha = {
    enterprise: {
      ready: (callback) => queueMicrotask(callback),
      render: (_container, params) => { const id = next++; widgets.set(id, params); return id; },
      execute: async (id) => { widgets.get(id)?.callback?.('e2e-recaptcha-attestation'); return 'e2e-recaptcha-attestation'; },
      reset: () => {},
      getResponse: () => 'e2e-recaptcha-attestation',
    },
  };
})();`;

/* ------------------------------------------------------------------ */
/* The fake cloud                                                      */
/* ------------------------------------------------------------------ */

const APP_CHECK_TOKEN = 'e2e-fake-app-check-token';

const ERROR_BODIES = {
  429: { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } },
  403: { error: { code: 403, message: 'Firebase App Check token is invalid.', status: 'PERMISSION_DENIED' } },
  500: { error: { code: 500, message: 'The model is overloaded.', status: 'INTERNAL' } },
};

/** Answers Gemini requests the way the real endpoint does, and counts every one. */
class FakeCloud {
  calls = [];
  /** null, 429, 403, 500, 'malformed', 'garbage' or 'disconnect'. */
  failure = null;
  /** Makes the model file the note under another kind, as a real model sometimes does. */
  kind = null;
  gates = [];

  count(task) {
    return task ? this.calls.filter((call) => call.task === task).length : this.calls.length;
  }

  /** Makes the next request for this task wait until `release()` is called. */
  hold(task) {
    const gate = { task, reached: false };
    gate.opened = new Promise((resolve) => (gate.release = resolve));
    this.gates.push(gate);
    return gate;
  }
}

/* ------------------------------------------------------------------ */
/* DevTools protocol                                                   */
/* ------------------------------------------------------------------ */

class Cdp {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener('open', resolve, { once: true });
      cdp.#socket.addEventListener('error', () => reject(new Error('Could not reach Chrome')), { once: true });
    });
    cdp.#socket.addEventListener('message', (event) => cdp.#receive(JSON.parse(event.data)));
    cdp.#socket.addEventListener('close', () => {
      for (const { reject, method } of cdp.#pending.values()) reject(new Error(`Connection closed during ${method}`));
      cdp.#pending.clear();
    });
    return cdp;
  }

  #receive(message) {
    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
  }

  on(method, listener) {
    this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), listener]);
  }

  /** Every call has a deadline, so a stuck page fails its journey instead of hanging the run. */
  send(method, params = {}, sessionId, timeout = 45_000) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} got no answer in ${timeout / 1000} s`));
      }, timeout);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.#pending.set(id, { resolve: settle(resolve), reject: settle(reject), method });
      this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.#socket.close();
  }
}

/* ------------------------------------------------------------------ */
/* Processes we own                                                    */
/* ------------------------------------------------------------------ */

function runToEnd(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`${label} failed:\n${output}`))));
  });
}

async function startPreview() {
  const child = spawn(
    process.execPath,
    [VITE, 'preview', '--mode', 'e2e', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`The preview server stopped:\n${output}`);
    try {
      if ((await fetch(`${ORIGIN}/`)).ok) return child;
    } catch {
      await sleep(100);
    }
  }
  child.kill();
  throw new Error(`The preview server did not start:\n${output}`);
}

async function launchChrome() {
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(PROFILE, { recursive: true });
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${PROFILE}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--disable-default-apps',
      '--disable-breakpad',
      '--disable-features=Translate,MediaRouter,OptimizationHints,OptimizationGuideModelDownloading,OptimizationGuideOnDeviceModel,AutofillServerCommunication,InterestFeedContentSuggestions',
      '--metrics-recording-only',
      '--no-pings',
      '--no-proxy-server',
      // DNS answers nothing but the preview server, so no request can reach the real network.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--use-fake-device-for-media-stream',
      '--mute-audio',
      '--hide-scrollbars',
      `--disk-cache-dir=${join(PROFILE, 'cache')}`,
      '--window-size=1366,768',
    ],
    { env: childEnv, stdio: 'ignore' },
  );
  const portFile = join(PROFILE, 'DevToolsActivePort');
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error('Chrome exited during startup');
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && path) return { child, url: `ws://127.0.0.1:${port}${path}` };
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('Chrome did not open its debugging port');
}

/* ------------------------------------------------------------------ */
/* One isolated browser profile with one tab                           */
/* ------------------------------------------------------------------ */

class Browser {
  /** Every DevTools session we opened, so events reach the right tab. */
  sessions = new Map();
  contexts = new Map();

  static async start() {
    const browser = new Browser();
    const { child, url } = await launchChrome();
    browser.child = child;
    browser.cdp = await Cdp.connect(url);
    const { cdp, sessions } = browser;
    const toTab = (handler) => (params, sessionId) => {
      const tab = sessions.get(sessionId);
      if (tab) handler(tab, params, sessionId);
    };
    cdp.on('Fetch.requestPaused', toTab((tab, params, sessionId) => void tab.onRequest(params, sessionId)));
    cdp.on('Runtime.exceptionThrown', toTab((tab, params) => {
      const details = params.exceptionDetails;
      tab.console.push(`exception: ${details.exception?.description ?? details.text}`);
    }));
    cdp.on('Runtime.consoleAPICalled', toTab((tab, params) => {
      if (params.type !== 'error') return;
      tab.console.push(`console.error: ${params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }));
    cdp.on('Log.entryAdded', toTab((tab, { entry }) => {
      if (entry.level === 'error') tab.console.push(`${entry.source}: ${entry.text} ${entry.url ?? ''}`);
    }));
    cdp.on('Page.javascriptDialogOpening', toTab((tab, params, sessionId) => {
      tab.dialogs.push(params.message);
      void cdp.send('Page.handleJavaScriptDialog', { accept: tab.acceptDialogs }, sessionId).catch(() => {});
    }));
    cdp.on('Network.responseReceived', toTab((tab, params) => {
      if (params.type === 'Document') tab.lastDocument = params.response;
    }));
    cdp.on('Target.targetCreated', ({ targetInfo }) => void browser.#adoptWorker(targetInfo));
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    return browser;
  }

  /** Service workers get the same interception and the same offline switch as the page. */
  async #adoptWorker(info) {
    if (info.type !== 'service_worker') return;
    const tab = this.contexts.get(info.browserContextId);
    if (!tab) return;
    try {
      const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
      this.sessions.set(sessionId, tab);
      tab.workerSessions.push(sessionId);
      await this.cdp.send('Network.enable', {}, sessionId);
      await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
      if (tab.offline) await this.cdp.send('Network.emulateNetworkConditions', OFFLINE, sessionId);
    } catch {
      // A worker can stop while we attach. It is adopted again when it next starts.
    }
  }

  async stop() {
    try {
      await Promise.race([this.cdp.send('Browser.close'), sleep(5000)]);
    } catch {
      // Already closing.
    }
    this.cdp.close();
    await Promise.race([new Promise((resolve) => this.child.once('exit', resolve)), sleep(5000)]);
    // Only the process this script started, identified by its handle.
    if (this.child.exitCode === null) this.child.kill();
    await sleep(300);
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

const JOURNEY_TIMEOUT_MS = 240_000;

const OFFLINE = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
const ONLINE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

class Tab {
  cloud = new FakeCloud();
  console = [];
  dialogs = [];
  /** Every request that left the page for anywhere but the preview server. */
  external = [];
  /** External requests that nothing in this file expected. */
  blocked = [];
  workerSessions = [];
  acceptDialogs = true;
  offline = false;

  /**
   * @param nano 'none' (no Prompt API, like a phone), 'unavailable', 'downloadable' or 'ready'.
   * @param consent null (the student has not been asked), 'granted' or 'declined'.
   * @param camera 'granted' (a fake camera) or 'denied'.
   */
  constructor(scenario, { nano = 'none', consent = null, camera = 'denied', allowErrors = [] } = {}) {
    this.scenario = scenario;
    this.browser = scenario.browser;
    this.cdp = scenario.browser.cdp;
    this.lang = scenario.lang;
    this.viewport = VIEWPORTS[scenario.viewportName];
    this.mobile = this.viewport.mobile;
    this.nano = nano;
    this.consent = consent;
    this.camera = camera;
    this.allowErrors = allowErrors;
    this.t = (key, vars) => translate(this.lang, key, vars);
    this.c = CANNED[this.lang];
    this.k = CONSENT[this.lang];
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async init() {
    const { browserContextId } = await this.cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    this.contextId = browserContextId;
    this.browser.contexts.set(browserContextId, this);
    await this.cdp.send('Browser.setPermission', {
      browserContextId,
      origin: ORIGIN,
      permission: { name: 'camera' },
      setting: this.camera,
    });
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    this.targetId = targetId;
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    this.browser.sessions.set(sessionId, this);

    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Log.enable'),
      this.send('Network.enable'),
      this.send('Accessibility.enable'),
    ]);
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await this.send('Emulation.setDeviceMetricsOverride', this.viewport);
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: this.mobile, maxTouchPoints: this.mobile ? 5 : 1 });
    if (this.mobile) await this.send('Network.setUserAgentOverride', { userAgent: PHONE_UA, platform: 'Android' });

    await this.inject(`(${pageHelpers})();`);
    await this.inject(`
      if (location.origin === ${JSON.stringify(ORIGIN)}) {
        if (!localStorage.getItem('alrato.lang')) localStorage.setItem('alrato.lang', ${JSON.stringify(this.lang)});
        ${this.consent ? `if (!localStorage.getItem('alrato.cloudConsent.v1')) localStorage.setItem('alrato.cloudConsent.v1', ${JSON.stringify(this.consent)});` : ''}
      }`);
    if (this.nano === 'none') {
      await this.inject(`delete window.LanguageModel; Object.defineProperty(window, 'LanguageModel', { value: undefined, configurable: true, writable: true });`);
    } else {
      await this.inject(`(${fakeNano})(${JSON.stringify(CANNED)}, ${JSON.stringify(EDIT_MARK)}, ${cannedAnswer}, ${taskOf}); window.__nano.availability = ${JSON.stringify(this.nano === 'ready' ? 'available' : this.nano)};`);
    }
  }

  inject(source) {
    return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.browser.contexts.delete(this.contextId);
      await this.cdp.send('Target.closeTarget', { targetId: this.targetId });
      await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.contextId });
    } catch {
      // Already gone.
    }
  }

  /* ---------- network ---------- */

  async onRequest(event, sessionId) {
    const { requestId, request } = event;
    const send = (method, params = {}) => this.cdp.send(method, { requestId, ...params }, sessionId).catch(() => {});
    const url = new URL(request.url);
    if (url.origin === ORIGIN || url.protocol === 'data:' || url.protocol === 'blob:') return send('Fetch.continueRequest');

    const header = (name) =>
      Object.entries(request.headers).find(([key]) => key.toLowerCase() === name)?.[1];
    const origin = header('origin') ?? ORIGIN;
    const cors = [
      { name: 'Access-Control-Allow-Origin', value: origin },
      { name: 'Access-Control-Expose-Headers', value: 'ETag' },
      { name: 'Vary', value: 'Origin' },
    ];
    const answer = (status, body, contentType = 'application/json') =>
      send('Fetch.fulfillRequest', {
        responseCode: status,
        responseHeaders: [...cors, { name: 'Content-Type', value: contentType }],
        body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64'),
      });

    if (request.method === 'OPTIONS') {
      return send('Fetch.fulfillRequest', {
        responseCode: 204,
        responseHeaders: [
          ...cors,
          { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { name: 'Access-Control-Allow-Headers', value: header('access-control-request-headers') ?? '*' },
          { name: 'Access-Control-Max-Age', value: '600' },
        ],
      });
    }

    this.external.push({ host: url.hostname, method: request.method, path: url.pathname });

    if (url.hostname === 'www.google.com' && url.pathname.startsWith('/recaptcha/')) {
      return answer(200, RECAPTCHA_STUB, 'text/javascript');
    }
    if (url.hostname === 'content-firebaseappcheck.googleapis.com') {
      if (this.appCheckExchangeFails) return answer(403, ERROR_BODIES[403]);
      return answer(200, { token: APP_CHECK_TOKEN, ttl: '3600s' });
    }
    if (url.hostname === 'firebaseinstallations.googleapis.com') {
      return answer(200, {
        name: 'projects/alrato-e2e-fake/installations/fake',
        fid: 'cE2eFakeFid0000000000A',
        refreshToken: 'e2e-fake-refresh',
        authToken: { token: 'e2e-fake-installations-token', expiresIn: '604800s' },
      });
    }
    if (url.hostname === 'firebaseremoteconfig.googleapis.com') return answer(200, { state: 'NO_TEMPLATE' });
    if (url.hostname === 'firebasevertexai.googleapis.com') return this.#answerGemini(event, url, answer, send, header);

    this.blocked.push(`${request.method} ${url.origin}${url.pathname}`);
    return send('Fetch.failRequest', { errorReason: 'BlockedByClient' });
  }

  async #answerGemini(event, url, answer, send, header) {
    const raw = await this.#postBody(event);
    const body = JSON.parse(raw);
    const system = body.systemInstruction?.parts?.[0]?.text ?? '';
    const parts = body.contents.flatMap((content) => content.parts);
    const prompt = parts.filter((part) => part.text).map((part) => part.text).join('\n');
    const task = taskOf(system);
    const call = {
      task,
      model: url.pathname.match(/models\/([^:]+):/)?.[1],
      hasImage: parts.some((part) => part.inlineData),
      bytes: raw.length,
      appCheck: header('x-firebase-appcheck') === APP_CHECK_TOKEN,
      prompt,
    };
    const { cloud } = this;
    cloud.calls.push(call);

    const gate = cloud.gates.find((g) => g.task === task && !g.reached);
    if (gate) {
      gate.reached = true;
      await gate.opened;
    }
    if (cloud.failure === 'disconnect') return send('Fetch.failRequest', { errorReason: 'InternetDisconnected' });
    if (typeof cloud.failure === 'number') return answer(cloud.failure, ERROR_BODIES[cloud.failure]);
    if (cloud.failure === 'garbage') return answer(200, '<html>Bad gateway</html>');

    await sleep(40);
    let text = cloud.failure === 'malformed' ? '{"kind": "exercise", "title": "Bell' : cannedAnswer(task, prompt, this.lang, CANNED, EDIT_MARK);
    if (task === 'analyze' && cloud.kind && !cloud.failure) text = JSON.stringify({ ...JSON.parse(text), kind: cloud.kind });
    return answer(200, {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 96, totalTokenCount: 908 },
      modelVersion: call.model,
    });
  }

  async #postBody({ request, networkId }) {
    if (request.postData) return request.postData;
    if (request.postDataEntries?.length) {
      return Buffer.concat(request.postDataEntries.map((entry) => Buffer.from(entry.bytes ?? '', 'base64'))).toString('utf8');
    }
    const { postData } = await this.send('Network.getRequestPostData', { requestId: networkId });
    return postData;
  }

  async setOffline(offline) {
    this.offline = offline;
    const conditions = offline ? OFFLINE : ONLINE;
    await this.send('Network.emulateNetworkConditions', conditions);
    for (const sessionId of this.workerSessions) {
      await this.cdp.send('Network.emulateNetworkConditions', conditions, sessionId).catch(() => {});
    }
  }

  /* ---------- reading the page ---------- */

  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (exceptionDetails) {
      throw new Error(`In page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    return result.value;
  }

  async until(label, check, timeout = 15_000) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try {
        last = await check();
        if (last) return last;
      } catch (error) {
        last = error;
      }
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${label}${last instanceof Error ? ` (${last.message})` : ''}`);
  }

  has(text) {
    return this.eval(`__e2e.has(${JSON.stringify(text)})`);
  }

  waitText(text, timeout) {
    return this.until(`text "${text}"`, () => this.has(text), timeout);
  }

  waitGone(text, timeout) {
    return this.until(`"${text}" to disappear`, async () => !(await this.has(text)), timeout);
  }

  textsOf(selector) {
    return this.eval(`__e2e.selectorText(${JSON.stringify(selector)})`);
  }

  waitIn(selector, text, timeout) {
    return this.until(`"${text}" in ${selector}`, async () => {
      const texts = await this.textsOf(selector);
      return texts.some((value) => value.toLowerCase().includes(text.toLowerCase()));
    }, timeout);
  }

  count(selector) {
    return this.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(__e2e.isVisible).length`);
  }

  path() {
    return this.eval(`location.hash.replace(/^#/, '') || '/'`);
  }

  rows(store) {
    return this.eval(`__e2e.rows(${JSON.stringify(store)})`);
  }

  async currentNote() {
    const id = (await this.path()).split('/')[2];
    return (await this.rows('captures')).find((row) => row.id === id);
  }

  waitNoteStatus(status, timeout) {
    return this.until(`note status ${status}`, async () => (await this.currentNote())?.status === status, timeout);
  }

  /* ---------- acting like a person ---------- */

  async goto(path = '/') {
    await this.send('Page.navigate', { url: `${ORIGIN}/#${path}` });
    await this.until('the app to start', () => this.eval(`Boolean(document.querySelector('.shell'))`));
  }

  async reload() {
    await this.send('Page.reload', {});
    await sleep(150);
    await this.until('the app to restart', () => this.eval(`Boolean(document.querySelector('.shell'))`));
  }

  async #tapPoint({ x, y }) {
    if (this.mobile) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(25);
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  }

  async #target(text, within, timeout) {
    let last = null;
    const point = await this.until(`a tappable "${text}"`, async () => {
      last = await this.eval(`__e2e.point(${JSON.stringify(text)}, ${JSON.stringify(within ?? null)})`);
      return last && !last.covered && !last.disabled ? last : null;
    }, timeout).catch((error) => {
      if (last?.covered) throw new Error(`"${text}" is covered by ${last.covered}`);
      throw error;
    });
    return point;
  }

  /** A real tap or click at the element's position, so anything covering it makes this fail. */
  async tap(text, { within, timeout } = {}) {
    await this.#tapPoint(await this.#target(text, within, timeout));
    await sleep(60);
  }

  async doubleTap(text, { within } = {}) {
    const point = await this.#target(text, within);
    if (this.mobile) {
      await this.#tapPoint(point);
      await this.#tapPoint(point);
    } else {
      const { x, y } = point;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (const clickCount of [1, 2]) {
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
      }
    }
    await sleep(60);
  }

  async press(key, code = key, virtualKey = 27) {
    const params = { key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    await sleep(60);
  }

  async nav(key) {
    return this.tap(this.t(key), { within: this.mobile ? '.tabbar' : '.rail nav' });
  }

  async fill(selector, text, { replace = true } = {}) {
    await this.until(`field ${selector}`, () =>
      this.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || !__e2e.isVisible(el)) return false;
        el.focus();
        ${replace ? 'el.select?.();' : 'el.selectionStart = el.selectionEnd = el.value.length;'}
        return document.activeElement === el;
      })()`),
    );
    await this.send('Input.insertText', { text });
    await sleep(40);
  }

  async upload(filePath) {
    const { root } = await this.send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
    if (!nodeId) throw new Error('No file input on this screen');
    await this.send('DOM.setFileInputFiles', { files: [filePath], nodeId });
  }

  async shot(name, { full = false } = {}) {
    mkdirSync(SHOTS, { recursive: true });
    // Sheets slide in. A screenshot should show them where they land.
    await this.eval(`Promise.race([
      Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]).then(() => true)`).catch(() => {});
    const params = { format: 'png' };
    if (full) {
      const { cssContentSize: size } = await this.send('Page.getLayoutMetrics');
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 4000), scale: 1 };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    const s = this.scenario;
    writeFileSync(join(SHOTS, `${s.viewportName}-${s.lang}-${s.key}-${name}.png`), Buffer.from(data, 'base64'));
  }

  /* ---------- quality ---------- */

  async quality(screen) {
    const s = this.scenario;
    const overflow = await this.eval('__e2e.overflow()');
    s.soft(overflow.length === 0, `${screen}: no horizontal overflow`, overflow.join('; '));
    const wrong = untranslated(await this.eval('__e2e.strings()'), this.lang);
    s.soft(wrong.length === 0, `${screen}: no untranslated strings`, wrong.join(' | '));
    const { nodes } = await this.send('Accessibility.getFullAXTree');
    const roles = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'menuitem']);
    const unnamed = nodes.filter((n) => !n.ignored && roles.has(n.role?.value) && !n.name?.value?.trim());
    s.soft(unnamed.length === 0, `${screen}: every control has an accessible name`, unnamed.map((n) => n.role.value).join(', '));
  }

  unexpectedErrors() {
    return this.console.filter((line) => !this.allowErrors.some((pattern) => pattern.test(line)));
  }
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

const results = [];

class Scenario {
  tabs = [];

  constructor(browser, key, viewportName, lang) {
    this.browser = browser;
    this.key = key;
    this.viewportName = viewportName;
    this.lang = lang;
  }

  get id() {
    return `${this.key} ${this.viewportName}/${this.lang}`;
  }

  async tab(options) {
    const tab = new Tab(this, options);
    await tab.init();
    this.tabs.push(tab);
    return tab;
  }

  #record(name, ok, detail) {
    results.push({ journey: this.key, viewport: this.viewportName, lang: this.lang, name, ok, detail: ok ? '' : detail ?? '' });
    if (!ok) console.log(`    FAIL  ${this.id}: ${name}${detail ? `\n          ${detail}` : ''}`);
    else if (VERBOSE) console.log(`    ok    ${name}`);
  }

  /** Records the result and keeps going. */
  soft(ok, name, detail) {
    this.#record(name, Boolean(ok), detail);
  }

  /** Records the result and stops this journey if it failed. */
  expect(ok, name, detail) {
    this.#record(name, Boolean(ok), detail);
    if (!ok) throw new StopJourney(name);
  }

  /** Waits for something that must happen, and records it as one check. */
  async step(name, work) {
    try {
      const value = await work();
      this.#record(name, true);
      return value;
    } catch (error) {
      this.#record(name, false, error.message);
      throw new StopJourney(name);
    }
  }

  fail(error) {
    if (!(error instanceof StopJourney)) this.#record('journey finished', false, error.stack ?? String(error));
  }
}

class StopJourney extends Error {}

/* ------------------------------------------------------------------ */
/* Shared flows                                                        */
/* ------------------------------------------------------------------ */

/** Home, sample notes, then the Bellman board. Leaves the app on the new note. */
async function addBellmanBoard(s, tab) {
  await tab.goto('/');
  await tab.waitText(tab.t('home.tryDemo'));
  await tab.tap(tab.t('home.tryDemo'));
  await tab.waitText(tab.t('home.demoAdd'));
  await tab.tap(tab.t('home.demoAdd'));
  await tab.until('the note screen', async () => (await tab.path()).startsWith('/note/'));
}

async function agreeToCloud(s, tab) {
  await s.step('the consent sheet appears before anything is sent', async () => {
    await tab.waitText(tab.k.title);
    if (tab.cloud.count() !== 0) throw new Error(`${tab.cloud.count()} requests were sent before consent`);
  });
  await tab.tap(tab.k.agree);
  await tab.waitGone(tab.k.title);
}

async function readyBellman(s, tab) {
  await addBellmanBoard(s, tab);
  if (tab.consent === null && tab.nano !== 'ready') await agreeToCloud(s, tab);
  await tab.waitNoteStatus('ready');
  await tab.waitIn('.topbar h1', tab.c.analysis.title);
}

const hintLabel = (tab, level) =>
  level === 1 ? tab.t('action.hint') : level === 4 ? tab.t('ladder.reveal') : tab.t('ladder.next');

async function climbLadder(tab, levels = 4) {
  for (let level = 1; level <= levels; level += 1) {
    await tab.tap(hintLabel(tab, level));
    await tab.until(`hint level ${level}`, async () => (await tab.count('.aid')) === level, 15_000);
    await tab.waitIn('.aid h3', tab.t(`ladder.${level}`));
  }
}

/** Waits for the app to go quiet, so a request that should not happen has time to happen. */
const settle = (ms = 700) => sleep(ms);

const shownReceipts = (tab) => tab.textsOf('.receipt button');

/* ------------------------------------------------------------------ */
/* Journey A: first run, the whole product                             */
/* ------------------------------------------------------------------ */

async function journeyA(s) {
  const tab = await s.tab();
  const { t, c } = tab;

  await tab.goto('/');
  await s.step('home shows the pitch', () => tab.waitText(t('home.tagline')));
  await tab.quality('home, first run');
  await tab.shot('01-home');

  await tab.tap(t('home.tryDemo'));
  await s.step('sample notes load', async () => {
    await tab.waitText(t('sample.weighted.title'));
    await tab.waitText(t('sample.ohm.title'));
    await tab.waitText(t('home.demoNext'));
  });
  await tab.quality('home with samples');
  await tab.shot('02-samples');

  const reading = tab.cloud.hold('read');
  const organizing = tab.cloud.hold('analyze');
  await tab.tap(t('home.demoAdd'));
  await tab.until('the note screen', async () => (await tab.path()).startsWith('/note/'));
  await agreeToCloud(s, tab);
  await tab.quality('note, reading');

  await s.step('the board is being read', async () => {
    await tab.until('the read request', () => reading.reached);
    await tab.waitText(t('detail.reading'));
  });
  await tab.shot('03-reading');
  reading.release();

  await s.step('the transcription shows while the board is being organized', async () => {
    await tab.until('the analyze request', () => organizing.reached);
    await tab.waitText(t('detail.processing'));
    await tab.until('the transcription', async () => (await tab.count('.card .math-text .katex')) > 0);
  });
  await tab.shot('03b-organizing');
  organizing.release();

  await s.step('the note is read and organized', async () => {
    await tab.waitNoteStatus('ready');
    await tab.waitIn('.topbar h1', c.analysis.title);
    await tab.waitIn('.chip-kind', t('kind.exercise'));
    await tab.until('rendered math', async () => (await tab.count('.math-text .katex')) > 0);
  });
  await s.step('the read request carried the photo and an App Check token', async () => {
    const [read] = tab.cloud.calls;
    if (!read?.hasImage) throw new Error('no image in the read request');
    if (!read.appCheck) throw new Error('no valid App Check token');
  });
  await tab.quality('note, organized');
  await tab.shot('04-organized');

  await s.step('the ladder invites a first try', () => tab.waitText(t('ladder.intro')));
  for (let level = 1; level <= 4; level += 1) {
    await tab.tap(hintLabel(tab, level));
    await s.step(`hint level ${level} appears`, async () => {
      await tab.until(`level ${level}`, async () => (await tab.count('.aid')) === level);
      await tab.waitIn('.aid h3', t(`ladder.${level}`));
      await tab.waitText(c.hints[level - 1].split('$')[0].trim());
    });
    if (level === 1) {
      await s.step('the first hint links to the note the student already has', async () => {
        await tab.waitText(t('link.title'));
        await tab.waitIn('.link-card', t('sample.weighted.title'));
      });
      await tab.shot('05-first-hint');
    }
  }
  s.expect((await tab.count('.link-card')) === 1, 'the connection is shown once, not on every hint');
  await s.step('the ladder ends after the full solution', async () => {
    await tab.waitGone(t('ladder.reveal'));
    if (await tab.has(t('ladder.next'))) throw new Error('still offering another hint');
  });
  s.expect(tab.cloud.count('help') === 4, 'one request per hint', `${tab.cloud.count('help')} help requests`);
  s.expect(tab.cloud.count('read') === 1 && tab.cloud.count('analyze') === 1, 'one read and one organize');
  await tab.quality('note, full ladder');
  await tab.shot('06-ladder');

  await tab.tap(t('link.open'));
  await s.step('the linked note opens', () => tab.waitIn('.topbar h1', t('sample.weighted.title')));
  await tab.quality('linked note');
  await tab.tap(t('common.back'), { within: '.topbar' });
  await s.step('going back keeps every hint', async () => {
    await tab.waitIn('.topbar h1', c.analysis.title);
    await tab.until('all hints', async () => (await tab.count('.aid')) === 4);
    await tab.waitText(t('link.title'));
  });

  await tab.tap(t('practice.button'), { within: '.main' });
  await s.step('practice opens with a question', async () => {
    await tab.until('the practice screen', async () => (await tab.path()).startsWith('/practice/'));
    await tab.until('the question', async () => (await tab.count('.question .katex')) > 0);
  });
  await tab.quality('practice, question');
  await tab.fill('.practice input', 'weights');
  await tab.tap(t('practice.reveal'));
  await s.step('the answer is revealed with the student attempt', async () => {
    await tab.waitText(c.practice[1]);
    await tab.waitText(`${t('practice.yours')}: weights`);
  });
  await tab.quality('practice, answer');
  await tab.shot('07-answer');

  await tab.tap(t('practice.remembered'));
  await s.step('rating schedules the next review in 3 days', async () => {
    await tab.waitText(t('practice.done'));
    await tab.waitText(t('practice.nextMany', { n: 3 }));
  });
  await tab.shot('08-scheduled');
  const [card] = await tab.rows('cards');
  const daysAhead = (card.dueAt - Date.now()) / 86_400_000;
  s.expect(card.box === 1 && card.reps === 1 && card.lastResult === 'remembered', 'the card moved up one box');
  s.expect(daysAhead > 2.9 && daysAhead < 3.1, 'the card is due in 3 days', `${daysAhead.toFixed(2)} days`);

  await tab.tap(t('practice.home'));
  await s.step('home has nothing to review today', async () => {
    await tab.waitText(t('home.latest'));
    if (await tab.has(t('home.toReview'))) throw new Error('the card is still due');
  });

  // Four days later, by moving the page clock. Nothing else changes.
  await tab.inject(`(() => {
    const RealDate = Date;
    const shift = 4 * 86400000;
    class ShiftedDate extends RealDate {
      constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + shift); }
      static now() { return RealDate.now() + shift; }
    }
    window.Date = ShiftedDate;
  })();`);
  await tab.reload();
  await s.step('four days later the card is due again', () => tab.waitText(t('home.toReview')));
  await tab.shot('09-due-again');
  await tab.tap(c.analysis.title, { within: '.review-row' });
  await tab.tap(t('practice.reveal'));
  await tab.tap(t('practice.neededHelp'));
  await s.step('needing help brings the card back tomorrow', () => tab.waitText(t('practice.nextOne')));
  const [after] = await tab.rows('cards');
  s.expect(after.box === 0 && after.lastResult === 'needed_help' && after.reps === 2, 'the card went back to the first box');
}

/* ------------------------------------------------------------------ */
/* Journey B: the receipt tells the truth                              */
/* ------------------------------------------------------------------ */

async function journeyB(s) {
  // No local model, like a phone: the cloud does the work and the receipt says so.
  const cloudTab = await s.tab();
  await readyBellman(s, cloudTab);
  await cloudTab.tap(cloudTab.t('action.hint'));
  await cloudTab.until('the hint', async () => (await cloudTab.count('.aid')) === 1);
  await s.step('without a local model the receipts say cloud, with the bytes sent', async () => {
    const receipts = await shownReceipts(cloudTab);
    if (receipts.length < 3) throw new Error(`only ${receipts.length} receipts`);
    if (!receipts.every((text) => text.includes(cloudTab.t('receipt.cloud')))) throw new Error(receipts.join(' / '));
    if (!receipts.some((text) => text.includes(cloudTab.t('receipt.photoSent')))) throw new Error('no photo receipt');
    if (!receipts.some((text) => text.includes(cloudTab.t('receipt.textOnly')))) throw new Error('no text receipt');
    if (!receipts.every((text) => /\d/.test(text))) throw new Error('no size on a receipt');
  });
  s.expect(cloudTab.cloud.count() === 3, 'the interception saw exactly 3 Gemini requests', `${cloudTab.cloud.count()}`);
  await cloudTab.tap(cloudTab.t('receipt.cloud'), { within: '.aid' });
  await s.step('the receipt explains why it used the cloud', async () => {
    await cloudTab.waitText(cloudTab.t('reason.no_local_model'));
    await cloudTab.until('the model name', async () => (await cloudTab.count('.aid .receipt code')) === 1);
  });
  await cloudTab.quality('receipt, cloud route');
  await cloudTab.shot('01-receipt-cloud');
  await cloudTab.close();

  // Prompt API present but this computer cannot run it: same honest cloud route.
  const weakDevice = await s.tab({ nano: 'unavailable' });
  await readyBellman(s, weakDevice);
  s.expect(weakDevice.cloud.count() === 2, 'an unavailable model falls back to the cloud');
  s.expect((await weakDevice.eval('window.__nano.prompts.length')) === 0, 'an unavailable model is never prompted');
  await weakDevice.close();

  // A ready local model, and the student has not been asked about the cloud.
  const nanoTab = await s.tab({ nano: 'ready' });
  await readyBellman(s, nanoTab);
  s.expect(!(await nanoTab.has(nanoTab.k.title)), 'no consent sheet when nothing needs the cloud');
  await nanoTab.tap(nanoTab.t('action.hint'));
  await nanoTab.until('the hint', async () => (await nanoTab.count('.aid')) === 1);
  await s.step('on-device receipts say nothing was sent', async () => {
    const receipts = await shownReceipts(nanoTab);
    if (receipts.length < 3) throw new Error(`only ${receipts.length} receipts`);
    for (const text of receipts) {
      if (!text.includes(nanoTab.t('receipt.device')) || !text.includes(nanoTab.t('receipt.nothingSent'))) throw new Error(text);
    }
  });
  s.expect(nanoTab.cloud.count() === 0, 'zero Gemini requests on the device route', `${nanoTab.cloud.count()}`);
  const nano = await nanoTab.eval('window.__nano');
  s.expect(nano.prompts.length === 3 && nano.images === 1, 'the fake Nano read the photo, organized and hinted', JSON.stringify(nano.prompts));
  await nanoTab.quality('receipt, device route');
  await nanoTab.shot('02-receipt-device');
  await nanoTab.close();

  // The designed hybrid: the photo is read and the note organized in the cloud, while everyday help stays on the device.
  const hybrid = await s.tab({ nano: 'ready', consent: 'granted' });
  await readyBellman(s, hybrid);
  await hybrid.tap(hybrid.t('action.hint'));
  await hybrid.until('the hint', async () => (await hybrid.count('.aid')) === 1);
  s.expect(
    hybrid.cloud.count() === 2 && hybrid.cloud.count('read') === 1 && hybrid.cloud.count('analyze') === 1 && hybrid.cloud.count('help') === 0,
    'with consent, the photo and its organizing go to the cloud, and the hint stays on the device',
    JSON.stringify(hybrid.cloud.calls.map((call) => call.task)),
  );
  await s.step('the receipts show both routes', async () => {
    const receipts = await shownReceipts(hybrid);
    if (!receipts.some((text) => text.includes(hybrid.t('receipt.cloud')))) throw new Error('no cloud receipt');
    if (!receipts.some((text) => text.includes(hybrid.t('receipt.device')))) throw new Error('no device receipt');
  });
  await hybrid.shot('03-receipt-hybrid');
  await hybrid.close();

  // Declining keeps everything local, and the note says what to do next.
  const declined = await s.tab();
  await addBellmanBoard(s, declined);
  await declined.waitText(declined.k.title);
  await declined.shot('04-consent');
  await declined.quality('consent sheet');
  await declined.tap(declined.k.decline);
  await s.step('declining the cloud parks the note with a clear next step', async () => {
    await declined.waitText(declined.t('wait.cloud_declined'));
    await declined.waitText(declined.t('wait.review'));
  });
  await settle();
  s.expect(declined.cloud.count() === 0, 'declining sends nothing');
  await declined.shot('05-declined');
  await declined.tap(declined.t('wait.review'));
  await declined.waitText(declined.k.agree);
  await declined.tap(declined.k.agree);
  await s.step('changing your mind finishes the note', () => declined.waitNoteStatus('ready'));
  await declined.close();

  // Dismissing the sheet is not a decision: the note waits and offers it again.
  const dismissed = await s.tab();
  await addBellmanBoard(s, dismissed);
  await dismissed.waitText(dismissed.k.title);
  await dismissed.press('Escape');
  await s.step('dismissing the sheet leaves the note waiting, with a way back', async () => {
    await dismissed.waitGone(dismissed.k.title);
    await dismissed.waitText(dismissed.t('wait.needs_consent'));
    await dismissed.waitText(dismissed.t('wait.review'));
  });
  await settle();
  s.expect(dismissed.cloud.count() === 0, 'dismissing the sheet sends nothing');
  await dismissed.eval(`window.dispatchEvent(new Event('online'))`);
  await settle();
  s.expect(!(await dismissed.has(dismissed.k.title)), 'the sheet does not come back on its own');
  await dismissed.close();

  // Asking for help before any board: the answer arrives right after agreeing.
  const firstHelp = await s.tab();
  await firstHelp.goto('/');
  await firstHelp.tap(firstHelp.t('home.tryDemo'));
  await firstHelp.waitText(firstHelp.t('sample.weighted.title'));
  await firstHelp.tap(firstHelp.t('sample.weighted.title'), { within: '.main' });
  await firstHelp.waitIn('.topbar h1', firstHelp.t('sample.weighted.title'));
  await firstHelp.tap(firstHelp.t('action.explain'));
  await firstHelp.waitText(firstHelp.k.title);
  await firstHelp.tap(firstHelp.k.agree);
  await s.step('after agreeing, the help the student asked for arrives by itself', async () => {
    await firstHelp.until('the answer', async () => (await firstHelp.count('.aid')) === 1);
    await firstHelp.waitGone(firstHelp.t('wait.needs_consent'));
  });
  s.expect(firstHelp.cloud.count('help') === 1, 'exactly one request after agreeing', `${firstHelp.cloud.count('help')}`);
}

/* ------------------------------------------------------------------ */
/* Journey C: private notes                                            */
/* ------------------------------------------------------------------ */

async function capturePrivate(s, tab) {
  await tab.goto('/capture');
  await tab.waitText(tab.t('capture.title'));
  await tab.tap(tab.t('capture.private'));
  await tab.until('the private switch', () => tab.eval(`document.querySelector('.toggle input').checked`));
  await tab.upload(BOARD);
  await tab.until('the note screen', async () => (await tab.path()).startsWith('/note/'));
}

async function journeyC(s) {
  const noModel = await s.tab();
  await capturePrivate(s, noModel);
  await s.step('a private note with no local model waits', async () => {
    await noModel.waitText(noModel.t('wait.private_needs_device'));
    await noModel.waitIn('.chip-private', noModel.t('detail.privateBadge'));
  });
  await noModel.shot('01-private-waiting');
  await noModel.quality('private note, waiting');
  s.expect(!(await noModel.has(noModel.k.title)), 'a private note never asks for cloud consent');
  await settle();
  s.expect(noModel.cloud.count() === 0, 'no Gemini request while waiting', `${noModel.cloud.count()}`);

  // Every way the queue can be woken up must keep it off the network.
  await noModel.eval(`window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'));`);
  await settle();
  s.expect(noModel.cloud.count() === 0, 'still no Gemini request after the queue wakes up', `${noModel.cloud.count()}`);
  await noModel.reload();
  await noModel.waitText(noModel.t('wait.private_needs_device'));
  await settle();
  s.expect(noModel.cloud.count() === 0, 'still no Gemini request after a reload', `${noModel.cloud.count()}`);

  // The student can lift the lock from the note itself, and the cloud still asks first.
  await noModel.tap(noModel.t('detail.makeShared'), { within: '.banner' });
  await s.step('allowing the cloud on a waiting private note asks for consent first', async () => {
    await noModel.waitText(noModel.k.title);
    if (noModel.cloud.count() !== 0) throw new Error(`${noModel.cloud.count()} requests before consent`);
  });
  await noModel.tap(noModel.k.agree);
  await s.step('then the note finishes in the cloud', () => noModel.waitNoteStatus('ready'));
  await noModel.close();

  // The same note on a device with a local model runs right here.
  const withModel = await s.tab({ nano: 'ready' });
  await capturePrivate(s, withModel);
  await s.step('a private note with a local model finishes on the device', () => withModel.waitNoteStatus('ready'));
  await withModel.waitIn('.topbar h1', withModel.c.analysis.title);
  await withModel.tap(withModel.t('action.hint'));
  await withModel.until('the hint', async () => (await withModel.count('.aid')) === 1);
  await s.step('its receipts say on this device, nothing sent', async () => {
    const receipts = await shownReceipts(withModel);
    if (receipts.length < 3) throw new Error(`only ${receipts.length} receipts`);
    if (!receipts.every((text) => text.includes(withModel.t('receipt.device')) && text.includes(withModel.t('receipt.nothingSent')))) {
      throw new Error(receipts.join(' / '));
    }
  });
  await withModel.tap(withModel.t('receipt.device'), { within: '.aid' });
  await s.step('the receipt names the private rule', () => withModel.waitText(withModel.t('reason.private_note')));
  s.expect(withModel.cloud.count() === 0, 'zero Gemini requests for a private note', `${withModel.cloud.count()}`);
  await withModel.shot('02-private-on-device');
  await withModel.close();

  // The local model crashes on a private note. The retry must stay local too.
  const crashing = await s.tab({ nano: 'ready' });
  await crashing.goto('/');
  await crashing.waitText(crashing.t('home.tryDemo'));
  await crashing.eval('window.__nano.failNext = 1');
  await capturePrivate(s, crashing);
  await s.step('a crash of the local model on a private note fails safely', async () => {
    await crashing.waitText(crashing.t('error.device_failed'));
    await crashing.waitNoteStatus('failed');
  });
  s.expect(crashing.cloud.count() === 0, 'the crash did not fall back to the cloud', `${crashing.cloud.count()}`);
  await crashing.tap(crashing.t('common.retry'));
  await s.step('the retry finishes the private note on the device', () => crashing.waitNoteStatus('ready'));
  s.expect(crashing.cloud.count() === 0, 'zero Gemini requests after the retry', `${crashing.cloud.count()}`);
  await crashing.close();

  // Marked private while the photo is already being read in the cloud.
  const midFlight = await s.tab({ consent: 'granted' });
  const reading = midFlight.cloud.hold('read');
  await addBellmanBoard(s, midFlight);
  await midFlight.until('the read request', () => reading.reached);
  await midFlight.tap(midFlight.t('common.more'));
  await midFlight.tap(midFlight.t('detail.makePrivate'));
  await midFlight.until('private flag', async () => (await midFlight.currentNote())?.isPrivate === true);
  reading.release();
  await s.step('marking a note private mid-read stops everything else going out', async () => {
    await midFlight.waitText(midFlight.t('wait.private_needs_device'));
    await settle(900);
    if (midFlight.cloud.count() !== 1) throw new Error(`${midFlight.cloud.count()} requests`);
  });
  const note = await midFlight.currentNote();
  s.expect(note.text === '', 'the answer that came back from the cloud is dropped', note.text.slice(0, 40));
  await midFlight.shot('03-private-mid-read');
}

/* ------------------------------------------------------------------ */
/* Journey D: offline                                                  */
/* ------------------------------------------------------------------ */

async function journeyD(s) {
  const tab = await s.tab({ consent: 'granted', allowErrors: [/ERR_INTERNET_DISCONNECTED/, /net::ERR_/] });
  const { t, c } = tab;
  await tab.goto('/');
  await tab.waitText(t('home.tryDemo'));
  await s.step('the service worker takes control', () =>
    tab.until('a controlling worker', () =>
      tab.eval(`navigator.serviceWorker.ready.then(() => new Promise((resolve) => {
        if (navigator.serviceWorker.controller) return resolve(true);
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 8000);
      }))`),
    ),
  );
  await tab.tap(t('home.tryDemo'));
  await tab.waitText(t('sample.weighted.title'));

  await tab.setOffline(true);
  await s.step('the browser reports being offline', async () => {
    await tab.until('navigator.onLine', async () => (await tab.eval('navigator.onLine')) === false);
    await tab.waitText(t('engine.offline'));
  });
  await tab.nav('nav.capture');
  await tab.waitText(t('capture.title'));
  await tab.upload(BOARD);
  await tab.until('the note screen', async () => (await tab.path()).startsWith('/note/'));
  await s.step('a photo imported offline waits with a clear message', () => tab.waitText(t('wait.offline_no_model')));
  await settle();
  s.expect(tab.cloud.count() === 0, 'no Gemini request while offline', `${tab.cloud.count()}`);
  await tab.quality('note, offline');
  await tab.shot('01-offline-note');
  const noteId = (await tab.path()).split('/')[2];

  await tab.nav('nav.library');
  await s.step('the library opens offline, with the waiting note', async () => {
    await tab.waitText(t('library.title'));
    await tab.waitText(t('library.unsorted'));
    await tab.waitText(t('detail.pending'));
    await tab.waitText(t('sample.weighted.title'));
  });
  await tab.quality('library, offline');
  await tab.shot('02-offline-library');

  tab.lastDocument = null;
  await tab.reload();
  await s.step('the app shell survives a reload through the service worker', async () => {
    await tab.waitText(t('library.title'));
    await tab.waitText(t('sample.weighted.title'));
    await tab.until('the document response', () => tab.lastDocument);
    if (!tab.lastDocument.fromServiceWorker) throw new Error('the document did not come from the service worker');
  });
  await tab.shot('03-offline-reload');
  s.expect(tab.cloud.count() === 0, 'still no Gemini request after the offline reload');

  await tab.setOffline(false);
  await s.step('when the network returns, the note finishes by itself', async () => {
    await tab.until('the note to finish', async () => {
      const rows = await tab.rows('captures');
      return rows.find((row) => row.id === noteId)?.status === 'ready';
    }, 20_000);
    await tab.waitText(c.analysis.title);
  });
  s.expect(tab.cloud.count('read') === 1 && tab.cloud.count('analyze') === 1, 'it took one read and one organize', `${tab.cloud.count()}`);
  await tab.shot('04-back-online');
}

/* ------------------------------------------------------------------ */
/* Journey E: races                                                    */
/* ------------------------------------------------------------------ */

async function journeyE(s) {
  // Editing the text while the model is organizing it.
  const editing = await s.tab({ consent: 'granted' });
  const { t, c } = editing;
  const organizing = editing.cloud.hold('analyze');
  await addBellmanBoard(s, editing);
  await editing.until('the analyze request', () => organizing.reached);
  await editing.tap(t('detail.editText'));
  await editing.fill('.card textarea', `\n${EDIT_MARK} corrected by the student`, { replace: false });
  await editing.tap(t('common.save'));
  await editing.until('the edit to be saved', async () => (await editing.currentNote())?.revision === 2);
  organizing.release();
  await s.step('editing during a request drops the stale answer', async () => {
    await editing.until('the fresh analysis', async () => {
      const titles = await editing.textsOf('.topbar h1');
      if (titles.some((title) => title.includes(c.analysis.title))) throw new Error('the stale title reached the screen');
      return titles.some((title) => title.includes(c.editedTitle));
    }, 15_000);
  });
  const edited = await editing.currentNote();
  s.expect(edited.analyzedRevision === 2 && edited.status === 'ready', 'the analysis belongs to the edited text');
  s.expect(editing.cloud.count('analyze') === 2, 'the edit triggered a new analysis', `${editing.cloud.count('analyze')}`);
  s.expect(editing.cloud.calls.at(-1).prompt.includes(EDIT_MARK), 'the new analysis read the edited text');
  await editing.shot('01-edited');
  await editing.close();

  // Deleting the note a hint links to.
  const linked = await s.tab();
  await readyBellman(s, linked);
  await linked.tap(linked.t('action.hint'));
  await linked.waitText(linked.t('link.title'));
  await linked.tap(linked.t('link.open'));
  await linked.waitIn('.topbar h1', linked.t('sample.weighted.title'));
  await linked.tap(linked.t('common.more'));
  await linked.tap(linked.t('detail.delete'));
  await s.step('deleting asks for confirmation', () => linked.until('the dialog', () => linked.dialogs.length === 1));
  await s.step('deleting a linked note removes the link', async () => {
    await linked.waitIn('.topbar h1', linked.c.analysis.title);
    await linked.waitGone(linked.t('link.title'));
    await linked.until('the hint to remain', async () => (await linked.count('.aid')) === 1);
  });
  const aids = await linked.rows('aids');
  s.expect(aids.every((aid) => aid.link === null), 'no stored hint points to the deleted note');
  await linked.shot('02-link-removed');
  await linked.close();

  // A double tap on the hint button.
  const tapper = await s.tab();
  await readyBellman(s, tapper);
  await tapper.doubleTap(tapper.t('action.hint'));
  await tapper.until('the hint', async () => (await tapper.count('.aid')) >= 1);
  await settle();
  s.expect(tapper.cloud.count('help') === 1, 'a double tap makes one request', `${tapper.cloud.count('help')} requests`);
  s.expect((await tapper.count('.aid')) === 1, 'a double tap shows one hint');
  s.expect((await tapper.rows('aids')).length === 1, 'a double tap stores one hint');
  await tapper.close();

  // A note opened from a link, then the browser's own back button, then our back arrow.
  const walker = await s.tab();
  await walker.goto('/');
  await walker.tap(walker.t('home.tryDemo'));
  await walker.waitText(walker.t('sample.weighted.title'));
  await walker.send('Page.navigate', { url: 'about:blank' });
  await walker.until('the blank page', async () => (await walker.eval('location.href')) === 'about:blank');
  await walker.goto(`/note/sample-weighted-${walker.lang}`);
  await walker.waitIn('.topbar h1', walker.t('sample.weighted.title'));
  await walker.nav('nav.library');
  await walker.waitText(walker.t('library.title'));
  await walker.eval('history.back()');
  await walker.waitIn('.topbar h1', walker.t('sample.weighted.title'));
  await walker.tap(walker.t('common.back'), { within: '.topbar' });
  await s.step('the back arrow stays inside the app after the browser back button', async () => {
    await walker.until('the home screen', async () => (await walker.eval(`location.origin + location.hash`)) === `${ORIGIN}#/`);
    await walker.waitText(walker.t('home.latest'));
  });
}

/* ------------------------------------------------------------------ */
/* Journey F: failures                                                 */
/* ------------------------------------------------------------------ */

const NETWORK_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function photoSurvives(s, tab, name) {
  const note = await tab.currentNote();
  s.expect(Boolean(note?.image?.startsWith?.('blob:')) && note.status !== 'processing', `${name}: the photo is safe`);
}

async function journeyF(s) {
  // 429 from every model: the note waits and retries by itself.
  const limited = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  limited.cloud.failure = 429;
  await addBellmanBoard(s, limited);
  await s.step('429 shows a clear message and keeps the note queued', async () => {
    await limited.waitText(limited.t('error.rate_limited'));
    await limited.waitText(limited.t('detail.pending'));
    await limited.waitNoteStatus('queued');
  });
  await limited.quality('429 failure');
  await limited.shot('01-rate-limited');
  await photoSurvives(s, limited, '429');
  const backups = limited.cloud.count();
  s.expect(backups >= 2, 'the backup models were tried', `${backups} requests`);
  limited.cloud.failure = null;
  await s.step('after a 429 the note retries by itself and finishes', () => limited.waitNoteStatus('ready', 20_000));
  await limited.close();

  // App Check refused: it will not fix itself, so the student gets a button.
  const refused = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  refused.cloud.failure = 403;
  await addBellmanBoard(s, refused);
  await s.step('App Check 403 shows a clear message', async () => {
    await refused.waitText(refused.t('error.app_check'));
    await refused.waitText(refused.t('detail.failed'));
    await refused.waitText(refused.t('detail.failedSafe'));
    await refused.waitNoteStatus('failed');
  });
  s.expect(refused.cloud.count() === 1, 'a 403 does not burn the backup models', `${refused.cloud.count()}`);
  await photoSurvives(s, refused, '403');
  await refused.quality('403 failure');
  await refused.shot('02-app-check');
  refused.cloud.failure = null;
  await refused.tap(refused.t('common.retry'));
  await s.step('after a 403 the retry button finishes the note', () => refused.waitNoteStatus('ready'));
  await refused.close();

  // The App Check exchange itself refused: the SDK sends a dummy token and the note fails safely.
  const noToken = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  noToken.appCheckExchangeFails = true;
  noToken.cloud.failure = 403;
  await addBellmanBoard(s, noToken);
  await s.step('a refused App Check exchange fails with the same clear message', async () => {
    await noToken.waitText(noToken.t('error.app_check'));
    await noToken.waitNoteStatus('failed');
  });
  s.expect(noToken.cloud.calls[0]?.appCheck === false, 'that request carried no valid App Check token');
  await noToken.close();

  // The model answered, but not with usable JSON.
  const malformed = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  malformed.cloud.failure = 'malformed';
  await addBellmanBoard(s, malformed);
  await s.step('malformed JSON shows a clear message', async () => {
    await malformed.waitText(malformed.t('error.invalid_output'));
    await malformed.waitNoteStatus('failed');
  });
  await photoSurvives(s, malformed, 'malformed');
  await malformed.quality('malformed answer');
  await malformed.shot('03-malformed');
  malformed.cloud.failure = null;
  await malformed.tap(malformed.t('common.retry'));
  await s.step('after malformed JSON the retry button finishes the note', () => malformed.waitNoteStatus('ready'));
  await malformed.close();

  // A response that is not even JSON.
  const garbage = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  garbage.cloud.failure = 'garbage';
  await addBellmanBoard(s, garbage);
  await s.step('a non-JSON response fails without losing the note', async () => {
    await garbage.waitText(garbage.t('detail.failed'));
    await garbage.waitNoteStatus('failed');
  });
  garbage.cloud.failure = null;
  await garbage.tap(garbage.t('common.retry'));
  await s.step('after a non-JSON response the retry button works', () => garbage.waitNoteStatus('ready'));
  await garbage.close();

  // The connection drops during the request.
  const dropped = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  dropped.cloud.failure = 'disconnect';
  await addBellmanBoard(s, dropped);
  await s.step('a dropped connection is reported as temporary', async () => {
    await dropped.waitText(dropped.t('error.network'));
    await dropped.waitNoteStatus('queued');
  });
  await dropped.shot('04-disconnected');
  dropped.cloud.failure = null;
  await s.step('after a dropped connection the note retries by itself', () => dropped.waitNoteStatus('ready', 25_000));
  await dropped.close();

  // The model files the exercise as a plain board. One tap brings back the hint ladder.
  const board = await s.tab({ consent: 'granted' });
  board.cloud.kind = 'board';
  await readyBellman(s, board);
  await s.step('a note the model filed as a board offers its key ideas', async () => {
    await board.waitIn('.chip-kind', board.t('kind.board'));
    await board.waitText(board.t('action.key_ideas'));
  });
  await board.tap(board.t('detail.asExercise'));
  await s.step('one tap turns it into an exercise with the hint ladder', async () => {
    await board.waitIn('.chip-kind', board.t('kind.exercise'));
    await board.waitText(board.t('ladder.intro'));
  });
  await board.tap(board.t('action.hint'));
  await board.until('the first hint', async () => (await board.count('.aid')) === 1);
  await board.waitIn('.aid h3', board.t('ladder.1'));
  s.expect((await board.currentNote()).locked.kind === true, 'the student choice is kept if the note is analyzed again');
  await board.close();

  // A failure while asking for a hint keeps the note and lets the student ask again.
  const hint = await s.tab({ consent: 'granted', allowErrors: NETWORK_ERRORS });
  await readyBellman(s, hint);
  hint.cloud.failure = 429;
  await hint.tap(hint.t('action.hint'));
  await s.step('a failed hint explains itself', () => hint.waitIn('.form-error', hint.t('error.rate_limited')));
  s.expect((await hint.count('.aid')) === 0, 'a failed hint adds nothing');
  await hint.quality('failed hint');
  await hint.shot('05-hint-failed');
  hint.cloud.failure = null;
  await hint.tap(hint.t('action.hint'));
  await s.step('asking again works', async () => {
    await hint.until('the hint', async () => (await hint.count('.aid')) === 1);
    await hint.waitGone(hint.t('error.rate_limited'));
  });
}

/* ------------------------------------------------------------------ */
/* Journey G: camera and search                                        */
/* ------------------------------------------------------------------ */

async function journeyG(s) {
  const denied = await s.tab({ camera: 'denied' });
  const { t } = denied;
  await denied.goto('/');
  await denied.tap(t('home.tryDemo'));
  await denied.waitText(t('sample.weighted.title'));
  await denied.nav('nav.capture');
  await s.step('a denied camera says so and offers the gallery', async () => {
    await denied.waitText(t('capture.denied'));
    await denied.until('the gallery button', async () => (await denied.count('.btn-wide')) === 1);
    await denied.waitText(t('capture.gallery'));
  });
  await denied.quality('capture, camera denied');
  await denied.shot('01-camera-denied');
  const junk = join(ASSETS, 'not-an-image.jpg');
  writeFileSync(junk, 'this file is not an image');
  await denied.upload(junk);
  await s.step('a file that is not an image gets a clear message', () => denied.waitText(t('capture.failed')));
  s.expect((await denied.path()) === '/capture' && (await denied.rows('captures')).length === 2, 'a broken file creates no note');
  await denied.upload(BOARD);
  await s.step('gallery import still works', async () => {
    await denied.until('the note screen', async () => (await denied.path()).startsWith('/note/'));
    await denied.waitText(denied.k.title);
  });
  await denied.tap(denied.k.agree);
  await s.step('the imported photo goes through the pipeline', () => denied.waitNoteStatus('ready'));

  await denied.nav('nav.library');
  await denied.waitText(t('library.title'));
  const search = (query) => denied.fill('.search input', query);

  const subject = t('sample.weighted.subject');
  const accented = denied.lang === 'es' ? 'estadÍstica' : 'stätistics';
  const plain = denied.lang === 'es' ? 'estadistica' : 'statistics';
  await search(accented);
  await s.step('search ignores accents and case', async () => {
    await denied.waitIn('.group-title', subject);
    await denied.until('one result', async () => (await denied.count('.note-row')) === 1);
    await denied.waitText(t('sample.weighted.title'));
  });
  await denied.shot('02-search-accents');
  await search(plain);
  await denied.until('the same result', async () => (await denied.count('.note-row')) === 1);

  await search('zzzzz');
  await s.step('no results says so and offers to clear', async () => {
    await denied.waitText(t('library.noResults', { q: 'zzzzz' }));
    await denied.waitText(t('library.clear'));
  });
  await denied.quality('library, no results');
  await denied.shot('03-no-results');
  await denied.tap(t('library.clear'));
  await s.step('clearing the search brings the notes back', async () => {
    await denied.until('every note', async () => (await denied.count('.note-row')) === 3);
  });
  await denied.close();

  // A live camera (Chrome's fake video device) through the shutter button.
  const live = await s.tab({ camera: 'granted', consent: 'granted' });
  await live.goto('/capture');
  await s.step('a granted camera shows the live viewfinder', () =>
    live.until('the video', () => live.eval(`(() => { const v = document.querySelector('video'); return Boolean(v && v.videoWidth > 0 && !v.classList.contains('hidden')); })()`)),
  );
  await live.quality('capture, live camera');
  await live.shot('04-camera-live');
  await live.tap(live.t('capture.shutter'));
  await s.step('the shutter saves the photo right away and the note is processed', async () => {
    await live.until('the note screen', async () => (await live.path()).startsWith('/note/'));
    await live.waitNoteStatus('ready');
  });
  s.expect(live.cloud.calls[0]?.hasImage === true, 'the shot photo reached the read step');
}

/* ------------------------------------------------------------------ */
/* Journey H: quality sweep                                            */
/* ------------------------------------------------------------------ */

async function journeyH(s) {
  const tab = await s.tab({ camera: 'granted' });
  const { t } = tab;
  const visit = async (name) => {
    await settle(250);
    await tab.quality(name);
    await tab.shot(name.replace(/[^a-z0-9]+/gi, '-'));
  };

  await tab.goto('/');
  await tab.waitText(t('home.tryDemo'));
  await visit('home-empty');

  await tab.nav('nav.library');
  await tab.waitText(t('library.empty'));
  await visit('library-empty');

  await tab.nav('nav.capture');
  await tab.waitText(t('capture.context'));
  await visit('capture');

  await tab.nav('nav.ai');
  await tab.waitText(t('ai.deviceTitle'));
  await visit('your-ai-empty');

  await tab.goto('/note/does-not-exist');
  await tab.waitText(t('detail.notFound'));
  await visit('note-not-found');

  await tab.goto('/practice/does-not-exist');
  await tab.waitText(t('practice.missing'));
  await visit('practice-missing');

  await readyBellman(s, tab);
  await visit('note-ready');
  await climbLadder(tab);
  await visit('note-with-ladder');
  await tab.shot('note-with-ladder-full', { full: true });

  await tab.tap(t('common.more'));
  await tab.waitText(t('detail.delete'));
  await visit('note-menu');
  await tab.tap(t('detail.labels'));
  await tab.waitText(t('detail.kindField'));
  await visit('labels-sheet');
  await tab.tap(t('common.cancel'));
  await tab.waitGone(t('detail.kindField'));

  await tab.tap(t('detail.photoAlt', { title: tab.c.analysis.title }));
  await tab.until('the photo viewer', async () => (await tab.count('.viewer-img')) === 1);
  await visit('photo-viewer');
  await tab.tap(t('common.back'), { within: '.sheet-body' });
  await tab.until('the viewer to close', async () => (await tab.count('.viewer-img')) === 0);

  await tab.tap(t('practice.button'), { within: '.main' });
  await tab.until('the question', async () => (await tab.count('.question')) === 1);
  await visit('practice-question');
  await tab.tap(t('practice.reveal'));
  await tab.waitText(t('practice.remembered'));
  await visit('practice-answer');
  await tab.tap(t('practice.remembered'));
  await tab.waitText(t('practice.done'));
  await visit('practice-done');

  await tab.tap(t('practice.home'));
  await tab.waitText(t('home.latest'));
  await visit('home-with-notes');
  await tab.nav('nav.library');
  await tab.waitText(t('sample.ohm.title'));
  await visit('library');

  await tab.tap(tab.c.analysis.title, { within: '.main' });
  await tab.waitIn('.topbar h1', tab.c.analysis.title);
  await tab.tap(t('common.more'));
  await tab.tap(t('detail.labels'));
  await tab.waitText(t('detail.kindField'));
  await tab.fill('.sheet input', 'Bellman, my title');
  await tab.tap(t('common.save'));
  await s.step('editing labels updates the note', async () => {
    await tab.waitIn('.topbar h1', 'Bellman, my title');
    await tab.waitGone(t('detail.kindField'));
  });
  await tab.nav('nav.ai');
  await tab.waitText(t('ai.statsTitle'));
  await tab.waitText(t('ai.statCloud'));
  await visit('your-ai');
  await tab.shot('your-ai-full', { full: true });

  // The standing decision about the cloud can be changed here, and the badge follows it.
  await tab.tap(t('ai.cloudOff'));
  await s.step('turning cloud AI off shows on this screen and on the badge', async () => {
    await tab.waitText(t('ai.cloud.declined'));
    await tab.nav('nav.home');
    await tab.waitText(t('engine.cloudOff'));
  });
  await tab.nav('nav.ai');
  await tab.tap(t('ai.cloudReview'));
  await tab.waitText(tab.k.title);
  await tab.tap(tab.k.agree);
  await s.step('turning it back on goes through the same notice', () => tab.waitText(t('ai.cloud.granted')));

  await s.step('the app is installable: manifest and icons load', async () => {
    const manifest = await tab.eval(`fetch(document.querySelector('link[rel="manifest"]').href).then((r) => r.json())`);
    if (!manifest.icons?.some((icon) => icon.purpose === 'maskable')) throw new Error('no maskable icon');
    for (const icon of manifest.icons) {
      const ok = await tab.eval(`fetch(${JSON.stringify(icon.src)}).then((r) => r.ok && r.headers.get('content-type').startsWith('image/'))`);
      if (!ok) throw new Error(`icon ${icon.src} did not load`);
    }
  });

  // Switching language on the page itself must change the whole interface.
  const other = tab.lang === 'en' ? 'es' : 'en';
  await tab.tap(other === 'es' ? 'Español' : 'English');
  await tab.waitText(translate(other, 'ai.title'));
  await s.step('the language switch changes the interface', async () => {
    await tab.until('html lang', async () => (await tab.eval('document.documentElement.lang')) === other);
    const wrong = untranslated(await tab.eval('__e2e.strings()'), other);
    if (wrong.length) throw new Error(wrong.join(' | '));
    if (!(await tab.eval('document.title')).includes(translate(other, 'app.title'))) throw new Error('the page title did not change');
  });

  await tab.tap(translate(other, 'ai.clear'));
  await s.step('erasing everything asks first and empties the app', async () => {
    await tab.until('the confirmation', () => tab.dialogs.length > 0);
    await tab.waitText(translate(other, 'home.tryDemo'));
    for (const store of ['captures', 'aids', 'cards', 'usage']) {
      if ((await tab.rows(store)).length !== 0) throw new Error(`${store} is not empty`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const JOURNEYS = {
  A: { title: 'First run: read, organize, hint ladder, linked note, practice, schedule', run: journeyA },
  B: { title: 'Receipts: cloud, on-device, hybrid and declined routes', run: journeyB },
  C: { title: 'Private notes stay on the device', run: journeyC },
  D: { title: 'Offline capture, service worker reload, automatic resume', run: journeyD },
  E: { title: 'Races: edit in flight, deleted link, double tap', run: journeyE },
  F: { title: 'Failures: 429, App Check 403, malformed output, dropped connection', run: journeyF },
  G: { title: 'Camera permission, gallery import and search', run: journeyG },
  H: { title: 'Quality sweep on every screen', run: journeyH },
};

/** A believable photo of a board, drawn once with a canvas. */
async function makeBoardImage(browser) {
  mkdirSync(ASSETS, { recursive: true });
  const path = join(ASSETS, 'board.jpg');
  const scenario = new Scenario(browser, 'setup', 'desktop', 'en');
  const tab = await scenario.tab();
  const dataUrl = await tab.eval(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2c3a33';
    ctx.fillRect(0, 0, 1400, 1000);
    ctx.fillStyle = '#efeee6';
    ctx.font = 'italic 64px Georgia, serif';
    ctx.fillText('Bellman equation', 90, 130);
    ctx.font = '54px Georgia, serif';
    ctx.fillText("V(s) = \\u03a3 P(s'|s) [ r(s,s') + \\u03b3 V(s') ]", 90, 300);
    ctx.font = '42px Georgia, serif';
    ctx.fillText("P(s'|s): transition probability", 130, 450);
    ctx.fillText('r: reward     \\u03b3: discount factor', 130, 540);
    ctx.fillStyle = '#f2c14e';
    ctx.fillText("Exercise: compute V(s) if P = 0.7, r = 2, \\u03b3 = 0.9, V(s') = 10", 90, 720);
    return canvas.toDataURL('image/jpeg', 0.9);
  })()`);
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await tab.close();
  return path;
}

let BOARD;

function summarize() {
  const byJourney = new Map();
  for (const result of results) {
    const key = `${result.journey} ${result.viewport}/${result.lang}`;
    const entry = byJourney.get(key) ?? { passed: 0, failed: 0 };
    if (result.ok) entry.passed += 1;
    else entry.failed += 1;
    byJourney.set(key, entry);
  }
  console.log('');
  for (const [key, { passed, failed }] of byJourney) {
    console.log(`${failed ? 'FAIL' : 'PASS'}  ${key.padEnd(20)} ${passed} checks passed${failed ? `, ${failed} failed` : ''}`);
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${SHOTS}`);
  writeFileSync(REPORT, JSON.stringify({ date: new Date().toISOString(), results }, null, 1));
  return failed.length;
}

async function main() {
  if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, FAKE_ENV);
  mkdirSync(TEMP_DIR, { recursive: true });
  if (!ONLY) rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  if (!SKIP_BUILD) {
    console.log('Building with --mode e2e (fake Firebase values) ...');
    await runToEnd([VITE, 'build', '--mode', 'e2e', '--outDir', DIST, '--emptyOutDir'], 'The e2e build');
  }

  const preview = await startPreview();
  let browser;
  try {
    browser = await Browser.start();
    BOARD = await makeBoardImage(browser);
    const keys = Object.keys(JOURNEYS).filter((key) => !ONLY || ONLY.includes(key));
    for (const viewportName of VIEWPORT_NAMES) {
      for (const lang of LANGS) {
        for (const key of keys) {
          const scenario = new Scenario(browser, key, viewportName, lang);
          const started = Date.now();
          console.log(`  ${scenario.id}: ${JOURNEYS[key].title}`);
          const watchdog = new AbortController();
          try {
            await Promise.race([
              JOURNEYS[key].run(scenario),
              sleep(JOURNEY_TIMEOUT_MS, null, { signal: watchdog.signal }).then(() => {
                throw new Error(`the journey took longer than ${JOURNEY_TIMEOUT_MS / 1000} s`);
              }),
            ]);
          } catch (error) {
            scenario.fail(error);
            for (const tab of scenario.tabs) if (!tab.closed) await tab.shot('FAILED').catch(() => {});
          } finally {
            watchdog.abort();
          }
          for (const tab of scenario.tabs) {
            const errors = tab.unexpectedErrors();
            scenario.soft(errors.length === 0, 'no console errors', errors.slice(0, 4).join('\n          '));
            scenario.soft(tab.blocked.length === 0, 'no unexpected network requests', tab.blocked.join(', '));
            await tab.close();
          }
          console.log(`    done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        }
      }
    }
  } finally {
    if (browser) await browser.stop();
    preview.kill();
  }
  process.exitCode = summarize() === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
