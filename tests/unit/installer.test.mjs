import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { run, tmpdir, REPO } from '../helpers/cli.mjs';
import { planTargets, locations } from '../../scripts/lib/installer.mjs';

/** Sandbox home where all four hosts look installed. */
function home() {
  const h = tmpdir('home');
  for (const d of ['.claude', '.codex', '.cursor', '.gemini']) mkdirSync(path.join(h, d));
  return h;
}
const inst = (/** @type {string[]} */ args) => run('scripts/install.mjs', args);
const uninst = (/** @type {string[]} */ args) => run('scripts/uninstall.mjs', args);
const verify = (/** @type {string[]} */ args) => run('scripts/verify.mjs', args);

test('documented global locations per platform', () => {
  const roots = { home: '/h', project: '/p', repo: REPO };
  assert.deepEqual(locations('claude', 'global', roots), { skill: '/h/.claude/skills/copycat', agent: '/h/.claude/agents/copycat.md' });
  assert.deepEqual(locations('codex', 'global', roots), { skill: '/h/.agents/skills/copycat', agent: '/h/.codex/agents/copycat.toml' });
  assert.deepEqual(locations('cursor', 'global', roots), { skill: '/h/.agents/skills/copycat', agent: '/h/.cursor/agents/copycat.md' });
  assert.deepEqual(locations('antigravity', 'global', roots), { skill: '/h/.gemini/config/skills/copycat', agent: null });
  assert.equal(locations('antigravity', 'project', roots).skill, '/p/.agents/skills/copycat');
  assert.equal(locations('claude', 'project', roots).skill, '/p/.claude/skills/copycat');
});

test('shared skill folders are installed once', () => {
  const roots = { home: '/h', project: '/p', repo: REPO };
  const t = /** @type {any[]} */ (planTargets(['codex', 'cursor', 'antigravity'], 'project', roots));
  const skills = t.filter((x) => x.kind === 'skill');
  assert.equal(skills.length, 1);
  assert.deepEqual(skills[0].platforms, ['codex', 'cursor', 'antigravity']);
  // Cursor reuses the Claude copy when Codex is not installed (Cursor reads .claude/skills).
  const t2 = /** @type {any[]} */ (planTargets(['claude', 'cursor'], 'global', roots));
  assert.equal(t2.filter((x) => x.kind === 'skill').length, 1);
});

