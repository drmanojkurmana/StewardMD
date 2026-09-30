// Ophthalmós: integration checks for the module copied in from github.com/drmanojkurmana/ophthalmos.
// Validates the REAL shipped JSON + wiring, so a bad re-sync or a dropped script tag fails `npm test`.
// Run: node test/ophthalmos-module.test.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

// Deck item counts, per the source repo's README.
const DECKS = { oct: 2064, disc: 705, dr: 1392, rop: 2020, cases: 60, mcq: 3035, rfmid: 438 };
for (const [name, count] of Object.entries(DECKS)) {
  const d = JSON.parse(readFileSync(join(ROOT, "ophthalmos/decks", name + ".json"), "utf8"));
  ok("ophthalmos/decks/" + name + ".json parses as JSON", typeof d === "object" && d !== null);
  ok("ophthalmos/decks/" + name + ".json has " + count + " items", Array.isArray(d.items) && d.items.length === count);
}

// No em-dash anywhere in tracks.json content (app-facing text must not use one).
{
  const raw = readFileSync(join(ROOT, "ophthalmos/tracks.json"), "utf8");
  ok("ophthalmos/tracks.json has no em-dash", !raw.includes("\u2014"));
}

// index.html loads the five scripts in the documented order: core, data, stage, ophthalmos, screens.
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const files = ["ophthalmos-core.js", "ophthalmos-data.js", "ophthalmos-stage.js", "ophthalmos.js", "ophthalmos-screens.js"];
  const positions = files.map((f) => html.indexOf(f));
  ok("index.html loads all five ophthalmos scripts", positions.every((p) => p >= 0));
  ok("index.html loads them in load order", positions.every((p, i) => i === 0 || p > positions[i - 1]));
  ok("index.html loads ophthalmos.css", html.includes("ophthalmos.css"));
}

// notes.json: 30 illustrated notes, marked as drafts, no em-dash.
{
  const raw = readFileSync(join(ROOT, "ophthalmos/notes.json"), "utf8"), n = JSON.parse(raw);
  ok("ophthalmos/notes.json has 30 notes", Array.isArray(n.notes) && n.notes.length === 30);
  ok("ophthalmos/notes.json is marked ai_drafted", n.review === "ai_drafted");
  ok("ophthalmos/notes.json has no em-dash", !raw.includes("\u2014"));
}

// index.html loads the feature files after the screens, each with its stylesheet.
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8"), base = html.indexOf("ophthalmos-screens.js");
  for (const f of ["ophthalmos-mcq", "ophthalmos-notes", "ophthalmos-retino-model", "ophthalmos-retino", "ophthalmos-neuro", "ophthalmos-tools-model", "ophthalmos-tools"]) {
    const i = html.indexOf("/" + f + ".js");
    ok("index.html loads " + f + ".js after the screens", i > base);
  }
  for (const f of ["mcq", "notes", "retino", "neuro", "tools"]) ok("index.html loads ophthalmos-" + f + ".css", html.includes("/ophthalmos-" + f + ".css"));
}

// home.js: the tile and the action.
{
  const src = readFileSync(join(ROOT, "home.js"), "utf8");
  ok("home.js has the ophthalmos tile", /act:\s*"ophthalmos"[\s\S]{0,200}tt:\s*"Ophthalm/.test(src));
  ok("home.js has the ophthalmos action", /ophthalmos:\s*function\s*\(\)/.test(src));
}

// scripts/build-www.sh copies ophthalmos/.
{
  const src = readFileSync(join(ROOT, "scripts/build-www.sh"), "utf8");
  ok("build-www.sh copies ophthalmos/", /ophthalmos\/decks/.test(src));
  ok("build-www.sh copies ophthalmos/notes.json", /ophthalmos\/notes\.json/.test(src));
}

// Learn tab: ophthalmos/learn/ (index, glossary, lessons, diagrams, media + credits) is synced and complete.
{
  const LEARN = join(ROOT, "ophthalmos/learn");
  const readJSON = (p) => { try { return JSON.parse(readFileSync(join(LEARN, p), "utf8")); } catch { return null; } };
  const noDash = (p) => { try { return !readFileSync(join(LEARN, p), "utf8").includes("—"); } catch { return false; } };
  const ix = readJSON("index.json"), gloss = readJSON("glossary.json");
  ok("ophthalmos/learn/index.json parses with units", !!ix && Array.isArray(ix.units) && ix.units.length > 0);
  ok("ophthalmos/learn/glossary.json parses with terms", !!gloss && typeof gloss.terms === "object" && gloss.terms !== null);
  ok("ophthalmos/learn index + glossary have no em-dash", noDash("index.json") && noDash("glossary.json"));
  const ids = ix && Array.isArray(ix.units) ? ix.units.flatMap((u) => u.lessons || []) : [];
  ok("ophthalmos/learn/index.json lists lessons", ids.length > 0);
  for (const id of ids) {
    const l = readJSON("lessons/" + id + ".json");
    ok("learn lesson " + id + " parses and its id matches the file", !!l && l.id === id);
    ok("learn lesson " + id + " has no em-dash", noDash("lessons/" + id + ".json"));
    if (l && l.see && l.see.diagram) ok("learn lesson " + id + " diagram " + l.see.diagram + " exists", existsSync(join(LEARN, l.see.diagram)));
  }
  const cr = readJSON("media/credits.json"), items = cr && Array.isArray(cr.items) ? cr.items : [];
  ok("ophthalmos/learn/media/credits.json lists media", items.length > 0);
  for (const it of items) ok("learn media " + it.file + " exists", !!it.file && existsSync(join(LEARN, "media", it.file)));
  // Every shipped media file carries a credit (licence hygiene: open-licence items keep their attribution).
  const credited = new Set(items.map((it) => it.file));
  const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);
  const media = walk(join(LEARN, "media")).map((f) => relative(join(LEARN, "media"), f)).filter((f) => f !== "credits.json");
  ok("every learn media file is credited in credits.json", media.length > 0 && media.every((f) => credited.has(f)));
}

