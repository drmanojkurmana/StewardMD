/* test/kardiox-stemi.test.mjs — rule-based STEMI detector (SMD_KARDIOX_STEMI).
 * Tests the clinical decision logic in classify() deterministically (constructed ST/T/QRS measurement
 * maps) — every path: contiguous ST elevation + reciprocal fires; a normal tracing stays silent
 * (specificity); RBBB suppresses right-precordial secondary ST; LBBB/wide-QRS defers to a Sgarbossa
 * advisory instead of auto-diagnosing; hyperacute-T early STEMI. Plus detect()/candidate() robustness.
 * Runs headless (no ONNX). */
import { readFileSync } from "node:fs";
globalThis.window = globalThis;
new Function(readFileSync(new URL("../kardiox-stemi.js", import.meta.url), "utf8"))();
const S = globalThis.SMD_KARDIOX_STEMI;

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };
// measurement map (ST at J in mm). stJ40 defaults to st; t/qrsNet default flat; QRS 80ms.
const m = (st, o = {}) => ({ st, stJ40: o.stJ40 || st, t: o.t || {}, qrsNet: o.qrsNet || {}, qrsMs: o.qrsMs != null ? o.qrsMs : 80 });

ok("module exposes detect/candidate/classify/measure", ["detect", "candidate", "classify", "measure"].every((k) => typeof S[k] === "function"));

// 1. Inferior STEMI: >=1mm in II/III/aVF + reciprocal depression in I/aVL.
const inf = S.classify(m({ II: 2.5, III: 2.8, aVF: 2.6, I: -1.0, aVL: -1.2 }), {});
ok("inferior STEMI fires", inf.fired && /inferior/.test(inf.territory) && inf.criteria.kind === "st-elevation");
ok("inferior STEMI reports reciprocal", inf.criteria.reciprocalLeads.length >= 1);
ok("reciprocal boosts confidence (>0.7)", inf.probability > 0.7);

// 2. Anterior STEMI needs >=2mm in V2/V3.
ok("anterior STEMI (V2/V3 >=2mm) fires", S.classify(m({ V2: 2.4, V3: 2.6, V4: 1.5 }), {}).fired);
ok("sub-threshold V2/V3 (1.5mm) does NOT fire anterior", !/anter/.test(S.classify(m({ V2: 1.5, V3: 1.5 }), {}).territory || ""));

// 3. Normal / flat tracing -> silent (specificity).
ok("normal tracing does not fire", !S.classify(m({ II: 0.2, III: 0.1, aVF: 0.2, V2: 0.3, V3: 0.2 }), {}).fired);

// 4. RBBB: right-precordial ST is secondary -> suppress anteroseptal/anterior even with big V1-V3 ST.
const rb = S.classify(m({ V1: 4, V2: 4, V3: 2 }), { rbbb: 0.95 });
ok("RBBB suppresses right-precordial secondary ST", !rb.fired || !/anteroseptal|anterior/.test(rb.territory || ""));
ok("RBBB context recorded", rb.bbbContext.rbbb && rb.bbbContext.suppressed.indexOf("anteroseptal") >= 0);

// 5. LBBB / wide-QRS: defer to advisory, never auto-diagnose.
const lb = S.classify(m({ V1: -3, V2: -3, I: 2 }, { qrsMs: 140, qrsNet: { I: 5, V1: -8, V2: -8 } }), { lbbb: 0.95 });
ok("LBBB does NOT auto-fire STEMI", !lb.fired);
ok("LBBB issues Sgarbossa advisory", !!lb.advisory && lb.sgarbossa && lb.sgarbossa.applicable);

// 6. Hyperacute-T early STEMI: modest ST rising at J+40 with tall T in >=2 contiguous.
const hyper = S.classify(m({ V2: 0.6, V3: 0.7 }, { stJ40: { V2: 1.6, V3: 1.8 }, t: { V2: 10, V3: 11 } }), {});
ok("hyperacute-T early STEMI fires (supportive confidence)", hyper.fired && hyper.criteria.kind === "hyperacute-t" && hyper.probability >= 0.5 && hyper.probability < 0.7);

// 7. candidate() wraps a fired result as a fusion source; robustness on degenerate input.
let threw = false;
try { S.detect([], {}); S.detect(null, {}); S.detect(S.LEAD_ORDER.map(() => new Float64Array(10)), {}); } catch (e) { threw = true; }
ok("degenerate input never throws", !threw);
ok("detect() on no-QRS input returns not-fired", !S.detect(S.LEAD_ORDER.map(() => new Float64Array(5000)), {}).fired);

console.log(`kardiox-stemi: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
