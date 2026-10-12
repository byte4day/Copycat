import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.txt': 'text/plain', '.xml': 'application/xml', '.png': 'image/png', '.svg': 'image/svg+xml' };

/**
 * Static file server for fixtures. Extra routes:
 *   /__hang      never responds (timeout tests)
 *   /__status/N  responds with HTTP N
 *   /sitemap.xml generated from the fixture pages
 * @param {string} rootDir
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function serve(rootDir) {
  const root = path.resolve(rootDir);
  const hanging = new Set();
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/__hang') {
      hanging.add(res);
      return;
    }
    const st = u.pathname.match(/^\/__status\/(\d{3})$/);
    if (st) {
      res.writeHead(Number(st[1]), { 'content-type': 'text/html' });
      res.end(`<h1>${st[1]}</h1>`);
      return;
    }
    if (u.pathname === '/sitemap.xml') {
      const base = `http://${req.headers.host}`;
      const pages = ['index.html', 'pricing.html', 'dashboard.html', 'signup.html'];
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((p) => `<url><loc>${base}/${p}</loc></url>`).join('')}</urlset>`);
      return;
    }
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (path.extname(file))] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    close: () => new Promise((r) => {
      for (const res of hanging) res.destroy();
      server.closeAllConnections?.();
      server.close(() => r(undefined));
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.argv[2] ?? '.');
  const s = await serve(root);
  console.log(s.url);
}
