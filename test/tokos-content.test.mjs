import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const deck = JSON.parse(readFileSync("tokos/decks/ctg.json", "utf8"));
const credits = JSON.parse(readFileSync("tokos/media/credits.json", "utf8"));

test("ctg.json has a plausible, licence-attributable case set", () => {
  assert.equal(deck.v, 1);
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
