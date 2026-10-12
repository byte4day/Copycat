# Installation

## Requirements

- Node.js 20 or newer, and npm
- About 150 MB for Playwright's Chromium (downloaded once, shared by all Playwright tools)
- One or more hosts: Claude Code, OpenAI Codex, Cursor, Google Antigravity

No `sudo` is needed. Nothing is written outside your home directory, or outside the
project folder for `--project` installs.

## Global install (all detected hosts)

```bash
git clone https://github.com/byte4day/Copycat.git
cd Copycat
npm install
node scripts/install.mjs --all --global --dry-run   # preview
node scripts/install.mjs --all --global --with-browser
node scripts/verify.mjs --all --global --browser
```

`--all` installs for every host that is **detected** (its config folder or CLI exists).
Hosts that are not detected are skipped and listed. To install for an undetected host
anyway, name it with `--platform`.

## One host

```bash
node scripts/install.mjs --platform claude --global
node scripts/install.mjs --platform codex --global
node scripts/install.mjs --platform cursor --global
node scripts/install.mjs --platform antigravity --global
node scripts/install.mjs --platform claude,cursor --global
```

## Project install (commit it to share with your team)

```bash
node scripts/install.mjs --all --project --dir /path/to/your/repo
```

This writes `.agents/skills/copycat/`, `.claude/skills/copycat/`,
`.claude/agents/copycat.md`, `.cursor/agents/copycat.md` and `.codex/agents/copycat.toml`
into the repository. It also writes a ledger at `.copycat/install-ledger.json`. The
browser runtime is still installed once per user in `~/.copycat/runtime`. Add
`.copycat/runs/` to the project's `.gitignore` so captures stay local.

## What goes where

| Item | Global path |
|---|---|
| Runtime (CLI + Playwright) | `~/.copycat/runtime/` |
| Install ledger and backups | `~/.copycat/install-ledger.json`, `~/.copycat/backups/` |
| Skill | see [compatibility.md](compatibility.md) |
| Agents | `~/.claude/agents/copycat.md`, `~/.cursor/agents/copycat.md`, `~/.codex/agents/copycat.toml` |

Each installed skill has a `scripts/runtime.json` that points its launcher at the runtime.
To develop against a checkout instead, use `--runtime /path/to/Copycat`. This skips the
copy and `npm ci`, and uninstall never deletes that checkout.

## Options

| Option | Effect |
|---|---|
| `--dry-run` | Print the plan and change nothing |
| `--force` | Replace modified or unmanaged copies. The old version is moved to `~/.copycat/backups/<time>/` first |
| `--no-runtime` | Install only the skill and agents |
| `--skip-npm` | Copy the runtime without running `npm ci` |
| `--with-browser` | Run `npx playwright install chromium` in the runtime |
| `--json` | Machine-readable output |

## Safety guarantees

- Paths that Copycat did not create are **never** overwritten or deleted. The installer
  reports them as a conflict (exit code 8).
- Files you edited after installing are kept unless you pass `--force`, and even then they
  are backed up first.
- A reinstall of the same version is a no-op (`up-to-date`). A new version backs up the old
  files and replaces them.
- Backups are stored outside every folder a host scans, so they never show up as a second
  skill.
- No host settings files are modified, and no permissions are enabled.

## Verify

```bash
node scripts/verify.mjs --all --global            # files, frontmatter, launcher → runtime
node scripts/verify.mjs --all --global --browser  # also launches Chromium
node scripts/verify.mjs --source                  # validate this repository's files (CI)
```

`verify` also prints which copies of the skill each host will see.

## Uninstall

```bash
node scripts/uninstall.mjs --all --global --dry-run
node scripts/uninstall.mjs --all --global
node scripts/uninstall.mjs --platform cursor --global     # keeps folders still shared with Codex
```

Uninstall removes only files recorded in the ledger. It keeps any you changed, unless you
pass `--force`, in which case they are backed up. It removes the runtime after a full
global uninstall.

## Exit codes

`0` ok · `1` failure · `2` usage error · `8` conflict (something was left untouched on purpose)
