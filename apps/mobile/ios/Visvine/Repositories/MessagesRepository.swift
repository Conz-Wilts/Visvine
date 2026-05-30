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

    /// Foreground realtime feed off `/api/messages/stream`.
    func realtimeEvents() -> AsyncStream<RealtimeEvent> { MessageStream.shared.events() }
}
