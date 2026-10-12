import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { run, tmpdir, REPO } from '../helpers/cli.mjs';

const README = readFileSync(path.join(REPO, 'README.md'), 'utf8');

test('README relative links and images resolve', () => {
  const links = [...README.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)|(?:src|srcset)="((?!https?:)[^"]+)"/g)].map((m) => (m[1] ?? m[2]).split('#')[0]);
  assert.ok(links.length > 10);
  for (const l of links) assert.ok(existsSync(path.join(REPO, l)), `README links missing ${l}`);
  for (const doc of ['docs/installation.md', 'docs/compatibility.md', 'docs/examples.md', 'docs/troubleshooting.md', 'docs/architecture.md']) {
    const text = readFileSync(path.join(REPO, doc), 'utf8').replace(/(`{3,})[\s\S]*?\1/g, ''); // links inside code blocks are examples
    for (const m of text.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (target) assert.ok(existsSync(path.resolve(path.dirname(path.join(REPO, doc)), target)), `${doc} links missing ${target}`);
    }
  }
});

test('every installer command advertised in README runs (dry-run, sandbox home)', async () => {
  const cmds = [...README.matchAll(/^node scripts\/install\.mjs ([^\n#]+?)\s*(?:#.*)?$/gm)].map((m) => m[1].trim().split(/\s+/));
  assert.ok(cmds.length >= 6, `found ${cmds.length}`);
  for (const args of cmds) {
    const h = tmpdir('readme');
    for (const d of ['.claude', '.codex', '.cursor', '.gemini']) mkdirSync(path.join(h, d));
    const fixed = args.map((a) => (a === 'path/to/your/repo' ? tmpdir('readme-proj') : a)).filter((a) => a !== '--with-browser');
    const r = await run('scripts/install.mjs', [...fixed, '--home', h, '--dry-run']);
    assert.equal(r.code, 0, `install ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  }
});

test('README CLI commands and flags exist in the CLI', async () => {
  const help = (await run('bin/copycat.mjs', ['--help'])).stdout;
  for (const cmd of ['plan', 'recon', 'inspect', 'crawl', 'flow', 'compare', 'report', 'doctor']) assert.match(help, new RegExp(`\\n  ${cmd} `));
  for (const flag of ['--max-mismatch', '--ignore-antialiasing', '--size-mode', '--selector', '--interactions', '--max-pages', '--threshold', '--tolerance']) {
    assert.ok(README.includes(flag), `README mentions ${flag}`);
    assert.ok(help.includes(flag), `CLI help has ${flag}`);
  }
  const plan = await run('bin/copycat.mjs', ['plan', 'copycat the navbar from https://example.com']);
  assert.match(plan.stdout, /mode: component \(component: navbar\)/);
});

test('brand SVGs are well-formed, self-contained and safe to embed', () => {
  for (const f of ['copycat-logo.svg', 'copycat-logo-dark.svg', 'copycat-icon.svg', 'copycat-banner.svg']) {
    const svg = readFileSync(path.join(REPO, 'assets', f), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+"/);
    assert.match(svg, /<title id="t">Copycat<\/title>/);
    assert.doesNotMatch(svg, /<script|on\w+=|href="http|@import|url\(|<image|Gradient|<filter/i, `${f} must have no scripts, external refs, gradients or filters`);
    const opens = (svg.match(/<g[\s>]/g) ?? []).length;
    const closes = (svg.match(/<\/g>/g) ?? []).length;
    assert.equal(opens, closes, `${f} balanced <g>`);
  }
});
