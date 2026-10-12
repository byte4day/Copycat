import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from './installer.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Shared flag parsing for install / uninstall / verify.
 * @param {string[]} argv
 * @param {string[]} extraBooleans
 */
export function parseInstallArgs(argv, extraBooleans = []) {
  /** @type {Record<string, any>} */
  const o = { platforms: [], all: false, global: false, project: false, dir: process.cwd(), dryRun: false, force: false, json: false, home: os.homedir() };
  const booleans = new Set(['all', 'global', 'project', 'dry-run', 'force', 'json', 'help', ...extraBooleans]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw usage(`Unexpected argument "${a}"`);
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (booleans.has(k)) {
      o[camel(k)] = true;
      continue;
    }
    const v = inline ?? argv[++i];
    if (v === undefined) throw usage(`--${k} needs a value`);
    if (k === 'platform') o.platforms.push(...v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    else if (k === 'dir') o.dir = path.resolve(v);
    else if (k === 'home') o.home = path.resolve(v); // for tests and sandboxed installs
    else if (k === 'runtime') o.runtime = path.resolve(v);
    else throw usage(`Unknown option --${k}`);
  }
  for (const p of o.platforms) if (!PLATFORMS.includes(p)) throw usage(`Unknown platform "${p}" (use ${PLATFORMS.join(', ')})`);
  if (o.global && o.project) throw usage('Choose either --global or --project');
  if (!o.global && !o.project && !o.help) o.global = true;
  if (!o.all && !o.platforms.length && !o.help) throw usage('Choose --platform <name> or --all');
  return o;
}

/** @param {string} s */
function camel(s) {
  return s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
}

/** @param {string} msg */
export function usage(msg) {
  const e = new Error(msg);
  /** @type {any} */ (e).usage = true;
  return e;
}

/** @param {string} p */
export function tilde(p, home = os.homedir()) {
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}
