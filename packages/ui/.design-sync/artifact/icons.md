# Icons

The UI's glyphs: 24×24 SVG line icons, stroked in `currentColor` at 2px (1.8 for the `nav-*` and `tool-*` set drawn in-house), with round caps and joins and no fill. Most are derived from Lucide (see `ATTRIBUTION.md`).

The ink is `currentColor`, so drawn through `<img>` they show black. In a component, draw a glyph through `IconBase` so it takes the text colour: `vv-color-fg-muted` at rest and `vv-color-fg` when active or selected. Size them at 16px (`h-4 w-4`) or 14px (`h-3.5 w-3.5`) beside text, and 20px (`h-5 w-5`) where they stand alone.
