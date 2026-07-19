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

    /// Attempts to send every pending ack once; keeps failures for a later retry.
    public func flush() async {
        guard !pending.isEmpty else { return }
        var remaining: [Ack] = []
        for ack in pending {
            let ok = await sender.send(ack)
            if !ok { remaining.append(ack) }
        }
        pending = remaining
        store.save(pending)
    }
}
