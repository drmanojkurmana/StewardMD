import Foundation
import CryptoKit

/// Stable, user-facing error codes shared by the model store, the engine and the JS bridge.
/// These map 1:1 to the plan's ERROR STATES. No audio, transcript or patient data is ever
/// included in a code or its detail.
enum WhisperErr: String {
    case micPermissionDenied = "mic-permission-denied"
    case modelDownloadFailed = "model-download-failed"
    case insufficientStorage = "insufficient-storage"
    case unsupportedArchitecture = "unsupported-architecture"
    case lowMemory = "low-memory"
    case recordingFailure = "recording-failure"
    case transcriptionFailure = "transcription-failure"
    case userCancelled = "user-cancelled"
    case modelCorrupted = "model-corrupted"
    case modelMissing = "model-missing"
    case badArguments = "bad-arguments"
}

struct WhisperError: Error {
    let code: WhisperErr
    let detail: String
    init(_ code: WhisperErr, _ detail: String = "") { self.code = code; self.detail = detail }
}

/// On-device model cache. Models live in Application Support/whisper/, excluded from iCloud/
/// iTunes backup (they are large and re-downloadable). NOTHING here touches audio or PHI.
final class ModelStore {

    /// Application Support/whisper (created on demand, excluded from backup).
    static func dir() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory,
                                               in: .userDomainMask, appropriateFor: nil, create: true)
        var d = base.appendingPathComponent("whisper", isDirectory: true)
        if !FileManager.default.fileExists(atPath: d.path) {
            try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        try? d.setResourceValues(rv)
        return d
    }

    /// Canonical filename for a model key, e.g. "base-q5_1" -> ggml-base-q5_1.bin
    static func fileURL(for model: String) throws -> URL {
        let safe = model.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "-", options: .regularExpression)
        guard !safe.isEmpty else { throw WhisperError(.badArguments, "empty model id") }
        return try dir().appendingPathComponent("ggml-\(safe).bin")
    }

    static func isInstalled(_ model: String) -> (installed: Bool, path: String?, bytes: Int64) {
        guard let url = try? fileURL(for: model),
              let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int64, size > 0 else {
            return (false, nil, 0)
        }
        return (true, url.path, size)
    }

    static func delete(_ model: String) {
        if let url = try? fileURL(for: model) { try? FileManager.default.removeItem(at: url) }
    }

    /// Streamed SHA-256 (1 MB chunks) so a ~60 MB model is never fully held in memory.
    static func sha256Hex(_ url: URL) -> String? {
        guard let stream = InputStream(url: url) else { return nil }
        stream.open(); defer { stream.close() }
        var hasher = SHA256()
        let cap = 1 << 20
        var buf = [UInt8](repeating: 0, count: cap)
        while stream.hasBytesAvailable {
            let n = stream.read(&buf, maxLength: cap)
            if n < 0 { return nil }
            if n == 0 { break }
            buf.withUnsafeBytes { hasher.update(bufferPointer: UnsafeRawBufferPointer(start: $0.baseAddress, count: n)) }
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Bytes available for "important" usage on the models volume.
    static func availableBytes() -> Int64 {
        if let dir = try? dir(),
           let vals = try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
           let cap = vals.volumeAvailableCapacityForImportantUsage {
            return cap
        }
        return Int64.max
    }
}

/// Downloads a model to the cache, reporting progress and verifying a PINNED SHA-256 before
/// the file is accepted. A checksum mismatch deletes the partial file and reports `modelCorrupted`.
final class ModelDownloader: NSObject, URLSessionDownloadDelegate {
    private let model: String
    private let expectedSha: String
    private let onProgress: (Double) -> Void
    private let completion: (Result<String, WhisperError>) -> Void
    private var session: URLSession!
    private var finished = false

    init(model: String, expectedSha: String,
         onProgress: @escaping (Double) -> Void,
         completion: @escaping (Result<String, WhisperError>) -> Void) {
        self.model = model
        self.expectedSha = expectedSha.lowercased()
        self.onProgress = onProgress
        self.completion = completion
        super.init()
    }

    func start(url: URL) {
        // Refuse to start if there's clearly not enough room. BUG-13: sized for the ~181 MB small.en
        // model (~2× headroom for staging + verify); the old 140 MB check under-provisioned it.
        if ModelStore.availableBytes() < 400 * 1024 * 1024 {
            finish(.failure(WhisperError(.insufficientStorage))); return
        }
        let cfg = URLSessionConfiguration.default
        cfg.allowsCellularAccess = true
        cfg.waitsForConnectivity = true
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session.downloadTask(with: url).resume()
    }

    private func finish(_ result: Result<String, WhisperError>) {
        if finished { return }; finished = true
        session?.invalidateAndCancel()
        completion(result)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress(min(1.0, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // Must move/verify synchronously inside this callback (the temp file is deleted on return).
        if let http = downloadTask.response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            finish(.failure(WhisperError(.modelDownloadFailed, "http \(http.statusCode)"))); return
        }
        guard let dest = try? ModelStore.fileURL(for: model) else {
            finish(.failure(WhisperError(.modelDownloadFailed, "no dest"))); return
        }
        let staging = dest.deletingLastPathComponent().appendingPathComponent(".\(dest.lastPathComponent).part")
        do {
            try? FileManager.default.removeItem(at: staging)
            try FileManager.default.moveItem(at: location, to: staging)
        } catch {
            finish(.failure(WhisperError(.modelDownloadFailed, "stage move"))); return
        }
        // Verify the PINNED checksum before the file is ever loaded by whisper.cpp.
        let got = ModelStore.sha256Hex(staging)?.lowercased()
        guard got == expectedSha else {
            try? FileManager.default.removeItem(at: staging)
            finish(.failure(WhisperError(.modelCorrupted, "sha mismatch"))); return
        }
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: staging, to: dest)
            var rv = URLResourceValues(); rv.isExcludedFromBackup = true
            var d = dest; try? d.setResourceValues(rv)
        } catch {
            finish(.failure(WhisperError(.modelDownloadFailed, "finalize"))); return
        }
        onProgress(1.0)
        finish(.success(dest.path))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { finish(.failure(WhisperError(.modelDownloadFailed, (error as NSError).domain))) }
    }
}
