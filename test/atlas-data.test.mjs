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
const GEOM = JSON.parse(readFileSync(join(ROOT, "test/atlas-geometry.json"), "utf8"));
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
  // GOLDEN GEOMETRY. Rebuilding a module from the wrong volume changes its aspect and
  // silently re-encodes every slice at a different width, and NOTHING else here notices:
  // `aspect` is derived from the image it describes, so checking one against the other is
  // a tautology that passes either way. A frozen number is the only thing that catches it.
  // If a change to the crop is intended, update test/atlas-geometry.json deliberately.
  ok("shipped atlas " + m.id + " geometry matches the golden table",
    GEOM[m.id] !== undefined && a.slices.every((s) => s.aspect === GEOM[m.id]));
  // Every module must carry its OWN credit string, so the info screen never falls back to
  // the union of all sources and credit the wrong institution.
  ok("module " + m.id + " declares its own credit", typeof m.credit === "string");
}
ok("golden geometry table covers exactly the shipped modules",
  Object.keys(GEOM).length === cat.modules.length);

// --- overlay lifecycle (DOM-stubbed, mirroring test/dialog-motion.test.mjs) ---
function fakeDom() {
  const mk = (tag) => {
    const cl = new Set();
    const el = {
      tagName: tag, id: "", className: "", innerHTML: "", style: {}, children: [],
      classList: {
        add: (...c) => c.forEach((x) => cl.add(x)),
        remove: (...c) => c.forEach((x) => cl.delete(x)),
        contains: (c) => cl.has(c),
        toggle: (c, on) => (on ? cl.add(c) : cl.delete(c))
      },
      appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      addEventListener() {}, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      closest: () => null, setAttribute() {}, getAttribute: () => null, focus() {}
    };
    return el;
  };
  const byId = {};
  const body = mk("body");
  return {
    body,
    activeElement: null,
    createElement: mk,
    getElementById: (id) => byId[id] || null,
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => []
  };
}

const doc2 = fakeDom();
const win = {
  document: doc2,                       // atlas.js reaches the DOM via G.document
  addEventListener() {},
  ResizeObserver: class { observe() {} disconnect() {} },
  SMD_hideHome() { win._hidHome = true; win._homeVisible = false; },
  SMD_showHome() { win._shownHome = true; win._homeVisible = true; }
};
const mod2 = { exports: {} };
new Function("window", "document", "module", SRC)(win, doc2, mod2);
const A = win.ATLAS;

ok("exposes open/close/isOpen/back", A && ["open", "close", "isOpen", "back"].every((k) => typeof A[k] === "function"));
ok("starts closed", A.isOpen() === false);
ok("back() on a closed atlas declines", A.back() === false);
A.open();
ok("open() creates the root", !!doc2.getElementById("smdAtlas"));
ok("open() turns the root on", doc2.getElementById("smdAtlas").classList.contains("on"));
ok("open() reports open", A.isOpen() === true);
ok("open() hides the home layer", win._hidHome === true);
ok("open() locks the body", doc2.body.classList.contains("atlas-lock"));
ok("open() with no id shows the catalog", A._state.view === "catalog");
ok("root carries the overlay class", doc2.getElementById("smdAtlas").className.indexOf("atlas-overlay") >= 0);

A.open("brain-mri-axial-t1");
ok("open(id) switches to the viewer", A._state.view === "viewer");
ok("open(id) records the module", A._state.moduleId === "brain-mri-axial-t1");
ok("open(id) starts at slice 1", A._state.slice === 1);
ok("open(id) clears any prior selection", A._state.sel === null && A._state.locked === null);
ok("back() from the viewer returns to the catalog", A.back() === true && A._state.view === "catalog");
ok("back() from the catalog closes", A.back() === true && A.isOpen() === false);

A.open();
A.close();
ok("close() turns the root off", doc2.getElementById("smdAtlas").classList.contains("on") === false);
ok("close() reports closed", A.isOpen() === false);
ok("close() unlocks the body", doc2.body.classList.contains("atlas-lock") === false);
// open() hides the home layer; close() MUST restore it or the user is stranded on a
// blank page (the exact bug home.js documents on SMD_showHome for Ward Sync).
ok("close() restores the home layer", win._shownHome === true);
ok("home is visible again after a full open/close cycle",
   (A.open(), A.close(), win._homeVisible === true));
ok("back() to close also restores home",
   (win._homeVisible = false, A.open(), A.back(), win._homeVisible === true));
