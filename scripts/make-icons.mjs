#!/usr/bin/env node
/**
 * Renders the alRato PWA icons from public/favicon.svg with the installed Chrome.
 *
 *   node scripts/make-icons.mjs
 *
 * Three variants come from the same mark: a rounded square for "any" icons, and full-bleed
 * squares for maskable and Apple icons, with the glyph kept inside the safe zone. Chrome runs
 * headless on a throwaway profile under .local, with DNS switched off, so it never touches a
 * browser that is already open. Set CHROME_PATH to use another binary.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.local', 'icon-render');
const PROFILE = join(WORK, 'profile');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const mark = readFileSync(join(ROOT, 'public', 'favicon.svg'), 'utf8');
const defs = mark.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
const sheen = mark.match(/<rect width="64" height="64" rx="15" fill="url\(#sheen\)"\/>/)?.[0];
const glyph = mark.match(/<g fill="none"[\s\S]*?<\/g>/)?.[0];
if (!defs || !sheen || !glyph) throw new Error('public/favicon.svg no longer has the expected layers');

/** Scales the glyph about the centre of the 64-unit square. */
const centred = (scale) => `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${glyph}</g>`;

const VARIANTS = [
  {
    name: 'icon-192',
    size: 192,
    svg: `${defs}<rect width="64" height="64" rx="15" fill="url(#bg)"/>${sheen}${glyph}`,
    out: 'public/icons/icon-192.png',
  },
  {
    name: 'icon-512',
    size: 512,
    svg: `${defs}<rect width="64" height="64" rx="15" fill="url(#bg)"/>${sheen}${glyph}`,
    out: 'public/icons/icon-512.png',
  },
  {
    // Maskable: the platform crops to a circle of 40% of the width, so the glyph stays inside it.
    name: 'icon-maskable-512',
    size: 512,
    svg: `${defs}<rect width="64" height="64" fill="url(#bg)"/>${sheen.replace('rx="15" ', '')}${centred(0.7)}`,
    out: 'public/icons/icon-maskable-512.png',
  },
  {
    // iOS rounds the corners itself, so the Apple icon is full-bleed and must not be transparent.
    name: 'apple-touch-icon',
    size: 180,
    svg: `${defs}<rect width="64" height="64" fill="url(#bg)"/>${sheen.replace('rx="15" ', '')}${centred(0.72)}`,
    out: 'public/icons/apple-touch-icon.png',
  },
];

function page(svg, size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${svg}</svg></body></html>`;
}

function render({ name, size, svg }) {
  const html = join(WORK, `${name}.html`);
  const png = join(WORK, `${name}.png`);
  writeFileSync(html, page(svg, size));
  rmSync(png, { force: true });
  const run = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${PROFILE}`,
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--disable-background-networking',
      `--screenshot=${png}`,
      pathToFileURL(html).href,
    ],
    { timeout: 120_000, encoding: 'utf8' },
  );
  if (!existsSync(png)) throw new Error(`Chrome did not write ${name}: ${run.stderr?.slice(-400) ?? run.error}`);
  return png;
}

/** Width, height and colour type from the PNG header, so the output can be checked without a decoder. */
function pngHeader(path) {
  const bytes = readFileSync(path);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error(`${path} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

mkdirSync(PROFILE, { recursive: true });
const failures = [];
for (const variant of VARIANTS) {
  const png = render(variant);
  const { width, height, colorType } = pngHeader(png);
  if (width !== variant.size || height !== variant.size) failures.push(`${variant.name}: ${width}x${height}`);
  copyFileSync(png, join(ROOT, variant.out));
  const alpha = colorType === 6 ? 'RGBA' : colorType === 2 ? 'RGB' : `type ${colorType}`;
  console.log(`${variant.out}  ${width}x${height}  ${alpha}`);
}
if (failures.length) {
  console.error(`Wrong sizes: ${failures.join(', ')}`);
  process.exit(1);
}
