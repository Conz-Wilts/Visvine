# Icons

Visvine owns its icons. Every glyph is an SVG file in `assets/icons/` at the
repo root, and the components, drawables and asset catalogs are generated from
it. There is no icon library dependency, and importing one is an eslint error.

Two reasons this is worth the machinery. A library bump can silently redraw the
whole UI, and you cannot hand-tune a glyph you do not have the source for —
which is exactly what you want to do the first time an icon reads wrong at 16px.

## The set

```
assets/icons/<name>.svg      one glyph per file, kebab-case
assets/icons/ATTRIBUTION.md  where each glyph came from, and its licence
```

Every file is drawn to the same spec, and `tests/icons.test.ts` enforces it:

- `viewBox="0 0 24 24"` — one canvas, so strokes land on the same grid
- `fill="none"`, `stroke="currentColor"` — the glyph takes its colour from
  whatever it sits in, so it works in both themes and inherits the sidebar's
  active-row highlight for free
- a root `stroke-width` — `2` for the icons derived from Lucide, `1.8` for the
  house-drawn `nav-*` and `tool-*` shapes. The generated component uses it as
  its default; a caller can override per usage.
- no hardcoded colours, no `<script>`, no external references

Names are the file stems. `circle-check.svg` becomes `<CircleCheckIcon />` and
`<Icon name="circle-check" />`.

## Using them

```tsx
import { CheckIcon, XIcon } from '@/features/shared/icons';

<CheckIcon className="h-4 w-4" />
<XIcon className="h-4 w-4" strokeWidth={1.8} />
<TrashIcon title="Delete" />   // icon-only button: give it a name
```

Icons are `aria-hidden` by default, because nearly all of ours sit beside their
own label. Pass `title` only when the icon *is* the label.

For the surfaces where the icon is **data** — a Tool's declared rail icon, a
channel's icon, a space's feature config — use the registry instead:

```tsx
import { Icon } from '@/features/shared/icons';
<Icon name={channel.icon} className="h-4 w-4" />
```

Prefer the named exports. `Icon` pulls the whole set into the bundle, which is
the right trade only when the name genuinely comes from a database row.

Validating a name server-side? Import from `@/lib/icons/names` — it is
React-free, so route handlers and zod schemas can reach it:

```ts
import { ICON_NAMES, isIconName } from '@/lib/icons/names';
const schema = z.object({ icon: z.enum(ICON_NAMES).nullable() });
```

## Adding or changing a glyph

1. Put the SVG in `assets/icons/<name>.svg`, normalised to the spec above.
2. Record its origin in `assets/icons/ATTRIBUTION.md`. If it came from an
   open-source set, the licence usually *requires* the notice be retained; if
   you drew it, say so, so a future redraw knows it is already ours.
3. `pnpm --filter @visvine/web icons:build`
4. Commit the generated output alongside the SVG.

The generated files — `apps/web/features/shared/icons/generated/icons.tsx`,
`.../registry.ts` and `apps/web/lib/icons/names.ts` — are committed so `dev` and
`typecheck` need no prebuild step. **Never hand-edit them.** `pnpm icons:check`
regenerates in memory and fails on any difference, and it rides `lint`.

To change how *every* icon is drawn (the box, the paint, the caps), edit
`apps/web/features/shared/icons/IconBase.tsx` — the one `<svg>` they all render
through — rather than the generator.

## No emoji

Emoji are not icons. They render differently on every OS, several have no glyph
at all on Windows, and they are not ours to change. Chrome that used to be an
emoji is now an icon name: a channel's icon, a channel section's, and the space
badge that is now just initials (migration
`20260818120000_icons_replace_emoji`).

The one place emoji remain is **message reactions**, which are user content
rather than chrome — the same reason `lib/countries.ts` keeps flag emoji as a
last-resort fallback behind `CountryFlagIcon`'s flag images.

### Rolling it out: two phases

