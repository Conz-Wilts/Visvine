import SwiftUI

/// The 1pt `borderSubtle` line that opens a group of rows. The only divider.
struct Hairline: View {
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        Rectangle().fill(theme.colors.borderSubtle).frame(height: 1)
    }
}

/// A day's label between messages, or over a group of activity rows.
struct DateSeparator: View {
    @Environment(ThemeStore.self) private var theme
    let label: String

    var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(theme.colors.textMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
    }
}

/// A row that opens something: a glyph, a name, a chevron. Home's People and Events.
struct LinkRow: View {
    @Environment(ThemeStore.self) private var theme
    let icon: VisvineIconName
    let label: String

    var body: some View {
        let c = theme.colors
        HStack(spacing: 12) {
            VisvineIcon(icon, size: 18).foregroundStyle(c.textMuted).frame(width: 24)
            Text(label).font(.system(size: 15, weight: .medium)).foregroundStyle(c.textPrimary)
            Spacer()
            VisvineIcon(.chevronRight, size: 14).foregroundStyle(c.textLight)
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
        .contentShape(Rectangle())
    }
}
