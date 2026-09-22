import SwiftUI

/// The header every main screen carries: space switcher, then profile avatar.
struct ScreenHeader: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(AuthManager.self) private var auth

    var showSpaceSelector: Bool = true
    var onProfile: () -> Void

    @State private var pickerVisible = false

    var body: some View {
        let c = theme.colors
        HStack {
            if showSpaceSelector {
                Button { pickerVisible = true } label: {
                    SpaceAvatar(name: space.current?.name ?? "", imageUrl: space.current?.image, size: 36)
                }
            } else {
                HStack(spacing: 8) {
                    Wordmark(size: 18)
                }
            }
            Spacer()
            Button(action: onProfile) { profileAvatar }
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .background(c.bgPrimary)
        .sheet(isPresented: $pickerVisible) {
            spacePicker.environment(theme).environment(space)
        }
    }

    private var profileAvatar: some View {
        PersonAvatar(name: auth.user?.name ?? "", imageUrl: auth.user?.image, size: 40)
    }

    private var spacePicker: some View {
        let c = theme.colors
        return NavigationStack {
            List(space.spaces) { item in
                let active = space.current?.id == item.id
                Button {
                    space.setCurrent(item)
                    pickerVisible = false
                } label: {
                    HStack(spacing: 12) {
                        SpaceAvatar(name: item.name, imageUrl: item.image, size: 28)
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
