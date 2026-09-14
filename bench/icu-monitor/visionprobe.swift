import Foundation
import Vision
import AppKit

// Usage: swift visionprobe.swift <image> <correction:0|1> <minTextHeight|-> [maxEdge]
// Prints one JSON object per observation: text, conf, x,y,w,h (normalized, top-left origin), hpx.
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
let sem = DispatchSemaphore(value: 0)
let req = VNRecognizeTextRequest { r, e in
  if let e = e { print("ERR \(e)"); sem.signal(); return }
  var out: [[String: Any]] = []
  for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
    guard let t = o.topCandidates(1).first else { continue }
    let b = o.boundingBox
    out.append(["text": t.string, "conf": Double(t.confidence),
                "x": Double(b.origin.x), "y": Double(1 - (b.origin.y + b.size.height)),
                "w": Double(b.size.width), "h": Double(b.size.height),
                "hpx": Double(b.size.height) * Double(H)])
  }
  let meta: [String: Any] = ["image": ["w": W, "h": H], "correction": correction, "minTextHeight": minH as Any, "n": out.count, "obs": out]
  let d = try! JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys])
  print(String(data: d, encoding: .utf8)!)
  sem.signal()
}
req.recognitionLevel = .accurate
req.usesLanguageCorrection = correction
req.recognitionLanguages = ["en-US"]
if let m = minH { req.minimumTextHeight = m }
// The Neural Engine path fails intermittently under memory pressure (CRImageReaderError.e5rtError);
// retry, and drop to .fast on the last attempt rather than lose the case.
var attempt = 0
while true {
  attempt += 1
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]); break }
  catch {
    if attempt >= 4 { FileHandle.standardError.write("vision failed after \(attempt) attempts: \(error)\n".data(using: .utf8)!); exit(3) }
    if attempt == 3 { req.recognitionLevel = .fast }
    Thread.sleep(forTimeInterval: 0.6 * Double(attempt))
  }
}
sem.wait()
