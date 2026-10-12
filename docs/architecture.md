# Architecture

Copycat has two halves:

1. **The skill** (`.agents/skills/copycat/`). Portable instructions every host can load:
   routing, workflow, quality bar, safety rules, and reference documents that are loaded
   only when a stage needs them.
2. **The runtime** (`bin/`, `src/`). A Node CLI built on Playwright that produces repeatable
   evidence: screenshots, sanitized DOM, tokens, interaction observations, comparisons and
   reports.

The agent does the reasoning and writes the code. The runtime does the measuring.

```
user request
   │
   ▼
SKILL.md ── plan ──► mode + scope ─────────────────────────────┐
   │                                                            │
   ├─ 1 Reconnaissance   copycat inspect / crawl / recon        │  .copycat/runs/<id>/
   ├─ 2 Design analysis  design-tokens.json, inventory          │   ├─ reference/*.png
   ├─ 3 Interactions     interaction-matrix.json, flow          │   ├─ inspection/*.json
   ├─ 4 Implementation   agent edits the user's project         │   ├─ design-tokens.json …
   ├─ 5 Validation loop  copycat compare (iter-1..n)            │   ├─ compare/iter-N/*.png
   └─ 6 Report           implementation-notes.md + report       │   └─ report.md
                                                                ┘
```

## Specialist roles

The brief's five specialists are **stages** of the skill workflow, not mandatory processes:

| Role | Stage | Evidence it owns |
|---|---|---|
| Reference Inspector | 1 | `inspect`, `crawl`, `recon` artifacts |
| Design Analyst | 2 | tokens → project tokens, layout grid, component split |
| Interaction Analyst | 3 | interaction matrix, flows, keyboard/touch notes |
| Implementer | 4 | code changes, made only by the primary agent |
| Visual Verifier | 5 | `compare` iterations and the prioritized issue list |

For large scopes the skill allows parallel inspection subagents (one route each, separate
`--run` ids). All code writes stay with the primary agent. The native agent files
(`.claude/agents/copycat.md`, `.cursor/agents/copycat.md`, `agents/codex/copycat.toml`) are
thin wrappers that point at the skill.

## Runtime modules

| Module | Responsibility |
|---|---|
| `src/core/args.mjs` | Strict CLI flag parser (unknown flags are errors) |
| `src/core/scope.mjs` | Natural-language plus `--flag` intent → mode, component, URLs, viewports |
| `src/core/url.mjs` | Reference validation (http/https/file only, no embedded credentials) |
| `src/core/redact.mjs` | Redaction of emails, tokens, keys and sensitive query params; prompt-injection screening |
| `src/core/run.mjs` | Run folders and the event ledger (`run.json`). Every JSON write is redacted |
| `src/browser/launch.mjs` | Isolated Chromium contexts, stable navigation (network idle, lazy-load scroll, fonts), challenge detection, frozen-animation screenshots |
| `src/browser/viewports.mjs` | Presets and custom `WxH` viewports |
| `src/inspection/extract.mjs` | In-page extraction: DOM, styles, tokens, landmarks, forms (no values), assets, breakpoints, repeated patterns, interaction candidates |
| `src/inspection/inspect.mjs` | Per-viewport orchestration, hover/focus state deltas, aggregate artifacts |
| `src/inspection/interact.mjs` | Safe auto-probing, scripted flows, state diffs, safety guards |
| `src/inspection/crawl.mjs` | Same-origin crawl with robots.txt, sitemap, budget and rate limiting |
| `src/comparison/image.mjs` | PNG I/O, padding/cropping, pixelmatch diff, nondeterminism mask, region clustering, side-by-side composite |
| `src/comparison/compare.mjs` | Capture both sides, structural diff (role + label matching), prioritized issues, iterations, threshold gate |
| `src/reporting/report.mjs` | `report.md` built only from artifacts that exist |
| `scripts/lib/installer.mjs` | Platform paths, de-duplication, ledger and hash ownership, backups, runtime install |

## Design decisions

- **Node + Playwright.** Every host can run Node. Playwright gives the same Chromium on
  Linux, macOS and Windows. The runtime has three production dependencies: `playwright`,
  `pngjs` and `pixelmatch`. The installer and verifier have none.
- **Copy, don't symlink.** Installs are plain copies tracked by content hash. They work on
  Windows without developer mode and make "did the user edit this?" a single hash check.
- **One runtime per user.** Skills are small and copied per host. The runtime with
  `node_modules` lives once in `~/.copycat/runtime`. A launcher inside each skill finds it.
- **Observed vs inferred.** Probes and flows record what changed (visibility, ARIA
  attributes, dialogs, focus, URL, validation text). The skill requires anything without
  an observation to be labeled as inferred.
- **Honest metrics.** The pixel mismatch ratio excludes pixels that were nondeterministic
  between two reference captures, counts anti-aliasing by default, and is always reported
  with its threshold and viewport. There is no "fidelity score".
