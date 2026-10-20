// Blinatumomab mechanism figure: registry, mastery, pages and OncQis exposure.
// node --test --experimental-test-module-mocks --experimental-sqlite test/fig-blinatumomab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { FIELDS, problems } from "../tools/figures/dev/mastery-merge.mjs";

const ID = "blinatumomab-mechanism-adverse-effects";
const cfg = JSON.parse(readFileSync(new URL("../prep/figures/figures.json", import.meta.url), "utf8"));
const MS = JSON.parse(readFileSync(new URL("../prep/figures/mastery.json", import.meta.url), "utf8"));
const entry = cfg.figures.find((f) => f.id === ID);

test("registry exposes the blinatumomab drug key with brand alias and bounded terms", () => {
  assert.ok(entry, "registered in figures.json");
  assert.equal(entry.page, "prep/figures/" + ID + ".html");
  assert.equal(entry.scene, true);
  assert.deepEqual(entry.drugs, { blinatumomab: "d=1" });
  const terms = entry.terms.join(" ");
  assert.match(terms, /Blincyto/, "brand alias present");
  assert.match(terms, /CD19/, "CD19 present");
  assert.match(terms, /ICANS/, "ICANS present");
  for (const t of entry.terms) {
    let rx = null;
    assert.doesNotThrow(() => { rx = new RegExp("(?:^|[^a-z])(" + t + ")(?![a-z])", "gi"); }, t + " is a valid regex");
    assert.ok(!/bite/i.test(t) || /bispecific/i.test(t), t + " never matches a bare English word");
  }
  // CD markers stay word-bounded so CD31/CD34/CD38 laboratory codes never match.
  const cd = entry.terms.filter((t) => /CD1|CD3/.test(t));
  assert.ok(cd.length > 0 && cd.every((t) => /\\b/.test(t)), "CD terms carry \\b guards: " + cd.join(","));
});

test("oncology home lists the figure through its mechanism adverse effects suffix", () => {
  const src = readFileSync(new URL("../onco-home.js", import.meta.url), "utf8");
  const m = src.match(/var ONC_FIG = (\/.*?\/);/);
  assert.ok(m, "ONC_FIG filter found");
  assert.ok(eval(m[1]).test(ID), ID + " passes the OncQis figure filter");
});

test("mastery entry is registered, complete and valid", () => {
  const e = MS.items[ID];
  assert.ok(e, "mastery entry present");
  assert.deepEqual(Object.keys(e).sort(), [...FIELDS].sort());
  assert.deepEqual(problems(e), []);
  assert.match(e.mechanism, /CD19|CD3/, "names the bridged targets");
  assert.match(e.adverse, /not fully understood/, "ICANS mechanism stays openly unknown");
  assert.ok(!/tocilizumab/i.test(e.intervention + e.adverse), "no rescue-agent efficacy claim");
});

test("paused toxicity state stops bridging and killing while burden persists", () => {
  const gen = readFileSync(new URL("../tools/figures/scenes/blina.mjs", import.meta.url), "utf8");
  assert.match(gen, /const on = drug === 1 \? 1 : 0/, "only the running infusion bridges");
  assert.match(gen, /exposed = drug >= 1/, "prior B cell depletion persists through the pause");
  assert.match(gen, /0\.5 \* peakC/, "paused cytokines ease from the peak");
  assert.match(gen, /0\.6 \* peakN/, "paused neurotoxicity eases from the peak");
  assert.ok(gen.includes("infusion paused: toxicity care"), "third state is an explicit pause");
  assert.ok(!gen.includes("with toxicity care"), "old management label is gone");
  const page = readFileSync(new URL("../tools/figures/scenes/blina.page.js", import.meta.url), "utf8");
  for (const line of page.split("\n").filter((l) => l.includes("d === 2"))) {
    assert.match(line, /[Pp]aus/, "paused caption says paused: " + line.slice(0, 60));
    assert.ok(!/keep dying|runs on|bridge holds/i.test(line), "pause never claims killing continues: " + line.slice(0, 60));
  }
  assert.match(page, /further blast clearing is not assumed/, "pause caption disclaims continued efficacy");
});

test("mastery and compare labels never imply rescue preserves efficacy", () => {
  const e = MS.items[ID];
  assert.match(e.intervention, /infusion is held/, "pause is stated");
  assert.match(e.intervention, /not assumed/, "no continued-clearing claim");
  assert.ok(!/Continuous/i.test(e.intervention), "no continuous-infusion efficacy promise");
  const gen = readFileSync(new URL("../tools/figures/scenes/blina.mjs", import.meta.url), "utf8");
  assert.match(gen, /withLabel: "Infusion paused"/, "compare label names the pause");
});

test("dark and light pages exist with sources, and carry no em or en dash", () => {
  for (const suffix of ["", "-light"]) {
    const p = "../prep/figures/" + ID + suffix + ".html";
    assert.ok(existsSync(new URL(p, import.meta.url)), p + " generated");
    const html = readFileSync(new URL(p, import.meta.url), "utf8");
    assert.match(html, /Blinatumomab/, "titles the drug");
    assert.match(html, /accessdata\.fda\.gov/, "cites the FDA label");
    assert.match(html, /ICANS/, "names ICANS");
    assert.match(html, /infusion paused/i, "ships the explicit pause state");
    assert.match(html, /AI-assisted and awaits clinician review/, "review marking matches neighboring scenes");
    assert.ok(!/<script[^>]+src=/.test(html), "loads no external script");
    assert.ok(!/—|–/.test(html.replace(/<style>[\s\S]*?<\/style>/g, "")), "no em or en dash in text");
  }
  assert.ok(existsSync(new URL("../tools/figures/specs/" + ID + ".json", import.meta.url)), "scene spec stub present");
});
