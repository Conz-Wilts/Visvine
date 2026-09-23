import SwiftUI

/// The colours a view draws with: the semantic design tokens
/// (`Tokens.generated.swift`, from packages/tokens) plus the accent the person
/// picked. The names are the token roles — the same names the web's utilities
/// (`text-fg-muted`, `bg-surface-subtle`) and Android's `VVColor` use.
struct DynamicColors {
    /// The chosen hue: fills and the selected state.
    let accent: Color
    /// Text and icons in the accent.
    let accentStrong: Color
    /// A wash behind a selected row.
    let accentSoft: Color

    let surface = VVColor.surface
    let surfaceSubtle = VVColor.surfaceSubtle
    let surfaceMuted = VVColor.surfaceMuted
    let fg = VVColor.fg
    let fgSecondary = VVColor.fgSecondary
    let fgMuted = VVColor.fgMuted
    let fgSubtle = VVColor.fgSubtle
    let line = VVColor.line
    let lineSubtle = VVColor.lineSubtle
    let danger = VVColor.danger
    let success = VVColor.success
    let warning = VVColor.warning
}

/// The palette for one accent. The app is light-only, so this is one palette, not two.
func buildColors(accent: VVAccent) -> DynamicColors {
    DynamicColors(accent: accent.base, accentStrong: accent.strong, accentSoft: accent.soft)
}
