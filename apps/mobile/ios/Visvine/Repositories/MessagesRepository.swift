import Foundation

struct MessagesRepository {
    private let api = APIClient.shared

    func getConversations(query: String? = nil) async -> APIResult<[Conversation]> {
        let q = (query?.isEmpty == false) ? query : nil
        let res: APIResult<ConversationsResponse> = await api.request(
            "/api/messages/conversations", query: ["query": q]
        )
        switch res {
        case .success(let r): return .success(r.conversations)
        case .failure(let m): return .failure(m)
        }
    }

    func getMessages(conversationId: String, cursor: String? = nil) async -> APIResult<MessagesPage> {
        await api.request(
            "/api/messages/conversations/\(conversationId)/messages",
            query: ["cursor": cursor]
        )
    }

    func sendMessage(conversationId: String, text: String) async -> APIResult<Message> {
        let body = try? JSONEncoder().encode(SendMessageRequest(text: text))
        return await api.request(
            "/api/messages/conversations/\(conversationId)/messages",
            method: "POST", body: body
        )
    }

    /// The DM with one person, made on first use — the "New message" door.
    func createDm(userId: String) async -> APIResult<Conversation> {
        let body = try? JSONEncoder().encode(CreateDmRequest(userId: userId))
        let res: APIResult<CreateDmResponse> = await api.request("/api/messages/conversations", method: "POST", body: body)
        switch res {
        case .success(let r): return .success(r.conversation)
        case .failure(let m): return .failure(m)
        }
    }

    /// People the caller shares a space with, by name.
    func searchUsers(query: String?) async -> APIResult<[MessageSender]> {
        let q = (query?.isEmpty == false) ? query : nil
        let res: APIResult<UsersSearchResponse> = await api.request("/api/messages/users", query: ["query": q])
        switch res {
        case .success(let r):
            return .success(r.users.map { user in
                var copy = user
                copy.image = MediaURL.resolve(user.image)
                return copy
            })
        case .failure(let m): return .failure(m)
        }
    }

    /// Foreground realtime feed off `/api/messages/stream`.
    func realtimeEvents() -> AsyncStream<RealtimeEvent> { MessageStream.shared.events() }
}
