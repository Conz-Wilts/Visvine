import SwiftUI

/// The brand lockup — the app icon beside "Visvine" in the brand face, in the
/// brand green. Mirrors the web's SignInCard logo.
struct Wordmark: View {
    var size: CGFloat = 18

    var body: some View {
        HStack(spacing: size * 0.45) {
            Image("Logo")
                .resizable()
                .frame(width: size * 1.55, height: size * 1.55)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.44, style: .continuous))
            Text("Visvine")
                .font(.custom("Visvine-Medium", size: size))
                .tracking(-0.02 * size)
                .foregroundStyle(Color(hex: 0x78D870))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Visvine")
    }
}
