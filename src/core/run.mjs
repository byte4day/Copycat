import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { redactDeep } from './redact.mjs';

export const DEFAULT_OUT = path.join('.copycat', 'runs');

/** @param {Date} [d] */
export function newRunId(d = new Date()) {
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

/**
 * Open (or create) a run directory. All JSON written through it is redacted.
 * @param {{ out?: string, run?: string }} opts
 */
export async function openRun(opts = {}) {
  const base = path.resolve(opts.out ?? DEFAULT_OUT);
  const id = opts.run ?? newRunId();
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Invalid run id "${id}"`);
  const dir = path.join(base, id);
  await mkdir(dir, { recursive: true });
  return new Run(id, dir);
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
