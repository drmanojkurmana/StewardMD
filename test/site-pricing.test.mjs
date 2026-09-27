// The marketing site's price table must match the app's server price table (plans()).
// The site is static, so it carries a copy; this test fails the moment the two drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plans } from "../functions/api/billing/[[path]].js";

const html = readFileSync(new URL("../_site/index.html", import.meta.url), "utf8");
const block = html.slice(html.indexOf("var INDIVIDUAL = ["), html.indexOf("function assign("));
const rows = {};
for (const m of block.matchAll(/name: '([^']+)'[^}]*?m: (\d+)(?:, y: (\d+))?(?:, reg: (\d+))?/g)) rows[m[1]] = { m: +m[2], y: m[3] ? +m[3] : 0, reg: m[4] ? +m[4] : 0 };
const P = plans({});
const rs = paise => paise / 100;

test("every app tier is on the site at the app's monthly, annual and struck prices", () => {
  for (const t of Object.values(P.tiers)) {
    const label = t.label, r = rows[label];
    assert.ok(r, "site is missing tier " + label);
    assert.equal(r.m, rs(t.amount), label + " monthly");
    assert.equal(r.y, rs(t.annual), label + " annual");
    assert.equal(r.reg, rs(t.regular), label + " struck price");
  }
});

test("add-ons match the app", () => {
  assert.equal(rows["Physician Onco"].m, rs(P.addons.onco.amount));
  assert.equal(rows["Extra clinic"].m, rs(P.addons.clinic.amount));
});

test("the site offers only the cycles the app sells", () => {
  assert.ok(!/data-cycle="(quarterly|yearly)"/.test(html));
  assert.ok(/data-cycle="annual"/.test(html) && /data-cycle="monthly"/.test(html));
});
