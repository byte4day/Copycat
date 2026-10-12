import { CopycatError, EXIT } from '../core/errors.mjs';

/** Representative presets. Override with WIDTHxHEIGHT or name=WIDTHxHEIGHT. */
export const PRESETS = Object.freeze({
  desktop: { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  laptop: { name: 'laptop', width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  tablet: { name: 'tablet', width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  mobile: { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
});

/**
 * @typedef {{ name: string, width: number, height: number, isMobile: boolean, hasTouch: boolean, deviceScaleFactor: number }} Viewport
 */

/**
 * @param {string} spec  "desktop" | "1024x768" | "wide=1920x1080"
 * @returns {Viewport}
 */
export function parseViewport(spec) {
  const s = String(spec).trim().toLowerCase();
  if (s in PRESETS) return { ...PRESETS[/** @type {keyof typeof PRESETS} */ (s)] };
  const m = s.match(/^(?:([a-z][\w-]*)=)?(\d{2,5})x(\d{2,5})$/);
  if (!m) throw new CopycatError(`Invalid viewport "${spec}"`, EXIT.USAGE, `Use a preset (${Object.keys(PRESETS).join(', ')}) or WIDTHxHEIGHT.`);
  const width = Number(m[2]);
  const height = Number(m[3]);
  if (width < 200 || height < 200 || width > 7680 || height > 4320) throw new CopycatError(`Viewport out of range: ${spec}`, EXIT.USAGE);
  const mobile = width < 900;
  return { name: m[1] ?? `${width}x${height}`, width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 };
}

/** @param {string[]} specs */
export function parseViewports(specs) {
  const list = (specs.length ? specs : ['desktop']).map(parseViewport);
  const seen = new Set();
  return list.filter((v) => (seen.has(v.name) ? false : (seen.add(v.name), true)));
}
