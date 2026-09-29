import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const M = createRequire(import.meta.url)("../tokos-models/explorer-mechanism.js");
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"); // em and en dash are banned in learner text
const gen = await import("../tools/tokos-build-mechanism-svg.mjs");
const credits = JSON.parse(readFileSync(join(root, "tokos/explorer/credits.json"), "utf8"));

const ORDER = ["engagement", "descent", "flexion", "internal-rotation", "extension", "restitution", "external-rotation", "expulsion"];

test("model contract", () => {
  assert.equal(M.id, "mechanism");
  assert.equal(M.kind, "explorer");
  assert.equal(M.review, "ai_drafted");
  assert.ok(M.title.en && M.title.hi);
  assert.ok(M.sources.length >= 3 && M.sources.every((s) => s.label && /^https:\/\//.test(s.url)));
});

test("eight movements in the learnt order", () => {
  assert.deepEqual(M.movements.map((m) => m.id), ORDER);
  M.movements.forEach((m, i) => {
    assert.equal(m.order, i + 1);
    assert.ok(m.title.en && m.title.hi && m.what.en && m.what.hi);
    assert.ok(m.why === null || (m.why.en && m.why.hi));
  });
  assert.equal(M.movement("flexion").order, 3);
  assert.equal(M.movement("nope"), null);
});

test("station scale: ACOG -5 to +5 cm, 0 at the ischial spines, +5 at the introitus", () => {
  assert.deepEqual([M.stationScale.min, M.stationScale.max, M.stationScale.unit], [-5, 5, "cm"]);
  assert.equal(M.station(-5).level, "above-spines");
  assert.equal(M.station(-1).level, "above-spines");
  assert.equal(M.station(0).level, "at-spines");
  assert.equal(M.station(1).level, "below-spines");
  assert.equal(M.station(4).level, "below-spines");
  assert.equal(M.station(5).level, "introitus");
  for (const bad of [-6, 6, NaN, "0", null, undefined]) assert.equal(M.station(bad).ok, false, String(bad));
});

test("position table: eight positions, angles a multiple of 45 from the front", () => {
  assert.deepEqual(M.positionOrder, ["OA", "LOA", "LOT", "LOP", "OP", "ROP", "ROT", "ROA"]);
  M.positionOrder.forEach((k, i) => assert.equal(M.positions[k].angle, i * 45));
  assert.equal(M.positions.OA.family, "anterior");
  assert.equal(M.positions.LOT.family, "transverse");
  assert.equal(M.positions.OP.family, "posterior");
});

test("rotation: shortest turn and the positions passed", () => {
  assert.deepEqual(M.rotation("LOT", "OA"), { ok: true, degrees: 90, direction: "anticlockwise", via: ["LOA"] });
  assert.deepEqual(M.rotation("ROT", "OA"), { ok: true, degrees: 90, direction: "clockwise", via: ["ROA"] });
  assert.equal(M.rotation("LOA", "OA").degrees, 45);
  assert.equal(M.rotation("LOP", "OA").degrees, 135);
  assert.equal(M.rotation("ROP", "OA").degrees, 135);
  assert.deepEqual(M.rotation("OP", "OA").direction, "either");
  assert.equal(M.rotation("OP", "OA").degrees, 180);
  assert.equal(M.rotation("OA", "OA").degrees, 0);
  assert.equal(M.rotation("OA", "XX").ok, false);
});

test("sequence from LOT: 90 degrees at internal rotation, then 45 and 45 back to LOT", () => {
  const r = M.sequence("LOT");
  assert.equal(r.ok, true);
  assert.equal(r.steps.length, 8);
  const by = Object.fromEntries(r.steps.map((s) => [s.id, s]));
  assert.deepEqual([by["internal-rotation"].before, by["internal-rotation"].after, by["internal-rotation"].degrees], ["LOT", "OA", 90]);
  assert.deepEqual([by.extension.before, by.extension.after], ["OA", "OA"]);
  assert.deepEqual([by.restitution.before, by.restitution.after, by.restitution.degrees], ["OA", "LOA", 45]);
  assert.deepEqual([by["external-rotation"].before, by["external-rotation"].after, by["external-rotation"].degrees], ["LOA", "LOT", 45]);
  assert.equal(by.expulsion.after, "LOT");
  assert.equal(r.bornAs, "OA");
  ["engagement", "descent", "flexion"].forEach((id) => assert.equal(by[id].degrees, 0));
});

test("sequence from the right: the turn back is on the right", () => {
  const by = Object.fromEntries(M.sequence("ROT").steps.map((s) => [s.id, s]));
  assert.equal(by["internal-rotation"].after, "OA");
  assert.equal(by.restitution.after, "ROA");
  assert.equal(by["external-rotation"].after, "ROT");
});

test("sequence from an oblique posterior position turns 135 degrees and passes the transverse and anterior positions", () => {
  const s = M.sequence("LOP").steps.find((x) => x.id === "internal-rotation");
  assert.equal(s.degrees, 135);
  assert.deepEqual(s.via, ["LOT", "LOA"]);
  const p = M.sequence("ROP").steps.find((x) => x.id === "internal-rotation");
  assert.deepEqual(p.via, ["ROT", "ROA"]);
});

test("persistent occiput posterior: no forward turn, flagged", () => {
  const r = M.sequence("OP", { persistentOP: true });
  const ir = r.steps.find((x) => x.id === "internal-rotation");
  assert.equal(ir.degrees, 0);
  assert.equal(r.bornAs, "OP");
  assert.ok(r.notes.some((n) => /persistent occiput posterior/.test(n.en)));
  assert.equal(M.sequence("LOT", { persistentOP: true }).bornAs, "OA"); // the option only applies to posterior starts
  assert.equal(M.sequence("nope").ok, false);
});

test("every learner string has English and Hindi, no em dash, no Devanagari digits", () => {
  const texts = [];
  (function walk(o) {
    if (o && typeof o === "object") {
      if (typeof o.en === "string" && typeof o.hi === "string") texts.push(o);
      else Object.values(o).forEach(walk);
    }
  })(M);
  assert.ok(texts.length > 40);
  for (const t of texts) {
    assert.ok(t.en.trim() && t.hi.trim());
    assert.ok(/[ऀ-ॿ]/.test(t.hi), "Hindi text has Devanagari: " + t.hi);
    assert.ok(!DASH.test(t.en + t.hi), "no em or en dash");
    assert.ok(!/[०-९]/.test(t.hi), "clinical numerals stay ASCII");
  }
});

test("SVG frames: on disk, in sync with the generator, no text, parts match the model", () => {
  assert.equal(gen.FRAMES.length, 8);
  assert.deepEqual(gen.ORDER, ORDER);
  M.movements.forEach((m, i) => {
    const f = join(root, m.file);
    assert.ok(existsSync(f), m.file);
    const svg = readFileSync(f, "utf8");
    assert.equal(svg, gen.render(gen.FRAMES[i]), m.file + " differs from the generator output: run node tools/tokos-build-mechanism-svg.mjs");
    assert.ok(!/<text|<tspan|<foreignObject|<script|<image/i.test(svg), "no text, script or raster inside the SVG");
    assert.ok(svg.startsWith("<svg ") && svg.trimEnd().endsWith("</svg>"));
    const found = new Set([...svg.matchAll(/data-part="([a-z-]+)"/g)].map((x) => x[1]));
    for (const p of m.parts) assert.ok(found.has(p), m.id + " draws part " + p);
    for (const p of found) assert.ok(M.parts[p], "part " + p + " is named in the model");
    assert.ok(svg.length < 12000, "small file");
  });
});

test("credits: every frame is an original illustration owned by MAIKNOWLEDGE LLP", () => {
  assert.equal(credits.v, 1);
  for (const m of M.movements) {
    const c = credits.items.find((x) => x.file === "mechanism/" + m.file.split("/").pop());
    assert.ok(c, m.id + " has a credits entry");
    assert.equal(c.route, "original");
    assert.match(c.licence, /Original, MAIKNOWLEDGE LLP/);
    assert.match(c.author, /MAIKNOWLEDGE LLP/);
    assert.equal(c.reviewed, false);
    assert.ok(c.alt.en && c.alt.hi && c.caption.en && c.caption.hi);
    assert.deepEqual(c.labels, m.parts);
    assert.deepEqual([c.w, c.h], [640, 320]);
  }
});
