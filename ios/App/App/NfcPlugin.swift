import Foundation
import Capacitor
import CoreNFC

/**
 * Ni-Key NFC for the iPhone app, exposed to JS as `Capacitor.Plugins.NfcPlugin` (the same name and
 * contract smd-nfc.js already drives on Android).
 *
 *   isAvailable()          -> { available, enabled, onDemand: true }
 *   startScan()            -> opens the system NFC sheet for ONE tag; emits "tagDiscovered"
 *                             { uid, formattedUid, text, url, records, timestamp }
 *   stopScan()             -> closes the sheet
 *   writeTag({ text, url }) -> Text record + URI record, then a read-back:
 *                             { success, uid, text, url, verified, readBack: { text, url } }
 *   cancelWrite()          -> closes a pending write
 *   "scanEnded"            -> { reason: "tag" | "cancelled" | "timeout" | "error", message }
 *
 * iOS has no background reader mode: every startScan / writeTag shows the system sheet, which reads
 * one tag and closes. It uses NFCTagReaderSession (not NFCNDEFReaderSession) for reads too, because
 * only a tag session exposes the chip serial; smd-nfc.js needs it to tell a blank tag apart from a
 * written one (isEmptyTag) and to show it on the empty-tag sheet, exactly as on Android.
 *
 * All state lives on the main queue (the session's delegate queue is .main).
 * Android twin: android/app/src/main/java/in/stewardmd/app/NfcPlugin.java.
 */
@objc(NfcPlugin)
public class NfcPlugin: CAPPlugin, CAPBridgedPlugin, NFCTagReaderSessionDelegate {
    public let identifier = "NfcPlugin"
    public let jsName = "NfcPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeTag", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private var session: NFCTagReaderSession?
    private var writeCall: CAPPluginCall?
    private var writeText = ""
    private var writeUrl = ""

    @objc func isAvailable(_ call: CAPPluginCall) {
        let ok = NFCTagReaderSession.readingAvailable
        call.resolve(["available": ok, "enabled": ok, "onDemand": true])
    }

    // iPhone NFC has no on/off switch in Settings, so there is nothing to open.
    @objc func openSettings(_ call: CAPPluginCall) {
        call.reject("iPhone NFC is always on; there is no NFC setting to open.", "UNAVAILABLE")
    }

