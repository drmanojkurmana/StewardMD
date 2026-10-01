/* data/neo/monograph-neonatal.json: newborn statements taken verbatim from our own monographs
 * (worker/data/gold). Fresh, verbatim, and never from the pregnancy or lactation sections. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, extract, NEO_RE, MATERNAL } from "../scripts/neo/build-monograph-neonatal.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data/neo/monograph-neonatal.json");
const GOLD = join(ROOT, "worker/data/gold");
const doc = JSON.parse(readFileSync(FILE, "utf8"));

function goldByName() {
  const m = new Map();
  for (const f of readdirSync(GOLD).filter((x) => x.endsWith(".json"))) {
    try { const g = JSON.parse(readFileSync(join(GOLD, f), "utf8")); m.set(g.generic || f.replace(/\.json$/, ""), g); } catch (e) {}
  }
  return m;
}
function allText(v, out) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allText(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allText(x, out));
  return out;
}

test("monograph-neonatal.json is fresh (rebuild with scripts/neo/build-monograph-neonatal.mjs)", () => {
  assert.equal(readFileSync(FILE, "utf8"), JSON.stringify(build()) + "\n");
});

test("every statement is verbatim from its monograph, outside pregnancy and lactation", () => {
  const gold = goldByName();
  let n = 0;
  for (const [name, stmts] of Object.entries(doc.drugs)) {
    const g = gold.get(name);
    assert.ok(g, "no monograph for " + name);
    const body = Object.entries(g).filter(([k]) => !["preg", "lact", "refs", "tags"].includes(k)).map(([, v]) => allText(v, []).join("\n")).join("\n");
    for (const s of stmts) {
      if (s.row) {
        const hit = (g.dosage || []).some((r) => ["c", "r", "d", "t", "n"].every((k) => (r[k] || "") === s.row[k]));
        assert.ok(hit, name + ": dose row not in monograph: " + s.text.slice(0, 80));
      } else {
        assert.ok(body.includes(s.text), name + ": not verbatim: " + s.text.slice(0, 80));
      }
      assert.ok(NEO_RE.test(s.text), name + ": statement does not mention newborns: " + s.text.slice(0, 80));
      assert.ok(!MATERNAL.test(s.text), name + ": exposure through the mother: " + s.text.slice(0, 80));
      assert.ok(!/^Pregnancy|^Lactation/.test(s.section), name + ": maternal section " + s.section);
      n++;
    }
  }
  assert.ok(n > 300, "expected hundreds of statements, got " + n);
});

test("extract keeps newborn text and drops maternal sections", () => {
  const out = extract({ generic: "X", preg: "Avoid near term: neonatal withdrawal.", lact: "Monitor the newborn.",
    quick: [["Lactation", "Present in milk; weigh benefit vs neonatal risk"], ["Monitoring", "Watch for apnoea of prematurity"]],
    se: "Preterm labour reported. Neonatal withdrawal after 3rd trimester use.",
    pearls: "Take with food. Avoid in neonates: gasping syndrome.", dosage: [{ c: "Neonate", d: "5 mg/kg" }, { c: "Adult", d: "500 mg" }] });
  assert.deepEqual(out.map((s) => s.section), ["Quick facts", "Clinical pearls", "Dosing"]);
  assert.equal(out[0].text, "Watch for apnoea of prematurity");
  assert.equal(out[1].text, "Avoid in neonates: gasping syndrome.");
  assert.equal(out[2].row.d, "5 mg/kg");
});
