import SwiftUI
import Observation

@Observable
@MainActor
final class DevLoginModel {
    var loading = true
    var users: [DevUser] = []
    var signingInId: String?
    var error: String?

    private let repo = AuthRepository()

    func load() async {
        switch await repo.listDevUsers() {
        case .success(let users): self.users = users; loading = false
        case .failure(let message): error = message; loading = false
        }
    }

    func signIn(_ user: DevUser, auth: AuthManager) async {
        signingInId = user.id
        switch await repo.issueDevToken(userId: user.id) {
        case .success(let response):
            let u = response.user
            auth.setUser(User(id: u.id, name: u.name, email: u.email, image: u.image), token: response.token)
        case .failure(let message):
            error = message; signingInId = nil
        }
    }
}

/// The dev-only sign-in: pick an anchor user instead of going through Google.
struct DevLoginView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @State private var model = DevLoginModel()

    var body: some View {
        let c = theme.colors
        VStack(alignment: .leading, spacing: 0) {
            Text("Pick a seeded user. Available because devAuthEnabled is on and the backend has ENABLE_DEV_AUTH=true.")
                .font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted)
                .padding(.horizontal, VVSpace.x4).padding(.bottom, VVSpace.x2)

            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.users.isEmpty {
                Text(model.error ?? "No anchor users found. Run `pnpm db:seed` against your local DB.")
                    .font(.system(size: VVFontSize.s14)).foregroundStyle(c.fgMuted).padding(VVSpace.x4)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(model.users.enumerated()), id: \.element.id) { index, user in
                            if index > 0 { Rectangle().fill(c.lineSubtle).frame(height: 1) }
                            Button {
                                Task { await model.signIn(user, auth: auth) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: VVSpace.x0_5) {
                                        Text(user.name).font(.system(size: VVFontSize.s15, weight: .semibold)).foregroundStyle(c.fg)
                                        Text(user.email).font(.system(size: VVFontSize.s13)).foregroundStyle(c.fgMuted)
                                    }
                                    Spacer()
                                    if model.signingInId == user.id {
                                        ProgressView().tint(c.accent)
                                    } else {
                                        VisvineIcon(.chevronRight).foregroundStyle(c.fgMuted)
                                    }
                                }
                                .padding(.horizontal, VVSpace.x4).padding(.vertical, VVSpace.x3_5)
                                .contentShape(Rectangle())
                                .opacity(model.signingInId == user.id ? 0.5 : 1)
                            }
                            .disabled(model.signingInId != nil)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(c.surface)
        .navigationTitle("Dev login")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
    }
}
