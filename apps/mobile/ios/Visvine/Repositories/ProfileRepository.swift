import Foundation

struct ProfileRepository {
    private let api = APIClient.shared

    func getProfile(personId: String) async -> APIResult<DirectoryMember> {
        let res: APIResult<DirectoryMember> = await api.request("/api/profile/\(encoded(personId))")
        return resolveMember(res)
    }

    func getFullProfile(personId: String) async -> APIResult<FullProfile> {
        let res: APIResult<FullProfile> = await api.request("/api/profile/\(encoded(personId))")
        switch res {
        case .success(var profile):
            profile.imageUrl = MediaURL.resolve(profile.imageUrl)
            return .success(profile)
        case .failure(let m):
            return .failure(m)
        }
    }

    func updateProfile(userId: String, update: ProfileUpdate) async -> APIResult<DirectoryMember> {
        let body = try? JSONEncoder().encode(update)
        let res: APIResult<DirectoryMember> = await api.request(
            "/api/profile/\(encoded(userId))", method: "PATCH", body: body
        )
        return resolveMember(res)
    }

    private func resolveMember(_ res: APIResult<DirectoryMember>) -> APIResult<DirectoryMember> {
        switch res {
        case .success(var member):
            member.imageUrl = MediaURL.resolve(member.imageUrl)
            return .success(member)
        case .failure(let m):
            return .failure(m)
        }
    }

    private func encoded(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }
}
