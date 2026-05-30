import Foundation
import Observation

/// In-app remote kill-switch / force-update flag, built in from day one per the
/// migration plan's safety-net (blast-radius control + fix-forward, not rollback).
///
/// This is the single seam to wire a remote source. It defaults to `.operational`
/// so it is inert until connected; `refresh()` is where that fetch goes. The root
/// view gates on this state and shows a blocking screen when not operational.
@Observable
final class KillSwitch {
    enum State: Equatable {
        case operational
        case disabled(String)
        case updateRequired(String)
    }

    var state: State = .operational

    func refresh() async {
        // e.g. state = await remoteConfig.fetchMobileGate()
    }
}
