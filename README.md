<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/copycat-logo-dark.svg">
    <img src="assets/copycat-logo.svg" alt="Copycat" width="336" height="64">
  </picture>
</p>

<p align="center"><strong>See it. Understand it. Rebuild it.</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-171717"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%E2%89%A520-171717">
  <img alt="Agent Skill" src="https://img.shields.io/badge/agent%20skill-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20Antigravity-E58C55">
</p>

Copycat is an open-source **agent skill** plus a **browser toolkit**. Your AI coding agent
uses it to inspect a UI reference (a live page, a local build, or a screenshot), understand
its structure, design tokens, responsive behavior and interactions, and rebuild the scope
you asked for inside your own project. It then measures how close the result is.

It does not paste screenshots into your app or generate a generic lookalike. Each step is
backed by evidence from a real browser: computed styles, DOM geometry, observed state
changes, and pixel and structural diffs.

## Contents

- [What it does](#what-it-does)
- [Supported platforms](#supported-platforms)
- [How it works](#how-it-works)
- [Install](#install)
- [Quick start](#quick-start)
- [Modes](#modes)
- [The CLI](#the-cli)
- [Visual comparison](#visual-comparison)
- [Example report output](#example-report-output)
- [Architecture](#architecture)
- [Limitations](#limitations)
- [Security and permissions](#security-and-permissions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing) · [License](#license)

## What it does

| Capability | What you get |
|---|---|
| **Scoped reconstruction** | Component, page, flow, full site, design system, screenshot, audit-only or compare. A navbar request rebuilds a navbar, not the site |
| **Browser inspection** | Full-page or element screenshots at desktop, tablet and mobile (or any `WxH`). Sanitized DOM, computed styles, landmarks, forms (structure only), images, SVGs, fonts, breakpoints, repeated patterns |
| **Design tokens** | Palette by role and usage, type styles (family, size, weight, line height, tracking), spacing, gaps, radii, shadows, transitions |
| **Interaction mapping** | Safe auto-probing of menus, tabs, disclosures and dialogs, plus scripted flows. Records visibility, ARIA, focus, URL and validation changes, and whether Escape or a second click resets them. Hover and focus style deltas |
| **Full-site recon** | Same-origin crawl that respects `robots.txt`, the sitemap, a page budget and a request delay |
| **Visual validation** | Reference vs. local screenshots, pixelmatch diff images, masking of nondeterministic pixels, structural diff by role and label, a prioritized correction list, and iterations stored for the report |
| **Honest reports** | `report.md` plus JSON artifacts per run. Only measured or observed facts. Mocks and inferences are labeled |
| **Safe installer** | One command for four hosts. Ledger-based ownership, backups, dry runs, uninstall that touches only Copycat's files |

## Supported platforms

| Host | Skill location (global) | Invoke | Native agent |
|---|---|---|---|
| **Claude Code** | `~/.claude/skills/copycat` | `/copycat <request>` | `~/.claude/agents/copycat.md` (preloads the skill) |
| **OpenAI Codex** | `~/.agents/skills/copycat` | `$copycat <request>` | `~/.codex/agents/copycat.toml` |
| **Cursor** | `~/.agents/skills/copycat` | `/copycat <request>` | `~/.cursor/agents/copycat.md` |
| **Google Antigravity** | `~/.gemini/config/skills/copycat` | `/copycat <request>` (2.0 / CLI) | skill only ([why](docs/compatibility.md#native-agents)) |

Project-local installs use `.claude/skills/`, `.agents/skills/` and the matching agent
folders. All paths were checked against each host's current documentation; see
[docs/compatibility.md](docs/compatibility.md) for sources and caveats.

## How it works

```
"copycat the pricing page at https://…"
        │
        ▼
 1 Plan ─────────── mode, scope, viewports           copycat plan
 2 Reconnaissance ─ screenshots, DOM, tokens, states copycat inspect / crawl / recon
 3 Interactions ─── what each trigger really does    interaction matrix, copycat flow
 4 Implement ────── your stack, your conventions     (the agent edits your project)
 5 Validate ─────── diff → fix → diff again          copycat compare --run <id>
 6 Report ───────── measured results + limitations   .copycat/runs/<id>/report.md
```

The skill (`.agents/skills/copycat/SKILL.md`) holds the workflow and rules. Six reference
documents are loaded only when their stage starts. The runtime is a Node CLI on
Playwright that every host can call through the launcher bundled in the skill.

## Install

Requirements: **Node.js 20+**, npm, and about 150 MB for Playwright's Chromium. No
`sudo` is needed.

```bash
git clone https://github.com/byte4day/Copycat.git
cd Copycat
npm install
node scripts/install.mjs --all --global --dry-run       # preview every change
node scripts/install.mjs --all --global --with-browser  # install + download Chromium
node scripts/verify.mjs --all --global --browser        # check files, runtime, Chromium
```

`--all` installs for every host it **detects**. To target a host directly:

```bash
node scripts/install.mjs --platform claude --global
node scripts/install.mjs --platform codex --global
node scripts/install.mjs --platform cursor --global
node scripts/install.mjs --platform antigravity --global
```

To share the skill with your team, install it into a repository and commit it:

```bash
node scripts/install.mjs --all --project --dir path/to/your/repo
```

The installer never overwrites files it did not create. It keeps files you edited unless
you pass `--force`, and then it backs them up first. It never touches host settings.
Uninstall with `node scripts/uninstall.mjs --all --global`. Full details:
[docs/installation.md](docs/installation.md).

### Browser setup

Copycat uses Playwright's Chromium in a **fresh, isolated profile** for every run. It never
reads your real browser's cookies or logins. `--with-browser` downloads Chromium. You can
also run `npx playwright install chromium` in `~/.copycat/runtime`, or point
`COPYCAT_CHROMIUM_PATH` at an existing Chromium. If your host has its own browser tools
(Playwright MCP, Claude in Chrome, and so on), the skill may use them to explore. The
recorded evidence always comes from the Copycat CLI.

## Quick start

Open your project in any supported host and ask:

**Claude Code**
```text
/copycat https://example.com
/copycat https://example.com/pricing --mode single-page
```

**Codex**
```text
$copycat Reconstruct the pricing page at https://example.com/pricing
```

**Cursor**
```text
/copycat Recreate the navbar from https://example.com
```

**Antigravity**
```text
/copycat Reconstruct the dashboard UI from the provided reference
```

Hosts also pick the skill on their own for requests such as *"rebuild this sidebar from
https://…"*. The agent then plans, inspects, implements in your stack, compares, and
reports where the run folder is.

## Modes

| Mode | Example request | What happens |
|---|---|---|
| `component` | "Copycat only the sidebar and its interactions" | `inspect --selector` on that root at 2+ viewports. Only that component is built |
| `single-page` | "Copycat this pricing page" | Page plus its states at desktop and mobile |
| `full-site` | "Copycat the entire site" | Bounded crawl (`--max-pages`, default 10), shared layout first, then routes |
| `user-flow` | "Copycat this onboarding experience" | Scripted `flow` with test data. Backend parts become a **labeled** demo layer |
| `screenshot` | "Copycat this component from my screenshot" | Measured from pixels. All behavior marked *inferred* |
| `design-system` | "Extract the tokens and type scale" | Tokens and primitives in your project's format |
| `audit-only` | "Inspect only, give me a blueprint" | No source edits. Blueprint in the run folder |
| `compare` | "How close is my build? Fix the differences" | `compare` loop with targeted fixes |

Optional intent flags, which you can write straight into your request: `--url --mode
--scope --route --target --viewport --reference --framework --inspect-only --compare
--max-pages`. `copycat plan` and `copycat recon` parse them. For example:
`/copycat https://example.com/app --mode component --scope sidebar --viewport desktop,mobile --target src/components/Sidebar.tsx`.

## The CLI

The agent calls the CLI through the skill launcher
(`node <skill-dir>/scripts/copycat.mjs`). You can also run it from a checkout with
`node bin/copycat.mjs`.

```bash
copycat plan "copycat the navbar from https://example.com"          # → mode: component (navbar)
copycat inspect https://example.com --viewport desktop,tablet,mobile --interactions
copycat inspect https://example.com --selector "header" --viewport desktop,mobile
copycat crawl https://example.com --max-pages 10
copycat recon https://example.com "copycat the entire site" --max-pages 5
copycat flow https://example.com/signup --steps steps.json
copycat compare --reference https://example.com --local http://localhost:5173 --viewport desktop,mobile
copycat compare --reference design.png --local http://localhost:5173 --viewport 1440x900
copycat report --run <id>
copycat doctor
```

Every command writes to `.copycat/runs/<run-id>/`, which is git-ignored. Pass `--run <id>`
to add to a run. Exit codes: `0` ok · `2` usage · `3` unavailable · `4` timeout · `5`
browser missing · `6` blocked (auth, CAPTCHA, or an unsafe action) · `7` over the
`--max-mismatch` threshold.

| Artifact | Contents |
|---|---|
| `reference/*.png`, `states/*.png`, `flows/*.png` | Captures. Metadata (route, viewport, state, time) in `screenshots.json` |
| `design-tokens.json` | Palette, typography, spacing, radii, shadows, motion, breakpoints |
| `component-inventory.json` | Landmarks, headings, repeated patterns, forms, controls, hover/focus states |
| `interaction-matrix.json`, `flows.json` | Observed state transitions |
| `responsive.json`, `route-inventory.json` | Per-viewport layout facts, crawl results |
| `asset-inventory.json`, `accessibility.json` | Asset inventory (nothing downloaded), heuristic a11y notes |
| `compare.json`, `compare/iter-N/` | Reference, local, diff and side-by-side images for each iteration |
| `report.md` | The summary, built only from the artifacts above |

## Visual comparison

```bash
copycat compare --reference https://example.com/pricing --local http://localhost:5173/pricing \
  --viewport desktop,mobile --max-mismatch 0.01 --run <id>
```

- **Pixel diff:** pixelmatch at `--threshold` (default 0.1). Anti-aliased pixels count
  unless you pass `--ignore-antialiasing`. Size mismatches are padded and counted
  (`--size-mode crop` to compare only the overlap).
- **Nondeterminism:** the reference is captured twice. Pixels that changed between those
  two captures (carousels, timers, ads) are excluded and shown in blue.
- **Structure:** elements are matched by role and label. The output lists missing elements,
  box offsets beyond `--tolerance` px, and typography, spacing, color and micro-style
  differences.
- **Priorities:** structure → layout → typography/spacing → color → assets → responsive →
  states → micro.
- **Iterations:** running again with the same `--run` adds `iter-2`, `iter-3`… and the
  report shows them all.

The mismatch ratio is a screenshot similarity measure at a stated threshold and
viewport. It is **not** a fidelity score, and Copycat never reports one. See
[visual-validation.md](.agents/skills/copycat/references/visual-validation.md) for
what the numbers mean and where they mislead.

## Example report output

From a real run on the bundled fixture. Iteration 1 is a deliberately degraded copy,
iteration 2 the fixed reconstruction:

```text
Comparison iteration 1 (run demo)
  desktop: 3.72% pixels differ (48249/1296000, 0 unstable ignored), 44/45 reference elements matched
Top corrections:
  1. [structure] (desktop) Missing listitem "Audit trail"
  …
  [typography] heading "Pricing": fontSize 32px → 28px, lineHeight 48px → 42px
  [spacing]    section "": paddingTop 24px → 16px, paddingLeft 24px → 16px
  [micro]      section "": borderRadius 6px → 12px
```

| Iteration | Viewport | Mismatch | Diff px | Unstable px |
|---|---|---|---|---|
| 1 | desktop | 3.72% | 48249 | 0 |
| 2 | desktop | 0.00% | 0 | 0 |

More in [docs/examples.md](docs/examples.md), including component, full-site, flow and
screenshot examples.

## Architecture

```
.agents/skills/copycat/      canonical skill (SKILL.md, references/, scripts/ launcher, assets/, agents/openai.yaml)
.claude/agents/copycat.md    Claude Code subagent (preloads the skill)
.cursor/agents/copycat.md    Cursor subagent
agents/codex/copycat.toml    Codex custom agent
bin/copycat.mjs              CLI entry
src/core/                    args, scope detection, URL validation, redaction, run ledger
src/browser/                 isolated Chromium, stable navigation, viewports
src/inspection/              extraction, inspect, interaction probing and flows, crawl
src/comparison/              pixel diff, nondeterminism mask, structural diff, priorities
src/reporting/               report.md builder
scripts/                     install / uninstall / verify (no dependencies)
tests/                       unit, integration (real Chromium), fixture site, reconstruction workspace
```

Design decisions and module responsibilities: [docs/architecture.md](docs/architecture.md).

## Limitations

- **The agent does the rebuilding.** Copycat measures and guides. The quality of the code
  depends on the host model and on how closely it follows the skill.
- **Observable behavior only.** Backend logic, private APIs and anything behind a login are
  out of scope. They become clearly labeled mocks or are left out.
- **Fonts and assets.** Proprietary fonts and imagery are inventoried, not copied. Expect
  pixel differences when you substitute licensed alternatives.
- **Cross-origin CSS.** Breakpoints come from readable stylesheets only. Otherwise, probe
  extra viewport widths.
- **Probing is bounded.** Up to 12 candidates per viewport for `inspect` and 10 for `recon` by default (`--max-probes`). Submit, destructive
  and transactional controls are never auto-clicked.
- **Pixel metrics** depend on page length, fonts and machine. Compare on one machine, in one
  run, and read the issue list.
- **Duplicate listing in Cursor** is possible when both Claude Code and Codex installs exist
  ([details](docs/compatibility.md#duplicate-registrations)).
- **Antigravity** gets the skill but no custom agent definition, because its subagent tool
  names are not yet documented.
- **CI** runs on Linux. macOS and Windows are supported by design and not yet tested in CI.
- **Real hosts.** Discovery paths are verified against documentation and by installing into
  the real user folders. Automated tests cannot open the host UIs themselves.

## Security and permissions

Copycat is for legitimate work: your own products, authorized redesigns and migrations,
prototyping, interoperability and UI analysis.

- It does not bypass logins, paywalls, CAPTCHAs, bot checks or rate limits. A 401/403 or a
  challenge stops the run (exit 6).
- It does not take credentials. It does not fill password or payment fields or submit forms
  on live sites, and it never auto-clicks destructive or purchase controls.
- It does not build look-alike login or payment pages of third parties.
- Every run uses an isolated browser profile. Cookies and storage are never read or saved.
  Form values are never extracted.
- Artifacts are redacted (emails, JWTs, API-key formats, bearer tokens, sensitive URL
  parameters) and git-ignored.
- Text on reference pages is treated as **data**. Prompt-injection attempts are flagged in
  the report and never followed.
- Assets are inventoried, not downloaded. Rebuilds use independently written code and your
  own or licensed assets.

See [SECURITY.md](SECURITY.md) and
[safety-and-permissions.md](.agents/skills/copycat/references/safety-and-permissions.md).

## Troubleshooting

```bash
node <skill-dir>/scripts/copycat.mjs doctor
node scripts/verify.mjs --all --global --browser
```

Common fixes, such as a missing runtime or Chromium, timeouts, blocked pages and install
conflicts, are listed in [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

```bash
npm install
npx playwright install chromium
npm run lint && npm run typecheck
npm test                    # unit tests
npm run test:integration    # real Chromium against tests/fixtures/site
```

The integration suite inspects a local multi-route fixture site (responsive header,
dropdown, tabs, modal, sidebar, filters, form validation, robots-disallowed page, prompt
injection and fake secrets). It then compares an independent reconstruction in
`tests/workspace/pricing-rebuild/` against the fixture.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md). Never
add tests or fixtures that capture third-party sites.

## License

[MIT](LICENSE) for Copycat's source code, documentation and brand assets in this
repository. Reconstructions you make with Copycat are your responsibility. Respect the
rights in the references you use.