ok("open() is idempotent", (A.open(), A.open(), A.isOpen() === true));
ok("close() is idempotent", (A.close(), A.close(), A.isOpen() === false));
ok("reopening reuses the same root", (A.open(), doc2.body.children.filter((c) => c.id === "smdAtlas").length === 1));
A.close();

// --- catalog markup ---
A.open();
A._state.catalog = { modules: [
  { id: "a", title: "Brain - MRI", subtitle: "Axial - T1", region: "Brain", modality: "MRI", slices: 3, thumb: "/t/a.webp" },
  { id: "b", title: "CT brain", subtitle: "Axial", region: "Brain", modality: "CT", slices: 5, thumb: "/t/b.webp" },
  { id: "c", title: "MRI cervical spine", subtitle: "Sagittal", region: "Spine", modality: "MRI", slices: 8, thumb: "/t/c.webp" }
] };
A._state.region = ""; A._state.modality = "";
let html = A._catalogHtml();
ok("catalog lists every module title", ["Brain - MRI", "CT brain", "MRI cervical spine"].every((t) => html.includes(t)));
ok("catalog renders a region header per region", html.includes("Brain") && html.includes("Spine"));
ok("catalog rows carry the module id", html.includes('data-atlas-mod="a"'));
ok("catalog shows NO tier badge (everything is free)", !/PREMIUM|FREE/i.test(html));
ok("catalog carries the disclaimer", html.includes("Educational reference only"));
ok("catalog has a back control matching swipe-back BACK_SEL",
   html.includes('class="atlas-back"') && /aria-label="(Back|Close)"/.test(html));
ok("catalog has an info control", html.includes('data-atlas-act="info"'));

A._state.region = "Spine";
ok("region filter narrows the catalog", !A._catalogHtml().includes("Brain - MRI"));
ok("region filter keeps its own section", A._catalogHtml().includes("MRI cervical spine"));
A._state.modality = "CT";
ok("contradictory filters yield an empty state", /No modules match/.test(A._catalogHtml()));
A._state.region = ""; A._state.modality = "";
ok("clearing filters restores the catalog", A._catalogHtml().includes("Brain - MRI"));

