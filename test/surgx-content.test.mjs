import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../surgx-model.js";
import EVMOD from "../surgx-evidence.js";
import DIA from "../surgx-diagrams.js";

/* Loads the REAL shipped JSON and validates it against the same model the app renders with, so an
 * authoring mistake fails here rather than rendering an empty band on someone's phone at 3am.
 * This is the test the 1,041-lesson kardiox content pack never had. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, "surgx", p), "utf8"));

const manifest = read("manifest.json");
const overlay = read("protocols/engine-overlay.json");
const media = read("media/manifest.json");
const evidence = read("evidence/index.json");

const AUTHORED = manifest.protocols.filter((p) => p.kind === "authored");
const ENGINE = manifest.protocols.filter((p) => p.kind === "engine");

/* ── manifest ─────────────────────────────────────────────────────────────── */

test("manifest: every referenced file exists", () => {
  const files = []
    .concat(AUTHORED.map((p) => p.file))
    .concat(manifest.stepPacks.map((p) => p.file))
    .concat(manifest.procedures.map((p) => p.file))
    .concat(manifest.cases.map((c) => c.file));
  for (const f of files) {
    assert.ok(existsSync(join(ROOT, "surgx", f)), "missing content file: " + f);
  }
});

test("manifest: ids are unique across each collection", () => {
  const dup = (arr) => {
    const seen = {}, out = [];
    arr.forEach((x) => { if (seen[x]) out.push(x); seen[x] = 1; });
    return out;
  };
  assert.deepEqual(dup(manifest.protocols.map((p) => p.id)), []);
  assert.deepEqual(dup(manifest.procedures.map((p) => p.id)), []);
  assert.deepEqual(dup(manifest.cases.map((c) => c.id)), []);
  assert.deepEqual(dup(manifest.stepPacks.map((p) => p.id)), []);
});

test("manifest: carries a contentVersion, which is what the loader keys its cache-bust on", () => {
  assert.ok(typeof manifest.contentVersion === "string" && manifest.contentVersion.length > 0);
});

/* ── the ws-surgery.js seam: no duplication, and no dead rows ─────────────── */

