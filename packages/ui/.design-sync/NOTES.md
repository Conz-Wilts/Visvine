# design-sync notes: @visvine/ui → claude.ai/design

Project: "Visvine" (`projectId` in config.json). Shape: `package` (no Storybook).
Config home is `packages/ui/`: run everything from there.

## How this repo builds

- **No dist.** `@visvine/ui` ships source (`exports: ./src/index.ts`). The converter
  bundles `cfg.entry = ./src/index.ts` directly with esbuild and reads props from the
  source with ts-morph. There is no package build step.
- **The CSS is compiled by the sync.** Components paint with Tailwind v4 utilities
  (`bg-surface`, `text-fg-muted`…) whose theme is `@visvine/tokens/theme.css`, and the
  package ships no stylesheet. `cfg.buildCmd` compiles `.design-sync/styles/visvine.css`
  (the web's `globals.css` cut down) with the Tailwind CLI into
  `.design-sync/.cache/visvine.css`, which `cfg.cssEntry` ships as `_ds_bundle.css`.
  **Run `buildCmd` before `package-build.mjs` / `resync.mjs`**. The cache file is
  gitignored, so a fresh clone has no CSS until it runs.
- The Tailwind CLI (`@tailwindcss/cli@4.2.2`, matching the web's `tailwindcss@4.2.2`) is
  installed into `.ds-sync/` beside the converter deps:
  `(cd .ds-sync && npm i esbuild ts-morph @types/react @tailwindcss/cli@4.2.2 tailwindcss@4.2.2 playwright@1.62.1)`.
  `@import "tailwindcss"` resolves from `.design-sync/styles/`, so it needs the
  `.design-sync/node_modules → ../.ds-sync/node_modules` symlink (buildCmd recreates it).
- `@source` scans `src/` **and `apps/web/{app,features,components}`**, plus
  `@source inline(...)` for every colour role × bg/text/border and the core
  spacing/radius/type scales. That way a design built with the DS can use the product's
  whole utility vocabulary, not just the classes the 30 components happen to use (~170 KB).
- Fonts: `.design-sync/styles/fonts.css` holds the `@font-face` rules from `globals.css`,
  re-pointed at `packages/tokens/assets/fonts/web/`, shipped via `cfg.extraFonts`
  (Open Sauce One = UI, `Visvine-*` = ABC Ginto Rounded, the brand wordmark face).
- Tokens: `cfg.tokensGlob = generated/tokens.css` ships the `--vv-*` variables as
  `tokens/tokens.css`. `theme.css` is Tailwind-only `@theme` and is not shipped raw.
- Groups come from `.design-sync/groups/<group>.md` stubs via `cfg.docsMap`, following
  DESIGN.md §2's categories. IconBase keeps its dir-derived `icons` group.
- Playwright: the repo pins `playwright@1.62.1` → chromium build 1234, already in
  `~/Library/Caches/ms-playwright`. Install that exact version into `.ds-sync/`.

## Authoring previews

- `.design-sync/previews/` is itself a Tailwind `@source`, and `@source inline(...)`
  safelists the layout glue (`grid-cols-*`, the `w/h/size/min-h/max-h` steps, `max-w-*`,
  borders, rings). A class outside all of that is **silently absent**: no build error,
  just a collapsed layout. Grep `.design-sync/.cache/visvine.css` when a class seems to do
  nothing.
- Colour props (`Chip color`, `Avatar accentColor`, the silhouettes' `color`) take any CSS
  colour. Previews pass token variables (`'var(--vv-color-type-person)'`,
  `'var(--vv-color-hue-teal)'`), never hex. Where a literal is unavoidable (an SVG data
  URI), `import { color } from '@visvine/tokens'` works in the preview build.
- `className` is merged with clsx, not tailwind-merge. Overriding a component's own
  utility (SearchMenuList's `max-h-80`) is decided by stylesheet order; an arbitrary value
  such as `max-h-[140px]` wins.
- SearchMenuInput autofocuses by default. Pass `autoFocus={false}` in grid cells.
- The SearchMenu* cards are one full composition each (`SEARCH_MENU_PANEL`, input, rows,
  `useSearchMenuCursor`) rendered in-flow. The pieces don't render truthfully alone.
- Modal, ConfirmDialog and ToastHost are portalled overlays, set to `cardMode: single`
  in `cfg.overrides`. ToastHost is fixed bottom-right, so its stories draw a screen
  (Console → Connectors) under it. The user rejected toasts alone in an empty card.
- 11 cards whose stories are wider than a grid cell use `cardMode: column` (validate's
  `[GRID_OVERFLOW]` names them).
- Static-only states: hover and focus-visible rings, Skeleton's pulse (one frame) and
  ContentReveal's fade can't be captured. ContentReveal is shown only with
  `ready={true}`; `false` is invisible, then force-shown after 2.5s, so that story is
  omitted.
- EmptyState `size="page"` is `min-h-[60vh]`, so its story sits in a fixed 300px box. It
  renders `description ?? title`: the description is the line on screen.
- Images: no network. Avatar portraits are `data:image/svg+xml` URIs, which go through
  UIProvider's Image adapter.
- The web app's EventComposer has its own `Toggle` (`hint`/`value`). The previews use
  `@visvine/ui`'s (`checked`/`label`).

## Contract fixes (`cfg.dtsPropsFor`)

The extractor drops everything inherited from `@types/react` (DOM attributes, `on*`), so
the native-element wrappers lost their real API. Hand-written bodies cover these:
Button (onClick/type/disabled), Input, Textarea, Select (value/onChange/placeholder…),
Stack/Row (`as` expanded to 180 tag names), Tabs (generic `T` → string), EmptyState and
ToastHost (inline the unexported `EmptyStateAction` / `Toast` shapes), and UIProvider.
**These rot when the source props change.** Diff them against `src/` on every re-sync.

## Known render warns

- `[TOKENS_MISSING] --card-glow, --accent, --row-tint, --accent-dark, --card-glow-strong`
  come from arbitrary-value classes in `apps/web` that the `@source` scan picks up. The
  app sets those variables at runtime, so no component in this package reads them. Expected.
- `[DTS_STYLE_SYSTEM] filtering @types/react props` is informational. The components it
  matters for are covered by `dtsPropsFor` above.
- `[DOCS_UNMAPPED] IconBase` is expected: its group comes from its `icons/` directory.
- Pale on purpose: the accent is a light green (`#78d870`), so brand buttons read pale.
  The Toggle off-track and Skeleton fill (`bg-surface-muted`) are faint on white.

## Re-sync risks

- `dtsPropsFor` bodies are hand copies of source props (see above).
- `.design-sync/styles/visvine.css` and `fonts.css` are a cut-down copy of
  `apps/web/app/globals.css`. If globals.css gains base rules the components rely on
  (a new shadow class, a keyframe a component names), port them.
- The `@source inline` hue and type lists are copied from `theme.css`. A new hue or
  built-in type needs adding there.
- Scanning `apps/web` makes `_ds_bundle.css` change whenever the app's classes change,
  so styling churn on re-sync is expected. Grades don't depend on it.
