/**
 * Shrink a photo of an identity document before it leaves the browser.
 *
 * A phone camera produces a 3–8 MB, 12-megapixel image; an ID card is legible
 * at 1600px on its long side. Re-encoding to JPEG here keeps each document to
 * a few hundred KB — the API refuses anything over 1.5 MB — and strips the
 * photo's EXIF (location, device), which is personal data the trust has no
 * reason to hold.
 */
const MAX_SIDE = 1600
const MAX_BYTES = 1_400_000

export async function compressIdImage(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('not-an-image')
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q)
    // base64 is 4/3 of the bytes
    if ((url.length - url.indexOf(',') - 1) * 0.75 <= MAX_BYTES) return url
  }
  throw new Error('too-large')
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')) }
    img.src = url
  })
}
