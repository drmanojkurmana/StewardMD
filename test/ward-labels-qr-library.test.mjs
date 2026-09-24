/* The patient card / wristband QR is drawn by the SAME library as the prescription QR (owner,
 * 2026-09-24: "QR generated doesn't work, use the same mechanism we use in Prescription").
 *
 * ward-labels.js assembled its own QR matrix from hand-written primitives - the approach pglog-qr.js
 * abandoned when its codes turned out to decode on nothing. Node has no QR decoder, so, as in
 * pglog-qr.test.mjs, the reference is the vendored library itself: the drawn modules must be EXACTLY the
 * library's, so the label is precisely as scannable as the prescription.
 *
 * node --test test/ward-labels-qr-library.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const qrcode = require("../vendor/qrcode-generator.js");
const SRC = readFileSync(new URL("../ward-labels.js", import.meta.url), "utf8");
function load(withLib) {
  const sb = withLib ? { qrcode } : {};
  sb.window = sb; vm.createContext(sb); vm.runInContext(SRC, sb); return sb.WARD_LABELS;
}
/** The dark modules an SVG draws, as "x,y" (quiet zone removed). */
function drawn(svg) {
  return new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => (m[1] - 4) + "," + (m[2] - 4)));
}
function reference(text) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const s = new Set(), n = q.getModuleCount();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) s.add(x + "," + y);
  return s;
}

test("the label QR is module-for-module the library's code, for StewardIDs, MRNs and URLs", () => {
  const L = load(true);
  for (const text of ["SMP-4K7Q-2M9X7", "SMD-ABC123", "MRN-000123", "https://stewardmd.in/p?scan=SMP-4K7Q-2M9X7"]) {
    const got = drawn(L.qrSvg(text)), want = reference(text);
    assert.equal(got.size, want.size, text + ": module count");
    for (const k of want) assert.ok(got.has(k), text + ": missing module " + k);
  }
});

test("without the library it prints the number as TEXT rather than a code that scans as nothing", () => {
  const L = load(false);
  const out = L.qrSvg("SMP-4K7Q-2M9X7");
  assert.ok(!out.includes("<svg"), "no hand-assembled code is drawn");
  assert.match(out, /SMP-4K7Q-2M9X7/, "the ID is still readable on the card");
});
