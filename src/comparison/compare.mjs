import path from 'node:path';
import { launchBrowser, newContext, gotoStable, stableScreenshot } from '../browser/launch.mjs';
import { parseViewports, parseViewport } from '../browser/viewports.mjs';
import { extractPage } from '../inspection/extract.mjs';
import { readPng, writePng, diffImages, unstableMask, composite, padTo, cropRect } from './image.mjs';
import { applySteps } from '../inspection/interact.mjs';
import { redactUrl } from '../core/redact.mjs';
import { CopycatError, EXIT } from '../core/errors.mjs';

/** Priority order from the Copycat spec. Lower is fixed first. */
export const PRIORITY = /** @type {const} */ ({ structure: 1, layout: 2, typography: 3, spacing: 3, color: 4, assets: 5, responsive: 6, states: 7, micro: 8 });

/**
 * @typedef {Object} CompareOptions
 * @property {URL | string} reference   URL or path to a reference PNG
 * @property {URL} local
 * @property {string[]} [viewports]
 * @property {string | null} [selector]       selector applied to both sides
 * @property {string | null} [localSelector]  override for the local side
 * @property {number} [threshold]             pixelmatch per-pixel threshold (0..1)
 * @property {number | null} [maxMismatch]    fail (exit 7) when ratio exceeds this
 * @property {number} [tolerance]             px tolerance for box comparisons
 * @property {boolean} [fullPage]
 * @property {boolean} [stability]            capture reference twice to mask nondeterminism
 * @property {number} [timeout]
 * @property {'pad'|'crop'} [sizeMode]
 * @property {boolean} [ignoreAntialiasing]  let pixelmatch discount anti-aliased pixels
 * @property {import('../inspection/interact.mjs').Step[] | null} [steps]       run on the reference (and local) before capture
 * @property {import('../inspection/interact.mjs').Step[] | null} [localSteps]  override for the local side
 * @property {boolean} [allowSubmit]
 * @property {boolean} [strict]
 * @property {'light' | 'dark'} [colorScheme]
 * @property {boolean} [reducedMotion]
 * @property {number} [regionCrops]          how many worst regions get a zoomed crop (default 3)
 */

/** Largest zoomed crop written per region, so the image stays readable. */
const CROP_MAX = { w: 1600, h: 1200 };
const CROP_PAD = 24;

/**
 * Human-readable description of the compared state (for the report).
 * @param {CompareOptions} o
 */
function stateOf(o) {
  // A screenshot reference has no page to run steps on.
  const ref = typeof o.reference === 'string' ? 0 : o.steps?.length ?? 0;
  const loc = (o.localSteps ?? o.steps)?.length ?? 0;
  return ref || loc ? { referenceSteps: ref, localSteps: loc } : null;
}

/**
 * Bring a loaded page into the requested state.
 * @param {import('playwright').Page} page @param {URL} url
 * @param {import('../inspection/interact.mjs').Step[] | null | undefined} steps @param {CompareOptions} o
 */
async function enterState(page, url, steps, o) {
  if (steps?.length) await applySteps(page, steps, { url, timeout: o.timeout, allowSubmit: o.allowSubmit, strict: o.strict });
}

/**
 * @param {import('../core/run.mjs').Run} run
 * @param {CompareOptions} o
 */
