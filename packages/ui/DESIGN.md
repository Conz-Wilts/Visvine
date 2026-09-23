# Visvine design system

One design across web, desktop, iOS and Android. It has two halves:

- **`@visvine/tokens`** (`packages/tokens`). Every design value is written once, in W3C Design Tokens (DTCG) JSON, and generated for each platform.
- **`@visvine/ui`** (`packages/ui`). The shared React components, built on those tokens and nothing else.

The rules for what a screen may say and show are in the root `AGENTS.md`, under *Design*. This file is the system underneath: what exists, what it is called, and how each platform reads it.

---

## 1. Tokens

### Tiers

```
packages/tokens/tokens/
  primitive/   raw values: colour ramps, the spacing/radius/type scales, shadows, motion, z, breakpoints
  semantic/    what a value is FOR — base.json (every theme), light.json, dark.json, accents.json
```

- **Primitive tokens name a value.** Examples: `color.blue.600`, `space.4`, `radius.lg`.
  - The colour ramps are Tailwind's v3 sRGB values, which every platform can draw exactly.
  - `color.visvine` is the logo green and its steps. It is the one colour decided before this system existed.
- **Semantic tokens name a role.** Examples: `color.fg.muted`, `color.surface.subtle`, `color.danger.default`.
  - A semantic token only aliases a primitive.
  - UI code paints with semantic tokens. It reaches for a primitive only to build data: a chart series, or a hash palette.

### Naming

The grammar is `category.role[.variant]`. A trailing `default` is dropped everywhere a token is written out, so `color.fg.default` becomes `--vv-color-fg`, `text-fg` and `VVColor.fg`.

The colour roles are named so that the token, the CSS variable, the Tailwind utility and the native property read the same:

| Role | Tokens | Web utility | Native |
|---|---|---|---|
| Surface | `surface.{default,subtle,muted,backdrop,glass}` | `bg-surface`, `bg-surface-subtle`, `bg-surface-muted` | `VVColor.surface`, `.surfaceSubtle` … |
| Ink | `fg.{default,secondary,muted,subtle,inverse,link}` | `text-fg`, `text-fg-muted`, `text-fg-link` | `VVColor.fg`, `.fgMuted` … |
| Line | `line.{default,subtle}` | `border-line`, `border-line-subtle` | `VVColor.line`, `.lineSubtle` |
| Accent (chosen hue) | `accent.{default,strong,soft}` | `bg-accent`, `text-accent-strong`, `bg-accent-soft` | `VVAccent` / theme store |
| Brand (logo, fixed) | `brand.default` | `bg-brand`, `text-brand` | `VVColor.brand` |
| Admin alias | `admin.default` | `text-admin` | `VVColor.admin` |
| Status | `danger`, `warning`, `success`, `info` × `{default,strong,bright,wash,line}` | `text-danger`, `bg-danger-wash`, `border-danger-line`, `hover:bg-danger-strong` | `VVColor.danger`, `.dangerWash` … |
| Categorical | `hue.<red…gray>.{default,fg,wash,line}` | `bg-hue-blue-wash text-hue-blue-fg` | `VVColor.hueBlueFg` … |
| Built-in types | `type.<person…other>.{default,fg,wash}` | `bg-type-event`, `text-type-person-fg` | `VVTypeColor.named("person")` |
| Link types | `relation.<knows…>` | (data only) | (data only) |

The same distinctions hold on every platform:

- **Accent vs brand.**
  - `accent` is the hue a person picks in Settings. There are nine; the id is what is stored (`nb_color_theme`).
  - `brand` is the logo and never changes. Paint with `accent` unless the thing *is* the logo.
- **Status vs categorical.**
  - `danger/warning/success/info` carry meaning.
  - `hue.*` tells kinds of a thing apart (file types, HTTP methods) and carries none. Never borrow a status colour to tell kinds apart, and never use a hue for status.
- **Type colours are defaults.** A space may override any type's colour. `color.type.*` is what a new space starts with, and what an unknown type falls back to.

### Scales

| Scale | Keys | Web | Swift / Kotlin |
|---|---|---|---|
| Spacing | Tailwind steps: `0.5`=2 … `4`=16 … `16`=64 | `p-4`, `gap-3` (unchanged: `--spacing` is `space.1`) | `VVSpace.x4`, `VVSpace.x0_5` |
| Radius | `xs` 2, `sm` 4, `md` 6, `lg` 8, `xl` 12, `2xl` 16, `3xl` 24, `full` | `rounded-lg` … | `VVRadius.lg`, `VVRadius.xl2` |
| Font size | by px: `10 11 12 13 14 15 16 18 20 24 30 36 48 60` | `text-xs`…`text-6xl` read the 12…60 steps | `VVFontSize.s14` |
| Font weight | `light regular medium semibold bold` | `font-medium` | `VVFontWeight.medium` |
| Font family | `ui` (Open Sauce One), `brand` (ABC Ginto Rounded, the wordmark only) | `font-ui`, `.font-brand` | system face; `Visvine-*` for the wordmark |
| Shadow | `float`, `strip`, `lift` | `.shadow-float`, `.shadow-strip` | (none: native draws no shadows yet) |
| Motion | durations `fast` 150, `quick` 200, `base` 300, `slow` 380, `slower` 550; curves `standard`, `enter`, `gentle`, `settle`, `overshoot` | `ease-standard`; `motion` / `VIEW_ENTER_*` / `TAB_MOTION*` in TS | `VVMotion.base` (s / ms), `VVMotion.standard()` / `.standard` |
| Z | `raised sticky dock overlay modal popover toast` | `z-(--vv-z-modal)` | — |
| Breakpoint | Tailwind's `sm md lg xl 2xl` | `md:` | — |

