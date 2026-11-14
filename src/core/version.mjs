import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Runtime root (the folder that holds bin/, src/ and package.json). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Version from package.json, so the CLI, user agent and docs never drift apart. */
export const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  } catch {
    return '0.0.0';
  }
})();

/** Identifies Copycat to the sites it visits. */
export const USER_AGENT_TOKEN = `Copycat/${VERSION.split('.').slice(0, 2).join('.')} (+https://github.com/byte4day/Copycat)`;
