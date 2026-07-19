// StewardMDWatchCore — platform-agnostic core for the StewardMD Apple Watch app.
//
// Holds all reusable, testable logic (models, networking, clinical engines,
// design tokens, connectivity contracts). Compiles on macOS so it can be
// `swift build` / `swift test`-verified without a watchOS runtime.

public enum StewardMDWatchCore {
    /// Core package version, independent of the app marketing version.
    public static let version = "1.0.0"
}
