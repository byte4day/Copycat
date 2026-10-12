/**
 * Copycat installer core. Pure-ish functions with injectable home/project
 * directories so tests run against temporary folders.
 *
 * Ownership model: every path Copycat writes is recorded in a ledger
 * (<root>/.copycat/install-ledger.json) with a content hash. Copycat only
 * replaces or removes paths that are in its ledger and unmodified, unless
 * --force is given (and then it backs them up first, outside any directory
 * an agent scans for skills).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { cp, mkdir, rm, writeFile, readFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PLATFORMS = /** @type {const} */ (['claude', 'codex', 'cursor', 'antigravity']);
export const EXIT = { OK: 0, FAILURE: 1, USAGE: 2, CONFLICT: 8 };

/**
 * @typedef {'claude'|'codex'|'cursor'|'antigravity'} Platform
 * @typedef {'global'|'project'} Scope
 * @typedef {{ kind: 'skill'|'agent', platform: Platform, dest: string, source: string, note?: string }} Target
 * @typedef {{ path: string, kind: string, platforms: string[], version: string, hash: string, installedAt: string }} LedgerEntry
 * @typedef {{ version: number, entries: LedgerEntry[], runtime?: { path: string, version: string, hash?: string, lockHash?: string | null } }} Ledger
 */

/** @param {string} repo */
export function readVersion(repo) {
  return JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
}

/**
 * Where each host looks, per the hosts' current documentation (see
 * docs/compatibility.md for sources).
 * @param {Platform} p @param {Scope} scope @param {{ home: string, project: string }} roots
 */
export function locations(p, scope, roots) {
  const g = scope === 'global';
  const base = g ? roots.home : roots.project;
  switch (p) {
    case 'claude':
      return { skill: path.join(base, '.claude', 'skills', 'copycat'), agent: path.join(base, '.claude', 'agents', 'copycat.md') };
    case 'codex':
      return { skill: path.join(base, '.agents', 'skills', 'copycat'), agent: path.join(base, '.codex', 'agents', 'copycat.toml') };
    case 'cursor':
      return { skill: path.join(base, '.agents', 'skills', 'copycat'), agent: path.join(base, '.cursor', 'agents', 'copycat.md') };
    case 'antigravity':
      return { skill: g ? path.join(base, '.gemini', 'config', 'skills', 'copycat') : path.join(base, '.agents', 'skills', 'copycat'), agent: null };
    default:
      throw new Error(`unknown platform ${p}`);
  }
}

/**
 * Skill directories each host scans (used to report duplicate registrations).
 * @param {Platform} p @param {Scope} scope @param {{ home: string, project: string }} roots
 */
export function scannedSkillDirs(p, scope, roots) {
  const b = scope === 'global' ? roots.home : roots.project;
  switch (p) {
    case 'claude': return [path.join(b, '.claude', 'skills')];
    case 'codex': return [path.join(b, '.agents', 'skills')];
    case 'cursor': return [path.join(b, '.agents', 'skills'), path.join(b, '.cursor', 'skills'), path.join(b, '.claude', 'skills'), path.join(b, '.codex', 'skills')];
    case 'antigravity': return scope === 'global'
      ? [path.join(b, '.gemini', 'config', 'skills'), path.join(b, '.gemini', 'antigravity', 'skills')]
      : [path.join(b, '.agents', 'skills'), path.join(b, '.agent', 'skills')];
    default: return [];
  }
}

/** Detect which hosts appear to be installed for this user. */
export function detectPlatforms(home = os.homedir()) {
  /** @param {string} cmd */
  const onPath = (cmd) => {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return r.status === 0;
  };
  return {
    claude: existsSync(path.join(home, '.claude')) || onPath('claude'),
    codex: existsSync(path.join(home, '.codex')) || onPath('codex'),
    cursor: existsSync(path.join(home, '.cursor')) || onPath('cursor') || onPath('cursor-agent'),
    antigravity: existsSync(path.join(home, '.gemini')) || onPath('antigravity') || onPath('agy'),
  };
}

