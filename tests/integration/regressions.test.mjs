// Regression and feature tests for 0.4.0, run against real Chromium and the fixture sites.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { serve } from '../helpers/server.mjs';
import { run, tmpdir, REPO } from '../helpers/cli.mjs';

const REBUILD = path.join(REPO, 'tests/workspace/pricing-rebuild');
const MODERN = path.join(REPO, 'tests/fixtures/modern');

/** @type {Awaited<ReturnType<typeof serve>>} */
let site;
/** @type {Awaited<ReturnType<typeof serve>>} */
let alias;
const out = tmpdir('regress');
before(async () => {
  site = await serve(path.join(REPO, 'tests/fixtures/site'));
  alias = await serve(tmpdir('alias-root')); // a second origin that only redirects
});
after(async () => { await site.close(); await alias.close(); });

const cc = (/** @type {string[]} */ args) => run('bin/copycat.mjs', [...args, '--out', out]);
const json = (/** @type {string} */ id, /** @type {string} */ f) => JSON.parse(readFileSync(path.join(out, id, f), 'utf8'));
const has = (/** @type {string} */ id, /** @type {string} */ f) => existsSync(path.join(out, id, f));
const noStack = (/** @type {string} */ stderr) => assert.doesNotMatch(stderr, /unexpected error|\n\s+at /, stderr);

test('a later inspect in the same run keeps the first scope\'s tokens and writes its own files', async () => {
  assert.equal((await cc(['inspect', `${site.url}/index.html`, '--viewport', 'desktop,mobile', '--run', 'multi'])).code, 0);
  const first = json('multi', 'design-tokens.json');
  const second = await cc(['inspect', `${site.url}/pricing.html`, '--viewport', 'desktop', '--run', 'multi', '--json']);
  assert.equal(second.code, 0, second.stderr);
  const res = JSON.parse(second.stdout);
  assert.equal(res.files.tokens, 'inspection/pricing-html.tokens.json');
  assert.deepEqual(json('multi', 'design-tokens.json').source, first.source, 'top-level tokens still describe the first page');
  assert.match(json('multi', 'design-tokens.json').source.url, /index\.html$/);
  assert.deepEqual(Object.keys(json('multi', 'responsive.json').viewports), ['desktop', 'mobile'], 'the first page\'s mobile data was not dropped');
  assert.match(json('multi', 'inspection/pricing-html.tokens.json').source.url, /pricing\.html$/);
  assert.ok(json('multi', 'inspection/pricing-html.inventory.json').headings.some((/** @type {any} */ h) => h.text === 'Pricing'));
  assert.match(readFileSync(path.join(out, 'multi', 'report.md'), 'utf8'), /Other inspected scopes[\s\S]*inspection\/pricing-html\.tokens\.json/);
});

