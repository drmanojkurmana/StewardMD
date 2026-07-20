import Foundation

/// Watch type scale (design §11). SF Pro at runtime; numerals always tabular;
/// Dynamic Type up to XXL. Each role carries its pt bounds and whether it uses
/// the rounded design (large vitals/timers/scores).
public enum SMDTextRole: String, CaseIterable, Sendable {
    case numeralXL   // vitals, timers, scores
    case title       // screen headers
    case headline    // list-row primary
    case body        // values / content
    case caption     // meta, bed, timestamp

    public var minPt: Double {
        switch self {
        case .numeralXL: return 34
        case .title: return 20
        case .headline: return 16
        case .body: return 14
        case .caption: return 11
        }
    }

    public var maxPt: Double {
        switch self {
        case .numeralXL: return 52
        case .title: return 22
        case .headline: return 17
        case .body: return 15
        case .caption: return 12
        }
    }

    /// Rounded design is reserved for the big numeric readouts.
    public var rounded: Bool { self == .numeralXL }
}
