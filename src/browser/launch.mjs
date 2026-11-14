import { CopycatError, EXIT, browserMissing, classifyNavigationError } from '../core/errors.mjs';
import { USER_AGENT_TOKEN } from '../core/version.mjs';

/** @typedef {import('playwright').Browser} Browser */
/** @typedef {import('playwright').BrowserContext} BrowserContext */
/** @typedef {import('playwright').Page} Page */
/** @typedef {import('./viewports.mjs').Viewport} Viewport */

export const USER_AGENT_SUFFIX = USER_AGENT_TOKEN;

export const COLOR_SCHEMES = /** @type {const} */ (['light', 'dark']);

/**
 * Validate a --color-scheme value.
 * @param {string | undefined} v
 * @returns {'light' | 'dark'}
 */
export function parseColorScheme(v) {
  if (v === undefined || v === null || v === '') return 'light';
  const s = String(v).toLowerCase();
  if (s !== 'light' && s !== 'dark') throw new CopycatError(`--color-scheme must be light or dark, got "${v}"`, EXIT.USAGE);
  return s;
}

/** Default user agent per browser, read once instead of once per context. @type {WeakMap<Browser, Promise<string>>} */
const baseUserAgent = new WeakMap();

/** Lazy import so `copycat scope`/`--help` work without Playwright installed. */
export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    throw new CopycatError(
      `The "playwright" package is not installed (${e instanceof Error ? e.message.split('\n')[0] : e})`,
      EXIT.BROWSER_MISSING,
      'Run `npm install` in the Copycat runtime directory, then `npx playwright install chromium`.',
    );
  }
}

/**
 * Launch headless Chromium. Every run uses a fresh, isolated profile: no
 * cookies, storage or credentials from the user's real browser are read.
 * @param {{ headed?: boolean }} [opts]
 * @returns {Promise<Browser>}
 */
export async function launchBrowser(opts = {}) {
  const { chromium } = await loadPlaywright();
  try {
    return await chromium.launch({
      headless: !opts.headed,
      executablePath: process.env.COPYCAT_CHROMIUM_PATH || undefined,
    });
  } catch (e) {
    throw browserMissing(e instanceof Error ? e.message : String(e));
  }
}

/**
 * @param {Browser} browser
 * @param {Viewport} vp
 * @param {{ reducedMotion?: boolean, colorScheme?: 'light' | 'dark' }} [opts]
 * @returns {Promise<BrowserContext>}
 */
export async function newContext(browser, vp, opts = {}) {
  if (!baseUserAgent.has(browser)) {
    baseUserAgent.set(browser, (async () => {
      const probe = await browser.newContext();
      try {
        const p = await probe.newPage();
        return await p.evaluate(() => navigator.userAgent);
      } finally {
        await probe.close();
      }
    })());
  }
  const ua = await /** @type {Promise<string>} */ (baseUserAgent.get(browser));
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
    acceptDownloads: false,
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: opts.colorScheme ?? 'light',
  });
  await context.setExtraHTTPHeaders({ 'User-Agent': `${ua} ${USER_AGENT_SUFFIX}` });
  // Never let a reference page open popups or download files.
  context.on('page', (p) => {
    p.opener().then((op) => (op ? p.close() : undefined)).catch(() => {});
  });
  return context;
}

/**
 * Navigate and wait for a visually stable page: network quiet (bounded),
 * fonts loaded, lazy content triggered by scrolling, then back to top.
 * @param {Page} page
 * @param {string} url
 * @param {{ timeout?: number, waitFor?: string, scroll?: boolean, settleMs?: number }} [opts]
 */
export async function gotoStable(page, url, opts = {}) {
  const timeout = opts.timeout ?? 30000;
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout });
  } catch (e) {
    throw classifyNavigationError(e, url);
  }
  const status = response?.status() ?? null;
  if (status !== null && status >= 400) {
    throw new CopycatError(`Reference returned HTTP ${status}: ${url}`, status === 401 || status === 403 ? EXIT.BLOCKED : EXIT.UNAVAILABLE,
      status === 401 || status === 403 ? 'Copycat does not bypass authentication. Use a page you are authorised to view.' : '');
  }
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 8000) }).catch(() => {});
  if (opts.waitFor) {
    try {
      await page.waitForSelector(opts.waitFor, { timeout, state: 'visible' });
    } catch (e) {
      throw classifyNavigationError(e, `${url} (waiting for ${opts.waitFor})`);
    }
  }
  const challenge = await detectChallenge(page);
  if (challenge) {
    throw new CopycatError(`Access challenge detected (${challenge}) at ${url}`, EXIT.BLOCKED,
      'Copycat does not bypass CAPTCHAs or bot protection. Inspect a page you can access normally, or provide screenshots.');
  }
  if (opts.scroll !== false) await autoScroll(page);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(opts.settleMs ?? 250);
  return { status, finalUrl: page.url() };
}

/** @param {Page} page */
async function detectChallenge(page) {
  return page.evaluate(() => {
    const t = (document.title + ' ' + (document.body?.innerText ?? '').slice(0, 2000)).toLowerCase();
    if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], #challenge-form, .cf-turnstile')) return 'captcha widget';
    if (/verify you are (a )?human|checking your browser|are you a robot|unusual traffic/.test(t)) return 'bot check page';
    return null;
  }).catch(() => null);
}

/**
 * Scroll in viewport-sized steps to trigger lazy loading, bounded in both
 * steps and time, then return to the top.
 * @param {Page} page
 */
export async function autoScroll(page, maxSteps = 40) {
  await page.evaluate(async (max) => {
    const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let i = 0; i < max; i++) {
      const before = window.scrollY;
      window.scrollBy(0, step);
      await sleep(120);
      if (window.scrollY === before) break;
    }
    window.scrollTo(0, 0);
    await sleep(150);
  }, maxSteps).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
}

/**
 * Screenshot with animations frozen and caret hidden for stable diffs.
 * @param {Page} page
 * @param {string} file
 * @param {{ selector?: string, fullPage?: boolean, timeout?: number }} [opts]
 */
export async function stableScreenshot(page, file, opts = {}) {
  const common = /** @type {const} */ ({ path: file, animations: 'disabled', caret: 'hide', timeout: opts.timeout ?? 30000 });
  if (opts.selector) {
    const loc = page.locator(opts.selector).first();
    if ((await loc.count()) === 0) throw new CopycatError(`Selector not found: ${opts.selector}`, EXIT.USAGE);
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.screenshot(common);
  } else {
    await page.screenshot({ ...common, fullPage: opts.fullPage ?? true });
  }
  return file;
}