test('a component scope on the same route does not overwrite the page\'s DOM or screenshot', async () => {
  const r = await cc(['inspect', `${site.url}/index.html`, '--selector', 'header.site-header', '--viewport', 'desktop', '--run', 'multi', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.route, 'index-html--header-site-header');
  const pageDom = json('multi', 'inspection/index-html.desktop.dom.json');
  assert.ok(pageDom.nodes.some((/** @type {any} */ n) => n.tag === 'article'), 'the page DOM is still the whole page');
  assert.equal(json('multi', 'inspection/index-html--header-site-header.desktop.dom.json').nodes[0].tag, 'header');
  const pagePng = PNG.sync.read(readFileSync(path.join(out, 'multi', 'reference/index-html.desktop.png')));
  const compPng = PNG.sync.read(readFileSync(path.join(out, 'multi', 'reference/index-html--header-site-header.desktop.component.png')));
  assert.ok(pagePng.height > compPng.height * 3, 'page and component screenshots are separate files');
});

test('inspecting the same scope again replaces its rows instead of duplicating them', async () => {
  const before = json('multi', 'screenshots.json').length;
  assert.equal((await cc(['inspect', `${site.url}/pricing.html`, '--viewport', 'desktop', '--run', 'multi'])).code, 0);
  const shots = json('multi', 'screenshots.json');
  assert.equal(shots.length, before);
  assert.equal(new Set(shots.map((/** @type {any} */ s) => s.file)).size, shots.length, 'one row per screenshot file');
});

test('inspect writes an accessibility outline per viewport', async () => {
  const outline = readFileSync(path.join(out, 'multi', 'inspection/pricing-html.desktop.aria.yml'), 'utf8');
  assert.match(outline, /^# Accessibility outline of .*Untrusted page text/);
  assert.match(outline, /- heading "Pricing" \[level=1\]/);
  assert.match(outline, /- tab "Monthly" \[selected\]/);
  assert.ok(outline.length < readFileSync(path.join(out, 'multi', 'inspection/pricing-html.desktop.dom.json'), 'utf8').length / 5, 'much smaller than the DOM dump');
  const home = readFileSync(path.join(out, 'multi', 'inspection/index-html.desktop.aria.yml'), 'utf8');
  assert.ok(!home.includes('help@northwind.example'), 'outline text is redacted');
});

test('non-PNG image references and out-of-range gates are refused before anything runs', async () => {
  const jpg = path.join(out, 'design.jpg');
  writeFileSync(jpg, 'not really a jpeg');
  const a = await cc(['compare', '--reference', jpg, '--local', `${site.url}/`, '--run', 'refuse']);
  assert.equal(a.code, 2, a.stdout + a.stderr);
  assert.match(a.stderr, /must be PNG/);
  const b = await cc(['compare', '--reference', `${site.url}/`, '--local', `${site.url}/`, '--max-mismatch', '5', '--run', 'refuse']);
  assert.equal(b.code, 2);
  assert.match(b.stderr, /ratio between 0 and 1[\s\S]*--max-mismatch 0\.05/);
  const c = await cc(['inspect', `${site.url}/`, '--timeout', '-5', '--run', 'refuse']);
  assert.equal(c.code, 2);
  assert.match(c.stderr, /--timeout must be a positive/);
  const d = await cc(['recon', jpg, '--run', 'refuse']);
  assert.equal(d.code, 2);
  assert.match(d.stderr, /needs a live page/);
  const e = await cc(['compare', '--reference', path.join(out, 'missing.png'), '--local', `${site.url}/`, '--run', 'refuse']);
  assert.equal(e.code, 2);
  assert.match(e.stderr, /Cannot read image/);
  const f = await cc(['inspect', `${site.url}/`, '--viewport', 'huge', '--run', 'refuse']);
  assert.equal(f.code, 2);
  assert.ok(!has('refuse', ''), 'no run folder was created for any refused command');
});

test('usage mistakes exit 2 with a message, never a stack trace', async () => {
  const badId = await cc(['inspect', `${site.url}/`, '--run', '../escape']);
  assert.equal(badId.code, 2, badId.stderr);
  assert.match(badId.stderr, /Invalid run id/);
  noStack(badId.stderr);
  const noSteps = await cc(['flow', `${site.url}/`, '--steps', path.join(out, 'nope.json'), '--run', 'nosteps']);
  assert.equal(noSteps.code, 2, noSteps.stderr);
  assert.match(noSteps.stderr, /Cannot read steps file/);
  noStack(noSteps.stderr);
  const bad = path.join(out, 'bad.json');
  writeFileSync(bad, '{bad');
  const badJson = await cc(['flow', `${site.url}/`, '--steps', bad, '--run', 'nosteps']);
  assert.equal(badJson.code, 2);
  assert.match(badJson.stderr, /not valid JSON/);
  noStack(badJson.stderr);
  assert.ok(!has('nosteps', ''), 'a bad steps file leaves no empty run behind');
  const ok = path.join(out, 'esc.json');
  writeFileSync(ok, JSON.stringify([{ action: 'press', key: 'Escape' }]));
  const label = await cc(['flow', `${site.url}/`, '--steps', ok, '--label', '../../outside', '--run', 'label']);
  assert.equal(label.code, 2);
  assert.match(label.stderr, /Invalid --label/);
  assert.ok(!has('label', ''), 'a bad label leaves no empty run behind');
});

test('report refuses a run that does not exist and defaults to the latest run', async () => {
  const missing = await cc(['report', '--run', 'never-made']);
  assert.equal(missing.code, 2, missing.stdout);
  assert.match(missing.stderr, /Run "never-made" not found[\s\S]*Existing runs/);
  assert.ok(!has('never-made', ''), 'report did not create an empty run');
  const latest = await cc(['report', '--json']);
  assert.equal(latest.code, 0, latest.stderr);
  assert.equal(JSON.parse(latest.stdout).run, 'multi', 'the run updated last, although "refuse"-style names sort after it');
});

test('pressing Enter in a form field counts as a submit on live-site rules', async () => {
  const steps = path.join(out, 'enter.json');
  writeFileSync(steps, JSON.stringify([{ action: 'focus', selector: '#name' }, { action: 'press', key: 'Enter' }]));
  const r = await cc(['flow', `${site.url}/signup.html`, '--steps', steps, '--run', 'enter', '--strict']);
  assert.equal(r.code, 6, r.stdout + r.stderr);
  assert.match(r.stderr, /Refusing to trigger/);
  const withSelector = path.join(out, 'enter-sel.json');
  writeFileSync(withSelector, JSON.stringify([{ action: 'press', selector: '#email', key: 'Enter' }]));
  assert.equal((await cc(['flow', `${site.url}/signup.html`, '--steps', withSelector, '--run', 'enter2', '--strict'])).code, 6);
  // Keys that do not activate anything stay allowed, and local references keep working.
  const esc = path.join(out, 'esc2.json');
  writeFileSync(esc, JSON.stringify([{ action: 'focus', selector: '#name' }, { action: 'press', key: 'Escape' }]));
  assert.equal((await cc(['flow', `${site.url}/signup.html`, '--steps', esc, '--run', 'enter3', '--strict'])).code, 0);
  assert.equal((await cc(['flow', `${site.url}/signup.html`, '--steps', steps, '--run', 'enter4'])).code, 0);
});

test('running a flow again replaces its earlier results', async () => {
  const steps = path.join(out, 'tabs.json');
  writeFileSync(steps, JSON.stringify([{ action: 'click', selector: '[role=tab][data-period=yearly]', name: 'yearly' }]));
  for (let i = 0; i < 2; i++) assert.equal((await cc(['flow', `${site.url}/pricing.html`, '--steps', steps, '--label', 'reference', '--run', 'rerun'])).code, 0);
  assert.equal((await cc(['flow', `${site.url}/pricing.html`, '--steps', steps, '--label', 'other', '--run', 'rerun'])).code, 0);
  const flows = json('rerun', 'flows.json');
  assert.deepEqual(flows.map((/** @type {any} */ f) => f.flow), ['reference', 'other']);
});

test('a wait step can outlast the old 5 s guard window', async () => {
  const steps = path.join(out, 'late.json');
  writeFileSync(steps, JSON.stringify([{ action: 'wait', selector: '#late' }]));
  const r = await cc(['flow', path.join(MODERN, 'late.html'), '--steps', steps, '--run', 'late']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(json('late', 'flows.json')[0].ok, true);
});

test('modern colour syntaxes (oklch, color-mix) reach the palette as hex', async () => {
  const r = await cc(['inspect', path.join(MODERN, 'index.html'), '--viewport', 'desktop', '--interactions', '--run', 'modern']);
  assert.equal(r.code, 0, r.stderr);
  const tokens = json('modern', 'design-tokens.json');
  const hexes = tokens.palette.map((/** @type {any} */ c) => c.hex);
  assert.ok(hexes.length >= 4, `palette is not empty: ${hexes}`);
  assert.ok(hexes.includes('#cccccc'), 'color-mix(in srgb, #000 20%, #fff) → #cccccc');
  assert.ok(hexes.every((/** @type {string} */ h) => /^#[0-9a-f]{6,8}$/.test(h)));
  assert.match(tokens.page.background, /^rgb\(25\d, 25\d, 25\d\)$/, 'oklch(0.985 0 0) page background');
  const dom = json('modern', 'inspection/modern-index-html.desktop.dom.json');
  const styled = dom.nodes.filter((/** @type {any} */ n) => n.styles?.color || n.styles?.backgroundColor);
  assert.ok(styled.length > 0 && styled.every((/** @type {any} */ n) => !/oklch|color\(/.test(`${n.styles.color} ${n.styles.backgroundColor}`)), 'node styles are rgb too, so compare is like-for-like');
});

test('same-named triggers keep separate state screenshots', () => {
  const m = json('modern', 'interaction-matrix.json').filter((/** @type {any} */ x) => x.name === 'Details');
  assert.equal(m.length, 2);
  assert.ok(m.every((/** @type {any} */ x) => x.observed.shownCount > 0));
  assert.notEqual(m[0].screenshot, m[1].screenshot);
  for (const x of m) assert.ok(has('modern', x.screenshot), x.screenshot);
});

test('--color-scheme dark renders the dark theme into its own artifacts', async () => {
  const r = await cc(['inspect', path.join(MODERN, 'index.html'), '--viewport', 'desktop', '--color-scheme', 'dark', '--run', 'modern', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.route, 'modern-index-html--dark');
  const dark = json('modern', res.files.tokens);
  const [lr] = json('modern', 'design-tokens.json').page.background.match(/\d+/g).map(Number);
  const [dr] = dark.page.background.match(/\d+/g).map(Number);
  assert.ok(lr > 240 && dr < 60, `light ${lr} vs dark ${dr}`);
  assert.equal(json('modern', 'screenshots.json').at(-1).colorScheme, 'dark');
  assert.equal((await cc(['inspect', path.join(MODERN, 'index.html'), '--color-scheme', 'sepia', '--run', 'modern'])).code, 2);
});

test('tokens exports CSS variables and a Tailwind theme from a run', async () => {
  const r = await cc(['tokens', '--run', 'multi', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.files, { css: 'tokens.css', json: 'tokens.named.json' });
  const css = readFileSync(path.join(out, 'multi', 'tokens.css'), 'utf8');
  const textColours = [...css.matchAll(/--cc-text(?:-2)?: (#[0-9a-f]{6});/g)].map((m) => m[1]).sort();
  assert.deepEqual(textColours, ['#1f2933', '#5f6b7a'], css);
  assert.match(css, /--cc-size-\d: 44px;/);
  assert.match(css, /--cc-accent: #0f6e5c;/);
  assert.match(css, /--cc-radius-1: 6px;/);
  const tw = await cc(['tokens', '--run', 'multi', '--format', 'tailwind', '--from', 'inspection/pricing-html.tokens.json']);
  assert.equal(tw.code, 0, tw.stderr);
  assert.match(readFileSync(path.join(out, 'multi', 'inspection/pricing-html.export.tailwind.css'), 'utf8'), /@theme \{[\s\S]*--color-text: #/);
  assert.equal((await cc(['tokens', '--run', 'multi', '--from', '../../etc/passwd'])).code, 2);
  assert.equal((await cc(['tokens', '--run', 'multi', '--format', 'scss'])).code, 2);
  assert.match(readFileSync(path.join(out, 'multi', 'report.md'), 'utf8'), /Named export: \[tokens\.css\]/);
});

test('crop mode still masks nondeterministic pixels and reports them', async () => {
  const r = await cc(['compare', '--reference', path.join(MODERN, 'index.html'), '--local', `${site.url}/index.html`, '--size-mode', 'crop', '--viewport', 'desktop', '--run', 'crop', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const px = JSON.parse(r.stdout).results[0].pixel;
  assert.equal(px.sizeMode, 'crop');
  assert.equal(px.stabilityCheck, true);
  assert.ok(px.sizeMismatch, 'the two pages differ in size, so crop mode actually cropped');
  assert.ok(px.unstablePixels >= 120 * 120, `the random block is masked (${px.unstablePixels})`);
  assert.equal(px.comparedPixels + px.unstablePixels, px.width * px.height);
});

test('compare writes zoomed crops of the worst regions', async () => {
  const work = tmpdir('crops');
  cpSync(REBUILD, work, { recursive: true });
  const html = path.join(work, 'index.html');
  writeFileSync(html, readFileSync(html, 'utf8').replace('<li>Audit trail</li>', ''));
  const r = await cc(['compare', '--reference', `${site.url}/pricing.html`, '--local', html, '--viewport', 'desktop', '--run', 'crops', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout).results[0];
  const cropped = res.regions.filter((/** @type {any} */ g) => g.crop);
  assert.ok(cropped.length >= 1 && cropped.length <= 3, `${cropped.length} crops`);
  for (const g of cropped) {
    const png = PNG.sync.read(readFileSync(path.join(out, 'crops', g.crop)));
    assert.ok(png.width <= 3 * 1600 + 16 && png.height <= 1200, `${png.width}×${png.height}`);
    assert.ok(png.height < res.pixel.height, 'a crop, not the full page');
  }
  assert.ok(res.issues.some((/** @type {any} */ i) => /zoom: compare\/iter-1\/region-1\.desktop\.png/.test(i.summary)));
  assert.match(readFileSync(path.join(out, 'crops', 'report.md'), 'utf8'), /Zoomed crops of the largest differing regions/);
});

test('compare --steps measures a state: the open dialog matches on both sides', async () => {
  const ref = path.join(out, 'dialog-ref.json');
  const loc = path.join(out, 'dialog-local.json');
  writeFileSync(ref, JSON.stringify([{ action: 'click', selector: '[data-open-modal]' }]));
  writeFileSync(loc, JSON.stringify([{ action: 'click', selector: '[data-dialog-open]' }]));
  const args = ['compare', '--reference', `${site.url}/pricing.html`, '--local', path.join(REBUILD, 'index.html'), '--viewport', 'desktop', '--no-full-page', '--json'];
  const open = await cc([...args, '--steps', ref, '--local-steps', loc, '--run', 'state']);
  assert.equal(open.code, 0, open.stderr);
  const res = JSON.parse(open.stdout);
  assert.deepEqual(res.state, { referenceSteps: 1, localSteps: 1 });
  assert.ok(res.results[0].pixel.mismatchRatio < 0.01, `dialog state mismatch ${res.results[0].pixel.mismatchRatio}`);
  // Proof that the steps ran: the default state differs from the dialog state.
  const closed = await cc([...args, '--run', 'state-default']);
  const refOpen = readFileSync(path.join(out, 'state', 'compare/iter-1/reference.desktop.png'));
  const refClosed = readFileSync(path.join(out, 'state-default', 'compare/iter-1/reference.desktop.png'));
  assert.equal(closed.code, 0);
  assert.ok(!refOpen.equals(refClosed), 'the reference was captured with the dialog open');
  assert.match(readFileSync(path.join(out, 'state', 'report.md'), 'utf8'), /Compared after scripted steps \(1 on the reference, 1 on the local build\)/);
  // A step that cannot run fails the compare instead of silently comparing the wrong state.
  const broken = path.join(out, 'dialog-broken.json');
  writeFileSync(broken, JSON.stringify([{ action: 'click', selector: '#no-such-trigger' }]));
  const fail = await cc([...args, '--steps', broken, '--run', 'state-broken', '--timeout', '3000']);
  assert.notEqual(fail.code, 0);
  assert.match(fail.stderr, /Step 1 \(click #no-such-trigger\)/);
  const orphan = await cc([...args, '--local-steps', loc, '--run', 'state-orphan']);
  assert.equal(orphan.code, 2);
});

test('crawl follows the start URL\'s redirect to the canonical origin and obeys that origin\'s robots.txt', async () => {
  const r = await cc(['crawl', `${alias.url}/__goto?u=${encodeURIComponent(`${site.url}/`)}`, '--max-pages', '10', '--delay', '0', '--run', 'redirect', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const inv = JSON.parse(r.stdout);
  assert.equal(inv.redirectedTo, site.url);
  assert.deepEqual(inv.routes.map((/** @type {any} */ x) => x.path).sort(), ['/', '/dashboard.html', '/pricing.html', '/signup.html']);
  assert.ok(inv.routes.every((/** @type {any} */ x) => x.url.startsWith(site.url)), 'no page of the redirecting origin is listed');
  assert.equal(inv.robots, 'respected');
  assert.ok(inv.skipped.some((/** @type {any} */ s) => /private\/secret\.html/.test(s.url) && /robots/.test(s.reason)));
  assert.equal(new Set(inv.unvisited).size, inv.unvisited.length, 'unvisited list has no duplicates');
});

test('full-site recon keeps the start page as the run\'s primary scope', async () => {
  const r = await run('bin/copycat.mjs', ['recon', `copycat the entire site ${site.url}/`, '--max-pages', '3', '--viewport', 'desktop,mobile', '--no-interactions', '--out', out, '--run', 'site2', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).inspected.length, 3);
  assert.deepEqual(Object.keys(json('site2', 'responsive.json').viewports), ['desktop', 'mobile'], 'not replaced by the last crawled route');
  const perRoute = readdirSync(path.join(out, 'site2', 'inspection')).filter((f) => f.endsWith('.tokens.json'));
  assert.equal(perRoute.length, 2, `the two later routes have their own token files: ${perRoute}`);
});
