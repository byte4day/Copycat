import { readFile } from 'node:fs/promises';
import { gotoStable, stableScreenshot, launchBrowser, newContext } from '../browser/launch.mjs';
import { parseViewports } from '../browser/viewports.mjs';
import { visibleState } from './extract.mjs';
import { CopycatError, EXIT } from '../core/errors.mjs';
import { redactUrl } from '../core/redact.mjs';
import { slug } from '../core/run.mjs';

/** Labels that must never be clicked automatically. */
export const UNSAFE_LABEL = /\b(delete|remove|destroy|erase|purchase|buy|pay|checkout|place order|subscribe|unsubscribe|confirm|send|submit|transfer|withdraw|sign ?out|log ?out|deactivate|cancel (my )?(account|subscription)|book now|donate)\b/i;

/** @param {URL} url */
export function isLocalUrl(url) {
  return url.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(url.hostname) || url.hostname.endsWith('.localhost');
}

/**
 * @param {ReturnType<typeof visibleState>} a
 * @param {ReturnType<typeof visibleState>} b
 */
export function diffState(a, b) {
  const shown = [];
  const hidden = [];
  for (const [k, v] of Object.entries(b.visible)) {
    if (a.visible[k] === false && v === true) shown.push(k);
    if (a.visible[k] === true && v === false) hidden.push(k);
  }
  const attrs = [];
  for (const k of new Set([...Object.keys(a.aria), ...Object.keys(b.aria)])) {
    if (a.aria[k] !== b.aria[k]) attrs.push({ attr: k, from: a.aria[k] ?? null, to: b.aria[k] ?? null });
  }
  return {
    urlChanged: a.url !== b.url ? { from: redactUrl(a.url), to: redactUrl(b.url) } : null,
    shown: shown.slice(0, 25),
    hidden: hidden.slice(0, 25),
    shownCount: shown.length,
    hiddenCount: hidden.length,
    attributes: attrs.slice(0, 30),
    dialogOpened: b.dialogs > a.dialogs,
    dialogClosed: b.dialogs < a.dialogs,
    focusMoved: a.focused !== b.focused ? b.focused : null,
    scrolled: a.scrollY !== b.scrollY ? b.scrollY - a.scrollY : 0,
    validationMessages: b.validationMessages.filter((/** @type {string} */ m) => !a.validationMessages.includes(m)),
    liveText: b.liveText.filter((/** @type {string} */ m) => !a.liveText.includes(m)),
    liveTextCleared: a.liveText.filter((/** @type {string} */ m) => !b.liveText.includes(m)).length,
  };
}

/** @param {ReturnType<typeof diffState>} d */
function changed(d) {
  return Boolean(d.urlChanged || d.shownCount || d.hiddenCount || d.attributes.length || d.dialogOpened || d.dialogClosed || d.scrolled || d.validationMessages.length || d.liveText.length);
}

/**
 * Click each safe interaction candidate once from a clean state and record
 * what visibly changed. Bounded; never submits forms or clicks destructive
 * or purchase-like controls.
 * @param {import('playwright').Page} page
 * @param {import('../core/run.mjs').Run} run
 * @param {{ url: URL, viewport: import('../browser/viewports.mjs').Viewport, candidates: any[], selector: string | null, max: number, route: string }} o
 */
