import Foundation

/// One row of Messages → Agents — mirrors lib/agents/chat.ts `ChatAgentRow`
/// (GET /api/spaces/<id>/agents/chat).
struct ChatThreadInfo: Codable {
    var lastMessageAt: String?
    var lastPreview: String?
    var unread: Bool
}

struct ChatAgentRow: Codable, Identifiable {
    var id: String { name }
    let name: String
    var title: String
    var description: String?
    /// A model can run it and the brief parses.
    var ready: Bool
    /// Why not, in one sentence, when `ready` is false.
    var problem: String?
    /// A turn is being answered right now.
    var answering: Bool
    var thread: ChatThreadInfo?
}

struct ChatAgentsResponse: Codable {
    let agents: [ChatAgentRow]
}

/// One tool call of a turn — mirrors lib/agents/shared/chat.ts `ChatTrace`.
struct ChatTrace: Codable, Hashable {
    var tool: String
    var detail: String
    var ok: Bool
}

/// One bubble of a thread — mirrors `ChatMessageDto`.
struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    /// "user" | "assistant"
    var role: String
    var text: String
    /// "pending" | "done" | "failed"
    var status: String
    var reason: String?
    var trace: [ChatTrace]
    var createdAt: String

    var isOwn: Bool { role == "user" }
    var failed: Bool { status == "failed" }
}

/// GET …/agents/<name>/chat?cursor=&limit= — newest first.
struct ChatPage: Codable {
    var messages: [ChatMessage]
    var nextCursor: String?
}

struct ChatSendRequest: Codable {
    let text: String
}

/// POST …/agents/<name>/chat (the JSON, non-streaming form).
struct ChatSendResponse: Codable {
    let userMessage: ChatMessage
    let message: ChatMessage
}

/// What the streaming send hands over as it goes — mirrors `ChatStreamEvent`.
/// Parsed by hand from `data:` lines (see AgentsRepository), never Codable.
enum ChatEvent: Equatable {
    case user(ChatMessage)
    case tool(name: String, detail: String)
    case toolResult(name: String, text: String)
    case assistant(text: String)
    case done(ChatMessage)
    case error(reason: String, message: String)
}
