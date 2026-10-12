import { CopycatError, EXIT } from './errors.mjs';

/**
 * @typedef {{ type: 'string' | 'boolean' | 'number', alias?: string, multiple?: boolean }} OptionSpec
 * @typedef {{ positionals: string[], options: Record<string, any> }} ParsedArgs
 */

/**
 * Small, strict argument parser. Unknown options are an error so typos never
 * silently change behaviour.
 * @param {string[]} argv
 * @param {Record<string, OptionSpec>} spec
 * @returns {ParsedArgs}
 */
export function parseArgs(argv, spec) {
  /** @type {Record<string, any>} */
  const options = {};
  /** @type {string[]} */
  const positionals = [];
  /** @type {Record<string, string>} */
  const aliases = {};
  for (const [name, s] of Object.entries(spec)) if (s.alias) aliases[s.alias] = name;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }
    let name;
    /** @type {string | undefined} */
    let inline;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      inline = eq === -1 ? undefined : token.slice(eq + 1);
    } else {
      name = aliases[token.slice(1)];
      if (!name) throw new CopycatError(`Unknown option: ${token}`, EXIT.USAGE);
    }
    let negated = false;
    if (!spec[name] && name.startsWith('no-') && spec[name.slice(3)]?.type === 'boolean') {
      name = name.slice(3);
      negated = true;
    }
    const s = spec[name];
    if (!s) throw new CopycatError(`Unknown option: --${name}`, EXIT.USAGE);

    /** @type {any} */
    let value;
    if (s.type === 'boolean') {
      if (inline !== undefined) value = !['false', '0', 'no'].includes(inline.toLowerCase());
      else value = !negated;
    } else {
      value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) {
        throw new CopycatError(`Option --${name} needs a value`, EXIT.USAGE);
      }
      if (s.type === 'number') {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new CopycatError(`Option --${name} must be a number, got "${value}"`, EXIT.USAGE);
        value = n;
      }
    }
    if (s.multiple) (options[name] ??= []).push(value);
    else options[name] = value;
  }
  return { positionals, options };
}

/**
 * Split comma-separated and repeated values into a flat, de-duplicated list.
 * @param {string | string[] | undefined} v
 * @returns {string[]}
 */
export function listOption(v) {
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  return [...new Set(arr.flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean))];
}
