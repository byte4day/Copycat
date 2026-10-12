import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectScope, normaliseMode } from '../../src/core/scope.mjs';

const cases = [
  ['Copycat https://example.com', 'single-page', null],
  ["Copycat this website's navbar https://example.com", 'component', 'navbar'],
  ['Copycat the entire dashboard', 'full-site', null],
  ['Copycat this pricing page https://example.com/pricing', 'single-page', null],
  ['Copycat this onboarding experience https://app.example.com/welcome', 'user-flow', null],
  ['Copycat this component from my screenshot ./shot.png', 'screenshot', null],
  ['Copycat this design but make it responsive https://example.com', 'single-page', null],
  ['Copycat only the sidebar and its interactions https://example.com/app', 'component', 'sidebar'],
  ['Inspect only, give me a blueprint of https://example.com — no code changes', 'audit-only', null],
  ['Compare my local build against https://example.com and fix the differences', 'compare', null],
  ['Extract the design tokens and typography scale from https://example.com', 'design-system', null],
  ['Copycat the whole website https://example.com', 'full-site', null],
];

for (const [request, mode, component] of cases) {
  test(`scope: ${request}`, () => {
    const s = detectScope(request);
    assert.equal(s.mode, mode);
    if (component) assert.equal(s.component, component);
  });
}

test('component requests do not expand into a site crawl', () => {
  const s = detectScope('Copycat the footer from https://example.com');
  assert.equal(s.mode, 'component');
  assert.equal(s.maxPages, 1);
});

test('explicit flags override detection and are parsed', () => {
  const s = detectScope('Copycat https://example.com/pricing --mode single-page --viewport desktop,mobile --max-pages 3 --framework vue --target src/pages/Pricing.vue');
  assert.equal(s.mode, 'single-page');
  assert.deepEqual(s.viewports, ['desktop', 'mobile']);
  assert.equal(s.maxPages, 3);
  assert.equal(s.framework, 'vue');
  assert.equal(s.target, 'src/pages/Pricing.vue');
  assert.deepEqual(s.urls, ['https://example.com/pricing']);
});

test('--inspect-only and unknown modes', () => {
  assert.equal(detectScope('Copycat https://x.dev --inspect-only').mode, 'audit-only');
  const s = detectScope('Copycat https://x.dev --mode banana');
  assert.equal(s.mode, 'single-page');
  assert.match(s.warnings[0], /Unknown --mode/);
  assert.equal(normaliseMode('FULL_SITE'), 'full-site');
  assert.equal(normaliseMode('nope'), null);
});

test('responsive requests add tablet', () => {
  assert.deepEqual(detectScope('Copycat https://x.dev and make it responsive').viewports, ['desktop', 'tablet', 'mobile']);
});
