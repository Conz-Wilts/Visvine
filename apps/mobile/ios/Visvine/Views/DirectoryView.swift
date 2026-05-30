import SwiftUI
import Observation

private func typeColor(_ type: String) -> Color {
    switch type.lowercased() {
    case "person": return Color(hex: 0x2563EB)
    case "community": return Color(hex: 0x78D870)
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

    func load(communityId: String?) async {
        guard let communityId else { members = []; loading = false; return }
        loading = true
        await fetch(communityId)
        loading = false
    }

    func refresh(communityId: String?) async {
        guard let communityId else { return }
        await fetch(communityId)
    }

    private func fetch(_ communityId: String) async {
        switch await repo.getMembers(communityId: communityId) {
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

/// Port of screens/Directory/DirectoryScreen.tsx.
struct DirectoryView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(CommunityStore.self) private var community
    @Environment(SearchStore.self) private var search
    @State private var model = DirectoryModel()
    @State private var sheet: DirectorySheet?

    var onProfile: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        let c = theme.colors
        VStack(spacing: 0) {
            ScreenHeader(showCommunitySelector: true, onProfile: onProfile)
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    if let error = model.error {
                        Text(error).foregroundStyle(c.error).font(.system(size: 14))
                            .padding().frame(maxWidth: .infinity, alignment: .leading)
                            .background(c.bgTertiary, in: RoundedRectangle(cornerRadius: 12)).padding(.horizontal, 16)
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
                .refreshable { await model.refresh(communityId: community.current?.id) }
            }
        }
        .background(c.bgSecondary)
        .task(id: community.current?.id) { await model.load(communityId: community.current?.id) }
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
                    Image(systemName: model.sortAscending ? "arrow.down" : "arrow.up").font(.system(size: 12))
                    Text(model.sortAscending ? "A–Z" : "Z–A").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(c.textSecondary).padding(.horizontal, 12).padding(.vertical, 6)
                .background(c.bgPrimary, in: Capsule()).overlay(Capsule().stroke(c.borderDefault, lineWidth: 1))
            }
            if model.hasFilters {
                Button { model.clearAll() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark").font(.system(size: 12))
                        Text("Clear").font(.system(size: 12, weight: .semibold))
                    }.foregroundStyle(c.textMuted)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private func pill(label: String, count: Int, action: @escaping () -> Void) -> some View {
        let c = theme.colors
        let active = count > 0
        return Button(action: action) {
            HStack(spacing: 6) {
                Text(label + (active ? " · \(count)" : "")).font(.system(size: 12, weight: .semibold))
                Image(systemName: "chevron.down").font(.system(size: 12))
            }
            .foregroundStyle(active ? .white : c.textSecondary)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(active ? c.accent : c.bgPrimary, in: Capsule())
            .overlay(Capsule().stroke(active ? c.accent : c.borderDefault, lineWidth: 1))
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
                            Image(systemName: active ? "checkmark.square.fill" : "square")
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
            .frame(maxWidth: .infinity).frame(maxHeight: .infinity).clipped()

            VStack(spacing: 4) {
                Text(member.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(c.textPrimary).lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 12, weight: .semibold)).foregroundStyle(c.textPrimary).lineLimit(2).multilineTextAlignment(.center)
                }
                Spacer(minLength: 0)
                Text(capitalizeFirst(member.type)).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 4).background(color, in: Capsule())
            }
            .padding(12).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(0.722, contentMode: .fit)
        .background(c.bgPrimary)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(color, lineWidth: 4))
    }

    private var emptyState: some View {
        let c = theme.colors
        return VStack(spacing: 12) {
            ZStack {
                Circle().fill(c.bgTertiary).frame(width: 72, height: 72)
                Image(systemName: "person.2").font(.system(size: 32)).foregroundStyle(c.textMuted)
            }
            Text(model.hasFilters ? "No members match filters" : "No members found")
                .font(.system(size: 16, weight: .medium)).foregroundStyle(c.textMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 48)
    }
}
