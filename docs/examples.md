# Examples

All output below is real CLI output from the bundled fixture site
(`tests/fixtures/site`, served locally). Paths are shortened.

## Invoking the skill

| Host | Example |
|---|---|
| Claude Code | `/copycat https://example.com` · `/copycat https://example.com/pricing --mode single-page` |
| Codex | `$copycat Reconstruct the pricing page at https://example.com/pricing` |
| Cursor | `/copycat Recreate the navbar from https://example.com` (or the `copycat` subagent: `/copycat` agent, "use the copycat subagent to …") |
| Antigravity | `/copycat Reconstruct the dashboard UI from the provided reference` (2.0 / CLI). In the IDE, describe the task and the agent picks the skill |

All hosts also load the skill on their own when a request matches its description, for
example "rebuild this sidebar from https://…".

## Component only

> Copycat only the sidebar and its interactions from http://localhost:4173/dashboard.html

The agent runs:

```bash
CC="node ~/.claude/skills/copycat/scripts/copycat.mjs"
$CC plan "Copycat only the sidebar and its interactions from http://localhost:4173/dashboard.html"
# mode: component (component: sidebar)
$CC inspect http://localhost:4173/dashboard.html --selector "aside.sidebar" --viewport desktop,mobile --interactions
```

Only the `<aside>` subtree is captured and analyzed. The rest of the page is not rebuilt.

## Single page with interactions

```text
$ copycat inspect http://127.0.0.1:4173/pricing.html --viewport desktop,mobile --interactions
Inspected http://127.0.0.1:4173/pricing.html at desktop, mobile
run: .copycat/runs/example
screenshots: reference/pricing-html.desktop.png, reference/pricing-html.mobile.png
palette: #5f6b7a #1f2933 #ffffff #0f6e5c #d9dee5
fonts: Georgia, "Times New Roman", serif
landmarks: header, nav, main, footer · interactive: 17 · candidates: 4
interactions probed: 8
```

From the resulting `report.md`:

| Viewport | Trigger | Kind | Result | Reset |
|---|---|---|---|---|
| desktop | Products | menu | shows 7 element(s); aria-expanded: false→true; moves focus | escape |
| desktop | Yearly | tab | aria-selected: true→false; aria-selected: false→true; moves focus | reload |
| desktop | Contact sales | dialog-trigger | opens dialog; shows 5 element(s); moves focus | escape |
| mobile | Menu | menu | shows 6 element(s); aria-expanded: false→true; moves focus | second-click |

## Full site

```bash
copycat recon "copycat the entire site http://127.0.0.1:4173/" --max-pages 10
```

The crawl reads `robots.txt` and the sitemap. In the fixture it skips
`/private/secret.html` (disallowed by robots), merges `/` and `/index.html`, then inspects
each route.

## User flow (test data only)

```json
[
  { "action": "click", "selector": "#signup-form button[type=submit]", "name": "submit empty" },
  { "action": "fill", "selector": "#name", "value": "Test User" },
  { "action": "fill", "selector": "#email", "value": "test.user@example.test" },
  { "action": "select", "selector": "#team", "value": "6–20" },
  { "action": "click", "selector": "#signup-form button[type=submit]", "name": "submit valid" }
]
```

```text
$ copycat flow http://127.0.0.1:4173/signup.html --steps signup.json
ok   [desktop] 1. click #signup-form button[type=submit] → shows 3 element(s); aria-invalid: ∅→true; … message: "Enter your full name."
…
ok   [desktop] 5. click #signup-form button[type=submit] → shows 1 element(s); hides 10 element(s); aria-invalid: true→false; …
```

## Screenshot reference

```bash
copycat compare --reference ./design/pricing.png --local http://localhost:5173/pricing --viewport 1440x900
```

Only pixel metrics are available, because a screenshot has no DOM. The skill labels every
interaction as *inferred*.

## Visual comparison loop

This is a deliberately degraded copy of the bundled reconstruction (one list item removed,
heading size, card padding and radius changed):

