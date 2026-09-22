import SwiftUI

/// Two or three names in a row, one of them chosen — the nav over a hub. A
/// rounded square on `bgTertiary`; the chosen cell is `bgPrimary`. No pill,
/// no shadow: it sits on the surface, it does not float.
struct SegmentedNav: View {
    @Environment(ThemeStore.self) private var theme
    let items: [String]
    @Binding var selected: Int

    var body: some View {
        let c = theme.colors
        HStack(spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                let on = index == selected
                Button { selected = index } label: {
                    Text(item)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(on ? c.textPrimary : c.textMuted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                        .background(on ? c.bgPrimary : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}
