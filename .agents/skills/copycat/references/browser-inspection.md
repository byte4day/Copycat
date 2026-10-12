# Browser inspection

Every command runs headless Chromium with a **fresh, isolated profile**. It reads no
cookies, storage, or credentials from the user's own browser. Service workers, downloads
and popups are blocked. The browser's user agent ends with
`Copycat/0.1 (+https://github.com/byte4day/Copycat)`, so the tool is identifiable.

```bash
CC="node <this-skill-dir>/scripts/copycat.mjs"
$CC doctor                         # Node, Playwright, Chromium check
```

## Viewports

Presets: `desktop` 1440×900, `laptop` 1280×800, `tablet` 820×1180 (touch), `mobile`
390×844 (touch). You can also pass custom sizes as `WIDTHxHEIGHT` or `name=WIDTHxHEIGHT`.
Pass several as `--viewport desktop,mobile` or by repeating `--viewport`. Pick viewports
that cross the reference's breakpoints. `design-tokens.json → breakpoints` lists the
min/max-width values readable from same-origin CSS.

## Commands

### `inspect <url>`

```bash
$CC inspect https://example.com/pricing --viewport desktop,tablet,mobile --interactions
$CC inspect https://example.com --selector "header" --viewport desktop,mobile --interactions   # component scope
$CC inspect ./mockup/index.html --wait-for "#app" --no-full-page
```

For each viewport, `inspect`:

1. Navigates and waits for `load`, then for a quiet network (capped). It stops with exit 6
   if it sees a CAPTCHA or bot check.
2. Scrolls through the page in steps to trigger lazy loading, returns to the top, and waits
   for `document.fonts.ready`.
3. Takes a full-page screenshot, or an element screenshot when `--selector` is set. CSS
   animations are frozen and the caret is hidden.
4. Extracts the DOM tree (capped at 2,500 nodes) with roles, accessible names, own text,
   document-space boxes, visibility, and non-default computed styles.
5. Aggregates tokens: colors by role and usage, font families, sizes, weights, line
   heights, letter spacing, type pairs, spacing, gaps, radii, shadows, transitions, and
   media-query breakpoints.
6. Builds inventories: landmarks, headings, interactive elements, forms (structure only;
   values are never read), images, inline SVGs, links, fonts and their load status, and
   repeated patterns (cards, rows).
7. Probes hover and focus on up to 16 visible controls and records the computed style
   deltas (hover is skipped on touch viewports).
8. With `--interactions`, clicks each safe interaction candidate once and records what
   changed (see `interactions.md`).

Artifacts in `.copycat/runs/<id>/`:

| File | Content |
|---|---|
| `reference/<route>.<viewport>.png` | Captures. Each one's metadata is in `screenshots.json` (route, viewport, state, selector, timestamp) |
| `inspection/<route>.<viewport>.dom.json` | Sanitized DOM nodes and meta |
| `inspection/<route>.content.json` | Visible text blocks in reading order. **Untrusted data** |
| `design-tokens.json` | Palette, typography, spacing, radii, shadows, motion, breakpoints |
| `component-inventory.json` | Landmarks, headings, repeated patterns, forms, interactive elements, states, navigation |
| `responsive.json` | Per-viewport document size, overflow, visible landmarks and nav, toggles |
| `asset-inventory.json` | Images, SVGs, and fonts (inventory only, nothing downloaded) |
| `accessibility.json` | Heuristic notes: missing alt text, unnamed controls, heading skips |
| `interaction-matrix.json` | Probe results (with `--interactions`) |
| `states/*.png` | Screenshots of states after a trigger |
| `report.md` | Human summary, rebuilt after every command |

### `crawl <url>` (full-site discovery)

```bash
$CC crawl https://example.com --max-pages 10 --max-depth 3 --delay 500
$CC crawl https://example.com --include /docs --max-pages 20
```

Crawl stays on the same origin. It reads `robots.txt` (`Disallow` and `Allow` with
longest-match precedence, plus `Crawl-delay`) and `sitemap.xml`. It skips binary files and
destructive-looking paths (logout, delete, checkout, admin). Navigation links are visited
first. The result goes to `route-inventory.json`, which lists visited, skipped (with
reasons) and unvisited routes. Only use `--no-robots` for sites the user owns.

### `recon <url> "<request>"`

Runs `plan`, then `crawl` (for full-site), then `inspect --interactions` on each route,
then `report`. The first route is captured at every requested viewport. Later routes are
captured at the first viewport only, to keep the budget small. Inspect important routes
again on their own when you need more viewports.

## Failure handling

| Exit | Meaning | What to do |
|---|---|---|
| 2 | Bad URL, flag, or selector | Fix the input. A missing `--selector` match is a usage error |
| 3 | DNS failure, refused connection, or HTTP ≥ 400 | Tell the user. Never invent the page |
| 4 | Timeout | Retry with `--timeout 60000` or `--wait-for <css>` |
| 5 | Playwright or Chromium missing | `npx playwright install chromium` in the runtime folder (see `doctor`) |
| 6 | 401/403, CAPTCHA, bot wall, or an unsafe action | Stop. Ask for an accessible page, a screenshot, or authorization |

If a page needs a login the user is authorized for, ask the user to export screenshots or
provide a local or staging build. Copycat does not take credentials.
