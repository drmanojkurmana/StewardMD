import test from "node:test";
import assert from "node:assert/strict";
import Diagrams from "../clinix-diagrams.js";

test("diagrams registry exports all expected components", () => {
  assert.ok(Diagrams, "clinix-diagrams module must export API");
  assert.ok(typeof Diagrams.has === "function");
  assert.ok(typeof Diagrams.render === "function");
  assert.ok(typeof Diagrams.soundFor === "function");
  assert.ok(Array.isArray(Diagrams.PRECORDIAL));
  assert.ok(Array.isArray(Diagrams.DERMATOMES));
});

test("every registered diagram renders a valid non-empty SVG", () => {
  const ids = Object.keys(Diagrams.DIAGRAMS);
  assert.ok(ids.length >= 19, `expected at least 19 diagrams, got ${ids.length}`);
  for (const id of ids) {
    assert.ok(Diagrams.has(id), `Diagrams.has('${id}') should be true`);
    const svg = Diagrams.render(id, {});
    assert.ok(typeof svg === "string" && svg.includes("<svg"), `${id} must render an SVG element`);
    assert.ok(svg.includes("</svg>"), `${id} must close the SVG element`);
  }
});

test("diagram.precordium renders precordial auscultation sites and radiation paths", () => {
  const html = Diagrams.render("diagram.precordium", { selected: "mitral" });
  assert.ok(html.includes("cx-dia--precordium"), "must contain precordium class");
  assert.ok(html.includes("Carotid Radiation"), "must show carotid radiation vector");
  assert.ok(html.includes("Axilla (MR)"), "must show axilla radiation vector");
  assert.ok(html.includes("playing: mr_murmur"), "selected mitral zone must show playing: mr_murmur");

  // Verify sound mappings
  assert.equal(Diagrams.soundFor("aortic"), "as_murmur");
  assert.equal(Diagrams.soundFor("mitral"), "mr_murmur");
  assert.equal(Diagrams.soundFor("pulm"), "s1s2_split");
  assert.equal(Diagrams.soundFor("erbs"), "ar_murmur");
  assert.equal(Diagrams.soundFor("tricuspid"), "s1s2_normal");
});

test("diagram.jvp renders all clinical wave modes and ECG rhythm reference", () => {
  const modes = ["normal", "cannon", "absent_a", "giant_v", "friedreich"];
  for (const mode of modes) {
    const html = Diagrams.render("diagram.jvp", { mode });
    assert.ok(html.includes("cx-dia--jvp"), `mode ${mode} must render jvp SVG`);
    assert.ok(html.includes("ECG (timing reference)"), `mode ${mode} must include ECG reference line`);
    assert.ok(html.includes("cx-dia-toggle"), `mode ${mode} must include mode toggle buttons`);
  }

  const cannon = Diagrams.render("diagram.jvp", { mode: "cannon" });
  assert.ok(cannon.includes("Cannon &#39;a&#39; Wave") || cannon.includes("Cannon 'a' Wave"));
  assert.ok(cannon.includes("AV dissociation"));

  const afib = Diagrams.render("diagram.jvp", { mode: "absent_a" });
  assert.ok(afib.includes("no a"));
  assert.ok(afib.includes("Atrial Fibrillation"));

  const tr = Diagrams.render("diagram.jvp", { mode: "giant_v" });
  assert.ok(tr.includes("giant cv fusion"));
  assert.ok(tr.includes("Tricuspid Regurgitation"));

  const fried = Diagrams.render("diagram.jvp", { mode: "friedreich" });
  assert.ok(fried.includes("steep"));
  assert.ok(fried.includes("Constrictive Pericarditis"));
});

