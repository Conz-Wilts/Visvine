import SwiftUI

/// Quick capture into the current space, raised by the bar's + from any tab:
/// what kind, the words, a send (docs/mobile.md § Home).
struct CreateSheet: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(SpaceStore.self) private var space
    @Environment(\.dismiss) private var dismiss

    @State private var draft = ""
    @State private var kind: ActionsRepository.CaptureKind = .note
    @State private var capturing = false
    @State private var error: String?
    @FocusState private var composing: Bool

    private let actions = ActionsRepository()

    var body: some View {
        let c = theme.colors
        VStack(alignment: .leading, spacing: 14) {
            if let current = space.current {
                HStack(spacing: 10) {
                    SpaceAvatar(name: current.name, imageUrl: current.image, size: 28)
                    Text(current.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(c.textPrimary)
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(ActionsRepository.CaptureKind.allCases) { k in
                            Chip(label: k.label, on: k == kind) { kind = k }
                        }
                    }
                }
            }
            TextField(placeholder, text: $draft, axis: .vertical)
                .lineLimit(3...8)
                .focused($composing)
                .font(.system(size: 17))
                .foregroundStyle(c.textPrimary)
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(c.error)
            }
            Spacer(minLength: 0)
            Button(action: send) {
                Group {
                    if capturing { ProgressView() } else { Text("Save").font(.system(size: 17, weight: .semibold)) }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
            }
            .buttonStyle(.glassProminent)
            .disabled(!canSend)
        }
        .padding(20)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear { composing = true }
    }

    private var placeholder: String {
        switch kind {
        case .note: return "Capture a note…"
        case .person: return "A person's name, then what you know"
        case .space: return "An organisation's name, then what you know"
        case .resource: return "A resource's name, then a line about it"
        }
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !capturing && space.current != nil
    }

    private func send() {
        guard let spaceId = space.current?.id else { return }
        capturing = true
        Task {
            switch await actions.capture(spaceId: spaceId, kind: kind, text: draft) {
            case .success: dismiss()
            case .failure(let m): error = m
            }
            capturing = false
        }
    }
}

/// A pill in a row of choices: solid when chosen, glass otherwise.
struct Chip: View {
    @Environment(ThemeStore.self) private var theme
    let label: String
    let on: Bool
    var action: () -> Void

    var body: some View {
        let c = theme.colors
        Button(action: action) {
            Text(label)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(on ? c.bgPrimary : c.textPrimary)
                .padding(.horizontal, 18)
                .frame(height: 40)
                .background(on ? c.textPrimary : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(on ? .identity : .regular.interactive(), in: .capsule)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
