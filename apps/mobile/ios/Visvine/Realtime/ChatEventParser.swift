import Foundation

/// One `data:` payload of the agent chat stream → a `ChatEvent`. The server
/// writes `{ "type": … }` (lib/agents/shared/chat.ts#ChatStreamEvent); a type
/// this build does not know, or a payload that is not JSON, is nil and skipped.
enum ChatEventParser {
    private static let decoder = JSONDecoder()

    static func parse(_ data: String) -> ChatEvent? {
        guard let bytes = data.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        switch type {
        case "user", "done":
            guard let raw = obj["message"],
                  let payload = try? JSONSerialization.data(withJSONObject: raw),
                  let message = try? decoder.decode(ChatMessage.self, from: payload) else { return nil }
            return type == "user" ? .user(message) : .done(message)
        case "tool":
            return .tool(name: obj["tool"] as? String ?? "", detail: obj["detail"] as? String ?? "")
        case "tool_result":
            return .toolResult(name: obj["tool"] as? String ?? "", text: obj["text"] as? String ?? "")
        case "assistant":
            return .assistant(text: obj["text"] as? String ?? "")
        case "error":
            return .error(reason: obj["reason"] as? String ?? "error", message: obj["message"] as? String ?? "Something went wrong.")
        default:
            return nil
        }
    }
}
