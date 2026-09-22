import SwiftUI

/// The 1pt `borderSubtle` line that opens a group of rows. The only divider.
struct Hairline: View {
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        Rectangle().fill(theme.colors.borderSubtle).frame(height: 1)
    }
}

/// A day's label between messages, or over a group of rows.
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
