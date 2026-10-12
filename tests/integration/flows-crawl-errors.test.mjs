import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '../helpers/server.mjs';
import { run, tmpdir, REPO } from '../helpers/cli.mjs';

/** @type {Awaited<ReturnType<typeof serve>>} */
let site;
const out = tmpdir('flow');
before(async () => { site = await serve(path.join(REPO, 'tests/fixtures/site')); });
after(async () => { await site.close(); });
const cc = (/** @type {string[]} */ args, /** @type {Record<string,string>} */ env = {}) => run('bin/copycat.mjs', [...args, '--out', out], { env });

test('form validation flow records errors then success', async () => {
  const steps = path.join(out, 'signup-steps.json');
  writeFileSync(steps, JSON.stringify([
    { action: 'click', selector: '#signup-form button[type=submit]', name: 'submit empty' },
    { action: 'fill', selector: '#name', value: 'Test User' },
    { action: 'fill', selector: '#email', value: 'test.user@example.test' },
    { action: 'select', selector: '#team', value: '6–20' },
    { action: 'click', selector: '#signup-form button[type=submit]', name: 'submit valid' },
  ]));
  const r = await cc(['flow', `${site.url}/signup.html`, '--steps', steps, '--run', 'signup', '--viewport', 'desktop,mobile']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const flows = JSON.parse(readFileSync(path.join(out, 'signup', 'flows.json'), 'utf8'));
  assert.equal(flows.length, 10);
  const first = flows[0];
  assert.ok(first.observed.liveText.some((/** @type {string} */ t) => /Enter your full name/.test(t)));
  assert.equal(first.observed.attributes.filter((/** @type {any} */ a) => a.to === 'true').length, 3);
  const last = flows[4];
  assert.ok(last.observed.hiddenCount > 0 && last.observed.shownCount > 0, 'form hidden, success shown');
  assert.ok(!readFileSync(path.join(out, 'signup', 'flows.json'), 'utf8').includes('test.user@example.test'), 'typed values are not persisted');
});

test('strict mode refuses submits on references treated as live sites', async () => {
  const steps = path.join(out, 'strict.json');
  writeFileSync(steps, JSON.stringify([{ action: 'click', selector: '#signup-form button[type=submit]' }]));
  const r = await cc(['flow', `${site.url}/signup.html`, '--steps', steps, '--run', 'strict', '--strict']);
  assert.equal(r.code, 6, r.stdout + r.stderr);
  assert.match(r.stderr, /Refusing to trigger/);
});

test('crawl respects robots.txt, de-duplicates and honours the page budget', async () => {
  const r = await cc(['crawl', `${site.url}/`, '--max-pages', '10', '--delay', '20', '--run', 'crawl', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const inv = JSON.parse(r.stdout);
  const paths = inv.routes.map((/** @type {any} */ x) => x.path);
  assert.deepEqual([...paths].sort(), ['/', '/dashboard.html', '/pricing.html', '/signup.html']);
  assert.ok(inv.skipped.some((/** @type {any} */ s) => /private\/secret\.html/.test(s.url) && /robots/.test(s.reason)));
  assert.equal(inv.robots, 'respected');
  const small = JSON.parse((await cc(['crawl', `${site.url}/`, '--max-pages', '2', '--delay', '0', '--run', 'crawl2', '--json'])).stdout);
  assert.equal(small.routes.length, 2);
});

test('full-site recon crawls then inspects each route', async () => {
  const r = await run('bin/copycat.mjs', ['recon', `copycat the entire site ${site.url}/`, '--max-pages', '3', '--viewport', 'desktop', '--no-interactions', '--out', out, '--run', 'site', '--json'], {});
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.scope.mode, 'full-site');
  assert.equal(res.inspected.length, 3);
  const report = readFileSync(path.join(out, 'site', 'report.md'), 'utf8');
  assert.match(report, /Route discovery from/);
});

test('invalid URL → exit 2', async () => {
  const r = await cc(['inspect', 'not a url']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Invalid URL/);
});

test('unavailable site → exit 3', async () => {
  const net = await import('node:net');
  const port = await new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const p = /** @type {import('node:net').AddressInfo} */ (srv.address()).port;
      srv.close(() => resolve(p));
    });
  });
  const r = await cc(['inspect', `http://127.0.0.1:${port}/`, '--timeout', '5000']);
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /unavailable/i);
});

test('HTTP 404 → exit 3, HTTP 403 → exit 6 (no bypass)', async () => {
  assert.equal((await cc(['inspect', `${site.url}/__status/404`])).code, 3);
  const r = await cc(['inspect', `${site.url}/__status/403`]);
  assert.equal(r.code, 6);
  assert.match(r.stderr, /does not bypass authentication/);
});

test('timeout → exit 4', async () => {
  const r = await cc(['inspect', `${site.url}/__hang`, '--timeout', '1500']);
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /Timed out/);
});

test('missing selector → exit 2', async () => {
  const r = await cc(['inspect', `${site.url}/index.html`, '--selector', '#does-not-exist']);
  assert.equal(r.code, 2, r.stderr);
});

test('missing browser → exit 5 with install hint', async () => {
  const r = await cc(['inspect', `${site.url}/index.html`], { COPYCAT_CHROMIUM_PATH: '/nonexistent/chrome' });
  assert.equal(r.code, 5, r.stderr);
  assert.match(r.stderr, /playwright install chromium/);
  const d = await cc(['doctor'], { COPYCAT_CHROMIUM_PATH: '/nonexistent/chrome' });
  assert.equal(d.code, 5);
});
