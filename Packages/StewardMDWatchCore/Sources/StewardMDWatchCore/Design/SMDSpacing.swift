import Foundation

/// 4-pt spacing grid, corner radii, and the minimum tap target (design §11).
public enum SMDSpacing {
    public static let xs = 4.0
    public static let s = 8.0
    public static let m = 12.0
    public static let l = 16.0
    public static let xl = 24.0

    public static let screenMargin = 10.0    // 8–12 range
    public static let cardPadding = 12.0      // 10–14 range

    public static let radiusChip = 8.0
    public static let radiusCard = 14.0
    public static let radiusButton = 20.0

    /// Apple HIG minimum interactive target.
    public static let minTapTarget = 44.0
}
