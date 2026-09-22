import SwiftUI
import Observation

private func typeColor(_ type: String) -> Color {
    switch type.lowercased() {
    case "person": return Color(hex: 0x2563EB)
    case "space": return Color(hex: 0x78D870)
    case "resource": return Color(hex: 0xF59E0B)
    case "event": return Color(hex: 0x9333EA)
    default: return Color(hex: 0x6B7280)
    }
}

private func capitalizeFirst(_ s: String) -> String {
    guard let first = s.first else { return s }
    return first.uppercased() + s.dropFirst()
}

@Observable
@MainActor
final class DirectoryModel {
    var members: [DirectoryMember] = []
    var loading = true
    var refreshing = false
    var error: String?
    var selectedTypes: Set<String> = []
    var selectedTags: Set<String> = []
    var sortAscending = true

    private let repo = DirectoryRepository()

    var presentTypes: [String] { Set(members.map { $0.type }).sorted() }
    var presentTags: [String] { Set(members.flatMap { $0.tags ?? [] }).sorted() }
    var hasFilters: Bool { !selectedTypes.isEmpty || !selectedTags.isEmpty || !sortAscending }

    func load(spaceId: String?) async {
        guard let spaceId else { members = []; loading = false; return }
        loading = true
        await fetch(spaceId)
        loading = false
    }

    func refresh(spaceId: String?) async {
        guard let spaceId else { return }
        await fetch(spaceId)
    }

    private func fetch(_ spaceId: String) async {
        switch await repo.getMembers(spaceId: spaceId) {
        case .success(let list): members = list; error = nil
        case .failure(let message): error = message
        }
    }

    /// Replicates DirectoryScreen.filteredMembers exactly.
    func filtered(query: String) -> [DirectoryMember] {
        var result = selectedTypes.isEmpty
            ? members.filter { $0.type.lowercased() == "person" }
            : members.filter { selectedTypes.contains($0.type) }
        if !selectedTags.isEmpty {
            result = result.filter { ($0.tags ?? []).contains { selectedTags.contains($0) } }
        }
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !needle.isEmpty {
            return result.map { ($0, searchScore(needle, $0.name)) }
                .filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.map { $0.0 }
        }
        return result.sorted { sortAscending ? $0.name < $1.name : $0.name > $1.name }
    }

    func toggleType(_ value: String) {
        if selectedTypes.contains(value) { selectedTypes.remove(value) } else { selectedTypes.insert(value) }
    }
    func toggleTag(_ value: String) {
        if selectedTags.contains(value) { selectedTags.remove(value) } else { selectedTags.insert(value) }
    }
    func clearAll() { selectedTypes = []; selectedTags = []; sortAscending = true }
}

private enum DirectorySheet: Identifiable { case type, tag; var id: Int { hashValue } }

