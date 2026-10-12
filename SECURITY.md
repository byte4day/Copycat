# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/byte4day/Copycat/security/advisories/new).
Do not open a public issue. Include the affected version (`copycat --version`), steps to
reproduce, and the impact. You will get an acknowledgement as soon as the maintainer can
review it.

## Scope

In scope:

- Leaks of secrets, cookies, credentials or personal data into run artifacts or reports
- Bypasses of Copycat's safety guards (auth walls, CAPTCHA detection, form-submission and
  destructive-action refusal, robots handling, same-origin flow restriction)
- Prompt-injection paths where reference page content can steer the agent through
  Copycat's outputs
- Installer or uninstaller behavior that overwrites or deletes files Copycat does not own,
  or that changes host settings
- Path traversal or arbitrary file write through CLI options

Out of scope: weaknesses in the reference sites themselves, and in host agents (report
those to their vendors).

## Design guarantees

- Isolated browser profile per run. No cookies, storage or credentials are read or
  persisted.
- Form field values are never extracted. Sensitive fields are never filled on non-local
  references.
- All JSON artifacts pass through redaction, and run folders are git-ignored.
- The installer only changes paths recorded in its ledger, and backs up anything it
  replaces.

## Acceptable use

Copycat must not be used to clone deceptive login or payment pages, to bypass access
controls, or to reproduce proprietary assets without rights. See
[safety-and-permissions.md](.agents/skills/copycat/references/safety-and-permissions.md).