export async function compare(run, o) {
  const refIsImage = typeof o.reference === 'string';
  const prev = (await run.readJson('compare.json')) ?? { iterations: [] };
  const iteration = prev.iterations.length + 1;
  const dir = `compare/iter-${iteration}`;
  await run.ensureDir(dir);
  const threshold = o.threshold ?? 0.1;
  const tolerance = o.tolerance ?? 4;
  const mode = o.sizeMode ?? 'pad';
  const ctxOpts = { colorScheme: o.colorScheme, reducedMotion: o.reducedMotion };
  const localSteps = o.localSteps ?? o.steps ?? null;

  /** @type {any[]} */
  const results = [];
  const browser = await launchBrowser();
  try {
    const viewports = refIsImage
      ? [o.viewports?.length ? parseViewport(o.viewports[0]) : parseViewport(`${readPng(/** @type {string} */ (o.reference)).width}x900`)]
      : parseViewports(o.viewports ?? []);
    for (const vp of viewports) {
      const refFile = `${dir}/reference.${vp.name}.png`;
      const refFile2 = `${dir}/reference.${vp.name}.b.png`;
      const localFile = `${dir}/local.${vp.name}.png`;
      /** @type {any} */ let refData = null;
      /** @type {any} */ let localData = null;
      /** @type {boolean | Uint8Array | null} */
      let mask = null;

      if (refIsImage) {
        writePng(run.path(refFile), readPng(/** @type {string} */ (o.reference)));
      } else {
        const ctx = await newContext(browser, vp, ctxOpts);
        try {
          const page = await ctx.newPage();
          await gotoStable(page, /** @type {URL} */ (o.reference).href, { timeout: o.timeout });
          await enterState(page, /** @type {URL} */ (o.reference), o.steps, o);
          await stableScreenshot(page, run.path(refFile), { selector: o.selector ?? undefined, fullPage: o.fullPage ?? true });
          refData = await page.evaluate(extractPage, { selector: o.selector ?? null, maxNodes: 2500 });
          if (o.stability !== false) {
            await page.reload({ waitUntil: 'load' });
            await gotoStable(page, /** @type {URL} */ (o.reference).href, { timeout: o.timeout });
            await enterState(page, /** @type {URL} */ (o.reference), o.steps, o);
            await stableScreenshot(page, run.path(refFile2), { selector: o.selector ?? undefined, fullPage: o.fullPage ?? true });
            mask = true;
          }
        } finally {
          await ctx.close();
        }
      }
      const lctx = await newContext(browser, vp, ctxOpts);
      try {
        const page = await lctx.newPage();
        await gotoStable(page, o.local.href, { timeout: o.timeout });
        await enterState(page, o.local, localSteps, o);
        const sel = o.localSelector ?? o.selector ?? undefined;
        await stableScreenshot(page, run.path(localFile), { selector: sel, fullPage: o.fullPage ?? true });
        localData = await page.evaluate(extractPage, { selector: sel ?? null, maxNodes: 2500 });
      } finally {
        await lctx.close();
      }
      if (refData?.error) throw new CopycatError(`Reference: ${refData.error}`, EXIT.USAGE);
      if (localData?.error) throw new CopycatError(`Local: ${localData.error}`, EXIT.USAGE);

      const ref = readPng(run.path(refFile));
      const loc = readPng(run.path(localFile));
      // The compared canvas: the union of both captures (pad) or their overlap (crop).
      const w = mode === 'crop' ? Math.min(ref.width, loc.width) : Math.max(ref.width, loc.width);
      const h = mode === 'crop' ? Math.min(ref.height, loc.height) : Math.max(ref.height, loc.height);
      if (mask) {
        // Pixels that changed between two captures of the reference are nondeterministic.
        // Both captures are fitted to the compared canvas so the mask always lines up with it.
        mask = unstableMask(padTo(ref, w, h), padTo(readPng(run.path(refFile2)), w, h));
      }
      const d = diffImages(ref, loc, { threshold, includeAA: !o.ignoreAntialiasing, mask: mask instanceof Uint8Array ? mask : null, mode });
      const diffFile = `${dir}/diff.${vp.name}.png`;
      writePng(run.path(diffFile), d.diffImage);
      let compositeFile = null;
      if (d.height <= 6000) {
        compositeFile = `${dir}/side-by-side.${vp.name}.png`;
        writePng(run.path(compositeFile), composite(ref, loc, d.diffImage));
      }
      const structural = refData && localData ? structuralDiff(refData, localData, tolerance) : null;
      // Zoomed reference | local | diff crops of the worst regions: a full-page image is too
      // small to read once it is scaled down, a crop is not.
      const refFit = padTo(ref, w, h);
      const locFit = padTo(loc, w, h);
      const regions = d.regions.map((r, n) => {
        /** @type {string | null} */
        let crop = null;
        if (n < (o.regionCrops ?? 3)) {
          const box = { x: r.x - CROP_PAD, y: r.y - CROP_PAD, w: Math.min(r.w + CROP_PAD * 2, CROP_MAX.w), h: Math.min(r.h + CROP_PAD * 2, CROP_MAX.h) };
          crop = `${dir}/region-${n + 1}.${vp.name}.png`;
          writePng(run.path(crop), composite(cropRect(refFit, box), cropRect(locFit, box), cropRect(d.diffImage, box)));
        }
        return { ...r, near: refData ? describeRegion(refData.nodes, r) : null, crop };
      });
      const issues = prioritise(structural, d, regions, vp.name);
      results.push({
        viewport: vp,
        files: { reference: refFile, referenceRecapture: mask ? refFile2 : null, local: localFile, diff: diffFile, sideBySide: compositeFile },
        pixel: {
          threshold, ignoreAntialiasing: Boolean(o.ignoreAntialiasing), sizeMode: mode, width: d.width, height: d.height, sizes: d.sizes, sizeMismatch: d.sizeMismatch,
          comparedPixels: d.comparedPixels, diffPixels: d.diffPixels, unstablePixels: d.unstablePixels,
          mismatchRatio: round(d.mismatchRatio, 5), stabilityCheck: Boolean(mask),
        },
        regions,
        structural,
        issues,
      });
    }
  } finally {
    await browser.close();
  }

  const worst = Math.max(...results.map((r) => r.pixel.mismatchRatio));
  const entry = {
    iteration,
    at: new Date().toISOString(),
    reference: refIsImage ? path.basename(/** @type {string} */ (o.reference)) : redactUrl(/** @type {URL} */ (o.reference).href),
    local: redactUrl(o.local.href),
    selector: o.selector ?? null,
    state: stateOf(o),
    colorScheme: o.colorScheme ?? 'light',
    maxMismatch: o.maxMismatch ?? null,
    passed: o.maxMismatch == null ? null : worst <= o.maxMismatch,
    worstMismatchRatio: worst,
    results,
  };
  prev.iterations.push(entry);
  prev.note = 'mismatchRatio = differing pixels / compared pixels at the given pixelmatch threshold, excluding pixels that changed between two captures of the reference. It is a screenshot similarity measure, not a fidelity score.';
  await run.writeJson('compare.json', prev);
  await run.record({ type: 'compare', iteration, worstMismatchRatio: worst, passed: entry.passed, viewports: results.map((r) => r.viewport.name) });
  if (entry.passed === false) {
    const err = new CopycatError(`Mismatch ${(worst * 100).toFixed(2)}% exceeds --max-mismatch ${(Number(o.maxMismatch) * 100).toFixed(2)}%`, EXIT.THRESHOLD);
    /** @type {any} */ (err).entry = entry;
    throw err;
  }
  return entry;
}

