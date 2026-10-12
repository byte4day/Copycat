import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openRun } from '../../src/core/run.mjs';
import { buildReport, summariseObserved } from '../../src/reporting/report.mjs';
import { tmpdir } from '../helpers/cli.mjs';

test('empty run produces an honest report with no invented results', async () => {
  const run = await openRun({ out: tmpdir('rep'), run: 'empty' });
  const md = await buildReport(run);
  assert.match(md, /No live reference was inspected/);
  assert.match(md, /No comparison was run\. Fidelity is unverified\./);
  assert.doesNotMatch(md, /\d+(\.\d+)?% (fidelity|similar)/i);
});

test('report includes measured comparisons, flows, notes and redacts JSON', async () => {
  const run = await openRun({ out: tmpdir('rep'), run: 'full' });
  await run.writeJson('scope.json', { mode: 'component', component: 'navbar', request: 'copycat the navbar', urls: ['https://x.dev'], viewports: ['desktop'], reasons: { mode: 'named component' } });
  await run.writeJson('compare.json', { note: 'n', iterations: [{ iteration: 1, maxMismatch: 0.01, passed: false, results: [{ viewport: { name: 'desktop' }, pixel: { mismatchRatio: 0.0234, diffPixels: 10, unstablePixels: 2, sizes: { reference: { width: 1, height: 1 }, local: { width: 1, height: 1 } } }, files: { diff: 'compare/iter-1/diff.desktop.png' }, issues: [{ category: 'structure', viewport: 'desktop', summary: 'Missing button "Buy"' }] }] }] });
  await run.writeJson('flows.json', [{ flow: 'local', viewport: 'desktop', step: 1, action: 'click', selector: '#a', ok: true, observed: { shownCount: 2, attributes: [] } }]);
  await run.writeText('implementation-notes.md', '### Simulated\n- Mock invoices in src/mock.ts');
  await run.writeJson('secret-test.json', { email: 'ceo@corp.io', cookie: 'abc' });
  const md = await buildReport(run);
  assert.match(md, /Mode: \*\*component\*\* \(component: navbar\)/);
  assert.match(md, /\| 1 \| desktop \| 2\.34% \|/);
  assert.match(md, /exceeds --max-mismatch 0\.01/);
  assert.match(md, /\[structure\] \(desktop\) Missing button "Buy"/);
  assert.match(md, /shows 2 element\(s\)/);
  assert.match(md, /Mock invoices in src\/mock\.ts/);
  const raw = readFileSync(run.path('secret-test.json'), 'utf8');
  assert.ok(!raw.includes('ceo@corp.io') && !raw.includes('"abc"'), raw);
});

test('summariseObserved describes changes in words', () => {
  assert.equal(summariseObserved({ attributes: [] }), 'no visible change');
  assert.match(summariseObserved({ dialogOpened: true, attributes: [{ attr: 'x@aria-expanded', from: 'false', to: 'true' }] }), /opens dialog; aria-expanded: false→true/);
});
