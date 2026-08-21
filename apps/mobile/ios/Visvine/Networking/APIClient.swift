import Foundation

/// Result envelope mirroring the API's `{ data?, error? }` shape and the Android
/// `ApiResult`. Network and HTTP failures become `.failure(message)`.
enum APIResult<T> {
    case success(T)
    case failure(String)

    var value: T? { if case let .success(v) = self { return v } else { return nil } }
    var errorMessage: String? { if case let .failure(m) = self { return m } else { return nil } }
}

private struct ErrorBody: Decodable { let error: String? }

/// URLSession-based client. The `Authorization: Bearer` header is attached when a
/// token is present (read from the Keychain), mirroring `ApiService.setAuthToken`.
final class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let tokenStore: KeychainTokenStore
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared, tokenStore: KeychainTokenStore = .shared) {
        self.session = session
        self.tokenStore = tokenStore
    }

    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        query: [String: String?] = [:],
        body: Data? = nil
    ) async -> APIResult<T> {
        guard let url = makeURL(path: path, query: query) else {
            return .failure("Invalid URL")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = tokenStore.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body

        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else { return .failure("Network error") }
            guard (200..<300).contains(http.statusCode) else {
                let message = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? "Request failed"
                return .failure(message)
            }
            if T.self == EmptyResponse.self {
                return .success(EmptyResponse() as! T)
            }
            let value = try decoder.decode(T.self, from: data)
            return .success(value)
        } catch is DecodingError {
            return .failure("Unexpected response")
        } catch {
            return .failure(error.localizedDescription)
        }
    }

    private func makeURL(path: String, query: [String: String?]) -> URL? {
        var components = URLComponents(string: AppConfig.apiBase + path)
        let items = query.compactMap { key, value -> URLQueryItem? in
            guard let value else { return nil }
            return URLQueryItem(name: key, value: value)
        }
        if !items.isEmpty { components?.queryItems = items }
        return components?.url
    }
}

/// Placeholder for endpoints with no meaningful body (e.g. sign-out).
struct EmptyResponse: Decodable {}
