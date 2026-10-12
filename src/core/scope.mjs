/**
 * Scope detection: turns a natural-language Copycat request (plus optional
 * --flags) into a structured plan. Deterministic and testable; the agent can
 * override any field.
 */
import { parseArgs, listOption } from './args.mjs';

export const MODES = /** @type {const} */ ([
  'auto', 'full-site', 'single-page', 'component', 'user-flow', 'screenshot', 'design-system', 'audit-only', 'compare',
]);

export const COMPONENTS = [
  'navbar', 'navigation', 'nav', 'header', 'sidebar', 'footer', 'hero', 'card', 'cards', 'modal', 'dialog', 'dropdown',
  'menu', 'tabs', 'accordion', 'table', 'form', 'pricing table', 'pricing card', 'search bar', 'breadcrumb', 'pagination',
  'toast', 'tooltip', 'popover', 'carousel', 'banner', 'button', 'toolbar', 'command palette', 'stepper', 'avatar',
];

const COMPONENT_CANONICAL = /** @type {Record<string,string>} */ ({
  navigation: 'navbar', nav: 'navbar', 'nav bar': 'navbar', 'top bar': 'navbar', dialog: 'modal', cards: 'card', menu: 'dropdown',
});

/** Spec for the documented intent interface (also accepted by the CLI). */
export const INTENT_FLAGS = /** @type {const} */ ({
  url: { type: 'string', multiple: true },
  mode: { type: 'string' },
  scope: { type: 'string' },
  route: { type: 'string', multiple: true },
  target: { type: 'string' },
  viewport: { type: 'string', multiple: true },
  reference: { type: 'string', multiple: true },
  framework: { type: 'string' },
  'inspect-only': { type: 'boolean' },
  compare: { type: 'string' },
  'max-pages': { type: 'number' },
});

/**
 * Tokenise a request string while keeping quoted segments together.
 * @param {string} text
 */