test("diagram.dermatomes renders sensory landmarks and deep tendon reflex arcs", () => {
  const html = Diagrams.render("diagram.dermatomes", { selected: "c5" });
  assert.ok(html.includes("cx-dia--dermatomes"));
  assert.ok(html.includes("Biceps reflex (C5, C6)"));
  assert.ok(html.includes("Musculocutaneous nerve"));

  const htmlL4 = Diagrams.render("diagram.dermatomes", { selected: "l4" });
  assert.ok(htmlL4.includes("Patellar reflex (L3, L4)"));
  assert.ok(htmlL4.includes("Femoral nerve"));

  const htmlS1 = Diagrams.render("diagram.dermatomes", { selected: "s1" });
  assert.ok(htmlS1.includes("Achilles reflex (S1, S2)"));
  assert.ok(htmlS1.includes("Tibial nerve"));
});

/* ── ORIENTATION ───────────────────────────────────────────────────────────────
 *
 * Every body diagram is drawn in the EXAMINER'S view: standing at the foot of the bed, the
 * PATIENT'S RIGHT appears on the VIEWER'S LEFT. That is the radiograph convention and the one a
 * student carries to the bedside.
 *
 * It was wrong in the percussion map, in liver palpation and in splenic palpation, while the
 * auscultation map, the abdominal regions and the precordium were right - so one file taught both
 * conventions at once. Nothing caught it, because a mirrored diagram is internally consistent and
 * reads as correct right up until you say the sides out loud. Hence assertions in BOTH directions:
 * a future mirror of either set fails here rather than at a bedside. */

const CHEST_MID = 160; // chestOutline(), viewBox 0 0 320 x
const ABD_MID = 170;   // abdRegions(), viewBox 0 0 340 280

test("ORIENTATION: percussion zones put the patient's right on the viewer's left", () => {
  for (const z of Diagrams.ZONES) {
    assert.ok(z.side === "left" || z.side === "right", `${z.id} does not declare a side`);
    if (z.side === "left") assert.ok(z.cx > CHEST_MID, `${z.id} is the patient's LEFT, so it must render RIGHT of the midline (cx ${z.cx})`);
    else assert.ok(z.cx < CHEST_MID, `${z.id} is the patient's RIGHT, so it must render LEFT of the midline (cx ${z.cx})`);
  }
});

test("ORIENTATION: auscultation sites use the same convention as percussion", () => {
  for (const z of Diagrams.AUSC) {
    assert.ok(z.side === "left" || z.side === "right", `${z.id} does not declare a side`);
    if (z.side === "left") assert.ok(z.cx > CHEST_MID, `${z.id} must render right of the midline (cx ${z.cx})`);
    else assert.ok(z.cx < CHEST_MID, `${z.id} must render left of the midline (cx ${z.cx})`);
  }
});

test("ORIENTATION: the abdominal regions agree with the chest diagrams", () => {
  for (const r of Diagrams.ABD_REGIONS) {
    if (r.side === "left") assert.ok(r.cx > ABD_MID, `${r.id} must render right of the midline (cx ${r.cx})`);
    else if (r.side === "right") assert.ok(r.cx < ABD_MID, `${r.id} must render left of the midline (cx ${r.cx})`);
    else assert.equal(r.cx, ABD_MID, `${r.id} is a midline region and must sit on the midline`);
  }
});

test("ORIENTATION: a declared side agrees with the side named in the label", () => {
  // The label is what the student reads. If it says "Left base" while `side` says right, one of the
  // two is a typo and the geometry assertions above would happily enforce the wrong one.
  for (const z of [...Diagrams.ZONES, ...Diagrams.AUSC, ...Diagrams.ABD_REGIONS]) {
    const l = z.label.toLowerCase();
    if (l.includes("left")) assert.equal(z.side, "left", `${z.id}: label says left, side says ${z.side}`);
    if (l.includes("right")) assert.equal(z.side, "right", `${z.id}: label says right, side says ${z.side}`);
  }
});

