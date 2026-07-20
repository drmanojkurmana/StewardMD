import Foundation

/// Fetches remote feature flags from `GET /api/watch-config`, degrading to a
/// safe local default when offline or the endpoint is unavailable. Public/no-auth.
public struct FeatureFlagClient: Sendable {
    static let url = URL(string: "https://stewardmd.in/api/watch-config")!
    let client: APIClient
    let fallback: FeatureFlags

    public init(client: APIClient, fallback: FeatureFlags = .empty) {
        self.client = client
        self.fallback = fallback
    }

    public func fetch() async -> FeatureFlags {
        (try? await client.send(Endpoint(url: Self.url), as: FeatureFlags.self)) ?? fallback
    }
}