    @objc func startScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard NFCTagReaderSession.readingAvailable else {
                call.reject("NFC is not supported on this iPhone.", "UNSUPPORTED")
                return
            }
            self.closeSession(rejectingWrite: "Replaced by a new NFC scan.")
            self.begin(alert: "Hold the Ni-Key tag near the top of the iPhone.")
            call.resolve(["status": "listening"])
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.closeSession(rejectingWrite: "Scan stopped.")
            call.resolve(["status": "stopped"])
        }
    }

    @objc func cancelWrite(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.closeSession(rejectingWrite: "Write cancelled by user.")
            call.resolve(["status": "cancelled"])
        }
    }

    @objc func writeTag(_ call: CAPPluginCall) {
        let text = (call.getString("text") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let url = (call.getString("url") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty && url.isEmpty {
            call.reject("No content provided to write to NFC tag.")
            return
        }
        DispatchQueue.main.async {
            guard NFCTagReaderSession.readingAvailable else {
                call.reject("NFC is not supported on this iPhone.", "UNSUPPORTED")
                return
            }
            self.closeSession(rejectingWrite: "Replaced by new write request.")
            self.writeCall = call
            self.writeText = text
            self.writeUrl = url
            self.begin(alert: "Hold the blank Ni-Key tag near the top of the iPhone to write it.")
        }
    }

    // MARK: - Session

    private func begin(alert: String) {
        // Failable in Swift (nil when the polling option is not supported on this device).
        guard let s = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693], delegate: self, queue: .main) else {
            notifyListeners("scanEnded", data: ["reason": "error", "message": "NFC is not supported on this iPhone."])
            if let call = writeCall {
                writeCall = nil
                call.reject("NFC is not supported on this iPhone.", "UNSUPPORTED")
            }
            return
        }
        s.alertMessage = alert
        session = s
        s.begin()
    }

    /// Ends the current sheet without reporting it as a failure. A pending write is rejected.
    private func closeSession(rejectingWrite reason: String?) {
        if let call = writeCall, let reason = reason {
            writeCall = nil
            call.reject(reason, "CANCELLED")
        }
        if let s = session {
            session = nil
            s.invalidate()
        }
    }

    /// Success: show the sheet's tick with `message`, then close it.
    private func finish(_ s: NFCTagReaderSession, message: String) {
        guard s === session else { return }
        session = nil
        s.alertMessage = message
        s.invalidate()
        notifyListeners("scanEnded", data: ["reason": "tag", "message": ""])
    }

    /// Failure inside an open session: the sheet shows `message`, a pending write rejects with it.
    private func fail(_ s: NFCTagReaderSession, _ message: String, code: String = "NFC_ERROR") {
        guard s === session else { return }
        session = nil
        if let call = writeCall {
            writeCall = nil
            call.reject(message, code)
        }
        s.invalidate(errorMessage: message)
        notifyListeners("scanEnded", data: ["reason": "error", "message": message])
    }

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        // A session this plugin already closed (finish / fail / closeSession) is not current any more.
        guard session === self.session else { return }
        self.session = nil
        let code = (error as? NFCReaderError)?.code
        let reason: String
        let message: String
        switch code {
        case .some(.readerSessionInvalidationErrorUserCanceled):
            reason = "cancelled"; message = "NFC scan cancelled."
        case .some(.readerSessionInvalidationErrorSessionTimeout):
            reason = "timeout"; message = "NFC timed out waiting for a tag."
        default:
            reason = "error"; message = error.localizedDescription
        }
        if let call = writeCall {
            writeCall = nil
            call.reject(message, reason == "cancelled" ? "CANCELLED" : "NFC_ERROR")
        }
        notifyListeners("scanEnded", data: ["reason": reason, "message": message])
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard session === self.session, let tag = tags.first else { return }
        if tags.count > 1 {
            session.alertMessage = "More than one tag found. Hold just one Ni-Key tag."
            session.restartPolling()
            return
        }
        session.connect(to: tag) { [weak self] error in
            guard let self = self else { return }
            if error != nil {
                self.fail(session, "Could not connect to the tag. Hold it still and try again.")
                return
            }
            guard let (ndef, serial) = NfcPlugin.ndefTag(tag) else {
                self.fail(session, "This tag type is not supported.", code: "UNSUPPORTED_TAG")
                return
            }
            if self.writeCall != nil {
                self.write(ndef, serial: serial, session: session)
            } else {
                self.read(ndef, serial: serial, session: session)
            }
        }
    }

    // MARK: - Read

    private func read(_ ndef: NFCNDEFTag, serial: Data, session s: NFCTagReaderSession) {
        ndef.queryNDEFStatus { [weak self] status, _, error in
            guard let self = self else { return }
            if error != nil || status == .notSupported {
                // Unformatted chip: still a tag tap. JS sees text == uid and treats it as blank.
                self.emitTag(serial: serial, message: nil)
                self.finish(s, message: "Ni-Key tag read.")
                return
            }
            ndef.readNDEF { message, _ in
                // A blank NDEF tag fails with a zero-length-message error; that is an empty tag, not a failure.
                self.emitTag(serial: serial, message: message)
                self.finish(s, message: "Ni-Key tag read.")
            }
        }
    }

    private func emitTag(serial: Data, message: NFCNDEFMessage?) {
        let parsed = NfcPlugin.parse(message)
        let uid = NfcPlugin.hex(serial, separator: "")
        notifyListeners("tagDiscovered", data: [
            "uid": uid,
            "formattedUid": NfcPlugin.hex(serial, separator: ":"),
            // Same as Android: the chip serial stands in for text when the tag holds no text record.
            "text": parsed.text.isEmpty ? uid : parsed.text,
            "url": parsed.url,
            "records": parsed.records,
            "timestamp": Int(Date().timeIntervalSince1970 * 1000)
        ])
    }

    // MARK: - Write (WRITE -> READ BACK -> COMPARE -> REPORT)

    private func write(_ ndef: NFCNDEFTag, serial: Data, session s: NFCTagReaderSession) {
        var records: [NFCNDEFPayload] = []
        if !writeText.isEmpty, let p = NFCNDEFPayload.wellKnownTypeTextPayload(string: writeText, locale: Locale(identifier: "en")) {
            records.append(p)
        }
        if !writeUrl.isEmpty, let u = URL(string: writeUrl), let p = NFCNDEFPayload.wellKnownTypeURIPayload(url: u) {
            records.append(p)
        }
        if records.isEmpty {
            fail(s, "No content provided to write to NFC tag.")
            return
        }
        let message = NFCNDEFMessage(records: records)
        ndef.queryNDEFStatus { [weak self] status, capacity, error in
            guard let self = self else { return }
            if error != nil {
                self.fail(s, "Could not read the tag before writing. Try again.")
                return
            }
            switch status {
            case .notSupported:
                self.fail(s, "This tag is not NDEF formatted. Use an NTAG Ni-Key tag.", code: "UNSUPPORTED_TAG")
                return
            case .readOnly:
                self.fail(s, "NFC tag is read-only.", code: "READ_ONLY")
                return
            default:
                break
            }
            if message.length > capacity {
                self.fail(s, "Tag capacity too small: \(capacity) bytes (requires \(message.length) bytes).", code: "TOO_SMALL")
                return
            }
            ndef.writeNDEF(message) { error in
                if let error = error {
                    self.fail(s, "Could not write tag: \(error.localizedDescription)")
                    return
                }
                ndef.readNDEF { back, _ in
                    let rb = NfcPlugin.parse(back)
                    let verified = rb.text == self.writeText && (self.writeUrl.isEmpty || rb.url == self.writeUrl)
                    let uid = NfcPlugin.hex(serial, separator: "")
                    var res: [String: Any] = [
                        "success": true,
                        "uid": uid,
                        "text": self.writeText,
                        "verified": verified,
                        "readBack": ["text": rb.text, "url": rb.url]
                    ]
                    if !self.writeUrl.isEmpty { res["url"] = self.writeUrl }
                    if let call = self.writeCall {
                        self.writeCall = nil
                        call.resolve(res)
                    }
                    self.notifyListeners("tagWritten", data: res)
                    self.finish(s, message: verified ? "NFC Tag Written!" : "Written, but the read-back did not match. Try again.")
                }
            }
        }
    }

    // MARK: - Helpers

    private static func ndefTag(_ tag: NFCTag) -> (NFCNDEFTag, Data)? {
        switch tag {
        case .miFare(let t): return (t, t.identifier)
        case .iso7816(let t): return (t, t.identifier)
        case .iso15693(let t): return (t, t.identifier)
        case .feliCa(let t): return (t, t.currentIDm)
        @unknown default: return nil
        }
    }

    private static func parse(_ message: NFCNDEFMessage?) -> (text: String, url: String, records: [[String: Any]]) {
        var text = ""
        var url = ""
        var records: [[String: Any]] = []
        for p in message?.records ?? [] {
            let type = String(data: p.type, encoding: .ascii) ?? ""
            var rec: [String: Any] = ["tnf": Int(p.typeNameFormat.rawValue), "type": type]
            if p.typeNameFormat == .nfcWellKnown && type == "T" {
                let (t, _) = p.wellKnownTypeTextPayload()
                if let t = t {
                    rec["text"] = t
                    if text.isEmpty && !t.isEmpty { text = t }
                }
            } else if p.typeNameFormat == .nfcWellKnown && type == "U" {
                if let u = p.wellKnownTypeURIPayload()?.absoluteString {
                    rec["uri"] = u
                    if url.isEmpty { url = u }
                }
            }
            records.append(rec)
        }
        return (text, url, records)
    }

    private static func hex(_ data: Data, separator: String) -> String {
        return data.map { String(format: "%02X", $0) }.joined(separator: separator)
    }
}
