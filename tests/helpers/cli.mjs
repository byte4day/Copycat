import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Run a repository script and capture output.
 * @param {string} script path relative to the repo (e.g. bin/copycat.mjs)
 * @param {string[]} args
 * @param {{ env?: Record<string,string>, cwd?: string, timeout?: number }} [o]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(script, args, o = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO, script), ...args], { cwd: o.cwd ?? REPO, env: { ...process.env, ...o.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout running ${script} ${args.join(' ')}`));
    }, o.timeout ?? 120000);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** @param {string} prefix */
export function tmpdir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `copycat-${prefix}-`));
}