/// Everyone and everything in the space, as a grid of cards.
struct DirectoryView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(SearchStore.self) private var search
    @State private var model = DirectoryModel()
    @State private var sheet: DirectorySheet?

    var onProfile: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(title: "People", showSpaceSelector: false, onProfile: onProfile)
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    if let error = model.error {
                        Text(error).foregroundStyle(c.error).font(.system(size: 14))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                    }
                    filters
                    let items = model.filtered(query: search.query)
                    if items.isEmpty {
                        emptyState
                    } else {
                        LazyVGrid(columns: columns, spacing: 16) {
                            ForEach(items) { member in card(member) }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 120)
                    }
                }
                .refreshable { await model.refresh(spaceId: space.current?.id) }
            }
        }
        .background(c.bgPrimary)
        .task(id: space.current?.id) { await model.load(spaceId: space.current?.id) }
        .onAppear { search.placeholder = "Search directory" }
        .sheet(item: $sheet) { which in filterSheet(which).environment(theme) }
    }

    // MARK: Filters
    private var filters: some View {
        let c = theme.colors
        return HStack(spacing: 8) {
            pill(label: "Type", count: model.selectedTypes.count) { sheet = .type }
            pill(label: "Tag", count: model.selectedTags.count) { sheet = .tag }
            Button { model.sortAscending.toggle() } label: {
                HStack(spacing: 6) {
                    VisvineIcon(model.sortAscending ? .arrowDown : .arrowUp, size: 12)
                    Text(model.sortAscending ? "A–Z" : "Z–A").font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(c.textSecondary).padding(.horizontal, 10).padding(.vertical, 8)
            }
            if model.hasFilters {
                Button { model.clearAll() } label: {
                    HStack(spacing: 4) {
                        VisvineIcon(.xmark, size: 12)
                        Text("Clear").font(.system(size: 12, weight: .semibold))
                    }.foregroundStyle(c.textMuted)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    /// A filter trigger, drawn the way DirectoryToolbar draws one: no border,
    /// nothing filled — an applied filter simply speaks in the accent's dark
    /// shade.
    private func pill(label: String, count: Int, action: @escaping () -> Void) -> some View {
        let c = theme.colors
        let active = count > 0
        return Button(action: action) {
            HStack(spacing: 6) {
                Text(label + (active ? " · \(count)" : "")).font(.system(size: 13, weight: .semibold))
                VisvineIcon(.chevronDown, size: 12)
            }
            .foregroundStyle(active ? c.accentDark : c.textSecondary)
            .padding(.horizontal, 10).padding(.vertical, 8)
        }
    }

    @ViewBuilder private func filterSheet(_ which: DirectorySheet) -> some View {
        let c = theme.colors
        let isType = which == .type
        let values = isType ? model.presentTypes : model.presentTags
        NavigationStack {
            List {
                if values.isEmpty {
                    Text("None available").foregroundStyle(c.textMuted)
                }
                ForEach(values, id: \.self) { value in
                    let active = isType ? model.selectedTypes.contains(value) : model.selectedTags.contains(value)
                    Button {
                        if isType { model.toggleType(value) } else { model.toggleTag(value) }
                    } label: {
                        HStack {
                            Text(isType ? capitalizeFirst(value) : value).foregroundStyle(c.textPrimary)
                            Spacer()
                            VisvineIcon(active ? .checkSquare : .square)
                                .foregroundStyle(active ? c.accent : c.textMuted)
                        }
                    }
                }
            }
            .navigationTitle(isType ? "Filter by Type" : "Filter by Tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Card
    @ViewBuilder private func card(_ member: DirectoryMember) -> some View {
        let isPerson = member.type.lowercased() == "person"
        if isPerson {
            NavigationLink(value: AppRoute.fullProfile(personId: member.id, name: member.name)) {
                cardBody(member)
            }
            .buttonStyle(.plain)
        } else {
            cardBody(member)
        }
    }

    // The card carries the same four rules NodeCard.tsx holds on the web:
    // 1:1 identity media, hierarchy by size AND weight AND colour, a tagline
    // that is never the name's weight, and a type chip that is the smallest
    // mark on the card. Two lines of tagline are always reserved so the chips
    // land on one baseline across a row.
    private func cardBody(_ member: DirectoryMember) -> some View {
        let c = theme.colors
        let color = typeColor(member.type)
        let subtitle = member.subtitle ?? member.title
        return VStack(spacing: 0) {
            ZStack {
                if let imageUrl = member.imageUrl, let url = URL(string: imageUrl) {
                    AsyncImage(url: url) { phase in
                        if let img = phase.image { img.resizable().scaledToFill() } else { color }
                    }
                } else {
                    color
                    Text(avatarInitials(member.name)).foregroundStyle(.white).font(.system(size: 24, weight: .bold))
                }
            }
            .aspectRatio(1, contentMode: .fill)
            .frame(maxWidth: .infinity)
            .clipped()

            VStack(spacing: 0) {
                Text(member.name)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(c.textPrimary)
                    .lineLimit(1)
                Text((subtitle?.isEmpty == false ? subtitle : nil) ?? " ")
                    .font(.system(size: 13)).foregroundStyle(c.textSecondary)
                    .lineLimit(2).multilineTextAlignment(.center)
                    .frame(height: 35, alignment: .top)
                    .padding(.top, 6)
                Text(capitalizeFirst(member.type))
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(color, in: RoundedRectangle(cornerRadius: 6))
                    .padding(.top, 14)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 16)
        }
        .background(c.bgPrimary)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(color, lineWidth: 4))
    }

    private var emptyState: some View {
        EmptyStateView(
            text: model.hasFilters ? "No members match filters" : "No members found",
            icon: .people,
            actionLabel: model.hasFilters ? "Clear filters" : nil,
            action: model.hasFilters ? { model.clearAll() } : nil
        )
    }
}
