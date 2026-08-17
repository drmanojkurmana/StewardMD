// Anatomy Atlas — schema validation and catalog filtering.
// Also validates the REAL shipped JSON, so a bad hand-edit or a bad pipeline run
// fails `npm test` rather than rendering an invisible pin.
// Run: node test/atlas-data.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "atlas.js"), "utf8");
const mod = { exports: {} };
new Function("window", "document", "module", SRC)(
  { addEventListener() {} },
  { addEventListener() {}, getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }) },
  mod
);
const { validateAtlas, filterModules, groupByRegion } = mod.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

const good = () => ({
  id: "brain-mri-axial-t1",
  categories: { "white-matter": { label: "White matter", color: "#ffffff" } },
  structures: {
    fornix: { name: "Fornix", category: "white-matter", parent: "limbic", definition: "A white matter tract." },
    limbic: { name: "Limbic system", category: "white-matter" }
  },
  slices: [
    { i: 1, img: "/atlas/brain-mri-axial-t1/001.webp", aspect: 0.9, pins: [{ s: "fornix", x: 49.2, y: 55.8 }, { s: "fornix", x: 52.6, y: 55.4 }] },
    { i: 2, img: "/atlas/brain-mri-axial-t1/002.webp", aspect: 0.9, pins: [] }
  ]
});

ok("valid atlas has no errors", validateAtlas(good()).length === 0);

const withErr = (mut, label) => { const a = good(); mut(a); const e = validateAtlas(a); ok(label, e.length > 0); };
withErr((a) => { a.id = "Brain MRI"; }, "rejects non-kebab id");
withErr((a) => { delete a.id; }, "rejects missing id");
withErr((a) => { a.structures.fornix.category = "nope"; }, "rejects unknown category");
withErr((a) => { delete a.structures.fornix.name; }, "rejects structure without a name");
withErr((a) => { a.structures.fornix.parent = "ghost"; }, "rejects unknown parent");
withErr((a) => { a.structures.limbic.parent = "fornix"; }, "rejects parent cycle");
withErr((a) => { a.slices[0].pins[0].s = "ghost"; }, "rejects pin pointing at unknown structure");
withErr((a) => { a.slices[0].pins[0].x = 140; }, "rejects x out of range");
withErr((a) => { a.slices[0].pins[0].y = -3; }, "rejects y out of range");
withErr((a) => { a.slices[1].i = 5; }, "rejects non-contiguous slice index");
withErr((a) => { delete a.slices[0].img; }, "rejects slice without an image");
withErr((a) => { a.slices[0].aspect = 0; }, "rejects non-positive aspect");
withErr((a) => { a.slices = []; }, "rejects empty slice list");
ok("rejects a non-object", validateAtlas(null).length > 0);

// Duplicate structure ids on one slice are LEGAL — bilateral structures rely on it.
ok("duplicate pin ids are allowed", validateAtlas(good()).length === 0);

// A structure with no definition is legal (hierarchy-only parent).
const noDef = good(); delete noDef.structures.limbic.definition;
ok("definition is optional", validateAtlas(noDef).length === 0);

// --- catalog helpers ---
const MODS = [
  { id: "a", region: "Brain", modality: "MRI" },
  { id: "b", region: "Brain", modality: "CT" },
  { id: "c", region: "Spine", modality: "MRI" }
];
ok("no filter returns everything", filterModules(MODS, "", "").length === 3);
ok("region filter", filterModules(MODS, "Brain", "").map((m) => m.id).join("") === "ab");
ok("modality filter", filterModules(MODS, "", "MRI").map((m) => m.id).join("") === "ac");
ok("both filters", filterModules(MODS, "Brain", "MRI").map((m) => m.id).join("") === "a");
ok("no match returns empty", filterModules(MODS, "Brain", "Angiography").length === 0);
ok("empty input is safe", filterModules([], "", "").length === 0);

const grouped = groupByRegion(MODS);
ok("groups by region", grouped.length === 2);
ok("first-appearance order", grouped[0].region === "Brain" && grouped[1].region === "Spine");
ok("group holds its modules", grouped[0].modules.length === 2);

// --- the real shipped data must be valid ---
const cat = JSON.parse(readFileSync(join(ROOT, "atlas/modules.json"), "utf8"));
ok("modules.json has modules", Array.isArray(cat.modules) && cat.modules.length > 0);
for (const m of cat.modules) {
  ok("module " + m.id + " id is kebab-case", /^[a-z0-9-]+$/.test(m.id));
  ok("module " + m.id + " declares title/region/modality/slices",
    !!m.title && !!m.region && !!m.modality && m.slices > 0);
  const a = JSON.parse(readFileSync(join(ROOT, "atlas", m.id, "atlas.json"), "utf8"));
  const errs = validateAtlas(a);
  if (errs.length) console.log("   ", m.id, "->", errs.slice(0, 5).join(" | "));
  ok("shipped atlas " + m.id + " is valid", errs.length === 0);
  ok("shipped atlas " + m.id + " slice count matches catalog", a.slices.length === m.slices);
  ok("shipped atlas " + m.id + " renders no attribution", !a.provenance || typeof a.provenance === "object");
}

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