// Load the real engine the way the browser does: it registers onto a global.
function loadEngine() {
  const g = globalThis;
  const prev = g.window;
  g.window = g;
  delete g.SMD_WS_ENGINES;
  const code = readFileSync(join(ROOT, "ws-surgery.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function(code)();
  const eng = g.SMD_WS_ENGINES && g.SMD_WS_ENGINES.surgery;
  if (prev === undefined) delete g.window; else g.window = prev;
  return eng;
}
const engine = loadEngine();

test("engine: ws-surgery.js still registers a surgery engine with syndromes", () => {
  assert.ok(engine, "window.SMD_WS_ENGINES.surgery must exist");
  assert.ok(Array.isArray(engine.syndromes) && engine.syndromes.length > 0);
});

test("engine: every engine protocol in the manifest exists in ws-surgery.js", () => {
  const ids = engine.syndromes.map((s) => s.id);
  for (const p of ENGINE) {
    assert.ok(ids.indexOf(p.id) >= 0, "manifest lists engine protocol '" + p.id + "' that ws-surgery.js does not define");
  }
});

test("engine: every ws-surgery syndrome is surfaced by SURGX, so none is silently lost", () => {
  const listed = ENGINE.map((p) => p.id);
  for (const s of engine.syndromes) {
    assert.ok(listed.indexOf(s.id) >= 0, "ws-surgery.js defines '" + s.id + "' but SURGX does not list it");
  }
});

test("engine overlay: every overlay key names a real syndrome, and every syndrome has an overlay", () => {
  const ids = engine.syndromes.map((s) => s.id);
  Object.keys(overlay.syndromes).forEach((k) => {
    assert.ok(ids.indexOf(k) >= 0, "overlay for unknown syndrome: " + k);
  });
  ids.forEach((id) => {
    assert.ok(overlay.syndromes[id], "syndrome '" + id + "' has no provenance overlay - it would render unsourced");
  });
});

test("engine overlay: every overlay carries at least one real source", () => {
  Object.keys(overlay.syndromes).forEach((k) => {
    const o = overlay.syndromes[k];
    assert.ok(Array.isArray(o.sources) && o.sources.length, k + " has no sources");
    o.sources.forEach((s) => assert.ok(M.isSource(s), k + " has an unusable source: " + JSON.stringify(s)));
  });
});

test("engine projection: every syndrome compiles to the seven-band spine, in both states", () => {
  const NOSEL = { has: () => false };
  for (const s of engine.syndromes) {
    const o = overlay.syndromes[s.id] || null;
    const calm = M.compileEngineProtocol(s, NOSEL, o, { allowDraft: true });
    assert.ok(calm, s.id + " must compile");
    assert.deepEqual(calm.bands.map((b) => b.band), M.BAND_IDS, s.id + " band order");
    assert.ok(calm.title, s.id + " must have a title");
    // Every danger sign selected: the emergency path must also compile.
    const ALL = { has: () => true };
    const hot = M.compileEngineProtocol(s, ALL, o, { allowDraft: true });
    assert.ok(hot, s.id + " must compile with everything selected");
    assert.deepEqual(hot.bands.map((b) => b.band), M.BAND_IDS);
  }
});

test("PARITY: the projection reproduces the engine's own emergency flag and ladder exactly", () => {
  // The point of projecting rather than re-authoring: parity is structural. This asserts it for
  // every syndrome, in both the empty and the all-danger-signs-selected state.
  const states = [
    { name: "no findings", sel: { has: () => false } },
    { name: "all findings", sel: { has: () => true } }
  ];
  for (const s of engine.syndromes) {
    for (const st of states) {
      let direct = {};
      try { direct = s.assess(st.sel) || {}; } catch (e) { direct = {}; }
      const proj = M.compileEngineProtocol(s, st.sel, overlay.syndromes[s.id] || null, { allowDraft: true });
      assert.equal(proj.emergency, !!direct.emergency, s.id + " / " + st.name + ": emergency flag");
      assert.equal(proj.ladder, typeof direct.ladder === "number" ? direct.ladder : null, s.id + " / " + st.name + ": ladder");
      assert.equal(proj.headline, direct.catg || "", s.id + " / " + st.name + ": headline");
      // Source control and referral must be carried through WHOLE and unmodified.
      const def = proj.bands.find((b) => b.band === "definitive").items.map((i) => i.text);
      const esc = proj.bands.find((b) => b.band === "escalate").items.map((i) => i.text);
      if (direct.sc) assert.ok(def.indexOf(direct.sc) >= 0, s.id + " / " + st.name + ": source control text must be verbatim");
      if (direct.ref) assert.ok(esc.indexOf(direct.ref) >= 0, s.id + " / " + st.name + ": referral text must be verbatim");
      // Clinical notes must be carried whole, not scattered by keyword.
      assert.deepEqual(proj.notes, (direct.mgmt || []).map(String), s.id + " / " + st.name + ": mgmt notes");
    }
  }
});

test("PARITY: the projection never invents an antibiotic the engine did not give", () => {
  const ALL = { has: () => true };
  for (const s of engine.syndromes) {
    let direct = {};
    try { direct = s.assess(ALL) || {}; } catch (e) { direct = {}; }
    const proj = M.compileEngineProtocol(s, ALL, overlay.syndromes[s.id] || null, { allowDraft: true });
    const res = proj.bands.find((b) => b.band === "resuscitate").items.filter((i) => i.abx);
    if (direct.abx && direct.abx.firstLine && direct.abx.firstLine.length) {
      assert.equal(res.length, 1, s.id + ": the engine's regimen must appear once");
      assert.deepEqual(res[0].abx.firstLine, direct.abx.firstLine, s.id + ": regimen must be unaltered");
    } else {
      assert.equal(res.length, 0, s.id + ": no regimen may appear when the engine gave none");
    }
  }
});

/* ── authored protocols ───────────────────────────────────────────────────── */

test("authored protocols: every one validates, including the evidence gate", () => {
  for (const entry of AUTHORED) {
    const p = read(entry.file);
    const r = M.validateProtocol(p);
    assert.equal(r.ok, true, entry.id + ": " + r.errors.join(" | "));
    assert.equal(p.id, entry.id, entry.file + ": id must match the manifest");
  }
});

test("authored protocols: every one compiles to all seven bands and fills the critical ones", () => {
  for (const entry of AUTHORED) {
    const c = M.compileProtocol(read(entry.file), { allowDraft: true });
    assert.ok(c, entry.id + " must compile");
    assert.deepEqual(c.bands.map((b) => b.band), M.BAND_IDS);
    const filled = (id) => c.bands.find((b) => b.band === id).items.length;
    assert.ok(filled("red_flags") > 0, entry.id + " must state its red flags");
    assert.ok(filled("do_now") > 0, entry.id + " must state what to do now");
    assert.ok(filled("definitive") > 0, entry.id + " must state definitive management");
    assert.ok(filled("escalate") > 0, entry.id + " must state escalation");
  }
});

test("authored protocols: every action item resolves a real source", () => {
  for (const entry of AUTHORED) {
    const p = read(entry.file);
    Object.keys(M.ACTION_BANDS).forEach((band) => {
      (p.bands[band] || []).forEach((it, i) => {
        const s = M.resolveEvidence(p, it.evidenceRef);
        assert.ok(s, entry.id + "." + band + "[" + i + "] has no resolvable source");
        assert.ok(M.isSource(s), entry.id + "." + band + "[" + i + "] resolves an unusable source");
      });
    });
  }
});

test("authored protocols: every declared source is complete and its url is absolute https", () => {
  for (const entry of AUTHORED) {
    const p = read(entry.file);
    p.sources.forEach((s) => {
      assert.ok(M.isSource(s), entry.id + ": bad source " + JSON.stringify(s));
      if (s.url) assert.ok(/^https:\/\//.test(s.url), entry.id + ": source url must be https - " + s.url);
    });
  }
});

test("authored protocols: review currency is declared, so staleness can be shown rather than hidden", () => {
  for (const entry of AUTHORED) {
    const p = read(entry.file);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.updated || ""), entry.id + " needs an updated date");
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.nextReviewDue || ""), entry.id + " needs a nextReviewDue date");
  }
});

