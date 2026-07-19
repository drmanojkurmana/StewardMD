import Foundation
import Combine

/// Drives the Drug lookup screen (design §05): voice/text query → dose facts.
/// Uses the public Worker (no auth). States map directly to the §13 component
/// matrix (idle / loading / results / empty / error → "Retry").
@MainActor
public final class DrugLookupModel: ObservableObject {
    public enum State: Equatable {
        case idle
        case loading
        case results([DrugSearchResult])
        case empty
        case error
    }

    @Published public private(set) var state: State = .idle
    @Published public var query: String = ""

    private let api: DrugAPI

    public init(api: DrugAPI) { self.api = api }

    public func search(_ q: String) async {
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { state = .idle; return }
        state = .loading
        do {
            let resp = try await api.search(trimmed, limit: 12)
            state = resp.results.isEmpty ? .empty : .results(resp.results)
        } catch {
            state = .error
        }
    }
}
