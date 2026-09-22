import Foundation

/// One row of a space's context tree — GET /api/notes/tree (`TreeNode`).
struct ContextNode: Codable, Hashable, Identifiable {
    var id: String { path }
    let name: String
    let path: String
    let kind: String
    var title: String?
    var children: [ContextNode]?
    /// Set on a row the tree draws but nothing stores (`main`).
    var drawn: String?

    var isFolder: Bool { kind == "folder" }
    var label: String { title ?? name.replacingOccurrences(of: ".md", with: "") }

    /// How many notes sit anywhere beneath — a standing empty folder counts none.
    var noteCount: Int {
        isFolder ? (children ?? []).reduce(0) { $0 + $1.noteCount } : 1
    }
}

struct ContextTreeResponse: Codable { let tree: ContextNode }

struct ContextNoteResponse: Codable {
    let content: String
    let path: String
    /// Frontmatter keys a write cannot change.
    var held: [String]?
}

/// GET /api/notes/references — the notes that link to this one.
struct NoteReferencesResponse: Codable {
    let references: NoteReferences
}

struct NoteReferences: Codable {
    var linked: [NoteReference]
    var unlinked: [NoteReference]
}

struct NoteReference: Codable, Hashable {
    let fromPath: String
    let fromTitle: String
    let excerpt: String
}
