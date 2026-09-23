import SwiftUI

/// The 1pt `lineSubtle` line that opens a group of rows. The only divider.
struct Hairline: View {
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        Rectangle().fill(theme.colors.lineSubtle).frame(height: 1)
    }
}

/// A day's label between messages, or over a group of rows.
struct DateSeparator: View {
    @Environment(ThemeStore.self) private var theme
    let label: String

    var body: some View {
        Text(label)
            .font(.system(size: VVFontSize.s11, weight: .medium))
            .foregroundStyle(theme.colors.fgMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, VVSpace.x2)
    }
}
