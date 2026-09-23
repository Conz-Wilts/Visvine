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
        .background(c.surface)
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
                VStack(spacing: VVSpace.x4) {
                    field("Name", text: $model.form.name, placeholder: "Your full name")
                    field("Title", text: $model.form.title, placeholder: "Your job title")
                    field("Company", text: $model.form.company, placeholder: "Your company")
                    field("Location", text: $model.form.location, placeholder: "City, Country")
                }
                .padding(.vertical, VVSpace.x1)

                sectionLabel("Contact Information")
                VStack(alignment: .leading, spacing: VVSpace.x1) {
                    Text("Email").font(.system(size: VVFontSize.s14, weight: .medium)).foregroundStyle(c.fgSecondary)
                    TextField("", text: .constant(model.form.email)).disabled(true).foregroundStyle(c.fgSubtle)
                        .padding(.horizontal, VVSpace.x3_5).padding(.vertical, VVSpace.x3)
                        .background(c.surfaceSubtle, in: RoundedRectangle(cornerRadius: VVRadius.lg))
                    Text("Email cannot be changed").font(.system(size: VVFontSize.s12)).foregroundStyle(c.fgSubtle)
                }
                .padding(.vertical, VVSpace.x1)
            }
            .padding(VVSpace.x4)
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(theme.colors.lineSubtle).frame(height: 1)
            Text(text.uppercased())
                .font(.system(size: VVFontSize.s11, weight: .semibold)).kerning(0.9)
                .foregroundStyle(theme.colors.fgMuted)
                .padding(.top, VVSpace.x5).padding(.bottom, VVSpace.x2_5)
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        let c = theme.colors
        return VStack(alignment: .leading, spacing: VVSpace.x1_5) {
            Text(label).font(.system(size: VVFontSize.s14, weight: .medium)).foregroundStyle(c.fgSecondary)
            TextField(placeholder, text: text)
                .onChange(of: text.wrappedValue) { model.hasChanges = true }
                .padding(.horizontal, VVSpace.x3_5).padding(.vertical, VVSpace.x3)
                .foregroundStyle(c.fg)
                .overlay(RoundedRectangle(cornerRadius: VVRadius.lg).stroke(c.line, lineWidth: 1))
        }
    }
}
