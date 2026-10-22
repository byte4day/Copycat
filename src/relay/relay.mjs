// Cross-harness relay: hand a sub-task to another agent CLI (Claude Code, Codex,
// Cursor, Antigravity/Gemini, OpenCode) and read its result from a folder.
// The engine is relay.py (stdlib Python, identical to nummode's copy). This
// wrapper locates it, defaults the handoff folder to .copycat/relay, and
// forwards the arguments.
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CopycatError, EXIT } from '../core/errors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RELAY_SUBCOMMANDS = new Set(['harnesses', 'dispatch', 'status', 'wait', 'result', 'cancel']);
export const DEFAULT_RELAY_DIR = path.join('.copycat', 'relay');

/** @returns {string[]} */
export function relayCandidates(env = process.env) {
  return [env.COPYCAT_RELAY, path.join(here, 'relay.py'), path.join(homedir(), '.nummode', 'scripts', 'relay.py')]
    .filter(/** @returns {p is string} */ (p) => typeof p === 'string' && p.length > 0);
}

/** @returns {string | null} */
export function findPython(env = process.env) {
  for (const bin of [env.COPYCAT_PYTHON, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(/** @type {string} */ (bin), ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { stdio: 'ignore' });
    if (r.status === 0) return /** @type {string} */ (bin);
  }
  return null;
}

/**
 * Build the relay.py argv. Adds `--dir .copycat/relay` unless the caller set one
 * (harnesses has no --dir).
 * @param {string[]} argv
 */
export function relayArgs(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') return ['--help'];
  if (!RELAY_SUBCOMMANDS.has(sub)) throw new CopycatError(`Unknown relay command "${sub}"`, EXIT.USAGE, `Use one of: ${[...RELAY_SUBCOMMANDS].join(', ')}`);
  const hasDir = rest.some((a) => a === '--dir' || a.startsWith('--dir='));
  return sub === 'harnesses' || hasDir ? [sub, ...rest] : [sub, ...rest, '--dir', DEFAULT_RELAY_DIR];
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function runRelay(argv) {
  const script = relayCandidates().find((p) => existsSync(p));
  if (!script) throw new CopycatError('relay.py not found', EXIT.UNAVAILABLE, 'Reinstall Copycat, install nummode, or set COPYCAT_RELAY.');
  const python = findPython();
  if (!python) throw new CopycatError('Python 3.9+ is required for copycat relay', EXIT.UNAVAILABLE, 'Install python3 or set COPYCAT_PYTHON.');
  const args = relayArgs(argv);
  return new Promise((resolve) => {
    const child = spawn(python, [script, ...args], { stdio: 'inherit' });
    child.on('error', () => resolve(EXIT.UNAVAILABLE));
    child.on('exit', (code, signal) => resolve(signal ? EXIT.FAILURE : code ?? EXIT.FAILURE));
  });
}
