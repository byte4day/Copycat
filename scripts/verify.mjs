#!/usr/bin/env node
// Verify a Copycat installation: files present and unmodified, skill and agent
// definitions valid, the launcher finds the runtime, optionally Chromium runs.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseInstallArgs, REPO, tilde } from './lib/cli.mjs';
import { PLATFORMS, EXIT, readLedger, hashPath, abs, scannedSkillDirs } from './lib/installer.mjs';
import { parseFrontmatter, validateSkill } from './lib/frontmatter.mjs';

const HELP = `Verify a Copycat installation.

  node scripts/verify.mjs --all --global [--browser]
  node scripts/verify.mjs --platform codex --project [--dir .]
  node scripts/verify.mjs --source            validate the files in this repository only
Options: --browser (launch Chromium through the installed runtime) --json`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--source')) return verifySource(argv.includes('--json'));
  const o = parseInstallArgs(argv, ['browser']);
  if (o.help) {
    console.log(HELP);
    return EXIT.OK;
  }
  const platforms = o.all ? [...PLATFORMS] : o.platforms;
  const scope = o.project ? 'project' : 'global';
  const root = scope === 'global' ? o.home : o.dir;
  const ledger = readLedger(root);
  /** @type {{ check: string, ok: boolean, detail: string }[]} */
  const checks = [];
  const entries = ledger.entries.filter((e) => e.platforms.some((p) => platforms.includes(p)));
  if (!entries.length) checks.push({ check: `ledger (${scope})`, ok: false, detail: `no Copycat install recorded for ${platforms.join(', ')} in ${tilde(root, o.home)}` });

  let launcher = null;
  for (const e of entries) {
    const p = abs(root, e.path);
    const label = `${e.kind} ${tilde(p, o.home)} [${e.platforms.join(', ')}]`;
    if (!existsSync(p)) {
      checks.push({ check: label, ok: false, detail: 'missing' });
      continue;
    }
    const unmodified = hashPath(p) === e.hash;
    if (e.kind === 'skill') {
      const problems = validateSkill(readFileSync(path.join(p, 'SKILL.md'), 'utf8'), path.basename(p));
      for (const ref of ['browser-inspection', 'design-analysis', 'interactions', 'reconstruction', 'visual-validation', 'safety-and-permissions']) {
        if (!existsSync(path.join(p, 'references', `${ref}.md`))) problems.push(`references/${ref}.md missing`);
      }
      checks.push({ check: label, ok: problems.length === 0, detail: problems.length ? problems.join('; ') : `valid SKILL.md v${e.version}${unmodified ? '' : ' (locally modified)'}` });
      launcher ??= path.join(p, 'scripts', 'copycat.mjs');
    } else if (p.endsWith('.toml')) {
      const t = readFileSync(p, 'utf8');
      const missing = ['name', 'description', 'developer_instructions'].filter((k) => !new RegExp(`^${k}\\s*=`, 'm').test(t));
      checks.push({ check: label, ok: missing.length === 0, detail: missing.length ? `missing ${missing.join(', ')}` : `valid Codex agent${unmodified ? '' : ' (locally modified)'}` });
    } else {
      let detail = '';
      try {
        const fm = parseFrontmatter(readFileSync(p, 'utf8')).data;
        if (fm.name !== 'copycat' || !fm.description) detail = 'name/description missing';
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
      checks.push({ check: label, ok: !detail, detail: detail || `valid agent${unmodified ? '' : ' (locally modified)'}` });
    }
  }

  if (launcher) {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, HOME: o.home, USERPROFILE: o.home };
    // A sandboxed --home must not hide the real Playwright browser cache.
    if (o.home !== os.homedir() && !env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = defaultBrowsersPath();
    const r = spawnSync(process.execPath, [launcher, '--version'], { encoding: 'utf8', env });
    checks.push({ check: 'launcher → runtime', ok: r.status === 0, detail: r.status === 0 ? `copycat ${r.stdout.trim()}` : (r.stderr || r.stdout).trim().split('\n')[0] });
    if (o.browser) {
      const d = spawnSync(process.execPath, [launcher, 'doctor', '--json'], { encoding: 'utf8', env });
      let detail = (d.stderr || '').trim();
      try {
        const j = JSON.parse(d.stdout);
        detail = j.checks.map((/** @type {any} */ c) => `${c.ok ? '✓' : '✗'} ${c.check}`).join(', ');
      } catch { /* keep stderr */ }
      checks.push({ check: 'browser (doctor)', ok: d.status === 0, detail });
    }
  }

  /** @type {Record<string, string[]>} */
  const visibility = {};
  for (const p of platforms) {
    visibility[p] = scannedSkillDirs(/** @type {any} */ (p), scope, { home: o.home, project: o.dir }).map((d) => path.join(d, 'copycat')).filter((d) => existsSync(path.join(d, 'SKILL.md'))).map((d) => tilde(d, o.home));
  }
  const ok = checks.every((c) => c.ok);
  if (o.json) console.log(JSON.stringify({ ok, scope, checks, visibility }, null, 2));
  else {
    console.log(`Copycat verify (${scope})`);
    for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.check}: ${c.detail}`);
    for (const [p, dirs] of Object.entries(visibility)) console.log(`${p.padEnd(12)} sees: ${dirs.length ? dirs.join(', ') : 'no copycat skill'}`);
  }
  return ok ? EXIT.OK : EXIT.FAILURE;
}

function defaultBrowsersPath() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'ms-playwright');
}

/** Validate the repository's own skill and agent files (used in CI). */
/** @param {boolean} json */
function verifySource(json) {
  const checks = [];
  const skill = path.join(REPO, '.agents', 'skills', 'copycat');
  const problems = validateSkill(readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), 'copycat');
  checks.push({ check: '.agents/skills/copycat/SKILL.md', ok: !problems.length, detail: problems.join('; ') || 'valid' });
  for (const f of ['.claude/agents/copycat.md', '.cursor/agents/copycat.md']) {
    try {
      const fm = parseFrontmatter(readFileSync(path.join(REPO, f), 'utf8')).data;
      checks.push({ check: f, ok: fm.name === 'copycat' && Boolean(fm.description), detail: 'valid' });
    } catch (e) {
      checks.push({ check: f, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  const toml = readFileSync(path.join(REPO, 'agents', 'codex', 'copycat.toml'), 'utf8');
  checks.push({ check: 'agents/codex/copycat.toml', ok: /^name = "copycat"/m.test(toml) && /^developer_instructions = """/m.test(toml), detail: 'valid' });
  const ok = checks.every((c) => c.ok);
  if (json) console.log(JSON.stringify({ ok, checks }, null, 2));
  else for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.check}: ${c.detail}`);
  return ok ? EXIT.OK : EXIT.FAILURE;
}

main().then((c) => process.exit(c), (e) => {
  console.error(`verify: ${e.message}`);
  process.exit(e.usage ? EXIT.USAGE : EXIT.FAILURE);
});
