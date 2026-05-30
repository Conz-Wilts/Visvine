import Foundation
import Observation

/// App-scoped community selection — the native equivalent of CommunityProvider.
/// Driven by the view layer on auth change (see MainTabView.task), it refreshes
/// the list and selects the first community by default, matching the RN behaviour.
@MainActor
@Observable
final class CommunityStore {
    var communities: [Community] = []
    var current: Community?
    var isLoading = false

    private let repo = CommunityRepository()
    private let auth: AuthManager

    init(auth: AuthManager) {
        self.auth = auth
    }

    func setCurrent(_ community: Community?) { current = community }

    func refresh() async {
        guard auth.isAuthenticated else {
            communities = []; current = nil; return
        }
        isLoading = true
        switch await repo.getCommunities() {
        case .success(let list):
            communities = list
            if current == nil || !list.contains(where: { $0.id == current?.id }) {
                current = list.first
            }
        case .failure:
            break
        }
        isLoading = false
    }
}
