import SwiftUI
import Observation

/// Shared search state for the tab area — the native equivalent of SearchContext.
@MainActor
@Observable
final class SearchStore {
    var query = ""
    var isOpen = false
    var placeholder = "Search"

    func open() { isOpen = true }
    func close() { isOpen = false; query = "" }
}

extension View {
    /// Claims the search bar for this screen: its placeholder, and a query
    /// typed on another screen is cleared rather than carried over.
    func searchScope(_ placeholder: String) -> some View {
        modifier(SearchScope(placeholder: placeholder))
    }
}

private struct SearchScope: ViewModifier {
    @Environment(SearchStore.self) private var search
    let placeholder: String

    func body(content: Content) -> some View {
        content.onAppear {
            if search.placeholder != placeholder {
                search.placeholder = placeholder
                search.query = ""
            }
        }
    }
}