function tokenize(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * @param {string} request natural-language request, possibly containing --flags
 */
export function detectScope(request) {
  const tokens = tokenize(request || '');
  // Separate --flags from prose so the prose can still be analysed.
  /** @type {string[]} */ const flagTokens = [];
  /** @type {string[]} */ const prose = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      flagTokens.push(t);
      const name = t.slice(2).split('=')[0];
      const spec = /** @type {Record<string, {type:string}>} */ (INTENT_FLAGS)[name];
      if (spec && spec.type !== 'boolean' && !t.includes('=') && tokens[i + 1] !== undefined) flagTokens.push(tokens[++i]);
    } else {
      prose.push(t);
    }
  }
  /** @type {Record<string, any>} */
  let flags = {};
  /** @type {string[]} */
  const warnings = [];
  try {
    flags = parseArgs(flagTokens, /** @type {any} */ (INTENT_FLAGS)).options;
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e));
  }

  const text = prose.join(' ');
  const lower = text.toLowerCase();
  const urls = [...listOption(flags.url), ...(text.match(/\bhttps?:\/\/[^\s"'<>)]+/g) ?? [])].map((u) => u.replace(/[.,;]+$/, ''));
  const references = listOption(flags.reference);
  const imageRefs = [...references, ...(text.match(/[^\s"']+\.(png|jpe?g|webp|gif|avif)\b/gi) ?? [])];

  // Component detection — longest phrase first so "pricing table" beats "table".
  let component = null;
  for (const c of [...COMPONENTS].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${c.replace(/ /g, '\\s+')}s?\\b`, 'i').test(lower)) {
      component = COMPONENT_CANONICAL[c] ?? c;
      break;
    }
  }

  /** @type {Array<[string, string]>} */
  const reasons = [];
  let mode;
  const explicitMode = flags.mode ? normaliseMode(String(flags.mode)) : null;
  if (flags.mode && !explicitMode) warnings.push(`Unknown --mode "${flags.mode}", falling back to auto detection`);

  if (explicitMode && explicitMode !== 'auto') {
    mode = explicitMode;
    reasons.push(['mode', `explicit --mode ${flags.mode}`]);
  } else if (flags['inspect-only'] || /\b(audit|blueprint|inspect only|analy[sz]e only|don'?t (change|modify|write)|no code changes|report only)\b/.test(lower)) {
    mode = 'audit-only';
    reasons.push(['mode', 'request asks for analysis without code changes']);
  } else if (flags.compare || /\b(compare|diff|differences?|how close|mismatch(es)?|matches? the reference)\b/.test(lower)) {
    mode = 'compare';
    reasons.push(['mode', 'request asks to compare against a reference']);
  } else if (/\b(design system|design tokens?|tokens|style guide|typography scale|color palette)\b/.test(lower)) {
    mode = 'design-system';
    reasons.push(['mode', 'request targets tokens / design system']);
  } else if (/\b(flow|journey|onboarding|checkout process|wizard|sign-?up process|step[- ]by[- ]step|experience)\b/.test(lower) && !component) {
    mode = 'user-flow';
    reasons.push(['mode', 'request describes a multi-step journey']);
  } else if (imageRefs.length && !urls.length || /\b(screenshot|mockup|image|figma export|from (this|my|the) (picture|png|jpg))\b/.test(lower) && !urls.length) {
    mode = 'screenshot';
    reasons.push(['mode', 'reference is an image, not a live page']);
  } else if (component && !/\b(entire|whole|full|complete) (site|website|app|application)\b/.test(lower)) {
    mode = 'component';
    reasons.push(['mode', `request names a component (${component})`]);
  } else if (/\b(entire|whole|full|complete|all pages|every page)\b.*\b(site|website|app|application|dashboard)\b|\b(site|website)\b(?!.*\bpage\b)/.test(lower) && !/\bthis page\b/.test(lower)) {
    mode = 'full-site';
    reasons.push(['mode', 'request covers a whole site/app']);
  } else if (urls.length || /\bpage\b/.test(lower)) {
    mode = 'single-page';
    reasons.push(['mode', 'single reference page']);
  } else {
    mode = 'single-page';
    reasons.push(['mode', 'default when nothing more specific is detected']);
  }

  if (mode === 'component' && flags.scope) component = String(flags.scope);

  const viewports = listOption(flags.viewport);
  const responsive = /\b(responsive|mobile|tablet|all (screen|device)s?|breakpoints?)\b/.test(lower);
  const interactionsOnly = /\b(interactions?|behaviou?r|states?)\b/.test(lower);

  return {
    mode,
    component: mode === 'component' || mode === 'compare' || mode === 'audit-only' ? component : null,
    focus: component,
    urls: [...new Set(urls)],
    routes: listOption(flags.route),
    references: [...new Set(imageRefs)],
    target: flags.target ?? null,
    framework: flags.framework ?? null,
    viewports: viewports.length ? viewports : responsive ? ['desktop', 'tablet', 'mobile'] : ['desktop', 'mobile'],
    responsive,
    includeInteractions: interactionsOnly || mode === 'user-flow' || mode === 'component',
    inspectOnly: mode === 'audit-only' || Boolean(flags['inspect-only']),
    compareWith: flags.compare ?? null,
    maxPages: flags['max-pages'] ?? (mode === 'full-site' ? 10 : 1),
    reasons: Object.fromEntries(reasons),
    warnings,
  };
}

/** @param {string} m */
export function normaliseMode(m) {
  const key = m.toLowerCase().replace(/_/g, '-').trim();
  /** @type {Record<string,string>} */
  const alias = { site: 'full-site', page: 'single-page', flow: 'user-flow', audit: 'audit-only', 'inspect-only': 'audit-only', tokens: 'design-system' };
  const v = alias[key] ?? key;
  return /** @type {readonly string[]} */ (MODES).includes(v) ? v : null;
}
