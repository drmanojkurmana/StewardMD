import Foundation
import Vision
import AppKit

// Usage: visionprobe <image> <correction:0|1> <minTextHeight|-> [maxEdge]
// Prints one JSON object: image {w,h}, correction, minTextHeight, n, obs[] with text, conf,
// x,y,w,h (normalized, top-left origin) and hpx (text height in pixels). Mirrors the app's VisionOcr
// plugin settings so bench observations match what the phone produces. maxEdge rescales (up or down).
let args = CommandLine.arguments
let path = args[1]
let correction = args.count > 2 && args[2] == "1"
let minH: Float? = (args.count > 3 && args[3] != "-") ? Float(args[3]) : nil
let maxEdge: CGFloat? = args.count > 4 ? CGFloat(Double(args[4])!) : nil

guard let src = NSImage(contentsOfFile: path), var cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load\n".data(using: .utf8)!); exit(1)
}
if let me = maxEdge {
  let w = CGFloat(cg.width), h = CGFloat(cg.height), s = me / max(w, h)
  if s != 1 {
    let nw = Int(w * s), nh = Int(h * s)
    let ctx = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: nw, height: nh))
    cg = ctx.makeImage()!
  }
}
let W = cg.width, H = cg.height

// The Neural Engine path fails intermittently under memory pressure (CRImageReaderError.e5rtError),
// surfacing either as a thrown error from perform() or as the completion handler's error. Retry both
// ways, dropping to .fast on the last attempts rather than lose the case.
var attempt = 0
var output: String? = nil
while output == nil {
  attempt += 1
  let sem = DispatchSemaphore(value: 0)
  var failure: String? = nil
  let req = VNRecognizeTextRequest { r, e in
    if let e = e { failure = "\(e)"; sem.signal(); return }
    var out: [[String: Any]] = []
    for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
      guard let t = o.topCandidates(1).first else { continue }
      let b = o.boundingBox
      out.append(["text": t.string, "conf": Double(t.confidence),
                  "x": Double(b.origin.x), "y": Double(1 - (b.origin.y + b.size.height)),
                  "w": Double(b.size.width), "h": Double(b.size.height),
                  "hpx": Double(b.size.height) * Double(H)])
    }
    let meta: [String: Any] = ["image": ["w": W, "h": H], "correction": correction, "minTextHeight": minH as Any, "level": attempt >= 3 ? "fast" : "accurate", "n": out.count, "obs": out]
    let d = try! JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys])
    output = String(data: d, encoding: .utf8)!
    sem.signal()
  }
  req.recognitionLevel = attempt >= 3 ? .fast : .accurate
  req.usesLanguageCorrection = correction
  req.recognitionLanguages = ["en-US"]
  if let m = minH { req.minimumTextHeight = m }
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]); sem.wait() }
  catch { failure = "\(error)" }
  if output == nil {
    if attempt >= 4 { FileHandle.standardError.write("vision failed after \(attempt) attempts: \(failure ?? "?")\n".data(using: .utf8)!); exit(3) }
    Thread.sleep(forTimeInterval: 0.6 * Double(attempt))
  }
}
print(output!)
