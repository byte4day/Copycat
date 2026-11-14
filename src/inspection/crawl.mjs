import { launchBrowser, newContext, gotoStable } from '../browser/launch.mjs';
import { parseViewport } from '../browser/viewports.mjs';
import { routeKey, sameOrigin } from '../core/url.mjs';
import { redactUrl } from '../core/redact.mjs';
import { CopycatError } from '../core/errors.mjs';
import { USER_AGENT_TOKEN } from '../core/version.mjs';

/**
 * Minimal robots.txt parser: groups for `*` and `Copycat`, Allow/Disallow
 * with longest-match precedence, `*` and `$` wildcards, Crawl-delay.
 * @param {string} text
 */
export function parseRobots(text) {
  /** @type {{ agents: string[], rules: {allow: boolean, path: string}[], delay: number | null }[]} */
  const groups = [];
  /** @type {typeof groups[number] | null} */
  let cur = null;
  let lastWasAgent = false;
  const sitemaps = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') sitemaps.push(val);
    else if (cur && (key === 'allow' || key === 'disallow')) {
      if (val || key === 'allow') cur.rules.push({ allow: key === 'allow', path: val });
    } else if (cur && key === 'crawl-delay') cur.delay = Number(val) || null;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a === 'copycat')) ;
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.map((g) => g.delay).find((d) => d !== null) ?? null;
  return {
    sitemaps,
    delay,
    /** @param {string} pathWithQuery */
    allowed(pathWithQuery) {
      let best = null;
      for (const r of rules) {
        if (!r.path) continue;
        const re = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
        if (re.test(pathWithQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

/** @param {string} url @param {number} timeout */
async function fetchText(url, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': USER_AGENT_TOKEN } });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 2_000_000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** @param {string} xml */
export function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}

const SKIP_EXT = /\.(pdf|zip|gz|dmg|exe|png|jpe?g|gif|webp|avif|svg|mp4|mp3|webm|woff2?|ttf|css|js|json|xml|rss|ics)$/i;
const SKIP_PATH = /\/(logout|log-out|signout|sign-out|delete|remove|unsubscribe|cart\/add|checkout|wp-admin|admin)(\/|$)/i;

/**
 * May this URL be queued? Same origin, a page (not a file download or a
 * nested sitemap) and not a destructive-looking path. Applied to links and
 * to sitemap entries alike.
 * @param {URL} u @param {URL} start
 */
export function crawlable(u, start) {
  return sameOrigin(u, start) && !SKIP_EXT.test(u.pathname) && !SKIP_PATH.test(u.pathname);
}

/**
 * Discover routes reachable from `start`: same origin only, robots-aware,
 * bounded by maxPages and depth, rate limited.
 * @param {import('../core/run.mjs').Run} run
 * @param {{ url: URL, maxPages?: number, maxDepth?: number, delayMs?: number, timeout?: number, respectRobots?: boolean, include?: string[], viewport?: string }} o
 */
export async function crawl(run, o) {
  const maxPages = Math.max(1, Math.min(o.maxPages ?? 10, 200));
  const maxDepth = o.maxDepth ?? 3;
  const timeout = o.timeout ?? 20000;
  const http = o.url.protocol.startsWith('http');
  // Held in an object because it is reassigned from loadSiteRules() when the origin changes.
  /** @type {{ robots: ReturnType<typeof parseRobots> | null }} */
  const rules = { robots: null };
  /** @type {string[]} */
  let sitemapUrls = [];
  // The origin being crawled. Follows the start URL's own redirect (http → https, apex → www).
  let origin = o.url;
  /** @type {string | null} */
  let redirectedTo = null;
  /** @type {{url: URL, depth: number, from: string | null, via: string}[]} */
  const queue = [{ url: o.url, depth: 0, from: null, via: 'start' }];

  /** Load robots.txt and the sitemap of `base`'s origin and queue the sitemap pages. @param {URL} base */
  const loadSiteRules = async (base) => {
    const txt = await fetchText(new URL('/robots.txt', base).href, 5000);
    rules.robots = txt ? parseRobots(txt) : null;
    const sources = rules.robots?.sitemaps.length ? rules.robots.sitemaps.slice(0, 3).map((s) => new URL(s, base).href) : [new URL('/sitemap.xml', base).href];
    sitemapUrls = [];
    for (const s of sources) {
      const xml = await fetchText(s, 5000);
      if (xml) sitemapUrls = sitemapUrls.concat(parseSitemap(xml).slice(0, 500));
    }
    for (const s of sitemapUrls) {
      try {
        const u = new URL(s, base);
        if (crawlable(u, base)) queue.push({ url: u, depth: 1, from: null, via: 'sitemap' });
      } catch { /* ignore */ }
    }
  };
  if (http) await loadSiteRules(o.url);
  const baseDelay = o.delayMs ?? 500;
  const respect = o.respectRobots !== false;
  const seen = new Set();
  /** @type {any[]} */
  const routes = [];
  /** @type {any[]} */
  const skipped = [];
  const browser = await launchBrowser();
  const context = await newContext(browser, parseViewport(o.viewport ?? 'desktop'));
  const page = await context.newPage();
  try {
    while (queue.length && routes.length < maxPages) {
      const item = /** @type {typeof queue[number]} */ (queue.shift());
      const key = routeKey(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.via !== 'start' && !sameOrigin(item.url, origin)) continue;
      const pathQ = item.url.pathname + item.url.search;
      if (o.include?.length && item.via !== 'start' && !o.include.some((p) => pathQ.startsWith(p))) continue;
      if (respect && rules.robots && !rules.robots.allowed(pathQ)) {
        skipped.push({ url: redactUrl(item.url.href), reason: 'disallowed by robots.txt' });
        continue;
      }
      if (routes.length) await new Promise((r) => setTimeout(r, Math.max(baseDelay, (rules.robots?.delay ?? 0) * 1000)));
      try {
        const nav = await gotoStable(page, item.url.href, { timeout, scroll: false, settleMs: 100 });
        const landed = new URL(nav.finalUrl);
        if (item.via === 'start' && !sameOrigin(landed, origin)) {
          // Crawl the origin the site actually lives on, under that origin's own robots.txt.
          origin = landed;
          redirectedTo = landed.origin;
          queue.length = 0;
          if (landed.protocol.startsWith('http')) await loadSiteRules(landed);
          const lp = landed.pathname + landed.search;
          if (respect && rules.robots && !rules.robots.allowed(lp)) {
            skipped.push({ url: redactUrl(landed.href), reason: 'disallowed by robots.txt' });
            continue;
          }
        }
        if (!sameOrigin(landed, origin)) {
          skipped.push({ url: redactUrl(item.url.href), reason: `redirects off-origin to ${landed.origin}` });
          continue;
        }
        // A redirect can land on a route that was already visited under another URL.
        const landedKey = routeKey(landed);
        if (landedKey !== key) {
          if (seen.has(landedKey)) continue;
          seen.add(landedKey);
        }
        const info = await page.evaluate(() => ({
          title: document.title,
          h1: (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          links: [...document.querySelectorAll('a[href]')].map((a) => ({
            href: /** @type {HTMLAnchorElement} */ (a).href,
            text: (/** @type {HTMLElement} */ (a).innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            nav: Boolean(a.closest('nav, header, [role=navigation]')),
          })),
          landmarks: [...document.querySelectorAll('header, nav, main, aside, footer')].map((e) => e.tagName.toLowerCase()),
        }));
        routes.push({
          url: redactUrl(nav.finalUrl), path: new URL(nav.finalUrl).pathname, status: nav.status, title: info.title, h1: info.h1,
          depth: item.depth, discoveredFrom: item.from ? redactUrl(item.from) : null, via: item.via, landmarks: [...new Set(info.landmarks)],
          outLinks: info.links.length,
        });
        if (item.depth < maxDepth) {
          for (const l of info.links.sort((a, b) => Number(b.nav) - Number(a.nav))) {
            let u;
            try {
              u = new URL(l.href);
            } catch {
              continue;
            }
            u.hash = '';
            if (!crawlable(u, origin)) continue;
            if (!seen.has(routeKey(u))) queue.push({ url: u, depth: item.depth + 1, from: item.url.href, via: l.nav ? 'navigation' : 'link' });
          }
        }
      } catch (e) {
        skipped.push({ url: redactUrl(item.url.href), reason: e instanceof CopycatError ? e.message : String(e) });
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  const inventory = {
    start: redactUrl(o.url.href),
    ...(redirectedTo ? { redirectedTo } : {}),
    budget: { maxPages, maxDepth, delayMs: Math.max(baseDelay, (rules.robots?.delay ?? 0) * 1000) },
    robots: http ? (rules.robots ? (respect ? 'respected' : 'present but ignored by --no-robots') : 'not found') : 'not applicable (file:)',
    sitemapUrls: sitemapUrls.length,
    routes,
    skipped,
    unvisited: [...new Map(queue.filter((q) => !seen.has(routeKey(q.url))).map((q) => [routeKey(q.url), redactUrl(q.url.href)])).values()].slice(0, 50),
  };
  await run.writeJson('route-inventory.json', inventory);
  await run.record({ type: 'crawl', start: inventory.start, visited: routes.length, skipped: skipped.length, robots: inventory.robots });
  return inventory;
}
