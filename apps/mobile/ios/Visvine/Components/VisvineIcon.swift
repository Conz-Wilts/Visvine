import SwiftUI

/// The app's icons — ours, not SF Symbols.
///
/// Every glyph is an SVG in `assets/icons/` at the repo root, shared with the
/// web app and Android, copied into `Assets.xcassets/Icons` as template-rendered
/// image sets by `scripts/build-icons.mjs`. See `docs/icons.md`.
///
/// The enum exists so a renamed asset is a compile error here rather than a
/// blank square out in a view, and so call sites read like the SF Symbol ones
/// they replaced.
///
///     VisvineIcon(.check)
///     VisvineIcon(.chevronRight, size: 14)
///         .foregroundStyle(theme.accent)
///
/// The assets are marked `template`, so tint comes from `foregroundStyle` /
/// `tint` exactly as it did with `Image(systemName:)` — nothing at a call site
/// needs to change beyond the name.
///
/// Adding one: add the name to IOS_ICONS in `scripts/build-icons.mjs`, run it,
/// then add the case below.
enum VisvineIconName: String {
    case arrowDown = "arrow-down"
    case arrowLeft = "arrow-left"
    case arrowUp = "arrow-up"
    case bell
    case bot
    case calendar
    case check
    case checkCircle = "circle-check"
    case checkSquare = "square-check"
    case chevronDown = "chevron-down"
    case chevronRight = "chevron-right"
    case clock
    case globe
    case help = "circle-question-mark"
    case home = "house"
    case link = "link-2"
    case location = "map-pin"
    case lock
    case logout = "log-out"
    case mail
    case message = "message-circle"
    case mic
    case network = "waypoints"
    case palette
    case pencil
    case people = "users"
    case person = "user"
    case personAdd = "user-plus"
    case phone
    case plus
    case search
    case send
    case settings
    case sparkles
    case square
    case tag
    case tool = "hammer"
    case xmark = "x"
}

struct VisvineIcon: View {
    let name: VisvineIconName
    var size: CGFloat = 17

    init(_ name: VisvineIconName, size: CGFloat = 17) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Image(name.rawValue)
            .renderingMode(.template)
            .resizable()
            // Icons are square by design (a 24×24 canvas), so `.fit` only ever
            // guards against an asset that somehow isn't.
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
    }
}
