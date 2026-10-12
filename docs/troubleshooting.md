# Troubleshooting

Start with:

```bash
node <skill-dir>/scripts/copycat.mjs doctor
node scripts/verify.mjs --all --global --browser
```

| Symptom | Cause | Fix |
|---|---|---|
| `copycat: runtime not found` (exit 5) | The skill launcher cannot find `~/.copycat/runtime` | Run `node scripts/install.mjs --all --global`, or set `COPYCAT_RUNTIME=/path/to/Copycat` |
| `Chromium for Playwright is not available` (exit 5) | Browser not downloaded | `cd ~/.copycat/runtime && npx playwright install chromium`. On Linux CI, add `--with-deps`. To use a system Chromium, set `COPYCAT_CHROMIUM_PATH` |
| `The "playwright" package is not installed` | Runtime copied with `--skip-npm` | `cd ~/.copycat/runtime && npm ci --omit=dev` |
| Exit 6 `Access challenge detected` / HTTP 401/403 | Login wall, CAPTCHA or bot protection | By design, Copycat does not bypass these. Use a staging build, a page you can access, or screenshots |
| Exit 4 `Timed out loading` | Slow page, or one that never reaches `load` | `--timeout 60000` and/or `--wait-for "<css of main content>"` |
| Exit 2 `Selector not found` | Component selector is wrong for this viewport | Run `inspect` without `--selector`, then pick from `component-inventory.json` |
| Large mismatch everywhere | Fonts differ, or content shifted early in the page | Check `typography` issues and `loadedFonts`. Fix structure and layout first, then compare again |
| Many "unstable" pixels | Carousel, video, timer or ads on the reference | Expected. They are excluded from the ratio. Use `--selector` to compare a stable region |
| Install exits 8 (conflict) | A `copycat` folder or agent exists that Copycat did not install, or you edited one | Keep it, or rerun with `--force` (it is backed up to `~/.copycat/backups/`) |
| Cursor lists `copycat` twice | Both `~/.claude/skills` and `~/.agents/skills` have it (Claude Code + Codex installed) | Expected. See [compatibility.md](compatibility.md#duplicate-registrations) |
| The skill does not appear in a host | Host caches skills at startup | Restart the host or session. Confirm the paths in `verify` output |
| Antigravity does not see the global skill | Older build using the legacy path | Copy `~/.gemini/config/skills/copycat` to `~/.gemini/antigravity/skills/copycat`, or use a project install |
