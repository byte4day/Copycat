#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, listOption } from '../src/core/args.mjs';
import { CopycatError, EXIT } from '../src/core/errors.mjs';
import { parseReferenceUrl } from '../src/core/url.mjs';
import { detectScope } from '../src/core/scope.mjs';
import { openRun, listRunIds, DEFAULT_OUT } from '../src/core/run.mjs';
import { ROOT, VERSION } from '../src/core/version.mjs';

const COMMON = /** @type {const} */ ({
  out: { type: 'string' },
  run: { type: 'string' },
  json: { type: 'boolean' },
  timeout: { type: 'number' },
  help: { type: 'boolean', alias: 'h' },
});

/** Flags that set how the page is rendered. Shared by inspect, recon, flow and compare. */
const RENDER = /** @type {const} */ ({
  'color-scheme': { type: 'string' },
  'reduced-motion': { type: 'boolean' },
});

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i;

/**
 * Checks shared by every command that takes the common options.
 * @param {Record<string, any>} options
 */
function checkCommon(options) {
  if (options.timeout !== undefined && !(options.timeout > 0)) throw new CopycatError('--timeout must be a positive number of milliseconds', EXIT.USAGE);
}

/**
 * @param {Record<string, any>} options
 * @returns {Promise<{ colorScheme: 'light' | 'dark', reducedMotion: boolean }>}
 */
async function renderOptions(options) {
  const { parseColorScheme } = await import('../src/browser/launch.mjs');
  return { colorScheme: parseColorScheme(options['color-scheme']), reducedMotion: Boolean(options['reduced-motion']) };
}

/**
 * A live page is required here; an image would only open in the browser's image viewer.
 * @param {string | undefined} input @param {string} command
 */
