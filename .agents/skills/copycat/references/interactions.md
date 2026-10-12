# Interactions

Visual fidelity alone is not enough. Every interactive element in scope needs: a trigger,
the observed result, its navigation or mutation behavior, an implementation, keyboard and
pointer checks, and visual verification.

## Automatic probing (`inspect --interactions`)

Interaction candidates are `aria-expanded`, `aria-haspopup`, `aria-controls`,
`role=tab`, `summary`, buttons, and toggles. Each safe candidate is clicked (or tapped on
touch viewports) once, from a clean state. The probe records:

- `shown` / `hidden`: elements whose visibility changed
- `attributes`: changes to `aria-expanded`, `aria-selected`, `aria-pressed`, `aria-invalid`, `open`, or `data-state`
- `dialogOpened` / `dialogClosed`, `focusMoved`, `scrolled`, `urlChanged`
- `validationMessages` and `liveText` that appeared
- `reset`: how the state was undone (`escape`, `second-click`, or `reload`), plus
  `closesWithEscape` and `togglesOnSecondClick`

These are **observations**, and they are what you implement. Example: if
`closesWithEscape: true`, the rebuild must close on Escape. If the probe shows no Escape
support, do not invent it, though you may add it as an accessibility improvement and say so.

The probe will **not** trigger submit buttons or controls labeled like
delete/remove/buy/pay/checkout/subscribe/send/log out/confirm. These show as `skipped`
with a reason. Their behavior is unobserved, so mark it *inferred* if you implement it.

## Scripted flows (`flow --steps`)

Use flows for user journeys and for anything that needs input:

```json
[
  { "action": "click", "selector": "#plan-team", "name": "choose plan" },
  { "action": "fill", "selector": "#email", "value": "test@example.test" },
  { "action": "select", "selector": "#size", "value": "6–20" },
  { "action": "press", "key": "Escape" },
  { "action": "wait", "selector": ".summary" },
  { "action": "screenshot", "name": "summary" }
]
```

Actions: `goto` (same origin only), `click`, `tap`, `hover`, `focus`, `press`, `fill`,
`select`, `check`, `uncheck`, `wait`, `scroll`, `screenshot`. There is a limit of 100 steps.
Each step records a state diff, plus a screenshot when something changed, in `flows.json`
and `flows/`.

Safety rules, enforced by the CLI:

- Use test data only (`*.test` emails, obviously fake names).
- On non-local references, `fill` on password, card, CVC, IBAN, SSN, or one-time-code
  fields is refused (exit 6).
- On non-local references, form submits and transactional labels are refused unless the
  user explicitly authorizes them and you pass `--allow-submit`. Never submit production
  forms, purchases, or messages.
- Local references (`localhost`, `127.0.0.1`, `file:`) are the user's own builds, so these
  limits do not apply there.

Run the same flow against the local build with `--label local` and the same `--run` id. The
report then shows both sides, step by step.

## Matrix → implementation

| Observed | Implement |
|---|---|
| `aria-expanded` false→true, menu shown, closes with Escape | Disclosure/menu with `aria-expanded`, Escape and outside click close it, focus returns to the trigger |
| `aria-selected` moves between `role=tab` elements, panel content changes | Tabs with roving selection. Arrow keys if the reference supports them, or as a labeled improvement |
| Dialog opened, focus moved inside, Escape closes | Modal with focus moved in, Escape, backdrop click (if observed), and focus restored |
| `aria-pressed` changes, rows hidden | Filter state drives the data rendering. Not just CSS toggles |
| `aria-invalid` and alert text appear on submit | Validation rules matching the observed messages. Same message text |
| `urlChanged` | Real route or anchor navigation in the project's router |

## Backend behavior

Copycat sees only frontend behavior. When a flow depends on a server:

1. Prefer existing local services or APIs in the user's project.
2. Otherwise build a **clearly labeled demo layer**: a mock module and fixture data, with
   optional `localStorage` persistence. Name it `mock`/`demo` in code and say so in the UI
   when it matters.
3. Record in `implementation-notes.md` exactly what is simulated. Never describe a mock as
   a production integration. Never reverse engineer private APIs.

## Keyboard and touch

For each widget, check Tab order, a visible focus style (`states[].focus`), Enter and Space
activation, and Escape where it applies. Check mobile viewports with tap (`flow --viewport
mobile` uses touch). Record the results in the report.
