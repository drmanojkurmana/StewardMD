import Foundation
import Combine

/// Holds the calculators favorited on the phone + relayed to the watch, and runs
/// their compute via `CalcJSEngine`. The UI renders inputs generically from each
/// `RelayedCalc.inputs` and calls `run` on every change for a live result.
@MainActor
public final class CalcsModel: ObservableObject {
    @Published public private(set) var calcs: [RelayedCalc] = []
    private let engine = CalcJSEngine()

    public init() {}

    public func set(_ incoming: [RelayedCalc]) { calcs = incoming }

    public func calc(_ id: String) -> RelayedCalc? { calcs.first { $0.id == id } }

    /// Evaluate a calculator with the current field values (id → Double/String/Bool).
    public func run(_ calc: RelayedCalc, values: [String: Any]) -> CalcOutput {
        engine.run(calc.computeSrc, values: values)
    }
}