test("ORIENTATION: the precordial areas sit on the correct side of the sternum", () => {
  // Aortic is the 2nd RIGHT intercostal space, so it belongs on the viewer's left; everything else
  // on this map is a left-sided area and belongs on the viewer's right.
  const byId = Object.fromEntries(Diagrams.PRECORDIAL.map((p) => [p.id, p]));
  assert.ok(byId.aortic.cx < CHEST_MID, "the aortic area is the 2nd RIGHT ICS");
  for (const id of ["pulm", "erbs", "tricuspid", "mitral"]) {
    assert.ok(byId[id].cx > CHEST_MID, `${id} is a LEFT-sided area, so it renders right of the midline`);
  }
  assert.ok(byId.mitral.cx > byId.tricuspid.cx, "the apex sits lateral to the lower sternal border");
});

test("ORIENTATION: the liver is drawn on the viewer's left and the spleen on the viewer's right", () => {
  // These two are pure SVG with no data table, so assert on the rendered geometry.
  const liverX = [...Diagrams.render("diagram.liverpalp").matchAll(/class="cx-dia-liver" d="M([\d.]+)/g)].map((m) => Number(m[1]));
  assert.equal(liverX.length, 1, "expected exactly one liver path");
  assert.ok(liverX[0] <= ABD_MID, `the liver starts at x=${liverX[0]}; the patient's right is the viewer's LEFT`);

  const sp = Diagrams.render("diagram.spleenpalp");
  const start = /class="cx-dia-spleenpath" d="M([\d.]+) ([\d.]+) C[\d. ]+ ([\d.]+) ([\d.]+)"/.exec(sp);
  assert.ok(start, "expected the splenic sweep path");
  assert.ok(Number(start[1]) > ABD_MID, "the spleen sits in the patient's LEFT upper quadrant, so on the viewer's RIGHT");
  assert.ok(Number(start[3]) < ABD_MID, "it enlarges towards the right iliac fossa, so towards the viewer's LEFT");
});

/* ── Comparative order ─────────────────────────────────────────────────────── */

test("ORDER: percussion and auscultation both start on the patient's RIGHT", () => {
  // They used to start on opposite sides, which taught two different sweeps over the same chest.
  // The examiner stands on the patient's right, so that is where both begin.
  assert.equal(Diagrams.ZONES[0].side, "right", "percussion must begin on the patient's right");
  assert.equal(Diagrams.AUSC[0].side, "right", "auscultation must begin on the patient's right");
});

test("ORDER: numbering is contiguous and alternates across at matched levels", () => {
  for (const set of [Diagrams.ZONES, Diagrams.AUSC]) {
    for (let i = 0; i < set.length; i++) {
      assert.equal(set[i].n, i + 1, "numbering must be contiguous and in render order");
      if (i > 0) {
        assert.notEqual(set[i].side, set[i - 1].side,
          `${set[i].id} follows ${set[i - 1].id} on the same side; the whole point of the order is to compare across`);
      }
    }
    for (let i = 0; i + 1 < set.length; i += 2) {
      assert.equal(set[i].cy, set[i + 1].cy, `${set[i].id} and ${set[i + 1].id} are a pair and must be at the same level`);
    }
  }
});

test("the comparison connector runs BETWEEN a pair, not back out across both circles", () => {
  // With the zones mirrored, pairs run right to left, and a fixed +17/-17 stand-off drew the line
  // outwards from both circles instead of between them.
  for (const id of ["diagram.percussion", "diagram.auscultation"]) {
    const lines = [...Diagrams.render(id).matchAll(/class="cx-dia-cmp" d="M([\d.-]+) [\d.-]+ L([\d.-]+) /g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    assert.equal(lines.length, 4, `${id}: four comparative pairs`);
    for (const [x1, x2] of lines) {
      const [a, b] = [Math.min(x1, x2), Math.max(x1, x2)];
      assert.ok(a > 100 && b < 220, `${id}: connector ${x1}->${x2} escapes the chest instead of spanning the pair`);
    }
  }
});
