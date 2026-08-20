import Foundation

/**
 * Background model download via a BACKGROUND `URLSession`.
 *
 * Mirrors the Android `ModelDownloader` (DownloadManager) so both platforms behave the same. The JS
 * chunk loop it replaces ran inside the WebView, so it stopped the moment the app was backgrounded -
 * exactly what someone does after starting a 2.5 GB download. A background URLSession keeps
 * transferring while the app is suspended and relaunches the app to finish up.
 *
 * It is also much faster. The chunk loop had to slice the file into 2 MiB HTTP Range requests
 * (because a 24 MiB ranged fetch times out in the WebView) and base64 every slice across the
 * Capacitor bridge; measured ~1.5 MB/s on Android where DownloadManager did the same file in under a
 * minute. None of that marshalling exists here.
 *
 * STORAGE: files land in Documents/maik-models, which is what @capacitor/filesystem `Directory.Data`
 * maps to on iOS, so the JS side's paths keep working. The directory is excluded from iCloud backup
 * (a 2.5 GB re-downloadable model must never enter someone's backup).
 *
 * NO metered gate, by product decision: `allowsExpensiveNetworkAccess` and
 * `allowsConstrainedNetworkAccess` are both on. If a clinician taps download, they get the download.
 */
final class ModelDownloader: NSObject, URLSessionDownloadDelegate {

    static let shared = ModelDownloader()

    static let subdir = "maik-models"

    /// Progress for the in-flight task, read by `status(name:)`.
    private struct Progress {
        var bytes: Int64 = 0
        var total: Int64 = -1
        var state: String = "pending"   // pending | running | done | failed | cancelled
        var error: String?
    }

    private let lock = NSLock()
    private var progress: [String: Progress] = [:]      // keyed by destination file name
    private var tasks: [String: URLSessionDownloadTask] = [:]