```text
$ copycat compare --reference http://127.0.0.1:4173/pricing.html --local ./degraded/index.html --viewport desktop
Comparison iteration 1 (run example)
  desktop: 3.72% pixels differ (48249/1296000, 0 unstable ignored), 44/45 reference elements matched → compare/iter-1/diff.desktop.png
Top corrections:
  1. [structure] (desktop) Missing listitem "Audit trail"
  2. [layout] (desktop) body "" offset/size Δ x0 y0 w0 h-22px
  …
```

The full issue list also includes the typography, spacing and micro differences that were
introduced:

```text
[typography] heading "Pricing": fontSize 32px → 28px, lineHeight 48px → 42px
[spacing]    section "": paddingTop 24px → 16px, …
[micro]      section "": borderRadius 6px → 12px
```

After the fixes, running the same command with `--run example` adds iteration 2, and
`report.md` shows both iterations. The bundled reconstruction
(`tests/workspace/pricing-rebuild/`) measures 0.00% pixel mismatch, with 100% of
structural elements matched, at desktop and mobile. That happens because the fixture's
fonts and values are fully known. It is not a claim about arbitrary websites.

## Example report

An unedited excerpt of `report.md` from a real run. It used `plan`, `inspect --interactions`,
`compare` against the degraded copy (iteration 1), then `compare` against the fixed
reconstruction (iteration 2), all with `--run demo`. Screenshot, component and artifact
sections are omitted here.

````markdown
# Copycat report — demo

Generated 2026-10-12T16:28:15.948Z from artifacts in this run folder. Only observed and measured facts are listed; anything inferred is labelled.

## Requested scope

- Mode: **single-page**
- Request: “Copycat this pricing page http://127.0.0.1:4173/pricing.html”
- References: http://127.0.0.1:4173/pricing.html
- Viewports: desktop, mobile
- Why mode: single reference page

## Inspected references

| URL | Scope | Viewports | DOM nodes | Interactions probed |
|---|---|---|---|---|
| http://127.0.0.1:4173/pricing.html | page | desktop | 66 | 4 |

## Design tokens (measured)

Palette (by usage): `#5f6b7a` (text), `#1f2933` (text/background), `#ffffff` (text/background), `#0f6e5c` (text/background/border), `#d9dee5` (border)
Font families: `Georgia, "Times New Roman", serif`
Type sizes: 16px, 14px, 15px, 30px, 20px, 24px, 36px, 32px
Spacing: 24px, 8px, 16px, 18px, 6px, 19.92px, 10px, 3px, 14px, 48px, 4px, 64px
Radii: 6px, 4px · Shadows: 0
Breakpoints from CSS: max:600, max:760, max:900, max:1000

Full data: [design-tokens.json](design-tokens.json)

## Interactions observed

| Viewport | Trigger | Kind | Result | Reset |
|---|---|---|---|---|
| desktop | Products | menu | shows 7 element(s); aria-expanded: false→true; moves focus | escape |
| desktop | Monthly | tab | moves focus | — |
| desktop | Yearly | tab | aria-selected: true→false; aria-selected: false→true; moves focus | reload |
| desktop | Contact sales | dialog-trigger | opens dialog; shows 5 element(s); moves focus | escape |

## Visual comparison

mismatchRatio = differing pixels / compared pixels at the given pixelmatch threshold, excluding pixels that changed between two captures of the reference. It is a screenshot similarity measure, not a fidelity score.

| Iteration | Viewport | Mismatch | Diff px | Unstable px | Sizes (ref → local) | Diff image |
|---|---|---|---|---|---|---|
| 1 | desktop | 3.72% | 48249 | 0 | 1440×900 → 1440×900 | [diff](compare/iter-1/diff.desktop.png) |
| 2 | desktop | 0.00% | 0 | 0 | 1440×900 → 1440×900 | [diff](compare/iter-2/diff.desktop.png) |

Latest iteration 2: no threshold set.

No structural or pixel-region issues above the configured tolerances.
````