function refuseImage(input, command) {
  if (input && IMAGE_EXT.test(input.split(/[?#]/)[0])) {
    throw new CopycatError(`${command} needs a live page, but "${input}" is an image`, EXIT.USAGE, 'For an image reference use: copycat compare --reference <file.png> --local <url> --viewport <WIDTHxHEIGHT>.');
  }
}

const HELP = `copycat ${VERSION} — See it. Understand it. Rebuild it.

Usage: copycat <command> [options]

Commands
  plan "<request>"          Detect mode/scope from a natural-language request (+ --flags)
  recon <url> [request]     Plan + inspect (+ crawl for full-site) + probe interactions + report
  inspect <url>             Screenshots, DOM, tokens, components, states at each viewport
  crawl <url>               Same-origin route discovery (robots.txt + sitemap aware, bounded)
  flow <url> --steps f.json Run a scripted interaction flow and record each transition
  compare --reference <url|png> --local <url>
                            Screenshot + structural comparison with diff images
  tokens [--run id]         Export measured tokens as CSS variables or a Tailwind v4 @theme
  report [--run id]         (Re)build report.md for a run (latest run when --run is omitted)
  doctor                    Check Node, Playwright and Chromium
  relay <sub> [options]     Hand a sub-task to another agent CLI (claude, codex, cursor,
                            antigravity/gemini, opencode); results in .copycat/relay/<id>/
                            sub: harnesses | dispatch --to <h> --task "…" [--mode read|write] |
                                 status | wait | result <id> | cancel <id>

Common options
  --out <dir>               Runs folder (default .copycat/runs)
  --run <id>                Reuse an existing run id (append artifacts)
  --viewport <list>         desktop,laptop,tablet,mobile or WIDTHxHEIGHT (repeatable)
  --selector <css>          Restrict to one component (inspect/compare/recon)
  --timeout <ms>            Navigation timeout (default 30000)
  --color-scheme light|dark Render with prefers-color-scheme (inspect/recon/flow/compare; default light)
  --reduced-motion          Render with prefers-reduced-motion: reduce
  --json                    Machine-readable output on stdout

inspect:  --no-full-page --wait-for <css> --interactions --max-probes <n> --no-states
crawl:    --max-pages <n> (10) --max-depth <n> (3) --delay <ms> (500) --include <prefix> --no-robots
flow:     --steps <file> --label <name> --allow-submit (non-local sites only, requires authorisation)
          --strict (apply live-site safety rules to local URLs too)
compare:  --threshold <0..1> (0.1) --max-mismatch <0..1> --tolerance <px> (4) --local-selector <css>
          --size-mode pad|crop --no-stability --ignore-antialiasing
          --steps <file> [--local-steps <file>]  put both sides in the same state (open a
          menu, switch a tab) before capture; same safety rules as flow
recon:    --mode <mode> --max-pages <n> --selector <css> --no-interactions
tokens:   --format css|tailwind (css) --prefix <name> (cc) --from <tokens.json>

Exit codes: 0 ok · 1 failure · 2 usage · 3 unavailable · 4 timeout · 5 browser missing ·
            6 blocked (auth/CAPTCHA/unsafe) · 7 over threshold
`;

/** @param {string[]} argv */
async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.OK;
  }
  switch (cmd) {
    case 'plan': return cmdPlan(rest);
    case 'inspect': return cmdInspect(rest);
    case 'crawl': return cmdCrawl(rest);
    case 'flow': return cmdFlow(rest);
    case 'compare': return cmdCompare(rest);
    case 'tokens': return cmdTokens(rest);
    case 'report': return cmdReport(rest);
    case 'recon': return cmdRecon(rest);
    case 'doctor': return cmdDoctor(rest);
    case 'relay': { const { runRelay } = await import('../src/relay/relay.mjs'); return runRelay(rest); }
    default: throw new CopycatError(`Unknown command "${cmd}"`, EXIT.USAGE, 'Run `copycat help`.');
  }
}

/** @param {boolean} json @param {any} data @param {string} human */
function emit(json, data, human) {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${human}\n`);
}

/** @param {string[]} argv */
async function cmdPlan(argv) {
  // Everything after `plan` is the request; known --flags are parsed inside detectScope.
  let json = false;
  /** @type {string | undefined} */ let out;
  /** @type {string | undefined} */ let runId;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--run') runId = argv[++i];
    else words.push(argv[i]);
  }
  const request = words.join(' ');
  if (!request.trim()) throw new CopycatError('plan needs a request, e.g. copycat plan "copycat the navbar on https://example.com"', EXIT.USAGE);
  const scope = { request, ...detectScope(request) };
  if (out || runId) {
    const run = await openRun({ out, run: runId });
    await run.writeJson('scope.json', scope);
    await run.record({ type: 'plan', mode: scope.mode });
    /** @type {any} */ (scope).run = { id: run.id, dir: run.dir };
  }
  emit(json, scope, [
    `mode: ${scope.mode}${scope.component ? ` (component: ${scope.component})` : ''}`,
    `urls: ${scope.urls.join(', ') || '—'}`,
    `viewports: ${scope.viewports.join(', ')}`,
    `inspect only: ${scope.inspectOnly}`,
    `max pages: ${scope.maxPages}`,
    ...Object.entries(scope.reasons).map(([k, v]) => `why ${k}: ${v}`),
    ...scope.warnings.map((w) => `warning: ${w}`),
  ].join('\n'));
  return EXIT.OK;
}

/** @param {string[]} argv */
async function cmdInspect(argv) {
  const { positionals, options } = parseArgs(argv, {
    ...COMMON, ...RENDER, viewport: { type: 'string', multiple: true }, selector: { type: 'string' }, 'full-page': { type: 'boolean' },
    'wait-for': { type: 'string' }, interactions: { type: 'boolean' }, 'max-probes': { type: 'number' }, states: { type: 'boolean' },
  });
  checkCommon(options);
  refuseImage(positionals[0], 'inspect');
  const url = parseReferenceUrl(positionals[0]);
  const render = await renderOptions(options);
  const { parseViewports } = await import('../src/browser/viewports.mjs');
  parseViewports(listOption(options.viewport)); // fail on a bad --viewport before a run folder is created
  const run = await openRun({ out: options.out, run: options.run });
  const { inspect } = await import('../src/inspection/inspect.mjs');
  const r = await inspect(run, {
    url, viewports: listOption(options.viewport), selector: options.selector ?? null, timeout: options.timeout, waitFor: options['wait-for'],
    fullPage: options['full-page'] ?? true, states: options.states ?? true, interactions: Boolean(options.interactions), maxProbes: options['max-probes'], ...render,
  });
  const { buildReport } = await import('../src/reporting/report.mjs');
  await buildReport(run);
  emit(options.json, { run: run.id, dir: run.dir, route: r.route, viewports: r.viewports, screenshots: r.screenshots.map((s) => s.file), files: r.files, ariaOutlines: r.ariaFiles, interactions: r.interactions.length, promptInjectionFlags: r.injection }, [
    `Inspected ${url.href} at ${r.viewports.join(', ')}${render.colorScheme === 'dark' ? ' (dark)' : ''}`,
    `run: ${run.dir}`,
    `screenshots: ${r.screenshots.map((s) => s.file).join(', ')}`,
    `tokens: ${r.files.tokens} · inventory: ${r.files.inventory}${r.primaryScope ? '' : '  (this run\'s top-level files describe its first inspected scope)'}`,
    r.ariaFiles.length ? `outline: ${r.ariaFiles.join(', ')}` : '',
    `palette: ${r.tokens.palette.slice(0, 6).map((/** @type {any} */ c) => c.hex).join(' ')}`,
    `fonts: ${r.tokens.typography.families.slice(0, 3).map((/** @type {any} */ f) => f.value).join(' | ')}`,
    `landmarks: ${r.inventory.landmarks.map((/** @type {any} */ l) => l.tag).join(', ') || 'none'} · interactive: ${r.inventory.interactive.total} · candidates: ${r.inventory.interactionCandidates.length}`,
    r.interactions.length ? `interactions probed: ${r.interactions.length}` : '',
    r.injection.length ? `WARNING: ${r.injection.length} prompt-injection-like text fragment(s) on the page were ignored` : '',
    `report: ${run.path('report.md')}`,
  ].filter(Boolean).join('\n'));
  return EXIT.OK;
}

/** @param {string[]} argv */
async function cmdCrawl(argv) {
  const { positionals, options } = parseArgs(argv, {
    ...COMMON, 'max-pages': { type: 'number' }, 'max-depth': { type: 'number' }, delay: { type: 'number' }, include: { type: 'string', multiple: true },
    robots: { type: 'boolean' }, viewport: { type: 'string' },
  });
  checkCommon(options);
  refuseImage(positionals[0], 'crawl');
  const url = parseReferenceUrl(positionals[0]);
  const run = await openRun({ out: options.out, run: options.run });
  const { crawl } = await import('../src/inspection/crawl.mjs');
  const inv = await crawl(run, { url, maxPages: options['max-pages'], maxDepth: options['max-depth'], delayMs: options.delay, timeout: options.timeout, respectRobots: options.robots ?? true, include: listOption(options.include), viewport: options.viewport });
  emit(options.json, { run: run.id, dir: run.dir, ...inv }, [
    `Visited ${inv.routes.length} route(s) from ${inv.start}${inv.redirectedTo ? ` → ${inv.redirectedTo}` : ''} (robots: ${inv.robots})`,
    ...inv.routes.map((r) => `  ${r.status ?? '   '} ${r.path}  ${r.title}`),
    ...inv.skipped.map((s) => `  skip ${s.url}: ${s.reason}`),
    `run: ${run.dir}`,
  ].join('\n'));
  return EXIT.OK;
}

/** @param {string[]} argv */
async function cmdFlow(argv) {
  const { positionals, options } = parseArgs(argv, { ...COMMON, ...RENDER, steps: { type: 'string' }, viewport: { type: 'string', multiple: true }, label: { type: 'string' }, 'allow-submit': { type: 'boolean' }, strict: { type: 'boolean' } });
  checkCommon(options);
  refuseImage(positionals[0], 'flow');
  const url = parseReferenceUrl(positionals[0]);
  if (!options.steps) throw new CopycatError('flow needs --steps <file.json>', EXIT.USAGE);
  const render = await renderOptions(options);
  const { runSteps, loadSteps, validateLabel } = await import('../src/inspection/interact.mjs');
  const { parseViewports } = await import('../src/browser/viewports.mjs');
  // Everything that can be wrong with the input is checked before a run folder is created.
  validateLabel(options.label);
  parseViewports(listOption(options.viewport));
  const steps = await loadSteps(options.steps);
  const run = await openRun({ out: options.out, run: options.run });
  const res = await runSteps(run, { url, steps, viewports: listOption(options.viewport), timeout: options.timeout, allowSubmit: options['allow-submit'], label: options.label, strict: options.strict, ...render });
  const { buildReport, summariseObserved } = await import('../src/reporting/report.mjs');
  await buildReport(run);
  const failed = res.filter((r) => !r.ok);
  emit(options.json, { run: run.id, dir: run.dir, steps: res }, [
    ...res.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} [${r.viewport}] ${r.step}. ${r.action} ${r.selector ?? ''} ${r.ok ? `→ ${r.observed ? summariseObserved(r.observed) : ''}` : `— ${r.error}`}`),
    `run: ${run.dir}`,
  ].join('\n'));
  return failed.length ? EXIT.FAILURE : EXIT.OK;
}

