#!/usr/bin/env node
// Copycat skill launcher. Finds the Copycat runtime (browser pipeline) and
// forwards all arguments to it. Resolution order:
//   1. $COPYCAT_RUNTIME            (directory containing bin/copycat.mjs)
//   2. runtime.json next to this file (written by the installer)
//   3. ~/.copycat/runtime          (default installer location)
//   4. the repository checkout this skill lives in (development)
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [];
if (process.env.COPYCAT_RUNTIME) candidates.push(process.env.COPYCAT_RUNTIME);
try {
  const cfg = JSON.parse(readFileSync(path.join(here, 'runtime.json'), 'utf8'));
  if (cfg.runtime) candidates.push(cfg.runtime);
} catch { /* no installer config */ }
candidates.push(path.join(homedir(), '.copycat', 'runtime'));
candidates.push(path.resolve(here, '..', '..', '..', '..'));

const runtime = candidates.find((c) => existsSync(path.join(c, 'bin', 'copycat.mjs')) && existsSync(path.join(c, 'src')));
if (!runtime) {
  process.stderr.write([
    'copycat: runtime not found. Looked in:',
    ...candidates.map((c) => `  - ${c}`),
    'Install it with: git clone https://github.com/byte4day/Copycat && cd Copycat && npm install && node scripts/install.mjs --all --global',
    'or set COPYCAT_RUNTIME to a Copycat checkout.',
    '',
  ].join('\n'));
  process.exit(5);
}
const child = spawn(process.execPath, [path.join(runtime, 'bin', 'copycat.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