The obvious migration renames `channel_sections.emoji` and drops `spaces.emoji`,
and running that against a live database breaks the image that is still serving
— deploys here migrate *before* the new container is up, so no single migration
avoids the gap. It is split instead:

1. **Expand** — `prisma/migrations/20260818120000_icons_replace_emoji`. Additive
   only: adds `channel_sections.icon`, backfills it, strips the dead emoji out of
   `node_types`. Safe with the old code serving, and idempotent.
   **Applied to production 2026-08-18.**
2. **Contract** — `prisma/manual/20260818140000_icons_drop_emoji_columns.sql`.
   Converts `conversations.icon` from emoji to icon names and drops
   `channel_sections.emoji` and `spaces.emoji`. **Applied to production
   2026-08-18**, after the release was live at 100% traffic. See
   `apps/web/prisma/manual/README.md`.

Between the two, prod carried both columns and both readers worked. New code
meeting an emoji still sitting in `conversations.icon` falls back to the default
hash glyph, which is why that conversion was deferred rather than done early.

Both phases are now complete: production is fully migrated and
`prisma migrate diff` reports no drift beyond the pgvector HNSW indexes, which
Prisma cannot express and `apply-sql-functions.mjs` owns.

## A Tool's own icon

An installed Tool draws a row in the sidebar. It names one of ten built-in
shapes (`TOOL_RAIL_ICONS` in `apps/web/lib/tools/config.ts`, mapped onto the
owned set by `features/tools/components/toolIcons.tsx`) — or it ships its own:

```yaml
surfaces:
  rail: { label: Deals, icon: custom }
```

plus a `tools/<name>/icon.svg`, uploaded from the marketplace's **Mine** tab or
written over MCP like any other Tool file.

This is the one place markup an outside author wrote renders inside the app's
own document, outside the Tool's sandboxed iframe. `apps/web/lib/tools/iconSvg.ts`
is the entire boundary, so it is worth knowing how it behaves:

- It is an **allowlist**. Geometry elements and geometry attributes survive;
  everything else is a rejection, not a repair.
- It **re-serialises**. The output is markup the sanitizer built out of what it
  recognised — the author's bytes are never echoed through.
- It runs at **build time**, and the sanitized result is what gets stored
  (`app_tool_builds.icon_svg`) and snapshotted at publish
  (`app_tool_versions.icon_svg`). Nothing downstream re-parses author markup;
  the rail, the marketplace card and the review queue render what the build
  approved. **Do not write those columns from anywhere else.**
- A rejected icon surfaces as a normal build error against `icon.svg`, in the
  same place as a broken `ui.tsx`.

`tests/toolIconSvg.test.ts` is where the rejections are pinned down. Add a case
there before touching that file.

## The native apps

`assets/icons/` is the source of truth for all three clients, which is why it
sits at the repo root rather than inside `apps/web` — `apps/mobile` is not in
the pnpm workspace and should not reach into a sibling app's internals.

- **Android** — `apps/mobile/android/scripts/build-icons.mjs` converts the SVGs
  into `res/drawable/ic_<name>.xml` vector drawables; `ui/icons/AppIcons.kt`
  names them. Regenerate with `node scripts/build-icons.mjs` from
  `apps/mobile/android`, and commit the drawables.
- **iOS** — `apps/mobile/ios/scripts/build-icons.mjs` writes
  `Assets.xcassets/Icons/<name>.imageset` as template-rendered SVGs;
  `Components/VisvineIcon.swift` is the view that draws one, so tint keeps
  coming from the environment.

Both generators read the same directory, so adding a glyph is: drop the SVG in,
run the three generators, commit.

- **Desktop** — `apps/desktop` has no UI of its own; it loads the web app, so
  the web icons are its icons. Its *app* icon is `apps/desktop/assets/icon.png`,
  referenced from `electron-builder.yml`, and is unrelated to this set.
