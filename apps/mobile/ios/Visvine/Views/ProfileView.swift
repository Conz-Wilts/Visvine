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
        .background(c.bgPrimary)
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
                                .background(c.bgPrimary, in: Circle())
                                .overlay(Circle().stroke(c.borderSubtle, lineWidth: 1))
                        }
                    }
                    Text(displayName).font(.system(size: 24, weight: .bold)).foregroundStyle(c.textPrimary).padding(.top, 16)
                    if let title = profile?.title { Text(title).font(.system(size: 16)).foregroundStyle(c.textMuted) }
                    if let company = profile?.company { Text(company).font(.system(size: 14)).foregroundStyle(c.textMuted) }
                }
                .padding(24).frame(maxWidth: .infinity)

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
                        HStack(spacing: 12) {
                            Circle().fill(c.accent).frame(width: 8, height: 8)
                            Text(item.name).font(.system(size: 16)).foregroundStyle(active ? c.accent : c.textSecondary)
                            Spacer()
                            if active { VisvineIcon(.checkCircle).foregroundStyle(c.accent) }
                        }
                        .padding(.vertical, 12)
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
                            VisvineIcon(.logout).foregroundStyle(c.error)
                            Text("Sign Out").font(.system(size: 16, weight: .medium)).foregroundStyle(c.error)
                            Spacer()
                        }
                        .padding(.vertical, 14)
                    }
                }

                Text("Version 0.1.0").font(.system(size: 12)).foregroundStyle(c.textMuted).padding(.top, 24)
            }
            .padding(.bottom, 32)
        }
    }

    private func initialsAvatar(_ name: String) -> some View {
        let c = theme.colors
        let initials = name.isEmpty ? "?" : avatarInitials(name)
        return ZStack {
            Circle().fill(c.accentLight)
            Text(initials).font(.system(size: 36, weight: .semibold)).foregroundStyle(c.accentDark)
        }
        .frame(width: 100, height: 100)
    }

    /// A block of rows on the flat surface, opened by a hairline. No card, no
    /// radius — the rule is what separates one group from the next.
    private func section(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(theme.colors.borderSubtle).frame(height: 1)
            VStack(alignment: .leading, spacing: 0) { content() }
                .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .padding(.top, 8)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .kerning(0.9)
            .foregroundStyle(theme.colors.textMuted)
            .padding(.top, 12).padding(.bottom, 4)
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 12)).foregroundStyle(c.textMuted)
            Text(value).font(.system(size: 16)).foregroundStyle(c.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
    }

    private func menuRow(_ icon: VisvineIconName, _ label: String, route: ProfileRoute) -> some View {
        let c = theme.colors
        return NavigationLink(value: route) {
            HStack(spacing: 12) {
                VisvineIcon(icon).foregroundStyle(c.textSecondary).frame(width: 24)
                Text(label).font(.system(size: 16)).foregroundStyle(c.textSecondary)
                Spacer()
                VisvineIcon(.chevronRight).foregroundStyle(c.textMuted)
            }
            .padding(.vertical, 14)
        }
    }

    private func menuStatic(_ icon: VisvineIconName, _ label: String) -> some View {
        let c = theme.colors
        return HStack(spacing: 12) {
            VisvineIcon(icon).foregroundStyle(c.textSecondary).frame(width: 24)
            Text(label).font(.system(size: 16)).foregroundStyle(c.textSecondary)
            Spacer()
            VisvineIcon(.chevronRight).foregroundStyle(c.textMuted)
        }
        .padding(.vertical, 14)
    }
}
