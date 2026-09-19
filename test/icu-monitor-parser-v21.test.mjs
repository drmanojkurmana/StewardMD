/* test/icu-monitor-parser-v21.test.mjs — v2.1 safety rules on constructed observation graphs:
 * two-scale merge (finer split replaces a fused box only when digits agree; digit disagreement blocks
 * auto-fill), quality gate (RETAKE_PHOTO extracts nothing), field-specific thresholds, pressure source
 * required and ART / NIBP never merged, MAP only when displayed, Pulse never from HR, glued label
 * tokens, edge-truncated values, and evidence on every AUTO field. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = require("../icu-monitor-parser.js");
const box = (text, x, y, w, h, extra) => Object.assign({ text, conf: 1, x, y, w, h }, extra);

// a clean Philips-like column: HR / SpO2 / ART / RR with labels and limits
function philips() {
  return [
    box("HR", 0.57, 0.10, 0.03, 0.02), box("120", 0.57, 0.125, 0.03, 0.02), box("50", 0.57, 0.15, 0.02, 0.02), box("105", 0.62, 0.10, 0.14, 0.08),
    box("SpO2", 0.57, 0.25, 0.04, 0.02), box("100", 0.62, 0.25, 0.14, 0.08),
    box("ART", 0.57, 0.40, 0.03, 0.02), box("149/66", 0.62, 0.40, 0.20, 0.08), box("(98)", 0.68, 0.485, 0.06, 0.03),
    box("RR", 0.57, 0.60, 0.03, 0.02), box("30", 0.57, 0.625, 0.02, 0.02), box("8", 0.57, 0.65, 0.01, 0.02), box("22", 0.62, 0.60, 0.10, 0.08)
  ];
}

// A pixel source for the independent digit check: light digits (Helvetica Bold template cells) drawn on
// a dark screen inside each box. draw[text] overrides what is drawn, so pixels can say "16" where OCR said "15".
function pixels(obs, draw = {}, W = 900, H = 1600) {
  const T = M._internals.DIGIT_TEMPLATES["helvetica-bold"], buf = new Uint8Array(W * H).fill(20);
  for (const b of obs) {
    const s = (draw[b.text] != null ? draw[b.text] : b.text).replace(/\D/g, ""); if (!s) continue;
    const bw = b.w * W, bh = b.h * H, k = Math.min(0.8 * bh / 20, bw / (s.length * 22));
    const x0 = b.x * W + (bw - s.length * 22 * k) / 2, y0 = b.y * H + (bh - 20 * k) / 2;
    [...s].forEach((ch, i) => {
      const t = T[+ch];
      for (let y = 0; y < Math.ceil(20 * k); y++) for (let x = 0; x < Math.ceil(20 * k); x++) {
        if (parseInt(t[Math.min(19, Math.floor(y / k)) * 20 + Math.min(19, Math.floor(x / k))], 16) < 8) continue;
        const X = Math.round(x0 + i * 22 * k + x), Y = Math.round(y0 + y); if (X >= 0 && Y >= 0 && X < W && Y < H) buf[Y * W + X] = 235;
      }
    });
  }
  return { w: W, h: H, get: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : [buf[y * W + x], buf[y * W + x], buf[y * W + x]]) };
}

test("clean column: all six core fields AUTO with complete evidence and a source", () => {
  const r = M.parseMonitor(philips(), { px: pixels(philips()) });
  assert.deepEqual({ hr: r.values.hr, spo2: r.values.spo2, sbp: r.values.sbp, dbp: r.values.dbp, map: r.values.map, rr: r.values.rr }, { hr: 105, spo2: 100, sbp: 149, dbp: 66, map: 98, rr: 22 });
  for (const k of ["hr", "spo2", "sbp", "dbp", "map", "rr", "art"]) {
    const f = r.fields[k];
    assert.equal(f.status, "AUTO_ACCEPTED", k);
    assert.ok(f.proof && f.proof.complete, k + " evidence complete");
    assert.ok(f.proof.ocr.text && f.proof.box && f.proof.association.kind && typeof f.proof.confidence === "number" && f.proof.source, k + " evidence fields");
  }
  assert.equal(r.fields.sbp.source, "ART"); assert.deepEqual(r.fields.art.value, { s: 149, d: 66, map: 98 });
});

test("Pulse is never copied from HR; MAP is never computed", () => {
  const obs = philips().filter((b) => b.text !== "(98)");
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.pulse.value, null); assert.notEqual(r.fields.pulse.status, "AUTO_ACCEPTED");
  assert.equal(r.fields.map.value, null); assert.equal(r.fields.map.status, "NOT_FOUND");
  assert.match(r.fields.map.reason, /only ever a displayed value/);
});

test("pressure with no identifiable source → NEEDS_REVIEW (source required for AUTO)", () => {
  const obs = philips().filter((b) => b.text !== "ART");
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.sbp.status, "NEEDS_REVIEW"); assert.equal(r.fields.sbp.suggested, 149);
  assert.match(r.fields.sbp.reason, /source \(ART \/ NIBP\) not identified/);
  assert.equal(r.fields.map.status, "NEEDS_REVIEW", "MAP follows its pressure's ambiguity");
});

test("pressure source glued in the same box ('NBP 121/79 (93)') counts as the source", () => {
  const obs = philips().filter((b) => !["ART", "149/66", "(98)"].includes(b.text)).concat([box("NBP 121/79 (93)", 0.57, 0.40, 0.25, 0.08)]);
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.nibp.status, "AUTO_ACCEPTED"); assert.deepEqual(r.fields.nibp.value, { s: 121, d: 79, map: 93 });
  assert.equal(r.fields.sbp.source, "NIBP");
});

test("ART and NIBP both displayed (even the SAME numbers): never merged, primary is NEEDS_REVIEW", () => {
  const obs = philips().concat([box("NBP", 0.57, 0.52, 0.03, 0.02), box("149/66 (98)", 0.62, 0.52, 0.20, 0.07)]);
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.sbp.status, "NEEDS_REVIEW"); assert.match(r.fields.sbp.reason, /ART and NIBP are both displayed/);
  assert.equal(r.fields.art.status, "AUTO_ACCEPTED"); assert.equal(r.fields.nibp.status, "AUTO_ACCEPTED");
  assert.equal(r.fields.art.source, "ART"); assert.equal(r.fields.nibp.source, "NIBP");
});

test("merge: a fused full-pass box is replaced by the crop's finer split when digits agree (T→1 confusable)", () => {
  const full = [box("ART T18/76 (90)", 0.55, 0.40, 0.35, 0.10)];
  const crop = [box("ART", 0.55, 0.40, 0.05, 0.03, { scale: "crop" }), box("118/76 (90)", 0.62, 0.41, 0.28, 0.09, { scale: "crop" })];
  const m = M.mergeObservations(full, crop);
  assert.deepEqual(m.map((o) => o.text).sort(), ["118/76 (90)", "ART"]);
  assert.ok(m.every((o) => o.scale === "crop"));
});

test("merge: digit-vs-digit disagreement keeps the full box flagged; it can never auto-fill", () => {
  const full = philips();
  const i = full.findIndex((b) => b.text === "105");
  const crop = [box("108", full[i].x + 0.005, full[i].y, 0.13, 0.08, { scale: "crop" })];
  const m = M.mergeObservations(full, crop);
  const hrBox = m.find((o) => o.text === "105");
  assert.equal(hrBox.ocrConflict, "108");
  const r = M.parseMonitor(m);
  assert.equal(r.fields.hr.status, "NEEDS_REVIEW"); assert.match(r.fields.hr.reason, /OCR scales disagree/);
});

test("merge: crop boxes that overlap nothing are recovered (small labels)", () => {
  const full = philips().filter((b) => b.text !== "SpO2");
  const crop = [box("SpO2", 0.57, 0.25, 0.04, 0.02, { scale: "crop" })];
  const m = M.mergeObservations(full, crop);
  assert.ok(m.find((o) => o.text === "SpO2" && o.recovered));
  assert.equal(M.parseMonitor(m).fields.spo2.status, "AUTO_ACCEPTED");
});

test("monitorRegion picks the numeric column with a scale that enlarges small labels", () => {
  const reg = M.monitorRegion(philips(), { w: 900, h: 1600 });
  assert.ok(reg && reg.x < 0.57 && reg.x + reg.w > 0.82 && reg.y < 0.10 && reg.y + reg.h > 0.68, JSON.stringify(reg));
  assert.ok(reg.scale >= 2 && reg.scale <= 3);
});

test("glued secondary values: 'PR72' and '... PVC 0' read as Pulse and PVC", () => {
  const obs = philips().concat([box("PR72", 0.78, 0.26, 0.04, 0.02), box("Sinus Tach ST-I 0 ST-II 0.1 PVC 0", 0.05, 0.30, 0.25, 0.02)]);
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.pulse.status, "AUTO_ACCEPTED"); assert.equal(r.fields.pulse.value, 72); assert.equal(r.fields.pulse.proof.association.kind, "glued-label");
  assert.equal(r.fields.pvc.status, "AUTO_ACCEPTED"); assert.equal(r.fields.pvc.value, 0);
});

test("a number glued to the HR label that differs from the large HR value blocks auto-fill (likely a limit)", () => {
  const obs = philips().filter((b) => !["HR", "120"].includes(b.text)).concat([box("HR 120", 0.57, 0.10, 0.04, 0.02)]);
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.hr.status, "NEEDS_REVIEW"); assert.match(r.fields.hr.reason, /glued to the HR label \(120\) differs from the large value \(105\)/);
});

test("value touching the photo edge (possibly truncated) never auto-fills", () => {
  const obs = philips().map((b) => (b.text === "22" ? Object.assign({}, b, { x: 0.905, w: 0.095 }) : b));
  const r = M.parseMonitor(obs);
  assert.notEqual(r.fields.rr.status, "AUTO_ACCEPTED"); assert.match(r.fields.rr.reason, /touches the photo edge/);
  assert.ok(r.quality.issues.some((i) => i.kind === "partial"));
});

test("quality gate: unreadable display → RETAKE_PHOTO, nothing extracted", () => {
  const r = M.parseMonitor([box("Main Screen", 0.8, 0.95, 0.1, 0.02), box("Not Admitted", 0.2, 0.02, 0.2, 0.02)]);
  assert.equal(r.quality.status, "RETAKE_PHOTO");
  assert.deepEqual(r.values, {});
  for (const k of ["hr", "spo2", "sbp", "rr"]) { assert.equal(r.fields[k].status, "NEEDS_REVIEW"); assert.ok(r.fields[k].retake); }
});

test("quality gate: tilt from Vision quadrilaterals is INFORMATIONAL only (benchmark showed it unreliable both ways)", () => {
  const rot = (b, deg) => { const a = deg * Math.PI / 180, dy = Math.tan(a) * b.w * (900 / 1600); return Object.assign({}, b, { q: [b.x, b.y, b.x + b.w, b.y + dy, b.x + b.w, b.y + b.h + dy, b.x, b.y + b.h] }); };
  const obs = philips().map((b) => rot(Object.assign({}, b, { w: Math.max(b.w, b.h * 3) }), 24));
  const r = M.parseMonitor(obs, { imageSize: { w: 900, h: 1600 } });
  assert.ok(r.quality.issues.some((i) => i.kind === "tilt" && i.severity === "info"), "reported");
  assert.notEqual(r.quality.status, "RETAKE_PHOTO", "never decides the verdict on its own");
});

test("DEGRADED photo: a value read by only one OCR pass cannot auto-fill; a two-pass confirmed value can", () => {
  const obs = philips().map((b) => (b.text === "105" ? Object.assign({}, b, { confirmed: true, scale: "both" }) : b));
  const r = M.parseMonitor(obs, { imageSize: { w: 240, h: 240 } });
  assert.equal(r.quality.status, "DEGRADED");
  assert.equal(r.fields.hr.status, "AUTO_ACCEPTED", "confirmed by both passes");
  assert.equal(r.fields.spo2.status, "NEEDS_REVIEW"); assert.match(r.fields.spo2.reason, /not read identically by both OCR passes/);
});

test("quality gate: tiny text → RETAKE_PHOTO; moderate → DEGRADED raises thresholds", () => {
  assert.equal(M.parseMonitor(philips(), { imageSize: { w: 150, h: 150 } }).quality.status, "RETAKE_PHOTO");
  const deg = M.parseMonitor(philips(), { imageSize: { w: 240, h: 240 } });
  assert.equal(deg.quality.status, "DEGRADED");
  assert.ok(deg.fields.hr.threshold >= M.THRESH.hr.conf + 0.05 - 1e-9);
});

test("field-specific thresholds exist and are stricter for RR / Pulse / PVC than for HR", () => {
  assert.ok(M.THRESH.rr.conf > M.THRESH.hr.conf); assert.ok(M.THRESH.pulse.conf > M.THRESH.hr.conf); assert.ok(M.THRESH.pvc.conf > M.THRESH.rr.conf);
  const r = M.parseMonitor(philips(), { thresholds: { rr: { conf: 0.999 } } });
  assert.equal(r.fields.rr.status, "NEEDS_REVIEW"); assert.equal(r.fields.hr.status, "AUTO_ACCEPTED");
});

test("independent digit check: OCR 22 and pixels 22 → AUTO, with the verification in the evidence", () => {
  const r = M.parseMonitor(philips(), { px: pixels(philips()) });
  assert.equal(r.fields.rr.status, "AUTO_ACCEPTED"); assert.equal(r.fields.rr.value, 22);
  assert.equal(r.fields.rr.proof.verify.status, "verified"); assert.equal(r.fields.rr.proof.verify.read, "22");
  assert.ok(r.fields.rr.proof.complete);
});

test("independent digit check: OCR reads 15 where the pixels show 16 → NEEDS_REVIEW, suggestion stays OCR's 15 (never corrected to 16)", () => {
  const obs = philips().map((b) => (b.text === "22" ? Object.assign({}, b, { text: "15" }) : b));
  const r = M.parseMonitor(obs, { px: pixels(obs, { 15: "16" }) });
  assert.equal(r.fields.rr.status, "NEEDS_REVIEW"); assert.equal(r.fields.rr.value, null); assert.equal(r.fields.rr.suggested, 15);
  assert.equal(r.fields.rr.verify.status, "disagree"); assert.match(r.fields.rr.reason, /independent digit check reads "16", OCR read "15"/);
  assert.equal(r.fields.hr.status, "AUTO_ACCEPTED", "other fields unaffected");
});

test("independent digit check: no pixels, or nothing legible in the box → NEEDS_REVIEW (never auto-filled unverified)", () => {
  const none = M.parseMonitor(philips());
  assert.equal(none.fields.rr.status, "NEEDS_REVIEW"); assert.match(none.fields.rr.reason, /could not run: no pixels/);
  const blank = M.parseMonitor(philips(), { px: pixels(philips(), { 22: "" }) });
  assert.equal(blank.fields.rr.status, "NEEDS_REVIEW"); assert.equal(blank.fields.rr.verify.status, "unsure");
});

test("independent digit check: opts.verifyFields extends the gate to other vitals", () => {
  const obs = philips().map((b) => (b.text === "105" ? Object.assign({}, b, { text: "106" }) : b));
  const px = pixels(obs, { 106: "105" });
  assert.equal(M.parseMonitor(obs, { px }).fields.hr.status, "AUTO_ACCEPTED", "HR is not gated by default");
  const r = M.parseMonitor(obs, { px, verifyFields: ["hr", "rr"] });
  assert.equal(r.fields.hr.status, "NEEDS_REVIEW"); assert.equal(r.fields.hr.verify.status, "disagree");
});

/* ---------------------------------------------------------------- pass 3 (2026-09-15) */
// Rios-style tile: ABP read with CYRILLIC letters, PAP 26/10 (15) displayed below it.
function riosPressures(abpText = "АВP") {
  return philips().filter((b) => !["ART", "149/66", "(98)"].includes(b.text)).concat([
    box(abpText, 0.57, 0.40, 0.04, 0.02), box("129/86", 0.62, 0.42, 0.15, 0.06), box("(101)", 0.64, 0.48, 0.07, 0.04),
    box("PAP", 0.57, 0.53, 0.04, 0.02), box("26/10", 0.63, 0.55, 0.12, 0.05), box("(15)", 0.63, 0.60, 0.06, 0.04)]);
}

