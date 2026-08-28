import Foundation
// Simulates whisper.cpp splitting "హలో" (e0 b0 b9 | e0 b0 b2 e0 b1 8b) across a segment boundary
// mid-character, exactly as measured: segment 0 ends with e0 b0, segment 1 starts with bare b9.
let seg0: [UInt8] = [0xe0, 0xb0]
let seg1: [UInt8] = [0xb9, 0xe0, 0xb0, 0xb2, 0xe0, 0xb1, 0x8b]

// OLD: decode each segment separately (repairing initialiser) -> U+FFFD on both halves.
let old = String(decoding: seg0, as: UTF8.self) + String(decoding: seg1, as: UTF8.self)
// NEW: concatenate raw bytes, decode once.
let new = String(decoding: seg0 + seg1, as: UTF8.self)

let fffd = Character("\u{FFFD}")
assert(old.contains(fffd), "expected the old per-segment decode to corrupt")
assert(!new.contains(fffd), "new decode must not corrupt")
assert(new == "హలో", "expected హలో, got \(new)")
print("old per-segment :", old, "(U+FFFD count \(old.filter { $0 == fffd }.count))")
print("new single-decode:", new, "OK")
