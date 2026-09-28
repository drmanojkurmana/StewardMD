import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const deck = JSON.parse(readFileSync("tokos/decks/ctg.json", "utf8"));
const credits = JSON.parse(readFileSync("tokos/media/credits.json", "utf8"));

test("ctg.json has a plausible, licence-attributable case set", () => {
  assert.equal(deck.v, 2);
  assert.ok(deck.cases.length >= 10, "expect at least 10 cases");
  deck.cases.forEach((c) => {
    assert.ok(/^\d+$/.test(c.id));
    assert.ok(existsSync("tokos/media/" + c.svg), c.svg + " missing");
    assert.ok(c.outcome.pH > 6.5 && c.outcome.pH < 7.6, "pH out of plausible range for " + c.id);
    assert.ok(["reduced", "normal", "increased"].includes(c.features.variabilityBand));
    assert.ok(c.features.decelCount >= 0);
  });
});

test("every case's data source is credited", () => {
  assert.ok(credits["ctu-uhb-ctgdb"]);
  assert.equal(credits["ctu-uhb-ctgdb"].licence, "ODC-BY 1.0");
});

test("credits carry the citation and PhysioNet source, and no case SVG embeds a <style>", () => {
  const c = credits["ctu-uhb-ctgdb"];
  assert.ok(c.citation.includes("BMC Pregnancy Childbirth"));
  assert.ok(c.citation.includes("2014;14:16"));
  assert.equal(c.source, "https://physionet.org/content/ctu-uhb-ctgdb/1.0.0/");
  readdirSync("tokos/media/ctg").forEach((f) => {
    assert.ok(!readFileSync("tokos/media/ctg/" + f, "utf8").includes("<style"), f + " has <style");
  });
});

test("v2 cases carry layout, vignette from real fields only, suggested labels and a null review", () => {
  const banned = ["cervix", "dilation", "oxytocin", "bp", "pulse", "temperature"];
  deck.cases.forEach((c) => {
    assert.ok(c.layout && c.layout.plotW > 0 && c.layout.durationSec > 0, c.id + " layout");
    Object.keys(c.vignette).forEach((k) => assert.ok(!banned.some((b) => k.toLowerCase().includes(b)), c.id + " invented field " + k));
    assert.ok(["normal", "suspicious", "pathological"].includes(c.figo));
    assert.ok(["normal", "metabolic", "acidaemia_not_metabolic", "acidaemia_unspecified", "unknown"].includes(c.acidosis));
    assert.ok(c.review === null || typeof c.review.by === "string");
    assert.ok(!("weightG" in c.vignette), "birth weight is an outcome, not a vignette field");
  });
});
