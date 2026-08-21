import SwiftUI
import Observation

@Observable
@MainActor
final class EditProfileModel {
    struct Form { var name = ""; var title = ""; var company = ""; var location = ""; var email = "" }

    var loading = true
    var saving = false
    var hasChanges = false
    var form = Form()
    var error: String?
    var saved = false

    private let repo = ProfileRepository()

    func load(auth: AuthManager) async {
        guard let user = auth.user else { loading = false; return }
        switch await repo.getProfile(personId: user.nodeId ?? user.id) {
        case .success(let m):
            form = Form(name: m.name, title: m.title ?? "", company: m.company ?? "", location: m.location ?? "", email: user.email)
        case .failure: break
        }
        loading = false
    }

    func save(auth: AuthManager) async {
        guard let user = auth.user, hasChanges else { return }
        saving = true
        let update = ProfileUpdate(name: form.name, title: form.title, company: form.company, location: form.location)
        switch await repo.updateProfile(userId: user.id, update: update) {
        case .success: hasChanges = false; saved = true
        case .failure(let m): error = m
        }
        saving = false
    }
}

/// Your own details, as fields on the flat surface — sections opened by a
/// hairline, no card around the group.
struct EditProfileView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var model = EditProfileModel()
    @State private var confirmDiscard = false

    var body: some View {
        let c = theme.colors
        Group {
            if model.loading {
                ProgressView().tint(c.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                form
            }
        }
        .background(c.bgPrimary)
        .navigationTitle("Edit Profile")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { if model.hasChanges { confirmDiscard = true } else { dismiss() } }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") { Task { await model.save(auth: auth) } }
                    .disabled(!model.hasChanges || model.saving)
            }
        }
        .task { await model.load(auth: auth) }
        .onChange(of: model.saved) { _, saved in if saved { dismiss() } }
        .confirmationDialog("Discard Changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { dismiss() }
            Button("Keep Editing", role: .cancel) { }
        } message: { Text("You have unsaved changes. Are you sure you want to discard them?") }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private var form: some View {
        @Bindable var model = model
        let c = theme.colors
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                sectionLabel("Personal Information")
                VStack(spacing: 16) {
                    field("Name", text: $model.form.name, placeholder: "Your full name")
                    field("Title", text: $model.form.title, placeholder: "Your job title")
                    field("Company", text: $model.form.company, placeholder: "Your company")
                    field("Location", text: $model.form.location, placeholder: "City, Country")
                }
                .padding(.vertical, 4)

                sectionLabel("Contact Information")
                VStack(alignment: .leading, spacing: 4) {
                    Text("Email").font(.system(size: 14, weight: .medium)).foregroundStyle(c.textSecondary)
                    TextField("", text: .constant(model.form.email)).disabled(true).foregroundStyle(c.textLight)
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .background(c.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
                    Text("Email cannot be changed").font(.system(size: 12)).foregroundStyle(c.textLight)
                }
                .padding(.vertical, 4)
            }
            .padding(16)
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(theme.colors.borderSubtle).frame(height: 1)
            Text(text.uppercased())
                .font(.system(size: 11, weight: .semibold)).kerning(0.9)
                .foregroundStyle(theme.colors.textMuted)
                .padding(.top, 20).padding(.bottom, 10)
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(c.textSecondary)
            TextField(placeholder, text: text)
                .onChange(of: text.wrappedValue) { model.hasChanges = true }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .foregroundStyle(c.textPrimary)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(c.borderDefault, lineWidth: 1))
        }
    }
}
