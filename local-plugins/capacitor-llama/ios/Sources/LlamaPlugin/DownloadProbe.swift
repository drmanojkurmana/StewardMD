import Foundation

/**
 * DEBUG-ONLY download diagnostic. Measures three transfer shapes back to back and prints the rates,
 * so the model-download design rests on a measurement rather than a guess.
 *
 * WHY IT EXISTS: on identical Wi-Fi, in the same room, on the same 3.11 GB file, Android's
 * DownloadManager reached 10.5 MB/s while this app's background URLSession managed 1.3 MB/s - an 8x
 * gap. That says the ceiling is the iOS transfer path, but NOT which fix works:
 *
 *   A  default session, one stream        - is a foreground session actually faster here?
 *   B  background session, one stream     - reproduces the 1.3 MB/s we see in the app
 *   C  background session, 4 range tasks  - is the throttle PER TASK (so parallelism recovers it)
 *                                           or PER SESSION (so parallelism changes nothing)?
 *
 * A >> B says the background service is throttled. C ~= 4x B says the throttle is per task and a
 * chunked downloader fixes it while staying entirely inside the background session. C ~= B says it is
 * per session, parallelism is pointless, and the only lever left is a faster origin.
 *
 * Triggered by dropping Documents/maik-dlprobe into the container; the marker is deleted after use.
 * Downloads ~60 MB total via Range requests and writes nothing permanent.
 */
final class DownloadProbe: NSObject, URLSessionDownloadDelegate {

    private let url: URL
    private var started = Date()
    private var bytes: Int64 = 0
    private var outstanding = 0
    private var label = ""
    private var done: (() -> Void)?
    private let lock = NSLock()

    init(url: URL) { self.url = url; super.init() }

    private lazy var fg: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    private lazy var bg: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: "in.stewardmd.llama.probe")
        c.isDiscretionary = false
        c.allowsExpensiveNetworkAccess = true
        c.allowsConstrainedNetworkAccess = true
        c.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    private func req(_ from: Int64, _ to: Int64) -> URLRequest {
        var r = URLRequest(url: url)
        r.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range")
        return r
    }

    /// Run `count` concurrent ranged download tasks on `session`, timing until all finish.
    private func phase(_ name: String, session: URLSession, count: Int, mbEach: Int64, then: @escaping () -> Void) {
        label = name
        bytes = 0
        outstanding = count
        done = then
        started = Date()
        let span = mbEach * 1_048_576
        for i in 0..<count {
            let from = Int64(i) * span
            session.downloadTask(with: req(from, from + span - 1)).resume()
        }
    }

    func run() {
        print("[dl-probe] start - three shapes, same file, back to back")
        phase("A default session, 1 stream", session: fg, count: 1, mbEach: 20) { [weak self] in
            guard let self else { return }
            self.phase("B background session, 1 stream", session: self.bg, count: 1, mbEach: 20) {
                self.phase("C background session, 4 range tasks", session: self.bg, count: 4, mbEach: 5) {
                    print("[dl-probe] done - A>>B means background is throttled; C~=4xB means the throttle is PER TASK")
                }
            }
        }
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let n = (try? FileManager.default.attributesOfItem(atPath: location.path)[.size] as? Int64) ?? 0
        let code = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        lock.lock()
        bytes += n ?? 0
        outstanding -= 1
        let finished = outstanding <= 0
        let total = bytes, secs = Date().timeIntervalSince(started), lbl = label
        let cb = done
        lock.unlock()
        if code != 206 { print("[dl-probe] WARNING http \(code) - server ignored Range, numbers not comparable") }
        if finished {
            print(String(format: "[dl-probe] %@: %.2f MB/s (%.1f MB in %.1fs)",
                         lbl, Double(total) / 1_048_576.0 / secs, Double(total) / 1_048_576.0, secs))
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) { cb?() }
        }
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        lock.lock(); outstanding -= 1; let finished = outstanding <= 0; let lbl = label; let cb = done; lock.unlock()
        print("[dl-probe] \(lbl): task error \(error.localizedDescription)")
        if finished { DispatchQueue.global().asyncAfter(deadline: .now() + 1) { cb?() } }
    }
}
