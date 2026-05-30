import SwiftUI

/// The RN BlurView "glass" pill — on iOS this is a real backdrop blur via
/// `.ultraThinMaterial`, with a hairline border to match the tab bar / search bar.
struct GlassBackground: ViewModifier {
    var cornerRadius: CGFloat = 32

    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.28), radius: 24, x: 0, y: 12)
    }
}

extension View {
    func glass(cornerRadius: CGFloat = 32) -> some View {
        modifier(GlassBackground(cornerRadius: cornerRadius))
    }
}
