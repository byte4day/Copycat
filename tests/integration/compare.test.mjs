import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { serve } from '../helpers/server.mjs';
import { run, tmpdir, REPO } from '../helpers/cli.mjs';

// The reconstruction in tests/workspace/pricing-rebuild/ was written from
// Copycat's inspection artifacts of tests/fixtures/site/pricing.html, with
// independent markup, class names, CSS and JS.
const REBUILD = path.join(REPO, 'tests/workspace/pricing-rebuild');

/** @type {Awaited<ReturnType<typeof serve>>} */
let site;
const out = tmpdir('compare');
before(async () => { site = await serve(path.join(REPO, 'tests/fixtures/site')); });
after(async () => { await site.close(); });
const cc = (/** @type {string[]} */ args) => run('bin/copycat.mjs', [...args, '--out', out]);

test('reconstruction matches the reference at desktop and mobile', async () => {
  const r = await cc(['compare', '--reference', `${site.url}/pricing.html`, '--local', path.join(REBUILD, 'index.html'), '--viewport', 'desktop,mobile', '--run', 'rebuild', '--max-mismatch', '0.005', '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.passed, true);
  for (const v of res.results) {
    assert.equal(v.structural.missing.length, 0, `${v.viewport.name}: nothing missing`);
    assert.equal(v.structural.coverage, 1);
    assert.ok(v.pixel.mismatchRatio <= 0.005, `${v.viewport.name} mismatch ${v.pixel.mismatchRatio}`);
    for (const f of ['reference', 'local', 'diff']) assert.ok(existsSync(path.join(out, 'rebuild', v.files[f])), f);
  }
});

test('the compare loop detects defects, prioritises them, and confirms the fix', async () => {
  const work = tmpdir('degraded');
  cpSync(REBUILD, work, { recursive: true });
  const css = path.join(work, 'layout.css');
  const html = path.join(work, 'index.html');
  const goodCss = readFileSync(css, 'utf8');
  const goodHtml = readFileSync(html, 'utf8');
  writeFileSync(css, goodCss.replace('.page-title { font-size: 32px', '.page-title { font-size: 28px').replace('.tier { border: 1px solid var(--c-border); border-radius: var(--radius-control); padding: 24px; }', '.tier { border: 1px solid var(--c-border); border-radius: 12px; padding: 16px; }'));
  writeFileSync(html, goodHtml.replace('<li>Audit trail</li>', ''));

  const bad = await cc(['compare', '--reference', `${site.url}/pricing.html`, '--local', html, '--viewport', 'desktop', '--run', 'loop', '--max-mismatch', '0.005', '--json']);
  assert.equal(bad.code, 7, 'over threshold exits 7');
  const it1 = JSON.parse(bad.stdout);
  assert.equal(it1.iteration, 1);
  assert.ok(it1.worstMismatchRatio > 0.01);
  const issues = it1.results[0].issues;
  assert.equal(issues[0].category, 'structure');
  assert.match(issues[0].summary, /Missing listitem "Audit trail"/);
  assert.ok(issues.some((/** @type {any} */ i) => i.category === 'typography' && /heading "Pricing".*fontSize 32px → 28px/.test(i.summary)));
  assert.ok(issues.some((/** @type {any} */ i) => i.category === 'micro' && /borderRadius 6px → 12px/.test(i.summary)));
  assert.ok(issues.some((/** @type {any} */ i) => i.category === 'spacing' && /paddingTop 24px → 16px/.test(i.summary)));
  const order = issues.map((/** @type {any} */ i) => i.priority);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sorted by priority');

  writeFileSync(css, goodCss);
  writeFileSync(html, goodHtml);
  const good = await cc(['compare', '--reference', `${site.url}/pricing.html`, '--local', html, '--viewport', 'desktop', '--run', 'loop', '--max-mismatch', '0.005', '--json']);
  assert.equal(good.code, 0, good.stdout);
  const it2 = JSON.parse(good.stdout);
  assert.equal(it2.iteration, 2);
  assert.ok(it2.worstMismatchRatio < it1.worstMismatchRatio);
  const report = readFileSync(path.join(out, 'loop', 'report.md'), 'utf8');
  assert.match(report, /\| 1 \| desktop \|/);
  assert.match(report, /\| 2 \| desktop \|/);
  assert.match(report, /Latest iteration 2: within --max-mismatch/);
});

test('reference behaviour is reproduced: the same flow gives the same observations', async () => {
  const stepsRef = path.join(out, 'ref-steps.json');
  const stepsLocal = path.join(out, 'local-steps.json');
  writeFileSync(stepsRef, JSON.stringify([
    { action: 'click', selector: '[role=tab][data-period=yearly]', name: 'yearly' },
    { action: 'click', selector: '[data-open-modal]', name: 'open dialog' },
    { action: 'press', key: 'Escape', name: 'close dialog' },
  ]));
  writeFileSync(stepsLocal, JSON.stringify([
    { action: 'click', selector: '[role=tab][data-period=year]', name: 'yearly' },
    { action: 'click', selector: '[data-dialog-open]', name: 'open dialog' },
    { action: 'press', key: 'Escape', name: 'close dialog' },
  ]));
  assert.equal((await cc(['flow', `${site.url}/pricing.html`, '--steps', stepsRef, '--label', 'reference', '--run', 'parity'])).code, 0);
  assert.equal((await cc(['flow', path.join(REBUILD, 'index.html'), '--steps', stepsLocal, '--label', 'local', '--run', 'parity'])).code, 0);
  const flows = JSON.parse(readFileSync(path.join(out, 'parity', 'flows.json'), 'utf8'));
  const ref = flows.filter((/** @type {any} */ f) => f.flow === 'reference');
  const loc = flows.filter((/** @type {any} */ f) => f.flow === 'local');
  assert.equal(ref.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(loc[i].ok);
    assert.equal(loc[i].observed.shownCount > 0, ref[i].observed.shownCount > 0, `step ${i + 1} shown`);
    assert.equal(loc[i].observed.hiddenCount > 0, ref[i].observed.hiddenCount > 0, `step ${i + 1} hidden`);
    const kinds = (/** @type {any} */ f) => f.observed.attributes.map((/** @type {any} */ a) => `${a.attr.split('@')[1]}:${a.to}`).sort();
    assert.deepEqual(kinds(loc[i]), kinds(ref[i]), `step ${i + 1} attribute changes`);
  }
  // The yearly tab really switched prices in the rebuild.
  const screenshotted = loc[0].screenshot;
  assert.ok(screenshotted && existsSync(path.join(out, 'parity', screenshotted)));
});

test('screenshot references compare pixel-only', async () => {
  const shot = path.join(out, 'rebuild', 'compare', 'iter-1', 'reference.desktop.png');
  const r = await cc(['compare', '--reference', shot, '--local', path.join(REBUILD, 'index.html'), '--viewport', 'desktop', '--run', 'png', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.results[0].structural, null);
  assert.ok(res.results[0].pixel.mismatchRatio < 0.005);
});

test('component compare with --selector', async () => {
  const r = await cc(['compare', '--reference', `${site.url}/pricing.html`, '--local', path.join(REBUILD, 'index.html'), '--selector', '.tabs', '--local-selector', '.period', '--viewport', 'desktop', '--run', 'tabs', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.ok(Math.abs(res.results[0].pixel.width - 184) <= 2, String(res.results[0].pixel.width));
  assert.equal(res.results[0].structural.missing.length, 0);
});