export async function probeInteractions(page, run, o) {
  const results = [];
  const seen = new Set();
  let probes = 0;
  await run.ensureDir('states');
  for (const c of o.candidates) {
    if (probes >= o.max) break;
    if (seen.has(c.selector)) continue;
    seen.add(c.selector);
    const entry = { trigger: c.selector, name: c.name, kind: c.kind, viewport: o.viewport.name, route: o.route, action: o.viewport.hasTouch ? 'tap' : 'click', observed: /** @type {any} */ (null), screenshot: /** @type {string | null} */ (null), skipped: /** @type {string | null} */ (null), reset: /** @type {string | null} */ (null), source: 'auto-probe' };
    if (c.kind === 'submit') {
      entry.skipped = 'form submit — not triggered automatically';
      results.push(entry);
      continue;
    }
    if (UNSAFE_LABEL.test(c.name ?? '')) {
      entry.skipped = 'label looks destructive or transactional — not triggered automatically';
      results.push(entry);
      continue;
    }
    try {
      const loc = page.locator(c.selector).first();
      if (!(await loc.isVisible())) {
        entry.skipped = 'not visible in current state';
        results.push(entry);
        continue;
      }
      // Scroll first so the click's own scroll-into-view is not reported as an effect.
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      const before = await page.evaluate(visibleState, { selector: null });
      await loc.click({ timeout: 2000, noWaitAfter: true });
      probes++;
      await page.waitForTimeout(350);
      const after = await page.evaluate(visibleState, { selector: null });
      entry.observed = diffState(before, after);
      if (changed(entry.observed)) {
        const file = `states/${o.route}.${o.viewport.name}.${slug(c.name || c.selector).slice(0, 40)}.png`;
        await stableScreenshot(page, run.path(file), { fullPage: false });
        entry.screenshot = file;
      }
      // Reset: Escape first (menus/dialogs), then reload if still different.
      if (entry.observed.urlChanged) {
        await gotoStable(page, o.url.href, { scroll: false, settleMs: 100 });
        entry.reset = 'reload';
      } else if (changed(entry.observed)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        const esc = await page.evaluate(visibleState, { selector: null });
        const residual = diffState(before, esc);
        entry.closesWithEscape = !changed(residual);
        if (!entry.closesWithEscape) {
          await loc.click({ timeout: 1500, noWaitAfter: true }).catch(() => {});
          await page.waitForTimeout(250);
          const again = await page.evaluate(visibleState, { selector: null });
          entry.togglesOnSecondClick = !changed(diffState(before, again));
          if (!entry.togglesOnSecondClick) {
            await gotoStable(page, o.url.href, { scroll: false, settleMs: 100 });
            entry.reset = 'reload';
          } else entry.reset = 'second-click';
        } else entry.reset = 'escape';
      }
    } catch (e) {
      entry.skipped = `could not trigger: ${e instanceof Error ? e.message.split('\n')[0] : e}`;
      await gotoStable(page, o.url.href, { scroll: false, settleMs: 100 }).catch(() => {});
    }
    results.push(entry);
  }
  return results;
}

/**
 * @typedef {{ action: 'goto'|'click'|'tap'|'hover'|'focus'|'press'|'fill'|'select'|'check'|'uncheck'|'wait'|'screenshot'|'scroll', selector?: string, value?: string, key?: string, url?: string, ms?: number, name?: string, y?: number }} Step
 */

const ACTIONS = new Set(['goto', 'click', 'tap', 'hover', 'focus', 'press', 'fill', 'select', 'check', 'uncheck', 'wait', 'screenshot', 'scroll']);

/** @param {unknown} steps @returns {Step[]} */
export function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new CopycatError('Steps file must be a non-empty JSON array', EXIT.USAGE);
  if (steps.length > 100) throw new CopycatError('Steps file is limited to 100 steps', EXIT.USAGE);
  return steps.map((s, i) => {
    if (!s || typeof s !== 'object' || !ACTIONS.has(s.action)) throw new CopycatError(`Step ${i + 1}: unknown action "${s?.action}"`, EXIT.USAGE, `Allowed: ${[...ACTIONS].join(', ')}`);
    if (['click', 'tap', 'hover', 'focus', 'fill', 'select', 'check', 'uncheck'].includes(s.action) && !s.selector) throw new CopycatError(`Step ${i + 1}: "${s.action}" needs a selector`, EXIT.USAGE);
    if (s.action === 'press' && !s.key) throw new CopycatError(`Step ${i + 1}: "press" needs a key`, EXIT.USAGE);
    return s;
  });
}

/**
 * Run an explicit, user-authored interaction script and record each
 * transition. Used for USER_FLOW mode and for verifying a reconstruction.
 * @param {import('../core/run.mjs').Run} run
 * @param {{ url: URL, steps: Step[] | string, viewports?: string[], timeout?: number, allowSubmit?: boolean, label?: string, strict?: boolean }} o
 */
