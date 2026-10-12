import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { CopycatError, EXIT } from '../core/errors.mjs';

/** @typedef {{ width: number, height: number, data: Buffer }} Image */

/** @param {string} file @returns {Image} */
export function readPng(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    throw new CopycatError(`Cannot read image: ${file}`, EXIT.USAGE);
  }
  try {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  } catch {
    throw new CopycatError(`Not a valid PNG: ${file}`, EXIT.USAGE, 'Convert JPEG/WebP references to PNG first.');
  }
}

/** @param {string} file @param {Image} img */
export function writePng(file, img) {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  writeFileSync(file, PNG.sync.write(png));
}

/**
 * Pad an image to (w, h). Padding uses a fixed sentinel colour so that a
 * size mismatch is always counted as a difference instead of hidden.
 * @param {Image} img @param {number} w @param {number} h
 * @returns {Image}
 */
export function padTo(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([255, 0, 255, 255], i * 4);
  for (let y = 0; y < Math.min(h, img.height); y++) {
    img.data.copy(data, y * w * 4, y * img.width * 4, y * img.width * 4 + Math.min(w, img.width) * 4);
  }
  return { width: w, height: h, data };
}

/**
 * Crop to (w, h) from the top-left.
 * @param {Image} img @param {number} w @param {number} h
 */
export function cropTo(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) img.data.copy(data, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
  return { width: w, height: h, data };
}

/**
 * Pixels that differ between two captures of the same reference. These are
 * nondeterministic (animations, carousels, ads, timestamps) and are excluded
 * from the mismatch ratio rather than reported as defects.
 * @param {Image} a @param {Image} b @param {number} [tolerance]
 * @returns {Uint8Array} 1 = unstable
 */
export function unstableMask(a, b, tolerance = 8) {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const A = padTo(a, w, h);
  const B = padTo(b, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (Math.abs(A.data[o] - B.data[o]) > tolerance || Math.abs(A.data[o + 1] - B.data[o + 1]) > tolerance || Math.abs(A.data[o + 2] - B.data[o + 2]) > tolerance) mask[i] = 1;
  }
  // Dilate by 2px so anti-aliased edges of moving content are covered too.
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy;
      const xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/**
 * @typedef {Object} DiffResult
 * @property {number} width
 * @property {number} height
 * @property {{ reference: {width:number,height:number}, local: {width:number,height:number} }} sizes
 * @property {boolean} sizeMismatch
 * @property {number} comparedPixels    pixels considered (excludes unstable)
 * @property {number} diffPixels        differing pixels (excludes unstable)
 * @property {number} unstablePixels
 * @property {number} mismatchRatio     diffPixels / comparedPixels
 * @property {Region[]} regions
 * @property {Image} diffImage
 */

/** @typedef {{ x: number, y: number, w: number, h: number, diffPixels: number, ratio: number }} Region */

/**
 * Compare two images. `mode: 'pad'` keeps full extents (height differences
 * count as diffs); `mode: 'crop'` compares only the overlapping area.
 * @param {Image} ref @param {Image} local
 * @param {{ threshold?: number, includeAA?: boolean, mask?: Uint8Array | null, cell?: number, mode?: 'pad' | 'crop' }} [opts]
 * @returns {DiffResult}
 */
export function diffImages(ref, local, opts = {}) {
  const mode = opts.mode ?? 'pad';
  const w = mode === 'crop' ? Math.min(ref.width, local.width) : Math.max(ref.width, local.width);
  const h = mode === 'crop' ? Math.min(ref.height, local.height) : Math.max(ref.height, local.height);
  const A = mode === 'crop' ? cropTo(ref, w, h) : padTo(ref, w, h);
  const B = mode === 'crop' ? cropTo(local, w, h) : padTo(local, w, h);
  const out = Buffer.alloc(w * h * 4);
  pixelmatch(A.data, B.data, out, w, h, {
    threshold: opts.threshold ?? 0.1, includeAA: opts.includeAA ?? true, alpha: 0.25,
    diffColor: [230, 40, 40], aaColor: [255, 210, 0], diffMask: false,
  });
  const mask = opts.mask && opts.mask.length === w * h ? opts.mask : null;
  const isDiff = new Uint8Array(w * h);
  let diffPixels = 0;
  let unstable = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const red = out[o] === 230 && out[o + 1] === 40 && out[o + 2] === 40;
    if (mask?.[i]) {
      unstable++;
      out.set([80, 140, 255, 255], o); // blue: nondeterministic, ignored
      continue;
    }
    if (red) {
      isDiff[i] = 1;
      diffPixels++;
    }
  }
  const compared = w * h - unstable;
  return {
    width: w, height: h,
    sizes: { reference: { width: ref.width, height: ref.height }, local: { width: local.width, height: local.height } },
    sizeMismatch: ref.width !== local.width || ref.height !== local.height,
    comparedPixels: compared, diffPixels, unstablePixels: unstable,
    mismatchRatio: compared ? diffPixels / compared : 0,
    regions: findRegions(isDiff, w, h, opts.cell ?? 48),
    diffImage: { width: w, height: h, data: out },
  };
}

/**
 * Group differing pixels into rectangular regions on a coarse grid, merging
 * adjacent cells (8-connectivity). Returns regions sorted by size.
 * @param {Uint8Array} isDiff @param {number} w @param {number} h @param {number} cell
 * @returns {Region[]}
 */
export function findRegions(isDiff, w, h, cell) {
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const r = Math.floor(y / cell) * cols;
    for (let x = 0; x < w; x++) if (isDiff[y * w + x]) counts[r + Math.floor(x / cell)]++;
  }
  const minCount = Math.max(4, Math.floor(cell * cell * 0.01));
  const active = new Uint8Array(cols * rows);
  for (let i = 0; i < counts.length; i++) if (counts[i] >= minCount) active[i] = 1;
  const seen = new Uint8Array(cols * rows);
  /** @type {Region[]} */
  const regions = [];
  for (let i = 0; i < active.length; i++) {
    if (!active[i] || seen[i]) continue;
    let minC = Infinity; let minR = Infinity; let maxC = -1; let maxR = -1; let px = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = /** @type {number} */ (stack.pop());
      const c = j % cols;
      const r = Math.floor(j / cols);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      px += counts[j];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const k = rr * cols + cc;
        if (active[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    const x = minC * cell;
    const y = minR * cell;
    const rw = Math.min(w, (maxC + 1) * cell) - x;
    const rh = Math.min(h, (maxR + 1) * cell) - y;
    regions.push({ x, y, w: rw, h: rh, diffPixels: px, ratio: Math.round((px / (rw * rh)) * 1000) / 1000 });
  }
  return regions.sort((a, b) => b.diffPixels - a.diffPixels).slice(0, 25);
}

/**
 * Side-by-side composite: reference | local | diff. Useful for humans and
 * for agents that can view images.
 * @param {Image} ref @param {Image} local @param {Image} diff
 */
export function composite(ref, local, diff) {
  const gap = 8;
  const w = ref.width + local.width + diff.width + gap * 2;
  const h = Math.max(ref.height, local.height, diff.height);
  const data = Buffer.alloc(w * h * 4, 255);
  let x0 = 0;
  for (const img of [ref, local, diff]) {
    for (let y = 0; y < img.height; y++) img.data.copy(data, (y * w + x0) * 4, y * img.width * 4, (y + 1) * img.width * 4);
    x0 += img.width + gap;
  }
  return { width: w, height: h, data };
}
