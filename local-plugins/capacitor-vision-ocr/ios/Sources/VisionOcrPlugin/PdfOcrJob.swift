import Foundation
import PDFKit
import Vision
import UIKit
import UserNotifications
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/**
 * ResearchMD phase 05: a whole scanned-PDF OCR job run natively, so it keeps going while the WebView is
 * paused. Each finished page is written to Application Support/rmd_od/<jobKey>/page-<n>.json in the
 * phase 01 page shape (text, words with NORMALIZED top-left boxes, width/height in points, ocr true,
 * tables). A page whose file already exists is skipped, so a restarted job resumes where it stopped.
 *
 * Background:
 * - iOS/iPadOS 26+: the job runs as a BGContinuedProcessingTask, so the system shows progress and the
 *   user can cancel it. If the task expires or is denied, the current page finishes and the job pauses.
 * - Older iOS: runs while the app is open. On entering the background the current page finishes, the job
 *   pauses and a local notification says where it stopped. It resumes when the app is active again.
 * - Mac (iPad app on Apple silicon): keeps running while the app is open.
 *
 * Nothing leaves the device. Notifications show page numbers only, never a file name or any text.
 */
final class PdfOcrJobManager {
    static let shared = PdfOcrJobManager()

    /// Must match a BGTaskSchedulerPermittedIdentifiers entry in the app's Info.plist (wildcard allowed).
    static let bgTaskPrefix = "in.stewardmd.app.rmdod."

    enum State: String { case running, paused, done, failed }

    final class Job {
        let key: String
        let pdfURL: URL
        let pages: [Int]
        let dpi: CGFloat
        var state: State = .running
        var error: String?
        var cancelled = false
        var pauseRequested = false
        var done: Set<Int> = []
        var bgTask: AnyObject?   // BGContinuedProcessingTask on iOS 26+
        init(key: String, pdfURL: URL, pages: [Int], dpi: CGFloat) {
            self.key = key; self.pdfURL = pdfURL; self.pages = pages; self.dpi = dpi
        }
    }

    private let lock = NSLock()
    private var jobs: [String: Job] = [:]
    private let queue = DispatchQueue(label: "in.stewardmd.rmdod.ocr", qos: .userInitiated)
    private var observing = false
    private var registeredIdents: Set<String> = []
    /// Progress events: (jobKey, done, total).
    var onProgress: ((String, Int, Int) -> Void)?

    // MARK: paths