// index.html loads the Learn tab after every other feature file, with its stylesheet; one ?v= token for all.
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const learn = html.indexOf("/ophthalmos-learn.js"), tools = html.indexOf("/ophthalmos-tools.js");
  ok("index.html loads ophthalmos-learn.js after the other feature files", learn > tools && tools > 0);
  ok("index.html loads ophthalmos-learn.css", html.includes("/ophthalmos-learn.css"));
  const tokens = new Set([...html.matchAll(/\/ophthalmos[\w-]*\.(?:js|css)\?v=([\w.-]+)/g)].map((m) => m[1]));
  ok("every Ophthalmós tag in index.html shares one ?v= token (got " + [...tokens].join(",") + ")", tokens.size === 1);
}

// scripts/build-www.sh ships ophthalmos/learn/ (lessons, diagrams, media) into the native bundle.
{
  const src = readFileSync(join(ROOT, "scripts/build-www.sh"), "utf8");
  ok("build-www.sh copies ophthalmos/learn", /cp -R ophthalmos\/learn\b/.test(src));
}

// Byte identity with the module repo: test/ophthalmos-sync.json holds the sha256 of every synced file at the module
// commit it names. Every copy must match, and no Ophthalmós file may exist here that the module does not ship.
{
  const sync = JSON.parse(readFileSync(join(ROOT, "test/ophthalmos-sync.json"), "utf8"));
  const sha = (f) => createHash("sha256").update(readFileSync(join(ROOT, f))).digest("hex");
  const listed = Object.keys(sync.files);
  ok("ophthalmos-sync.json names its module commit and lists the synced files", /^[0-9a-f]{40}$/.test(sync.commit) && listed.length > 200);
  for (const f of listed) ok("byte-identical to the module repo: " + f, existsSync(join(ROOT, f)) && sha(f) === sync.files[f]);
  const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).flatMap((e) => e.isDirectory() ? walk(d + "/" + e.name) : [d + "/" + e.name]);
  const here = readdirSync(ROOT).filter((f) => /^ophthalmos[\w-]*\.(js|css)$/.test(f)).concat(walk("ophthalmos"));
  const extra = here.filter((f) => !(f in sync.files));
  ok("no Ophthalmós file here that the module does not ship" + (extra.length ? ": " + extra.slice(0, 5).join(", ") : ""), extra.length === 0);
}

// Explore (ophthalmos-explore.js / .css) loads right after Learn; every Ophthalmós tag carries the oph11 token.
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const learnJs = html.indexOf("/ophthalmos-learn.js"), exJs = html.indexOf("/ophthalmos-explore.js");
  const learnCss = html.indexOf("/ophthalmos-learn.css"), exCss = html.indexOf("/ophthalmos-explore.css");
  ok("index.html loads ophthalmos-explore.js right after ophthalmos-learn.js", exJs > learnJs && learnJs > 0 && html.indexOf("<script", learnJs) === html.lastIndexOf("<script", exJs));
  ok("index.html loads ophthalmos-explore.css after ophthalmos-learn.css", exCss > learnCss && learnCss > 0);
  const tags = [...html.matchAll(/\/ophthalmos[\w-]*\.(?:js|css)\?v=([\w.-]+)/g)];
  ok("every Ophthalmós tag in index.html is ?v=oph11 (" + tags.length + " tags)", tags.length === 22 && tags.every((m) => m[1] === "oph11"));
}

// Learn loads lessons on open: index.json carries a summary for every listed lesson (title, minutes, picture).
{
  const ix = JSON.parse(readFileSync(join(ROOT, "ophthalmos/learn/index.json"), "utf8"));
  const ids = ix.units.flatMap((u) => u.lessons), m = ix.lessons || {};
  ok("learn/index.json lists the 19 units and 107 lessons", ix.units.length === 19 && ids.length === 107);
  ok("learn/index.json has a summary for every listed lesson", ids.every((id) => m[id] && m[id].title && m[id].title.en && m[id].minutes > 0 && m[id].see && (m[id].see.img || m[id].see.diagram)));
}

// scripts/build-www.sh: root *.js and *.css by glob (so ophthalmos-explore.js / .css ship) and the learn tree.
{
  const src = readFileSync(join(ROOT, "scripts/build-www.sh"), "utf8");
  ok("build-www.sh copies every root *.js (ophthalmos-explore.js)", /for f in \*\.js; do/.test(src));
  ok("build-www.sh copies every root *.css (ophthalmos-explore.css)", /for f in \*\.css; do/.test(src));
}

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