/* ── steps and procedures ─────────────────────────────────────────────────── */

function allSharedSteps() {
  const steps = {};
  for (const pack of manifest.stepPacks) Object.assign(steps, read(pack.file).steps);
  return steps;
}
const SHARED = allSharedSteps();
const SHARED_IDS = Object.keys(SHARED);

test("step packs: every pack validates and every key matches its own id", () => {
  for (const pack of manifest.stepPacks) {
    const r = M.validateStepPack(read(pack.file));
    assert.equal(r.ok, true, pack.id + ": " + r.errors.join(" | "));
  }
});

test("procedures: every one validates against the merged step map", () => {
  for (const entry of manifest.procedures) {
    const pr = read(entry.file);
    const steps = Object.assign({}, SHARED, pr.steps_local || {});
    const r = M.validateProcedure(pr, steps);
    assert.equal(r.ok, true, entry.id + ": " + r.errors.join(" | "));
    assert.equal(pr.id, entry.id, entry.file + ": id must match the manifest");
  }
});

test("procedures: every one compiles with steps and at least the core chapters", () => {
  for (const entry of manifest.procedures) {
    const pr = read(entry.file);
    const steps = Object.assign({}, SHARED, pr.steps_local || {});
    const c = M.compileProcedure(pr, steps, { allowDraft: true });
    assert.ok(c, entry.id + " must compile");
    const chap = (id) => c.chapters.find((x) => x.id === id);
    assert.ok(chap("steps").steps.length > 0, entry.id + " must have steps");
    assert.ok(chap("indications").lines.length > 0, entry.id + " must state indications");
    assert.ok(chap("complications").lines.length > 0, entry.id + " must state complications");
    assert.ok(chap("anatomy").lines.length > 0, entry.id + " must state anatomy");
    assert.equal(c.pendingSteps, 0, entry.id + ": with allowDraft nothing should be pending");
  }
});

test("procedures: local steps are genuinely local, never shadowing a shared id", () => {
  for (const entry of manifest.procedures) {
    const pr = read(entry.file);
    Object.keys(pr.steps_local || {}).forEach((id) => {
      assert.equal(SHARED_IDS.indexOf(id), -1, entry.id + " redefines shared step " + id + " - move the change to the pack or rename");
    });
  }
});

test("THE ARCHITECTURE'S OWN CLAIM: step reuse across procedures is measurable and majority-shared", () => {
  const procs = manifest.procedures.map((e) => read(e.file));
  const report = M.reuseReport(procs, SHARED_IDS);
  let total = 0, reused = 0;
  report.forEach((r) => {
    total += r.total; reused += r.reused;
    assert.ok(r.total > 0, r.id + " has no steps");
  });
  const ratio = reused / total;
  // If this fails, a step belonged in a shared pack and was authored locally instead. That is the
  // validator telling you the atom is in the wrong place, exactly as it did in CliniX.
  assert.ok(ratio >= 0.6, "overall step reuse " + Math.round(ratio * 100) + "% is below 60%: " +
    JSON.stringify(report.map((r) => r.id + " " + r.reused + "/" + r.total)));
});

