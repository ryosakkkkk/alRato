/**
 * Renders the alRato PWA icons and the Devpost thumbnail with the installed
 * Chrome, driven over the DevTools protocol. It needs no image libraries.
 *
 *   node scripts/make-assets.mjs              render every asset
 *   node scripts/make-assets.mjs --previews   also write inspection sheets to .local/asset-previews
 *
 * Chrome runs headless with a throwaway profile under .local, on a port it
 * picks itself and with DNS switched off, so it cannot reach the network and
 * never touches a browser that is already open. Set CHROME_PATH to use another
 * binary.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, '.local');
const PROFILE = join(LOCAL, 'assets-chrome-profile');
const TEMP_DIR = join(LOCAL, 'tmp');
const PREVIEWS = join(LOCAL, 'asset-previews');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const GREEN = '#2f4f3a';
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** W3C maskable icons: everything important stays inside a centered circle of this radius. */
const SAFE_ZONE_RATIO = 0.4;

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const LEAF = read('public/favicon.svg').match(/<path d="([^"]+)"/)[1];

// The phone mock-up reuses the app's real icons and interface strings.
const iconSource = read('src/ui/Icon.tsx');
const stringSource = read('src/i18n/en.ts');

function icon(name, size = 22) {
  const d = iconSource.match(new RegExp(`\\b${name}: '([^']+)'`))[1];
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

function t(key) {
  return stringSource.match(new RegExp(`'${key.replaceAll('.', '\\.')}': '([^']+)'`))[1];
}

function fontFace(family, file, weight, style = 'normal') {
  const data = readFileSync(join(ROOT, 'node_modules', file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
}

/* ------------------------------------------------------------------ */
/* Chrome over the DevTools protocol                                   */
/* ------------------------------------------------------------------ */

async function launchChrome() {
  mkdirSync(TEMP_DIR, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(PROFILE, { recursive: true });

  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${PROFILE}`,
      '--remote-debugging-port=0',
      '--enable-logging=stderr',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-default-apps',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--no-pings',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
      '--font-render-hinting=none',
      '--hide-scrollbars',
      'about:blank',
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
      // Leave USERPROFILE alone: when it is redirected, Chrome refuses remote debugging.
      env: { ...process.env, TEMP: TEMP_DIR, TMP: TEMP_DIR },
    },
  );

  // With port 0, Chrome announces the port it picked on stderr.
  const url = await new Promise((found, fail) => {
    const timer = setTimeout(() => fail(new Error('Chrome did not open a debugging port')), 30_000);
    let log = '';
    child.stderr.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        found(match[1]);
      }
    });
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Chrome exited early with code ${code}`)));
  }).catch((error) => {
    child.kill(); // Only ever the process this script spawned.
    throw error;
  });
  return { child, url };
}

function connect(url) {
  return new Promise((ready, fail) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.onerror = () => fail(new Error('DevTools connection failed'));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
      else call.resolve(message.result);
    };
    socket.onopen = () =>
      ready({
        send(method, params = {}, sessionId) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          return new Promise((resolve, reject) => pending.set(id, { method, resolve, reject }));
        },
        close: () => socket.close(),
      });
  });
}

async function closeChrome(cdp, child) {
  const gone = new Promise((done) => child.once('exit', done));
  try {
    await Promise.race([cdp.send('Browser.close'), sleep(3000)]);
  } catch {
    // The socket can drop as the browser exits.
  }
  const closed = await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]);
  if (!closed) child.kill(); // Only ever the process this script spawned.
  cdp.close();
  await sleep(200);
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

async function evaluate(send, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

/** Names of any system fonts the page fell back to, meaning a glyph is missing from our web fonts. */
async function fallbackFonts(send) {
  await send('DOM.enable');
  await send('CSS.enable');
  const { root } = await send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body, body *' });
  const fallbacks = new Set();
  for (const nodeId of nodeIds) {
    const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId });
    for (const font of fonts) if (!font.isCustomFont) fallbacks.add(font.familyName);
  }
  return [...fallbacks];
}

