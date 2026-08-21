import SwiftUI

/// Nothing here yet: a line of muted text and, if there is something to do
/// about it, a text link in the accent. No tile behind the icon, no button —
/// an empty surface should be the quietest thing on the screen. Mirrors
/// components/ui/EmptyState.tsx.
struct EmptyStateView: View {
    @Environment(ThemeStore.self) private var theme

    let text: String
    var icon: VisvineIconName?
    var actionLabel: String?
    var action: (() -> Void)?

    var body: some View {
        let c = theme.colors
        VStack(spacing: 12) {
            if let icon {
                VisvineIcon(icon, size: 24).foregroundStyle(c.textMuted)
            }
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(c.textMuted)
                .multilineTextAlignment(.center)
            if let actionLabel, let action {
                Button(action: action) {
                    Text(actionLabel).font(.system(size: 14, weight: .semibold)).foregroundStyle(c.accentDark)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}
