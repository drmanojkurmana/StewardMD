// PrepNucleus image de-identification: audit (every image the app reaches must be in the manifest), manifest shape,
// and the pixel tool's selftest (synthetic scan with a fake name, date and R marker) when Python + OpenCV exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collect, overlaysFromApp, enumerate, audit } from "../tools/prep-deid-audit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("collect resolves bare names and finds stacks, skips data and remote URLs", () => {
  const imgs = [], stacks = [];
  collect({ steps: [{ vis: { src: "v1/lessons/media/a.webp", pair: { src: "b.webp" } } }, { img: ["data:image/png;base64,x", "https://x/y.png"] }],
    stack: { base: "v11/x/stack/s-1/" } }, (s) => (s.includes("/") ? s : "v1/lessons/media/" + s), (s) => imgs.push(s), (b) => stacks.push(b));
  assert.deepEqual(imgs, ["v1/lessons/media/a.webp", "v1/lessons/media/b.webp"]);
  assert.deepEqual(stacks, ["v11/x/stack/s-1/"]);
});

test("overlay sets are read from prep.js as the app has them", () => {
  const o = overlaysFromApp(fs.readFileSync(path.join(ROOT, "prep.js"), "utf8"));
  assert.ok(Array.isArray(o.radiology) && o.radiology.length >= 1);
});

const FIX = {
  "v1/lessons/index.json": { modules: { a: { r: 2 }, b: {} } },
  "v2/lessons/a.json": { steps: [{ vis: { src: "v1/lessons/media/scan-dn1.webp" } }] },
  "v1/lessons/b.json": { steps: [{ vis: { src: "v1/lessons/media/new.webp" } }, { vis: { src: "v1/lessons/media/x-ai1.webp" } }] },
  "v9/sub/mcq/m1.json": { items: [{ id: "1", img: ["v9/sub/img/i-1.webp"] }, { id: "2", stack: { base: "v9/sub/stack/s-1/" } }] },
  "overlay/set2/sub/m1.json": { items: [{ id: "3", img: ["rn-1.webp"] }] },
  "v5/pyq/index.json": { file: "items-00000000.json" },
  "v5/pyq/items-00000000.json": { items: { p1: { id: "p1", img: ["p1.webp"] } } },
};
const TAX = { branches: [{ subjects: [{ id: "sub", bv: "v9", sections: [{ modules: [{ id: "m1" }] }] }] }] };

test("audit fails on an image missing from the manifest and passes generated drawings", async () => {
  const found = await enumerate(async (p) => FIX[p] || null, { taxonomy: TAX, overlays: { sub: ["set2"] } });
  assert.deepEqual([...found.images.keys()].sort(), ["img/set/rn-1.webp", "v1/lessons/media/new.webp", "v1/lessons/media/scan-dn1.webp",
    "v1/lessons/media/x-ai1.webp", "v5/pyq/img/p1.webp", "v9/sub/img/i-1.webp"]);
  const man = { images: { "v1/lessons/media/scan-dn1.webp": "cleaned", "v9/sub/img/i-1.webp": "clean", "img/set/rn-1.webp": "cleaned", "v5/pyq/img/p1.webp": "clean" },
    stacks: { "v9/sub/stack/s-1/": "clean" }, generated: ["-ai\\d+\\.webp$"] };
  const r = audit(found, man);
  assert.deepEqual(r.missing.map((m) => m.path), ["v1/lessons/media/new.webp"]);
  man.images["v1/lessons/media/new.webp"] = "pending";
  assert.equal(audit(found, man).missing[0].status, "pending");
  man.images["v1/lessons/media/new.webp"] = "clean";
  assert.equal(audit(found, man).missing.length, 0);
});

test("manifest shape (when present)", () => {
  const p = path.join(ROOT, "tools/prep-deid/manifest.json");
  if (!fs.existsSync(p)) return;
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(m.v, 1);
  for (const [k, v] of Object.entries(m.images)) {
    assert.match(k, /^(v\d+\/|img\/)[a-z0-9/_-]+\.(webp|svg|png)$/, k);
    assert.ok(["clean", "cleaned", "drawing"].includes(v), k + " " + v);
  }
  for (const r of m.generated || []) new RegExp(r);
});

// The pixel tool needs Pillow + numpy + OpenCV (+ tesseract); CI may not have them: skip there.
const PY = process.env.PREP_DEID_PY || "python3";
const hasPy = spawnSync(PY, ["-c", "import cv2, numpy, PIL"], { encoding: "utf8" }).status === 0 && spawnSync("tesseract", ["--version"]).status === 0;
test("selftest: fake name, date and R marker are removed, lesion and arrow kept, no metadata", { skip: !hasPy && "python3 with cv2/numpy/Pillow + tesseract not available" }, () => {
  const r = spawnSync(PY, [path.join(ROOT, "tools/prep-deid.py"), "selftest"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepEqual(out.problems, []);
  assert.equal(r.status, 0);
});
