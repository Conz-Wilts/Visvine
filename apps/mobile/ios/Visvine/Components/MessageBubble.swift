import SwiftUI

/// One bubble. Mine on the right in the accent; another person's on the left
/// on `surface`; an agent's on the left on `surfaceMuted`. Radius 18 with a
/// tighter tail corner, like Messages.
struct MessageBubble: View {
    @Environment(ThemeStore.self) private var theme
    let text: String
    let isOwn: Bool
    var time: String?
    var senderName: String?
    var agent = false
    /// A failed answer: muted text on the agent tint.
    var failed = false

    var body: some View {
        let c = theme.colors
        HStack(alignment: .bottom, spacing: VVSpace.x2) {
            if isOwn { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: VVSpace.x1) {
                if let senderName, !isOwn {
                    Text(senderName).font(.system(size: VVFontSize.s12, weight: .semibold)).foregroundStyle(c.fgMuted)
                }
                Text(text)
                    .font(.system(size: VVFontSize.s16))
                    .foregroundStyle(isOwn ? .white : (failed ? c.fgMuted : c.fg))
                    .textSelection(.enabled)
                if let time {
                    Text(time).font(.system(size: VVFontSize.s10)).foregroundStyle(isOwn ? Color.white.opacity(0.7) : c.fgSubtle)
                }
            }
            .padding(.horizontal, VVSpace.x3_5)
            .padding(.vertical, VVSpace.x2_5)
            .background(fill(c), in: BubbleShape(tail: isOwn ? .right : .left))
            if !isOwn { Spacer(minLength: 48) }
        }
    }

    private func fill(_ c: DynamicColors) -> Color {
        if isOwn { return c.accent }
        return agent ? c.surfaceMuted : c.surface
    }
}

/// 18pt corners with the tail corner at 6pt.
struct BubbleShape: Shape {
    enum Tail { case left, right }
    let tail: Tail

    func path(in rect: CGRect) -> Path {
        let big: CGFloat = 18
        let small: CGFloat = 6
        let bl = tail == .left ? small : big
        let br = tail == .right ? small : big
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + big, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - big, y: rect.minY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + big), control: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - br, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - bl), control: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + big))
        p.addQuadCurve(to: CGPoint(x: rect.minX + big, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        p.closeSubpath()
        return p
    }
}
