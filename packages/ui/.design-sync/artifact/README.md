Visvine is a relationship-context platform: spaces hold their people, events, notes (called **Context**), agents and tools. The interface is clean, simple and intentional. It is flat and quiet, and every screen should explain itself without a caption.

## Content fundamentals

- **Labels name things, they don't explain.** Use one to three words: `Fixes`, `Semantic search`, `Run now`. Don't put a sentence under a checkbox, a description under a section, or "(off = …)" in a label.
- **Say only what is exceptional.** Hide an empty section, and keep a normal state silent. Never write "Nothing is scheduled" or "No folder is frozen". Show a warning line only when something is actually wrong.
- **Show state as data joined by `·`**, on one muted line: `Runs as Ana · sees 73 of 73 notes · next in 5h`.
- **Use sentence case** for everything, with no exclamation marks and no emoji.
- **Call the notes surface Context**, never "notes", "docs" or "wiki".
- **Keep how-it-works text off the page.** The server enforces the guarantees; the UI doesn't recite them.

## Visual foundations

- **Surfaces are flat.** Separate sections with hairlines (`vv-color-line-subtle`), not cards. There is no Card and no Badge component. Use a shadow only on things that float: `vv-shadow-float` for menus and popovers, and `vv-shadow-strip` for docked chrome.
- **Ground and ink.** Put pages on `vv-color-surface` (white). A faint fill is `vv-color-surface-subtle`, and hover or selected is `vv-color-surface-muted`. Body text is `vv-color-fg`, secondary text `vv-color-fg-secondary`, muted metadata `vv-color-fg-muted`, placeholders and disabled text `vv-color-fg-subtle`, and links `vv-color-fg-link`.
- **Accent vs brand.** `vv-color-accent` is the hue a person picks in Settings; there are nine, and the default is the logo green. Paint actions, selection and focus with the accent. `vv-color-brand` is the logo green and never changes, so use it only for the logo itself.
- **Status vs categorical.** `danger`, `warning`, `success` and `info` carry meaning. Each has a default (text), `-strong` (hover), `-bright` (a mark or rule), `-wash` (tinted ground) and `-line` (border) shade. The `vv-color-hue-*` sets only tell kinds of a thing apart (file types, HTTP methods) and never mean anything. Never borrow a status colour to tell kinds apart, and never use a hue for status.
- **Type colours.** `vv-color-type-<kind>` is each built-in node type's default colour (person, space, event, resource, channel, connector, agent, tool, model…). A space may override any of them.
- **Type.** The UI is set in Open Sauce One (`ui`) at 12–24px. Use `text-sm` (14px) for body, `text-xs` (12px) for metadata, `font-medium` for labels and `font-semibold` for headings. The brand face, ABC Ginto Rounded (`brand`), is for the wordmark and marketing pages only. Inside the product a heading in it reads as an advert.
- **Spacing and radii.** Spacing runs in 4px steps (`vv-space-1` = 4px, `vv-space-4` = 16px). Controls take `vv-radius-lg` (8px), and panels and dialogs `vv-radius-xl` (12px). Avatars are rounded squares (`vv-radius-lg` small, `vv-radius-xl` large), and only toggles and dot chips are `vv-radius-full`. Buttons are rounded squares, never pills.
- **Motion.** A view arrives by fading and rising 12px over 380ms on the enter curve. The tab underline slides between tabs. Nothing bounces, and every animation stops under reduced motion.
- **Focus.** Every control that takes focus draws a soft 2px ring in the accent at 40% on `focus-visible` only, never on a click.
- **Light only.** Light is the only theme any app shows; a dark palette exists but is switched on nowhere.

## Iconography

UI glyphs live in **Icons**. Each is a 24×24 SVG line icon with a 2px stroke (1.8 for the navigation set), round caps and joins, and no fill. Most are derived from Lucide; the navigation and tool glyphs were drawn in-house. They are single-ink, stroked in `currentColor`, so drawn through `<img>` they show black. In components, draw them through `IconBase` so they take the text colour, usually `vv-color-fg-muted`, or `vv-color-fg` when active. Don't mix in another icon set, and don't use emoji as icons.

## The logo

Use the `Logo` component, or the files in **Logos**. Don't redraw the mark, recolour it or put it on a busy ground.

- `mark` is the green glyph (three ringed nodes joined into a V), for light surfaces.
- `tile` is the white glyph on the green rounded square, the app icon.
- Next to the name, set "visvine" in lowercase in `brand` at weight 900, in `vv-color-brand`.

## Building with the components

Everything is on `window.VisvineUI` (React 19, loaded from `components/lib`). Style your own layout with the Tailwind utility classes compiled into `components/bundle.css`. These are named for the tokens: `bg-surface`, `bg-surface-subtle`, `text-fg`, `text-fg-muted`, `border-line-subtle`, `bg-accent`, `text-danger`, `bg-danger-wash`, `bg-hue-blue-wash text-hue-blue-fg` and `bg-type-person`. Spacing, grid, sizing and border utilities are compiled too (`gap-3`, `p-4`, `space-y-8`, `grid-cols-3`, `w-80`, `max-w-xl`, `rounded-lg`). Never use a Tailwind palette class (`gray-500`) or a hex value. For anything no utility covers, use `style` with a token variable such as `var(--vv-space-4)`.

- Put a section's switch or action in its header (`SettingsSection action={…}`).
- Pair buttons as `neutral` Cancel beside `brand` (or `danger`) confirm, right-aligned in a dialog footer.
- `Chip` is the only label shape. Colour it with a type or hue variable: `color="var(--vv-color-type-person)"`.
- `Stack` and `Row` lay children out in spacing steps (`gap={3}` is 12px).

## Not synced

- **Motion tokens** (`vv-motion-*` durations and curves) and the nine accent hues are in `components/bundle.css` as variables, but this format has no motion family and no accent axis.
- **The dark palette** is provisional and switched on nowhere, so it isn't a theme here.
- **Relation colours** (link types) are data, not paint, so they aren't included.
- **Components** are the real `@visvine/ui` build, not hand-made copies. Previews are the synced, graded stories.
