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

/// Port of screens/Auth/DevLoginScreen.tsx.
struct DevLoginView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @State private var model = DevLoginModel()

    var body: some View {
        let c = theme.colors
        VStack(alignment: .leading, spacing: 0) {
            Text("Pick a seeded user. Available because devAuthEnabled is on and the backend has ENABLE_DEV_AUTH=true.")
                .font(.system(size: 13)).foregroundStyle(c.textMuted)
                .padding(.horizontal, 16).padding(.bottom, 8)

            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.users.isEmpty {
                Text(model.error ?? "No anchor users found. Run `pnpm db:seed` against your local DB.")
                    .font(.system(size: 14)).foregroundStyle(c.textMuted).padding(16)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(model.users) { user in
                            Button {
                                Task { await model.signIn(user, auth: auth) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(user.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(c.textPrimary)
                                        Text(user.email).font(.system(size: 13)).foregroundStyle(c.textMuted)
                                    }
                                    Spacer()
                                    if model.signingInId == user.id {
                                        ProgressView().tint(c.accent)
                                    } else {
                                        VisvineIcon(.chevronRight).foregroundStyle(c.textMuted)
                                    }
                                }
                                .padding(14)
                                .background(c.bgPrimary, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(c.borderLight, lineWidth: 1))
                                .opacity(model.signingInId == user.id ? 0.5 : 1)
                            }
                            .disabled(model.signingInId != nil)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(c.bgSecondary)
        .navigationTitle("Dev login")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
    }
}
