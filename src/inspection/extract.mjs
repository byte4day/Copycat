/**
 * In-page extraction. `extractPage` is serialised by Playwright and executed
 * inside the reference page, so it must be fully self-contained (no imports,
 * no closures over module scope).
 *
 * It never reads input values, cookies, localStorage, sessionStorage or
 * credentials. Text content is returned for reconstruction and is redacted
 * on the Node side before it is written to disk.
 */

/**
 * @param {{ selector?: string | null, maxNodes?: number }} opts
 */
export function extractPage(opts) {
  const maxNodes = opts.maxNodes ?? 2500;
  const root = opts.selector ? document.querySelector(opts.selector) : document.body;
  if (!root) return { error: `Selector not found: ${opts.selector}` };

  const STYLE_KEYS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'boxSizing',
    'width', 'height', 'maxWidth', 'minHeight',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'gap', 'rowGap', 'columnGap', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
    'gridTemplateColumns', 'gridTemplateRows',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'textDecorationLine', 'whiteSpace',
    'color', 'backgroundColor', 'backgroundImage', 'opacity',
    'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor', 'borderLeftWidth', 'borderRightWidth',
    'borderRadius', 'boxShadow', 'outlineStyle', 'overflowX', 'overflowY', 'cursor', 'transition', 'transform',
  ];
  const DEFAULTS = {
    position: 'static', zIndex: 'auto', marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
    paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', gap: 'normal', rowGap: 'normal', columnGap: 'normal',
    flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal', alignItems: 'normal', gridTemplateColumns: 'none', gridTemplateRows: 'none',
    letterSpacing: 'normal', textTransform: 'none', textDecorationLine: 'none', whiteSpace: 'normal', backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none', opacity: '1', borderTopWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px', borderRightWidth: '0px',
    borderTopStyle: 'none', borderRadius: '0px', boxShadow: 'none', outlineStyle: 'none', overflowX: 'visible', overflowY: 'visible',
    cursor: 'auto', transition: 'all 0s ease 0s', transform: 'none', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
    maxWidth: 'none', minHeight: 'auto', boxSizing: 'content-box', textAlign: 'start',
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'BR', 'WBR']);
  const IMPLICIT_ROLE = {
    A: (/** @type {Element} */ el) => (el.hasAttribute('href') ? 'link' : null), BUTTON: () => 'button', NAV: () => 'navigation', MAIN: () => 'main',
    HEADER: () => 'banner', FOOTER: () => 'contentinfo', ASIDE: () => 'complementary', FORM: () => 'form', DIALOG: () => 'dialog',
    UL: () => 'list', OL: () => 'list', LI: () => 'listitem', TABLE: () => 'table', IMG: () => 'img', SELECT: () => 'combobox', TEXTAREA: () => 'textbox',
    H1: () => 'heading', H2: () => 'heading', H3: () => 'heading', H4: () => 'heading', H5: () => 'heading', H6: () => 'heading', SUMMARY: () => 'button',
    INPUT: (/** @type {Element} */ el) => {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', search: 'searchbox' })[t] || 'textbox';
    },
  };

  // Modern colour syntaxes (oklch, lab, color(), color-mix) are serialised the way they were
  // authored. Paint them once and read the pixel back so every colour is rgb()/rgba(),
  // which keeps palettes complete and reference-vs-local comparisons like-for-like.
  const COLOR_KEYS = new Set(['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor']);
  /** @type {Map<string, string>} */
  const colorCache = new Map();
  /** @type {CanvasRenderingContext2D | null | undefined} */
  let colorCtx;
  /** @param {string} v */
  const rgbOf = (v) => {
    if (!v || v.startsWith('rgb')) return v;
    const hit = colorCache.get(v);
    if (hit !== undefined) return hit;
    let out = v;
    try {
      if (colorCtx === undefined) colorCtx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
      if (colorCtx && CSS.supports('color', v)) {
        colorCtx.clearRect(0, 0, 1, 1);
        colorCtx.fillStyle = v;
        colorCtx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
        out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
      }
    } catch { /* keep the authored value */ }
    colorCache.set(v, out);
    return out;
  };

  const sx = window.scrollX;
  const sy = window.scrollY;
  /** @param {Element} el */
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) };
  };
  /** @param {Element} el @param {CSSStyleDeclaration} cs */
  const isVisible = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /** @param {Element} el */
  const roleOf = (el) => el.getAttribute('role') || (IMPLICIT_ROLE[/** @type {keyof typeof IMPLICIT_ROLE} */ (el.tagName)]?.(el) ?? null);
  /** @param {string | null | undefined} s @param {number} [n] */
  const clean = (s, n = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  /** @param {Element} el @param {number} [n] */
  const ownText = (el, n = 120) => clean([...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '), n);
  /** @param {Element} el */
  const accName = (el) => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (clean(t)) return clean(t);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    if (el.tagName === 'IMG') return clean(el.getAttribute('alt'));
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const lab = el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.getAttribute('title');
      return clean(lab);
    }
    const svgTitle = el.querySelector(':scope > title');
    if (svgTitle) return clean(svgTitle.textContent);
    const role = el.getAttribute('role') || (IMPLICIT_ROLE[/** @type {keyof typeof IMPLICIT_ROLE} */ (el.tagName)]?.(el) ?? '');
    if (!/^(button|link|heading|tab|menuitem|option|checkbox|radio|switch|cell|columnheader|listitem)$/.test(role)) return '';
    return clean(/** @type {HTMLElement} */ (el).innerText ?? el.textContent, 80);
  };
  /** @param {string} s */
  const looksGenerated = (s) => /\d{3,}|[a-f0-9]{6,}|^(css|sc|jsx|svelte|emotion)-|__[A-Za-z0-9]{4,}$/.test(s);
  /** @param {Element} el */
  const selectorFor = (el) => {
    if (el.id && !looksGenerated(el.id) && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) {
        const s = `[${attr}="${CSS.escape(v)}"]`;
        if (document.querySelectorAll(s).length === 1) return s;
      }
    }
    const parts = [];
    /** @type {Element | null} */
    let cur = el;
    while (cur && cur !== document.documentElement && parts.length < 8) {
      if (cur.id && !looksGenerated(cur.id) && cur !== el) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const same = [...parent.children].filter((c) => c.tagName === cur?.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
      cur = parent;
    }
    return parts.join(' > ');
  };

  // ---------- DOM walk ----------
  /** @type {any[]} */
  const nodes = [];
  const counters = {
    color: new Map(), background: new Map(), border: new Map(), fontFamily: new Map(), fontSize: new Map(), fontWeight: new Map(),
    lineHeight: new Map(), letterSpacing: new Map(), radius: new Map(), shadow: new Map(), spacing: new Map(), gap: new Map(), transition: new Map(),
  };
  /** @param {Map<string, number>} m @param {string} v @param {number} [w] */
  const bump = (m, v, w = 1) => {
    if (!v) return;
    m.set(v, (m.get(v) || 0) + w);
  };
  /** @type {Map<string, {count:number, sample:string, sizes:string[]}>} */
  const typePairs = new Map();
  let truncated = false;
  let hiddenCount = 0;

  /** @param {Element} el @param {number} depth @param {number} parentIdx */
  const walk = (el, depth, parentIdx) => {
    if (SKIP.has(el.tagName)) return;
    if (nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    const cs = getComputedStyle(el);
    const visible = isVisible(el, cs);
    if (!visible) hiddenCount++;
    /** @type {Record<string,string>} */
    const styles = {};
    if (visible) {
      for (const k of STYLE_KEYS) {
        const raw = /** @type {any} */ (cs)[k];
        const v = COLOR_KEYS.has(k) ? rgbOf(raw) : raw;
        if (v !== undefined && v !== '' && /** @type {any} */ (DEFAULTS)[k] !== v) styles[k] = v;
      }
      // Border colours only matter when a border is drawn.
      if (parseFloat(cs.borderTopWidth) === 0) delete styles.borderTopColor;
      if (parseFloat(cs.borderBottomWidth) === 0) delete styles.borderBottomColor;
    }
    const text = ownText(el);
    const idx = nodes.length;
    const node = {
      i: idx, p: parentIdx, d: depth, tag: el.tagName.toLowerCase(), id: el.id || undefined,
      cls: el.classList.length ? [...el.classList].slice(0, 8) : undefined,
      role: roleOf(el) || undefined, name: undefined, text: text || undefined, visible, box: box(el),
      aria: undefined, styles: visible ? styles : undefined,
    };
    const role = node.role;
    if (role && /^(button|link|heading|img|navigation|dialog|tab|tabpanel|menu|menuitem|checkbox|radio|textbox|combobox|searchbox|switch|slider)$/.test(role)) {
      /** @type {any} */ (node).name = accName(el) || undefined;
    }
    /** @type {Record<string,string>} */
    const aria = {};
    for (const a of el.getAttributeNames()) {
      if (/^aria-(expanded|controls|haspopup|selected|current|pressed|hidden|modal|checked|disabled|invalid|describedby)$/.test(a)) aria[a] = el.getAttribute(a) || '';
    }
    if (el.hasAttribute('disabled')) aria.disabled = 'true';
    if (Object.keys(aria).length) /** @type {any} */ (node).aria = aria;
    nodes.push(node);

    if (visible) {
      const area = Math.max(1, node.box.w * node.box.h);
      const w = Math.log10(area + 10);
      if (text) {
        bump(counters.color, rgbOf(cs.color), text.length);
        bump(counters.fontFamily, cs.fontFamily, text.length);
        bump(counters.fontSize, cs.fontSize, text.length);
        bump(counters.fontWeight, cs.fontWeight, text.length);
        bump(counters.lineHeight, cs.lineHeight, text.length);
        bump(counters.letterSpacing, cs.letterSpacing, text.length);
        const key = `${cs.fontFamily.split(',')[0].trim()}|${cs.fontSize}|${cs.fontWeight}|${cs.lineHeight}|${cs.letterSpacing}`;
        const t = typePairs.get(key) || { count: 0, sample: text.slice(0, 40), sizes: [] };
        t.count += 1;
        if (!t.sizes.includes(node.tag) && t.sizes.length < 6) t.sizes.push(node.tag);
        typePairs.set(key, t);
      }
      const bg = rgbOf(cs.backgroundColor);
      if (bg !== 'rgba(0, 0, 0, 0)') bump(counters.background, bg, w);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(/** @type {any} */ (cs)[`border${side}Width`]) > 0 && /** @type {any} */ (cs)[`border${side}Style`] !== 'none') {
          bump(counters.border, rgbOf(/** @type {any} */ (cs)[`border${side}Color`]));
        }
      }
      if (cs.borderRadius !== '0px') bump(counters.radius, cs.borderRadius);
      if (cs.boxShadow !== 'none') bump(counters.shadow, cs.boxShadow);
      for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom']) {
        const v = /** @type {any} */ (cs)[k];
        if (v && v !== '0px' && v !== 'auto' && !v.startsWith('-')) bump(counters.spacing, v);
      }
      if (cs.display.includes('flex') || cs.display.includes('grid')) {
        if (cs.rowGap && cs.rowGap !== 'normal' && cs.rowGap !== '0px') bump(counters.gap, cs.rowGap);
        if (cs.columnGap && cs.columnGap !== 'normal' && cs.columnGap !== '0px') bump(counters.gap, cs.columnGap);
      }
      if (cs.transitionDuration && cs.transitionDuration !== '0s') bump(counters.transition, `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`);
    }
    for (const c of el.children) walk(c, depth + 1, idx);
    if (el.shadowRoot) for (const c of el.shadowRoot.children) walk(c, depth + 1, idx);
  };
  walk(root, 0, -1);

  /** @param {Map<string, number>} m @param {number} [n] */
  const top = (m, n = 16) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, weight]) => ({ value, weight: Math.round(weight * 10) / 10 }));

  // ---------- Landmarks / headings / interactive ----------
  /** @param {string} sel @param {number} [limit] */
  const collect = (sel, limit = 200) => [...(root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)].slice(0, limit);
  const pick = (/** @type {Element} */ el) => {
    const cs = getComputedStyle(el);
    return { selector: selectorFor(el), tag: el.tagName.toLowerCase(), role: roleOf(el), name: accName(el), visible: isVisible(el, cs), box: box(el) };
  };
  const landmarks = collect('header, nav, main, aside, footer, [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=search]').map(pick);
  const headings = collect('h1, h2, h3, h4, h5, h6, [role=heading]').map((el) => ({
    ...pick(el), level: Number(el.getAttribute('aria-level') || el.tagName.slice(1)) || null, text: clean(/** @type {HTMLElement} */ (el).innerText, 160),
  }));

  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [tabindex]:not([tabindex="-1"]), [aria-expanded], [aria-haspopup], [onclick]';
  const interactive = collect(INTERACTIVE, 400).map((el) => {
    const base = pick(el);
    const cs = getComputedStyle(el);
    /** @type {Record<string, any>} */
    const extra = {
      type: el.getAttribute('type') || undefined,
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      target: el.getAttribute('target') || undefined,
      expanded: el.getAttribute('aria-expanded') ?? undefined,
      controls: el.getAttribute('aria-controls') ?? undefined,
      haspopup: el.getAttribute('aria-haspopup') ?? undefined,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || undefined,
      inForm: Boolean(el.closest('form')) || undefined,
      cursor: cs.cursor,
      transition: cs.transitionDuration !== '0s' ? `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}` : undefined,
    };
    return { ...base, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) };
  });

  // ---------- Forms (structure only, never values) ----------
  const forms = collect('form', 30).map((f) => ({
    selector: selectorFor(f),
    method: (f.getAttribute('method') || 'get').toLowerCase(),
    hasAction: f.hasAttribute('action'),
    novalidate: f.hasAttribute('novalidate'),
    fields: [...f.querySelectorAll('input, select, textarea')].slice(0, 60).map((i) => {
      const inp = /** @type {HTMLInputElement} */ (i);
      return {
        selector: selectorFor(i), tag: i.tagName.toLowerCase(), type: (i.getAttribute('type') || (i.tagName === 'INPUT' ? 'text' : i.tagName.toLowerCase())).toLowerCase(),
        name: i.getAttribute('name') || undefined, label: accName(i) || undefined, required: inp.required || undefined,
        pattern: i.getAttribute('pattern') || undefined, minLength: i.getAttribute('minlength') || undefined, maxLength: i.getAttribute('maxlength') || undefined,
        min: i.getAttribute('min') || undefined, max: i.getAttribute('max') || undefined, autocomplete: i.getAttribute('autocomplete') || undefined,
        options: i.tagName === 'SELECT' ? [...(/** @type {HTMLSelectElement} */ (i)).options].slice(0, 30).map((o) => clean(o.text, 60)) : undefined,
        sensitive: /password|cc-|card|cvc|cvv|iban|ssn|one-time-code/i.test(`${i.getAttribute('type')} ${i.getAttribute('autocomplete')} ${i.getAttribute('name')}`) || undefined,
      };
    }),
    submit: [...f.querySelectorAll('button:not([type]), button[type=submit], input[type=submit]')].map((b) => accName(b)).slice(0, 4),
  }));

  // ---------- Assets ----------
  const images = collect('img, picture source, video, [style*="background-image"]', 300).map((el) => {
    const cs = getComputedStyle(el);
    const img = /** @type {HTMLImageElement} */ (el);
    return {
      selector: selectorFor(el), tag: el.tagName.toLowerCase(), src: img.currentSrc || img.src || el.getAttribute('srcset') || (cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] ?? ''),
      alt: el.getAttribute('alt') ?? undefined, natural: img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : undefined,
      rendered: box(el), objectFit: cs.objectFit !== 'fill' ? cs.objectFit : undefined, loading: el.getAttribute('loading') || undefined,
    };
  });
  const svgs = collect('svg', 300).filter((s) => !s.parentElement?.closest('svg')).map((s) => ({
    selector: selectorFor(s), box: box(s), viewBox: s.getAttribute('viewBox') || undefined, label: accName(s) || undefined,
    paths: s.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse').length, fill: getComputedStyle(s).fill, color: getComputedStyle(s).color,
    inline: true, use: s.querySelector('use')?.getAttribute('href') || s.querySelector('use')?.getAttribute('xlink:href') || undefined,
  }));

  // ---------- Links ----------
  const links = [...document.querySelectorAll('a[href]')].slice(0, 600).map((a) => {
    const el = /** @type {HTMLAnchorElement} */ (a);
    return { href: el.href, text: clean(el.innerText || el.getAttribute('aria-label'), 80), visible: isVisible(el, getComputedStyle(el)), inNav: Boolean(el.closest('nav, header, [role=navigation]')), inFooter: Boolean(el.closest('footer')) };
  });

  // ---------- Fonts & media queries ----------
  const fonts = [];
  try {
    for (const f of /** @type {any} */ (document.fonts)) fonts.push({ family: f.family.replace(/["']/g, ''), weight: f.weight, style: f.style, status: f.status });
  } catch { /* ignore */ }
  const mediaQueries = new Map();
  let inaccessibleSheets = 0;
  /** @param {CSSRuleList} rules */
  const scanRules = (rules) => {
    for (const r of rules) {
      if (r instanceof CSSMediaRule) {
        const t = r.conditionText || r.media.mediaText;
        mediaQueries.set(t, (mediaQueries.get(t) || 0) + 1);
        scanRules(r.cssRules);
      } else if (/** @type {any} */ (r).cssRules) scanRules(/** @type {any} */ (r).cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      scanRules(sheet.cssRules);
    } catch {
      inaccessibleSheets++;
    }
  }
  const breakpoints = [...new Set([...mediaQueries.keys()].flatMap((q) => [...q.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)].map((m) => {
    const px = m[3] === 'px' ? Number(m[2]) : Number(m[2]) * 16;
    return `${m[1]}:${Math.round(px)}`;
  })))].sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));

  // ---------- Repeated patterns (cards, list items, rows) ----------
  /** @type {any[]} */
  const repeated = [];
  const containers = collect('*', 4000).filter((el) => el.children.length >= 3);
  for (const c of containers) {
    /** @type {Map<string, Element[]>} */
    const groups = new Map();
    for (const ch of c.children) {
      if (SKIP.has(ch.tagName)) continue;
      const sig = `${ch.tagName}.${[...ch.classList].filter((x) => !/active|selected|current|open|is-|first|last/.test(x)).sort().join('.')}|${ch.children.length}`;
      groups.set(sig, [...(groups.get(sig) || []), ch]);
    }
    for (const [sig, els] of groups) {
      const visibleEls = els.filter((e) => isVisible(e, getComputedStyle(e)));
      if (visibleEls.length >= 3 && visibleEls[0].children.length >= 1) {
        repeated.push({ container: selectorFor(c), signature: sig.split('|')[0], count: visibleEls.length, firstItem: selectorFor(visibleEls[0]), itemBox: box(visibleEls[0]), sample: clean(/** @type {HTMLElement} */ (visibleEls[0]).innerText, 100) });
      }
    }
    if (repeated.length > 40) break;
  }

  // ---------- Interaction candidates ----------
  const candidates = [];
  for (const el of collect('[aria-expanded], [aria-haspopup], [role=tab], summary, [aria-controls], button, [data-toggle], [data-bs-toggle], [popovertarget], [commandfor]', 300)) {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;
    const role = roleOf(el);
    let kind = 'button';
    if (role === 'tab') kind = 'tab';
    else if (el.tagName === 'SUMMARY') kind = 'disclosure';
    else if (el.hasAttribute('aria-haspopup') || /menu|dropdown/i.test(el.className.toString())) kind = 'menu';
    else if (el.hasAttribute('aria-expanded')) kind = 'disclosure';
    else if (/modal|dialog/i.test(`${el.getAttribute('aria-controls') || ''} ${el.getAttribute('data-target') || ''} ${el.className}`)) kind = 'dialog-trigger';
    const isSubmit = el.closest('form') && (el.getAttribute('type') === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type')));
    candidates.push({ selector: selectorFor(el), kind: isSubmit ? 'submit' : kind, name: accName(el), expanded: el.getAttribute('aria-expanded') ?? undefined, controls: el.getAttribute('aria-controls') ?? undefined });
  }

  // ---------- Content outline ----------
  const blocks = [];
  for (const el of collect('h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, label, button, a, td, th, dt, dd, small, span', 1500)) {
    const t = ownText(el, 400);
    if (!t || t.length < 2) continue;
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;
    blocks.push({ tag: el.tagName.toLowerCase(), text: clean(t, 400), y: box(el).y });
    if (blocks.length >= 600) break;
  }
  blocks.sort((a, b) => a.y - b.y);

  const de = document.documentElement;
  return {
    meta: {
      title: document.title, lang: de.lang || null, url: location.href, scope: opts.selector || null,
      viewport: { width: window.innerWidth, height: window.innerHeight }, document: { width: de.scrollWidth, height: de.scrollHeight },
      rootBox: box(root), nodeCount: nodes.length, truncated, hiddenElements: hiddenCount,
      colorScheme: getComputedStyle(de).colorScheme, bodyBackground: rgbOf(getComputedStyle(document.body).backgroundColor),
      rootFontSize: getComputedStyle(de).fontSize, generator: document.querySelector('meta[name=generator]')?.getAttribute('content') || null,
      horizontalOverflow: de.scrollWidth > window.innerWidth + 1,
    },
    tokens: {
      colors: { text: top(counters.color), background: top(counters.background), border: top(counters.border, 10) },
      typography: {
        families: top(counters.fontFamily, 8), sizes: top(counters.fontSize, 20), weights: top(counters.fontWeight, 8), lineHeights: top(counters.lineHeight, 12),
        letterSpacing: top(counters.letterSpacing, 8),
        styles: [...typePairs.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20).map(([k, v]) => {
          const [family, size, weight, lineHeight, letterSpacing] = k.split('|');
          return { family, size, weight, lineHeight, letterSpacing, count: v.count, tags: v.sizes, sample: v.sample };
        }),
      },
      spacing: top(counters.spacing, 24), gaps: top(counters.gap, 12), radii: top(counters.radius, 12), shadows: top(counters.shadow, 8), transitions: top(counters.transition, 10),
    },
    landmarks, headings, interactive, forms, images, svgs, links, fonts, breakpoints,
    mediaQueries: [...mediaQueries.entries()].map(([query, rules]) => ({ query, rules })), inaccessibleStylesheets: inaccessibleSheets,
    repeated, candidates, content: blocks, nodes,
    // Used only for prompt-injection screening on the Node side; never written to disk.
    screenText: clean(document.body.innerText, 60000),
  };
}

/**
 * Snapshot of the visible-state signature of a page. Used to observe what a
 * trigger changed. Self-contained for page.evaluate.
 * @param {{ selector?: string | null }} opts
 */
export function visibleState(opts) {
  const root = (opts && opts.selector && document.querySelector(opts.selector)) || document.body;
  /** @type {Record<string, any>} */
  const out = { url: location.href, scrollY: Math.round(window.scrollY), visible: {}, aria: {}, focused: null, dialogs: 0 };
  /** @param {Element} el */
  const key = (el) => {
    const parts = [];
    /** @type {Element | null} */
    let c = el;
    while (c && c !== document.documentElement && parts.length < 6) {
      const p = c.parentElement;
      const idx = p ? [...p.children].indexOf(c) : 0;
      parts.unshift(c.id ? `#${c.id}` : `${c.tagName.toLowerCase()}:${idx}`);
      if (c.id) break;
      c = p;
    }
    return parts.join('>');
  };
  const all = root.querySelectorAll('*');
  let n = 0;
  for (const el of all) {
    if (n++ > 6000) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0;
    out.visible[key(el)] = vis;
    for (const a of ['aria-expanded', 'aria-selected', 'aria-pressed', 'aria-checked', 'aria-invalid', 'aria-hidden', 'aria-current', 'open', 'data-state']) {
      if (el.hasAttribute(a)) out.aria[`${key(el)}@${a}`] = el.getAttribute(a);
    }
    if (vis && (el.tagName === 'DIALOG' && /** @type {HTMLDialogElement} */ (el).open || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true')) out.dialogs++;
  }
  const ae = document.activeElement;
  out.focused = ae && ae !== document.body ? key(ae) : null;
  out.validationMessages = [...root.querySelectorAll('input, select, textarea')].map((i) => /** @type {HTMLInputElement} */ (i).validationMessage).filter(Boolean).slice(0, 20);
  out.liveText = [...root.querySelectorAll('[role=alert], [aria-live], .error, .invalid-feedback, [data-error]')]
    .map((e) => (/** @type {HTMLElement} */ (e).innerText || '').trim()).filter(Boolean).slice(0, 20);
  return out;
}

/**
 * Computed style subset used to describe hover/focus/active state changes.
 * @param {string} selector
 */
export function stateStyles(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    color: cs.color, backgroundColor: cs.backgroundColor, borderColor: cs.borderTopColor, boxShadow: cs.boxShadow,
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, outlineOffset: cs.outlineOffset, textDecorationLine: cs.textDecorationLine,
    transform: cs.transform, opacity: cs.opacity, filter: cs.filter, cursor: cs.cursor,
  };
}
