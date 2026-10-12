#!/usr/bin/env node
// Install the Copycat skill, native agents and browser runtime.
// Usage: node scripts/install.mjs (--all | --platform <names>) [--global | --project [--dir <path>]]
//        [--dry-run] [--force] [--runtime <checkout> | --no-runtime] [--with-browser] [--json]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseInstallArgs, REPO, tilde } from './lib/cli.mjs';
import { PLATFORMS, EXIT, detectPlatforms, planTargets, installTargets, installRuntime, readVersion, scannedSkillDirs } from './lib/installer.mjs';

const HELP = `Install Copycat for Claude Code, Codex, Cursor and Antigravity.

  node scripts/install.mjs --all --global            all detected hosts, user-wide
  node scripts/install.mjs --platform claude --global
  node scripts/install.mjs --all --project [--dir .] into a repository (commit to share)
  node scripts/install.mjs --all --global --dry-run  show what would change

Options
  --platform <list>   ${PLATFORMS.join(', ')} (comma-separated or repeated)
  --all               every detected host (explicit --platform installs even if not detected)
  --global | --project  user-wide (default) or repository-local
  --dir <path>        project root for --project (default: current directory)
  --dry-run           print the plan, change nothing
  --force             replace modified/unmanaged copies (backed up to .copycat/backups first)
  --runtime <path>    use an existing Copycat checkout as the runtime (no copy, no npm)
  --no-runtime        do not install the runtime
  --skip-npm          copy the runtime without running npm ci
  --with-browser      also run "npx playwright install chromium"
  --json              machine-readable output

Exit codes: 0 ok · 1 failure · 2 usage · 8 conflict (something was left untouched)`;

async function main() {
  const o = parseInstallArgs(process.argv.slice(2), ['no-runtime', 'skip-npm', 'with-browser']);
  if (o.help) {
    console.log(HELP);
    return EXIT.OK;
  }
  const version = readVersion(REPO);
  const detected = detectPlatforms(o.home);
  /** @type {any[]} */
  const platforms = o.all ? PLATFORMS.filter((p) => detected[p]) : o.platforms;
  const skippedUndetected = o.all ? PLATFORMS.filter((p) => !detected[p]) : [];
  const scope = o.project ? 'project' : 'global';
  const roots = { home: o.home, project: o.dir, repo: REPO };
  const out = { version, scope, dryRun: o.dryRun, detected, platforms, skippedUndetected, runtime: /** @type {any} */ (null), steps: /** @type {any[]} */ ([]), warnings: /** @type {string[]} */ ([]) };

  if (!platforms.length) {
    out.warnings.push('No supported host detected. Pass --platform <name> to install anyway.');
    return finish(o, out, EXIT.USAGE);
  }

  // 1. Runtime
  let runtimePath = null;
  if (o.runtime) {
    if (!existsSync(path.join(o.runtime, 'bin', 'copycat.mjs'))) throw new Error(`--runtime ${o.runtime} is not a Copycat checkout (bin/copycat.mjs missing)`);
    runtimePath = o.runtime;
    out.runtime = { action: 'use existing checkout', dest: runtimePath };
  } else if (!o.noRuntime) {
    out.runtime = await installRuntime({ repo: REPO, home: o.home, version, dryRun: o.dryRun, skipNpm: o.skipNpm, force: o.force });
    if (out.runtime.action !== 'conflict') runtimePath = out.runtime.dest;
  } else {
    out.runtime = { action: 'skipped (--no-runtime)' };
  }
  if (o.withBrowser && runtimePath && !o.dryRun) {
    const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'install', 'chromium'], { cwd: runtimePath, stdio: 'inherit', shell: process.platform === 'win32' });
    out.runtime.browser = r.status === 0 ? 'chromium installed' : `playwright install failed (exit ${r.status})`;
  }

  // 2. Skill + agents
  const targets = planTargets(platforms, scope, roots);
  const res = await installTargets(targets, { ledgerRoot: scope === 'global' ? o.home : o.dir, version, force: o.force, dryRun: o.dryRun, runtimePath, scope, roots });
  out.steps = res.steps;

  // 3. Duplicate-registration check (what each host will see)
  if (!o.dryRun) {
    for (const p of platforms) {
      const hits = scannedSkillDirs(p, scope, roots).map((d) => path.join(d, 'copycat')).filter((d) => existsSync(path.join(d, 'SKILL.md')));
      if (hits.length > 1) out.warnings.push(`${p} will see ${hits.length} copies of the copycat skill (${hits.map((h) => tilde(h, o.home)).join(', ')}). This is expected when both Claude Code and Codex are installed; Cursor reads both folders.`);
    }
  }
  if (out.runtime?.action === 'conflict') out.warnings.push(out.runtime.detail);
  const conflict = res.conflicts > 0 || out.runtime?.action === 'conflict';
  return finish(o, out, conflict ? EXIT.CONFLICT : EXIT.OK);
}

/** @param {any} o @param {any} out @param {number} code */
function finish(o, out, code) {
  if (o.json) {
    console.log(JSON.stringify({ ...out, exitCode: code }, null, 2));
    return code;
  }
  console.log(`Copycat ${out.version} — ${out.dryRun ? 'DRY RUN, nothing changed' : 'install'} (${out.scope})`);
  console.log(`Hosts detected: ${Object.entries(out.detected).map(([k, v]) => `${k}${v ? ' ✓' : ' ✗'}`).join('  ')}`);
  if (out.skippedUndetected.length) console.log(`Skipped (not detected): ${out.skippedUndetected.join(', ')} — use --platform to force`);
  if (out.runtime) console.log(`runtime   ${out.runtime.action.padEnd(22)} ${out.runtime.dest ? tilde(out.runtime.dest, o.home) : ''}${out.runtime.browser ? ` (${out.runtime.browser})` : ''}`);
  for (const s of out.steps) {
    console.log(`${s.kind.padEnd(9)} ${s.action.padEnd(22)} ${tilde(s.dest, o.home)}  [${s.platforms.join(', ')}]${s.detail ? `\n          ↳ ${s.detail}` : ''}${s.backup ? `\n          ↳ backup: ${tilde(s.backup, o.home)}` : ''}`);
  }
  for (const w of out.warnings) console.log(`warning: ${w}`);
  if (!out.dryRun && code === EXIT.OK) console.log('\nNext: node scripts/verify.mjs ' + (out.scope === 'project' ? '--project' : '--global') + ' --all');
  return code;
}

main().then((c) => process.exit(c), (e) => {
  console.error(`install: ${e.message}`);
  process.exit(e.usage ? EXIT.USAGE : EXIT.FAILURE);
});
