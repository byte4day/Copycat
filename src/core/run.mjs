import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { redactDeep } from './redact.mjs';
import { CopycatError, EXIT } from './errors.mjs';

export const DEFAULT_OUT = path.join('.copycat', 'runs');

/** @param {Date} [d] */
export function newRunId(d = new Date()) {
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

/**
 * Open (or create) a run directory. All JSON written through it is redacted.
 * `mustExist` refuses to create a new folder (used by read-only commands).
 * @param {{ out?: string, run?: string, mustExist?: boolean }} opts
 */
export async function openRun(opts = {}) {
  const base = path.resolve(opts.out ?? DEFAULT_OUT);
  const id = opts.run ?? newRunId();
  if (!/^[\w.-]+$/.test(id) || /^\.+$/.test(id)) {
    throw new CopycatError(`Invalid run id "${id}"`, EXIT.USAGE, 'Use letters, digits, dot, dash or underscore, e.g. --run pricing-v2.');
  }
  const dir = path.join(base, id);
  if (opts.mustExist && !existsSync(dir)) {
    const known = listRunIds(base);
    throw new CopycatError(`Run "${id}" not found in ${base}`, EXIT.USAGE, known.length ? `Existing runs (newest first): ${known.slice(0, 8).join(', ')}` : 'No runs exist there yet. Run inspect, recon or compare first.');
  }
  await mkdir(dir, { recursive: true });
  return new Run(id, dir);
}

/**
 * Run ids in a runs folder, most recently updated first.
 * @param {string} base
 * @returns {string[]}
 */
export function listRunIds(base) {
  if (!existsSync(base)) return [];
  /** @param {string} id */
  const stamp = (id) => {
    const ledger = path.join(base, id, 'run.json');
    try {
      return statSync(existsSync(ledger) ? ledger : path.join(base, id)).mtimeMs;
    } catch {
      return 0;
    }
  };
  return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ id: e.name, at: stamp(e.name) }))
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).map((e) => e.id);
}

export class Run {
  /** @param {string} id @param {string} dir */
  constructor(id, dir) {
    this.id = id;
    this.dir = dir;
  }

  /** @param {...string} parts */
  path(...parts) {
    return path.join(this.dir, ...parts);
  }

  /** @param {string} rel */
  async ensureDir(rel) {
    const p = this.path(rel);
    await mkdir(p, { recursive: true });
    return p;
  }

  /** @param {string} rel @param {unknown} data */
  async writeJson(rel, data) {
    const p = this.path(rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, `${JSON.stringify(redactDeep(data), null, 2)}\n`);
    return p;
  }

  /** @param {string} rel */
  async readJson(rel) {
    const p = this.path(rel);
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8'));
  }

  /** @param {string} rel @param {string} text */
  async writeText(rel, text) {
    const p = this.path(rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, text);
    return p;
  }

  /**
   * Append an event to the run ledger (run.json). The ledger is what the
   * report is built from, so only record things that actually happened.
   * @param {Record<string, any>} event
   */
  async record(event) {
    const ledger = (await this.readJson('run.json')) ?? { id: this.id, createdAt: new Date().toISOString(), events: [] };
    ledger.events.push({ at: new Date().toISOString(), ...event });
    ledger.updatedAt = new Date().toISOString();
    await this.writeJson('run.json', ledger);
    return ledger;
  }

  async list() {
    /** @type {string[]} */
    const out = [];
    /** @param {string} d */
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(path.relative(this.dir, p));
      }
    };
    await walk(this.dir);
    return out.sort();
  }
}

/** @param {string} s */
export function slug(s) {
  return String(s).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'root';
}
