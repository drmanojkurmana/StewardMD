import Foundation

/// Normalized API failure the UI can switch on (design §13 error states).
public enum APIError: Error, Equatable, Sendable {
    case http(Int)      // non-2xx (other than 401)
    case decoding       // body didn't match the expected shape
    case transport      // network/URLSession failure
    case unauthorized   // 401 → token stale; ask phone for a fresh one
}
