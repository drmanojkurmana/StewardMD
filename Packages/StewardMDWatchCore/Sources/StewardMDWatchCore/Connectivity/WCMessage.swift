import Foundation

/// Message kinds exchanged over WatchConnectivity between the iPhone bridge and
/// the watch. `payload` carries the JSON-encoded body for that kind.
public enum WCMessageKind: String, Codable, Sendable {
    case session        // {uid, idToken, expiresAt}
    case recents        // [CaseSummary]-like recent activity
    case favorites      // [Favorite]
    case ghisToken      // relayed GHIS session token (opaque)
    case relayState     // census / ICU snapshot the watch can't fetch itself
    case tokenRequest   // watch → phone: please mint a fresh ID token
}

/// A single WatchConnectivity message envelope (Codable so it round-trips
/// through `sendMessage`/`updateApplicationContext` dictionaries).
public struct WCMessage: Codable, Sendable {
    public let kind: WCMessageKind
    public let payload: Data?
    public let ts: Double

    public init(kind: WCMessageKind, payload: Data?, ts: Double) {
        self.kind = kind
        self.payload = payload
        self.ts = ts
    }
}
