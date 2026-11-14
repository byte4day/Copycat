/**
 * Turn measured design tokens (design-tokens.json) into a named scale the
 * agent can paste into a project: CSS custom properties or a Tailwind v4
 * `@theme` block. Values are exactly what was measured; only the names are
 * suggestions, and the output says so.
 */
import { CopycatError, EXIT } from '../core/errors.mjs';

export const TOKEN_FORMATS = /** @type {const} */ (['css', 'tailwind']);

/** @param {string} hex #rrggbb or #rrggbbaa */
function saturation(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Unique px values, ascending.
 * @param {{ value: string }[]} list @param {number} cap
 */
function pxScale(list, cap) {
  const seen = new Set();
  /** @type {{ value: string, px: number }[]} */
  const out = [];
  for (const { value } of list ?? []) {
    const m = String(value).match(/^(-?[\d.]+)px$/);
    if (!m || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, px: Number(m[1]) });
  }
  return out.sort((a, b) => a.px - b.px).slice(0, cap);
}

/**
 * @typedef {{ name: string, value: string, note?: string }} NamedToken
 * @typedef {{ source: any, colors: NamedToken[], fonts: NamedToken[], fontSizes: NamedToken[], fontWeights: NamedToken[], spacing: NamedToken[], radii: NamedToken[], shadows: NamedToken[], breakpoints: NamedToken[] }} TokenExport
 */

/**
 * @param {any} tokens contents of design-tokens.json
 * @returns {TokenExport}
 */
export function buildTokenExport(tokens) {
  if (!tokens || !Array.isArray(tokens.palette) || !tokens.typography) {
    throw new CopycatError('Not a Copycat design-tokens file', EXIT.USAGE, 'Run `copycat inspect <url>` first; it writes design-tokens.json.');
  }
  /** @type {NamedToken[]} */
  const colors = [];
  const used = new Set();
  /** @param {string} name @param {any} c @param {string} note */
  const take = (name, c, note) => {
    if (!c || used.has(c.hex)) return;
    used.add(c.hex);
    colors.push({ name, value: c.hex, note });
  };
  /** @param {string} role */
  const byRole = (role) => tokens.palette.filter((/** @type {any} */ c) => c.roles.includes(role));
  /** @param {string} rgb */
  const hexOfRgb = (rgb) => tokens.palette.find((/** @type {any} */ c) => c.rgb === rgb);

  take('surface', hexOfRgb(tokens.page?.background) ?? byRole('background')[0], 'page background');
  const text = (tokens.colors?.text ?? []).map((/** @type {any} */ t) => hexOfRgb(t.value)).filter(Boolean);
  take('text', text[0] ?? byRole('text')[0], 'most used text colour');
  take('text-2', text.find((/** @type {any} */ c) => !used.has(c.hex)), 'second most used text colour');
  take('border', (tokens.colors?.border ?? []).map((/** @type {any} */ t) => hexOfRgb(t.value)).find(Boolean), 'most used border colour');
  take('accent', tokens.palette.filter((/** @type {any} */ c) => !used.has(c.hex) && saturation(c.hex) > 0.25)[0], 'most used saturated colour');
  let n = 1;
  for (const c of tokens.palette) {
    if (colors.length >= 14) break;
    if (!used.has(c.hex)) take(`color-${n++}`, c, c.roles.join('/'));
  }

  const fonts = (tokens.typography.families ?? []).slice(0, 4).map((/** @type {any} */ f, /** @type {number} */ i) => ({ name: `font-${i + 1}`, value: f.value }));
  const fontSizes = pxScale(tokens.typography.sizes, 12).map((s, i) => ({ name: `size-${i + 1}`, value: s.value }));
  const fontWeights = [...new Set((tokens.typography.weights ?? []).map((/** @type {any} */ w) => String(w.value)))].sort((a, b) => Number(a) - Number(b))
    .map((w) => ({ name: `weight-${w}`, value: w }));
  const spacing = pxScale([...(tokens.spacing ?? []), ...(tokens.gaps ?? [])], 16).map((s, i) => ({ name: `space-${i + 1}`, value: s.value }));
  // A radius can be a multi-value shorthand; keep those too, after the single values.
  const single = pxScale(tokens.radii, 8);
  const multi = (tokens.radii ?? []).map((/** @type {any} */ r) => r.value).filter((/** @type {string} */ v) => !/^[\d.]+px$/.test(v)).slice(0, 4);
  const radii = [...single.map((r) => r.value), ...multi].map((value, i) => ({ name: `radius-${i + 1}`, value }));
  const shadows = (tokens.shadows ?? []).slice(0, 6).map((/** @type {any} */ s, /** @type {number} */ i) => ({ name: `shadow-${i + 1}`, value: s.value }));
  const breakpoints = [...new Set((tokens.breakpoints ?? []).map((/** @type {string} */ b) => Number(b.split(':')[1])))].filter(Number.isFinite).sort((a, b) => a - b)
    .map((px, i) => ({ name: `bp-${i + 1}`, value: `${px}px` }));

  return { source: tokens.source ?? null, colors, fonts, fontSizes, fontWeights, spacing, radii, shadows, breakpoints };
}

