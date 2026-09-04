import { test } from "node:test";
import assert from "node:assert";
import D from "../clinix-diagrams.js";

/* ORIENTATION is the load-bearing property in this file.
 *
 * Every body diagram in CliniX is drawn in the EXAMINER'S view: standing at the foot of the bed,
 * the PATIENT'S RIGHT appears on the VIEWER'S LEFT. That is the radiograph convention and the one
 * a student carries to the bedside.
 *
 * This was wrong in the percussion map, in liver palpation and in splenic palpation, while the
 * auscultation map and the abdominal regions were right - so the same file taught both conventions
 * at once. Nothing caught it, because a mirrored diagram is internally consistent and reads as
 * correct right up until you say the sides out loud. Hence assertions in BOTH directions: a future
 * mirror of either set fails here rather than at a bedside. */

const CHEST_MID = 160; // viewBox 0 0 320 210
const ABD_MID = 170;   // viewBox 0 0 340 280

test("ORIENTATION: percussion zones are in the examiner's view, patient's right on the viewer's left", () => {
  for (const z of D.ZONES) {
    assert.ok(z.side === "left" || z.side === "right", `${z.id} does not declare a side`);
    if (z.side === "left") assert.ok(z.cx > CHEST_MID, `${z.id} is the patient's LEFT, so it must render right of the midline (cx ${z.cx})`);
    else assert.ok(z.cx < CHEST_MID, `${z.id} is the patient's RIGHT, so it must render left of the midline (cx ${z.cx})`);
  }
});

test("ORIENTATION: auscultation sites use the same convention as percussion", () => {
  for (const z of D.AUSC) {
    assert.ok(z.side === "left" || z.side === "right", `${z.id} does not declare a side`);
    if (z.side === "left") assert.ok(z.cx > CHEST_MID, `${z.id} must render right of the midline (cx ${z.cx})`);
    else assert.ok(z.cx < CHEST_MID, `${z.id} must render left of the midline (cx ${z.cx})`);
  }
});

test("ORIENTATION: the abdominal regions agree with the chest diagrams", () => {
  for (const r of D.ABD_REGIONS) {
    if (r.side === "left") assert.ok(r.cx > ABD_MID, `${r.id} must render right of the midline (cx ${r.cx})`);
    else if (r.side === "right") assert.ok(r.cx < ABD_MID, `${r.id} must render left of the midline (cx ${r.cx})`);
    else assert.equal(r.cx, ABD_MID, `${r.id} is a midline region and must sit on the midline`);
  }
});

test("ORIENTATION: a zone's declared side agrees with the side named in its label", () => {
  // The label is what the student reads. If it says "Left base" and `side` says right, one of the
  // two is a typo and the geometry assertions above would happily enforce the wrong one.
  for (const z of [...D.ZONES, ...D.AUSC]) {
    const l = z.label.toLowerCase();
    if (l.indexOf("left") >= 0) assert.equal(z.side, "left", `${z.id}: label says left, side says ${z.side}`);
    if (l.indexOf("right") >= 0) assert.equal(z.side, "right", `${z.id}: label says right, side says ${z.side}`);
  }
});

test("ORIENTATION: the liver is drawn on the viewer's left and the spleen on the viewer's right", () => {
  // These two are pure SVG with no data table, so assert on the rendered geometry.
  const liverX = [...D.render("diagram.liverpalp").matchAll(/class="cx-dia-liver" d="M([\d.]+)/g)].map((m) => Number(m[1]));
  assert.equal(liverX.length, 1, "expected exactly one liver path");
  assert.ok(liverX[0] <= ABD_MID, `the liver starts at x=${liverX[0]}; the patient's right is the viewer's LEFT`);

  const sp = D.render("diagram.spleenpalp");
  const start = /class="cx-dia-spleenpath" d="M([\d.]+) ([\d.]+) C[\d. ]+ ([\d.]+) ([\d.]+)"/.exec(sp);
  assert.ok(start, "expected the splenic sweep path");
  assert.ok(Number(start[1]) > ABD_MID, "the spleen sits in the patient's LEFT upper quadrant, so on the viewer's RIGHT");
  assert.ok(Number(start[3]) < ABD_MID, "it enlarges towards the right iliac fossa, so towards the viewer's LEFT");
});

/* Comparative order ---------------------------------------------------------- */

test("percussion and auscultation are numbered side to side at matched levels", () => {
  for (const set of [D.ZONES, D.AUSC]) {
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

test("the comparison connector runs BETWEEN a pair, not back across both circles", () => {
  // With the zones mirrored, pairs now run right-to-left, and a fixed +17/-17 stand-off drew the
  // line outwards from both circles instead of between them.
  const html = D.render("diagram.percussion");
  const lines = [...html.matchAll(/class="cx-dia-cmp" d="M([\d.-]+) [\d.-]+ L([\d.-]+) /g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(lines.length, 4, "four comparative pairs");
  for (const [x1, x2] of lines) {
    const [a, b] = [Math.min(x1, x2), Math.max(x1, x2)];
    assert.ok(a > 100 && b < 220, `connector ${x1}->${x2} escapes the chest instead of spanning the pair`);
  }
});

/* Registry sanity ------------------------------------------------------------ */

test("every registered diagram renders non-empty SVG and never throws", () => {
  for (const id of Object.keys(D.DIAGRAMS)) {
    const html = D.render(id);
    assert.ok(html.indexOf("<svg") === 0, `${id} rendered nothing (render() swallows throws)`);
    assert.ok(html.indexOf("</svg>") > 0, `${id} produced unclosed SVG`);
    assert.ok(D.titleOf(id).length > 3, `${id} has no title`);
  }
  assert.equal(D.render("diagram.does.not.exist"), "");
});

test("no em-dash in diagram text", () => {
  for (const id of Object.keys(D.DIAGRAMS)) {
    assert.equal(D.render(id).indexOf("—"), -1, `${id} contains an em-dash`);
  }
});