/**
 * Build the list of targets for the selected platforms, de-duplicating
 * shared skill folders (Codex, Cursor and Antigravity-project all read
 * .agents/skills) so one copy serves several hosts.
 * @param {Platform[]} platforms @param {Scope} scope @param {{ home: string, project: string, repo: string }} roots
 * @returns {Target[]}
 */
export function planTargets(platforms, scope, roots) {
  const skillSrc = path.join(roots.repo, '.agents', 'skills', 'copycat');
  /** @type {Map<string, Target & { platforms: Platform[] }>} */
  const byDest = new Map();
  const claudeSelected = platforms.includes('claude');
  for (const p of platforms) {
    const loc = locations(p, scope, roots);
    let skillDest = loc.skill;
    // Cursor also reads .claude/skills; when Claude is being installed in the
    // same scope, reuse that copy instead of adding a second registration.
    if (p === 'cursor' && claudeSelected && !platforms.includes('codex') && !(platforms.includes('antigravity') && scope === 'project')) {
      skillDest = locations('claude', scope, roots).skill;
    }
    const sk = byDest.get(skillDest);
    if (sk) sk.platforms.push(p);
    else byDest.set(skillDest, { kind: 'skill', platform: p, platforms: [p], dest: skillDest, source: skillSrc });
    if (loc.agent) {
      const src = p === 'claude' ? path.join(roots.repo, '.claude', 'agents', 'copycat.md')
        : p === 'cursor' ? path.join(roots.repo, '.cursor', 'agents', 'copycat.md')
          : path.join(roots.repo, 'agents', 'codex', 'copycat.toml');
      byDest.set(loc.agent, { kind: 'agent', platform: p, platforms: [p], dest: loc.agent, source: src });
    }
  }
  return [...byDest.values()];
}

/** Hash a file or a directory tree (paths + contents), ignoring runtime.json. */
export function hashPath(p) {
  const h = createHash('sha256');
  if (!existsSync(p)) return null;
  const st = lstatSync(p);
  if (st.isFile()) {
    h.update(readFileSync(p));
    return h.digest('hex');
  }
  /** @param {string} d @param {string} rel */
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (r === 'scripts/runtime.json') continue;
      const s = lstatSync(full);
      if (s.isDirectory()) walk(full, r);
      else if (s.isFile()) {
        h.update(`${r}\0`);
        h.update(readFileSync(full));
      }
    }
  };
  walk(p, '');
  return h.digest('hex');
}

/** @param {string} root */
export function ledgerPath(root) {
  return path.join(root, '.copycat', 'install-ledger.json');
}

/** @param {string} root @returns {Ledger} */
export function readLedger(root) {
  const p = ledgerPath(root);
  if (!existsSync(p)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    throw new Error(`Corrupt ledger at ${p}; fix or remove it manually.`);
  }
}

/** @param {string} root @param {Ledger} ledger */
export async function writeLedger(root, ledger) {
  await mkdir(path.dirname(ledgerPath(root)), { recursive: true });
  await writeFile(ledgerPath(root), `${JSON.stringify(ledger, null, 2)}\n`);
}

/** Does an unknown existing path look like a Copycat install (any version)? */
export function looksLikeCopycat(p) {
  try {
    const f = statSync(p).isDirectory() ? path.join(p, 'SKILL.md') : p;
    const t = readFileSync(f, 'utf8');
    return /copycat:managed|github\.com\/byte4day\/Copycat/i.test(t);
  } catch {
    return false;
  }
}

/** Versioned backup location outside every scanned skill/agent directory. */
export function backupPath(root, dest, stamp) {
  const rel = path.relative(root, dest).replace(/[\\/:]+/g, '__');
  return path.join(root, '.copycat', 'backups', stamp, rel);
}

/**
 * @typedef {{ action: string, kind: string, dest: string, platforms: string[], detail?: string, backup?: string }} Step
 */

/**
 * Install targets. Returns per-target actions and whether conflicts occurred.
 * @param {Target[]} targets
 * @param {{ ledgerRoot: string, version: string, force?: boolean, dryRun?: boolean, runtimePath?: string | null, scope: Scope, roots: { home: string, project: string } }} o
 */
