/* Organ art (NIH BioArt slim SVGs + organs.lib.js). No browser needed: the lib
 * runs in a vm with a stub DOM, and the slim files are checked as XML.
 * node --test test/fig-organs.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLIM = join(ROOT, "tools/figures/assets/organs/slim");
const LIB = readFileSync(join(ROOT, "tools/figures/scenes/organs.lib.js"), "utf8");

/* minimal XML well-formedness check (no deps): balanced tags, comments, CDATA */
function xmlOk(s) {
  const stack = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^?]*\?>|<!DOCTYPE[^>]*>|<\s*(\/?)\s*([A-Za-z][\w:.-]*)[^<>]*?(\/?)\s*>/g;
  let m, root = null;
  while ((m = re.exec(s))) {
    if (m[0].startsWith("<!--") || m[0].startsWith("<![CDATA") || m[0].startsWith("<?") || m[0].startsWith("<!DOCTYPE")) continue;
    const close = m[1] === "/", tag = m[2], self = m[3] === "/";
    if (close) { if (stack.pop() !== tag) return false; }
    else if (!self) { if (!root) root = tag; stack.push(tag); }
  }
  return root === "svg" && stack.length === 0;
}

function stubEl(tag) {
  return {
    tag, attrs: {}, children: [], innerHTML: "", style: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
  };
}
function loadLib() {
  const sandbox = {
    document: {
      getElementById: () => null,
      createElement: (t) => stubEl(t),
      createElementNS: (ns, t) => stubEl(t),
      head: { appendChild() {} },
    },
  };
  sandbox.mk = (name, attrs, parent) => {
    const el = sandbox.document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  sandbox.f1 = (v) => (+v).toFixed(1);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LIB, sandbox, { filename: "organs.lib.js" });
  return sandbox;
}
/* inject slim art the way bio-scene.mjs does (same files, same JSON escaping) */
const KIND_FILE = { liver: "liver-1", heart: "heart-1", kidney: "kidney-1", lung: "lung-1", stomach: "stomach-1", intestine: "intestine-1", brain: "brain-1", pancreas: "pancreas-1", spleen: "spleen-1" };
function injectArt(box, kinds) {
  let js = "";
  for (const k of kinds) {
    const svg = readFileSync(join(SLIM, KIND_FILE[k] + ".svg"), "utf8");
    const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    const pfx = (svg.match(/id="(oa[a-z]{3})-/) || [0, "oax" + k.slice(0, 3)])[1];
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    js += "_ORG_ART[" + JSON.stringify(k) + "]={vb:[" + vb.join(",") + "],pfx:" + JSON.stringify(pfx) + ",body:" + JSON.stringify(inner) + "};\n";
  }
  vm.runInContext(js, box, { filename: "organs-art.js" });
}
function walk(el, out) {
  out.push(el.tag);
  for (const c of el.children) walk(c, out);
  return out;
}

const slimFiles = readdirSync(SLIM).filter((f) => f.endsWith(".svg")).sort();

test("fig-organs: every slim svg parses and is under 90KB", () => {
  assert.ok(slimFiles.length >= 9, "slim art exists: " + slimFiles.join(","));
  for (const f of slimFiles) {
    const p = join(SLIM, f), s = readFileSync(p, "utf8");
    assert.ok(xmlOk(s), f + " is well-formed XML with an svg root");
    assert.match(s, /viewBox="[^"]+"/, f + " keeps its viewBox");
    assert.ok(statSync(p).size < 90 * 1024, f + " is under 90KB (" + statSync(p).size + "B)");
    assert.ok(!/base64|adobe_illustrator_pgf|<image/i.test(s), f + " has no raster blob or editor data");
  }
});

const EXPECTED_PORTS = {
  liver: ["in", "out", "porta", "gall", "lobe"],
  heart: ["in", "out", "aorta", "ivc", "apex", "pulm"],
  kidney: ["in", "out", "vein", "pelvis", "cortex", "hilum"],
  lung: ["in", "out", "trachea", "carina", "hilumL", "hilumR"],
  stomach: ["in", "out", "fundus", "antrum", "pylorus"],
  intestine: ["in", "out", "duodenum", "ileum", "colon", "rectum"],
  brain: ["in", "out", "parenchyma", "cereb", "frontal", "stem", "carotid"],
  pancreas: ["in", "out", "head", "tail", "body"],
  spleen: ["in", "out", "hilum", "pulp"],
  bladder: ["in", "out", "dome"],
  uterus: ["in", "out", "fundus"],
  thyroid: ["in", "out", "isthmus"],
};

test("fig-organs: organ() returns ports for each kind", () => {
  const box = loadLib();
  injectArt(box, Object.keys(KIND_FILE));
  const organ = vm.runInContext("organ", box);
  const kinds = vm.runInContext("organ.kinds", box);
  assert.deepEqual([...kinds].sort(), Object.keys(EXPECTED_PORTS).sort());
  for (const k of kinds) {
    const o = organ(stubEl("g"), k, 100, 100, 200, {});
    assert.equal(o.kind, k);
    assert.ok(o.h > 0 && Number.isFinite(o.h), k + " has a height");
    for (const p of EXPECTED_PORTS[k]) {
      assert.ok(Array.isArray(o.ports[p]), k + " has port " + p);
      assert.ok(o.ports[p].every(Number.isFinite), k + "." + p + " is numeric");
    }
    const wantArt = !(k === "bladder" || k === "uterus" || k === "thyroid");
    assert.equal(o.art, wantArt, k + (wantArt ? " uses art" : " falls back to procedural"));
  }
});

test("fig-organs: art path inlines paths, tint masks, dim dulls, flip mirrors", () => {
  const box = loadLib();
  injectArt(box, ["heart", "liver"]);
  const organ = vm.runInContext("organ", box);
  const plain = organ(stubEl("g"), "heart", 100, 100, 200, {});
  const tags = walk(plain.g, []);
  assert.ok(tags.includes("clipPath"), "art is clipped to its frame");
  const artG = plain.g.children[0].children.find((c) => c.attrs.class === "org-halo");
  assert.ok(artG.innerHTML.includes("<path"), "art group carries the slimmed paths");
  const tinted = organ(stubEl("g"), "heart", 100, 100, 200, { tint: "rgba(128,0,128,.45)" });
  const ttags = walk(tinted.g, []);
  assert.ok(ttags.includes("mask") && ttags.includes("use"), "tint adds an organ-shaped mask");
  const dimmed = organ(stubEl("g"), "liver", 100, 100, 200, { dim: true });
  const dimArt = dimmed.g.children[0].children.find((c) => (c.attrs.class || "").includes("org-halo"));
  assert.equal(dimArt.attrs.opacity, ".5");
  const flip = organ(stubEl("g"), "liver", 100, 100, 200, { flip: true });
  const noflip = organ(stubEl("g"), "liver", 100, 100, 200, {});
  for (const p of Object.keys(noflip.ports)) {
    assert.ok(Math.abs(flip.ports[p][0] - (200 - noflip.ports[p][0])) < 0.11, "flip mirrors " + p);
    assert.equal(flip.ports[p][1], noflip.ports[p][1]);
  }
});

test("fig-organs: hf/pe beat scales the outer g (art path has no children[1])", () => {
  const box = loadLib();
  injectArt(box, ["heart"]);
  const organ = vm.runInContext("organ", box);
  const o = organ(stubEl("g"), "heart", 175, 268, 170, {});
  assert.equal(o.g.children[1], undefined, "art outer g holds only the inner g: pages must not index children[1]");
  for (const f of ["hf.page.js", "pe.page.js"]) {
    const s = readFileSync(join(ROOT, "tools/figures/scenes", f), "utf8");
    assert.ok(!s.includes("children[1]"), f + " does not index children[1]");
    assert.ok(!s.includes("heartInner"), f + " does not use heartInner");
    assert.match(s, /heartO\.g\.setAttribute\("transform", "translate\(/, f + " beat-scales the outer g, preserving translate");
  }
  o.g.setAttribute("transform", "translate(175 268) scale(1.100)");
  assert.equal(o.g.attrs.transform, "translate(175 268) scale(1.100)", "beat keeps the organ centred");
});

test("fig-organs: hepenc pages credit NIH BioArt and stay under budget", () => {
  for (const f of ["hepatic-encephalopathy.html", "hepatic-encephalopathy-light.html"]) {
    const s = readFileSync(join(ROOT, "prep/figures", f), "utf8");
    assert.match(s, /Organ art is NIH BioArt Source, public domain/, f + " credits the art");
    assert.ok(s.includes('_ORG_ART["liver"]') && s.includes('_ORG_ART["brain"]'), f + " embeds liver and brain art");
    assert.ok(!s.includes('_ORG_ART["heart"]'), f + " embeds only the organs it uses");
  }
  const two = statSync(join(SLIM, "liver-1.svg")).size + statSync(join(SLIM, "brain-1.svg")).size;
  assert.ok(two < 150 * 1024, "liver+brain slim art is under 150KB (" + two + "B)");
});
