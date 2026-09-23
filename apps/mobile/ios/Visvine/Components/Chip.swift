import SwiftUI

/// A pill in a row of choices: solid when chosen, glass otherwise.
struct Chip: View {
    @Environment(ThemeStore.self) private var theme
    let label: String
    let on: Bool
    var action: () -> Void

    var body: some View {
        let c = theme.colors
        Button(action: action) {
            Text(label)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(on ? c.bgPrimary : c.textPrimary)
                .padding(.horizontal, 18)
                .frame(height: 40)
                .background(on ? c.textPrimary : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(on ? .identity : .regular.interactive(), in: .capsule)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
