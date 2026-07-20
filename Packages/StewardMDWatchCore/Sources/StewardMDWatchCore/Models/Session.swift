import Foundation

/// The authenticated session bridged from the iPhone (App Group / WCSession).
/// The Firebase ID token lives only in the phone's WebView and is minted on
/// demand, so the watch treats it as short-lived and refreshes near expiry.
public struct Session: Codable, Equatable, Sendable {
    public let uid: String?
    public let idToken: String?
    public let expiresAt: Double?     // epoch seconds

    public init(uid: String?, idToken: String?, expiresAt: Double?) {
        self.uid = uid; self.idToken = idToken; self.expiresAt = expiresAt
    }

    /// Token present and more than 60s from expiry (clock injectable for tests).
    public func isValid(now: Date = Date()) -> Bool {
        guard let t = idToken, !t.isEmpty, let e = expiresAt else { return false }
        return e - now.timeIntervalSince1970 > 60
    }

    public var isValid: Bool { isValid() }

    /// A signed-out / empty session.
    public static let none = Session(uid: nil, idToken: nil, expiresAt: nil)
}
