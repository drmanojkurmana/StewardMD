import Foundation

/// A resolution-independent RGBA color stored as data (0...1 components) so it
/// is testable without any UI framework. A SwiftUI `Color` convenience is
/// exposed behind `canImport(SwiftUI)` for the watch/widget targets.
public struct SMDColor: Equatable, Sendable {
    public let r, g, b, a: Double

    public init(r: Double, g: Double, b: Double, a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    /// Parses `#RRGGBB` (leading `#` optional). Invalid input → opaque black,
    /// so a typo can never crash a medical UI — it degrades to a safe default.
    public init(hex: String, alpha: Double = 1) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else {
            self.init(r: 0, g: 0, b: 0, a: alpha); return
        }
        self.init(r: Double((v >> 16) & 0xFF) / 255.0,
                  g: Double((v >> 8) & 0xFF) / 255.0,
                  b: Double(v & 0xFF) / 255.0,
                  a: alpha)
    }
}

/// The authoritative OLED-tuned watch palette (design brief §11). Brand hues
/// brightened to clear 4.5:1 on true black. Color is never the sole signal.
public enum SMDPalette {
    public static let canvas   = SMDColor(hex: "#000000")
    public static let surface  = SMDColor(hex: "#12141C")
    public static let accent   = SMDColor(hex: "#FF5900")   // StewardMD orange / Action button
    public static let critical = SMDColor(hex: "#FF453A")
    public static let warning  = SMDColor(hex: "#FFC53D")
    public static let success  = SMDColor(hex: "#30D158")
    public static let info     = SMDColor(hex: "#34C6F4")
    public static let teal     = SMDColor(hex: "#25CCBC")
    public static let ai       = SMDColor(hex: "#BF5AF2")   // Antibiotic Engine / AI
    public static let navy     = SMDColor(hex: "#0A1B52")
    public static let text1    = SMDColor(hex: "#FFFFFF")
    public static let text2    = SMDColor(hex: "#EBEBF5", alpha: 0.6)
    public static let patient  = SMDColor(hex: "#8FB0FF")
}

#if canImport(SwiftUI)
import SwiftUI
public extension SMDColor {
    /// SwiftUI color in the sRGB space.
    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
}
#endif
