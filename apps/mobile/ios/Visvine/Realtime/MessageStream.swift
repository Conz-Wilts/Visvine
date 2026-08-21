import Foundation

/// One realtime event off `/api/messages/stream`. Screens re-fetch on relevant
/// events rather than patching from the payload.
struct RealtimeEvent {
    let type: String
    let conversationId: String?
}

/// SSE consumer over `URLSession.bytes` so we can set the `Authorization: Bearer`
/// header (the browser EventSource API can't). This is foreground delivery only —
/// background delivery needs push, which is not wired up yet.
/// A 401 (expired 30-day JWT) ends the stream; callers refresh the session.
final class MessageStream {
    static let shared = MessageStream()

    func events() -> AsyncStream<RealtimeEvent> {
        AsyncStream { continuation in
            let task = Task {
                guard let url = URL(string: AppConfig.apiBase + "/api/messages/stream") else {
                    continuation.finish(); return
                }
                var request = URLRequest(url: url)
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                if let token = KeychainTokenStore.shared.token {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        continuation.finish(); return
                    }
                    for try await line in bytes.lines {
                        // SSE: payload lines start with `data:`; `:` comments (keepalive) are skipped.
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard !payload.isEmpty,
                              let data = payload.data(using: .utf8),
                              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let type = obj["type"] as? String else { continue }
                        continuation.yield(RealtimeEvent(type: type, conversationId: obj["conversationId"] as? String))
                    }
                } catch {
                    // Connection drop / cancellation — caller may reconnect.
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
