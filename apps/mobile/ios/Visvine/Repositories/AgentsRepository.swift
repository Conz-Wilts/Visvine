import Foundation

/// The space's agents as chat threads (docs/mobile.md § Agent chat).
struct AgentsRepository {
    private let api = APIClient.shared

    func listAgents(spaceId: String) async -> APIResult<[ChatAgentRow]> {
        let res: APIResult<ChatAgentsResponse> = await api.request("/api/spaces/\(encode(spaceId))/agents/chat")
        switch res {
        case .success(let r): return .success(r.agents)
        case .failure(let m): return .failure(m)
        }
    }

    func getMessages(spaceId: String, name: String, cursor: String? = nil) async -> APIResult<ChatPage> {
        await api.request("/api/spaces/\(encode(spaceId))/agents/\(encode(name))/chat", query: ["cursor": cursor])
    }

    func clear(spaceId: String, name: String) async -> APIResult<EmptyResponse> {
        await api.request("/api/spaces/\(encode(spaceId))/agents/\(encode(name))/chat", method: "DELETE")
    }

    /// One message, answered as it happens. POST with `Accept: text/event-stream`
    /// over `URLSession.bytes` (a Bearer header, which EventSource cannot carry);
    /// each `data:` line is a `ChatEvent`. A refusal before the turn starts
    /// (no model, busy, …) arrives as `.error`; a non-2xx answer is thrown.
    func send(spaceId: String, name: String, text: String) -> AsyncThrowingStream<ChatEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                guard let url = URL(string: AppConfig.apiBase + "/api/spaces/\(encode(spaceId))/agents/\(encode(name))/chat/stream") else {
                    continuation.finish(throwing: URLError(.badURL)); return
                }
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if let token = KeychainTokenStore.shared.token {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                request.httpBody = try? JSONEncoder().encode(ChatSendRequest(text: text))
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var body = ""
                        for try await line in bytes.lines { body += line }
                        let message = (try? JSONDecoder().decode(ErrorBody.self, from: Data(body.utf8)))?.error ?? "Request failed (\(http.statusCode))"
                        continuation.yield(.error(reason: "http", message: message))
                        continuation.finish(); return
                    }
                    var parser = SSEParser()
                    for try await line in bytes.lines {
                        if let frame = parser.feed(line), let event = ChatEventParser.parse(frame.data) {
                            continuation.yield(event)
                        }
                    }
                    if let frame = parser.flush(), let event = ChatEventParser.parse(frame.data) {
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }
}

private struct ErrorBody: Decodable { let error: String? }
