import Foundation

/// Session snapshot for the resume prompt (spec): saved on every event and at
/// most every 5 s on tick. restore discards snapshots older than 6 h.
public struct CodeSessionSnapshot: Codable, Equatable, Sendable {
    public static let currentVersion = 2
    /// Discard snapshots older than this.
    public static let maxAge: TimeInterval = 6 * 3600

    public var version: Int
    public var mode: CodeMode
    public var startedAtWallClock: Date
    public var elapsedAtSave: TimeInterval
    public var events: [CodeEvent]
    public var adrenalineCount: Int
    public var shockCount: Int
    public var rosc: Bool
    public var checklistTicks: [String]
    public var savedAtWallClock: Date

    public init(version: Int = CodeSessionSnapshot.currentVersion,
                mode: CodeMode,
                startedAtWallClock: Date,
                elapsedAtSave: TimeInterval,
                events: [CodeEvent],
                adrenalineCount: Int,
                shockCount: Int,
                rosc: Bool,
                checklistTicks: [String],
                savedAtWallClock: Date) {
        self.version = version; self.mode = mode
        self.startedAtWallClock = startedAtWallClock
        self.elapsedAtSave = elapsedAtSave; self.events = events
        self.adrenalineCount = adrenalineCount; self.shockCount = shockCount
        self.rosc = rosc; self.checklistTicks = checklistTicks
        self.savedAtWallClock = savedAtWallClock
    }
}

/// Injectable persistence behind the session store. Closure-based so tests can
/// use an in-memory box and the watch app can use UserDefaults.
public struct CodeSessionStorage: Sendable {
    public var save: @Sendable (Data) -> Void
    public var load: @Sendable () -> Data?
    public var clear: @Sendable () -> Void

    public init(save: @escaping @Sendable (Data) -> Void,
                load: @escaping @Sendable () -> Data?,
                clear: @escaping @Sendable () -> Void) {
        self.save = save; self.load = load; self.clear = clear
    }

    public static func inMemory() -> CodeSessionStorage {
        let box = InMemoryBox()
        return CodeSessionStorage(
            save: { box.data = $0 },
            load: { box.data },
            clear: { box.data = nil })
    }

    public static func userDefaults(suiteName: String? = nil,
                                    key: String = "codeblue.session") -> CodeSessionStorage {
        CodeSessionStorage(
            save: { UserDefaults(suiteName: suiteName)?.set($0, forKey: key) },
            load: { UserDefaults(suiteName: suiteName)?.data(forKey: key) },
            clear: { UserDefaults(suiteName: suiteName)?.removeObject(forKey: key) })
    }
}

private final class InMemoryBox: @unchecked Sendable {
    var data: Data?
}

/// Snapshot save/restore with a 6 h staleness bound, an injectable clock and
/// injectable storage. While running, resumed elapsed catches up with the wall
/// clock: elapsed = elapsedAtSave + (now - savedAt).
public struct CodeSessionStore: Sendable {
    public var now: @Sendable () -> Date
    public var storage: CodeSessionStorage

    public init(now: @escaping @Sendable () -> Date = { Date() },
                storage: CodeSessionStorage = .userDefaults()) {
        self.now = now; self.storage = storage
    }

    public func save(_ snapshot: CodeSessionSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        storage.save(data)
    }

    public func clear() { storage.clear() }

    /// Raw stored snapshot without any staleness check.
    public func peek() -> CodeSessionSnapshot? {
        guard let data = storage.load() else { return nil }
        return try? JSONDecoder().decode(CodeSessionSnapshot.self, from: data)
    }

    public struct Restored: Equatable, Sendable {
        public let snapshot: CodeSessionSnapshot
        /// elapsedAtSave caught up by wall-clock time since the save.
        public let resumedElapsed: TimeInterval
    }

    /// Returns nil (and discards) when no snapshot exists or it is older than
    /// 6 h. Otherwise the snapshot plus the caught-up elapsed time.
    @discardableResult
    public func restore(now: Date) -> Restored? {
        guard let snap = peek() else { return nil }
        let age = now.timeIntervalSince(snap.savedAtWallClock)
        guard age <= CodeSessionSnapshot.maxAge else {
            storage.clear()
            return nil
        }
        return Restored(snapshot: snap,
                         resumedElapsed: snap.elapsedAtSave + max(0, age))
    }
}
