# Design analysis

Turn measurements into a design specification before you write code. Work from
`design-tokens.json`, `component-inventory.json`, `responsive.json`, the DOM JSON, and the
screenshots. Look at the screenshots (open the PNGs) as well as the numbers.

## Tokens

Start with `copycat tokens --run <id>`. It writes `tokens.css` (or a Tailwind v4 `@theme`
with `--format tailwind`): every measured color, size, space, radius and shadow under a
suggested name. Then refine the names with the rules below.

- **Color:** `palette` is sorted by usage weight and tagged with roles (`text`,
  `background`, `border`). Map them to semantic names (`--text`, `--text-muted`,
  `--surface`, `--border`, `--accent`) based on where they appear, not on how often. Hover
  and selected colors come from `component-inventory.json → states[].hover/focus`.
- **Typography:** `typography.styles` lists the real (family, size, weight, line-height,
  letter-spacing) combinations with sample text and tags. Each distinct style is a
  text-style token. Keep line heights in px or as the measured ratio. Check
  `loadedFonts[].status`. `unloaded` means the font was declared but never used, or failed
  to load.
- **Spacing:** `spacing` and `gaps` show the scale in use (for example 4/8/16/24/48). Build
  the scale from the values that actually appear. Do not snap to an unrelated 8-pt system.
- **Radii, shadows, motion:** copy the measured values. If `transitions` is empty, the
  reference has no CSS transitions, so add none.

When the project already has tokens (Tailwind config, CSS variables, a theme object), map
reference values onto them. Add new tokens only where nothing in the project is close.

## Layout

From the DOM JSON, read the container widths (`maxWidth`, the box widths of wrappers),
paddings, and `display` values. Look for `grid` with `gridTemplateColumns`, and `flex` with
direction, gap, and alignment. Record:

- Page shell: max width, side padding, header height, and whether it is sticky or fixed (`position`).
- Section rhythm: vertical paddings and margins between sections.
- Grids: column count at each viewport. `responsive.json → repeatedLayouts` shows item
  width per viewport.
- Overflow: `responsive.json → horizontalOverflow` must stay `false` on mobile, unless the
  reference overflows too.

## Responsive rules

Compare viewports side by side:

- Which landmarks or nav links disappear (`visibleLandmarks`, `visibleNavLinks`)?
- Which toggles appear on small screens (`toggles`, such as a hamburger menu)?
- How the type scale changes (`perViewportTypeScale`).
- The breakpoints from CSS (`breakpoints`). When the CSS is cross-origin and unreadable
  (`inaccessibleStylesheets > 0`), find breakpoints by capturing extra widths
  (`--viewport 1024x800,768x1024`).

## Component split

Use landmarks, repeated patterns, and interaction candidates to split the UI into
components: shell (header, nav, footer, sidebar), sections, repeated items (card, row,
plan), and interactive widgets (menu, tabs, dialog, form). Name them in the project's
style. Every repeated pattern with `count ≥ 3` should be one component rendered from data.

## Screenshot-only references

With only an image, measure from the pixels. Image width maps to viewport width. Sample
colors from flat areas. Estimate type size from cap height (cap height ≈ 0.7 × font size
for most sans-serif faces). Label every value in `implementation-notes.md` as *estimated
from screenshot*. Treat every interaction as *inferred*.