test("pass 3: Cyrillic look-alike 'АВP' identifies the arterial source; PAP is never SBP/DBP/MAP and never a competing reading", () => {
  const r = M.parseMonitor(riosPressures());
  assert.equal(r.fields.sbp.status, "AUTO_ACCEPTED"); assert.equal(r.values.sbp, 129); assert.equal(r.values.dbp, 86); assert.equal(r.values.map, 101);
  assert.equal(r.fields.sbp.source, "ART"); assert.deepEqual(r.fields.art.value, { s: 129, d: 86, map: 101 });
  const off = M.parseMonitor(riosPressures(), { disable: ["norm", "pap"] });
  assert.equal(off.fields.sbp.status, "NEEDS_REVIEW", "without the rules the source cannot be proven");
});

test("pass 3: a pressure whose source label is unreadable stays NEEDS_REVIEW even when PAP is identified", () => {
  const r = M.parseMonitor(riosPressures("?#"));
  assert.equal(r.fields.sbp.status, "NEEDS_REVIEW"); assert.match(r.fields.sbp.reason, /source \(ART \/ NIBP\) not identified/);
  assert.notEqual(r.values.sbp, 26, "PAP is never offered as SBP");
});

test("pass 3: one source label names only its nearest reading", () => {
  // ABP label is read, PAP label is NOT: the farther 26/10 must not inherit "ABP"
  const obs = riosPressures().filter((b) => b.text !== "PAP");
  const r = M.parseMonitor(obs);
  assert.notEqual(r.fields.art && r.fields.art.value && r.fields.art.value.s, 26);
  assert.equal(r.fields.sbp.status, "NEEDS_REVIEW", "an unlabelled second pressure keeps the primary in review");
});

