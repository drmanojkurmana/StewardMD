import Foundation

/// A single HTTP request description. `requiresAuth` controls whether the
/// client attaches the `Authorization: Bearer` header.
public struct Endpoint: Sendable {
    public let method: String
    public let url: URL
    public var body: Data?
    public var requiresAuth: Bool

    public init(method: String = "GET", url: URL, body: Data? = nil, requiresAuth: Bool = false) {
        self.method = method
        self.url = url
        self.body = body
        self.requiresAuth = requiresAuth
    }
}
