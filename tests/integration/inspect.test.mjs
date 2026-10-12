import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { serve } from '../helpers/server.mjs';
import { run, tmpdir, REPO } from '../helpers/cli.mjs';

/** @type {Awaited<ReturnType<typeof serve>>} */
let site;
const out = tmpdir('inspect');
before(async () => { site = await serve(path.join(REPO, 'tests/fixtures/site')); });
after(async () => { await site.close(); });

const cc = (/** @type {string[]} */ args) => run('bin/copycat.mjs', [...args, '--out', out]);
const json = (/** @type {string} */ id, /** @type {string} */ f) => JSON.parse(readFileSync(path.join(out, id, f), 'utf8'));
const allText = (/** @type {string} */ id) => {
  const dir = path.join(out, id);
  /** @type {string[]} */ const parts = [];
  const walk = (/** @type {string} */ d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.name.endsWith('.png')) parts.push(readFileSync(p, 'utf8')); } };
  walk(dir);
  return parts.join('\n');
};

test('inspects a page at desktop, tablet and mobile with real artifacts', async () => {
  const r = await cc(['inspect', `${site.url}/index.html`, '--viewport', 'desktop,tablet,mobile', '--run', 'home', '--interactions']);
  assert.equal(r.code, 0, r.stderr);
  const shots = json('home', 'screenshots.json');
  assert.deepEqual(shots.map((/** @type {any} */ s) => s.viewport.name), ['desktop', 'tablet', 'mobile']);
  for (const s of shots) {
    assert.ok(s.capturedAt && s.route === '/index.html' && s.state === 'default');
    const png = PNG.sync.read(readFileSync(path.join(out, 'home', s.file)));
    assert.equal(png.width, s.viewport.width, 'full-page screenshot width equals viewport width');
    assert.ok(png.height >= s.viewport.height - 1);
  }
  const tokens = json('home', 'design-tokens.json');
  const hexes = tokens.palette.map((/** @type {any} */ c) => c.hex);
  for (const h of ['#1f2933', '#5f6b7a', '#0f6e5c', '#d9dee5']) assert.ok(hexes.includes(h), `palette has ${h}`);
  assert.match(tokens.typography.families[0].value, /Georgia/);
  assert.ok(tokens.typography.sizes.some((/** @type {any} */ s) => s.value === '44px'));
  assert.deepEqual(tokens.radii.map((/** @type {any} */ r) => r.value), ['6px']);
  assert.ok(tokens.breakpoints.includes('max:760'));
  const inv = json('home', 'component-inventory.json');
  assert.deepEqual([...new Set(inv.landmarks.map((/** @type {any} */ l) => l.tag))].sort(), ['footer', 'header', 'main', 'nav']);
  assert.ok(inv.repeatedPatterns.some((/** @type {any} */ p) => p.signature === 'ARTICLE.card' && p.count === 6));
  assert.ok(inv.states.some((/** @type {any} */ s) => s.hover && Object.keys(s.hover).length), 'hover deltas recorded');
  const resp = json('home', 'responsive.json');
  assert.equal(resp.viewports.mobile.horizontalOverflow, false);
  assert.ok(resp.viewports.desktop.visibleNavLinks > resp.viewports.mobile.visibleNavLinks, 'nav collapses on mobile');
  assert.ok(resp.viewports.mobile.repeatedLayouts[0].itemWidth > resp.viewports.desktop.repeatedLayouts[0].itemWidth / 2);
  assert.ok(existsSync(path.join(out, 'home', 'report.md')));
});

test('responsive navigation is observed working on mobile', () => {
  const m = json('home', 'interaction-matrix.json');
  const menu = m.find((/** @type {any} */ x) => x.viewport === 'mobile' && x.name === 'Menu');
  assert.ok(menu, 'mobile menu probed');
  assert.ok(menu.observed.attributes.some((/** @type {any} */ a) => a.attr.endsWith('@aria-expanded') && a.to === 'true'));
  assert.ok(menu.observed.shownCount > 0);
  assert.ok(menu.screenshot && existsSync(path.join(out, 'home', menu.screenshot)));
  const dd = m.find((/** @type {any} */ x) => x.viewport === 'desktop' && x.name === 'Products');
  assert.equal(dd.closesWithEscape, true);
});

