/* remote-media.js path mapping and tools/upload-app-media.mjs file list (owner 2026-11-12: lessons, lesson diagrams and
 * CliniX photos from R2 on first view, signed-in only). The R2 key, the server route and the loader must agree.
 *   node --test test/remote-media.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const RM = require("../remote-media.js");
const { listFiles, SOURCES } = await import("../tools/upload-app-media.mjs");
const bank = await import("../functions/api/prep/bank/[[path]].js");
const gated = (p) => /^v\d{1,3}\/lessons\/media\//.test(p) || /^app\//.test(p);

test("bundle paths map to app/<same path> only when the bundle leaves them out", () => {
  for (const s of ["/clinix/media/practicals/a-b.webp", "/clinix/media/skills/s_k.webp", "/prep/lessons/media/x-y.svg", "capacitor://localhost/clinix/media/practicals/a-b.webp"]) {
    const k = RM.key(s, { remoteBundle: true, isGated: gated });
    assert.match(k, /^app\/(?:clinix|prep)\//, s);
    assert.equal(RM.key(s, { remoteBundle: false, isGated: gated }), null, s + " stays local while bundled");
  }
});

test("gated bank pictures are claimed (signature dropped), public ones and other images are left alone", () => {
  assert.equal(RM.key("https://stewardmd.in/api/prep/bank/v1/lessons/media/x-y.webp?s=1&exp=2&sig=3", { isGated: gated }), "v1/lessons/media/x-y.webp");
  for (const s of ["/api/prep/bank/v1/kb/media/x-y.webp", "/clinix-logo.png", "blob:abc", "data:image/png;base64,AA", "/clinix/media/../secret.webp", "/api/prep/bank/v1/lessons/media/../../x.webp"]) {
    assert.equal(RM.key(s, { remoteBundle: true, isGated: gated }), null, s);
  }
});

test("every file the upload sends has a route the server answers", () => {
  const www = fs.mkdtempSync(path.join(os.tmpdir(), "rm-"));
  for (const s of SOURCES) fs.mkdirSync(path.join(www, s.dir), { recursive: true });
  fs.writeFileSync(path.join(www, "prep/lessons/v1/index.json"), "{}");
  fs.writeFileSync(path.join(www, "prep/lessons/v1/ana-axilla.json"), "{}");
  fs.writeFileSync(path.join(www, "prep/lessons/media/ana-abduction-phases.svg"), "<svg/>");
  fs.writeFileSync(path.join(www, "prep/lessons/media/ATTRIBUTION.md"), "x");
  fs.writeFileSync(path.join(www, "clinix/media/practicals/obg-ins-veress-needle.webp"), "x");
  fs.writeFileSync(path.join(www, "clinix/media/skills/skill-exam-surg-gastric_outlet_obstruction.webp"), "x");
  const files = listFiles(www);
  assert.deepEqual(files.map((f) => f.rel).sort(), ["clinix/media/practicals/obg-ins-veress-needle.webp", "clinix/media/skills/skill-exam-surg-gastric_outlet_obstruction.webp", "prep/lessons/media/ana-abduction-phases.svg", "prep/lessons/v1/ana-axilla.json"]);
  for (const f of files) {
    assert.equal(f.key, "prep-bank/app/" + f.rel);
    assert.equal(bank.bankPath({ path: ("app/" + f.rel).split("/") }), "app/" + f.rel, f.rel);
  }
});

test("the real repo content all passes the server route (no file would be refused after upload)", () => {
  const bad = [];
  for (const s of SOURCES) {
    for (const f of fs.readdirSync(new URL("../" + s.dir + "/", import.meta.url))) {
      if ((s.skip && s.skip.test(f)) || !/\.(?:json|svg|webp)$/.test(f)) continue;
      if (!bank.bankPath({ path: ("app/" + s.dir + "/" + f).split("/") })) bad.push(s.dir + "/" + f);
    }
  }
  assert.deepEqual(bad, []);
});
