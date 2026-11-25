const MAX_SIDE = 1600;
const THUMB_SIDE = 480;

function scaled(width: number, height: number, maxSide: number) {
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const { width, height } = scaled(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', quality);
  });
}

/** Normalizes any photo to a compact JPEG, which both Gemini Nano and the cloud accept. */
export async function prepareImage(source: Blob): Promise<{ image: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  try {
    const [image, thumb] = await Promise.all([encode(bitmap, MAX_SIDE, 0.84), encode(bitmap, THUMB_SIDE, 0.72)]);
    return { image, thumb };
  } finally {
    bitmap.close();
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  return btoa(binary);
}