test("pass 3: a small alarm limit directly left of a value is a limit, not a competing RR", () => {
  const obs = philips().filter((b) => !["30", "8"].includes(b.text)).concat([box("30", 0.605, 0.63, 0.012, 0.025)]);
  const r = M.parseMonitor(obs);
  const c30 = r.fields.rr.candidates.find((c) => c.value === 30);
  assert.ok(!c30 || c30.role === "limit", "30 is treated as a limit");
  assert.equal(M.parseMonitor(obs, { disable: ["limit1"] }).fields.rr.candidates.find((c) => c.value === 30).role, "numeric");
});

test("pass 3: a standalone 'ECG' token labels HR (Mindray-style tile)", () => {
  const obs = philips().map((b) => (b.text === "HR" ? Object.assign({}, b, { text: "ECG" }) : b));
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.hr.label.text, "ECG"); assert.equal(r.fields.hr.status, "AUTO_ACCEPTED"); assert.equal(r.values.hr, 105);
  assert.equal(M.parseMonitor(obs, { disable: ["ecg"] }).fields.hr.label, null);
});

test("pass 3: MAP consistency is a check only: displayed MAP kept, derived MAP separate, gross conflict -> NEEDS_REVIEW", () => {
  const ok = M.parseMonitor(philips());
  assert.equal(ok.values.map, 98, "displayed 98 kept although (149 + 2*66)/3 = 94");
  assert.deepEqual({ v: ok.fields.sbp.derivedMAP.value, s: ok.fields.sbp.derivedMAP.source }, { v: 94, s: "CALCULATED" });
  assert.equal(ok.fields.sbp.mapConsistency.consistent, true);
  const bad = M.parseMonitor(philips().map((b) => (b.text === "(98)" ? Object.assign({}, b, { text: "(138)" }) : b)));
  assert.equal(bad.fields.sbp.status, "NEEDS_REVIEW"); assert.equal(bad.fields.map.status, "NEEDS_REVIEW");
  assert.match(bad.fields.sbp.reason, /displayed MAP 138 inconsistent with 149\/66 \(calculated about 94\)/);
  const noMap = M.parseMonitor(philips().filter((b) => b.text !== "(98)"));
  assert.equal(noMap.values.map, undefined, "calculated MAP never fills the clinical MAP field");
  assert.equal(noMap.fields.map.status, "NOT_FOUND"); assert.equal(noMap.fields.sbp.derivedMAP.value, 94);
});

test("source safety: plain 'IBP' (a clipped 'NIBP') or an edge-clipped source label never proves ART", () => {
  const nibpTile = (lab, x) => philips().filter((b) => !["ART", "149/66", "(98)"].includes(b.text)).concat([box(lab, x, 0.40, 0.04, 0.02), box("141/79", 0.62, 0.42, 0.15, 0.06), box("(91)", 0.64, 0.48, 0.07, 0.04)]);
  for (const [lab, x] of [["IBP", 0.57], ["ART", 0.0]]) {
    const r = M.parseMonitor(nibpTile(lab, x));
    assert.notEqual(r.fields.sbp.status === "AUTO_ACCEPTED" && r.fields.sbp.source, "ART", lab + " at x=" + x + " must not auto-fill as ART");
    assert.notEqual(r.fields.art && r.fields.art.status, "AUTO_ACCEPTED");
  }
  assert.equal(M.parseMonitor(nibpTile("IBP1", 0.57)).fields.sbp.source, "ART", "a numbered IBP channel is still arterial");
  assert.equal(M.parseMonitor(nibpTile("ПІВP", 0.57)).fields.sbp.source !== "ART", true, "Cyrillic garbage around 'IBP' is not ART");
});
