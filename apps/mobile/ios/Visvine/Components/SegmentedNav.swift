import SwiftUI

/// Two or three names in a row, one of them chosen — the nav over a hub. A
/// rounded square on `surfaceMuted`; the chosen cell is `surface`. No pill,
/// no shadow: it sits on the surface, it does not float.
struct SegmentedNav: View {
    @Environment(ThemeStore.self) private var theme
    let items: [String]
    @Binding var selected: Int

    var body: some View {
        let c = theme.colors
        HStack(spacing: VVSpace.x0_5) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                let on = index == selected
                Button { selected = index } label: {
                    Text(item)
                        .font(.system(size: VVFontSize.s14, weight: .semibold))
                        .foregroundStyle(on ? c.fg : c.fgMuted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                        .background(on ? c.surface : Color.clear, in: RoundedRectangle(cornerRadius: VVRadius.md, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(VVSpace.x0_5)
        .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: VVRadius.lg, style: .continuous))
        .padding(.horizontal, VVSpace.x4)
        .padding(.vertical, VVSpace.x2)
    }
}
