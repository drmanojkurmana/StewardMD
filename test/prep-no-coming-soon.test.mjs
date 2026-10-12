/* PrepNucleus never says "coming soon" (owner 2026-10-12).
 * What must hold: no student-visible string in the prep surfaces contains
 * "coming", "being added" or "will be added" (code comments and the
 * data-driven bank-status enum value "coming" are not student-visible and
 * are allowed); every exam-profile bank note is neutral; and modules with
 * zero questions for an exam are hidden from lists (filterModules drops them).
 *
 * node --test test/prep-no-coming-soon.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const P = require("../prep.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SURFACES = ["prep.js", "prep-tests.js", "prep-arena.js", "prep-qgen.js",
  "prep-social.js", "prep-plan.js", "prep-profiles.js", "prep-lessons.js",
  "specialty-bank.js", "specialty-tools.js", "specialty-learn.js",
  "ophthalmos-learn.js"];

// String literals only: identifiers (comingSection), params and comments can
// keep their names. The lone status-enum value "coming" is data, not prose.
function stripComments(src) {
  let noBlock = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlock.split("\n").map((line) => {
    let q = null, out = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        out += c;
        if (c === "\\") { out += line[i + 1] || ""; i++; }
        else if (c === q) q = null;
      } else if (c === "'" || c === '"') { q = c; out += c; }
      else if (c === "/" && line[i + 1] === "/") break;
      else out += c;
    }
    return out;
  }).join("\n");
}
function literals(src) {
  const out = [];
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
  let m;
  const clean = stripComments(src);
  while ((m = re.exec(clean)) !== null) out.push(m[0].slice(1, -1));
  return out;
}

function bannedIn(lit) {
  if (lit.trim().toLowerCase() === "coming") return null;
  if (/\bcoming\b/i.test(lit)) return "coming";
  if (/being added/i.test(lit)) return "being added";
  if (/will be added/i.test(lit)) return "will be added";
  return null;
}

test("no coming-soon wording in student-visible prep strings", () => {
  const hits = [];
  for (const f of SURFACES) {
    for (const lit of literals(read(f))) {
      const hit = bannedIn(lit);
      if (hit) hits.push(f + " [" + hit + "]: " + lit.slice(0, 90));
    }
  }
  assert.deepEqual(hits, [], "student-visible strings must not promise what is coming");
});

test("exam-profile bank notes are neutral; status stays data-driven", () => {
  const dir = path.join(ROOT, "prep/assess/profiles");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(!p.bank || ["available", "coming"].includes(p.bank.status), f + " bank.status");
    if (p.bank && typeof p.bank.note === "string") {
      assert.equal(bannedIn(p.bank.note), null, f + " bank.note: " + p.bank.note);
    }
  }
});

test("empty modules are hidden from lists: filterModules drops zero-count topics", () => {
  const topics = [
    { id: "m-full", group: "g", count: 12 },
    { id: "m-empty", group: "g", count: 0 },
    { id: "m-ov", group: "g", count: 0, ov: 3 },
  ];
  const prog = {};
  const ids = P.filterModules(topics, prog, "all", "neet-pg").map((t) => t.id);
  assert.ok(!ids.includes("m-empty"), "zero-count module is not listed");
  assert.ok(ids.includes("m-full") && ids.includes("m-ov"), "modules with questions stay");
  assert.equal(P.countFor({ count: 0 }, "neet-pg"), 0);
});
