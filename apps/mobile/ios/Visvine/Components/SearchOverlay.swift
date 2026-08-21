import SwiftUI

/// A floating search bar, raised over the current screen from the bottom.
struct SearchOverlay: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SearchStore.self) private var searchStore
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var search = searchStore
        let c = theme.colors
        if search.isOpen {
            VStack {
                Spacer()
                HStack(spacing: 10) {
                    HStack(spacing: 10) {
                        VisvineIcon(.search).foregroundStyle(c.textPrimary)
                        TextField(search.placeholder, text: $search.query)
                            .focused($focused)
                            .submitLabel(.search)
                            .onSubmit { search.close() }
                            .foregroundStyle(c.textPrimary)
                    }
                    .padding(.horizontal, 20)
                    .frame(height: 64)
                    .frame(maxWidth: .infinity)
                    .glass(cornerRadius: 32)

                    Button { search.close() } label: {
                        VisvineIcon(.xmark, size: 22)
                            .foregroundStyle(c.textPrimary)
                            .frame(width: 64, height: 64)
                            .glass(cornerRadius: 32)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 20)
            }
            .onAppear { focused = true }
        }
    }
}