test('sensitive data is redacted and prompt injection is flagged, not followed', () => {
  const text = allText('home');
  assert.ok(!text.includes('help@northwind.example'), 'email redacted');
  assert.ok(!text.includes(['sk', 'live', 'FAKE0123456789abcdef'].join('_')), 'key redacted');
  const ledger = json('home', 'run.json');
  const flags = ledger.events.find((/** @type {any} */ e) => e.type === 'inspect').promptInjectionFlags;
  assert.ok(flags.some((/** @type {any} */ f) => /ignore previous instructions/i.test(f.text)));
  assert.match(readFileSync(path.join(out, 'home', 'report.md'), 'utf8'), /looked like agent instructions and was ignored/);
});

test('component-only inspection isolates the selector', async () => {
  const r = await cc(['inspect', `${site.url}/index.html`, '--selector', 'header.site-header', '--viewport', 'desktop', '--run', 'comp']);
  assert.equal(r.code, 0, r.stderr);
  const shots = json('comp', 'screenshots.json');
  const png = PNG.sync.read(readFileSync(path.join(out, 'comp', shots[0].file)));
  assert.equal(png.width, 1440);
  assert.ok(png.height >= 64 && png.height <= 66, `header height ${png.height}`);
  const dom = json('comp', 'inspection/index-html.desktop.dom.json');
  assert.equal(dom.nodes[0].tag, 'header');
  assert.ok(dom.nodes.length < 25, 'only the component subtree');
  assert.ok(!dom.nodes.some((/** @type {any} */ n) => n.tag === 'article'), 'no page content outside the component');
  assert.equal(json('comp', 'component-inventory.json').scope, 'header.site-header');
});

test('pricing page: tabs and modal are observed', async () => {
  const r = await cc(['inspect', `${site.url}/pricing.html`, '--viewport', 'desktop', '--run', 'pricing', '--interactions']);
  assert.equal(r.code, 0, r.stderr);
  const m = json('pricing', 'interaction-matrix.json');
  const yearly = m.find((/** @type {any} */ x) => x.name === 'Yearly');
  assert.ok(yearly.observed.attributes.some((/** @type {any} */ a) => a.attr.endsWith('@aria-selected') && a.to === 'true'));
  const modal = m.find((/** @type {any} */ x) => x.name === 'Contact sales');
  assert.equal(modal.kind, 'dialog-trigger');
  assert.ok(modal.observed.shownCount > 0 && modal.observed.focusMoved);
  assert.equal(modal.closesWithEscape, true);
});

test('dashboard: sidebar collapse and filters are observed', async () => {
  const r = await cc(['inspect', `${site.url}/dashboard.html`, '--viewport', 'desktop', '--run', 'dash', '--interactions']);
  assert.equal(r.code, 0, r.stderr);
  const m = json('dash', 'interaction-matrix.json');
  const overdue = m.find((/** @type {any} */ x) => x.name === 'Overdue');
  assert.ok(overdue.observed.hiddenCount >= 2, 'filter hides rows');
  assert.ok(overdue.observed.attributes.some((/** @type {any} */ a) => a.attr.endsWith('@aria-pressed')));
  const collapse = m.find((/** @type {any} */ x) => x.name === 'Collapse');
  assert.ok(collapse.observed.attributes.some((/** @type {any} */ a) => a.attr.endsWith('@aria-expanded') && a.to === 'false'));
  const inv = json('dash', 'component-inventory.json');
  assert.ok(inv.landmarks.some((/** @type {any} */ l) => l.tag === 'aside'));
});

test('recon on a component request stays in scope', async () => {
  const r = await run('bin/copycat.mjs', ['recon', `copycat the navbar from ${site.url}/index.html`, '--selector', 'header', '--viewport', 'desktop', '--out', out, '--run', 'recon', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.scope.mode, 'component');
  assert.equal(res.inspected.length, 1);
  assert.ok(!existsSync(path.join(out, 'recon', 'route-inventory.json')), 'no crawl for a component');
});
