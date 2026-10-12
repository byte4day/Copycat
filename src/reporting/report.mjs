import { existsSync, readFileSync } from 'node:fs';

/**
 * Build report.md from the artifacts that actually exist in a run. Sections
 * without evidence say so instead of being filled with guesses.
 * @param {import('../core/run.mjs').Run} run
 */
export async function buildReport(run) {
  const ledger = (await run.readJson('run.json')) ?? { id: run.id, events: [] };
  const scope = await run.readJson('scope.json');
  const shots = (await run.readJson('screenshots.json')) ?? [];
  const tokens = await run.readJson('design-tokens.json');
  const inventory = await run.readJson('component-inventory.json');
  const responsive = await run.readJson('responsive.json');
  const matrix = (await run.readJson('interaction-matrix.json')) ?? [];
  const flows = (await run.readJson('flows.json')) ?? [];
  const routes = await run.readJson('route-inventory.json');
  const cmp = await run.readJson('compare.json');
  const a11y = await run.readJson('accessibility.json');
  const notesPath = run.path('implementation-notes.md');
  const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8').trim() : null;

  const events = /** @type {any[]} */ (ledger.events);
  const inspects = events.filter((e) => e.type === 'inspect');
  /** @type {string[]} */
  const L = [];
  const h = (/** @type {string} */ t) => L.push('', `## ${t}`, '');

  L.push(`# Copycat report — ${ledger.id}`, '');
  L.push(`Generated ${new Date().toISOString()} from artifacts in this run folder. Only observed and measured facts are listed; anything inferred is labelled.`);

  h('Requested scope');
  if (scope) {
    L.push(`- Mode: **${scope.mode}**${scope.component ? ` (component: ${scope.component})` : ''}`);
    if (scope.request) L.push(`- Request: ${quote(scope.request)}`);
    if (scope.urls?.length) L.push(`- References: ${scope.urls.join(', ')}`);
    L.push(`- Viewports: ${scope.viewports.join(', ')}`);
    if (scope.target) L.push(`- Target: ${scope.target}`);
    for (const [k, v] of Object.entries(scope.reasons ?? {})) L.push(`- Why ${k}: ${v}`);
  } else L.push('_No scope recorded (run `copycat plan "<request>" --run <id>` to record it)._');

  h('Inspected references');
  if (inspects.length) {
    L.push('| URL | Scope | Viewports | DOM nodes | Interactions probed |', '|---|---|---|---|---|');
    for (const e of inspects) L.push(`| ${e.url} | ${e.selector ?? 'page'} | ${e.viewports.join(', ')} | ${e.nodeCount}${e.truncated ? ' (truncated)' : ''} | ${e.interactionsProbed} |`);
  } else L.push('_No live reference was inspected in this run._');
  if (routes) {
    L.push('', `Route discovery from ${routes.start}: ${routes.routes.length} visited, ${routes.skipped.length} skipped, robots.txt ${routes.robots}.`, '');
    L.push('| Path | Title | Status | Via |', '|---|---|---|---|');
    for (const r of routes.routes) L.push(`| ${r.path} | ${esc(r.title)} | ${r.status ?? ''} | ${r.via} |`);
    for (const s of routes.skipped) L.push(`| ${s.url} | — | skipped | ${esc(s.reason)} |`);
  }

  h('Screenshots');
  if (shots.length) {
    L.push('| File | Route | Viewport | State | Captured |', '|---|---|---|---|---|');
    for (const s of shots) L.push(`| [${s.file}](${s.file}) | ${s.route} | ${s.viewport.name} ${s.viewport.width}×${s.viewport.height} | ${s.state}${s.selector ? ` (${s.selector})` : ''} | ${s.capturedAt} |`);
  } else L.push('_None captured._');

  h('Design tokens (measured)');
  if (tokens) {
    L.push(`Palette (by usage): ${tokens.palette.slice(0, 10).map((/** @type {any} */ c) => `\`${c.hex}\` (${c.roles.join('/')})`).join(', ') || 'none'}`);
    L.push(`Font families: ${tokens.typography.families.map((/** @type {any} */ f) => `\`${f.value}\``).join(', ') || 'none'}`);
    L.push(`Type sizes: ${tokens.typography.sizes.slice(0, 10).map((/** @type {any} */ f) => f.value).join(', ')}`);
    L.push(`Spacing: ${tokens.spacing.slice(0, 12).map((/** @type {any} */ f) => f.value).join(', ')}`);
    L.push(`Radii: ${tokens.radii.map((/** @type {any} */ f) => f.value).join(', ') || 'none'} · Shadows: ${tokens.shadows.length}`);
    L.push(`Breakpoints from CSS: ${tokens.breakpoints.join(', ') || 'none readable'}`);
    L.push('', 'Full data: [design-tokens.json](design-tokens.json)');
  } else L.push('_Not extracted in this run._');

  h('Components');
  if (inventory) {
    L.push(`Landmarks: ${inventory.landmarks.map((/** @type {any} */ l) => l.tag).join(', ') || 'none'}`);
    L.push(`Headings: ${inventory.headings.filter((/** @type {any} */ x) => x.visible).slice(0, 8).map((/** @type {any} */ x) => `h${x.level} "${x.text.slice(0, 40)}"`).join(' · ')}`);
    L.push(`Repeated patterns: ${inventory.repeatedPatterns.slice(0, 6).map((/** @type {any} */ r) => `${r.count}× ${r.signature}`).join(' · ') || 'none'}`);
    L.push(`Forms: ${inventory.forms.length} · Interactive elements: ${inventory.interactive.total} (${inventory.interactive.buttons} buttons, ${inventory.interactive.links} links, ${inventory.interactive.inputs} inputs)`);
    L.push(`Hover/focus states observed: ${inventory.states.length}`);
    L.push('', 'Full data: [component-inventory.json](component-inventory.json)');
  } else L.push('_Not extracted in this run._');

  h('Responsive observations');
  if (responsive) {
    L.push('| Viewport | Document | Overflow-x | Nav links | Visible landmarks |', '|---|---|---|---|---|');
    for (const [name, v] of Object.entries(/** @type {Record<string, any>} */ (responsive.viewports))) {
      L.push(`| ${name} | ${v.document.width}×${v.document.height} | ${v.horizontalOverflow ? 'yes' : 'no'} | ${v.visibleNavLinks} | ${v.visibleLandmarks.join(', ')} |`);
    }
  } else L.push('_Not captured._');

  h('Interactions observed');
  if (matrix.length) {
    L.push('| Viewport | Trigger | Kind | Result | Reset |', '|---|---|---|---|---|');
    for (const m of matrix) {
      const o = m.observed;
      const result = m.skipped ? `not triggered: ${m.skipped}` : o ? summariseObserved(o) : 'no observation';
      L.push(`| ${m.viewport} | ${esc(m.name || m.trigger)} | ${m.kind} | ${esc(result)} | ${m.reset ?? '—'} |`);
    }
  } else L.push('_No interactions probed._');

  h('Functional test results (scripted flows)');
  if (flows.length) {
    L.push('| Flow | Viewport | Step | Action | Result |', '|---|---|---|---|---|');
    for (const f of flows) L.push(`| ${f.flow} | ${f.viewport} | ${f.step} | ${f.action} ${esc(f.selector ?? '')} | ${f.ok ? `ok${f.observed ? ` — ${esc(summariseObserved(f.observed))}` : ''}` : `FAILED: ${esc(f.error)}`} |`);
  } else L.push('_No scripted flows were run._');

  h('Visual comparison');
  if (cmp?.iterations?.length) {
    L.push(cmp.note, '');
    L.push('| Iteration | Viewport | Mismatch | Diff px | Unstable px | Sizes (ref → local) | Diff image |', '|---|---|---|---|---|---|---|');
    for (const it of cmp.iterations) for (const r of it.results) {
      L.push(`| ${it.iteration} | ${r.viewport.name} | ${(r.pixel.mismatchRatio * 100).toFixed(2)}% | ${r.pixel.diffPixels} | ${r.pixel.unstablePixels} | ${r.pixel.sizes.reference.width}×${r.pixel.sizes.reference.height} → ${r.pixel.sizes.local.width}×${r.pixel.sizes.local.height} | [diff](${r.files.diff}) |`);
    }
    const last = cmp.iterations[cmp.iterations.length - 1];
    L.push('', `Latest iteration ${last.iteration}: ${last.passed === null ? 'no threshold set' : last.passed ? `within --max-mismatch ${last.maxMismatch}` : `exceeds --max-mismatch ${last.maxMismatch}`}.`);
    const issues = last.results.flatMap((/** @type {any} */ r) => r.issues);
    if (issues.length) {
      L.push('', '**Prioritised corrections (latest iteration):**', '');
      issues.slice(0, 25).forEach((/** @type {any} */ i, n) => L.push(`${n + 1}. [${i.category}] (${i.viewport}) ${i.summary}`));
      if (issues.length > 25) L.push(`… ${issues.length - 25} more in compare.json`);
    } else L.push('', 'No structural or pixel-region issues above the configured tolerances.');
  } else L.push('_No comparison was run. Fidelity is unverified._');

  h('Limitations and unverified items');
  const lim = [];
  for (const e of inspects) {
    if (e.truncated) lim.push(`DOM extraction for ${e.url} hit the node cap; deep structure is partial.`);
    for (const p of e.promptInjectionFlags ?? []) lim.push(`Reference text looked like agent instructions and was ignored: "${p.text}" (${p.viewport}).`);
  }
  if (tokens?.typography?.loadedFonts?.some((/** @type {any} */ f) => f.status !== 'loaded')) lim.push('Some declared web fonts were not loaded at capture time; font matching may be approximate.');
  const skipped = matrix.filter((/** @type {any} */ m) => m.skipped);
  if (skipped.length) lim.push(`${skipped.length} interaction candidate(s) were not triggered (submit/destructive/hidden); their behaviour is not observed.`);
  if (routes?.skipped?.length) lim.push(`${routes.skipped.length} route(s) were skipped (robots.txt, errors or access limits).`);
  if (!cmp?.iterations?.length) lim.push('No visual comparison was performed in this run.');
  if (!flows.length && !matrix.length) lim.push('No interactive behaviour was observed; any implemented interactions are inferred.');
  L.push(...(lim.length ? lim.map((x) => `- ${x}`) : ['- None detected automatically. Add agent-side limitations to implementation-notes.md.']));
  if (a11y?.issues?.length) L.push('', `Accessibility notes from the reference: ${a11y.issues.length} heuristic issue(s) — see [accessibility.json](accessibility.json).`);

  h('Implementation notes');
  L.push(notes ?? '_No implementation-notes.md in this run. The agent should record implemented features, simulated (mock) behaviour, assumptions and follow-ups there, then re-run `copycat report`._');

  h('Artifacts');
  for (const f of await run.list()) if (!f.endsWith('.png') && f !== 'report.md') L.push(`- [${f}](${f})`);

  const md = `${L.join('\n')}\n`;
  await run.writeText('report.md', md);
  return md;
}

/** @param {any} o */
export function summariseObserved(o) {
  const parts = [];
  if (o.urlChanged) parts.push(`navigates to ${o.urlChanged.to}`);
  if (o.dialogOpened) parts.push('opens dialog');
  if (o.dialogClosed) parts.push('closes dialog');
  if (o.shownCount) parts.push(`shows ${o.shownCount} element(s)`);
  if (o.hiddenCount) parts.push(`hides ${o.hiddenCount} element(s)`);
  for (const a of (o.attributes ?? []).slice(0, 3)) parts.push(`${a.attr.split('@')[1]}: ${a.from ?? '∅'}→${a.to ?? '∅'}`);
  if (o.focusMoved) parts.push('moves focus');
  if (o.scrolled) parts.push(`scrolls ${o.scrolled}px`);
  if (o.validationMessages?.length) parts.push(`validation: "${o.validationMessages[0]}"`);
  if (o.liveText?.length) parts.push(`message: "${o.liveText[0].slice(0, 60)}"`);
  return parts.join('; ') || 'no visible change';
}

/** @param {string} s */
function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** @param {string} s */
function quote(s) {
  return `“${String(s).slice(0, 300)}”`;
}
