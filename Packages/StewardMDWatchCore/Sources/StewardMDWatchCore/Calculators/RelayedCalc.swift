import Foundation

/// A `select` option for a relayed calculator input (`{v,t}` in calculators.js).
public struct CalcOption: Codable, Sendable, Equatable, Hashable {
    public let v: String   // stored value (often a scored number-as-string)
    public let t: String   // display text
    public init(v: String, t: String) { self.v = v; self.t = t }
}

/// One input field of a relayed calculator, mirroring calculators.js `inputs[]`.
public struct CalcField: Codable, Sendable, Equatable, Hashable, Identifiable {
    public let id: String
    public let label: String
    public let type: String            // "number" | "select" | "check"
    public let unit: String?
    public let step: Double?
    public let min: Double?
    public let def: Double?
    public let opts: [CalcOption]?

    public init(id: String, label: String, type: String, unit: String? = nil,
                step: Double? = nil, min: Double? = nil, def: Double? = nil,
                opts: [CalcOption]? = nil) {
        self.id = id; self.label = label; self.type = type; self.unit = unit
        self.step = step; self.min = min; self.def = def; self.opts = opts
    }
}

/// A calculator favorited on the phone and relayed to the watch: its declarative
/// inputs plus the source of its pure `compute(v)` function (run via JavaScriptCore
/// on the watch — see `CalcJSEngine`). No formula is reimplemented in Swift.
public struct RelayedCalc: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let category: String?
    public let inputs: [CalcField]
    public let computeSrc: String      // e.g. "function(v){ ... return {v,u,i}; }"

    public init(id: String, title: String, category: String?,
                inputs: [CalcField], computeSrc: String) {
        self.id = id; self.title = title; self.category = category
        self.inputs = inputs; self.computeSrc = computeSrc
    }
}

/// The `{v,u,i}` (or `{err}`) result of running a calculator's compute.
public struct CalcOutput: Sendable, Equatable {
    public let value: String           // headline value (may be numeric or "—")
    public let unit: String            // e.g. "points", "mL/min/1.73m²"
    public let interp: String          // interpretation (HTML tags stripped)
    public let error: String?          // non-nil when inputs are incomplete/invalid

    public init(value: String, unit: String, interp: String, error: String?) {
        self.value = value; self.unit = unit; self.interp = interp; self.error = error
    }
}
