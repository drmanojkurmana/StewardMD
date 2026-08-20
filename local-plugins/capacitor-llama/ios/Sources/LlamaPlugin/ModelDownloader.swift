import Foundation
import UIKit

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
 *
 * TWO SESSIONS, and this is the important part.
 *
 * A background URLSession is scheduled by iOS for battery life, not throughput. Measured on an
 * iPhone 15 Pro: 0.5 MB/s, while a Mac on the SAME Wi-Fi pulled the same file at 3.0 MB/s. Six
 * parallel range requests only reached 3.68 MB/s, which rules out server-side per-connection
 * throttling - so the ceiling was the background transfer service, not the network and not
 * HuggingFace. At 0.5 MB/s a 2.83 GB model takes 1.6 hours.
 *
 * So: a DEFAULT session runs the transfer while the app is in the foreground (full speed, and the
 * clinician is watching the progress bar), and the transfer is handed to the BACKGROUND session when
 * the app is backgrounded - which is the only time the background service is actually needed. Handoff
 * uses `cancel(byProducingResumeData:)`, so no bytes are re-downloaded. If iOS declines to give
 * resume data the task is left exactly where it is rather than restarted, because losing 2 GB of
 * progress to save a session switch would be a terrible trade.
 */
final class ModelDownloader: NSObject, URLSessionDownloadDelegate {

    static let shared = ModelDownloader()

    private override init() {
        super.init()
        observeLifecycle()
    }

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
                self.onFg.remove(name)      // a transfer that outlived the app is on bgSession
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

    /// Survives app relaunch; used only while the app is NOT in the foreground.
    private lazy var bgSession: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: "in.stewardmd.llama.modeldownload")
        cfg.allowsExpensiveNetworkAccess = true        // no Wi-Fi-only gate
        cfg.allowsConstrainedNetworkAccess = true      // works in Low Data Mode too
        cfg.sessionSendsLaunchEvents = true
        cfg.isDiscretionary = false                    // the clinician asked for it NOW
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    /// Full-speed session for while the app is on screen. Dies with the process, which is fine -
    /// backgrounding hands its work to bgSession first.
    private lazy var fgSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.allowsExpensiveNetworkAccess = true
        cfg.allowsConstrainedNetworkAccess = true
        cfg.networkServiceType = .responsiveData       // ask for throughput, not deferral
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 0             // a multi-GB model has no deadline
        cfg.httpMaximumConnectionsPerHost = 6
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    /// `session` is retained as the name used by `adoptExistingTasks` - only the background session
    /// can carry work across a relaunch, so that is the one to re-attach to.
    private var session: URLSession { bgSession }

    /// Which session currently owns each transfer, so cancel/status act on the right one.
    private var onFg: Set<String> = []

    /// Throughput sampling, printed to stdout so `devicectl --console` can read it. This exists
    /// because the 0.5 MB/s figure above came from the UI and had to be confirmed natively.
    private var mark: [String: (t: Date, bytes: Int64)] = [:]

    /// Foreground/background transitions drive the handoff. Registered once, in init.
    private func observeLifecycle() {
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.migrate(toForeground: false)
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.migrate(toForeground: true)
        }
    }

    /// Move every running transfer to the session that suits the current app state.
    private func migrate(toForeground: Bool) {
        lock.lock()
        let moving = tasks.filter { name, _ in toForeground ? !onFg.contains(name) : onFg.contains(name) }
        lock.unlock()
        for (name, task) in moving {
            guard task.state == .running || task.state == .suspended else { continue }
            task.cancel(byProducingResumeData: { [weak self] data in
                guard let self else { return }
                guard let data, !data.isEmpty else {
                    // iOS would not hand back resume data. Leaving the transfer cancelled would throw
                    // away everything downloaded so far, so restart it on the destination session
                    // from scratch only if nothing is on disk; otherwise report it paused and let the
                    // clinician resume, which re-requests with a Range from what is already there.
                    print("[llama-dl] \(name): no resume data on handoff, transfer paused")
                    self.lock.lock(); self.progress[name]?.state = "paused"; self.tasks[name] = nil
                    self.onFg.remove(name); self.lock.unlock()
                    return
                }
                let dest = toForeground ? self.fgSession : self.bgSession
                let t = dest.downloadTask(withResumeData: data)
                t.taskDescription = name      // NOT carried in resume data; must be set again
                self.lock.lock()
                self.tasks[name] = t
                if toForeground { self.onFg.insert(name) } else { self.onFg.remove(name) }
                self.lock.unlock()
                t.resume()
                print("[llama-dl] \(name): handed to \(toForeground ? "foreground" : "background") session")
            })
        }
    }

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
        // Foreground when the app is on screen (fast), background otherwise (survives suspension).
        let fg = Thread.isMainThread ? UIApplication.shared.applicationState == .active
                                     : DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
        let task = (fg ? fgSession : bgSession).downloadTask(with: u)
        task.taskDescription = name
        lock.lock()
        progress[name] = Progress(bytes: 0, total: -1, state: "pending", error: nil)
        tasks[name] = task
        if fg { onFg.insert(name) } else { onFg.remove(name) }
        mark[name] = (Date(), 0)
        lock.unlock()
        task.resume()
        print("[llama-dl] \(name): started on \(fg ? "foreground" : "background") session")
        return String(task.taskIdentifier)
    }

    func cancel(name: String) {
        lock.lock(); let t = tasks[name]; progress[name]?.state = "cancelled"; onFg.remove(name); lock.unlock()
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
        // Sample roughly every 5s. Printed, not os_log'd, because devicectl --console reads stdout.
        var line: String? = nil
        if let m = mark[name] {
            let dt = Date().timeIntervalSince(m.t)
            if dt >= 5 {
                let mbps = Double(totalBytesWritten - m.bytes) / 1_048_576.0 / dt
                line = String(format: "[llama-dl] %@: %.2f MB/s (%@ session, %.1f%%)", name,
                              mbps, onFg.contains(name) ? "fg" : "bg",
                              totalBytesExpectedToWrite > 0 ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) * 100 : 0)
                mark[name] = (Date(), totalBytesWritten)
            }
        } else { mark[name] = (Date(), totalBytesWritten) }
        lock.unlock()
        if let line { print(line) }
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
        onFg.remove(name)
        mark[name] = nil
        lock.unlock()
    }
}
