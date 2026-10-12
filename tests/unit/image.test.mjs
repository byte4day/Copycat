import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { diffImages, padTo, unstableMask, readPng, writePng, findRegions, composite } from '../../src/comparison/image.mjs';
import { tmpdir } from '../helpers/cli.mjs';

/** @param {number} w @param {number} h @param {[number,number,number]} rgb */
function solid(w, h, rgb) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
}
/** @param {any} img @param {number} x0 @param {number} y0 @param {number} w @param {number} h @param {[number,number,number]} rgb */
function rect(img, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4);
  return img;
}

test('identical images have zero mismatch', () => {
  const a = solid(100, 80, [250, 250, 247]);
  const r = diffImages(a, solid(100, 80, [250, 250, 247]));
  assert.equal(r.diffPixels, 0);
  assert.equal(r.mismatchRatio, 0);
  assert.equal(r.regions.length, 0);
  assert.equal(r.sizeMismatch, false);
});

test('a changed block is measured and located as a region', () => {
  const a = solid(200, 200, [255, 255, 255]);
  const b = rect(solid(200, 200, [255, 255, 255]), 50, 60, 40, 30, [20, 20, 20]);
  const r = diffImages(a, b);
  assert.equal(r.diffPixels, 40 * 30);
  assert.equal(r.mismatchRatio, 1200 / 40000);
  assert.equal(r.regions.length, 1);
  const g = r.regions[0];
  assert.ok(g.x <= 50 && g.y <= 60 && g.x + g.w >= 90 && g.y + g.h >= 90, JSON.stringify(g));
});

test('size mismatch is padded and counted, or cropped on request', () => {
  const a = solid(100, 100, [255, 255, 255]);
  const b = solid(100, 120, [255, 255, 255]);
  const padded = diffImages(a, b);
  assert.equal(padded.sizeMismatch, true);
  assert.equal(padded.height, 120);
  assert.equal(padded.diffPixels, 100 * 20);
  const cropped = diffImages(a, b, { mode: 'crop' });
  assert.equal(cropped.diffPixels, 0);
  assert.equal(padTo(a, 100, 120).height, 120);
});

test('nondeterministic pixels are masked out of the ratio', () => {
  const ref1 = solid(100, 100, [255, 255, 255]);
  const ref2 = rect(solid(100, 100, [255, 255, 255]), 10, 10, 10, 10, [0, 0, 0]); // e.g. a carousel frame
  const mask = unstableMask(ref1, ref2);
  const local = rect(solid(100, 100, [255, 255, 255]), 10, 10, 10, 10, [200, 0, 0]);
  const r = diffImages(ref1, local, { mask });
  assert.equal(r.diffPixels, 0);
  assert.ok(r.unstablePixels >= 100);
});

test('threshold controls per-pixel colour sensitivity', () => {
  const a = solid(50, 50, [200, 200, 200]);
  const b = solid(50, 50, [204, 204, 204]);
  assert.equal(diffImages(a, b, { threshold: 0.1 }).diffPixels, 0);
  assert.equal(diffImages(a, b, { threshold: 0 }).diffPixels, 2500);
});

test('diff images round-trip as PNG files and composite', () => {
  const dir = tmpdir('img');
  const a = solid(30, 20, [255, 255, 255]);
  const b = rect(solid(30, 20, [255, 255, 255]), 0, 0, 5, 5, [0, 0, 0]);
  const r = diffImages(a, b);
  const f = path.join(dir, 'diff.png');
  writePng(f, r.diffImage);
  assert.ok(existsSync(f));
  const back = readPng(f);
  assert.equal(back.width, 30);
  const c = composite(a, b, r.diffImage);
  assert.equal(c.width, 30 * 3 + 16);
  assert.throws(() => readPng(path.join(dir, 'missing.png')), /Cannot read/);
});

test('findRegions merges adjacent cells', () => {
  const w = 96;
  const h = 48;
  const d = new Uint8Array(w * h);
  for (let y = 10; y < 30; y++) for (let x = 40; x < 60; x++) d[y * w + x] = 1; // spans two 48px cells
  const regions = findRegions(d, w, h, 48);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].diffPixels, 400);
});
