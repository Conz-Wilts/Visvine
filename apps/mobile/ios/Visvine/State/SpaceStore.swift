import Foundation
import Observation

/// App-scoped space selection — the native equivalent of SpaceProvider.
/// `spaces` is what the person has JOINED (the switcher); Discover reads the
/// wider visible list itself. Driven by the view layer on auth change (see
/// MainTabView.task), it selects the space the person was last in
/// (PreferencesStore), else the first.
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

    func setCurrent(_ space: Space?) {
        current = space
        PreferencesStore.shared.currentSpaceId = space?.id
    }

    func isJoined(_ id: String) -> Bool { spaces.contains { $0.id == id } }

    func refresh() async {
        guard auth.isAuthenticated else {
            spaces = []; current = nil; return
        }
        isLoading = true
        switch await repo.getJoined() {
        case .success(let list):
            spaces = list
            if let current, let fresh = list.first(where: { $0.id == current.id }) {
                self.current = fresh
            } else {
                let remembered = PreferencesStore.shared.currentSpaceId
                current = list.first(where: { $0.id == remembered }) ?? list.first
            }
        case .failure:
            break
        }
        isLoading = false
    }
}
