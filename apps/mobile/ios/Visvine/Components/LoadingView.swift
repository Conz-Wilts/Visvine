import SwiftUI

/// Port of components/Loading.tsx.
struct LoadingView: View {
    @Environment(ThemeStore.self) private var theme
    var message: String? = nil
    var fullScreen: Bool = false

    var body: some View {
        VStack(spacing: 12) {
            ProgressView().tint(theme.colors.accent)
            if let message {
                Text(message).foregroundStyle(theme.colors.textMuted).font(.system(size: 16))
            }
        }
        .frame(maxWidth: fullScreen ? .infinity : nil, maxHeight: fullScreen ? .infinity : nil)
        .padding(fullScreen ? 0 : 24)
    }
}