### Themes

- **Light is the only theme any app shows.** Web forces `color-scheme: light`, desktop pins `WINDOW_THEME`, iOS sets `UIUserInterfaceStyle: Light`, and Android sets `forceDarkAllowed=false`.
- **`semantic/dark.json` is PROVISIONAL.** It is generated for every platform and switched on nowhere:
  - on the web, `<html data-theme="dark">` would switch it on;
  - iOS colours are already dynamic (`UIColor` providers), so lifting the pin is the whole change;
  - Android has `VVColorDark` / `VVTypeColorDark` ready to swap in.
- **The accent is an axis of its own.** On the web the page's accent is `<html data-accent="<id>">`, set by `ThemeContext` and by a blocking boot script before first paint. `tokens.css` holds each hue under that attribute.

### Commands

```
pnpm tokens:build   regenerate every platform's output and sync the brand assets
pnpm tokens:check   write nothing; fail if any output is stale
pnpm tokens:test    contrast (AA for every reading pair), structure, and the check above — runs in CI
```

- **What is generated.** Everything under `packages/tokens/generated/`, `apps/desktop/src/tokens.generated.ts`, the token block in `apps/desktop/resources/offline.html`, `Tokens.generated.swift`, the iOS `AccentColor`, `Tokens.kt` and Android's `values/tokens.xml`.
- **All generated output is committed.** The app trees then build without Node (Xcode, Gradle, the Docker image).
- **Never edit generated output.** Change the JSON, then run `tokens:build`.

### How each platform reads them

| Platform | File | How |
|---|---|---|
| Web | `@visvine/tokens/tokens.css` + `theme.css` | imported at the top of `apps/web/app/globals.css`; utilities as above, `var(--vv-*)` in CSS |
| Web (TS) | `@visvine/tokens` | `color`, `palette`, `cssVars`, `motion`, `radius`, `accents`… for inline styles, SVG, WAAPI, data |
| Desktop | `src/tokens.generated.ts` | `theme.ts` reads `VV_COLOR`; `offline.html` reads the `--vv-*` block the build writes into it |
| iOS | `Visvine/Theme/Tokens.generated.swift` | `VVColor`, `VVTypeColor`, `VVAccent`, `VVSpace`, `VVRadius`, `VVFontSize`, `VVFontWeight`, `VVMotion`; `ThemeStore.colors` is the role set with the chosen accent. Re-run `xcodegen generate` after the file first appears |
| Android | `ui/theme/Tokens.kt`, `res/values/tokens.xml` | the same object names; `VisvineTheme.colors` is the role set with the chosen accent; Material's scheme maps from it |

### Brand assets

`packages/tokens/assets` is the one source for fonts and logos. `tokens:build` copies each byte for byte to where its toolchain wants it:

- the web's `public/fonts`, `app/icon.png`, `app/apple-icon.png` and `public/images/brand-icon.png`;
- desktop's `assets/icon.png`, which `build-mac-icon.mjs` pads into `icon-mac.png`;
- iOS `Fonts/` and the `AppIcon` and `Logo` asset sets;
- Android's launcher foreground.

UI glyphs are separate: `assets/icons/*.svg` at the repo root, generated by `pnpm icons:build` (see `docs/icons.md`).

---

## 2. Components (`@visvine/ui`)

- **Import from the package.** `import { Button, Modal, Tabs } from '@visvine/ui'`. It is the only shared UI, and eslint refuses `@/components`.
- **The package is framework-free.** `UIProvider` takes the app's link and image components. The web mounts `AppUIProvider` at the root, which supplies SpaceLink and next/image.
- **Keyboard focus.** Every control that takes focus draws `FOCUS_RING`: an accent ring on `focus-visible` only.