async function render(cdp, { html, width, height, transparent = false }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (transparent) {
      await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    }
    const { frameTree } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    const report = await evaluate(
      send,
      `(async () => {
        document.body.getBoundingClientRect();
        await Promise.all([...document.fonts].map((face) => face.load()));
        await document.fonts.ready;
        const report = window.layout ? await window.layout() : {};
        await new Promise((done) => setTimeout(done, 60));
        return report;
      })()`,
    );
    const fallbacks = await fallbackFonts(send);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width, height, scale: 1 },
      captureBeyondViewport: false,
    });
    return { png: Buffer.from(data, 'base64'), report: report ?? {}, fallbacks };
  } finally {
    await cdp.send('Target.closeTarget', { targetId });
  }
}

/* ------------------------------------------------------------------ */
/* PWA icons                                                           */
/* ------------------------------------------------------------------ */

const page = (body, css = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent}svg{display:block}${css}</style></head><body>${body}</body></html>`;

const logoIcon = (size) =>
  page(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${read('public/favicon.svg').replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')}</svg>`);

/**
 * A full-bleed icon. The leaf is centered on its own bounding circle and sized
 * so its farthest point sits at `radius` (a fraction of the icon width).
 */
function fullBleedIcon(size, radius) {
  return page(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="${GREEN}"/>
      <path id="leaf" d="${LEAF}" fill="#f6eedf"/>
    </svg>
    <script>
      window.layout = () => {
        const leaf = document.getElementById('leaf');
        const length = leaf.getTotalLength();
        const points = Array.from({ length: 1600 }, (_, i) => leaf.getPointAtLength((i / 1600) * length));
        // Smallest enclosing circle, found by walking the center toward the farthest point.
        let cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        let cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        for (let step = 0; step < 4000; step++) {
          const far = points.reduce((a, b) => (Math.hypot(b.x - cx, b.y - cy) > Math.hypot(a.x - cx, a.y - cy) ? b : a));
          const rate = 1 / (step + 2);
          cx += (far.x - cx) * rate;
          cy += (far.y - cy) * rate;
        }
        const reach = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.y - cy)));
        const scale = (${radius} * ${size}) / reach;
        leaf.setAttribute('transform', 'translate(' + ${size / 2} + ' ' + ${size / 2} + ') scale(' + scale + ') translate(' + -cx + ' ' + -cy + ')');
      };
    </script>`,
  );
}

/* ------------------------------------------------------------------ */
/* Devpost thumbnail                                                   */
/* ------------------------------------------------------------------ */

const SIGMA = `<svg class="glyph sigma" viewBox="0 0 30 40" aria-hidden="true"><path d="M26 6C19 3.5 10 3.5 4 5.5L17 20 4 35.5c7-2 15-2 23 .5"/></svg>`;
const GAMMA = `<svg class="glyph gamma" viewBox="0 0 24 36" aria-hidden="true"><path d="M2.5 11C4.5 7 7.5 7 9 11c2 5.5 3 11 2 17-.6 3.5-3.6 4.5-4.2 1.6C6.2 25 11 15 21 7"/></svg>`;
const RING = `<svg class="ring" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M34 12C74 2 160 3 186 30c15 30-12 60-80 63C50 97 8 79 8 47 8 24 42 9 100 7"/></svg>`;

const sprig = (style) => `<svg class="sprig" style="${style}" viewBox="0 0 160 120" aria-hidden="true">
  <path d="M158 6C118 14 86 34 60 70" fill="none" stroke="#6f7f55" stroke-width="2"/>
  <path d="M128 20c-4-13-16-18-30-16 2 13 14 21 30 16Z" fill="#7d9163"/>
  <path d="M106 34c8-12 22-13 34-8-6 12-20 16-34 8Z" fill="#94a677"/>
  <path d="M92 44c-6-12-18-15-31-11 4 13 17 19 31 11Z" fill="#6f8558"/>
  <path d="M76 58c9-10 22-9 33-2-8 11-22 13-33 2Z" fill="#8a9d6d"/>
  <path d="M62 68c-8-10-20-11-31-5 6 11 20 14 31 5Z" fill="#7d9163"/>
</svg>`;

