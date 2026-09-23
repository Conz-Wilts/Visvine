import SwiftUI
import Observation

@Observable
@MainActor
final class FullProfileModel {
    var loading = true
    var refreshing = false
    var profile: FullProfile?
    var error: String?

    private let repo = ProfileRepository()

    func load(personId: String) async {
        loading = true
        await fetch(personId)
        loading = false
    }
    func refresh(personId: String) async { await fetch(personId) }

    private func fetch(_ personId: String) async {
        switch await repo.getFullProfile(personId: personId) {
        case .success(let p): profile = p; error = nil
        case .failure(let m): profile = nil; error = m
        }
    }
}

private func profileInitials(_ name: String) -> String {
    let parts = name.trimmingCharacters(in: .whitespaces).split(whereSeparator: { $0.isWhitespace })
    if parts.count == 1 { return String(parts[0].prefix(2)).uppercased() }
    guard let f = parts.first?.first, let l = parts.last?.first else { return "" }
    return (String(f) + String(l)).uppercased()
}

private func safeHostname(_ urlString: String) -> String {
    URL(string: urlString)?.host?.replacingOccurrences(of: "www.", with: "") ?? urlString
}

/// Someone else's profile: a hero, then About / Skills / Contact as blocks on
/// the flat surface, divided by hairlines.
struct FullProfileView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(\.openURL) private var openURL
    @State private var model = FullProfileModel()

    let personId: String
    let initialName: String?

    private var isOwner: Bool { auth.user?.nodeId == personId }

    var body: some View {
        let c = theme.colors
        Group {
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let profile = model.profile {
                ScrollView {
                    VStack(spacing: 0) {
                        hero(profile)
                        if let bio = profile.bio, !bio.isEmpty { section("About") { Text(bio).foregroundStyle(c.fgSecondary).font(.system(size: VVFontSize.s14)) } }
                        if let tags = profile.tags, !tags.isEmpty { section("Skills") { skills(tags) } }
                        if hasContact(profile) { section("Contact") { contact(profile) } }
                    }
                    .padding(.bottom, VVSpace.x10)
                }
                .refreshable { await model.refresh(personId: personId) }
            } else {
                errorState
            }
        }
        .background(c.surface)
        .navigationTitle(model.profile?.name ?? initialName ?? "Profile")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(personId: personId) }
    }

    private func hero(_ profile: FullProfile) -> some View {
        let c = theme.colors
        return VStack(spacing: VVSpace.x3) {
            ZStack(alignment: .bottomTrailing) {
                if let imageUrl = profile.imageUrl, let url = URL(string: imageUrl) {
                    AsyncImage(url: url) { phase in
                        if let img = phase.image { img.resizable().scaledToFill() } else { avatarFallback(profile.name) }
                    }
                    .frame(width: 120, height: 120).clipShape(RoundedRectangle(cornerRadius: VVRadius.xl2))
                } else {
                    avatarFallback(profile.name)
                }
                if profile.openToWork == true {
                    VisvineIcon(.check, size: 12).foregroundStyle(.white)
                        .frame(width: 24, height: 24).background(VVColor.successBright, in: Circle())
                        .overlay(Circle().stroke(c.surface, lineWidth: 3))
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: VVSpace.x1_5) {
                Text(profile.name).font(.system(size: VVFontSize.s24, weight: .bold)).foregroundStyle(c.fg)
                if let p = profile.pronouns { Text("(\(p))").font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted) }
            }
            if let subtitle = profile.subtitle { Text(subtitle).font(.system(size: VVFontSize.s15)).foregroundStyle(c.fgSecondary).multilineTextAlignment(.center) }

            if !isOwner {
                HStack(spacing: VVSpace.x2) {
                    // Rounded squares, not pills, and painted rather than
                    // outlined — the pair Button.tsx draws for brand + neutral.
                    Button { } label: {
                        Text("Connect").font(.system(size: VVFontSize.s14, weight: .semibold))
                            .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, VVSpace.x3)
                            .background(c.accent, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                    }
                    Button {
                        if let email = profile.email, let url = URL(string: "mailto:\(email)") { openURL(url) }
                    } label: {
                        Text("Message").font(.system(size: VVFontSize.s14, weight: .semibold))
                            .foregroundStyle(c.fgSecondary).frame(maxWidth: .infinity).padding(.vertical, VVSpace.x3)
                            .background(c.surfaceSubtle, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                    }
                }
            }

            HStack(spacing: VVSpace.x1_5) {
                if let year = profile.createdAt?.prefix(4), let y = Int(year) {
                    chip(icon: .calendar, text: "Member since \(y)")
                }
                if let tags = profile.tags, !tags.isEmpty {
                    chip(icon: .tag, text: "\(tags.count) skill\(tags.count == 1 ? "" : "s")")
                }
            }
        }
        .padding(.horizontal, VVSpace.x4).padding(.top, VVSpace.x4).padding(.bottom, VVSpace.x6)
        .frame(maxWidth: .infinity)
    }

    private func avatarFallback(_ name: String) -> some View {
        ZStack {
            theme.colors.accent
            Text(profileInitials(name)).foregroundStyle(.white).font(.system(size: 40, weight: .bold))
        }
        .frame(width: 120, height: 120).clipShape(RoundedRectangle(cornerRadius: VVRadius.xl2))
    }

    private func chip(icon: VisvineIconName, text: String) -> some View {
        let c = theme.colors
        return HStack(spacing: VVSpace.x1) {
            VisvineIcon(icon, size: 12)
            Text(text).font(.system(size: VVFontSize.s12, weight: .medium))
        }
        .foregroundStyle(c.fgSecondary).padding(.horizontal, VVSpace.x2).padding(.vertical, VVSpace.x1)
        .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: VVRadius.md))
    }

    private func skills(_ tags: [String]) -> some View {
        let c = theme.colors
        // One shape for every label in the app: a rounded square, painted or
        // plain, never a tinted wash inside a border of the same hue.
        return FlexWrap(tags) { tag in
            Text(tag).font(.system(size: VVFontSize.s11, weight: .semibold)).foregroundStyle(c.fgSecondary)
                .padding(.horizontal, VVSpace.x2).padding(.vertical, 5)
                .background(c.surfaceMuted, in: RoundedRectangle(cornerRadius: VVRadius.md))
        }
    }

    @ViewBuilder private func contact(_ profile: FullProfile) -> some View {
        VStack(spacing: 0) {
            if let email = profile.email { contactRow(.mail, email) { openURL(URL(string: "mailto:\(email)")!) } }
            if let phone = profile.phone { contactRow(.phone, phone) { openURL(URL(string: "tel:\(phone)")!) } }
            if let website = profile.website { contactRow(.globe, safeHostname(website)) { if let u = URL(string: website) { openURL(u) } } }
            if let linkedin = profile.linkedinUrl { contactRow(.link, "LinkedIn") { if let u = URL(string: linkedin) { openURL(u) } } }
            if let twitter = profile.twitterUrl { contactRow(.link, "X / Twitter") { if let u = URL(string: twitter) { openURL(u) } } }
        }
    }

    private func contactRow(_ icon: VisvineIconName, _ label: String, _ action: @escaping () -> Void) -> some View {
        let c = theme.colors
        return Button(action: action) {
            HStack(spacing: VVSpace.x3) {
                VisvineIcon(icon).foregroundStyle(c.fgMuted)
                Text(label).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgSecondary).lineLimit(1)
                Spacer()
            }
            .padding(.vertical, VVSpace.x2_5)
        }
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(c.lineSubtle).frame(height: 1)
            Text(title.uppercased())
                .font(.system(size: VVFontSize.s11, weight: .semibold)).kerning(0.9).foregroundStyle(c.fgMuted)
                .padding(.horizontal, VVSpace.x4).padding(.top, VVSpace.x5).padding(.bottom, VVSpace.x2)
            content().padding(.horizontal, VVSpace.x4).padding(.bottom, VVSpace.x5)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func hasContact(_ p: FullProfile) -> Bool {
        [p.email, p.phone, p.website, p.linkedinUrl, p.twitterUrl].contains { !($0 ?? "").isEmpty }
    }

    private var errorState: some View {
        let c = theme.colors
        return VStack(spacing: VVSpace.x2) {
            Text("Profile unavailable").font(.system(size: VVFontSize.s16, weight: .bold)).foregroundStyle(c.fg)
            Text(model.error ?? "This person may have been removed.").font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted).multilineTextAlignment(.center)
            Button("Try again") { Task { await model.load(personId: personId) } }
                .font(.system(size: VVFontSize.s14, weight: .semibold)).foregroundStyle(c.accentStrong).padding(.top, VVSpace.x2)
        }
        .padding(VVSpace.x6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Minimal flow-layout wrapper for skill pills.
struct FlexWrap<Data: RandomAccessCollection, Content: View>: View where Data.Element: Hashable {
    let data: Data
    let content: (Data.Element) -> Content
    init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {
        self.data = data; self.content = content
    }
    var body: some View {
        // iOS 16+: SwiftUI Layout could be used; a simple wrapping HStack via
        // `FlowLayout` is overkill here — use a LazyVGrid adaptive grid.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 60), spacing: VVSpace.x1_5, alignment: .leading)], alignment: .leading, spacing: VVSpace.x1_5) {
            ForEach(Array(data), id: \.self) { content($0) }
        }
    }
}