/* ── cases ────────────────────────────────────────────────────────────────── */

test("cases: every one validates, is a labelled simulation, and teaches without AI", () => {
  for (const entry of manifest.cases) {
    const k = read(entry.file);
    const r = M.validateCase(k);
    assert.equal(r.ok, true, entry.id + ": " + r.errors.join(" | "));
    assert.equal(k.simulation, true);
    k.decisionPoints.forEach((d, i) => {
      assert.ok(d.why && d.why.length > 20, entry.id + ".dp[" + i + "] needs a real 'why'");
      assert.ok(d.options.every((o) => o.text), entry.id + ".dp[" + i + "] options need text");
    });
  }
});

test("cases: every one compiles and scores at every level it claims", () => {
  for (const entry of manifest.cases) {
    const k = read(entry.file);
    for (const lv of k.levels) {
      const c = M.compileCase(k, lv, { allowDraft: true });
      assert.ok(c, entry.id + " must compile at " + lv);
      assert.ok(c.decisionPoints.length > 0, entry.id + " has no decision points at " + lv);
      // Answering correctly throughout must produce a clean verdict.
      const answers = {};
      c.decisionPoints.forEach((d) => { answers[d.id] = (d.options.find((o) => o.correct) || {}).id; });
      const s = M.scoreCase(c, answers);
      assert.equal(s.verdict, "good", entry.id + " at " + lv + " should score 'good' when fully correct");
    }
  }
});

test("cases: every protocolRef and procedureRef points somewhere real", () => {
  const protoIds = manifest.protocols.map((p) => p.id);
  const procIds = manifest.procedures.map((p) => p.id);
  for (const entry of manifest.cases) {
    const k = read(entry.file);
    if (k.protocolRef) assert.ok(protoIds.indexOf(k.protocolRef) >= 0, entry.id + ": unknown protocolRef " + k.protocolRef);
    if (k.procedureRef) assert.ok(procIds.indexOf(k.procedureRef) >= 0, entry.id + ": unknown procedureRef " + k.procedureRef);
  }
});

/* ── media, and the gate asserted BOTH ways ───────────────────────────────── */

test("media: every entry validates", () => {
  Object.keys(media.media).forEach((id) => {
    const r = M.validateMedia(media.media[id]);
    assert.equal(r.ok, true, id + ": " + r.errors.join(" | "));
  });
});

test("media: ONLY self-authored inline diagrams are cleared, and every one has a real diagram", () => {
  Object.keys(media.media).forEach((id) => {
    const m = media.media[id];
    if (!m.cleared) return;
    assert.equal(m.inline, true, id + " is cleared but is not a self-authored inline diagram");
    assert.ok(/StewardMD/i.test(m.attribution), id + " is cleared but not attributed to StewardMD");
    assert.ok(DIA.get(m.diagramId), id + " references diagram '" + m.diagramId + "' which surgx-diagrams.js does not draw");
  });
});

test("media: every uncleared entry is REFUSED by the gate and carries a work order", () => {
  let uncleared = 0;
  Object.keys(media.media).forEach((id) => {
    const m = media.media[id];
    if (m.cleared) return;
    uncleared++;
    assert.equal(M.mediaRenderable(m), false, id + " must be refused");
    assert.ok(m.note && m.note.length > 30, id + " must say what is needed and where to look");
    assert.ok(m.caption, id + " must have a caption - it is what renders instead");
  });
  assert.ok(uncleared > 0, "keep at least one uncleared entry so the refusal path stays tested");
});

test("media: every media id referenced by a procedure exists in the registry", () => {
  for (const entry of manifest.procedures) {
    const pr = read(entry.file);
    Object.keys(pr.media || {}).forEach((chapter) => {
      (pr.media[chapter] || []).forEach((mid) => {
        assert.ok(media.media[mid], entry.id + " references unknown media " + mid);
      });
    });
    Object.keys(pr.steps_local || {}).forEach((sid) => {
      (pr.steps_local[sid].media || []).forEach((mid) => {
        assert.ok(media.media[mid], entry.id + "/" + sid + " references unknown media " + mid);
      });
    });
  }
});

