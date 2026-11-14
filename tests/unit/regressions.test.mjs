// Regression tests for 0.4.0 fixes that can be checked without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir, REPO } from '../helpers/cli.mjs';
import { openRun, listRunIds } from '../../src/core/run.mjs';
import { CopycatError, EXIT } from '../../src/core/errors.mjs';
import { crawlable } from '../../src/inspection/crawl.mjs';
import { cropRect } from '../../src/comparison/image.mjs';
import { artifactName, routeBase } from '../../src/inspection/inspect.mjs';
import { validateSteps, loadSteps } from '../../src/inspection/interact.mjs';
import { buildTokenExport, renderTokens } from '../../src/reporting/tokens.mjs';
import { parseColorScheme, USER_AGENT_SUFFIX } from '../../src/browser/launch.mjs';
import { VERSION } from '../../src/core/version.mjs';

test('an invalid run id is a usage error, not a crash', async () => {
  for (const id of ['../x', 'a/b', '..', 'has space']) {
    await assert.rejects(openRun({ out: tmpdir('runid'), run: id }), (e) => e instanceof CopycatError && e.exitCode === EXIT.USAGE, id);
  }
});

test('mustExist refuses to create a run and names the ones that exist', async () => {
  const out = tmpdir('must');
  await openRun({ out, run: 'real' });
  await assert.rejects(openRun({ out, run: 'typo', mustExist: true }), (e) => e instanceof CopycatError && e.exitCode === EXIT.USAGE && /real/.test(e.hint));
  assert.ok(!existsSync(path.join(out, 'typo')), 'no folder was created for the missing run');
});

test('the latest run is the most recently updated one, not the last by name', async () => {
  const out = tmpdir('latest');
  for (const id of ['zzz-old', 'aaa-new']) {
    const run = await openRun({ out, run: id });
    await run.record({ type: 'plan' });
  }
  const old = new Date(Date.now() - 3600_000);
  utimesSync(path.join(out, 'zzz-old', 'run.json'), old, old);
  assert.deepEqual(listRunIds(out), ['aaa-new', 'zzz-old']);
  assert.deepEqual(listRunIds(path.join(out, 'missing')), []);
});

test('sitemap entries pass the same filter as links', () => {
  const start = new URL('https://shop.example/');
  assert.equal(crawlable(new URL('https://shop.example/pricing'), start), true);
  for (const u of ['https://shop.example/sitemap-products.xml', 'https://shop.example/brochure.pdf', 'https://shop.example/account/logout', 'https://shop.example/cart/add/3', 'https://other.example/pricing']) {
    assert.equal(crawlable(new URL(u), start), false, u);
  }
});

test('cropRect cuts a clamped rectangle', () => {
  const img = { width: 10, height: 6, data: Buffer.alloc(10 * 6 * 4) };
  for (let i = 0; i < 60; i++) img.data.set([i, 0, 0, 255], i * 4);
  const c = cropRect(img, { x: 7, y: 4, w: 20, h: 20 });
  assert.deepEqual([c.width, c.height], [3, 2]);
  assert.equal(c.data[0], 4 * 10 + 7, 'top-left pixel comes from (7,4)');
  const neg = cropRect(img, { x: -5, y: -5, w: 4, h: 4 });
  assert.deepEqual([neg.width, neg.height, neg.data[0]], [4, 4, 0]);
});

test('a second scope on a route gets its own artifact name; the same scope reuses its name', () => {
  /** @type {any[]} */
  const events = [];
  const page = { base: 'pricing-html', identity: 'http://x/pricing.html||light', hint: '' };
  assert.equal(artifactName(events, page), 'pricing-html');
  events.push({ type: 'inspect', route: 'pricing-html', identity: page.identity });
  assert.equal(artifactName(events, page), 'pricing-html', 're-inspecting the same scope overwrites its own files');
  const comp = { base: 'pricing-html', identity: 'http://x/pricing.html|.tabs|light', hint: '.tabs' };
  assert.equal(artifactName(events, comp), 'pricing-html--tabs');
  events.push({ type: 'inspect', route: 'pricing-html--tabs', identity: comp.identity });
  assert.equal(artifactName(events, { base: 'pricing-html', identity: 'http://x/pricing.html|#tabs|light', hint: '#tabs' }), 'pricing-html--tabs-2');
  assert.equal(artifactName(events, { base: 'pricing-html', identity: 'http://x/pricing.html||dark', hint: 'dark' }), 'pricing-html--dark');
  // Ledgers written before 0.4.0 have no identity field.
  assert.equal(artifactName([{ type: 'inspect', route: 'home', url: 'http://x/', selector: null }], { base: 'home', identity: 'http://x/|header|light', hint: 'header' }), 'home--header');
});

test('local files are named after their last two path segments', () => {
  assert.equal(routeBase(new URL('file:///home/someone/a/very/long/project/path/that/goes/on/dist/about.html')), 'dist-about-html');
  assert.notEqual(routeBase(new URL('file:///p/dist/about.html')), routeBase(new URL('file:///p/dist/index.html')));
  assert.equal(routeBase(new URL('https://x.dev/')), 'home');
  assert.equal(routeBase(new URL('https://x.dev/docs/intro')), 'docs-intro');
});

test('steps files fail with a usage error that names the file', async () => {
  const dir = tmpdir('steps');
  await assert.rejects(loadSteps(path.join(dir, 'nope.json')), (e) => e instanceof CopycatError && e.exitCode === EXIT.USAGE && /nope\.json/.test(e.message));
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, '{bad');
  await assert.rejects(loadSteps(bad), (e) => e instanceof CopycatError && e.exitCode === EXIT.USAGE && /not valid JSON/.test(e.message));
  const ok = path.join(dir, 'ok.json');
  writeFileSync(ok, JSON.stringify([{ action: 'press', key: 'Escape' }]));
  assert.equal((await loadSteps(ok)).length, 1);
  assert.throws(() => validateSteps([{ action: 'press' }]), /needs a key/);
});