    static func isValidKey(_ key: String) -> Bool {
        if key.isEmpty || key.count > 128 { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.:")
        if key.contains("..") || key.hasPrefix(".") { return false }
        return key.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    static func safeDirName(_ key: String) -> String {
        return key.replacingOccurrences(of: ":", with: "_")
    }

    static func jobDir(_ key: String) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("rmd_od", isDirectory: true)
            .appendingPathComponent(safeDirName(key), isDirectory: true)
    }

    static func pageURL(_ key: String, _ n: Int) -> URL {
        return jobDir(key).appendingPathComponent("page-\(n).json")
    }

    static func metaURL(_ key: String) -> URL {
        return jobDir(key).appendingPathComponent("meta.json")
    }

    static func donePagesOnDisk(_ key: String) -> [Int] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: jobDir(key).path) else { return [] }
        var out: [Int] = []
        for n in names where n.hasPrefix("page-") && n.hasSuffix(".json") {
            let mid = n.dropFirst(5).dropLast(5)
            if let v = Int(mid) { out.append(v) }
        }
        return out.sorted()
    }

    // MARK: public API

    func start(key: String, path: String, pages: [Int], dpi: CGFloat) throws {
        guard PdfOcrJobManager.isValidKey(key) else { throw NSError(domain: "rmdod", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid-job-key"]) }
        let url: URL
        if path.hasPrefix("file://"), let u = URL(string: path) { url = u } else { url = URL(fileURLWithPath: path) }
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw NSError(domain: "rmdod", code: 2, userInfo: [NSLocalizedDescriptionKey: "pdf-open-failed"])
        }
        let wanted = Array(Set(pages.filter { $0 >= 1 })).sorted()
        try FileManager.default.createDirectory(at: PdfOcrJobManager.jobDir(key), withIntermediateDirectories: true)
        if let meta = try? JSONSerialization.data(withJSONObject: ["pages": wanted, "dpi": Double(dpi)]) {
            try? meta.write(to: PdfOcrJobManager.metaURL(key), options: .atomic)
        }
        lock.lock()
        if let existing = jobs[key], existing.state == .running, !existing.cancelled {
            lock.unlock()
            return   // already running; the caller listens for progress
        }
        let job = Job(key: key, pdfURL: url, pages: wanted, dpi: dpi > 0 ? dpi : 200)
        job.done = Set(PdfOcrJobManager.donePagesOnDisk(key))
        jobs[key] = job
        lock.unlock()
        observeAppState()
        beginBackgroundTask(job)
        queue.async { self.run(job) }
    }

    func status(key: String) -> [String: Any] {
        lock.lock(); let job = jobs[key]; lock.unlock()
        let onDisk = PdfOcrJobManager.donePagesOnDisk(key)
        if let job = job {
            var r: [String: Any] = ["state": job.state.rawValue, "donePages": onDisk, "total": job.pages.count]
            if let e = job.error { r["error"] = e }
            return r
        }
        // Not in memory (the app was restarted): read what is on disk.
        var wanted: [Int] = []
        if let d = try? Data(contentsOf: PdfOcrJobManager.metaURL(key)),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let p = o["pages"] as? [Int] { wanted = p }
        if wanted.isEmpty && onDisk.isEmpty { return ["state": "failed", "donePages": [], "error": "not-found", "total": 0] }
        let complete = !wanted.isEmpty && Set(wanted).isSubset(of: Set(onDisk))
        return ["state": complete ? "done" : "paused", "donePages": onDisk, "total": wanted.count]
    }

    func readPage(key: String, n: Int) throws -> [String: Any] {
        guard PdfOcrJobManager.isValidKey(key) else { throw NSError(domain: "rmdod", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid-job-key"]) }
        let d = try Data(contentsOf: PdfOcrJobManager.pageURL(key, n))
        guard let o = try JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            throw NSError(domain: "rmdod", code: 3, userInfo: [NSLocalizedDescriptionKey: "bad-page-file"])
        }
        return o
    }

    func cancel(key: String) {
        lock.lock(); let job = jobs[key]; lock.unlock()
        job?.cancelled = true
    }

    func clear(key: String) {
        cancel(key: key)
        lock.lock(); jobs[key] = nil; lock.unlock()
        guard PdfOcrJobManager.isValidKey(key) else { return }
        try? FileManager.default.removeItem(at: PdfOcrJobManager.jobDir(key))
    }

    // MARK: work loop

    private func run(_ job: Job) {
        guard let doc = PDFDocument(url: job.pdfURL) else {
            finish(job, state: .failed, error: "pdf-open-failed"); return
        }
        if doc.isLocked { finish(job, state: .failed, error: "password"); return }
        let total = job.pages.count
        emit(job, total)
        for n in job.pages {
            if job.cancelled { finish(job, state: .failed, error: "cancelled"); return }
            if job.pauseRequested { pause(job); return }
            if job.done.contains(n) { continue }
            guard n <= doc.pageCount, let page = doc.page(at: n - 1) else {
                finish(job, state: .failed, error: "pdf-open-failed"); return
            }
            do {
                let obj = try autoreleasepool { () throws -> [String: Any] in
                    return try PdfOcrJobManager.ocrPage(page, number: n, dpi: job.dpi)
                }
                let data = try JSONSerialization.data(withJSONObject: obj)
                try data.write(to: PdfOcrJobManager.pageURL(job.key, n), options: .atomic)
                job.done.insert(n)
                emit(job, total)
            } catch {
                finish(job, state: .failed, error: "ocr-failed"); return
            }
        }
        finish(job, state: .done, error: nil)
    }

    private func emit(_ job: Job, _ total: Int) {
        let doneCount = job.pages.filter { job.done.contains($0) }.count
        updateBackgroundProgress(job, done: doneCount, total: total)
        onProgress?(job.key, doneCount, total)
    }

    private func pause(_ job: Job) {
        job.state = .paused
        job.pauseRequested = false
        let doneCount = job.pages.filter { job.done.contains($0) }.count
        endBackgroundTask(job, success: false)
        if !PdfOcrJobManager.isOnMac() {
            PdfOcrJobManager.notifyPaused(done: doneCount, total: job.pages.count)
        }
    }

    private func finish(_ job: Job, state: State, error: String?) {
        job.state = state
        job.error = error
        endBackgroundTask(job, success: state == .done)
        let doneCount = job.pages.filter { job.done.contains($0) }.count
        onProgress?(job.key, doneCount, job.pages.count)
    }

    // MARK: OCR of one page

    static func ocrPage(_ page: PDFPage, number n: Int, dpi: CGFloat) throws -> [String: Any] {
        let bounds = page.bounds(for: .mediaBox)
        let rotated = page.rotation % 180 != 0
        let ptW = rotated ? bounds.height : bounds.width
        let ptH = rotated ? bounds.width : bounds.height
        var scale = dpi / 72.0
        let longSide = max(ptW, ptH)
        if longSide > 0 && longSide * scale > 2400 { scale = 2400 / longSide }
        let size = CGSize(width: max(1, (ptW * scale).rounded()), height: max(1, (ptH * scale).rounded()))
        let image = page.thumbnail(of: size, for: .mediaBox)
        guard let cg = image.cgImage else { throw NSError(domain: "rmdod", code: 4, userInfo: [NSLocalizedDescriptionKey: "render-failed"]) }

        var lines: [String] = []
        var words: [[String: Any]] = []
        var failure: Error?
        let request = VNRecognizeTextRequest { req, err in
            if let err = err { failure = err; return }
            for obs in (req.results as? [VNRecognizedTextObservation]) ?? [] {
                guard let top = obs.topCandidates(1).first else { continue }
                lines.append(top.string)
                let s = top.string
                var idx = s.startIndex
                var any = false
                while idx < s.endIndex {
                    while idx < s.endIndex && s[idx].isWhitespace { idx = s.index(after: idx) }
                    if idx >= s.endIndex { break }
                    var end = idx
                    while end < s.endIndex && !s[end].isWhitespace { end = s.index(after: end) }
                    let range = idx..<end
                    if let box = try? top.boundingBox(for: range) {
                        let bb = box.boundingBox
                        words.append(["t": String(s[range]), "x": Double(bb.origin.x),
                                      "y": Double(1.0 - (bb.origin.y + bb.size.height)),
                                      "w": Double(bb.size.width), "h": Double(bb.size.height)])
                        any = true
                    }
                    idx = end
                }
                if !any {
                    let bb = obs.boundingBox
                    words.append(["t": s, "x": Double(bb.origin.x), "y": Double(1.0 - (bb.origin.y + bb.size.height)),
                                  "w": Double(bb.size.width), "h": Double(bb.size.height)])
                }
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
        if let f = failure { throw f }

        var tables: [[[String]]] = []
        if #available(iOS 26.0, *) {
            tables = PdfOcrJobManager.documentTables(cg)
        }
        return ["n": n, "width": Double(ptW), "height": Double(ptH), "text": lines.joined(separator: "\n"),
                "words": words, "tables": tables, "ocr": true, "coords": "normalized"]
    }

    /// Tables from Vision's document request (iOS 26+), as rows of cell strings. Best effort: any error
    /// gives no tables and the page text still stands.
    @available(iOS 26.0, *)
    static func documentTables(_ cg: CGImage) -> [[[String]]] {
        final class Box: @unchecked Sendable { var tables: [[[String]]] = [] }
        let sem = DispatchSemaphore(value: 0)
        let box = Box()
        Task.detached {
            defer { sem.signal() }
            do {
                let request = RecognizeDocumentsRequest()
                let observations = try await request.perform(on: cg)
                var found: [[[String]]] = []
                for obs in observations {
                    for table in obs.document.tables {
                        var rows: [[String]] = []
                        for row in table.rows {
                            rows.append(row.map { $0.content.text.transcript })
                        }
                        if !rows.isEmpty { found.append(rows) }
                    }
                }
                box.tables = found
            } catch {
                box.tables = []
            }
        }
        if sem.wait(timeout: .now() + 30) == .timedOut { return [] }
        return box.tables
    }

    // MARK: app state and background

    static func isOnMac() -> Bool {
        if #available(iOS 14.0, *) { return ProcessInfo.processInfo.isiOSAppOnMac }
        return false
    }

    private func observeAppState() {
        lock.lock(); let already = observing; observing = true; lock.unlock()
        if already { return }
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.appDidEnterBackground()
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.appDidBecomeActive()
        }
    }

    private func appDidEnterBackground() {
        if PdfOcrJobManager.isOnMac() { return }
        lock.lock(); let running = jobs.values.filter { $0.state == .running }; lock.unlock()
        for job in running where job.bgTask == nil {
            // No continued-processing task (older iOS, or it was denied): finish this page, then pause.
            job.pauseRequested = true
        }
    }

    private func appDidBecomeActive() {
        lock.lock(); let paused = jobs.values.filter { $0.state == .paused && !$0.cancelled }; lock.unlock()
        for job in paused {
            job.state = .running
            job.pauseRequested = false
            beginBackgroundTask(job)
            queue.async { self.run(job) }
        }
    }

    private func beginBackgroundTask(_ job: Job) {
        #if canImport(BackgroundTasks)
        if #available(iOS 26.0, *) {
            if PdfOcrJobManager.isOnMac() { return }
            let ident = PdfOcrJobManager.bgTaskPrefix + String(String(PdfOcrJobManager.safeDirName(job.key).filter { $0.isLetter || $0.isNumber }).prefix(40))
            // Registering one identifier twice raises, so each identifier is registered once per launch and
            // its handler looks the job up by key at launch time.
            lock.lock(); let fresh = !registeredIdents.contains(ident); if fresh { registeredIdents.insert(ident) }; lock.unlock()
            if fresh {
            let key = job.key
            let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: ident, using: nil) { [weak self] task in
                guard let self = self else { task.setTaskCompleted(success: false); return }
                self.lock.lock(); let job = self.jobs[key]; self.lock.unlock()
                guard let job = job, let cpt = task as? BGContinuedProcessingTask else {
                    task.setTaskCompleted(success: false); return
                }
                job.bgTask = cpt
                cpt.progress.totalUnitCount = Int64(job.pages.count)
                cpt.progress.completedUnitCount = Int64(job.pages.filter { job.done.contains($0) }.count)
                cpt.expirationHandler = { [weak job] in
                    // Expired or cancelled by the user from the system UI: finish this page, then pause.
                    job?.pauseRequested = true
                }
                if job.state != .running { self.endBackgroundTask(job, success: job.state == .done) }
            }
            _ = registered
            }
            let req = BGContinuedProcessingTaskRequest(identifier: ident, title: "Reading scanned pages",
                                                       subtitle: "Page 0 of \(job.pages.count)")
            req.strategy = .fail
            do { try BGTaskScheduler.shared.submit(req) } catch { /* denied: falls back to pause on background */ }
        }
        #endif
    }

    private func updateBackgroundProgress(_ job: Job, done: Int, total: Int) {
        #if canImport(BackgroundTasks)
        if #available(iOS 26.0, *), let cpt = job.bgTask as? BGContinuedProcessingTask {
            cpt.progress.totalUnitCount = Int64(total)
            cpt.progress.completedUnitCount = Int64(done)
            cpt.updateTitle("Reading scanned pages", subtitle: "Page \(done) of \(total)")
        }
        #endif
    }

    private func endBackgroundTask(_ job: Job, success: Bool) {
        #if canImport(BackgroundTasks)
        if #available(iOS 26.0, *), let cpt = job.bgTask as? BGContinuedProcessingTask {
            cpt.setTaskCompleted(success: success)
        }
        #endif
        job.bgTask = nil
    }

    static func notifyPaused(done: Int, total: Int) {
        let content = UNMutableNotificationContent()
        content.title = "StewardMD"
        content.body = "Paused at page \(done) of \(total). Open StewardMD to finish."
        let req = UNNotificationRequest(identifier: "rmdod-paused", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
    }
}
