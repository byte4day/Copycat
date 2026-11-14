# Changelog

## 0.4.0 — 2026-11-14

### Added
- **`copycat tokens`**: exports a run's measured tokens under suggested names as CSS variables (`tokens.css`) or a Tailwind v4 `@theme` block (`--format tailwind`), plus `tokens.named.json`. `--from` picks another scope's token file, `--prefix` the variable prefix.
- **`compare --steps <file> [--local-steps <file>]`**: runs scripted steps on both sides before capture, so a state (open menu, dialog, selected tab) is measured, not only the default page. Same safety rules as `flow`; a failing step stops the compare.
- **Zoomed region crops**: the three largest differing regions of each viewport are written as `compare/iter-N/region-<n>.<viewport>.png` (reference | local | diff at full size) and linked from the issue list and the report.
- **Accessibility outline**: `inspect` saves `inspection/<name>.<viewport>.aria.yml` (roles, accessible names, nesting; redacted), a compact structural summary to read before the DOM dump.
- **`--color-scheme light|dark` and `--reduced-motion`** on `inspect`, `recon`, `flow` and `compare`. A dark pass in the same run gets its own `<name>--dark` artifacts.

### Fixed
- A second `inspect` in the same run (another route of a full-site `recon`, a component, a dark pass) replaced `design-tokens.json`, `component-inventory.json`, `responsive.json`, `asset-inventory.json` and `accessibility.json` with its own data, so a full-site report described the last crawled page. Top-level files now belong to the first scope; later scopes write `inspection/<name>.*.json`.
- A component inspect overwrote the page's `dom.json` on the same route, and two components on one route overwrote each other's screenshot. Each scope now has its own artifact name.
- Colors authored as `oklch()`, `lab()`, `color()` or `color-mix()` were dropped from the palette and reported as false color differences by `compare`. They are converted to `rgb()` during extraction.
- `compare --reference design.jpg` opened the image in the browser's viewer and "compared" it. Non-PNG image references, and images passed to `inspect`, `recon`, `flow` or `crawl`, are now usage errors.
- `--max-mismatch 5` was accepted and could never fail. The gate must be a ratio from 0 to 1; negative `--timeout` and `--tolerance` are rejected too.
- `--size-mode crop` discarded the stability mask but still reported `stabilityCheck: true`. A recapture taller than both screenshots silently disabled the mask in pad mode. The mask is now built on the compared canvas in both modes.
- `press` with Enter (or Space on a button) submitted forms on non-local references without `--allow-submit`, because steps without a selector skipped the safety guard.
- `report --run <typo>` created an empty run and reported on it. `report` without `--run` picked the last run by name instead of the most recently updated one.
- An invalid `--run` id, a missing steps file and a steps file with invalid JSON ended in a stack trace with exit 1. They are usage errors (exit 2) now, and refused commands no longer leave an empty run folder behind.
- `flow --label ../x` wrote screenshots outside the run folder. Labels must be plain names.
- A `wait` step with a selector failed after 5 seconds with "Selector not found", whatever the step timeout was.
- Two triggers with the same label ("Details", "Learn more") overwrote each other's state screenshot.
- Re-running a flow or re-inspecting a scope in the same run appended duplicate rows to `flows.json`, `screenshots.json` and `interaction-matrix.json`.
- Crawl: sitemap entries skipped the file-type and destructive-path filters; a start URL that redirects to another origin (`http` → `https`, apex → `www`) yielded a one-page crawl and was checked against the wrong `robots.txt`; redirect targets could be listed twice; `unvisited` contained duplicates.
- Local files were named after their full absolute path cut at 60 characters, so two files in one project could share artifact names. They use their last two path segments.
- The user agent said `Copycat/0.1` in every release. It now carries the package's major.minor version.
- Installer: reinstalling an unchanged runtime with `--skip-npm` reported "update (code changed)" every time.
- Tests: the component compare test assumed Georgia's glyph widths and failed on machines without that font.

## 0.3.0 — 2026-11-10

- Align docs and agent metadata with the [Agent Skills](https://agentskills.io/) open standard and Nov 2026 host docs.
- Prefer `model: inherit` on Claude Code and Cursor native agents; document Claude aliases including `fable` and current GPT-6 lines.
- Refresh Cursor skills/subagents URLs; note OpenCode can load `.agents/skills` when Agent Skills are supported.
- Bump managed agent markers to v0.3.0. CLI and browser pipeline behavior unchanged.
