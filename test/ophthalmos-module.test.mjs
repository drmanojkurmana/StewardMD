// Ophthalmós: integration checks for the module copied in from github.com/drmanojkurmana/ophthalmos.
// Validates the REAL shipped JSON + wiring, so a bad re-sync or a dropped script tag fails `npm test`.
// Run: node test/ophthalmos-module.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

// Deck item counts, per the source repo's README.
const DECKS = { oct: 2064, disc: 705, dr: 1392, rop: 2020, cases: 60, mcq: 3035 };
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

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
