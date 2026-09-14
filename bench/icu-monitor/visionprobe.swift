import Foundation
import Vision
import AppKit

// Usage: visionprobe <image> <correction:0|1> <minTextHeight|-> [maxEdge|-] [crop=x,y,w,h] [scale=s]
// Prints one JSON object: image {w,h} (of the image Vision actually read), source {w,h}, crop (normalized
// in the source, top-left origin, or null), scale, correction, minTextHeight, level, n, obs[] with
// text, conf, x,y,w,h (normalized to the image Vision read, top-left origin), hpx (text height in that
// image's pixels) and q = [tlx,tly, trx,try, brx,bry, blx,bly] (Vision's quadrilateral, same frame),
// which carries rotation that the axis-aligned box cannot.
// Mirrors the app's VisionOcr plugin settings so bench observations match what the phone produces.
let args = CommandLine.arguments
let path = args[1]
let correction = args.count > 2 && args[2] == "1"
let minH: Float? = (args.count > 3 && args[3] != "-") ? Float(args[3]) : nil
let maxEdge: CGFloat? = (args.count > 4 && args[4] != "-" && !args[4].contains("=")) ? CGFloat(Double(args[4])!) : nil
var cropRect: [Double]? = nil
var scaleArg: Double? = nil
for a in args.dropFirst(2) {
  if a.hasPrefix("crop=") { cropRect = a.dropFirst(5).split(separator: ",").map { Double($0)! } }
  if a.hasPrefix("scale=") { scaleArg = Double(a.dropFirst(6)) }
}

guard let src = NSImage(contentsOfFile: path), var cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load\n".data(using: .utf8)!); exit(1)
}
let SW = cg.width, SH = cg.height
func resample(_ img: CGImage, _ nw: Int, _ nh: Int) -> CGImage {
  let ctx = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: nw, height: nh))
  return ctx.makeImage()!
}
if let c = cropRect, c.count == 4 {
  let r = CGRect(x: c[0] * Double(SW), y: c[1] * Double(SH), width: c[2] * Double(SW), height: c[3] * Double(SH)).integral
  if let cc = cg.cropping(to: r) { cg = cc }
}
if let s = scaleArg, s != 1 { cg = resample(cg, max(1, Int(Double(cg.width) * s)), max(1, Int(Double(cg.height) * s))) }
if let me = maxEdge {
  let w = CGFloat(cg.width), h = CGFloat(cg.height), s = me / max(w, h)
  if s != 1 { cg = resample(cg, Int(w * s), Int(h * s)) }
}
let W = cg.width, H = cg.height

// The Neural Engine path fails intermittently under memory pressure (CRImageReaderError.e5rtError),
// surfacing either as a thrown error from perform() or as the completion handler's error. Retry, then
// run the SAME .accurate recognizer on the CPU. Never drop to .fast: the phone does not use it, and its
// output ("1491F6" for 149/66) would silently corrupt the benchmark (2026-09-14). The compute path is
// reported; if every attempt fails the probe exits non-zero and the case is not scored.
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
                  "hpx": Double(b.size.height) * Double(H),
                  "q": [Double(o.topLeft.x), Double(1 - o.topLeft.y), Double(o.topRight.x), Double(1 - o.topRight.y),
                        Double(o.bottomRight.x), Double(1 - o.bottomRight.y), Double(o.bottomLeft.x), Double(1 - o.bottomLeft.y)]])
    }
    var meta: [String: Any] = ["image": ["w": W, "h": H], "source": ["w": SW, "h": SH], "correction": correction,
                               "minTextHeight": minH as Any, "level": "accurate", "compute": attempt >= 3 ? "cpu" : "default", "attempts": attempt, "n": out.count, "obs": out]
    meta["crop"] = cropRect as Any
    meta["scale"] = scaleArg as Any
    let d = try! JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys])
    output = String(data: d, encoding: .utf8)!
    sem.signal()
  }
  req.recognitionLevel = .accurate
  if attempt >= 3 { req.usesCPUOnly = true }
  req.usesLanguageCorrection = correction
  req.recognitionLanguages = ["en-US"]
  if let m = minH { req.minimumTextHeight = m }
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]); sem.wait() }
  catch { failure = "\(error)" }
  if output == nil {
    if attempt >= 6 { FileHandle.standardError.write("vision failed after \(attempt) attempts: \(failure ?? "?")\n".data(using: .utf8)!); exit(3) }
    Thread.sleep(forTimeInterval: 0.8 * Double(attempt))
  }
}
print(output!)