    /// One background session for the app. The identifier must be stable so iOS can hand completed
    /// transfers back after a relaunch.
    /// Reconnect to transfers that outlived the app.
    ///
    /// A background URLSession KEEPS RUNNING across app relaunches, but this object's `progress` and
    /// `tasks` maps do not. Without adopting the live tasks, status() reports "none" after a
    /// relaunch, the JS layer concludes nothing is in flight, and start() launches a SECOND download
    /// of the same file - two concurrent transfers fighting over one destination, with the progress
    /// jumping between them. Observed on device.
    func adoptExistingTasks(_ done: (() -> Void)? = nil) {
        session.getAllTasks { [weak self] tasks in
            guard let self else { done?(); return }
            self.lock.lock()
            for t in tasks {
                guard let name = t.taskDescription, let dt = t as? URLSessionDownloadTask else { continue }
                self.tasks[name] = dt
                let total = dt.countOfBytesExpectedToReceive
                self.progress[name] = Progress(bytes: dt.countOfBytesReceived,
                                               total: total > 0 ? total : -1,
                                               state: dt.state == .running ? "running" : "pending",
                                               error: nil)
            }
            self.lock.unlock()
            done?()
        }
    }

    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: "in.stewardmd.llama.modeldownload")
        cfg.allowsExpensiveNetworkAccess = true        // no Wi-Fi-only gate
        cfg.allowsConstrainedNetworkAccess = true      // works in Low Data Mode too
        cfg.sessionSendsLaunchEvents = true
        cfg.isDiscretionary = false                    // the clinician asked for it NOW
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    // MARK: - Paths

    static func dir() throws -> URL {
        let base = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var d = base.appendingPathComponent(subdir, isDirectory: true)
        if !FileManager.default.fileExists(atPath: d.path) {
            try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
        // A 2.5 GB re-downloadable model must never enter an iCloud backup.
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        try? d.setResourceValues(rv)
        return d
    }

    static func pathFor(_ name: String) -> URL {
        (try? dir())?.appendingPathComponent(name) ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
    }

    static func sizeOf(_ name: String) -> Int64 {
        let p = pathFor(name).path
        guard let a = try? FileManager.default.attributesOfItem(atPath: p) else { return 0 }
        return (a[.size] as? Int64) ?? 0
    }

    static func freeBytes() -> Int64 {
        guard let d = try? dir(),
              let v = try? d.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
              let free = v.volumeAvailableCapacityForImportantUsage else { return -1 }
        return Int64(free)
    }

    // MARK: - Control

    /// Start (or restart) a download. Returns the task identifier as a string, mirroring Android.
    func start(url: String, name: String) throws -> String {
        guard let u = URL(string: url) else { throw LlamaError(.badArguments, "bad url") }
        // Never start a second transfer for a file that is already downloading. This is the guard
        // that stops the double-download: the JS side can legitimately ask again after a relaunch,
        // and the honest answer is "already running", not "here is another one".
        lock.lock()
        if let existing = tasks[name], existing.state == .running || existing.state == .suspended {
            lock.unlock()
            return String(existing.taskIdentifier)
        }
        lock.unlock()
        // Deliberately NOT deleting the destination here. URLSession writes to its own temp file and
        // moves it into place on completion, so a stale destination is overwritten anyway - and
        // deleting it meant a partially-verified file could vanish under a caller that was about to
        // read its size.
        let task = session.downloadTask(with: u)
        task.taskDescription = name
        lock.lock()
        progress[name] = Progress(bytes: 0, total: -1, state: "pending", error: nil)
        tasks[name] = task
        lock.unlock()
        task.resume()
        return String(task.taskIdentifier)
    }

    func cancel(name: String) {
        lock.lock(); let t = tasks[name]; progress[name]?.state = "cancelled"; lock.unlock()
        t?.cancel()
    }

    func status(name: String) -> [String: Any] {
        lock.lock(); let p = progress[name]; lock.unlock()
        let onDisk = Self.sizeOf(name)
        var out: [String: Any] = [
            "onDisk": onDisk,
            "path": Self.pathFor(name).path,
            "freeBytes": Self.freeBytes()
        ]
        if let p {
            out["state"] = p.state
            out["bytes"] = p.bytes
            out["total"] = p.total
            if let e = p.error { out["reason"] = e }
        } else {
            // No live task: either never started, or finished in a previous app launch.
            out["state"] = onDisk > 0 ? "done" : "none"
            out["bytes"] = onDisk
            out["total"] = onDisk
        }
        return out
    }

    func delete(name: String) -> Bool {
        cancel(name: name)
        let p = Self.pathFor(name)
        if !FileManager.default.fileExists(atPath: p.path) { return true }
        return (try? FileManager.default.removeItem(at: p)) != nil
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard let name = downloadTask.taskDescription else { return }
        lock.lock()
        progress[name] = Progress(bytes: totalBytesWritten, total: totalBytesExpectedToWrite,
                                  state: "running", error: nil)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let name = downloadTask.taskDescription else { return }
        // MUST move it synchronously here: `location` is deleted as soon as this returns.
        do {
            let dest = Self.pathFor(name)
            if FileManager.default.fileExists(atPath: dest.path) { try? FileManager.default.removeItem(at: dest) }
            try FileManager.default.moveItem(at: location, to: dest)
            lock.lock()
            progress[name] = Progress(bytes: Self.sizeOf(name), total: Self.sizeOf(name), state: "done", error: nil)
            lock.unlock()
        } catch {
            lock.lock()
            progress[name] = Progress(bytes: 0, total: -1, state: "failed", error: error.localizedDescription)
            lock.unlock()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let name = task.taskDescription else { return }
        lock.lock()
        if let error {
            let cancelled = (error as NSError).code == NSURLErrorCancelled
            progress[name] = Progress(bytes: progress[name]?.bytes ?? 0, total: progress[name]?.total ?? -1,
                                      state: cancelled ? "cancelled" : "failed",
                                      error: cancelled ? nil : error.localizedDescription)
        }
        tasks[name] = nil
        lock.unlock()
    }
}