test("diagrams: every drawn diagram produces real SVG with a title", () => {
  DIA.ids().forEach((id) => {
    const svg = DIA.get(id);
    assert.ok(/^<svg /.test(svg), id + " must render an svg");
    assert.ok(/<title>/.test(svg), id + " must have a <title> for screen readers");
    assert.ok(svg.length > 400, id + " looks empty");
  });
  assert.equal(DIA.get("nope"), "", "an unknown diagram id yields nothing, not a crash");
});

/* ── evidence ─────────────────────────────────────────────────────────────── */

test("evidence: every record validates and carries an ORIGINAL summary, never reproduced text", () => {
  assert.ok(evidence.records.length > 0);
  evidence.records.forEach((r) => {
    const v = EVMOD.validateRecord(r);
    assert.equal(v.ok, true, r.id + ": " + v.errors.join(" | "));
    assert.equal(r.verbatim, undefined, r.id + " must not carry reproduced guideline text");
    assert.ok(r.originalSummary.length > 120, r.id + " summary is too thin to be an explanation");
  });
});

test("evidence: ids are unique and every protocolRef / procedureRef is real", () => {
  const seen = {};
  const protoIds = manifest.protocols.map((p) => p.id);
  const procIds = manifest.procedures.map((p) => p.id);
  evidence.records.forEach((r) => {
    assert.ok(!seen[r.id], "duplicate evidence id " + r.id);
    seen[r.id] = 1;
    (r.protocolRefs || []).forEach((id) => assert.ok(protoIds.indexOf(id) >= 0, r.id + ": unknown protocolRef " + id));
    (r.procedureRefs || []).forEach((id) => assert.ok(procIds.indexOf(id) >= 0, r.id + ": unknown procedureRef " + id));
  });
});

test("evidence: currency is computable and an overdue protocol is flagged", () => {
  const p = read(AUTHORED[0].file);
  const c = M.compileProtocol(p, { allowDraft: true });
  const cur = EVMOD.currency(c, "2026-08-24");
  assert.ok(cur.count > 0);
  assert.equal(typeof cur.overdue, "boolean");
  // The ATLS-based protocols are deliberately past due, so the amber chip has something to show.
  const atls = M.compileProtocol(read("protocols/atls-primary-survey.json"), { allowDraft: true });
  assert.equal(EVMOD.currency(atls, "2026-08-24").overdue, true);
});

/* ── calculator deep links must point at calculators that exist ───────────── */

test("calculators: every id SURGX deep-links to exists in calculators.js", () => {
  const calcSrc = readFileSync(join(ROOT, "calculators.js"), "utf8");
  const have = {};
  const re = /\bid:\s*"([a-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(calcSrc)) !== null) have[m[1]] = 1;

  const ids = new Set();
  const collect = (arr) => (arr || []).forEach((x) => ids.add(x));
  AUTHORED.forEach((e) => {
    const p = read(e.file);
    collect(p.calcs);
    Object.keys(p.bands || {}).forEach((b) => (p.bands[b] || []).forEach((it) => collect(it.calcs)));
  });
  Object.keys(overlay.syndromes).forEach((k) => {
    const o = overlay.syndromes[k];
    collect(o.calcs);
    (o.investigate || []).forEach((it) => collect(it.calcs));
  });
  manifest.procedures.forEach((e) => collect(read(e.file).calcs));

  const missing = [];
  ids.forEach((id) => { if (!have[id]) missing.push(id); });
  // A missing id degrades silently at runtime (MEDCALC.get returns nothing and the chip is not
  // rendered), but a dead link in content is still a content bug and should fail here.
  assert.deepEqual(missing, [], "SURGX links to calculators that do not exist: " + missing.join(", "));
});

test("SURGX defines no calculators of its own - it only deep-links", () => {
  for (const f of ["surgx-model.js", "surgx-screens.js", "surgx-content.js", "surgx-evidence.js"]) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.equal(/MEDCALC\s*=\s*/.test(s), false, f + " must not define calculators");
  }
  const scr = readFileSync(join(ROOT, "surgx-screens.js"), "utf8");
  assert.ok(/MEDCALC\.open/.test(scr), "it must open the existing Calculators module");
});

/* ── the module must never reach a prescribing surface ────────────────────── */

