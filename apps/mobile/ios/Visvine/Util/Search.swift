import Foundation

/// Name-only relevance score — identical to the web `useDashboardSearch` heuristic
/// reused across Directory / Events / Conversations. 0 means "no match".
func searchScore(_ needle: String, _ name: String) -> Int {
    let n = name.lowercased()
    if n == needle { return 10000 }
    guard let range = n.range(of: needle) else { return 0 }
    let idx = n.distance(from: n.startIndex, to: range.lowerBound)
    if idx == 0 { return 5000 - needle.count }
    return 1000 - idx * 10
}

/// Filters + relevance-sorts by `name(item)` when `query` is non-blank.
func rankByQuery<T>(_ items: [T], query: String, name: (T) -> String) -> [T] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    if needle.isEmpty { return items }
    return items
        .map { ($0, searchScore(needle, name($0))) }
        .filter { $0.1 > 0 }
        .sorted { $0.1 > $1.1 }
        .map { $0.0 }
}
