import Foundation
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
