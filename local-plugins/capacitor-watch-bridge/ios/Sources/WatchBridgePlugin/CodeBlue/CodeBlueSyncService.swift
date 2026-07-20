import Foundation
import StewardMDWatchCore
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/// Transport-agnostic ingest boundary (design §5). Current impl = WatchConnectivity;
/// future impls (BLE defib, multipeer multi-watch, FHIR) conform without UI changes.
protocol CodeBlueSyncService: AnyObject {
    var onState: ((CodeBlueState) -> Void)? { get set }
    func start()
}

/// Merge two event lists by id (dedupe), preserving elapsed order. Pure + testable.
func mergeEvents(_ a: [CodeEvent], _ b: [CodeEvent]) -> [CodeEvent] {
    var byId: [String: CodeEvent] = [:]
    for e in a + b { byId[e.id] = e }
    return byId.values.sorted { $0.elapsed < $1.elapsed }
}

/// Local-only persistence of the latest Code Blue state (design §10 privacy). JSON in
/// Application Support (complete file protection). Never uploaded.
final class CodeBlueLocalStore {
    private let url: URL
    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("codeblue-state.json")
    }
    func save(_ state: CodeBlueState) {
        if let d = try? JSONEncoder().encode(state) { try? d.write(to: url, options: .completeFileProtection) }
    }
    func load() -> CodeBlueState? {
        (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(CodeBlueState.self, from: $0) }
    }
    func clear() { try? FileManager.default.removeItem(at: url) }
}

/// WatchConnectivity-backed sync: decodes `state` payloads posted by the relay
/// (Task 10) and forwards decoded `CodeBlueState` on the main queue.
final class WatchConnectivityCodeBlueSync: CodeBlueSyncService {
    var onState: ((CodeBlueState) -> Void)?
    func start() {
        NotificationCenter.default.addObserver(forName: WatchConnectivityRelay.codeBlueReceived,
                                               object: nil, queue: .main) { [weak self] note in
            guard let data = note.userInfo?["state"] as? Data,
                  let state = try? JSONDecoder().decode(CodeBlueState.self, from: data) else { return }
            self?.onState?(state)
        }
    }
}
