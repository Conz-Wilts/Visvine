import XCTest
@testable import Visvine

/// The SSE line grammar the two streams share.
final class SSEParserTests: XCTestCase {

    func testFramesOnBlankLinesAndSkipsComments() {
        let text = ": connected\n\ndata: {\"type\":\"a\"}\n\n: keepalive\n\ndata: {\"type\":\"b\"}\n\n"
        XCTAssertEqual(SSEParser.frames(in: text), [
            SSEFrame(event: nil, data: "{\"type\":\"a\"}"),
            SSEFrame(event: nil, data: "{\"type\":\"b\"}"),
        ])
    }

    func testJoinsMultilineDataAndCarriesEventName() {
        let text = "event: tool\ndata: line one\ndata: line two\n\n"
        XCTAssertEqual(SSEParser.frames(in: text), [SSEFrame(event: "tool", data: "line one\nline two")])
    }

    func testFlushesATrailingFrameWithoutBlankLine() {
        XCTAssertEqual(SSEParser.frames(in: "data: tail"), [SSEFrame(event: nil, data: "tail")])
        XCTAssertEqual(SSEParser.frames(in: "\n\n"), [])
    }

    func testStripsOneLeadingSpaceOnly() {
        XCTAssertEqual(SSEParser.frames(in: "data:  two\n\n"), [SSEFrame(event: nil, data: " two")])
        XCTAssertEqual(SSEParser.frames(in: "data:none\n\n"), [SSEFrame(event: nil, data: "none")])
    }

    func testChatEventsDecode() {
        let done = "data: {\"type\":\"done\",\"message\":{\"id\":\"m1\",\"role\":\"assistant\",\"text\":\"hi\",\"status\":\"done\",\"reason\":\"finished\",\"trace\":[],\"createdAt\":\"2026-09-22T00:00:00.000Z\"}}\n\n"
        let events = SSEParser.frames(in: done).compactMap { ChatEventParser.parse($0.data) }
        XCTAssertEqual(events.count, 1)
        if case .done(let m) = events[0] { XCTAssertEqual(m.id, "m1") } else { XCTFail("expected done") }
        XCTAssertEqual(ChatEventParser.parse("{\"type\":\"tool\",\"tool\":\"search_context\",\"detail\":\"sso\"}"), .tool(name: "search_context", detail: "sso"))
        XCTAssertEqual(ChatEventParser.parse("{\"type\":\"assistant\",\"text\":\"ok\"}"), .assistant(text: "ok"))
        XCTAssertEqual(ChatEventParser.parse("{\"type\":\"error\",\"reason\":\"no_model\",\"message\":\"none\"}"), .error(reason: "no_model", message: "none"))
        XCTAssertNil(ChatEventParser.parse("{\"type\":\"mystery\"}"))
        XCTAssertNil(ChatEventParser.parse("not json"))
    }
}