| Component | Variants | Sizes | States / notes |
|---|---|---|---|
| `Button` | `brand` (accent fill), `neutral` (`surface-subtle`), `danger`, `danger-text`, `ghost` | `sm`, `md` (ghost only; the three action variants share one size so a pair never mismatches) | hover, focus-visible, disabled, `loading` + `loadingText` (`aria-busy`) |
| `Input`, `Textarea` | — | one | disabled; `inputBaseClass` for a matching custom field |
| `Select` | — | one (h-10) | native `<select>` with the chevron glyph |
| `Checkbox` | — | `sm` 14, `md` 16 | checked, `indeterminate` (`mixed`), disabled, `invalid`; optional `label` |
| `Toggle` | — | one (40×24) | on/off (`role="switch"`), disabled, optional `label` |
| `SearchInput` | — | `sm`, `md`, `lg` | optional leading icon |
| `Field` | — | — | `label`, `hint`, `error` around any control |
| `Modal` | — | `sm`, `md`, `lg` (or `maxWidth`) | `title`, `footer`; Escape and backdrop close; portalled |
| `ConfirmDialog` | `destructive` | — | busy while `onConfirm` resolves; `confirmText` (type-to-confirm); `error` |
| `useToasts` + `ToastHost` | `success`, `error`, `warning`, `info` | — | bottom-right stack; errors stay until dismissed, the rest go after 6s |
| `SearchMenu*` | panel, row, input, list, empty | — | `useSearchMenuCursor` for arrow-key selection |
| `Tabs` | — | `sm`, `md`, `lg` (the pane tab bar's metrics) | `role="tablist"`; the underline slides to the active tab |
| `Chip` | `solid`, `muted`, `dashed` | `xs`–`xl` | `color` (any type or alias colour), `onClick`, `onRemove`, disabled. Chip is also the badge; there is no Badge |
| `Avatar` | fallback `silhouette`, `initials`, `space` | `xs sm md chip lg xl` (or `sizeClassName` + `pixelSize`) | image through the app's image component |
| `PersonSilhouette`, `TypeSilhouette` | — | — | the glyphs an avatar falls back to |
| `Alert` | `error`, `warning`, `success`, `info` | `inline` | a 2px rule in the status colour; optional dismiss |
| `EmptyState` | action `link` or `solid` | `sm`, `md`, `page` | one muted line; an empty section is otherwise hidden |
| `PageError`, `LoadingText`, `Skeleton`, `ContentReveal` | — | — | loading and failure; `ContentReveal` fades a view in on `VIEW_ENTER_*` |
| `Stack`, `Row` | — | `gap` in spacing steps | `align`, `justify`, `wrap`, `as` |
| `SettingsSection` | `flush`, `large` | — | a hairline section with its title, and its switch in the header |

There is no Card and no Badge. Surfaces are flat, sections are hairlines, and Chip is the one label shape.

The Tool SDK kit (`apps/web/features/tools/kit`) is separate on purpose. It is the public contract for Tools running in a sandboxed iframe. Its `--vv-*` values are read from the tokens at build time, and it sends installed Tools the variable names they were built against.

### Mirroring a component natively

- **Mirror the web spec.** iOS and Android draw each component to the spec in the table above, under the same name and props: `Button(variant: .brand)` on iOS, `Button(variant = ButtonVariant.Brand)` on Android.
- **Use the same tokens.** Colours come from the theme store's role set (`c.fgMuted`, `colors.surfaceSubtle`), measurements from `VVSpace` / `VVRadius` / `VVFontSize`.
- **Use no literals.** A value the scale lacks is a token first: add it to the JSON and run `tokens:build`.
- **Close drift the same way.** When a native view drifts from the web, the web's spec wins, and the fix goes into the token or the component spec, not into a one-off value.

---

## 3. Follow-ups for Claude Design

This work tokenised the values the apps had without redesigning them. What it deliberately left:

**Type sizes**
- **Web off-scale sizes.** The web still has ~389 arbitrary `text-[Npx]` classes (13 ×120, 12 ×73, 11 ×69, 15 ×47, plus half-pixel sizes).
- **Native off-scale sizes.** iOS and Android have a few (17, 22, 28, 34, 40).
- **The scale itself.** A designed type scale (fewer steps, named by role) should replace the by-px `font.size` keys.

**Spacing and radii**
- **Native off-scale values.** Mostly `0`, `3`, `5`, `7`, `9`, `18`, `22`, `28` and a few large frames.
- **Radii.** `10`, `20`, `22` (web `rounded-[10px]` ×6).

**Motion and stacking**
- **Z-index.** The web has ad-hoc values (45, 90, 95, 96, 1000). The `z.*` scale exists but nothing reads it yet.
- **Motion.** Durations off the scale (DOCK 320, 260, 180, 140, 190 ms) and one stray curve (`useCardTilt`).

**Components to adopt** (moving these would change pixels, so they were listed rather than moved)
- 32 hand-rolled accent buttons.
- 9 raw `<select>`s.
- The bespoke overlays: NotePicker, SharePanel, SpaceSwitcherPanel, and the EditModal wrapper.
- PaneTabBar, PageTabBar and ConsoleShell's own tab bars.
- The two remaining native checkboxes: the table cell, and the public registration form.

**Parity**
- **Avatars.** iOS draws a person as a rounded square (0.28), Android as a circle.
- **Android icon.** The launcher foreground is a hand-drawn stand-in, not the brand mark.
- **Brand font.** Open Sauce One is not bundled on iOS or Android.

**Themes**
- **Dark theme.** Design `semantic/dark.json`, then lift the light pin on each platform.
