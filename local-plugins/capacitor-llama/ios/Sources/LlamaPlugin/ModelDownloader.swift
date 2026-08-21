import Foundation

/**
 * Background model download: CHUNKED, PARALLEL, and entirely inside one background URLSession.
 *
 * ── Why chunked (measured, not assumed) ──────────────────────────────────────────────────────────
 * On identical Wi-Fi, same room, same 3.11 GB file, Android's DownloadManager reached 10.5 MB/s while
 * a single background URLSession task managed 1.3 MB/s. A DownloadProbe run on the device then
 * measured three shapes back to back:
 *
 *     A  default session, 1 stream           6.55 MB/s
 *     B  background session, 1 stream        1.08 MB/s
 *     C  background session, 4 range tasks   4.77 MB/s
 *
 * C is 4.4x B, so iOS throttles background transfers PER TASK. Splitting the file into ranged parts
 * therefore recovers the bandwidth WITHOUT leaving the background session - no foreground/background
 * handoff, no dependency on app-lifecycle timing.
 *
 * That distinction matters: an earlier attempt did use a handoff (default session in the foreground,
 * moved to the background session on didEnterBackgroundNotification) and it broke background
 * downloads outright, because cancel(byProducingResumeData:) is asynchronous and iOS suspends the app
 * before the completion block can restart the transfer. Nothing here depends on when the app is
 * suspended: every task is a background task from the moment it is created.
 *
 * ── How a transfer is laid out ───────────────────────────────────────────────────────────────────
 * The file is split into CHUNK_BYTES ranges. Each part is its own background download task with a
 * `Range:` header. As a part lands it is written straight into the final file at its own offset and
 * the temp copy is dropped, so peak extra disk is (in-flight parts x chunk), not a second copy of the
 * model. Committed parts are recorded in a `<name>.parts` sidecar of '0'/'1' flags, so a relaunch
 * re-queues only what is missing and nothing already paid for is downloaded twice.
 *
 * Losing an in-flight part costs at most one chunk, which is the other reason for chunking: the old
 * single-task design lost everything when a transfer failed at 89%.
 *
 * ── If the server ignores Range ──────────────────────────────────────────────────────────────────
 * A part that comes back 200 instead of 206 IS the whole file. That is detected, the body is used as
 * the complete download, and the sibling tasks are cancelled. So an origin without Range support
 * still works, just single-streamed.
 *
 * STORAGE: models live in Documents/maik-models (Directory.Data on iOS, so the JS paths keep
 * working), excluded from iCloud backup - a re-downloadable multi-GB model must never enter a backup.
 *
 * NO metered gate, by product decision: expensive and constrained network access are both allowed.
 * If a clinician taps download, they get the download.
 */
final class ModelDownloader: NSObject, URLSessionDownloadDelegate {

    static let shared = ModelDownloader()

    static let subdir = "maik-models"

    /// 64 MB. Big enough that per-request overhead is noise, small enough that losing one in-flight
    /// part is cheap and the sidecar stays small (a 3.11 GB model is 49 parts).
    static let chunkBytes: Int64 = 64 * 1024 * 1024

    /// Concurrent parts. The probe showed 4 tasks recovering 4.4x; 8 aims at the ~6.5 MB/s a single
    /// unthrottled stream managed, without opening so many sockets that the host starts throttling.
    static let maxParts = 8

    private struct Job {
        var url: URL
        var total: Int64
        var chunks: Int
        var committed: [Bool]          // parts already written into the final file
        var inflight: [Int: Int64]     // part index -> bytes received so far
        var state: String              // pending | running | done | failed | cancelled | paused
        var error: String?
        var whole: Bool = false        // server ignored Range; one task carries everything
    }

    private let lock = NSLock()
    private var jobs: [String: Job] = [:]

