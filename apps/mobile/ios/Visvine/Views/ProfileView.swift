import SwiftUI
import Observation

@Observable
@MainActor
final class ProfileModel {
    var loading = true
    var profile: DirectoryMember?

    private let repo = ProfileRepository()

    func load(auth: AuthManager) async {
        guard let user = auth.user else { loading = false; return }
        switch await repo.getProfile(personId: user.nodeId ?? user.id) {
        case .success(let p): profile = p
        case .failure: break
        }
        loading = false
    }
}

/// Your own profile, presented as a modal flow: a header, then sections
/// divided by hairlines on the one flat surface.
struct ProfileView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(SpaceStore.self) private var space
    @Environment(\.dismiss) private var dismiss
    @State private var model = ProfileModel()
    @State private var confirmSignOut = false

    var body: some View {
        let c = theme.colors
        Group {
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .background(c.surface)
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } } }
        .task { await model.load(auth: auth) }
        .confirmationDialog("Sign Out", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) { auth.logout() }
            Button("Cancel", role: .cancel) { }
        } message: { Text("Are you sure you want to sign out?") }
    }

    private var content: some View {
        let c = theme.colors
        let profile = model.profile
        let displayName = profile?.name ?? auth.user?.name ?? "Unknown"
        let avatarURL = profile?.imageUrl ?? auth.user?.image
        return ScrollView {
            VStack(spacing: 0) {
                // Header
                VStack(spacing: 0) {
                    ZStack(alignment: .bottomTrailing) {
                        if let avatarURL, let url = URL(string: avatarURL) {
                            AsyncImage(url: url) { phase in
                                if let img = phase.image { img.resizable().scaledToFill() } else { initialsAvatar(displayName) }
                            }
                            .frame(width: 100, height: 100).clipShape(Circle())
                        } else {
                            initialsAvatar(displayName)
                        }
                        NavigationLink(value: ProfileRoute.edit) {
                            VisvineIcon(.pencil, size: 14).foregroundStyle(c.accent)
                                .frame(width: 32, height: 32)
                                .background(c.surface, in: Circle())
                                .overlay(Circle().stroke(c.lineSubtle, lineWidth: 1))
                        }
                    }
                    Text(displayName).font(.system(size: VVFontSize.s24, weight: .bold)).foregroundStyle(c.fg).padding(.top, VVSpace.x4)
                    if let title = profile?.title { Text(title).font(.system(size: VVFontSize.s16)).foregroundStyle(c.fgMuted) }
                    if let company = profile?.company { Text(company).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted) }
                }
                .padding(VVSpace.x6).frame(maxWidth: .infinity)

                // Contact
                if !(auth.user?.email ?? "").isEmpty || !(profile?.location ?? "").isEmpty {
                    section {
                        sectionTitle("Contact Information")
                        if let email = auth.user?.email, !email.isEmpty { infoRow("Email", email) }
                        if let location = profile?.location { infoRow("Location", location) }
                    }
                }

                // Spaces
                section {
                    sectionTitle("Spaces")
                    ForEach(space.spaces) { item in
                        let active = space.current?.id == item.id
                        HStack(spacing: VVSpace.x3) {
                            Circle().fill(c.accent).frame(width: 8, height: 8)
                            Text(item.name).font(.system(size: VVFontSize.s16)).foregroundStyle(active ? c.accent : c.fgSecondary)
                            Spacer()
                            if active { VisvineIcon(.check).foregroundStyle(c.accent) }
                        }
                        .padding(.vertical, VVSpace.x3)
                    }
                }

                // Menu
                section {
                    menuRow(.person, "Edit Profile", route: .edit)
                    menuRow(.settings, "Settings", route: .settings)
                    menuStatic(.help, "Help & Support")
                }

                // Sign out
                section {
                    Button { confirmSignOut = true } label: {
                        HStack {
                            Spacer()
                            VisvineIcon(.logout).foregroundStyle(c.danger)
                            Text("Sign Out").font(.system(size: VVFontSize.s16, weight: .medium)).foregroundStyle(c.danger)
                            Spacer()
                        }
                        .padding(.vertical, VVSpace.x3_5)
                    }
                }

                Text("Version 0.1.0").font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted).padding(.top, VVSpace.x6)
            }
            .padding(.bottom, VVSpace.x8)
        }
    }

    private func initialsAvatar(_ name: String) -> some View {
        let c = theme.colors
        let initials = name.isEmpty ? "?" : avatarInitials(name)
        return ZStack {
            Circle().fill(c.accentSoft)
            Text(initials).font(.system(size: VVFontSize.s36, weight: .semibold)).foregroundStyle(c.accentStrong)
        }
        .frame(width: 100, height: 100)
    }

    /// A block of rows on the flat surface, opened by a hairline. No card, no
    /// radius — the rule is what separates one group from the next.
    private func section(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(theme.colors.lineSubtle).frame(height: 1)
            VStack(alignment: .leading, spacing: 0) { content() }
                .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x2)
        }
        .padding(.top, VVSpace.x2)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: VVFontSize.s11, weight: .semibold))
            .kerning(0.9)
            .foregroundStyle(theme.colors.fgMuted)
            .padding(.top, VVSpace.x3).padding(.bottom, VVSpace.x1)
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: VVSpace.x0_5) {
            Text(label).font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgMuted)
            Text(value).font(.system(size: VVFontSize.s16)).foregroundStyle(c.fg)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, VVSpace.x3)
    }

    private func menuRow(_ icon: VisvineIconName, _ label: String, route: ProfileRoute) -> some View {
        let c = theme.colors
        return NavigationLink(value: route) {
            HStack(spacing: VVSpace.x3) {
                VisvineIcon(icon).foregroundStyle(c.fgSecondary).frame(width: 24)
                Text(label).font(.system(size: VVFontSize.s16)).foregroundStyle(c.fgSecondary)
                Spacer()
                VisvineIcon(.chevronRight).foregroundStyle(c.fgMuted)
            }
            .padding(.vertical, VVSpace.x3_5)
        }
    }

    private func menuStatic(_ icon: VisvineIconName, _ label: String) -> some View {
        let c = theme.colors
        return HStack(spacing: VVSpace.x3) {
            VisvineIcon(icon).foregroundStyle(c.fgSecondary).frame(width: 24)
            Text(label).font(.system(size: VVFontSize.s16)).foregroundStyle(c.fgSecondary)
            Spacer()
            VisvineIcon(.chevronRight).foregroundStyle(c.fgMuted)
        }
        .padding(.vertical, VVSpace.x3_5)
    }
}