/**
 * @param {TokenExport} t
 * @param {{ format?: 'css' | 'tailwind', prefix?: string }} [o]
 */
export function renderTokens(t, o = {}) {
  const format = o.format ?? 'css';
  const prefix = o.prefix ?? 'cc';
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(prefix)) throw new CopycatError(`Invalid --prefix "${prefix}"`, EXIT.USAGE, 'Use a short lowercase name such as cc or brand.');
  // Tailwind v4 reads theme values from fixed namespaces; plain CSS uses one prefix.
  /** @type {Record<string, (name: string) => string>} */
  const tw = {
    colors: (n) => `--color-${n}`, fonts: (n) => `--font-${n.replace(/^font-/, 'family-')}`, fontSizes: (n) => `--text-${n}`,
    fontWeights: (n) => `--font-weight-${n.replace(/^weight-/, '')}`, spacing: (n) => `--spacing-${n.replace(/^space-/, 'm')}`,
    radii: (n) => `--radius-${n.replace(/^radius-/, 'r')}`, shadows: (n) => `--shadow-${n.replace(/^shadow-/, 's')}`, breakpoints: (n) => `--breakpoint-${n}`,
  };
  /** @param {keyof typeof tw} group @param {string} name */
  const varName = (group, name) => (format === 'tailwind' ? tw[group](name) : `--${prefix}-${name}`);
  const src = t.source ? `${t.source.url}${t.source.scope ? ` (${t.source.scope})` : ''} at ${t.source.viewport}` : 'a Copycat inspection';
  const L = [
    `/* Design tokens measured by Copycat from ${src}.`,
    '   Values are measured; names are suggestions. Where the project already has a token',
    '   for a value, use the project token instead of adding one of these. */',
    format === 'tailwind' ? '@theme {' : ':root {',
  ];
  /** @param {string} title @param {keyof typeof tw} group @param {NamedToken[]} items */
  const section = (title, group, items) => {
    if (!items.length) return;
    L.push(`  /* ${title} */`);
    for (const i of items) L.push(`  ${varName(group, i.name)}: ${i.value};${i.note ? ` /* ${i.note} */` : ''}`);
  };
  section('Colour', 'colors', t.colors);
  section('Font families', 'fonts', t.fonts);
  section('Type scale', 'fontSizes', t.fontSizes);
  section('Font weights', 'fontWeights', t.fontWeights);
  section('Spacing', 'spacing', t.spacing);
  section('Radii', 'radii', t.radii);
  section('Shadows', 'shadows', t.shadows);
  if (format === 'tailwind') section('Breakpoints', 'breakpoints', t.breakpoints);
  L.push('}');
  if (format !== 'tailwind' && t.breakpoints.length) L.push('', `/* Breakpoints read from the reference CSS: ${t.breakpoints.map((b) => b.value).join(', ')} */`);
  return `${L.join('\n')}\n`;
}