    /// One background session for the app. The identifier is stable so iOS can hand completed
    /// transfers back after a relaunch.
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: "in.stewardmd.llama.modeldownload")
        cfg.allowsExpensiveNetworkAccess = true         // no Wi-Fi-only gate
        cfg.allowsConstrainedNetworkAccess = true       // works in Low Data Mode too
        cfg.sessionSendsLaunchEvents = true
        cfg.isDiscretionary = false                     // the clinician asked for it NOW
        cfg.httpMaximumConnectionsPerHost = Self.maxParts   // pointless to fan out past this
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    // MARK: - Paths

    static func dir() throws -> URL {
        let base = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var d = base.appendingPathComponent(subdir, isDirectory: true)
        if !FileManager.default.fileExists(atPath: d.path) {
            try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        try? d.setResourceValues(rv)
        return d
    }

    static func pathFor(_ name: String) -> URL {
        (try? dir())?.appendingPathComponent(name) ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
    }

    static func sidecarFor(_ name: String) -> URL { pathFor(name + ".parts") }

    static func sizeOf(_ name: String) -> Int64 {
        guard let a = try? FileManager.default.attributesOfItem(atPath: pathFor(name).path) else { return 0 }
        return (a[.size] as? Int64) ?? 0
    }

    /**
     * Is this file a PARTIAL chunked download?
     *
     * Size alone cannot answer that: the chunked downloader creates the final file at its FULL length
     * up front so parts can be written at their own offsets, so an incomplete 2.49 GB model measures
     * exactly 2.49 GB on disk. The `.parts` sidecar is the authority - it is written when a transfer
     * starts and deleted only when every part has landed.
     *
     * Without this, `modelPath` reported a complete-looking size, the JS layer concluded "already
     * downloaded", and an incomplete model was both never resumed AND offered as ready to run.
     */
    static func isPartial(_ name: String) -> Bool {
        FileManager.default.fileExists(atPath: sidecarFor(name).path)
    }

    static func freeBytes() -> Int64 {
        guard let d = try? dir(),
              let v = try? d.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
              let free = v.volumeAvailableCapacityForImportantUsage else { return -1 }
        return Int64(free)
    }

    // MARK: - Sidecar (which parts are already committed)

    private func readSidecar(_ name: String, chunks: Int) -> [Bool] {
        guard let s = try? String(contentsOf: Self.sidecarFor(name), encoding: .utf8), s.count == chunks else {
            return Array(repeating: false, count: chunks)
        }
        return s.map { $0 == "1" }
    }

    private func writeSidecar(_ name: String, _ committed: [Bool]) {
        let s = committed.map { $0 ? "1" : "0" }.joined()
        try? s.write(to: Self.sidecarFor(name), atomically: true, encoding: .utf8)
    }

    // MARK: - Control

    /**
     * Start (or resume) a chunked download. `total` is the expected size from the model registry -
     * without it the file cannot be split, so a missing/zero total falls back to one whole-file task.
     */
    func start(url: String, name: String, total: Int64) throws -> String {
        guard let u = URL(string: url) else { throw LlamaError(.badArguments, "bad url") }

        lock.lock()
        // Already running? Hand back the same transfer rather than starting a rival one.
        if let j = jobs[name], j.state == "running" || j.state == "pending" {
            lock.unlock(); return name
        }
        lock.unlock()

        // Nothing to do if the finished file is already the right size.
        if total > 0 && Self.sizeOf(name) == total {
            lock.lock(); jobs[name] = Job(url: u, total: total, chunks: 1, committed: [true], inflight: [:], state: "done", error: nil); lock.unlock()
            return name
        }

        let chunks = total > 0 ? max(1, Int((total + Self.chunkBytes - 1) / Self.chunkBytes)) : 1
        var committed = total > 0 ? readSidecar(name, chunks: chunks) : Array(repeating: false, count: 1)

        // The final file must exist at full length before parts can be written at their offsets.
        let dest = Self.pathFor(name)
        if total > 0 {
            if !FileManager.default.fileExists(atPath: dest.path) {
                FileManager.default.createFile(atPath: dest.path, contents: nil)
                committed = Array(repeating: false, count: chunks)   // fresh file, ignore a stale sidecar
            }
            if let h = try? FileHandle(forWritingTo: dest) {
                // Extend (never shrink): truncating a file we may be resuming would discard parts.
                if (try? h.seekToEnd()) ?? 0 < UInt64(total) { try? h.truncate(atOffset: UInt64(total)) }
                try? h.close()
            }
            writeSidecar(name, committed)
        }

        lock.lock()
        jobs[name] = Job(url: u, total: total, chunks: chunks, committed: committed, inflight: [:],
                         state: "pending", error: nil, whole: total <= 0)
        lock.unlock()

        if total <= 0 {
            // No known size: one plain task, same as before chunking existed.
            let t = session.downloadTask(with: u)
            t.taskDescription = name + "#w"
            t.resume()
            print("[llama-dl] \(name): started, size unknown, single stream")
            return name
        }

        var queued = 0
        for i in 0..<chunks where !committed[i] {
            let from = Int64(i) * Self.chunkBytes
            let to = min(from + Self.chunkBytes, total) - 1
            var r = URLRequest(url: u)
            r.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range")
            let t = session.downloadTask(with: r)
            t.taskDescription = "\(name)#\(i)"
            t.resume()
            queued += 1
        }
        let have = committed.filter { $0 }.count
        print("[llama-dl] \(name): started \(queued) parts (\(have)/\(chunks) already on disk, \(Self.maxParts) at a time)")
        if queued == 0 { finish(name) }
        return name
    }

    func cancel(name: String) {
        lock.lock(); jobs[name]?.state = "cancelled"; lock.unlock()
        // Parts already committed stay on disk, so a later Download resumes instead of restarting.
        session.getAllTasks { tasks in
            for t in tasks where (t.taskDescription ?? "").hasPrefix(name + "#") { t.cancel() }
        }
    }

    func status(name: String) -> [String: Any] {
        lock.lock()
        let j = jobs[name]
        let bytes: Int64 = {
            guard let j else { return 0 }
            if j.whole { return j.inflight.values.reduce(0, +) }
            let done = Int64(j.committed.filter { $0 }.count) * Self.chunkBytes
            return min(j.total > 0 ? j.total : done, done + j.inflight.values.reduce(0, +))
        }()
        lock.unlock()

        let onDisk = Self.sizeOf(name)
        var out: [String: Any] = ["onDisk": onDisk, "path": Self.pathFor(name).path, "freeBytes": Self.freeBytes()]
        if let j {
            out["state"] = j.state
            out["bytes"] = bytes
            out["total"] = j.total
            if let e = j.error { out["reason"] = e }
        } else {
            // No job in memory. A COMPLETE file means done; a part-written file means resumable, and
            // it must NOT read as done just because bytes exist on disk - the final file is created at
            // full length up front, so its size says nothing about how much has actually arrived.
            let chunks = FileManager.default.fileExists(atPath: Self.sidecarFor(name).path)
            out["state"] = chunks ? "paused" : (onDisk > 0 ? "done" : "none")
            out["bytes"] = chunks ? committedBytesOnDisk(name) : onDisk
            out["total"] = onDisk
        }
        return out
    }

    /// Bytes recorded as committed by the sidecar, for a transfer with no in-memory job (post-relaunch).
    private func committedBytesOnDisk(_ name: String) -> Int64 {
        guard let s = try? String(contentsOf: Self.sidecarFor(name), encoding: .utf8) else { return 0 }
        return Int64(s.filter { $0 == "1" }.count) * Self.chunkBytes
    }

    func delete(name: String) -> Bool {
        cancel(name: name)
        lock.lock(); jobs[name] = nil; lock.unlock()
        try? FileManager.default.removeItem(at: Self.sidecarFor(name))
        let p = Self.pathFor(name)
        if !FileManager.default.fileExists(atPath: p.path) { return true }
        return (try? FileManager.default.removeItem(at: p)) != nil
    }

    /**
     * Reconnect to transfers that outlived the app.
     *
     * A background URLSession keeps running across relaunches, but `jobs` does not. Without adopting
     * the live tasks, status() reports "none", the JS layer concludes nothing is in flight, and it
     * starts a SECOND download of the same file - two sets of parts racing for one destination.
     */
    func adoptExistingTasks(_ done: (() -> Void)? = nil) {
        session.getAllTasks { [weak self] tasks in
            guard let self else { done?(); return }
            self.lock.lock()
            for t in tasks {
                guard let desc = t.taskDescription, let hash = desc.lastIndex(of: "#") else { continue }
                let name = String(desc[desc.startIndex..<hash])
                let part = String(desc[desc.index(after: hash)...])
                if self.jobs[name] == nil, let u = t.originalRequest?.url {
                    let chunks = self.sidecarChunks(name)
                    self.jobs[name] = Job(url: u, total: 0, chunks: max(1, chunks),
                                          committed: self.readSidecar(name, chunks: max(1, chunks)),
                                          inflight: [:], state: "running", error: nil, whole: part == "w")
                }
                self.jobs[name]?.state = "running"
                if let i = Int(part) { self.jobs[name]?.inflight[i] = t.countOfBytesReceived }
            }
            self.lock.unlock()
            done?()
        }
    }

    private func sidecarChunks(_ name: String) -> Int {
        guard let s = try? String(contentsOf: Self.sidecarFor(name), encoding: .utf8) else { return 0 }
        return s.count
    }

    // MARK: - Completion

    /// All parts committed: trim to the exact size, drop the sidecar, mark done.
    private func finish(_ name: String) {
        lock.lock()
        guard var j = jobs[name] else { lock.unlock(); return }
        let total = j.total
        j.state = "done"; j.inflight = [:]
        jobs[name] = j
        lock.unlock()

        if total > 0, let h = try? FileHandle(forWritingTo: Self.pathFor(name)) {
            try? h.truncate(atOffset: UInt64(total))
            try? h.close()
        }
        try? FileManager.default.removeItem(at: Self.sidecarFor(name))
        print("[llama-dl] \(name): complete, \(Self.sizeOf(name)) bytes on disk")
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard let desc = downloadTask.taskDescription, let hash = desc.lastIndex(of: "#") else { return }
        let name = String(desc[desc.startIndex..<hash])
        let part = Int(String(desc[desc.index(after: hash)...])) ?? 0
        lock.lock()
        jobs[name]?.state = "running"
        jobs[name]?.inflight[part] = totalBytesWritten
        lock.unlock()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let desc = downloadTask.taskDescription, let hash = desc.lastIndex(of: "#") else { return }
        let name = String(desc[desc.startIndex..<hash])
        let partStr = String(desc[desc.index(after: hash)...])
        let code = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0

        // MUST act synchronously: `location` is deleted as soon as this returns.

        // The origin ignored Range, so this body is the ENTIRE file. Use it and stop the siblings.
        if code == 200, partStr != "w" {
            print("[llama-dl] \(name): origin ignored Range (http 200), falling back to a single stream")
            let dest = Self.pathFor(name)
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.moveItem(at: location, to: dest)
            try? FileManager.default.removeItem(at: Self.sidecarFor(name))
            lock.lock()
            jobs[name]?.whole = true
            jobs[name]?.committed = [true]
            jobs[name]?.chunks = 1
            jobs[name]?.state = "done"
            lock.unlock()
            session.getAllTasks { tasks in
                for t in tasks where (t.taskDescription ?? "").hasPrefix(name + "#") { t.cancel() }
            }
            return
        }

        if partStr == "w" {                      // unknown-size single stream
            let dest = Self.pathFor(name)
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.moveItem(at: location, to: dest)
            lock.lock(); jobs[name]?.state = "done"; lock.unlock()
            print("[llama-dl] \(name): complete (single stream)")
            return
        }

        guard let part = Int(partStr) else { return }
        let offset = Int64(part) * Self.chunkBytes

        // Write the part straight into the final file at its own offset, then let the temp go. This is
        // why peak disk is (in-flight parts x chunk) and not a second copy of the whole model.
        do {
            let data = try Data(contentsOf: location, options: .mappedIfSafe)
            let h = try FileHandle(forWritingTo: Self.pathFor(name))
            try h.seek(toOffset: UInt64(offset))
            try h.write(contentsOf: data)
            try h.close()
        } catch {
            lock.lock(); jobs[name]?.state = "failed"; jobs[name]?.error = error.localizedDescription; lock.unlock()
            print("[llama-dl] \(name) part \(part): write failed - \(error.localizedDescription)")
            return
        }

        var allDone = false
        lock.lock()
        if var j = jobs[name] {
            if part < j.committed.count { j.committed[part] = true }
            j.inflight[part] = nil
            jobs[name] = j
            writeSidecar(name, j.committed)
            allDone = !j.committed.contains(false)
        }
        lock.unlock()
        if allDone { finish(name) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let desc = task.taskDescription, let hash = desc.lastIndex(of: "#") else { return }
        let name = String(desc[desc.startIndex..<hash])
        let part = Int(String(desc[desc.index(after: hash)...]))
        guard let error else { return }
        let cancelled = (error as NSError).code == NSURLErrorCancelled
        lock.lock()
        if let p = part { jobs[name]?.inflight[p] = nil }
        if !cancelled {
            // One part failing does not condemn the transfer: the committed parts are on disk and the
            // next Download re-queues only what is missing.
            jobs[name]?.state = "paused"
            jobs[name]?.error = error.localizedDescription
        } else if jobs[name]?.state != "done" {
            jobs[name]?.state = "cancelled"
        }
        lock.unlock()
        if !cancelled { print("[llama-dl] \(name) part \(part.map(String.init) ?? "?"): \(error.localizedDescription)") }
    }
}
