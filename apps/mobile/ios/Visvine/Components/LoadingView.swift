import SwiftUI

/// The spinner every screen waits behind — inline, or filling the screen.
struct LoadingView: View {
    @Environment(ThemeStore.self) private var theme
    var message: String? = nil
    var fullScreen: Bool = false

    var body: some View {
        VStack(spacing: VVSpace.x3) {
            ProgressView().tint(theme.colors.accent)
            if let message {
                Text(message).foregroundStyle(theme.colors.fgMuted).font(.system(size: VVFontSize.s16))
            }
        }
        .frame(maxWidth: fullScreen ? .infinity : nil, maxHeight: fullScreen ? .infinity : nil)
        .padding(fullScreen ? 0 : 24)
    }
}