/** @param {number} n @param {number} d */
function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** @param {string} s */
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Elements worth matching between reference and local DOMs.
 * @param {any[]} nodes
 */
function keyElements(nodes) {
  return nodes.filter((n) => n.visible && (
    (n.role && /^(heading|button|link|img|navigation|banner|main|contentinfo|complementary|textbox|combobox|checkbox|radio|tab|dialog|searchbox|list|table|form)$/.test(n.role)) ||
    (n.text && n.text.length >= 2) ||
    // Unlabelled boxes that draw something (cards, panels, chips) matter for geometry and styling.
    (n.styles && (n.styles.borderTopWidth || n.styles.backgroundColor || n.styles.boxShadow || n.styles.borderRadius))
  ));
}

/** @param {any} n */
function signature(n) {
  const label = norm(n.name || n.text).slice(0, 60);
  return `${n.role || n.tag}|${label}`;
}

/**
 * Compare two extractPage() results. Matches elements by role + label, then
 * compares geometry and computed style.
 * @param {any} ref @param {any} loc @param {number} tol
 */
export function structuralDiff(ref, loc, tol) {
  const R = keyElements(ref.nodes);
  const L = keyElements(loc.nodes);
  /** @type {Map<string, any[]>} */
  const lmap = new Map();
  for (const n of L) lmap.set(signature(n), [...(lmap.get(signature(n)) ?? []), n]);
  const missing = [];
  const pairs = [];
  for (const r of R) {
    const cands = lmap.get(signature(r));
    if (cands?.length) pairs.push([r, cands.shift()]);
    else if (r.role || (r.text && r.text.length > 3)) missing.push(r);
  }
  const extra = [...lmap.values()].flat().filter((n) => n.role && /^(heading|button|link|navigation|img|dialog|tab)$/.test(n.role));
  const rOrigin = ref.meta.rootBox;
  const lOrigin = loc.meta.rootBox;

  const layout = [];
  const typography = [];
  const color = [];
  const micro = [];
  const spacing = [];
  for (const [r, l] of pairs) {
    const rb = { x: r.box.x - rOrigin.x, y: r.box.y - rOrigin.y, w: r.box.w, h: r.box.h };
    const lb = { x: l.box.x - lOrigin.x, y: l.box.y - lOrigin.y, w: l.box.w, h: l.box.h };
    const deltas = { x: lb.x - rb.x, y: lb.y - rb.y, w: lb.w - rb.w, h: lb.h - rb.h };
    const label = `${r.role || r.tag} "${(r.name || r.text || '').slice(0, 40)}"`;
    if (Object.values(deltas).some((v) => Math.abs(v) > tol)) layout.push({ element: label, reference: rb, local: lb, delta: deltas });
    const rs = r.styles ?? {};
    const ls = l.styles ?? {};
    const tdiff = {};
    for (const k of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign']) if ((rs[k] ?? '') !== (ls[k] ?? '')) /** @type {any} */ (tdiff)[k] = { reference: rs[k] ?? 'default', local: ls[k] ?? 'default' };
    const rf = (rs.fontFamily ?? '').split(',')[0].replace(/["']/g, '').trim();
    const lf = (ls.fontFamily ?? '').split(',')[0].replace(/["']/g, '').trim();
    if (rf !== lf) /** @type {any} */ (tdiff).fontFamily = { reference: rf || 'default', local: lf || 'default' };
    if (Object.keys(tdiff).length) typography.push({ element: label, diff: tdiff });
    const cdiff = {};
    for (const k of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'opacity']) if ((rs[k] ?? '') !== (ls[k] ?? '')) /** @type {any} */ (cdiff)[k] = { reference: rs[k] ?? 'default', local: ls[k] ?? 'default' };
    if (Object.keys(cdiff).length) color.push({ element: label, diff: cdiff });
    const sdiff = {};
    for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'gap']) if ((rs[k] ?? '') !== (ls[k] ?? '')) /** @type {any} */ (sdiff)[k] = { reference: rs[k] ?? 'default', local: ls[k] ?? 'default' };
    if (Object.keys(sdiff).length) spacing.push({ element: label, diff: sdiff });
    const mdiff = {};
    for (const k of ['borderRadius', 'boxShadow', 'borderTopWidth']) if ((rs[k] ?? '') !== (ls[k] ?? '')) /** @type {any} */ (mdiff)[k] = { reference: rs[k] ?? 'default', local: ls[k] ?? 'default' };
    if (Object.keys(mdiff).length) micro.push({ element: label, diff: mdiff });
  }
  const landmarksRef = ref.landmarks.filter((/** @type {any} */ x) => x.visible).map((/** @type {any} */ x) => x.tag);
  const landmarksLoc = loc.landmarks.filter((/** @type {any} */ x) => x.visible).map((/** @type {any} */ x) => x.tag);
  return {
    matched: pairs.length,
    referenceElements: R.length,
    localElements: L.length,
    coverage: R.length ? round(pairs.length / R.length, 3) : 1,
    missing: missing.slice(0, 60).map((n) => ({ role: n.role || n.tag, label: (n.name || n.text || '').slice(0, 80), box: n.box })),
    extra: extra.slice(0, 40).map((n) => ({ role: n.role, label: (n.name || n.text || '').slice(0, 80) })),
    landmarks: { reference: landmarksRef, local: landmarksLoc, missing: landmarksRef.filter((t) => !landmarksLoc.includes(t)) },
    document: { reference: ref.meta.document, local: loc.meta.document, horizontalOverflow: { reference: ref.meta.horizontalOverflow, local: loc.meta.horizontalOverflow } },
    assets: { referenceImages: ref.images.length, localImages: loc.images.length, referenceSvgs: ref.svgs.length, localSvgs: loc.svgs.length },
    interactions: { reference: ref.candidates.length, local: loc.candidates.length },
    layout: layout.slice(0, 80),
    typography: typography.slice(0, 80),
    spacing: spacing.slice(0, 80),
    color: color.slice(0, 80),
    micro: micro.slice(0, 80),
  };
}

/**
 * Name the smallest visible reference element that contains a region center.
 * @param {any[]} nodes @param {{x:number,y:number,w:number,h:number}} r
 */
function describeRegion(nodes, r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let best = null;
  for (const n of nodes) {
    if (!n.visible) continue;
    const b = n.box;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      if (!best || b.w * b.h < best.box.w * best.box.h) best = n;
    }
  }
  if (!best) return null;
  return `${best.tag}${best.id ? `#${best.id}` : ''}${best.cls ? `.${best.cls.slice(0, 2).join('.')}` : ''}${best.text ? ` "${best.text.slice(0, 30)}"` : ''}`;
}

/**
 * Build the prioritised correction list.
 * @param {any} s structural diff (may be null for screenshot references)
 * @param {import('./image.mjs').DiffResult} d
 * @param {any[]} regions
 * @param {string} vp
 */
export function prioritise(s, d, regions, vp) {
  /** @type {{ priority: number, category: string, viewport: string, summary: string, detail?: any }[]} */
  const issues = [];
  /** @param {keyof typeof PRIORITY} cat @param {string} summary @param {any} [detail] */
  const add = (cat, summary, detail) => issues.push({ priority: PRIORITY[cat], category: cat, viewport: vp, summary, detail });
  if (s) {
    for (const t of s.landmarks.missing) add('structure', `Missing landmark <${t}>`);
    for (const m of s.missing.slice(0, 20)) add('structure', `Missing ${m.role} "${m.label}"`, m);
    for (const l of s.layout.slice(0, 20)) add('layout', `${l.element} offset/size Δ x${fmt(l.delta.x)} y${fmt(l.delta.y)} w${fmt(l.delta.w)} h${fmt(l.delta.h)}px`, l);
    for (const t of s.typography.slice(0, 20)) add('typography', `${t.element}: ${Object.entries(t.diff).map(([k, v]) => `${k} ${/** @type {any} */ (v).reference} → ${/** @type {any} */ (v).local}`).join(', ')}`, t);
    for (const t of s.spacing.slice(0, 20)) add('spacing', `${t.element}: ${Object.entries(t.diff).map(([k, v]) => `${k} ${/** @type {any} */ (v).reference} → ${/** @type {any} */ (v).local}`).join(', ')}`, t);
    for (const c of s.color.slice(0, 20)) add('color', `${c.element}: ${Object.entries(c.diff).map(([k, v]) => `${k} ${/** @type {any} */ (v).reference} → ${/** @type {any} */ (v).local}`).join(', ')}`, c);
    if (s.assets.referenceImages !== s.assets.localImages || s.assets.referenceSvgs !== s.assets.localSvgs) {
      add('assets', `Image/SVG count differs: reference ${s.assets.referenceImages} img / ${s.assets.referenceSvgs} svg, local ${s.assets.localImages} img / ${s.assets.localSvgs} svg`);
    }
    if (s.document.horizontalOverflow.local && !s.document.horizontalOverflow.reference) add('responsive', 'Local page overflows horizontally; reference does not');
    if (Math.abs(s.document.reference.height - s.document.local.height) > 16) add('layout', `Document height ${s.document.reference.height}px → ${s.document.local.height}px`);
    if (s.interactions.reference !== s.interactions.local) add('states', `Interactive trigger count differs: reference ${s.interactions.reference}, local ${s.interactions.local}`);
    for (const m of s.micro.slice(0, 15)) add('micro', `${m.element}: ${Object.entries(m.diff).map(([k, v]) => `${k} ${/** @type {any} */ (v).reference} → ${/** @type {any} */ (v).local}`).join(', ')}`, m);
  }
  if (d.sizeMismatch) add('layout', `Screenshot size ${d.sizes.reference.width}×${d.sizes.reference.height} vs local ${d.sizes.local.width}×${d.sizes.local.height}`);
  for (const r of regions.slice(0, 8)) {
    add(r.ratio > 0.3 ? 'layout' : 'micro', `Pixel region (${r.x},${r.y}) ${r.w}×${r.h}: ${(r.ratio * 100).toFixed(1)}% differs${r.near ? ` — near ${r.near}` : ''}${r.crop ? ` — zoom: ${r.crop}` : ''}`, r);
  }
  return issues.sort((a, b) => a.priority - b.priority);
}

/** @param {number} n */
function fmt(n) {
  return n > 0 ? `+${n}` : String(n);
}
