## Building with Visvine

Visvine's UI is flat and quiet: white surfaces, hairline sections, no cards, and a
shadow only on things that float. Screens say only what is exceptional.

**Setup.** No provider is needed. Components work bare, and `UIProvider` only swaps in
an app's link and image components. Link `styles.css` once: it carries the tokens, the
Open Sauce One faces and every utility class below. Light theme only.

**Styling is Tailwind utility classes named after the design tokens**, compiled into
`_ds_bundle.css`. Only compiled classes exist. Use these families and never a palette
class (`gray-500`) or a hex:

| Role | Classes |
|---|---|
| Surface | `bg-surface`, `bg-surface-subtle`, `bg-surface-muted` |
| Ink | `text-fg`, `text-fg-secondary`, `text-fg-muted`, `text-fg-subtle`, `text-fg-link` |
| Line | `border-line`, `border-line-subtle`, `divide-y divide-line-subtle` |
| Accent (the chosen hue) | `bg-accent`, `text-accent-strong`, `bg-accent-soft` |
| Status (meaning) | `text-danger`, `bg-danger-wash`, `border-danger-line`; same for `warning`, `success`, `info` |
| Categorical (kinds, no meaning) | `bg-hue-blue-wash text-hue-blue-fg`: red orange amber yellow green teal cyan sky blue indigo violet pink gray |
| Entity types | `bg-type-person`, `text-type-event-fg`, `bg-type-agent-wash`… |
| Type | `text-xs`…`text-2xl`, `font-medium`, `font-semibold` (Open Sauce One, the UI face) |
| Logo | `<Logo variant="mark" />` (green glyph) or `<Logo variant="tile" />` (white on green, the app icon), `size` in px. Never redraw or recolour it |
| Brand face | `font-brand`: ABC Ginto Rounded, the Visvine wordmark face, weights 100–950 (`font-black` for the logo). Marketing pages and the wordmark only. Never inside the product, where a heading in it reads as an ad |
| Space / radius | `gap-3`, `p-4`, `space-y-8`; `rounded-lg`, `rounded-full` |
| Float | `shadow-float` (menus, popovers only) |

Spacing, grid (`grid-cols-*`), sizing (`w-80`, `max-w-xl`, `h-10`) and border utilities
are all compiled. For a value no utility covers, use `style={{…}}` with a token
variable, e.g. `var(--vv-color-fg-muted)` or `var(--vv-space-4)`. Every variable is in
`tokens/tokens.css`. Colour props (`Chip color`, `Avatar accentColor`) take a CSS
colour; pass a token variable such as `'var(--vv-color-type-person)'`.

**Rules the components assume.**
- Labels are one to three words and name things. Don't write sentences under controls.
- A section's switch or action sits in its header (`SettingsSection action={…}`).
- Hide an empty section. `EmptyState` is for a surface that is empty as a whole.
- State is one muted line joined by `·`: `Runs as Ana · next in 5h`.
- `Chip` is the only badge and label shape. There is no Card and no Badge.
- `Button`: `brand` for the action, `neutral` beside it (Cancel), `danger` for
  destructive actions, `ghost`/`danger-text` for quiet actions in a row.

**Where the truth lives.** `components/<group>/<Name>/<Name>.prompt.md` has props and
working examples for all 30 components, and `tokens/tokens.css` has every `--vv-*`
value.

```jsx
const { SettingsSection, Stack, Row, Field, Input, Toggle, Button } = window.VisvineUI;

<div className="max-w-xl space-y-8">
  <SettingsSection title="General" action={<Button variant="brand">Save</Button>}>
    <Stack gap={4}>
      <Field label="Name"><Input defaultValue="Growth team" /></Field>
      <Row justify="between" className="border-t border-line-subtle pt-4">
        <span className="text-sm font-semibold text-fg">Channels</span>
        <Toggle checked onChange={() => {}} aria-label="Channels" />
      </Row>
    </Stack>
  </SettingsSection>
</div>
```
