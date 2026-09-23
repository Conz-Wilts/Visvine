import SwiftUI

/// The brand lockup — the green mark and "Visvine" in the brand face, in the
/// brand green. Inline in the header; `stacked` puts a larger mark above the
/// name, for the sign-in and splash screens.
struct Wordmark: View {
    var size: CGFloat = 18
    var stacked = false

    var body: some View {
        Group {
            if stacked {
                VStack(spacing: size * 0.5) {
                    mark(size * 2.6)
                    name
                }
            } else {
                HStack(spacing: size * 0.35) {
                    mark(size * 1.2)
                    name
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Visvine")
    }

    private func mark(_ side: CGFloat) -> some View {
        Image("Logo").resizable().frame(width: side, height: side)
    }

    private var name: some View {
        Text("Visvine")
            .font(.custom("Visvine-Medium", size: size))
            .tracking(-0.02 * size)
            .foregroundStyle(VVColor.brand)
    }
}
