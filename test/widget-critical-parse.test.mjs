// The Ask MaiK "Night" widget sets the RESULT ITSELF large (design/ASK-MAIK-WIDGET-PHILOSOPHY.md).
// To do that it has to pull a number out of GlanceState.topCritical, which is a display string the
// web app builds. That makes the string a CONTRACT between two languages, and a silent one: if the
// producer changes shape, Swift keeps compiling and the tile just quietly stops showing a number.
//
// This file pins the contract from the JS side and mirrors the Swift parser
// (CriticalParts in ios/App/StewardMDWidget/AssistantWidgetViews.swift) so the intended behaviour
// is executable. A mirror cannot prove the Swift is right; it proves the RULES are right against
// the real published formats, which is where the first version of this parser went wrong: it read
// only the first segment and so never found the value in a real three-segment payload.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SEP = " · ";

// --- the producer -------------------------------------------------------------------------------

test("native-watch.js still builds topCritical as analyte, value+units, patient", () => {
  const src = readFileSync(new URL("../native-watch.js", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes("top = [c0.analyte"));
  assert.ok(line, "the topCritical producer moved or was renamed; update CriticalParts to match");
  assert.match(line, /c0\.analyte/, "analyte must lead the string");
  assert.match(line, /c0\.value/, "the value must be in the string");
  assert.match(line, /c0\.patientLabel/, "the patient label must be in the string");
  assert.ok(line.includes('join(" · ")'), "segments must still be joined by a middle dot");
  // Order matters: the parser takes everything before the number as the analyte.
  assert.ok(
    line.indexOf("c0.analyte") < line.indexOf("c0.value"),
    "analyte must come before the value",
  );
  assert.ok(
    line.indexOf("c0.value") < line.indexOf("c0.patientLabel"),
    "the value must come before the patient label",
  );
});

// --- the parser, mirrored from CriticalParts -----------------------------------------------------

function parseCritical(raw) {
  if (!raw) return { value: null, analyte: null, place: null };
  const segments = raw
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);

  // The last segment is the patient label; a bed number is not a result.
  const searchable = segments.length > 1 ? segments.slice(0, -1) : segments;

  let hit = null;
  let num = null;
  for (let i = 0; i < searchable.length && hit === null; i++) {
    for (const token of searchable[i].split(" ").filter(Boolean)) {
      const bare = token.replace(/^[<>=~≥≤]+|[<>=~≥≤]+$/g, "");
      if (bare !== "" && Number.isFinite(Number(bare))) {
        hit = i;
        num = token; // keep the comparator: "<0.01" is not "0.01"
        break;
      }
    }
  }

  if (hit === null) {
    return {
      value: null,
      analyte: segments[0] ?? null,
      place: segments.length > 1 ? segments.slice(1).join(SEP) : null,
    };
  }

  const before = segments.slice(0, hit).join(SEP);
  const after = segments.slice(hit + 1).join(SEP);
  let analyte;
  if (before === "") {
    const words = segments[hit].split(" ").filter((w) => w && w !== num);
    analyte = words.length ? words.join(" ") : null;
  } else {
    analyte = before;
  }
  return { value: num, analyte, place: after === "" ? null : after };
}

test("the real three-segment payload yields a hero numeral", () => {
  // This is what native-watch.js actually emits. The first parser read only segment 0 ("K⁺"),
  // found no number, and silently fell back to the sentence layout on every real critical.
  const p = parseCritical("K⁺ · 6.8 mmol/L · Bed 12");
  assert.equal(p.value, "6.8");
  assert.equal(p.analyte, "K⁺");
  assert.equal(p.place, "Bed 12");
});

test("the older two-segment payload and the gallery sample still parse", () => {
  const p = parseCritical("K⁺ 6.8 · Bed 12");
  assert.equal(p.value, "6.8");
  assert.equal(p.analyte, "K⁺");
  assert.equal(p.place, "Bed 12");
});

test("a bare result with no location parses, with no place", () => {
  const p = parseCritical("K⁺ 6.8");
  assert.equal(p.value, "6.8");
  assert.equal(p.analyte, "K⁺");
  assert.equal(p.place, null);
});

test("a comparator is never dropped from the value", () => {
  // "<0.01" rendered as "0.01" is a different result. Safety, not formatting.
  const p = parseCritical("Troponin · <0.01 ng/mL · Bed 3");
  assert.equal(p.value, "<0.01");
  assert.equal(p.analyte, "Troponin");
});

test("a result with no number falls back rather than inventing one", () => {
  const p = parseCritical("Blood culture positive · Bed 4");
  assert.equal(p.value, null, "no number means no hero numeral, and the tile shows the sentence");
  assert.equal(p.analyte, "Blood culture positive");
  assert.equal(p.place, "Bed 4");
});

test("empty and missing input are safe", () => {
  for (const raw of [null, undefined, "", "   ", " · · "]) {
    const p = parseCritical(raw);
    assert.equal(p.value, null);
  }
});

// --- why the watchlist branch must NOT use this parser -------------------------------------------

test("a watchlist line would mis-parse, which is why the Swift passes NEWS2 explicitly", () => {
  // watchlistTop is [bed, name].join(" · ") - see native-watch.js. The bed number is not a result.
  const p = parseCritical("Bed 12 · Ramesh K");
  assert.equal(p.value, "12", "the bed number looks like a value to any generic parser");
  assert.equal(p.analyte, "Bed");
  // Hence MaikPrompt builds CriticalParts(value: "\(news)", analyte: "NEWS2", place: w) instead of
  // parsing the string. If that ever regresses, the tile shows a bed number in 44pt as a result.
  const src = readFileSync(
    new URL("../ios/App/StewardMDWidget/AssistantWidgetViews.swift", import.meta.url),
    "utf8",
  );
  const branch = src.slice(src.indexOf("s.watchlistTop"), src.indexOf("Deteriorating"));
  assert.ok(
    branch.includes('CriticalParts(value:') && branch.includes('analyte: "NEWS2"'),
    "the watchlist branch must build CriticalParts explicitly, never parse watchlistTop",
  );
});

test("the gallery sample matches the shape the producer emits", () => {
  const src = readFileSync(
    new URL("../ios/App/StewardMDWidget/StewardMDWidgetsBundle.swift", import.meta.url),
    "utf8",
  );
  const m = /topCritical: "([^"]+)"/.exec(src);
  assert.ok(m, "sample GlanceState lost its topCritical");
  const p = parseCritical(m[1]);
  assert.ok(p.value, "the widget-gallery preview must show a hero numeral, or it sells the wrong tile");
  assert.ok(p.place, "the preview should name a bed");
});