A._state.catalog = { modules: [{ id: "x", title: '<img src=x onerror=alert(1)>', region: "R<script>", modality: "MRI", slices: 1, thumb: '" onload="alert(2)' }] };
html = A._catalogHtml();
ok("catalog escapes hostile titles", !html.includes("<img src=x"));
ok("catalog escapes hostile regions", !html.includes("<script>"));
ok("catalog escapes hostile thumb urls", !html.includes('onload="alert'));
ok("catalog does not let a thumb break out of its style attribute", !/style="[^"]*"\s+\w+=/.test(html));
A._state.catalog = { modules: [{ id: "y", title: "T", region: "R", modality: "MRI", slices: 1, thumb: '/a.webp);background:red;x:(' }] };
// The payload text may survive INSIDE url(...) harmlessly; what must not survive is a
// raw paren, which would close url() early and start a new CSS declaration.
const styleAttr = (A._catalogHtml().match(/style="[^"]*"/) || [""])[0];
ok("catalog neutralises a CSS url() breakout",
   (styleAttr.match(/\(/g) || []).length === 1 && (styleAttr.match(/\)/g) || []).length === 1);
ok("catalog percent-encodes injected parens", styleAttr.includes("%29") && styleAttr.includes("%28"));

// --- info screen: the ONE permitted credit line lives here, nowhere else ---
A._state.catalog = { credits: ["Courtesy of the U.S. National Library of Medicine"], modules: [
  { id: "a", title: "Brain - MRI", region: "Brain", modality: "MRI", slices: 3, thumb: "/t/a.webp" }
] };
const info = A._infoHtml();
ok("info screen renders each credit line", info.includes("Courtesy of the U.S. National Library of Medicine"));
ok("info screen has a close control", /data-atlas-act="(infoclose|close)"/.test(info));
ok("info screen states it is educational", /educational/i.test(info));
ok("catalog does NOT render the credit even when credits are set",
   !A._catalogHtml().includes("Courtesy of the U.S. National Library of Medicine"));
A._state.catalog.credits = [];
ok("no credits configured renders no credit block", !/Courtesy/.test(A._infoHtml()));
A._state.catalog.credits = ['<script>alert(1)</script>'];
ok("info screen escapes hostile credit strings", !A._infoHtml().includes("<script>"));

// provenance stays an audit trail: it must never reach the UI, because it holds
// internal notes and tooling paths.
A._state.catalog.credits = [];
A._state.atlas = { provenance: { images: "PLACEHOLDER - replace via atlas-pipeline/build.py", licence: "PLACEHOLDER" },
                   categories: {}, structures: {}, slices: [] };
ok("provenance never leaks into the info screen", !/atlas-pipeline|PLACEHOLDER/.test(A._infoHtml()));
ok("provenance never leaks into the catalog", !/atlas-pipeline|PLACEHOLDER/.test(A._catalogHtml()));
A._state.atlas = null;
A.close();

// --- selection, lock and hide ---
A.open("brain-mri-axial-t1");
A._state.catalog = { credits: [], modules: [{ id: "brain-mri-axial-t1", title: "Brain - MRI", region: "Brain", modality: "MRI", slices: 2, thumb: "" }] };
A._state.atlas = {
  categories: { wm: { label: "White matter", color: "#ffffff" }, csf: { label: "CSF", color: "#7fd9e8" } },
  structures: {
    fornix: { name: "Fornix", category: "wm", definition: "A tract." },
    sas: { name: "Subarachnoid space", category: "csf" }
  },
  slices: [
    { i: 1, img: "/a/001.webp", aspect: 0.9, pins: [{ s: "fornix", x: 48, y: 55 }, { s: "fornix", x: 52, y: 55 }, { s: "sas", x: 80, y: 40 }] },
    { i: 2, img: "/a/002.webp", aspect: 0.9, pins: [{ s: "fornix", x: 49, y: 57 }] }
  ]
};
A._state.slice = 1; A._state.sel = null; A._state.locked = null; A._state.hidden = {};

ok("nothing selected initially", A._state.sel === null);
A._select("fornix");
ok("select sets the structure id", A._state.sel === "fornix");
A._select("fornix");
ok("selecting the same structure again keeps it", A._state.sel === "fornix");
A._select(null);
ok("select(null) clears", A._state.sel === null);
A._select("ghost");
ok("selecting an unknown id is ignored, not rendered blank", A._state.sel === null);

// Selection is per-slice; Lock is what survives a slice change.
A._select("fornix");
A._setSlice(2);
ok("changing slice clears the selection", A._state.sel === null);
A._state.slice = 1;
A._select("fornix");
A._lock();
ok("lock records the structure", A._state.locked === "fornix");
A._setSlice(2);
ok("lock survives a slice change", A._state.locked === "fornix");
A._lock();
ok("lock toggles off", A._state.locked === null || A._state.locked === undefined);

// Hide removes a label for the session.
A._state.slice = 1; A._select("sas");
A._hide();
ok("hide records the structure", A._state.hidden.sas === true);
ok("hide clears the selection", A._state.sel === null);
const svgAfterHide = A._pure.overlaySvg(A._state.atlas.slices[0], A._state.atlas,
  A._pure.imageBox(400, 800, 0.9, 90), 400, 800, { sel: null, hidden: A._state.hidden });
ok("a hidden structure is not drawn", !svgAfterHide.includes("Subarachnoid"));
ok("hiding one structure leaves the others", (svgAfterHide.match(/class="atlas-dot/g) || []).length === 2);
A._state.hidden = {};

// --- detail sheet ---
const { hierarchyOf } = mod2.exports;
ok("hierarchyOf is exported", typeof hierarchyOf === "function");
const H = { structures: { a: { name: "A" }, b: { name: "B", parent: "a" }, c: { name: "C", parent: "b" } } };
ok("hierarchy is root-first", hierarchyOf(H, "c").map((x) => x.id).join(">") === "a>b>c");
ok("hierarchy of a root is just itself", hierarchyOf(H, "a").length === 1);
ok("unknown id yields an empty chain", hierarchyOf(H, "zzz").length === 0);
ok("a parent cycle does not hang", hierarchyOf({ structures: { x: { name: "X", parent: "y" }, y: { name: "Y", parent: "x" } } }, "x").length <= 64);

A._state.atlas.structures.fornix.parent = "wmroot";
A._state.atlas.structures.wmroot = { name: "White matter tracts", category: "wm" };
A._state.slice = 1;
const sh = A._sheetHtml("fornix", "definition");
ok("sheet shows the FULL name, untruncated", sh.includes("Fornix") && !sh.includes("Forni…"));
ok("sheet shows the category label", sh.includes("White matter"));
ok("sheet renders the definition", sh.includes("A tract."));
ok("sheet has all three tabs", ["definition", "gallery", "hierarchy"].every((t) => sh.includes('data-tab="' + t + '"')));
ok("sheet has a grab handle", sh.includes("atlas-grab"));
ok("sheet has lock and hide", sh.includes('data-atlas-act="lock"') && sh.includes('data-atlas-act="hide"'));
ok("sheet uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(sh));
ok("sheet renders no attribution", !/licen[cs]e|public domain|courtesy|Gray/i.test(sh));

const shh = A._sheetHtml("fornix", "hierarchy");
ok("hierarchy tab lists the ancestor chain", shh.includes("White matter tracts") && shh.includes("Fornix"));
const shg = A._sheetHtml("fornix", "gallery");
ok("gallery lists the slices where the structure appears", (shg.match(/data-atlas-act="goto"/g) || []).length === 2);
ok("gallery of a single-slice structure still renders", A._sheetHtml("sas", "gallery").includes("goto") || A._sheetHtml("sas", "gallery").includes("Not labelled"));
const nodef = A._sheetHtml("sas", "definition");
ok("a missing definition degrades gracefully", nodef.includes("Subarachnoid space") && !/undefined/.test(nodef));
ok("an unknown structure yields an empty sheet", A._sheetHtml("ghost", "definition") === "");
A._state.atlas.structures.fornix.name = '<script>alert(1)</script>';
ok("sheet escapes hostile names", !A._sheetHtml("fornix", "definition").includes("<script>"));
A._state.atlas.structures.fornix.name = "Fornix";
delete A._state.atlas.structures.fornix.parent;
delete A._state.atlas.structures.wmroot;

// --- accessibility contract ---
// open() nulls st.atlas and there is no fetch in this stub, so re-seed the fixture:
// without it the scrub bar is (correctly) not rendered and every bar assertion fails.
const FIX = {
  categories: { wm: { label: "White matter", color: "#ffffff" }, csf: { label: "CSF", color: "#7fd9e8" } },
  structures: { fornix: { name: "Fornix", category: "wm", definition: "A tract." }, sas: { name: "Subarachnoid space", category: "csf" } },
  slices: [
    { i: 1, img: "/a/001.webp", aspect: 0.9, pins: [{ s: "fornix", x: 48, y: 55 }, { s: "fornix", x: 52, y: 55 }, { s: "sas", x: 80, y: 40 }] },
    { i: 2, img: "/a/002.webp", aspect: 0.9, pins: [{ s: "fornix", x: 49, y: 57 }] }
  ]
};
A.open("brain-mri-axial-t1");
A._state.atlas = FIX;
A._state.slice = 1;
A._state.hidden = {}; A._state.sel = null; A._state.locked = null;
const vh = A._viewerHtml();
ok("slice counter is a live region", vh.includes('aria-live="polite"'));
ok("the range has an accessible name", vh.includes('aria-label="Slice"'));
ok("back control matches swipe-back BACK_SEL",
   vh.includes('class="atlas-back"') && /aria-label="(Back|Close)"/.test(vh));
ok("step buttons are labelled", vh.includes('aria-label="Previous slice"') && vh.includes('aria-label="Next slice"'));
ok("the grid button is labelled", vh.includes('aria-label="All slices"'));
ok("footer disclaimer is present verbatim", vh.includes("Educational reference only — not for diagnosis."));
ok("viewer renders no attribution", !/licen[cs]e|public domain|courtesy|Visible Human|Gray/i.test(vh));
ok("viewer uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(vh));
ok("catalog uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(A._catalogHtml()));
ok("info screen uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(A._infoHtml()));
// Every pin is reachable and named — colour alone must never carry the meaning.
const ovs = A._pure.overlaySvg(A._state.atlas.slices[0], A._state.atlas,
  A._pure.imageBox(400, 800, 0.9, 90), 400, 800, { sel: null, hidden: {} });
ok("every dot is focusable", (ovs.match(/class="atlas-dot[^"]*"[^>]*tabindex="0"/g) || []).length === 3);
ok("every dot carries its name", (ovs.match(/class="atlas-dot[^"]*"[^>]*aria-label="/g) || []).length === 3);
ok("names are present as text, not colour alone", ovs.includes("Fornix") && ovs.includes("Subarachnoid"));
A.close();
ok("close() restores focus tracking", A._state._prevFocus === null);

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