test('token export names measured values and renders CSS and Tailwind v4', () => {
  const tokens = {
    source: { url: 'https://x.dev/', viewport: 'desktop', scope: null },
    palette: [
      { hex: '#1f2933', rgb: 'rgb(31, 41, 51)', roles: ['text'], weight: 120 },
      { hex: '#5f6b7a', rgb: 'rgb(95, 107, 122)', roles: ['text'], weight: 80 },
      { hex: '#ffffff', rgb: 'rgb(255, 255, 255)', roles: ['background'], weight: 40 },
      { hex: '#0f6e5c', rgb: 'rgb(15, 110, 92)', roles: ['background', 'border'], weight: 20 },
      { hex: '#d9dee5', rgb: 'rgb(217, 222, 229)', roles: ['border'], weight: 10 },
    ],
    colors: { text: [{ value: 'rgb(31, 41, 51)' }, { value: 'rgb(95, 107, 122)' }], background: [], border: [{ value: 'rgb(217, 222, 229)' }] },
    page: { background: 'rgb(255, 255, 255)' },
    typography: { families: [{ value: 'Georgia, serif' }], sizes: [{ value: '44px' }, { value: '16px' }, { value: '16px' }, { value: '1.2em' }], weights: [{ value: '700' }, { value: '400' }] },
    spacing: [{ value: '24px' }, { value: '8px' }], gaps: [{ value: '16px' }, { value: '8px' }],
    radii: [{ value: '6px' }, { value: '6px 6px 0px 0px' }], shadows: [{ value: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px' }], breakpoints: ['max:760', 'min:1024', 'min:760'],
  };
  const t = buildTokenExport(tokens);
  const named = Object.fromEntries(t.colors.map((c) => [c.name, c.value]));
  assert.deepEqual(named, { surface: '#ffffff', text: '#1f2933', 'text-2': '#5f6b7a', border: '#d9dee5', accent: '#0f6e5c' });
  assert.deepEqual(t.fontSizes.map((s) => s.value), ['16px', '44px'], 'unique px sizes, ascending');
  assert.deepEqual(t.spacing.map((s) => s.value), ['8px', '16px', '24px']);
  assert.deepEqual(t.radii.map((s) => s.value), ['6px', '6px 6px 0px 0px']);
  assert.deepEqual(t.breakpoints.map((s) => s.value), ['760px', '1024px']);
  const css = renderTokens(t, { prefix: 'brand' });
  assert.match(css, /^:root \{$/m);
  assert.match(css, /--brand-surface: #ffffff;/);
  assert.match(css, /--brand-size-2: 44px;/);
  for (const out of [css, renderTokens(t, { format: 'tailwind' })]) {
    const names = [...out.matchAll(/^\s+(--[\w-]+):/gm)].map((m) => m[1]);
    assert.equal(new Set(names).size, names.length, `no variable is declared twice: ${names}`);
  }
  assert.match(css, /measured by Copycat from https:\/\/x\.dev\//);
  const tw = renderTokens(t, { format: 'tailwind' });
  assert.match(tw, /^@theme \{$/m);
  assert.match(tw, /--color-accent: #0f6e5c;/);
  assert.match(tw, /--radius-r1: 6px;/);
  assert.match(tw, /--breakpoint-bp-1: 760px;/);
  assert.throws(() => renderTokens(t, { prefix: 'Bad Prefix' }), /Invalid --prefix/);
  assert.throws(() => buildTokenExport({ nope: true }), /Not a Copycat design-tokens file/);
});

test('colour scheme values are validated', () => {
  assert.equal(parseColorScheme(undefined), 'light');
  assert.equal(parseColorScheme('DARK'), 'dark');
  assert.throws(() => parseColorScheme('sepia'), (e) => e instanceof CopycatError && e.exitCode === EXIT.USAGE);
});

test('the user agent, the CLI and the skill all carry the package version', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  assert.equal(VERSION, pkg);
  assert.ok(USER_AGENT_SUFFIX.startsWith(`Copycat/${pkg.split('.').slice(0, 2).join('.')} `), USER_AGENT_SUFFIX);
  const skill = readFileSync(path.join(REPO, '.agents/skills/copycat/SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`version: ${pkg.replace(/\./g, '\\.')}\\n`));
  for (const f of ['.claude/agents/copycat.md', '.cursor/agents/copycat.md', 'agents/codex/copycat.toml']) {
    assert.ok(readFileSync(path.join(REPO, f), 'utf8').includes(`copycat:managed v${pkg}`), `${f} is stamped v${pkg}`);
  }
  const ref = readFileSync(path.join(REPO, '.agents/skills/copycat/references/browser-inspection.md'), 'utf8');
  assert.ok(!/Copycat\/0\.1 /.test(ref), 'the docs do not quote a stale user agent');
});

test('reinstalling an unchanged runtime with --skip-npm reports up-to-date', async () => {
  const { run } = await import('../helpers/cli.mjs');
  const h = tmpdir('skipnpm');
  mkdirSync(path.join(h, '.claude'));
  const args = ['--platform', 'claude', '--global', '--home', h, '--skip-npm', '--json'];
  assert.match(JSON.parse((await run('scripts/install.mjs', args)).stdout).runtime.action, /^install$/);
  const again = JSON.parse((await run('scripts/install.mjs', args)).stdout);
  assert.equal(again.runtime.action, 'up-to-date');
  assert.ok(again.steps.every((/** @type {any} */ s) => s.action === 'up-to-date'));
});
