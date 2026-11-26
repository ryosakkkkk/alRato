import { translate } from '../i18n';
import { blankCapture } from './captures';
import { db } from './db';
import { prepareImage } from './image';
import { kickQueue } from './queue';
import type { Lang } from './types';

type Line = { text: string; size?: number; x?: number; color?: string };

const HAND = (size: number) => `600 ${size}px "Caveat", "Segoe Print", "Times New Roman", serif`;

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', 0.9);
  });
}

function drawLines(ctx: CanvasRenderingContext2D, lines: Line[], startY: number, gap: number, baseX: number) {
  let y = startY;
  for (const line of lines) {
    const size = line.size ?? 44;
    ctx.font = HAND(size);
    ctx.fillStyle = line.color ?? '#23303f';
    ctx.fillText(line.text, line.x ?? baseX, y);
    y += Math.max(gap, size * 1.25);
  }
}

async function notebookPage(title: string, lines: Line[]): Promise<Blob> {
  await document.fonts.load(HAND(44));
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbf5e6';
  ctx.fillRect(0, 0, 1200, 900);
  ctx.strokeStyle = '#d9d2bf';
  ctx.lineWidth = 2;
  for (let y = 120; y < 900; y += 62) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#e3a79a';
  ctx.beginPath();
  ctx.moveTo(120, 0);
  ctx.lineTo(120, 900);
  ctx.stroke();
  ctx.fillStyle = '#4a4a4a';
  for (let y = 40; y < 900; y += 66) {
    ctx.beginPath();
    ctx.arc(46, y, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = HAND(68);
  ctx.fillStyle = '#1f4e8c';
  ctx.fillText(title, 170, 96);
  const width = ctx.measureText(title).width;
  ctx.strokeStyle = '#2f6b45';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(170, 112);
  ctx.lineTo(170 + width, 112);
  ctx.stroke();
  drawLines(ctx, lines, 236, 62, 180);
  return toBlob(canvas);
}

async function whiteboard(title: string, lines: Line[]): Promise<Blob> {
  await document.fonts.load(HAND(44));
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d')!;
  const wall = ctx.createLinearGradient(0, 0, 1400, 1000);
  wall.addColorStop(0, '#d9b98c');
  wall.addColorStop(1, '#b98f5f');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 1400, 1000);
  ctx.fillStyle = '#8f9499';
  ctx.fillRect(50, 44, 1300, 900);
  ctx.fillStyle = '#fbfcfb';
  ctx.fillRect(62, 56, 1276, 876);
  ctx.fillStyle = '#7d8287';
  ctx.fillRect(420, 944, 560, 14);
  ctx.font = HAND(76);
  ctx.fillStyle = '#23303f';
  ctx.fillText(title, 120, 150);
  const width = ctx.measureText(title).width;
  ctx.strokeStyle = '#2f6b45';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(120, 170);
  ctx.lineTo(120 + width, 170);
  ctx.stroke();
  drawLines(ctx, lines, 288, 74, 130);
  return toBlob(canvas);
}

/**
 * Adds two ready-made notes so a judge or new student can see a connection in
 * under a minute. They carry no AI receipts because no model produced them.
 */
export async function loadSampleLibrary(lang: Lang): Promise<void> {
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);

  const weightedImage = await prepareImage(
    await notebookPage(t('sample.weighted.title'), [
      { text: 'x̄  =  ( Σ wᵢ · xᵢ )  /  ( Σ wᵢ )', size: 62, x: 240 },
      { text: t('sample.weighted.where') },
      { text: `•  xᵢ : ${t('sample.weighted.xi')}`, x: 210 },
      { text: `•  wᵢ : ${t('sample.weighted.wi')}`, x: 210 },
      { text: t('sample.weighted.close'), color: '#2f6b45' },
    ]),
  );
  const ohmImage = await prepareImage(
    await notebookPage(t('sample.ohm.title'), [
      { text: 'V  =  I · R', size: 70, x: 320 },
      { text: `•  V : ${t('sample.ohm.v')}`, x: 210 },
      { text: `•  I : ${t('sample.ohm.i')}`, x: 210 },
      { text: `•  R : ${t('sample.ohm.r')}`, x: 210 },
    ]),
  );

  const dayMs = 86_400_000;
  const now = Date.now();
  const weighted = blankCapture({
    ...weightedImage,
    id: `sample-weighted-${lang}`,
    createdAt: now - 6 * dayMs,
    updatedAt: now - 6 * dayMs,
    kind: 'formula',
    title: t('sample.weighted.title'),
    subject: t('sample.weighted.subject'),
    topic: t('sample.weighted.topic'),
    text: `$\\bar{x} = \\frac{\\sum_i w_i x_i}{\\sum_i w_i}$\n${t('sample.weighted.where')}\n- $x_i$: ${t('sample.weighted.xi')}\n- $w_i$: ${t('sample.weighted.wi')}\n${t('sample.weighted.close')}`,
    textBy: 'student',
    legibility: 'high',
    teaches: [t('sample.weighted.title')],
    // The note defines each weight as "e.g. a probability", so the concept it teaches includes probability.
    teachesKeys: ['weighted average', 'weighted mean', 'expected value', 'probability'],
    needsKeys: ['arithmetic mean'],
    status: 'ready',
    analyzedRevision: 1,
    isSample: true,
  });
  const ohm = blankCapture({
    ...ohmImage,
    id: `sample-ohm-${lang}`,
    createdAt: now - 3 * dayMs,
    updatedAt: now - 3 * dayMs,
    kind: 'formula',
    title: t('sample.ohm.title'),
    subject: t('sample.ohm.subject'),
    topic: t('sample.ohm.topic'),
    text: `$V = I \\cdot R$\n- $V$: ${t('sample.ohm.v')}\n- $I$: ${t('sample.ohm.i')}\n- $R$: ${t('sample.ohm.r')}`,
    textBy: 'student',
    legibility: 'high',
    teaches: [t('sample.ohm.title')],
    teachesKeys: ['ohm law', 'voltage', 'electric current', 'resistance'],
    needsKeys: ['electric charge'],
    status: 'ready',
    analyzedRevision: 1,
    isSample: true,
  });
  await db.captures.bulkPut([weighted, ohm]);
}

/** A new class photo. Unlike the library samples, this one goes through the real AI pipeline. */
export async function addBellmanSample(lang: Lang): Promise<string> {
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  const blob = await whiteboard(t('sample.bellman.title'), [
    { text: "V(s)  =  Σ  P(s′|s) · [ r(s,s′) + γ · V(s′) ]", size: 62, x: 170 },
    { text: t('sample.bellman.where') },
    { text: `•  V(s) : ${t('sample.bellman.v')}`, x: 170 },
    { text: `•  P(s′|s) : ${t('sample.bellman.p')}`, x: 170 },
    { text: `•  r(s,s′) : ${t('sample.bellman.r')}`, x: 170 },
    { text: `•  γ : ${t('sample.bellman.g')}`, x: 170 },
    { text: t('sample.bellman.task'), color: '#b5482a', size: 48 },
  ]);
  const { image, thumb } = await prepareImage(blob);
  const capture = blankCapture({ image, thumb, comment: t('sample.bellman.comment'), isSample: true });
  await db.captures.add(capture);
  kickQueue();
  return capture.id;
}
