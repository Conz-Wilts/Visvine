import Foundation

/// One server-sent event: the optional `event:` name and the joined `data:`
/// lines. Comments (`: keepalive`) never become a frame.
struct SSEFrame: Equatable {
    var event: String?
    var data: String
}

/// The SSE line grammar, as a small state machine over lines: `data:` lines
/// accumulate (joined with newlines), `event:` names the frame, a blank line
/// ends it, `:` opens a comment. Shared by the messages stream and the agent
/// chat send, which both hand-roll SSE so they can carry a Bearer header.
struct SSEParser {
    private var event: String?
    private var data: [String] = []

    /// Feed one line (without its terminator). Returns the frame a blank line closed, if any.
    mutating func feed(_ line: String) -> SSEFrame? {
        if line.isEmpty {
            guard !data.isEmpty else { event = nil; return nil }
            let frame = SSEFrame(event: event, data: data.joined(separator: "\n"))
            event = nil
            data = []
            return frame
        }
        if line.hasPrefix(":") { return nil }
        let (field, value) = split(line)
        switch field {
        case "data": data.append(value)
        case "event": event = value
        default: break
        }
        return nil
    }

    /// Anything left when the stream ends without a closing blank line.
    mutating func flush() -> SSEFrame? {
        feed("")
    }

    private func split(_ line: String) -> (String, String) {
        guard let colon = line.firstIndex(of: ":") else { return (line, "") }
        let field = String(line[..<colon])
        var value = String(line[line.index(after: colon)...])
        if value.hasPrefix(" ") { value.removeFirst() }
        return (field, value)
    }

    /// Every frame in a whole text — the test surface, and handy for a small body.
    static func frames(in text: String) -> [SSEFrame] {
        var parser = SSEParser()
        var out: [SSEFrame] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if let f = parser.feed(String(line)) { out.append(f) }
        }
        if let f = parser.flush() { out.append(f) }
        return out
    }
}
