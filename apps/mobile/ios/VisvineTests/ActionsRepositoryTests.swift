import XCTest
@testable import Visvine

/// The note path and title a quick capture mints.
final class ActionsRepositoryTests: XCTestCase {

    func testSlugIsFileSafeAndCapped() {
        XCTAssertEqual(ActionsRepository.slug("Met Sam — she's moving to Melbourne!"), "met-sam-she-s-moving-to-melbourne")
        XCTAssertEqual(ActionsRepository.slug("   "), "note")
        XCTAssertEqual(ActionsRepository.slug("???"), "note")
        XCTAssertLessThanOrEqual(ActionsRepository.slug(String(repeating: "word ", count: 30)).count, 40)
    }

    func testStampIsDateAndTime() {
        var comps = DateComponents()
        comps.year = 2026; comps.month = 9; comps.day = 22; comps.hour = 14; comps.minute = 32
        let date = Calendar.current.date(from: comps)!
        XCTAssertEqual(ActionsRepository.stamp(date), "2026-09-22-1432")
    }

    func testYamlQuotesTheTitle() {
        XCTAssertEqual(ActionsRepository.yaml("Plan: \"phase two\""), "\"Plan: \\\"phase two\\\"\"")
    }
}
