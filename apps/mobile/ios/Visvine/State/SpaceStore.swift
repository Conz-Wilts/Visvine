import Foundation
import Observation

/// App-scoped space selection — the native equivalent of SpaceProvider.
/// Driven by the view layer on auth change (see MainTabView.task), it refreshes
/// the list and selects the first space by default.
@MainActor
@Observable
final class SpaceStore {
    var spaces: [Space] = []
    var current: Space?
    var isLoading = false

    private let repo = SpaceRepository()
    private let auth: AuthManager

    init(auth: AuthManager) {
        self.auth = auth
    }

    func setCurrent(_ space: Space?) { current = space }

    func refresh() async {
        guard auth.isAuthenticated else {
            spaces = []; current = nil; return
        }
        isLoading = true
        switch await repo.getSpaces() {
        case .success(let list):
            spaces = list
            if current == nil || !list.contains(where: { $0.id == current?.id }) {
                current = list.first
            }
        case .failure:
            break
        }
        isLoading = false
    }
}
