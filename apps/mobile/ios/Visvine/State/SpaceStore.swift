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
    /// The space sidebar, drawn over every tab by MainTabView.
    var switcherOpen = false

    private let repo = SpaceRepository()
    private let auth: AuthManager

    init(auth: AuthManager) {
        self.auth = auth
    }

    func setCurrent(_ space: Space?) {
        current = space
        PreferencesStore.shared.currentSpaceId = space?.id
    }

    /// One branch per top-level space with the rooms the person also holds. A
    /// room whose house they are not in stands as its own branch.
    struct Branch: Identifiable {
        let house: Space
        let rooms: [Space]
        var id: String { house.id }
    }

    var tree: [Branch] {
        let ids = Set(spaces.map(\.id))
        let isRoomHere = { (s: Space) in s.parentId.map(ids.contains) ?? false }
        return spaces.filter { !isRoomHere($0) }.map { house in
            Branch(house: house, rooms: spaces.filter { $0.parentId == house.id })
        }
    }

    func parent(of s: Space) -> Space? {
        s.parentId.flatMap { id in spaces.first { $0.id == id } }
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
