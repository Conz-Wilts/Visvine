import SwiftUI

/// Appearance settings — the hue picker, and nothing the web app does not have.
struct SettingsView: View {
    @Environment(ThemeStore.self) private var theme

    private let columns = Array(repeating: GridItem(.flexible()), count: 4)

    var body: some View {
        let c = theme.colors
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Appearance")
                    .font(.system(size: VVFontSize.s11, weight: .semibold)).kerning(0.9)
                    .foregroundStyle(c.fgMuted)
                    .padding(.bottom, VVSpace.x1)

                // Theme colour
                HStack {
                    VisvineIcon(.palette).foregroundStyle(c.accent)
                    Text("Theme Colour").font(.system(size: VVFontSize.s16)).foregroundStyle(c.fg)
                    Spacer()
                    Text(theme.theme.name).font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted)
                }
                .padding(.top, VVSpace.x3_5)

                LazyVGrid(columns: columns, spacing: VVSpace.x4) {
                    ForEach(theme.themes) { item in
                        let active = theme.themeId == item.id
                        VStack(spacing: VVSpace.x1_5) {
                            ZStack {
                                Circle().fill(item.base).frame(width: active ? 36 : 32, height: active ? 36 : 32)
                                    .overlay(active ? Circle().stroke(item.strong, lineWidth: 2) : nil)
                                if active { VisvineIcon(.check, size: 14).foregroundStyle(.white) }
                            }
                            Text(item.name).font(.system(size: VVFontSize.s11)).foregroundStyle(c.fgMuted)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                        .onTapGesture { theme.setTheme(item.id) }
                    }
                }
                .padding(.top, VVSpace.x4)
            }
            .padding(VVSpace.x4)
        }
        .background(c.surface)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
