import SwiftUI

/// Port of screens/Settings/SettingsScreen.tsx.
struct SettingsView: View {
    @Environment(ThemeStore.self) private var theme

    private let columns = Array(repeating: GridItem(.flexible()), count: 4)

    var body: some View {
        let c = theme.colors
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Appearance").font(.system(size: 13, weight: .semibold)).foregroundStyle(c.textMuted).padding(.bottom, 4)

                // Dark mode
                HStack {
                    VisvineIcon(theme.isDark ? .darkMode : .lightMode).foregroundStyle(c.accent)
                    Text("Dark Mode").font(.system(size: 16)).foregroundStyle(c.textPrimary)
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { theme.isDark },
                        set: { if $0 != theme.isDark { theme.toggleDark() } }
                    ))
                    .labelsHidden()
                    .tint(c.accent)
                }
                .padding(.vertical, 14)

                // Theme colour
                HStack {
                    VisvineIcon(.palette).foregroundStyle(c.accent)
                    Text("Theme Colour").font(.system(size: 16)).foregroundStyle(c.textPrimary)
                    Spacer()
                    Text(theme.theme.name).font(.system(size: 14)).foregroundStyle(c.textMuted)
                }
                .padding(.top, 14)

                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(theme.themes) { item in
                        let active = theme.themeId == item.id
                        VStack(spacing: 6) {
                            ZStack {
                                Circle().fill(item.accent).frame(width: active ? 36 : 32, height: active ? 36 : 32)
                                    .overlay(active ? Circle().stroke(item.accentDark, lineWidth: 2) : nil)
                                if active { VisvineIcon(.check, size: 14).foregroundStyle(.white) }
                            }
                            Text(item.name).font(.system(size: 11)).foregroundStyle(c.textMuted)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                        .onTapGesture { theme.setTheme(item.id) }
                    }
                }
                .padding(.top, 16)
            }
            .padding(16)
            .background(c.bgPrimary)
            .padding(.top, 16)
        }
        .background(c.bgSecondary)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
