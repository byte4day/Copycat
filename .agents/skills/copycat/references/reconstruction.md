# Reconstruction

## 1. Read the project before editing

Check, in this order, and write down what you find in `implementation-notes.md`:

| What | Where to look |
|---|---|
| Framework and version | `package.json` dependencies (`next`, `react`, `vue`, `nuxt`, `svelte`, `@sveltejs/kit`, `astro`, `vite`), or plain `*.html` |
| Routing | `app/` or `pages/` (Next), `src/routes/` (SvelteKit), `src/router` (Vue), file-based HTML |
| Styling | Tailwind config, CSS Modules, styled-components or emotion, Sass, CSS variables, UI kit (shadcn, MUI, Chakra) |
| Existing tokens | `tailwind.config.*`, `:root` variables, theme files |
| Components | `components/`, `src/lib`, `ui/`, naming and file conventions |
| Tests and build | `scripts` in `package.json`, Playwright/Vitest/Jest config, CI |
| Package manager | lockfile: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` |

Rules:

- Use the existing stack and conventions. Do not migrate frameworks or add a styling
  library the project does not use.
- Add dependencies only when the reference needs behavior the project cannot reasonably
  express without them. Use the project's package manager.
- Touch only files inside the requested scope. Put new components where similar ones live.
  Do not reformat unrelated code.
- When `--target` is given (a path or route), build there.

## 2. New project defaults

If no project exists and the user did not specify a stack:

- **Static or marketing pages:** plain HTML, CSS, and JS with no build step, unless the
  page count or reuse justifies a framework.
- **Apps with state, routing, or many components:** Vite with React and TypeScript, using
  CSS Modules or plain CSS with variables. Explain the choice in one line.

## 3. Build order

1. Tokens: CSS variables or the theme mapping from `design-analysis.md`.
2. Shell: page container, header/nav, footer, sidebar, with responsive behavior.
3. Sections and components, top to bottom. Repeated patterns become one component that
   renders from data.
4. Interactions from the matrix and flows (`interactions.md`).
5. Content: the reference's observable copy. Use placeholders only for private or personal
   data, and mark them.
6. Assets: the user's own or licensed assets. Otherwise use neutral placeholders with the
   right dimensions and aspect ratios, marked as placeholders. Inline SVG icons must be
   original or from a license-compatible set the project already uses.

## 4. Code quality

- Use small components with clear props. Avoid one giant generated file.
- Use semantic HTML: landmarks, `button` for actions, `a` for navigation, labels for inputs.
- Use the measured values through tokens, not as magic numbers scattered across files.
- Write responsive rules at the reference's breakpoints. Avoid horizontal overflow on mobile.
- Do not leave dead controls. A control that cannot work yet must be visibly disabled and
  listed in the notes.
- Keep performance reasonable: lazy-load below-the-fold images and add no heavy libraries
  for trivial effects.

## 5. Run it

Start the project's dev server, or serve static files (for example
`npx --yes serve -l 4173 .`). Confirm the page renders without console errors before you
compare. Run the project's own tests and build.

## 6. Notes template

Copy `assets/implementation-notes-template.md` into the run folder as
`implementation-notes.md` and fill it in. `copycat report` includes it verbatim.
