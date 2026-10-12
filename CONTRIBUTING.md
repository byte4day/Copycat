# Contributing to Copycat

Thanks for helping. Copycat's value depends on two things: **measuring honestly** and
**staying safe**, so contributions are reviewed with both in mind.

## Setup

```bash
git clone https://github.com/byte4day/Copycat.git && cd Copycat
npm install
npx playwright install chromium
npm run check          # lint + typecheck + unit + integration
```

## Ground rules

- **No third-party captures in the repo.** Tests and fixtures must use the local fixture
  site (`tests/fixtures/site`) or new fictional fixtures. No screenshots of real websites.
- **No fake passes.** Tests run the real CLI against real Chromium. Do not mock the browser
  to make an integration test pass.
- **Measured, not invented.** New metrics must be defined in
  `references/visual-validation.md`, including their limits. Do not add "scores" that hide
  what was measured.
- **Safety guards stay on by default.** Changes that relax authorization, form-submission,
  redaction or robots behavior need a clear reason and tests.
- **Keep SKILL.md small.** Put detail in `references/`. SKILL.md must stay under 500 lines
  and pass `node scripts/verify.mjs --source`.
- **Platform claims need sources.** When you change an install path or a host feature,
  update `docs/compatibility.md` with a link to the official documentation.

## Code style

- ESM JavaScript with JSDoc types, checked by `tsc` (`npm run typecheck`), and ESLint.
- Functions that run inside the page (`src/inspection/extract.mjs`) must be self-contained.
  Playwright serializes them.
- Every file Copycat writes goes through `Run.writeJson` (redacted) or the installer
  ledger.

## Adding a fixture scenario

1. Add or extend a page in `tests/fixtures/site/` (fictional content only).
2. Add an integration test in `tests/integration/` that runs the CLI against it.
3. If it exercises reconstruction, add the independently written rebuild under
   `tests/workspace/`.

## Commits and PRs

Use small, focused commits with imperative subjects. Describe what you verified (commands
run) in the PR.
