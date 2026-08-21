import XCTest
@testable import Visvine

/// The resolveMediaUrl contract.
final class MediaURLTests: XCTestCase {

    func testReturnsNilForNilAndEmpty() {
        XCTAssertNil(MediaURL.resolve(nil))
        XCTAssertNil(MediaURL.resolve(""))
    }

    func testPassesAbsoluteAndDataURLsThrough() {
        XCTAssertEqual(MediaURL.resolve("https://example.com/a.png"), "https://example.com/a.png")
        XCTAssertEqual(MediaURL.resolve("http://example.com/a.png"), "http://example.com/a.png")
        XCTAssertEqual(MediaURL.resolve("data:image/png;base64,AAA"), "data:image/png;base64,AAA")
    }

    func testPrefixesRelativePaths() {
        XCTAssertEqual(MediaURL.resolve("/media/photo.webp"), AppConfig.apiBase + "/media/photo.webp")
    }

    func testLeavesBareTokensAlone() {
        XCTAssertEqual(MediaURL.resolve("bucket/key.webp"), "bucket/key.webp")
    }
}
