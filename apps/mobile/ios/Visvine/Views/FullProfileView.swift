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

/// Port of screens/Profile/FullProfileScreen.tsx.
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
                    VStack(spacing: 12) {
                        hero(profile)
                        if let bio = profile.bio, !bio.isEmpty { section("About") { Text(bio).foregroundStyle(c.textSecondary).font(.system(size: 14)) } }
                        if let tags = profile.tags, !tags.isEmpty { section("Skills") { skills(tags) } }
                        if hasContact(profile) { section("Contact") { contact(profile) } }
                    }
                    .padding(.bottom, 40)
                }
                .refreshable { await model.refresh(personId: personId) }
            } else {
                errorState
            }
        }
        .background(c.bgSecondary)
        .navigationTitle(model.profile?.name ?? initialName ?? "Profile")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(personId: personId) }
    }

    private func hero(_ profile: FullProfile) -> some View {
        let c = theme.colors
        return VStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                if let imageUrl = profile.imageUrl, let url = URL(string: imageUrl) {
                    AsyncImage(url: url) { phase in
                        if let img = phase.image { img.resizable().scaledToFill() } else { avatarFallback(profile.name) }
                    }
                    .frame(width: 120, height: 120).clipShape(RoundedRectangle(cornerRadius: 20))
                } else {
                    avatarFallback(profile.name)
                }
                if profile.openToWork == true {
                    VisvineIcon(.check, size: 12).foregroundStyle(.white)
                        .frame(width: 24, height: 24).background(Color(hex: 0x10B981), in: Circle())
                        .overlay(Circle().stroke(c.bgPrimary, lineWidth: 3))
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(profile.name).font(.system(size: 24, weight: .bold)).foregroundStyle(c.textPrimary)
                if let p = profile.pronouns { Text("(\(p))").font(.system(size: 14)).foregroundStyle(c.textMuted) }
            }
            if let subtitle = profile.subtitle { Text(subtitle).font(.system(size: 15)).foregroundStyle(c.textSecondary).multilineTextAlignment(.center) }

            if !isOwner {
                HStack(spacing: 8) {
                    Button { } label: {
                        Label("Connect", systemImage: "person.badge.plus").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 10).background(c.accent, in: Capsule())
                    }
                    Button {
                        if let email = profile.email, let url = URL(string: "mailto:\(email)") { openURL(url) }
                    } label: {
                        Label("Message", systemImage: "envelope").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(c.accentDark).frame(maxWidth: .infinity).padding(.vertical, 10)
                            .overlay(Capsule().stroke(c.accent, lineWidth: 1.5))
                    }
                }
            }

            HStack(spacing: 6) {
                if let year = profile.createdAt?.prefix(4), let y = Int(year) {
                    chip(icon: .calendar, text: "Member since \(y)")
                }
                if let tags = profile.tags, !tags.isEmpty {
                    chip(icon: .tag, text: "\(tags.count) skill\(tags.count == 1 ? "" : "s")")
                }
            }
        }
        .padding(20).frame(maxWidth: .infinity)
        .background(c.bgPrimary).clipShape(RoundedRectangle(cornerRadius: 20)).padding(.horizontal, 16).padding(.top, 16)
    }

    private func avatarFallback(_ name: String) -> some View {
        ZStack {
            theme.colors.accent
            Text(profileInitials(name)).foregroundStyle(.white).font(.system(size: 40, weight: .bold))
        }
        .frame(width: 120, height: 120).clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func chip(icon: VisvineIconName, text: String) -> some View {
        let c = theme.colors
        return HStack(spacing: 4) {
            VisvineIcon(icon, size: 12)
            Text(text).font(.system(size: 12, weight: .medium))
        }
        .foregroundStyle(c.textSecondary).padding(.horizontal, 10).padding(.vertical, 4).background(c.bgTertiary, in: Capsule())
    }

    private func skills(_ tags: [String]) -> some View {
        let c = theme.colors
        return FlexWrap(tags) { tag in
            Text(tag).font(.system(size: 12, weight: .semibold)).foregroundStyle(c.accentDark)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(c.accentLight, in: Capsule()).overlay(Capsule().stroke(c.accent, lineWidth: 1))
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
            HStack(spacing: 12) {
                VisvineIcon(icon).foregroundStyle(c.textMuted)
                Text(label).font(.system(size: 14)).foregroundStyle(c.textSecondary).lineLimit(1)
                Spacer()
            }
            .padding(.vertical, 10)
        }
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 14, weight: .bold)).foregroundStyle(c.textPrimary).padding(.horizontal, 16).padding(.vertical, 12)
            content().padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(c.bgPrimary).clipShape(RoundedRectangle(cornerRadius: 16)).padding(.horizontal, 16)
    }

    private func hasContact(_ p: FullProfile) -> Bool {
        [p.email, p.phone, p.website, p.linkedinUrl, p.twitterUrl].contains { !($0 ?? "").isEmpty }
    }

    private var errorState: some View {
        let c = theme.colors
        return VStack(spacing: 8) {
            Text("Profile unavailable").font(.system(size: 16, weight: .bold)).foregroundStyle(c.textPrimary)
            Text(model.error ?? "This person may have been removed.").font(.system(size: 14)).foregroundStyle(c.textMuted).multilineTextAlignment(.center)
            Button("Try again") { Task { await model.load(personId: personId) } }
                .foregroundStyle(.white).padding(.horizontal, 20).padding(.vertical, 10).background(c.accent, in: Capsule()).padding(.top, 8)
        }
        .padding(24).background(c.bgPrimary).clipShape(RoundedRectangle(cornerRadius: 16)).padding(24)
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
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 60), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(Array(data), id: \.self) { content($0) }
        }
    }
}
