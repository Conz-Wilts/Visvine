import SwiftUI

/// Port of components/SearchOverlay.tsx — a floating bottom search bar.
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
                        Image(systemName: "magnifyingglass").foregroundStyle(c.textPrimary)
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
                        Image(systemName: "xmark")
                            .font(.system(size: 22, weight: .semibold))
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