/** The student's older note. Used full size on the desk and as the thumbnail inside the app. */
const noteFace = (hot = false) => `
  <div class="tape"></div>
  <div class="holes"><i></i><i></i><i></i></div>
  <div class="note-title">${t('sample.weighted.title')}</div>
  <div class="formula">
    <span class="xbar">x</span><span>=</span>
    <span class="frac">
      <span class="frac-top">${SIGMA}<span class="term"${hot ? ' id="hot-w"' : ''}>w<sub>i</sub>${hot ? RING : ''}</span><span>x<sub>i</sub></span></span>
      <span class="frac-bar"></span>
      <span class="frac-bottom">${SIGMA}<span>w<sub>i</sub></span></span>
    </span>
  </div>
  <div class="note-foot">w<sub>i</sub> : ${t('sample.weighted.wi')}</div>`;

function thumbnailHtml() {
  const fonts = [
    fontFace('Fraunces', '@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2', '100 900'),
    fontFace('Fraunces', '@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2', '100 900', 'italic'),
    fontFace('Inter', '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', '100 900'),
    fontFace('Caveat', '@fontsource/caveat/files/caveat-latin-700-normal.woff2', '700'),
  ].join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>alRato</title><style>${fonts}
:root{--paper:#f6eedf;--raised:#fdf9f0;--line:#e2d6c0;--sand:#efe4d0;--sage:#e2e6d2;--ink:#38291d;--ink-soft:#6b5947;--green:#2f4f3a;--green-tint:#dbe5d4;--terra:#a84c27;--terra-tint:#f6dcc9;--serif:'Fraunces',Georgia,serif;--sans:'Inter',system-ui,sans-serif;--hand:'Caveat',cursive}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1500px;height:1000px;overflow:hidden}
body{position:relative;color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;
  background:radial-gradient(900px 720px at 76% 42%,#fdf8ec 0%,rgb(253 248 236 / 0) 72%),radial-gradient(1100px 800px at 4% 104%,rgb(226 214 192 / .6),rgb(226 214 192 / 0) 62%),#f6eedf}
.sprig{position:absolute;filter:drop-shadow(5px 9px 7px rgb(56 41 29 / .16))}

/* Headline */
.copy{position:absolute;left:84px;top:126px;width:800px}
.brand{display:flex;align-items:center;gap:24px}
.tile{width:112px;height:112px;flex:none;display:block;filter:drop-shadow(0 6px 12px rgb(47 79 58 / .28))}
.wordmark{font:700 132px/1 var(--serif);font-variation-settings:'opsz' 72,'SOFT' 0,'WONK' 0;letter-spacing:-.015em;color:var(--green)}
.wordmark span{color:var(--ink)}
.tagline{margin-top:58px;font:600 96px/1.07 var(--serif);font-variation-settings:'opsz' 144,'SOFT' 40,'WONK' 0;letter-spacing:-.018em;color:var(--ink)}
.tagline em{position:relative;display:inline-block;font-style:italic;color:var(--terra)}
.tagline em svg{position:absolute;left:-1%;bottom:-.17em;width:102%;height:.26em;overflow:visible}
.gloss{margin-top:48px;font:700 38px/1.12 var(--hand);color:var(--ink-soft)}

/* Phone */
.phone{position:absolute;left:992px;top:42px;width:436px;height:916px;transform:rotate(3deg);border-radius:62px;padding:13px;
  background:linear-gradient(140deg,#54422f 0%,#2a1f16 34%,#1e1610 100%);
  box-shadow:inset 0 0 0 1.5px #705a45,inset 0 2px 3px rgb(255 255 255 / .22),0 44px 74px rgb(56 41 29 / .4),0 14px 28px rgb(56 41 29 / .3)}
.phone::before,.phone::after{content:'';position:absolute;right:-5px;width:5px;border-radius:0 3px 3px 0;background:#3a2c20}
.phone::before{top:176px;height:76px}
.phone::after{top:276px;height:120px}
.screen{position:relative;width:100%;height:100%;border-radius:50px;overflow:hidden;background:var(--paper);display:flex;flex-direction:column}
.status{flex:none;display:flex;align-items:center;justify-content:space-between;height:44px;padding:8px 30px 0;font-size:14px;font-weight:650;color:var(--ink)}
.punch{position:absolute;top:13px;left:50%;width:21px;height:21px;margin-left:-10.5px;border-radius:50%;background:#1a130d;box-shadow:inset 0 0 0 2px #2e241a}
.sys{display:flex;align-items:center;gap:6px}
.sys i{display:block;background:var(--ink)}
.bars{width:17px;height:12px;clip-path:polygon(0 100%,100% 0,100% 100%)}
.batt{width:24px;height:12px;border-radius:3.5px}
.body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;gap:10px;padding:2px 15px 14px}
.topbar{flex:none;display:flex;align-items:center;gap:6px;height:44px;color:var(--ink)}
.topbar h1{flex:1;min-width:0;font:600 24px/1.1 var(--serif);white-space:nowrap}

/* The photographed board */
.board{position:relative;flex:none;height:304px;border-radius:18px;overflow:hidden;color:#f8f2e4;box-shadow:0 2px 6px rgb(56 41 29 / .35);
  background:radial-gradient(150px 74px at 24% 22%,rgb(255 255 255 / .1),rgb(255 255 255 / 0)),radial-gradient(190px 80px at 74% 74%,rgb(255 255 255 / .08),rgb(255 255 255 / 0)),radial-gradient(120px 60px at 86% 16%,rgb(255 255 255 / .06),rgb(255 255 255 / 0)),linear-gradient(165deg,#38604a,#294535 62%,#233b2d)}
.ledge{position:absolute;inset:auto 0 0 0;height:15px;background:linear-gradient(#a98661,#7f6143);box-shadow:0 -2px 3px rgb(0 0 0 / .3)}
.stick{position:absolute;bottom:13px;height:7px;border-radius:2px}
.chalk{position:absolute;left:18px;right:12px;top:76px;font:700 60px/1 var(--hand);-webkit-text-stroke:.5px currentColor;filter:url(#chalk)}
.chalk .row{display:flex;align-items:center;gap:9px;white-space:nowrap}
.chalk .row + .row{margin-top:18px;justify-content:flex-end;padding-right:4px}
.chalk .term{margin-left:9px}
.glyph{flex:none;fill:none;stroke:currentColor;stroke-width:3.1;stroke-linecap:round;stroke-linejoin:round}
.sigma{width:.6em;height:.8em}
.gamma{width:.52em;height:.78em;margin-top:.16em}
.term{position:relative;display:inline-block}
.ring{position:absolute;left:-10%;top:-15%;width:127%;height:130%;overflow:visible;fill:none;stroke:#f3a678;stroke-width:3.4;stroke-linecap:round}

.chips{flex:none;display:flex;gap:7px}
.chip{display:inline-flex;align-items:center;padding:3px 12px;border-radius:999px;background:var(--sand);font-size:13.5px;font-weight:600;color:var(--ink-soft)}
.chip-kind{background:var(--terra-tint);color:var(--terra)}
.aid{flex:none;display:flex;flex-direction:column;gap:7px;padding:12px 13px 13px;background:var(--sage);border-radius:16px}
.aid h2{display:flex;align-items:center;gap:7px;font:600 21px/1.2 var(--serif);color:var(--green)}
.aid > p{font-size:16.5px;line-height:1.36}
.link-card{display:flex;flex-direction:column;gap:7px;padding:10px 11px 11px;background:var(--raised);border:1px solid #cdd5bd;border-radius:14px}
.link-card h3{display:flex;align-items:center;gap:7px;font:600 19.5px/1.2 var(--serif);color:var(--green)}
.link-note{display:flex;align-items:center;gap:11px}
.thumb{position:relative;flex:none;width:102px;height:72px;border-radius:9px;overflow:hidden;background:var(--sand);box-shadow:0 0 0 1px var(--line)}
.thumb .note{position:absolute;left:0;top:0;transform:scale(.227);transform-origin:0 0;box-shadow:none}
.thumb .note-mini{background:#fdf9ef}
.note-mini .tape,.note-mini .holes{display:none}
.note-mini::after{content:'';position:absolute;left:48px;top:0;bottom:0;width:5px;background:#e3a79a}
.link-note strong{display:block;font:600 19px/1.2 var(--serif)}
.text-link{display:inline-flex;align-items:center;gap:4px;margin-top:3px;font-size:14.5px;font-weight:700;color:var(--green);text-decoration:underline;text-underline-offset:3px}
.why{font-size:15.5px;line-height:1.3;color:var(--ink)}
.ghost{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;height:48px;border:1.5px solid #cdbd9f;border-radius:13px;background:var(--raised);font:600 18px/1 var(--serif)}
.tabbar{flex:none;display:grid;grid-template-columns:repeat(3,1fr);height:62px;padding-bottom:6px;background:rgb(253 249 240 / .96);border-top:1px solid var(--line)}
.tabbar span{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:11.5px;font-weight:500;color:var(--ink-soft)}

/* The older note on the desk */
.note{position:absolute;width:450px;height:318px;overflow:hidden;border-radius:4px;color:#23303f;font-family:var(--hand);font-weight:700;
  background:linear-gradient(90deg,transparent 57px,#e3a79a 57px,#e3a79a 59px,transparent 59px),repeating-linear-gradient(transparent 0 42px,#dcd5c3 42px 44px),#fdf9ef;
  box-shadow:0 1px 2px rgb(56 41 29 / .25),0 16px 30px rgb(56 41 29 / .24)}
.desk-note{left:556px;top:642px;transform:rotate(-5deg);overflow:visible}
.tape{position:absolute;top:-21px;left:130px;width:118px;height:30px;background:rgb(168 76 39 / .62);transform:rotate(-2deg);box-shadow:0 1px 2px rgb(56 41 29 / .2)}
.holes{position:absolute;left:18px;top:40px;bottom:30px;display:flex;flex-direction:column;justify-content:space-between}
.holes i{display:block;width:17px;height:17px;border-radius:50%;background:#e9dec9;box-shadow:inset 0 2px 3px rgb(56 41 29 / .4)}
.note-title{position:absolute;left:74px;top:11px;font-size:46px;line-height:1;color:#1f4e8c;white-space:nowrap}
.formula{position:absolute;left:82px;top:92px;display:flex;align-items:center;gap:14px;font-size:58px;line-height:1}
.xbar{position:relative}
.xbar::before{content:'';position:absolute;left:.05em;right:-.03em;top:.26em;height:3.5px;border-radius:2px;background:currentColor;transform:rotate(-3deg)}
.frac{display:inline-flex;flex-direction:column;align-items:center;gap:8px}
.frac-top,.frac-bottom{display:flex;align-items:center;gap:7px}
.frac-bar{display:block;width:100%;height:3.5px;border-radius:2px;background:currentColor;transform:rotate(-.6deg)}
.formula sub{font-size:.62em;line-height:0;vertical-align:-.16em}
.formula .ring{stroke:var(--terra);stroke-width:3.8;left:-26%;top:-4%;width:158%;height:106%}
.formula .term{margin:0 7px}
.note-foot{position:absolute;left:74px;bottom:12px;font-size:30px;line-height:1;color:#2f6b45;white-space:nowrap}
.note-foot sub{font-size:.66em;line-height:0}

/* The connection */
.link-layer{position:absolute;inset:0;width:1500px;height:1000px;overflow:visible;pointer-events:none}
.margin-note{position:absolute;left:640px;top:496px;font:700 42px/.98 var(--hand);color:var(--terra);transform:rotate(-4deg);text-align:center}
</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="chalk" x="-4%" y="-8%" width="108%" height="116%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="11" result="grain"/>
  <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.7" result="rough"/>
  <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.1 1.85" result="dust"/>
  <feComposite in="rough" in2="dust" operator="in"/>
</filter></svg>

${sprig('left:636px;top:-42px;width:430px;opacity:.6')}
${sprig('left:-104px;top:752px;width:420px;opacity:.52;transform:rotate(168deg)')}

<section class="copy" data-inside>
  <div class="brand">
    <svg class="tile" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="${GREEN}"/><path d="${LEAF}" fill="#f6eedf"/></svg>
    <h1 class="wordmark">al<span>Rato</span></h1>
  </div>
  <h2 class="tagline">Snap it now.<br>Understand it<br><em>al rato.<svg viewBox="0 0 300 26" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M4 16C64 7 158 5 238 10c22 1.5 40 4 58 8" fill="none" stroke="#a84c27" stroke-width="6" stroke-linecap="round"/></svg></em></h2>
  <p class="gloss">“al rato” is Latin American<br>Spanish for “in a little while”</p>
</section>

<div class="note desk-note" id="note" data-inside>${noteFace(true)}</div>

<div class="phone" id="phone" data-inside>
  <div class="screen" id="screen">
    <div class="status"><span>10:24</span><span class="sys"><i class="bars"></i><i class="batt"></i></span></div>
    <i class="punch"></i>
    <div class="body" id="app-body">
      <div class="topbar">${icon('back', 24)}<h1>${t('sample.bellman.title')}</h1>${icon('more', 24)}</div>
      <div class="board">
        <div class="chalk">
          <div class="row"><span>V(s)</span><span>=</span>${SIGMA}<span class="term" id="hot-p">P(s'|s)${RING}</span></div>
          <div class="row"><span>[</span><span>r</span><span>+</span>${GAMMA}<span>V(s')</span><span>]</span></div>
        </div>
        <div class="ledge"></div>
        <i class="stick" style="left:64px;width:44px;background:#f4eee0"></i>
        <i class="stick" style="left:124px;width:30px;background:#e9a07a"></i>
      </div>
      <div class="chips"><span class="chip chip-kind">${t('kind.board')}</span><span class="chip">Reinforcement learning</span></div>
      <article class="aid">
        <h2>${icon('spark', 19)}${t('ladder.1')}</h2>
        <p>What does each probability do to the value of its next state?</p>
        <div class="link-card">
          <h3>${icon('link', 19)}${t('link.title')}</h3>
          <div class="link-note">
            <div class="thumb"><div class="note note-mini">${noteFace()}</div></div>
            <div><strong>${t('sample.weighted.title')}</strong><span class="text-link">${t('link.open')} ${icon('open', 14)}</span></div>
          </div>
          <p class="why">Here the probabilities work as the weights.</p>
        </div>
      </article>
      <div class="ghost">${icon('spark', 19)}${t('ladder.next')}</div>
    </div>
    <nav class="tabbar">
      <span>${icon('home', 23)}${t('nav.home')}</span>
      <span>${icon('camera', 23)}${t('nav.capture')}</span>
      <span>${icon('folder', 23)}${t('nav.library')}</span>
    </nav>
  </div>
</div>

<div class="margin-note" id="margin-note" data-inside>probabilities<br>act as weights</div>
<svg class="link-layer" id="link-layer" aria-hidden="true"></svg>

<script>
window.layout = () => {
  // A point given in an element's own coordinates, through any rotation.
  const at = (el, x, y) => {
    const probe = document.createElement('i');
    probe.style.cssText = 'position:absolute;width:0;height:0;left:' + x + 'px;top:' + y + 'px';
    el.appendChild(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    return { x: box.left, y: box.top };
  };
  const hotP = document.getElementById('hot-p');
  const hotW = document.getElementById('hot-w');
  const board = document.querySelector('.board');
  const phone = document.getElementById('phone');
  const note = document.getElementById('note');
  const route = [
    at(hotP, hotP.offsetWidth * 0.2, -10),
    at(board, 196, 30),
    at(board, 52, 34),
    at(phone, -30, 262),
    at(phone, -66, 428),
    at(note, 412, -14),
    at(note, 402, 46),
    at(note, 352, 76),
    at(hotW, hotW.offsetWidth + 9, -2),
  ];
  const curve = [];
  for (let i = 0; i < route.length - 1; i++) {
    const [a, b, c, d] = [route[Math.max(i - 1, 0)], route[i], route[i + 1], route[Math.min(i + 2, route.length - 1)]];
    for (let j = 0; j < 14; j++) {
      const s = j / 14;
      const blend = (p, q, r, u) => 0.5 * (2 * q + (r - p) * s + (2 * p - 5 * q + 4 * r - u) * s * s + (3 * q - p - 3 * r + u) * s * s * s);
      curve.push({ x: blend(a.x, b.x, c.x, d.x), y: blend(a.y, b.y, c.y, d.y) });
    }
  }
  curve.push(route[route.length - 1]);
  const points = curve.map(({ x, y }, i) => {
    const s = i / (curve.length - 1);
    const env = Math.sin(Math.PI * s);
    return [x + env * 1.8 * Math.sin(s * 15 + 0.7), y + env * 1.8 * Math.cos(s * 12 + 0.3)];
  });
  const [ax, ay] = points[points.length - 5];
  const [bx, by] = points[points.length - 1];
  const angle = Math.atan2(by - ay, bx - ax);
  const head = (spread) => {
    const a = angle + Math.PI + spread;
    return (bx + Math.cos(a) * 30).toFixed(1) + ' ' + (by + Math.sin(a) * 30).toFixed(1);
  };
  const line = 'M' + points.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L');
  const tip = 'M' + head(0.5) + 'L' + bx.toFixed(1) + ' ' + by.toFixed(1) + 'L' + head(-0.46);
  document.getElementById('link-layer').innerHTML =
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="' + line + tip + '" stroke="#fdf9f0" stroke-width="13"/>' +
    '<path d="' + line + tip + '" stroke="#a84c27" stroke-width="6.5"/></g>';

  const problems = [];
  for (const el of document.querySelectorAll('[data-inside]')) {
    const box = el.getBoundingClientRect();
    if (box.left < 0 || box.top < 0 || box.right > 1500 || box.bottom > 1000) problems.push('off canvas: ' + (el.id || el.className));
  }
  const screen = document.getElementById('screen');
  if (screen.scrollHeight > screen.clientHeight) problems.push('phone screen overflows by ' + (screen.scrollHeight - screen.clientHeight) + 'px');
  const body = document.getElementById('app-body');
  if (body.scrollHeight > body.clientHeight) problems.push('phone content overflows by ' + (body.scrollHeight - body.clientHeight) + 'px');
  return { problems };
};
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

function pngInfo(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

/** Reads a finished icon back: how far the leaf really reaches from the center, and its transparency. */
async function inspectIcon(cdp, png) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  try {
    return await evaluate(
      send,
      `(async () => {
        const image = await createImageBitmap(await (await fetch('data:image/png;base64,${png.toString('base64')}')).blob());
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        const [r, g, b] = [0x2f, 0x4f, 0x3a];
        const half = image.width / 2;
        let reach = 0, opaque = true;
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            const i = (y * image.width + x) * 4;
            if (data[i + 3] !== 255) opaque = false;
            if (data[i + 3] > 0 && Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) > 12) {
              reach = Math.max(reach, Math.hypot(x + 0.5 - half, y + 0.5 - half));
            }
          }
        }
        return { reach, opaque, cornerAlpha: data[3] };
      })()`,
    );
  } finally {
    await cdp.send('Target.closeTarget', { targetId });
  }
}

/* ------------------------------------------------------------------ */
/* Inspection sheets (only with --previews, never committed)           */
/* ------------------------------------------------------------------ */

const dataUrl = (file) => `data:image/png;base64,${readFileSync(join(ROOT, file)).toString('base64')}`;

async function writePreviews(cdp) {
  mkdirSync(PREVIEWS, { recursive: true });
  const size = (px, file, radius = '0') => `<img src="${dataUrl(file)}" style="width:${px}px;height:${px}px;border-radius:${radius}">`;
  const iconsSheet = page(
    `<div class="row light">${size(192, 'public/icons/icon-192.png')}${size(160, 'public/icons/icon-512.png')}${size(96, 'public/icons/icon-512.png')}${size(48, 'public/icons/icon-192.png')}${size(180, 'public/icons/apple-touch-icon.png', '40px')}</div>
     <div class="row dark">${size(192, 'public/icons/icon-192.png')}${size(160, 'public/icons/icon-512.png')}${size(96, 'public/icons/icon-512.png')}${size(48, 'public/icons/icon-192.png')}${size(180, 'public/icons/apple-touch-icon.png', '40px')}</div>
     <div class="row light">
       <span class="safe">${size(256, 'public/icons/icon-maskable-512.png')}<i></i></span>
       ${size(180, 'public/icons/icon-maskable-512.png', '50%')}${size(180, 'public/icons/icon-maskable-512.png', '24%')}
       ${size(120, 'public/icons/icon-maskable-512.png', '50%')}${size(64, 'public/icons/icon-maskable-512.png', '50%')}
     </div>`,
    `body{width:1000px;background:#fff;font-family:sans-serif}
     .row{display:flex;align-items:center;gap:28px;padding:22px}.light{background:#f2f2f2}.dark{background:#20242a}
     img{display:block}.safe{position:relative;display:block}
     .safe i{position:absolute;inset:0;margin:auto;width:204.8px;height:204.8px;border-radius:50%;outline:2px dashed #ffb300}`,
  );
  writeFileSync(join(PREVIEWS, 'icons.png'), (await render(cdp, { html: iconsSheet, width: 1000, height: 830 })).png);

  const shots = [
    ['thumbnail-600.png', 600, 400],
    ['thumbnail-300.png', 300, 200],
  ];
  for (const [name, width, height] of shots) {
    const html = page(
      `<img src="${dataUrl('docs/media/thumbnail.png')}" style="display:block;width:${width}px;height:${height}px">`,
      'img{image-rendering:auto}',
    );
    writeFileSync(join(PREVIEWS, name), (await render(cdp, { html, width, height })).png);
  }

  // Real pixels at 2x, to catch clipped glyphs and rough edges.
  const crops = [
    ['crop-board.png', 1000, 120, 470, 370],
    ['crop-note.png', 530, 600, 500, 390],
    ['crop-app.png', 990, 470, 430, 480],
  ];
  for (const [name, x, y, width, height] of crops) {
    const html = page(
      `<div style="position:relative;width:${width * 2}px;height:${height * 2}px;overflow:hidden"><img src="${dataUrl('docs/media/thumbnail.png')}" style="position:absolute;left:${-x * 2}px;top:${-y * 2}px;width:3000px;height:2000px;max-width:none;image-rendering:pixelated"></div>`,
    );
    writeFileSync(join(PREVIEWS, name), (await render(cdp, { html, width: width * 2, height: height * 2 })).png);
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const OUTPUTS = [
  { file: 'public/icons/icon-192.png', size: 192, transparent: true, html: () => logoIcon(192) },
  { file: 'public/icons/icon-512.png', size: 512, transparent: true, html: () => logoIcon(512) },
  { file: 'public/icons/icon-maskable-512.png', size: 512, safeZone: true, html: () => fullBleedIcon(512, 0.365) },
  // iOS paints transparent pixels black and rounds the corners itself, so this one is full bleed too.
  { file: 'public/icons/apple-touch-icon.png', size: 180, html: () => fullBleedIcon(180, 0.34) },
];

async function main() {
  const { child, url } = await launchChrome();
  const cdp = await connect(url);
  const failures = [];
  try {
    mkdirSync(join(ROOT, 'public/icons'), { recursive: true });
    mkdirSync(join(ROOT, 'docs/media'), { recursive: true });

    for (const output of OUTPUTS) {
      const { png } = await render(cdp, {
        html: output.html(),
        width: output.size,
        height: output.size,
        transparent: output.transparent,
      });
      writeFileSync(join(ROOT, output.file), png);
      const info = pngInfo(png);
      if (info.width !== output.size || info.height !== output.size) failures.push(`${output.file}: wrong size`);
      console.log(`${output.file}  ${info.width}x${info.height}  ${(info.bytes / 1024).toFixed(1)} KB`);

      const { reach, opaque, cornerAlpha } = await inspectIcon(cdp, png);
      if (output.transparent && cornerAlpha !== 0) failures.push(`${output.file}: corners are not transparent`);
      if (!output.transparent && !opaque) failures.push(`${output.file}: has transparent pixels`);
      if (output.safeZone) {
        const limit = SAFE_ZONE_RATIO * output.size;
        console.log(`  leaf reaches ${reach.toFixed(1)} px from center; safe zone is ${limit.toFixed(1)} px`);
        if (reach > limit) failures.push(`${output.file}: leaves the safe zone`);
      }
    }

    const thumbnail = await render(cdp, { html: thumbnailHtml(), width: 1500, height: 1000 });
    writeFileSync(join(ROOT, 'docs/media/thumbnail.png'), thumbnail.png);
    const info = pngInfo(thumbnail.png);
    console.log(`docs/media/thumbnail.png  ${info.width}x${info.height}  ${(info.bytes / 1024).toFixed(1)} KB`);
    if (info.width !== 1500 || info.height !== 1000) failures.push('thumbnail: wrong size');
    if (info.bytes >= MAX_THUMBNAIL_BYTES) failures.push('thumbnail: over 2 MB');
    failures.push(...(thumbnail.report.problems ?? []).map((problem) => `thumbnail: ${problem}`));
    if (thumbnail.fallbacks.length) failures.push(`thumbnail: fell back to system fonts: ${thumbnail.fallbacks.join(', ')}`);

    if (process.argv.includes('--previews')) await writePreviews(cdp);
  } finally {
    await closeChrome(cdp, child);
  }

  if (failures.length) {
    console.error(`\nProblems:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll asset checks passed.');
  }
}

await main();