test("no SURGX file reaches SMD_RX, the prescription generator", () => {
  const files = ["surgx.js", "surgx-model.js", "surgx-content.js", "surgx-screens.js", "surgx-store.js",
    "surgx-evidence.js", "surgx-note-schema.js", "surgx-diagrams.js"];
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.equal(/SMD_RX\s*\.\s*open/.test(s), false, f + " must not open the prescription generator");
  }
  // surgx-entitlement.js legitimately READS SMD_RX.canPrescribe as its clinician gate.
  const ent = readFileSync(join(ROOT, "surgx-entitlement.js"), "utf8");
  assert.ok(/canPrescribe/.test(ent));
  assert.equal(/SMD_RX\s*\.\s*open/.test(ent), false);
});

/* ── the build must ship the content ──────────────────────────────────────── */

test("scripts/build-www.sh copies the surgx content directory", () => {
  const sh = readFileSync(join(ROOT, "scripts", "build-www.sh"), "utf8");
  assert.ok(/cp -R surgx\/\./.test(sh),
    "without this the tile appears and every section renders empty on the device");
});

test("index.html loads the SURGX bundle in the load-bearing order", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const order = ["surgx-flags.js", "surgx-model.js", "surgx-content.js", "surgx-note-schema.js",
    "surgx-store.js", "surgx-entitlement.js", "surgx-evidence.js", "surgx-diagrams.js",
    "surgx-screens.js", "surgx.js"];
  let last = -1;
  for (const f of order) {
    const at = html.indexOf("/" + f + "?v=");
    assert.ok(at > 0, f + " is not loaded by index.html (or has no ?v= token)");
    assert.ok(at > last, f + " loads out of order");
    last = at;
  }
  assert.ok(html.indexOf("/surgx.css?v=") > 0, "surgx.css must be linked with a ?v= token");
  // ws-surgery.js must still load, and BEFORE surgx.js, because SURGX projects it.
  const ws = html.indexOf("/ws-surgery.js?v=");
  assert.ok(ws > 0 && ws < html.indexOf("/surgx.js?v="), "ws-surgery.js must load before surgx.js");
});

test("the SURGX logo ships and is ALPHA-MASKED, not a white-background image", () => {
  // home.js and the hero both render this with `filter: brightness(0) invert(1)` to force it white
  // on a dark background. That only works because the PNG is transparent + black ink: a
  // white-BACKGROUND image would invert into a solid white block covering the badge. Cheap to get
  // wrong when someone re-exports the logo, and very visible when they do.
  const png = join(ROOT, "surgx-logo.png");
  assert.ok(existsSync(png), "surgx-logo.png must exist at the repo root (build-www globs root *.png)");
  const buf = readFileSync(png);
  assert.equal(buf.slice(1, 4).toString("ascii"), "PNG", "must be a PNG");
  // IHDR colour-type byte: 6 = RGBA, 4 = grey+alpha. Anything else has no alpha channel at all.
  const colorType = buf[25];
  assert.ok(colorType === 6 || colorType === 4,
    "surgx-logo.png must have an alpha channel (IHDR colour type 6 or 4); got " + colorType);
  assert.ok(buf.length < 400 * 1024, "keep the logo small; it is bundled into the app download");

  // And it must actually be REFERENCED, or the asset silently rots.
  const home = readFileSync(join(ROOT, "home.js"), "utf8");
  const screens = readFileSync(join(ROOT, "surgx-screens.js"), "utf8");
  assert.ok(/surgx-logo\.png/.test(home), "the home tile badge must use the logo");
  assert.ok(/surgx-logo\.png/.test(screens), "the SURGX hero must use the logo");
  assert.ok(/brightness\(0\) invert\(1\)/.test(home), "the tile badge must force it white on the dark badge");
});

test("edited existing files carry a surgx cache-bust marker", () => {
  // The CliniX incident: the module shipped and worked, but home.js and sidebar-redesign.js were
  // served from the service worker's pre-CliniX cache, so there was no tile and no toggle to
  // reach it with. sw.js caches keyed on the FULL url including the query string.
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  for (const f of ["home.js", "sidebar-redesign.js", "workspaces.js"]) {
    const m = html.match(new RegExp("/" + f.replace(".", "\\.") + "\\?v=([^\"']+)"));
    assert.ok(m, f + " must be loaded with a ?v= token");
    assert.ok(/surgx/.test(m[1]), f + " was edited for SURGX but its ?v= token (" + m[1] + ") has no surgx marker");
  }
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  assert.ok(/surgx/.test(sw.match(/var CACHE = "([^"]+)"/)[1]), "sw.js CACHE must be bumped");
});
