/**
 * Minimal YAML frontmatter reader for SKILL.md / agent files. Supports the
 * subset used by skills: scalars, quoted strings, block lists and one level
 * of nested maps. Throws on malformed frontmatter.
 * @param {string} text
 * @returns {{ data: Record<string, any>, body: string }}
 */
export function parseFrontmatter(text) {
  const src = text.replace(/^\uFEFF/, '');
  if (!src.startsWith('---\n') && !src.startsWith('---\r\n')) throw new Error('missing opening --- frontmatter fence');
  const end = src.indexOf('\n---', 4);
  if (end === -1) throw new Error('missing closing --- frontmatter fence');
  const raw = src.slice(src.indexOf('\n') + 1, end);
  const body = src.slice(end + 4).replace(/^\r?\n/, '');
  /** @type {Record<string, any>} */
  const data = {};
  /** @type {string | null} */
  let open = null; // top-level key whose value is a block (list or map)
  for (const [n, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (indent === 0) {
      const m = t.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`line ${n + 1}: expected "key: value", got "${t}"`);
      if (m[1] in data) throw new Error(`line ${n + 1}: duplicate key "${m[1]}"`);
      if (m[2] === undefined || m[2] === '') {
        data[m[1]] = null;
        open = m[1];
      } else {
        data[m[1]] = scalar(m[2]);
        open = null;
      }
      continue;
    }
    if (!open) throw new Error(`line ${n + 1}: unexpected indentation`);
    if (t.startsWith('- ')) {
      if (data[open] === null) data[open] = [];
      if (!Array.isArray(data[open])) throw new Error(`line ${n + 1}: list item inside map "${open}"`);
      data[open].push(scalar(t.slice(2)));
      continue;
    }
    const m = t.match(/^([A-Za-z0-9_-]+):\s+(.*)$/);
    if (!m) throw new Error(`line ${n + 1}: expected "key: value", got "${t}"`);
    if (data[open] === null) data[open] = {};
    if (Array.isArray(data[open])) throw new Error(`line ${n + 1}: map entry inside list "${open}"`);
    data[open][m[1]] = scalar(m[2]);
  }
  for (const k of Object.keys(data)) if (data[k] === null) data[k] = '';
  return { data, body };
}

/** @param {string} v */
function scalar(v) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  }
  if (/^(true|false)$/.test(s)) return s === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^[[{]/.test(s)) throw new Error(`flow collections are not supported: ${s}`);
  if (/:\s/.test(s)) throw new Error(`unquoted value contains ": " — quote it: ${s}`);
  return s;
}

/**
 * Validate a SKILL.md against the Agent Skills rules shared by Claude Code,
 * Codex, Cursor and Antigravity.
 * @param {string} text @param {string} dirName
 * @returns {string[]} problems (empty = valid)
 */
export function validateSkill(text, dirName) {
  const problems = [];
  let fm;
  try {
    fm = parseFrontmatter(text);
  } catch (e) {
    return [`frontmatter: ${e instanceof Error ? e.message : e}`];
  }
  const { name, description } = fm.data;
  if (typeof name !== 'string' || !name) problems.push('name is required');
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) problems.push('name must be lowercase letters, digits and single hyphens');
    if (name.length > 64) problems.push('name must be at most 64 characters');
    if (name !== dirName) problems.push(`name "${name}" must match folder "${dirName}"`);
  }
  if (typeof description !== 'string' || !description.trim()) problems.push('description is required');
  else if (description.length > 1024) problems.push(`description is ${description.length} chars (max 1024)`);
  if (!fm.body.trim()) problems.push('body is empty');
  return problems;
}
