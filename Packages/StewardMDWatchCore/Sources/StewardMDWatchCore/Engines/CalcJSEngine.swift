import Foundation
#if canImport(JavaScriptCore)
import JavaScriptCore

/// Runs a relayed calculator's `compute(v)` on the watch via JavaScriptCore, so
/// any of the phone's validated calculators works without a Swift reimplementation.
/// The small helper set (`ok/ln/r1/r0/band/ERR`) mirrors calculators.js and is
/// preloaded once; each compute is the function source relayed from the phone.
///
/// Safe: the JS comes from our own bundled `calculators.js` over the trusted WC
/// channel, and a `JSContext` has no DOM / network / file access.
@MainActor
public final class CalcJSEngine {
    private let ctx: JSContext

    /// Helpers usable inside compute(), byte-for-byte from calculators.js.
    private static let helpers = """
    function ok(x){return typeof x==='number'&&!isNaN(x)&&isFinite(x);}
    function ln(x){return Math.log(x);}
    function r1(x){return Math.round(x*10)/10;}
    function r0(x){return Math.round(x);}
    function band(score,bands){for(var i=0;i<bands.length;i++)if(score<=bands[i][0])return bands[i][1];return bands[bands.length-1][1];}
    var ERR={err:'Enter all required values.'};
    """

    public init() {
        ctx = JSContext()
        ctx.evaluateScript(Self.helpers)
    }

    /// Evaluate one calculator. `values` keys are field ids; values are `Double`
    /// (number), `String` (select option value) or `Bool` (check).
    public func run(_ computeSrc: String, values: [String: Any]) -> CalcOutput {
        ctx.setObject(values as NSDictionary, forKeyedSubscript: "__v" as NSString)
        ctx.exception = nil
        guard let r = ctx.evaluateScript("(\(computeSrc))(__v)"), ctx.exception == nil, !r.isUndefined, !r.isNull else {
            return CalcOutput(value: "—", unit: "", interp: "", error: "Couldn't compute on the watch.")
        }
        if let err = r.objectForKeyedSubscript("err"), !err.isUndefined, !err.isNull {
            return CalcOutput(value: "—", unit: "", interp: "", error: err.toString())
        }
        let v = string(r, "v") ?? "—"
        let u = string(r, "u") ?? ""
        let i = Self.stripHTML(string(r, "i") ?? "")
        return CalcOutput(value: v, unit: u, interp: i, error: nil)
    }

    private func string(_ obj: JSValue, _ key: String) -> String? {
        guard let val = obj.objectForKeyedSubscript(key), !val.isUndefined, !val.isNull else { return nil }
        return val.toString()
    }

    /// Interpretations carry light HTML (`<b>`, `<br>`); the watch renders plain text.
    static func stripHTML(_ s: String) -> String {
        var out = ""
        var inTag = false
        for ch in s {
            if ch == "<" { inTag = true } else if ch == ">" { inTag = false } else if !inTag { out.append(ch) }
        }
        return out.replacingOccurrences(of: "&lt;", with: "<")
                  .replacingOccurrences(of: "&gt;", with: ">")
                  .replacingOccurrences(of: "&amp;", with: "&")
                  .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

#endif
