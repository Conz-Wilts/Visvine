import XCTest
@testable import Visvine

/// How a note's markdown is taken apart for the Context view.
final class NoteDocumentTests: XCTestCase {

    func testFrontmatterScalarsAndLists() {
        let doc = NoteDocument("""
        ---
        type: Person
        title: "Ana Lee"
        tags: [founder, nz]
        aliases:
          - Ana
        extra:
          nested: 1
        ---
        # Ana Lee

        Hello.
        """)
        XCTAssertEqual(doc.type, "Person")
        XCTAssertEqual(doc.title, "Ana Lee")
        XCTAssertEqual(doc.tags, ["founder", "nz"])
        XCTAssertEqual(doc.frontmatter["aliases"], .list(["Ana"]))
        XCTAssertNil(doc.frontmatter["extra"])
        XCTAssertEqual(doc.blocks, [.paragraph("Hello.")])
    }

    func testChildListIsSplitIntoSections() {
        let doc = NoteDocument("""
        Intro.

        <!-- index:children -->
        ## Subdirectories
        * [Craig](craig/index.md) - Engineer
        ## Notes
        * [Plan](plan.md)
        """)
        XCTAssertEqual(doc.blocks, [.paragraph("Intro.")])
        XCTAssertEqual(doc.children.map(\.title), ["Subdirectories", "Notes"])
        XCTAssertEqual(doc.children[0].rows, [.init(title: "Craig", href: "craig/index.md", description: "Engineer")])
        XCTAssertNil(doc.children[1].rows[0].description)
    }

    func testBlocks() {
        let blocks = NoteDocument.parseBlocks("""
        ## Heading
        - one
          - two
        - [x] done
        1. first

        ```swift
        # not a heading
        ```

        | a | b |
        |---|---|
        | 1 | 2 |

        > quoted

        ---
        """)
        XCTAssertEqual(blocks, [
            .heading(2, "Heading"),
            .list([
                .init(depth: 0, marker: .bullet, text: "one"),
                .init(depth: 1, marker: .bullet, text: "two"),
                .init(depth: 0, marker: .task(done: true), text: "done"),
                .init(depth: 0, marker: .number(1), text: "first"),
            ]),
            .code("swift", "# not a heading"),
            .table(header: ["a", "b"], rows: [["1", "2"]]),
            .quote([.paragraph("quoted")]),
            .rule,
        ])
    }

    func testResolveLinks() {
        XCTAssertEqual(NoteDocument.resolve("../craig/index.md", from: "people/ana/index.md"), "people/craig/index.md")
        XCTAssertEqual(NoteDocument.resolve("/runbooks/deploys.md", from: "a/b.md"), "runbooks/deploys.md")
        XCTAssertEqual(NoteDocument.resolve("plan.md#top", from: "x/index.md"), "x/plan.md")
        XCTAssertNil(NoteDocument.resolve("https://example.com/a.md", from: "x.md"))
        XCTAssertNil(NoteDocument.resolve("../image.png", from: "x/y.md"))
    }
}
