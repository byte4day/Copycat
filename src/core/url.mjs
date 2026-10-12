import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CopycatError, EXIT } from './errors.mjs';

const ALLOWED = new Set(['http:', 'https:', 'file:']);

/**
 * Validate and normalise a reference location. Accepts http(s) URLs, file:
 * URLs and existing local file paths (converted to file: URLs).
 * @param {string | undefined} input
 * @returns {URL}
 */
export function parseReferenceUrl(input) {
  if (!input || !String(input).trim()) throw new CopycatError('A URL is required', EXIT.USAGE);
  const raw = String(input).trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const resolved = path.resolve(raw);
    if (existsSync(resolved)) return pathToFileURL(resolved);
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(raw)) return parseReferenceUrl(`https://${raw}`);
    throw new CopycatError(`Invalid URL: "${raw}"`, EXIT.USAGE, 'Use a full URL such as https://example.com or a path to a local HTML file.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CopycatError(`Invalid URL: "${raw}"`, EXIT.USAGE);
  }
  if (!ALLOWED.has(url.protocol)) {
    throw new CopycatError(`Unsupported URL scheme "${url.protocol}" in "${raw}"`, EXIT.USAGE, 'Only http:, https: and file: references are supported.');
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) {
    throw new CopycatError(`Invalid URL (missing host): "${raw}"`, EXIT.USAGE);
  }
  if (url.username || url.password) {
    throw new CopycatError('URLs with embedded credentials are refused', EXIT.BLOCKED, 'Remove user:password@ from the URL. Copycat never stores credentials.');
  }
  return url;
}

/** @param {URL} a @param {URL} b */
export function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.host === b.host;
}

/**
 * Canonical route key used for de-duplication while crawling.
 * @param {URL} url
 */
export function routeKey(url) {
  const u = new URL(url.href);
  u.hash = '';
  u.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.href;
}
