# Compatibility

These paths and formats were checked against each host's official documentation on 2026-11-10.
Hosts change quickly, so check the linked page if something does not show up.

## Agent Skills standard

Copycat is an [Agent Skills](https://agentskills.io/) package: a folder with `SKILL.md`
(`name` and `description` required), plus optional `references/`, `scripts/`, and
`assets/`. Progressive disclosure keeps discovery cheap (name + description) and loads
the full body only when the task matches. Codex may also read optional
`agents/openai.yaml` for display metadata.

Any host that implements Agent Skills can load the same tree. OpenCode can use Copycat
via `.agents/skills/copycat` when that host supports the standard. The installer still
targets Claude Code, Codex, Cursor, and Antigravity only.

## Skill discovery

| Host | User-wide (`--global`) | Repository (`--project`) | Explicit invocation | Source |
|---|---|---|---|---|
| Claude Code | `~/.claude/skills/copycat/` | `.claude/skills/copycat/` | `/copycat <request>` | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) |
| OpenAI Codex | `~/.agents/skills/copycat/` | `.agents/skills/copycat/` (from the working directory up to the repo root) | `$copycat <request>` or `/skills` | [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills) |
| Cursor | `~/.agents/skills/` or `~/.cursor/skills/` (also reads `~/.claude/skills/`, `~/.codex/skills/`) | `.agents/skills/` or `.cursor/skills/` (also `.claude/skills/`, `.codex/skills/`) | `/copycat <request>` in Agent chat | [cursor.com/docs/skills](https://cursor.com/docs/skills) |
| Google Antigravity | `~/.gemini/config/skills/copycat/` (legacy `~/.gemini/antigravity/skills/` is still read) | `.agents/skills/copycat/` (legacy `.agent/skills/`) | `/copycat` in Antigravity 2.0 and the CLI; agent-selected in the IDE | [antigravity.google/docs/skills](https://antigravity.google/docs/skills) |
| OpenCode | *not installed by Copycat* | `.agents/skills/copycat/` when Agent Skills are enabled | host skill picker / slash command when supported | [agentskills.io](https://agentskills.io/) |

Every host reads the same `SKILL.md`: YAML frontmatter with `name` and `description`, a
Markdown body, plus `references/`, `scripts/` and `assets/`. Copycat uses only those two
required frontmatter keys, plus `license` and `metadata`, which the Agent Skills spec
defines and Claude Code accepts as informational. Codex additionally reads the optional
`agents/openai.yaml` for display metadata. Keep the root `SKILL.md` as a short router:
trigger-specific description, staged references, and less over-prescriptive recipe prose.

## Native agents

| Host | File Copycat installs | Notes | Source |
|---|---|---|---|
| Claude Code | `~/.claude/agents/copycat.md` | Uses `skills: [copycat]` to preload the skill. Prefer `model: inherit` | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Cursor | `~/.cursor/agents/copycat.md` | `name`, `description`, `model: inherit`. Invoke with `/copycat` or "use the copycat subagent". Prefer native Task/subagents over same-host relay | [cursor.com/docs/subagents](https://cursor.com/docs/subagents) |
| Codex | `~/.codex/agents/copycat.toml` | `name`, `description`, `developer_instructions`. Subagents are enabled by default (`agents.enabled`). Copycat does not edit `config.toml` | [learn.chatgpt.com/docs/agent-configuration/subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) |
| Antigravity | *not installed* | Custom subagents exist (`~/.gemini/config/agents/`), but the docs do not list valid `tools` names, and they warn that a misspelled tool can hang a subagent. Copycat installs the skill only, which Antigravity loads by its description or by `/copycat` | [antigravity.google/docs/subagents](https://antigravity.google/docs/subagents) |

Cursor also reads `.claude/agents/`. When names collide in the same scope, `.cursor/`
takes precedence, so the Claude and Cursor agent files do not duplicate each other.

## Models

Prefer `model: inherit` on Cursor and Claude Code agent definitions so the subagent follows
the parent chat.

Claude Code agent model aliases include `fable`, `opus`, `sonnet`, `haiku`, and `inherit`
(current line: `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`,
`claude-haiku-5-5`).

OpenAI / Codex model lines current as of this check: GPT-6 Astra, GPT-6.1 Sol / Terra,
and GPT-6 Luna.

## Duplicate registrations

- `.agents/skills/copycat` is installed **once** and serves Codex, Cursor and
  Antigravity (project scope). OpenCode can reuse that same path when it supports Agent Skills.
- If you install for Claude Code and Cursor but not Codex, Cursor reuses
  `.claude/skills/copycat` instead of getting a second copy.
- If you install for Claude Code **and** Codex, both folders have to exist (Claude Code does
  not read `.agents/skills`), and Cursor reads both. Cursor may then list `copycat` twice.
  `install.mjs` and `verify.mjs` warn about this. Keep it, or uninstall one platform.

## Operating systems

The installer, uninstaller and verifier are dependency-free Node.js (≥ 20). They use
`os.homedir()`, `path.join` and recursive copies, not symlinks, so they work on Linux,
macOS and Windows without elevated rights. The browser runtime needs Playwright's
Chromium, which supports the same three platforms. CI runs on Linux. macOS and Windows
are supported by design but are not yet covered by CI.

## Host browser tools

When a host provides its own browser (Playwright MCP, Claude in Chrome, Cursor's browser,
Antigravity's browser agent), the skill lets the agent use it for exploration. Captures
and comparisons always go through the Copycat CLI so the evidence can be repeated.
Copycat does not install or configure MCP servers.