/** @param {string[]} argv */
async function cmdCompare(argv) {
  const { options } = parseArgs(argv, {
    ...COMMON, ...RENDER, reference: { type: 'string' }, local: { type: 'string' }, viewport: { type: 'string', multiple: true }, selector: { type: 'string' },
    'local-selector': { type: 'string' }, threshold: { type: 'number' }, 'max-mismatch': { type: 'number' }, tolerance: { type: 'number' },
    'full-page': { type: 'boolean' }, stability: { type: 'boolean' }, 'size-mode': { type: 'string' }, 'ignore-antialiasing': { type: 'boolean' },
    steps: { type: 'string' }, 'local-steps': { type: 'string' }, 'allow-submit': { type: 'boolean' }, strict: { type: 'boolean' },
  });
  checkCommon(options);
  if (!options.reference || !options.local) throw new CopycatError('compare needs --reference <url|png> and --local <url>', EXIT.USAGE);
  const refIsUrl = /^https?:/i.test(options.reference);
  const refIsPng = /\.png$/i.test(options.reference) && !refIsUrl;
  // Any other image would be opened as a web page (the browser's image viewer) and "compared".
  if (!refIsUrl && !refIsPng && IMAGE_EXT.test(options.reference)) {
    throw new CopycatError(`Image references must be PNG: ${options.reference}`, EXIT.USAGE, 'Convert it first, e.g. `magick design.jpg design.png`, then pass the PNG.');
  }
  if (refIsUrl && IMAGE_EXT.test(options.reference.split(/[?#]/)[0])) {
    throw new CopycatError(`The reference URL is an image: ${options.reference}`, EXIT.USAGE, 'Download it, convert it to PNG if needed, and pass the file path as --reference.');
  }
  if (refIsPng && !existsSync(path.resolve(options.reference))) throw new CopycatError(`Cannot read image: ${path.resolve(options.reference)}`, EXIT.USAGE);
  refuseImage(options.local, 'compare --local');
  const reference = refIsPng ? path.resolve(options.reference) : parseReferenceUrl(options.reference);
  const local = parseReferenceUrl(options.local);
  if (options.threshold !== undefined && (options.threshold < 0 || options.threshold > 1)) throw new CopycatError('--threshold must be between 0 and 1', EXIT.USAGE);
  // A ratio, not a percentage: `--max-mismatch 5` would be a gate that can never fail.
  if (options['max-mismatch'] !== undefined && (options['max-mismatch'] < 0 || options['max-mismatch'] > 1)) {
    throw new CopycatError('--max-mismatch must be a ratio between 0 and 1', EXIT.USAGE, `For ${options['max-mismatch']}% pass --max-mismatch ${options['max-mismatch'] / 100}.`);
  }
  if (options.tolerance !== undefined && options.tolerance < 0) throw new CopycatError('--tolerance must be 0 or more pixels', EXIT.USAGE);
  if (options['size-mode'] && !['pad', 'crop'].includes(options['size-mode'])) throw new CopycatError('--size-mode must be pad or crop', EXIT.USAGE);
  if (options['local-steps'] && !options.steps && !refIsPng) throw new CopycatError('--local-steps needs --steps for the reference side', EXIT.USAGE, 'Pass --steps <file> (used for both sides) and --local-steps only when the local selectors differ.');
  const render = await renderOptions(options);
  const { loadSteps } = await import('../src/inspection/interact.mjs');
  const steps = options.steps ? await loadSteps(options.steps) : null;
  const localSteps = options['local-steps'] ? await loadSteps(options['local-steps']) : null;
  const { parseViewports } = await import('../src/browser/viewports.mjs');
  parseViewports(listOption(options.viewport));
  const run = await openRun({ out: options.out, run: options.run });
  const { compare } = await import('../src/comparison/compare.mjs');
  const { buildReport } = await import('../src/reporting/report.mjs');
  let entry;
  /** @type {number} */
  let code = EXIT.OK;
  try {
    entry = await compare(run, {
      reference, local, viewports: listOption(options.viewport), selector: options.selector ?? null, localSelector: options['local-selector'] ?? null,
      threshold: options.threshold, maxMismatch: options['max-mismatch'] ?? null, tolerance: options.tolerance, fullPage: options['full-page'] ?? true,
      stability: options.stability ?? true, timeout: options.timeout, sizeMode: options['size-mode'], ignoreAntialiasing: options['ignore-antialiasing'],
      steps, localSteps, allowSubmit: options['allow-submit'], strict: options.strict, ...render,
    });
  } catch (e) {
    if (e instanceof CopycatError && e.exitCode === EXIT.THRESHOLD) {
      entry = /** @type {any} */ (e).entry;
      code = EXIT.THRESHOLD;
    } else throw e;
  }
  await buildReport(run);
  emit(options.json, { run: run.id, dir: run.dir, ...entry }, [
    `Comparison iteration ${entry.iteration} (run ${run.id})${entry.state ? ` — state after ${entry.state.referenceSteps} reference / ${entry.state.localSteps} local step(s)` : ''}${entry.colorScheme === 'dark' ? ' — dark' : ''}`,
    ...entry.results.map((/** @type {any} */ r) => `  ${r.viewport.name}: ${(r.pixel.mismatchRatio * 100).toFixed(2)}% pixels differ (${r.pixel.diffPixels}/${r.pixel.comparedPixels}, ${r.pixel.unstablePixels} unstable ignored)${r.structural ? `, ${r.structural.matched}/${r.structural.referenceElements} reference elements matched` : ''} → ${r.files.diff}`),
    'Top corrections:',
    ...entry.results.flatMap((/** @type {any} */ r) => r.issues).slice(0, 10).map((/** @type {any} */ i, n) => `  ${n + 1}. [${i.category}] (${i.viewport}) ${i.summary}`),
    entry.passed === null ? '' : entry.passed ? `PASS: within --max-mismatch ${entry.maxMismatch}` : `FAIL: exceeds --max-mismatch ${entry.maxMismatch}`,
    `report: ${run.path('report.md')}`,
  ].filter(Boolean).join('\n'));
  return code;
}

/** @param {string[]} argv */
async function cmdReport(argv) {
  const { options } = parseArgs(argv, COMMON);
  const run = await existingRun(options);
  const { buildReport } = await import('../src/reporting/report.mjs');
  const md = await buildReport(run);
  emit(options.json, { run: run.id, report: run.path('report.md') }, options.json ? '' : `${run.path('report.md')}\n\n${md.split('\n').slice(0, 30).join('\n')}\n…`);
  return EXIT.OK;
}

/**
 * Open a run that already exists: --run <id>, or the most recently updated one.
 * @param {Record<string, any>} options
 */
async function existingRun(options) {
  let id = options.run;
  if (!id) {
    const base = path.resolve(options.out ?? DEFAULT_OUT);
    const runs = listRunIds(base);
    if (!runs.length) throw new CopycatError(`No runs found in ${base}`, EXIT.USAGE, 'Run inspect, recon or compare first, or pass --out <dir>.');
    id = runs[0];
  }
  return openRun({ out: options.out, run: id, mustExist: true });
}

/** @param {string[]} argv */
async function cmdTokens(argv) {
  const { options } = parseArgs(argv, { ...COMMON, format: { type: 'string' }, prefix: { type: 'string' }, from: { type: 'string' } });
  const { buildTokenExport, renderTokens, TOKEN_FORMATS } = await import('../src/reporting/tokens.mjs');
  const format = options.format ?? 'css';
  if (!TOKEN_FORMATS.includes(format)) throw new CopycatError(`--format must be one of: ${TOKEN_FORMATS.join(', ')}`, EXIT.USAGE);
  const run = await existingRun(options);
  const rel = options.from ?? 'design-tokens.json';
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new CopycatError('--from is a path inside the run folder, e.g. inspection/pricing-html.tokens.json', EXIT.USAGE);
  const tokens = await run.readJson(rel);
  if (!tokens) throw new CopycatError(`${rel} not found in run ${run.id}`, EXIT.USAGE, 'Run `copycat inspect <url> --run <id>` first.');
  const exported = buildTokenExport(tokens);
  const css = renderTokens(exported, { format, prefix: options.prefix });
  const stem = rel === 'design-tokens.json' ? 'tokens' : rel.replace(/\.tokens\.json$/, '').replace(/\.json$/, '') + '.export';
  const cssFile = `${stem}${format === 'tailwind' ? '.tailwind' : ''}.css`;
  const jsonFile = `${stem}.named.json`;
  await run.writeText(cssFile, css);
  await run.writeJson(jsonFile, exported);
  await run.record({ type: 'tokens', from: rel, format, files: [cssFile, jsonFile] });
  const { buildReport } = await import('../src/reporting/report.mjs');
  await buildReport(run);
  emit(options.json, { run: run.id, dir: run.dir, format, files: { css: cssFile, json: jsonFile }, tokens: exported }, `${css}\nwritten: ${run.path(cssFile)}\n         ${run.path(jsonFile)}`);
  return EXIT.OK;
}

/** @param {string[]} argv */
async function cmdRecon(argv) {
  const { positionals, options } = parseArgs(argv, {
    ...COMMON, ...RENDER, mode: { type: 'string' }, viewport: { type: 'string', multiple: true }, selector: { type: 'string' }, 'max-pages': { type: 'number' },
    interactions: { type: 'boolean' }, 'max-probes': { type: 'number' },
  });
  checkCommon(options);
  const render = await renderOptions(options);
  const request = positionals.join(' ');
  const scope = detectScope(`${request}${options.mode ? ` --mode ${options.mode}` : ''}${options['max-pages'] ? ` --max-pages ${options['max-pages']}` : ''}`);
  refuseImage(scope.urls[0] ?? positionals[0], 'recon');
  const url = parseReferenceUrl(scope.urls[0] ?? positionals[0]);
  const viewports = listOption(options.viewport).length ? listOption(options.viewport) : scope.viewports;
  const { parseViewports } = await import('../src/browser/viewports.mjs');
  parseViewports(viewports);
  const run = await openRun({ out: options.out, run: options.run });
  await run.writeJson('scope.json', { request, ...scope, viewports });
  await run.record({ type: 'plan', mode: scope.mode });
  const { inspect } = await import('../src/inspection/inspect.mjs');
  const { crawl } = await import('../src/inspection/crawl.mjs');
  const { launchBrowser } = await import('../src/browser/launch.mjs');
  /** @type {URL[]} */
  let targets = [url];
  if (scope.mode === 'full-site') {
    const inv = await crawl(run, { url, maxPages: scope.maxPages, timeout: options.timeout });
    targets = inv.routes.map((r) => new URL(r.url));
  }
  const browser = await launchBrowser();
  const done = [];
  try {
    for (const [i, t] of targets.entries()) {
      const r = await inspect(run, {
        url: t, viewports: i === 0 ? viewports : [viewports[0]], selector: options.selector ?? null, timeout: options.timeout,
        interactions: options.interactions ?? (scope.mode !== 'design-system'), maxProbes: options['max-probes'] ?? 10, browser, ...render,
      });
      done.push({ url: t.href, route: r.route, screenshots: r.screenshots.length, interactions: r.interactions.length });
    }
  } finally {
    await browser.close();
  }
  const { buildReport } = await import('../src/reporting/report.mjs');
  await buildReport(run);
  emit(options.json, { run: run.id, dir: run.dir, scope, inspected: done }, [
    `mode: ${scope.mode}${scope.component ? ` (component: ${scope.component})` : ''}`,
    ...done.map((d) => `  inspected ${d.url} — ${d.screenshots} screenshot(s), ${d.interactions} interaction(s) probed`),
    `run: ${run.dir}`,
    `report: ${run.path('report.md')}`,
  ].join('\n'));
  return EXIT.OK;
}

/** @param {string[]} argv */
async function cmdDoctor(argv) {
  const { options } = parseArgs(argv, COMMON);
  /** @type {{ check: string, ok: boolean, detail: string }[]} */
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ check: 'node >= 20', ok: major >= 20, detail: process.versions.node });
  let pw = null;
  try {
    pw = await import('playwright');
    checks.push({ check: 'playwright package', ok: true, detail: 'importable' });
  } catch (e) {
    checks.push({ check: 'playwright package', ok: false, detail: `${e instanceof Error ? e.message.split('\n')[0] : e} — run npm install in ${ROOT}` });
  }
  if (pw) {
    try {
      const b = await pw.chromium.launch({ executablePath: process.env.COPYCAT_CHROMIUM_PATH || undefined });
      checks.push({ check: 'chromium launch', ok: true, detail: b.version() });
      await b.close();
    } catch (e) {
      checks.push({ check: 'chromium launch', ok: false, detail: `${e instanceof Error ? e.message.split('\n')[0] : e} — run npx playwright install chromium` });
    }
  }
  for (const mod of ['pngjs', 'pixelmatch']) {
    try {
      await import(mod);
      checks.push({ check: `${mod} package`, ok: true, detail: 'importable' });
    } catch {
      checks.push({ check: `${mod} package`, ok: false, detail: `run npm install in ${ROOT}` });
    }
  }
  const ok = checks.every((c) => c.ok);
  emit(options.json, { ok, runtime: ROOT, version: VERSION, checks }, [`copycat ${VERSION} runtime: ${ROOT}`, ...checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.check}: ${c.detail}`)].join('\n'));
  return ok ? EXIT.OK : EXIT.BROWSER_MISSING;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof CopycatError) {
      process.stderr.write(`copycat: ${err.message}\n${err.hint ? `hint: ${err.hint}\n` : ''}`);
      process.exit(err.exitCode);
    }
    process.stderr.write(`copycat: unexpected error: ${err?.stack ?? err}\n`);
    process.exit(EXIT.FAILURE);
  },
);