export async function installTargets(targets, o) {
  const ledger = readLedger(o.ledgerRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  /** @type {Step[]} */
  const steps = [];
  let conflicts = 0;
  for (const t of /** @type {(Target & {platforms: Platform[]})[]} */ (targets)) {
    const entry = ledger.entries.find((e) => path.resolve(abs(o.ledgerRoot, e.path)) === path.resolve(t.dest));
    const exists = existsSync(t.dest);
    const currentHash = exists ? hashPath(t.dest) : null;
    const sourceHash = hashPath(t.source);
    /** @type {Step} */
    const step = { action: 'install', kind: t.kind, dest: t.dest, platforms: t.platforms };
    if (exists) {
      const owned = entry && entry.hash === currentHash;
      if (owned && entry.version === o.version && currentHash === sourceHash && !o.force) {
        step.action = 'up-to-date';
      } else if (owned) {
        step.action = entry.version === o.version ? 'reinstall' : `upgrade ${entry.version} → ${o.version}`;
        step.backup = backupPath(o.ledgerRoot, t.dest, stamp);
      } else if (o.force) {
        step.action = 'replace (forced)';
        step.backup = backupPath(o.ledgerRoot, t.dest, stamp);
        step.detail = entry ? 'modified since install' : looksLikeCopycat(t.dest) ? 'unmanaged Copycat copy' : 'not created by Copycat';
      } else {
        step.action = 'conflict';
        step.detail = entry ? 'modified since install — keeping your changes (use --force to replace; a backup is made)'
          : looksLikeCopycat(t.dest) ? 'an unmanaged Copycat copy exists — use --force to replace it (a backup is made)'
            : 'path exists and was not created by Copycat — left untouched';
        conflicts++;
      }
    }
    steps.push(step);
    if (o.dryRun || step.action === 'up-to-date' || step.action === 'conflict') {
      if (step.action === 'up-to-date' && entry) for (const p of t.platforms) if (!entry.platforms.includes(p)) entry.platforms.push(p);
      continue;
    }
    if (step.backup) {
      await mkdir(path.dirname(step.backup), { recursive: true });
      await rename(t.dest, step.backup);
    }
    await mkdir(path.dirname(t.dest), { recursive: true });
    if (t.kind === 'skill') {
      await cp(t.source, t.dest, { recursive: true, filter: (src) => !/[\\/]scripts[\\/]runtime\.json$/.test(src) });
      if (o.runtimePath) await writeFile(path.join(t.dest, 'scripts', 'runtime.json'), `${JSON.stringify({ runtime: o.runtimePath }, null, 2)}\n`);
    } else {
      await cp(t.source, t.dest);
    }
    const rec = {
      path: o.scope === 'project' ? path.relative(o.ledgerRoot, t.dest) : t.dest,
      kind: t.kind,
      platforms: [...new Set([...(entry?.platforms ?? []), ...t.platforms])],
      version: o.version,
      hash: /** @type {string} */ (hashPath(t.dest)),
      installedAt: new Date().toISOString(),
    };
    ledger.entries = ledger.entries.filter((e) => e !== entry);
    ledger.entries.push(rec);
  }
  if (!o.dryRun) await writeLedger(o.ledgerRoot, ledger);
  return { steps, conflicts, ledger };
}

/** @param {string} root @param {string} p */
export function abs(root, p) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

/**
 * Remove only ledger-owned, unmodified paths for the given platforms.
 * A shared skill folder is kept while another installed platform uses it.
 * @param {Platform[]} platforms
 * @param {{ ledgerRoot: string, force?: boolean, dryRun?: boolean }} o
 */
export async function uninstallTargets(platforms, o) {
  const ledger = readLedger(o.ledgerRoot);
  /** @type {Step[]} */
  const steps = [];
  let kept = 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const e of [...ledger.entries]) {
    const target = abs(o.ledgerRoot, e.path);
    const remaining = e.platforms.filter((p) => !platforms.includes(/** @type {Platform} */ (p)));
    if (remaining.length === e.platforms.length) continue;
    if (remaining.length) {
      steps.push({ action: 'keep (shared)', kind: e.kind, dest: target, platforms: remaining, detail: `still used by ${remaining.join(', ')}` });
      if (!o.dryRun) e.platforms = remaining;
      continue;
    }
    if (!existsSync(target)) {
      steps.push({ action: 'forget (already gone)', kind: e.kind, dest: target, platforms: e.platforms });
      if (!o.dryRun) ledger.entries = ledger.entries.filter((x) => x !== e);
      continue;
    }
    const modified = hashPath(target) !== e.hash;
    if (modified && !o.force) {
      steps.push({ action: 'kept (modified)', kind: e.kind, dest: target, platforms: e.platforms, detail: 'changed since install — use --force to remove (a backup is made)' });
      kept++;
      continue;
    }
    /** @type {Step} */
    const step = { action: 'remove', kind: e.kind, dest: target, platforms: e.platforms };
    if (modified) step.backup = backupPath(o.ledgerRoot, target, stamp);
    steps.push(step);
    if (o.dryRun) continue;
    if (step.backup) {
      await mkdir(path.dirname(step.backup), { recursive: true });
      await rename(target, step.backup);
    } else {
      await rm(target, { recursive: true, force: true });
    }
    ledger.entries = ledger.entries.filter((x) => x !== e);
  }
  if (!o.dryRun) await writeLedger(o.ledgerRoot, ledger);
  return { steps, kept, ledger };
}

