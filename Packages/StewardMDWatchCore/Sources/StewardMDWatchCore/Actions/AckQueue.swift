import Foundation

/// Serializes acknowledgement actions: optimistic locally, synced when online.
/// Idempotent by `Ack.id`; persists pending acks so they survive relaunch and
/// reconcile on reconnect (design §12). One `flush()` attempts each pending ack
/// once; the caller schedules retries (on reconnect / app active).
public actor AckQueue {
    private let store: AckStore
    private let sender: AckSender
    private var pending: [Ack]

    public init(store: AckStore = UserDefaultsAckStore(), sender: AckSender = LoggingAckSender()) {
        self.store = store
        self.sender = sender
        self.pending = store.load()
    }

    public var pendingCount: Int { pending.count }

    /// Records an ack (dedup by id) and persists it. The caller flushes (the UI
    /// updates optimistically regardless, so recording must never block on the
    /// network).
    public func enqueue(_ ack: Ack) {
        guard !pending.contains(where: { $0.id == ack.id }) else { return }
        pending.append(ack)
        store.save(pending)
    }

    /// Attempts to send every currently-pending ack once; keeps failures for a
    /// later retry. Reentrancy-safe: an `enqueue` during an `await send` is not
    /// lost — only the acks actually sent in this batch are removed (not the
    /// whole snapshot).
    public func flush() async {
        let batch = pending
        guard !batch.isEmpty else { return }
        var sentIDs = Set<String>()
        for ack in batch {
            if await sender.send(ack) { sentIDs.insert(ack.id) }
        }
        pending.removeAll { sentIDs.contains($0.id) }
        store.save(pending)
    }
}
