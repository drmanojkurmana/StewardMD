// Narkē (Anaesthesia) is the second specialty-engine host: only its loader loads at boot, the loader names the engine
// then narke.js at one token, build-www ships its data and models, Home has its tile and opener, swipe-back knows it,
// and the Review Desk lists it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const read = (f) => readFileSync(f, "utf8");

test("app boot loads only narke-loader.js; the loader lists the engine then narke.js at its own token", () => {
  const html = read("index.html");
  assert.deepEqual(html.match(/narke[-.\w]*\.(js|css)\?v=\w+/g), ["narke-loader.js?v=nrk7"]);
  const L = read("narke-loader.js"), v = /var V = "(\w+)"/.exec(L)[1];
  assert.equal(v, "nrk7");
  for (const f of ["specialty.css", "narke.css", "specialty-core.js", "specialty-shell.js", "specialty-notes.js", "narke.js"]) assert.ok(L.includes('"' + f + '"'), f);
  assert.ok(L.indexOf('"specialty-notes.js"') < L.indexOf('"narke.js"'), "engine before the host");
  assert.ok(!/tokos/i.test(L), "no Tokós name in the Narkē loader");
  assert.ok(/narke\/models\.json/.test(L) && /narke-models\//.test(L));
});

test("kill switch: smd_narke=\"0\" or ?narke=0 in the loader, the host and the Home tile", () => {
  assert.ok(/smd_narke"\) !== "0"/.test(read("narke-loader.js")) && /\[\?&\]narke=/.test(read("narke-loader.js")));
  assert.ok(/flag: "smd_narke"/.test(read("narke.js")) && /models: "NARKE_MODELS"/.test(read("narke.js")));
  const h = read("home.js"), i = h.indexOf('act: "narke"');
  assert.ok(i > 0);
  const tile = h.slice(i, i + 500);
  assert.ok(/smd_narke"\) !== "0"/.test(tile) && /\[\?&\]narke=/.test(tile));
  assert.ok(/narke: function \(\) \{/.test(h) && /NARKE\.open\(\)/.test(h), "Home opener");
  assert.ok(!/defOn: false/.test(tile.slice(0, tile.indexOf("eligible"))), "ON for all (owner 2026-10-06)");
});

test("build-www.sh ships narke/ and narke-models/ and drops the build inputs", () => {
  const b = read("scripts/build-www.sh");
  assert.ok(/cp -R narke\/\./.test(b) && /cp -R narke-models\/\./.test(b));
  assert.ok(/rm -rf "\$WWW\/narke\/learn\/units"/.test(b));
});

test("swipe-back wires NARKE like TOKOS", () => {
  const s = read("swipe-back.js");
  assert.ok(/NARKE\.isOpen\(\)\) return true/.test(s));
  assert.ok(/NARKE\.back\(\) !== false/.test(s));
});

test("Review Desk: a Narkē tab whose items name Narkē and never list Tokós clinics", () => {
  const R = createRequire(import.meta.url)("../review-desk.js");
  assert.ok(/\["narke", "Narkē"\]/.test(read("review-desk.js")));
  const items = R._tokosMore({ learn: { units: [{ id: "as1", title: { en: "Anaesthesiology as a specialty" }, level: "mbbs", lessons: ["as1-a"] }], lessons: { "as1-a": {} } },
    bank: { topics: [{ id: "airway", title: { en: "Airway" }, count: 3 }] }, models: { "tool-x": { id: "tool-x", kind: "tool", title: { en: "X" }, sources: [], examples: [{}] } } }, "narke");
  assert.deepEqual(items.map((x) => x.id), ["unit-as1", "bank-airway", "tool-tool-x"]);
  assert.ok(items.every((x) => /^Narkē /.test(x.title)), items.map((x) => x.title).join(" | "));
  const tok = R._tokosMore({ learn: { units: [], lessons: {} } });
  assert.deepEqual(tok.map((x) => x.id), ["clinic-fetal-planes", "clinic-hc-biometry"], "Tokós default unchanged");
});

test("apply-reviews accepts narke decisions and targets narke/ files", async () => {
  const A = await import("../scripts/apply-reviews.mjs");
  assert.ok(A.KINDS.narke && A.KINDS.narke.dir === "narke");
  const t = A.tokosTarget("drill-cardiacarrest", "/r", () => "{}", () => true, "narke");
  assert.equal(t.files[0].file, "/r/narke/drill/cardiacarrest.json");
  assert.match(t.build, /--host narke/);
  assert.equal(A.tokosTarget("tool-asa", "/r", () => "{}", () => true, "narke").files[0].file, "/r/narke-models/tool-asa.js");
  assert.equal(A.tokosTarget("sim-labour", "/r", () => "{}", () => true, "narke"), null, "Tokós-only ids do not resolve for Narkē");
  const e = A.validateExport({ schema: 1, reviewer: { name: "Dr A" }, decisions: [{ kind: "narke", id: "unit-as1", decision: "approve", at: "2026-10-06T00:00:00Z" }] });
  assert.deepEqual(e, []);
});

// Cloudflare Pages caps a deploy at 20,000 files; the deploy was about 16,850 on 2026-10-06 (git estimate from the
// 2026-09-25 count of 14,800). Narkē's share is capped so content phases cannot push the site over.
test("Narkē stays within its 450-file budget (narke/ and narke-models/)", async () => {
  const { readdirSync, existsSync, statSync } = await import("node:fs");
  const count = (d) => !existsSync(d) ? 0 : readdirSync(d).reduce((n, f) => n + (statSync(d + "/" + f).isDirectory() ? count(d + "/" + f) : 1), 0);
  const n = count("narke") + count("narke-models");
  assert.ok(n <= 450, n + " files");
});

test("every id in narke/models.json has its narke-models file, drill-core first", async () => {
  const { existsSync } = await import("node:fs");
  const ids = JSON.parse(read("narke/models.json")).models;
  assert.equal(ids[0], "drill-core");
  for (const id of ids) assert.ok(existsSync("narke-models/" + id + ".js"), id);
});

test("Review Desk lists the Narkē clinics when the signals model is loaded; apply-reviews records them in the ledger", async () => {
  const R = createRequire(import.meta.url)("../review-desk.js");
  const ids = R._tokosMore({ models: { signals: { kind: "signals" } } }, "narke").map((x) => x.id);
  assert.deepEqual(ids, ["clinic-capno", "clinic-monitor"]);
  const A = await import("../scripts/apply-reviews.mjs");
  assert.deepEqual(A.tokosTarget("clinic-capno", "/r", () => "{}", () => true, "narke"), { files: [] });
});

test("Review Desk text: Narkē explorers list every {en, hi} they show; clinics list scene and trace before points", () => {
  const req = createRequire(import.meta.url);
  const tof = req("../narke-models/explorer-tof.js"), sig = req("../narke-models/signals.js");
  const R = req("../review-desk.js");
  globalThis.NARKE_MODELS = { tof, signals: sig };
  try {
    const rows = R._tokosMoreRows("explorer-tof", "narke");
    const want = [];
    (function walk(o, d) { if (!o || typeof o !== "object" || d > 6) return; if (typeof o.en === "string" && typeof o.hi === "string") { want.push(o.en); return; } Object.keys(o).forEach((k) => { if (typeof o[k] !== "function" && !(d === 0 && (k === "sources" || k === "subtitle"))) walk(o[k], d + 1); }); })(tof, 0);
    assert.ok(want.length > 5, "the TOF model carries bilingual text");
    const en = rows.map((r) => r[1]);
    want.forEach((t) => assert.ok(en.includes(t), t));
    assert.ok(rows.filter((r) => r[2]).length >= want.length, "Hindi kept beside each English row");
    const cap = R._tokosMoreRows("clinic-capno", "narke"), first = sig.CAPNO[Object.keys(sig.CAPNO)[0]];
    const iScene = cap.findIndex((r) => r[1] === first.scene.en), iDesc = cap.findIndex((r) => r[1] === first.describe.en), iPt = cap.findIndex((r) => r[1] === first.points[0].en);
    assert.ok(iScene >= 0 && iScene < iDesc && iDesc < iPt, [iScene, iDesc, iPt].join(","));
    assert.equal(cap[iScene][2], first.scene.hi);
  } finally { delete globalThis.NARKE_MODELS; }
});

test("apply-reviews: approving a Narkē drill rewrites a JSON the drill core still accepts, and names the narke rebuild", async () => {
  const A = await import("../scripts/apply-reviews.mjs");
  const core = createRequire(import.meta.url)("../narke-models/drill-core.js");
  const x = { schema: 1, reviewer: { name: "Dr An", regNo: "77", verified: true }, decisions: [{ kind: "narke", id: "drill-bls", decision: "approve", at: "2026-10-06T09:00:00Z" }] };
  assert.deepEqual(A.validateExport(x), []);
  const u = A.plan(x).updates.find((d) => !d.ledger);
  assert.ok(u && /narke\/drill\/bls\.json$/.test(u.file));
  assert.equal(u.build, "tools/tokos-build-drills.mjs --host narke");
  const d = JSON.parse(u.text);
  assert.equal(d.review, "reviewed");
  assert.deepEqual(core.validate(d), []);
  const bump = A.tokosBump([u.build]);
  assert.match(bump, /^Narkē content changed/);
  assert.ok(!/Tokós/.test(bump), "a Narkē drill rebuild does not ask for a Tokós bump");
});