/**
 * Copy the runtime (bin, src, package files) to <home>/.copycat/runtime and
 * install production dependencies there.
 * @param {{ repo: string, home: string, version: string, dryRun?: boolean, skipNpm?: boolean, force?: boolean }} o
 */
export async function installRuntime(o) {
  const dest = path.join(o.home, '.copycat', 'runtime');
  const ledger = readLedger(o.home);
  const current = existsSync(path.join(dest, 'package.json')) ? JSON.parse(await readFile(path.join(dest, 'package.json'), 'utf8')).version : null;
  const hasDeps = existsSync(path.join(dest, 'node_modules', 'playwright'));
  const sourceHash = `${hashPath(path.join(o.repo, 'bin'))}:${hashPath(path.join(o.repo, 'src'))}`;
  const lockHash = hashPath(path.join(o.repo, 'package-lock.json'));
  const sameCode = ledger.runtime?.hash === sourceHash;
  if (current === o.version && hasDeps && sameCode && !o.force) return { action: 'up-to-date', dest };
  if (existsSync(dest) && !ledger.runtime && !o.force) {
    return { action: 'conflict', dest, detail: `${dest} exists but is not recorded as a Copycat runtime — left untouched (use --force)` };
  }
  const action = !current ? 'install' : current !== o.version ? `upgrade ${current} → ${o.version}` : 'update (code changed)';
  if (o.dryRun) return { action, dest };
  await mkdir(dest, { recursive: true });
  for (const item of ['bin', 'src']) {
    await rm(path.join(dest, item), { recursive: true, force: true });
    await cp(path.join(o.repo, item), path.join(dest, item), { recursive: true });
  }
  for (const f of ['package.json', 'package-lock.json', 'LICENSE']) {
    if (existsSync(path.join(o.repo, f))) await cp(path.join(o.repo, f), path.join(dest, f));
  }
  let npm = 'skipped';
  const depsCurrent = hasDeps && ledger.runtime?.lockHash === lockHash;
  if (!o.skipNpm && !depsCurrent) {
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dest, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`npm ci failed in ${dest} (exit ${r.status})`);
    npm = 'installed';
  } else if (depsCurrent) npm = 'unchanged';
  ledger.runtime = { path: dest, version: o.version, hash: sourceHash, lockHash: o.skipNpm ? undefined : lockHash };
  await writeLedger(o.home, ledger);
  return { action, dest, npm };
}

/**
 * Remove the runtime if it is recorded in the ledger.
 * @param {{ home: string, dryRun?: boolean }} o
 */
export async function uninstallRuntime(o) {
  const ledger = readLedger(o.home);
  if (!ledger.runtime) return { action: 'not installed by Copycat' };
  const dest = ledger.runtime.path;
  if (!o.dryRun) {
    await rm(dest, { recursive: true, force: true });
    delete ledger.runtime;
    await writeLedger(o.home, ledger);
  }
  return { action: 'remove', dest };
}
