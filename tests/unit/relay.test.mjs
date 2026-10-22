import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { run, tmpdir } from '../helpers/cli.mjs';
import { relayArgs, DEFAULT_RELAY_DIR } from '../../src/relay/relay.mjs';
import { CopycatError } from '../../src/core/errors.mjs';

const FAKE = `#!/usr/bin/env python3
import sys
data = sys.stdin.read() if not sys.stdin.isatty() else ""
print("FAKE WORKER OK")
print("saw-task=" + str("CAT-MARKER" in data + " ".join(sys.argv)))
`;

/** A temp project whose every harness binary is a fake worker. */
function sandbox() {
  const dir = tmpdir('relay');
  const fake = path.join(dir, 'fake-agent');
  writeFileSync(fake, FAKE);
  chmodSync(fake, 0o755);
  /** @type {Record<string, string>} */
  const env = { NUMMODE_RELAY_DEPTH: '0' };
  for (const h of ['CLAUDE', 'CODEX', 'CURSOR', 'GEMINI', 'ANTIGRAVITY', 'OPENCODE']) env[`NUMMODE_RELAY_${h}_BIN`] = fake;
  return { dir, env };
}

test('relayArgs defaults the handoff folder to .copycat/relay', () => {
  assert.deepEqual(relayArgs(['status']), ['status', '--dir', DEFAULT_RELAY_DIR]);
  assert.deepEqual(relayArgs(['wait', '--dir', 'x']), ['wait', '--dir', 'x']);
  assert.deepEqual(relayArgs(['harnesses', '--json']), ['harnesses', '--json']);
  assert.deepEqual(relayArgs([]), ['--help']);
  assert.throws(() => relayArgs(['explode']), CopycatError);
});

test('copycat relay dispatch --wait runs a worker and saves result.md', async () => {
  const { dir, env } = sandbox();
  const r = await run('bin/copycat.mjs', ['relay', 'dispatch', '--to', 'codex', '--task', 'inspect CAT-MARKER', '--wait'], { cwd: dir, env });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const root = path.join(dir, '.copycat', 'relay');
  const tasks = readdirSync(root).filter((n) => !n.startsWith('.'));
  assert.equal(tasks.length, 1);
  const result = readFileSync(path.join(root, tasks[0], 'result.md'), 'utf8');
  assert.match(result, /FAKE WORKER OK/);
  assert.match(result, /saw-task=True/);
  assert.equal(JSON.parse(readFileSync(path.join(root, tasks[0], 'meta.json'), 'utf8')).status, 'done');
  assert.ok(existsSync(path.join(root, '.gitignore')));
});

test('copycat relay harnesses lists every supported harness', async () => {
  const { dir, env } = sandbox();
  const r = await run('bin/copycat.mjs', ['relay', 'harnesses', '--json'], { cwd: dir, env });
  assert.equal(r.code, 0, r.stderr);
  const names = JSON.parse(r.stdout).harnesses.map((/** @type {any} */ h) => h.name);
  assert.deepEqual(names.sort(), ['antigravity', 'claude', 'codex', 'cursor', 'gemini', 'opencode']);
});
