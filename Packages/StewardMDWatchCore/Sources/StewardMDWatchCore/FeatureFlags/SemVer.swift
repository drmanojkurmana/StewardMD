import Foundation

/// Minimal semantic-version comparison for the min-supported-version gate.
public enum SemVer {
    /// Returns -1 if a < b, 0 if equal, 1 if a > b. Missing components count as 0.
    public static func compare(_ a: String, _ b: String) -> Int {
        let pa = parts(a), pb = parts(b)
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x < y ? -1 : 1 }
        }
        return 0
    }

    private static func parts(_ v: String) -> [Int] {
        v.split(separator: ".").map { Int($0.filter { $0.isNumber }) ?? 0 }
    }
}
