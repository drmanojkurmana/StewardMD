import Foundation

/// `GET /api/billing/status` — entitlement state. Note: a launch promo treats
/// everyone as Pro until 2026-09-15, so `pro` may be true via `promo`. The watch
/// still designs for the gate (Lab Watch / Ward Sync return 402 after the promo).
public struct BillingStatus: Codable, Sendable, Equatable {
    public let signedIn: Bool
    public let pro: Bool
    public let source: String?
    public let promo: Bool?
    public let until: Double?

    public init(signedIn: Bool, pro: Bool, source: String? = nil, promo: Bool? = nil, until: Double? = nil) {
        self.signedIn = signedIn; self.pro = pro; self.source = source; self.promo = promo; self.until = until
    }
}
