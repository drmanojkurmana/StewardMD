import { readFileSync } from "node:fs";
const src = p => readFileSync(new URL(p, import.meta.url), "utf8");
const window = {};
const document = {
  createElement: () => ({ style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }),
  getElementById: () => null, addEventListener() {}, body: { appendChild() {} }
};
new Function("window", "document", src("../calculators.js"))(window, document);
new Function("window", "document", src("../calc-links.js"))(window, document);
const CL = window.CALC_LINKS, ids = new Set(window.MEDCALC._calcs.map(c => c.id));
let fail = 0;
const ok = (c, m) => { if (!c) { console.log("FAIL " + m); fail++; } else console.log("PASS " + m); };

// every id referenced in LINKS and KW must be a real calculator
Object.entries(CL.LINKS).forEach(([k, arr]) => arr.forEach(id => ok(ids.has(id), `LINKS ${k} -> ${id} exists`)));
CL.KW.forEach(r => r.calcs.forEach(id => ok(ids.has(id), `KW ${r.re} -> ${id} exists`)));

// forDisease: explicit map wins, existence-filtered, capped, deduped
ok(CL.forDisease("acute_pancreatitis").includes("bisap"), "pancreatitis -> bisap");
ok(CL.forDisease("acute_pancreatitis").length <= 6, "capped at 6");
// keyword fallback by name when id unknown
ok(CL.forText("severe acute pancreatitis").includes("bisap"), "forText pancreatitis -> bisap");
ok(CL.forText("community acquired pneumonia").includes("curb65"), "forText pneumonia -> curb65");
ok(CL.forDisease("____nope____", "").length === 0, "unknown id + no name -> []");
// chipsHTML returns a data-calc button per id, empty string for none
ok(/data-calc="bisap"/.test(CL.chipsHTML(["bisap"])), "chipsHTML has data-calc");
ok(CL.chipsHTML([]) === "", "chipsHTML empty -> ''");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
