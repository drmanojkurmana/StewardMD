import Foundation

/// Antibiotic Engine output, summarized for the wrist (design §05). The full
/// input form stays on the phone; the watch shows the answer + dose + safety.
public struct AntibioticRec: Codable, Sendable, Equatable {
    public let context: String?        // "CAP · moderate · eGFR 40"
    public let primary: String         // "Co-amoxiclav 1.2 g IV TDS"
    public let alternative: String?    // "Clarithromycin 500 mg BD"
    public let allergyNote: String?    // "No allergy conflict"
    public let allergyConflict: Bool?

    public init(context: String?, primary: String, alternative: String?,
                allergyNote: String?, allergyConflict: Bool?) {
        self.context = context; self.primary = primary; self.alternative = alternative
        self.allergyNote = allergyNote; self.allergyConflict = allergyConflict
    }
}