export async function runSteps(run, o) {
  const steps = validateSteps(typeof o.steps === 'string' ? JSON.parse(await readFile(o.steps, 'utf8')) : o.steps);
  // --strict applies live-site safety rules even to local references.
  const local = isLocalUrl(o.url) && !o.strict;
  const label = o.label ?? 'reference';
  const browser = await launchBrowser();
  const results = [];
  await run.ensureDir('flows');
  try {
    for (const vp of parseViewports(o.viewports ?? [])) {
      const context = await newContext(browser, vp);
      try {
        const page = await context.newPage();
        await gotoStable(page, o.url.href, { timeout: o.timeout });
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const rec = { flow: label, step: i + 1, viewport: vp.name, action: s.action, selector: s.selector ?? null, name: s.name ?? null, ok: false, observed: /** @type {any} */ (null), screenshot: /** @type {string | null} */ (null), error: /** @type {string | null} */ (null) };
          try {
            await guardStep(page, s, { local, allowSubmit: Boolean(o.allowSubmit) });
            if (s.selector && s.action !== 'wait') await page.locator(s.selector).first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
            const before = await page.evaluate(visibleState, { selector: null });
            await performStep(page, s, o.url, o.timeout ?? 15000);
            await page.waitForTimeout(s.action === 'wait' ? 0 : 300);
            const after = await page.evaluate(visibleState, { selector: null });
            rec.observed = diffState(before, after);
            if (s.action === 'screenshot' || changed(rec.observed)) {
              const file = `flows/${label}.${vp.name}.${String(i + 1).padStart(2, '0')}-${slug(s.name || s.action)}.png`;
              await stableScreenshot(page, run.path(file), { fullPage: s.action === 'screenshot' });
              rec.screenshot = file;
            }
            rec.ok = true;
          } catch (e) {
            rec.error = e instanceof Error ? e.message.split('\n')[0] : String(e);
            results.push(rec);
            if (e instanceof CopycatError && e.exitCode === EXIT.BLOCKED) throw e;
            break;
          }
          results.push(rec);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const prev = (await run.readJson('flows.json')) ?? [];
  await run.writeJson('flows.json', [...prev, ...results]);
  await run.record({ type: 'flow', label, url: redactUrl(o.url.href), steps: steps.length, completed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  return results;
}

/**
 * Safety checks before a scripted step touches the page.
 * @param {import('playwright').Page} page @param {Step} s @param {{ local: boolean, allowSubmit: boolean }} o
 */
async function guardStep(page, s, o) {
  if (!s.selector) return;
  const info = await page.locator(s.selector).first().evaluate((el) => ({
    type: (el.getAttribute('type') || '').toLowerCase(),
    autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
    name: (el.getAttribute('name') || '').toLowerCase(),
    label: (el.getAttribute('aria-label') || /** @type {HTMLElement} */ (el).innerText || '').trim().slice(0, 80),
    submit: Boolean(el.closest('form')) && (el.getAttribute('type') === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type'))),
  }), undefined, { timeout: 5000 }).catch(() => null);
  if (!info) throw new CopycatError(`Selector not found: ${s.selector}`, EXIT.USAGE);
  const sensitive = /password|cc-|card|cvc|cvv|iban|ssn|one-time-code/.test(`${info.type} ${info.autocomplete} ${info.name}`);
  if ((s.action === 'fill' || s.action === 'select') && sensitive && !o.local) {
    throw new CopycatError(`Refusing to fill sensitive field ${s.selector} on a non-local reference`, EXIT.BLOCKED, 'Copycat never enters credentials or payment data into third-party pages.');
  }
  if ((s.action === 'click' || s.action === 'tap' || s.action === 'press') && (info.submit || UNSAFE_LABEL.test(info.label)) && !o.local && !o.allowSubmit) {
    throw new CopycatError(`Refusing to trigger "${info.label || s.selector}" on a non-local reference`, EXIT.BLOCKED, 'Submitting forms or transactional actions on live sites requires --allow-submit and explicit authorisation.');
  }
}

/** @param {import('playwright').Page} page @param {Step} s @param {URL} base @param {number} timeout */
async function performStep(page, s, base, timeout) {
  const sel = /** @type {string} */ (s.selector);
  switch (s.action) {
    case 'goto': {
      const next = new URL(s.url ?? '/', base);
      if (next.origin !== base.origin) throw new CopycatError(`Flow left the reference origin: ${next.origin}`, EXIT.BLOCKED);
      await gotoStable(page, next.href, { timeout });
      return;
    }
    case 'click': return page.click(sel, { timeout });
    case 'tap': return page.tap(sel, { timeout });
    case 'hover': return page.hover(sel, { timeout });
    case 'focus': return page.focus(sel, { timeout });
    case 'press': return s.selector ? page.press(sel, /** @type {string} */ (s.key), { timeout }) : page.keyboard.press(/** @type {string} */ (s.key));
    case 'fill': return page.fill(sel, s.value ?? '', { timeout });
    case 'select': return void (await page.selectOption(sel, s.value ?? '', { timeout }));
    case 'check': return page.check(sel, { timeout });
    case 'uncheck': return page.uncheck(sel, { timeout });
    case 'wait': return s.selector ? void (await page.waitForSelector(sel, { timeout })) : page.waitForTimeout(Math.min(s.ms ?? 500, 10000));
    case 'scroll': return void (await page.evaluate((y) => window.scrollTo(0, y), s.y ?? 0));
    case 'screenshot': return;
    default: throw new CopycatError(`Unknown action ${s.action}`, EXIT.USAGE);
  }
}