test('dry run changes nothing', async () => {
  const h = home();
  const r = await inst(['--all', '--global', '--home', h, '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, /~\/\.gemini\/config\/skills\/copycat/);
  assert.ok(!existsSync(path.join(h, '.agents')));
  assert.ok(!existsSync(path.join(h, '.copycat')));
  assert.deepEqual(readdirSync(path.join(h, '.claude')), []);
});

test('global install → verify → reinstall is idempotent', async () => {
  const h = home();
  const r = await inst(['--all', '--global', '--home', h, '--runtime', REPO, '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.platforms, ['claude', 'codex', 'cursor', 'antigravity']);
  for (const p of ['.claude/skills/copycat/SKILL.md', '.claude/agents/copycat.md', '.agents/skills/copycat/SKILL.md', '.codex/agents/copycat.toml', '.cursor/agents/copycat.md', '.gemini/config/skills/copycat/SKILL.md']) {
    assert.ok(existsSync(path.join(h, p)), p);
  }
  assert.equal(JSON.parse(readFileSync(path.join(h, '.agents/skills/copycat/scripts/runtime.json'), 'utf8')).runtime, REPO);
  const v = await verify(['--all', '--global', '--home', h]);
  assert.equal(v.code, 0, v.stdout);
  assert.match(v.stdout, /launcher → runtime: copycat \d/);
  const again = JSON.parse((await inst(['--all', '--global', '--home', h, '--runtime', REPO, '--json'])).stdout);
  assert.ok(again.steps.every((/** @type {any} */ s) => s.action === 'up-to-date'), JSON.stringify(again.steps));
});

test('project install writes repo-local paths with a relative ledger', async () => {
  const h = home();
  const proj = tmpdir('proj');
  const r = await inst(['--all', '--project', '--dir', proj, '--home', h, '--runtime', REPO]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  for (const p of ['.claude/skills/copycat/SKILL.md', '.claude/agents/copycat.md', '.agents/skills/copycat/SKILL.md', '.codex/agents/copycat.toml', '.cursor/agents/copycat.md']) assert.ok(existsSync(path.join(proj, p)), p);
  const ledger = JSON.parse(readFileSync(path.join(proj, '.copycat/install-ledger.json'), 'utf8'));
  assert.ok(ledger.entries.every((/** @type {any} */ e) => !path.isAbsolute(e.path)));
  assert.equal((await verify(['--all', '--project', '--dir', proj, '--home', h])).code, 0);
});

test('conflicts: unmanaged paths and local edits are never overwritten without --force', async () => {
  const h = home();
  mkdirSync(path.join(h, '.claude/skills/copycat'), { recursive: true });
  writeFileSync(path.join(h, '.claude/skills/copycat/SKILL.md'), '---\nname: copycat\ndescription: my own skill\n---\nmine');
  const r = await inst(['--platform', 'claude', '--global', '--home', h, '--runtime', REPO]);
  assert.equal(r.code, 8);
  assert.match(r.stdout, /not created by Copycat/);
  assert.match(readFileSync(path.join(h, '.claude/skills/copycat/SKILL.md'), 'utf8'), /mine/);

  const f = await inst(['--platform', 'claude', '--global', '--home', h, '--runtime', REPO, '--force']);
  assert.equal(f.code, 0, f.stdout);
  assert.match(f.stdout, /backup:/);
  const backups = readdirSync(path.join(h, '.copycat/backups'));
  assert.equal(backups.length, 1);
  // Backups never land inside a scanned skills folder.
  assert.deepEqual(readdirSync(path.join(h, '.claude/skills')), ['copycat']);

  appendFileSync(path.join(h, '.claude/agents/copycat.md'), '\n<!-- my tweak -->\n');
  const c = await inst(['--platform', 'claude', '--global', '--home', h, '--runtime', REPO]);
  assert.equal(c.code, 8);
  assert.match(c.stdout, /modified since install/);
  assert.match(readFileSync(path.join(h, '.claude/agents/copycat.md'), 'utf8'), /my tweak/);
});

test('upgrade from an older recorded version backs up and replaces', async () => {
  const h = home();
  await inst(['--platform', 'codex', '--global', '--home', h, '--runtime', REPO]);
  const lp = path.join(h, '.copycat/install-ledger.json');
  const ledger = JSON.parse(readFileSync(lp, 'utf8'));
  for (const e of ledger.entries) e.version = '0.0.1';
  writeFileSync(lp, JSON.stringify(ledger));
  const r = await inst(['--platform', 'codex', '--global', '--home', h, '--runtime', REPO]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /upgrade 0\.0\.1 → /);
  assert.ok(existsSync(path.join(h, '.copycat/backups')));
});

test('uninstall removes only owned, unmodified files and respects shared folders', async () => {
  const h = home();
  await inst(['--all', '--global', '--home', h, '--runtime', REPO]);
  writeFileSync(path.join(h, '.claude/agents/other-agent.md'), 'not ours');
  const partial = await uninst(['--platform', 'codex', '--global', '--home', h]);
  assert.equal(partial.code, 0);
  assert.match(partial.stdout, /keep \(shared\).*still used by cursor/);
  assert.ok(existsSync(path.join(h, '.agents/skills/copycat/SKILL.md')));
  assert.ok(!existsSync(path.join(h, '.codex/agents/copycat.toml')));

  appendFileSync(path.join(h, '.cursor/agents/copycat.md'), 'edit');
  const all = await uninst(['--all', '--global', '--home', h]);
  assert.equal(all.code, 8);
  assert.ok(existsSync(path.join(h, '.cursor/agents/copycat.md')), 'modified file kept');
  assert.ok(!existsSync(path.join(h, '.claude/skills/copycat')));
  assert.ok(!existsSync(path.join(h, '.gemini/config/skills/copycat')));
  assert.equal(readFileSync(path.join(h, '.claude/agents/other-agent.md'), 'utf8'), 'not ours');
  assert.equal((await uninst(['--all', '--global', '--home', h, '--force'])).code, 0);
  assert.ok(!existsSync(path.join(h, '.cursor/agents/copycat.md')));
  assert.ok(existsSync(REPO), 'an external --runtime checkout is never deleted');
});

test('runtime copy is recorded and removed on full uninstall', async () => {
  const h = home();
  const r = await inst(['--platform', 'claude', '--global', '--home', h, '--skip-npm']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(existsSync(path.join(h, '.copycat/runtime/bin/copycat.mjs')));
  assert.equal(JSON.parse(readFileSync(path.join(h, '.claude/skills/copycat/scripts/runtime.json'), 'utf8')).runtime, path.join(h, '.copycat/runtime'));
  const u = await uninst(['--all', '--global', '--home', h]);
  assert.equal(u.code, 0, u.stdout);
  assert.ok(!existsSync(path.join(h, '.copycat/runtime')));
});

test('usage errors return exit 2', async () => {
  assert.equal((await inst(['--platform', 'vscode'])).code, 2);
  assert.equal((await inst([])).code, 2);
  assert.equal((await inst(['--all', '--global', '--project'])).code, 2);
  assert.equal((await verify(['--source'])).code, 0);
});
