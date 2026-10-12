import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO } from '../helpers/cli.mjs';
import { parseFrontmatter, validateSkill } from '../../scripts/lib/frontmatter.mjs';

const SKILL = path.join(REPO, '.agents', 'skills', 'copycat');

test('SKILL.md has valid Agent Skills frontmatter', () => {
  const text = readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.deepEqual(validateSkill(text, 'copycat'), []);
  const { data } = parseFrontmatter(text);
  assert.equal(data.name, 'copycat');
  assert.match(data.description, /^Inspects authorized websites/);
  assert.ok(data.description.length <= 1024);
});

test('SKILL.md stays compact and links every reference that exists', () => {
  const text = readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.ok(text.split('\n').length < 500, 'SKILL.md should stay under 500 lines');
  const refs = readdirSync(path.join(SKILL, 'references'));
  for (const r of ['browser-inspection.md', 'design-analysis.md', 'interactions.md', 'reconstruction.md', 'visual-validation.md', 'safety-and-permissions.md']) {
    assert.ok(refs.includes(r), `missing reference ${r}`);
    assert.ok(text.includes(`references/${r}`), `SKILL.md does not link ${r}`);
  }
  for (const m of text.matchAll(/`((?:references|assets|scripts)\/[\w.-]+)`/g)) {
    assert.ok(existsSync(path.join(SKILL, m[1])), `SKILL.md links missing file ${m[1]}`);
  }
});

test('native agent definitions are valid', () => {
  for (const f of ['.claude/agents/copycat.md', '.cursor/agents/copycat.md']) {
    const { data, body } = parseFrontmatter(readFileSync(path.join(REPO, f), 'utf8'));
    assert.equal(data.name, 'copycat', f);
    assert.ok(data.description.length > 40, f);
    assert.ok(body.includes('copycat:managed'), `${f} carries the ownership marker`);
  }
  const claude = parseFrontmatter(readFileSync(path.join(REPO, '.claude/agents/copycat.md'), 'utf8')).data;
  assert.deepEqual(claude.skills, ['copycat']);
  const toml = readFileSync(path.join(REPO, 'agents/codex/copycat.toml'), 'utf8');
  for (const k of ['name', 'description', 'developer_instructions']) assert.match(toml, new RegExp(`^${k} = `, 'm'));
  assert.ok(existsSync(path.join(SKILL, 'agents', 'openai.yaml')));
});

test('frontmatter parser rejects malformed input', () => {
  assert.throws(() => parseFrontmatter('no fence'), /opening/);
  assert.throws(() => parseFrontmatter('---\nname: a\n'), /closing/);
  assert.throws(() => parseFrontmatter('---\nname: a\nname: b\n---\nx'), /duplicate/);
  assert.throws(() => parseFrontmatter('---\ndescription: a: b\n---\nx'), /quote it/);
  assert.deepEqual(validateSkill('---\nname: Copy_Cat\ndescription: x\n---\nbody', 'copycat').length, 2);
  assert.match(validateSkill('---\nname: copycat\n---\nbody', 'copycat')[0], /description/);
});

test('launcher reports the runtime version from a repo checkout', async () => {
  const { run } = await import('../helpers/cli.mjs');
  const r = await run('.agents/skills/copycat/scripts/copycat.mjs', ['--version'], { env: { COPYCAT_RUNTIME: REPO } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version);
});

test('launcher fails clearly when no runtime exists', async () => {
  const { run, tmpdir } = await import('../helpers/cli.mjs');
  const { cpSync } = await import('node:fs');
  const home = tmpdir('launcher');
  const isolated = path.join(home, 'skills', 'copycat');
  cpSync(SKILL, isolated, { recursive: true });
  const r = await run(path.relative(REPO, path.join(isolated, 'scripts', 'copycat.mjs')), ['--version'], { env: { HOME: home, USERPROFILE: home, COPYCAT_RUNTIME: '' } });
  assert.equal(r.code, 5);
  assert.match(r.stderr, /runtime not found/);
});
