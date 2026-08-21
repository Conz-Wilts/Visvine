import SwiftUI

/// The header every main screen carries: community switcher, then profile avatar.
struct ScreenHeader: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(CommunityStore.self) private var community
    @Environment(AuthManager.self) private var auth

    var showCommunitySelector: Bool = true
    var onProfile: () -> Void

    @State private var pickerVisible = false

    var body: some View {
        let c = theme.colors
        HStack {
            if showCommunitySelector {
                Button { pickerVisible = true } label: {
                    CommunityAvatar(name: community.current?.name ?? "", imageUrl: community.current?.image, size: 36)
                }
            } else {
                HStack(spacing: 8) {
                    VisvineIcon(.network)
                        .foregroundStyle(c.accent)
                    Text("Visvine").font(.system(size: 18, weight: .bold)).foregroundStyle(c.textPrimary)
                }
            }
            Spacer()
            Button(action: onProfile) { profileAvatar }
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .background(c.bgPrimary)
        .sheet(isPresented: $pickerVisible) {
            communityPicker.environment(theme).environment(community)
        }
    }

    @ViewBuilder private var profileAvatar: some View {
        let c = theme.colors
        if let image = auth.user?.image, let url = URL(string: image) {
            AsyncImage(url: url) { phase in
                if let img = phase.image { img.resizable().scaledToFill() } else { initialsCircle }
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())
        } else {
            initialsCircle
        }
    }

    private var initialsCircle: some View {
        let c = theme.colors
        let name = auth.user?.name ?? ""
        let initials = name.isEmpty ? "?" : avatarInitials(name)
        return ZStack {
            Circle().fill(c.accentLight)
            Text(initials).foregroundStyle(c.accentDark).font(.system(size: 15, weight: .semibold))
        }
        .frame(width: 40, height: 40)
    }

    private var communityPicker: some View {
        let c = theme.colors
        return NavigationStack {
            List(community.communities) { item in
                let active = community.current?.id == item.id
                Button {
                    community.setCurrent(item)
                    pickerVisible = false
                } label: {
                    HStack(spacing: 12) {
                        CommunityAvatar(name: item.name, imageUrl: item.image, size: 28)
                        Text(item.name).foregroundStyle(active ? c.accentDark : c.textSecondary)
                        Spacer()
                        if active { VisvineIcon(.check).foregroundStyle(c.accent) }
                    }
                }
                .listRowBackground(active ? c.accentLight : c.bgPrimary)
            }
            .navigationTitle("Space")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
