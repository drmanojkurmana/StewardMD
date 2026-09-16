/* test/wsq-site-ops-pages.test.mjs - the General stores, Assets and maintenance, and Blood bank screens on wardsynq.com.
 *
 * Each screen is rendered from a server answer shaped like GET /api/queue/ward/stores, /ward/assets and
 * /ward/blood-bank: loading (null) and a failed read never look like an empty list, the actions offered follow the
 * capability, every word on screen goes through the staff catalog (a fake "xx" language marks it), and the
 * recorded values (item, department, unit numbers) are shown as data. The home map offers the three tiles.
 *
 * node --test test/wsq-site-ops-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const ctxOf = (env) => ({ esc: env.win.WSQ.esc, t: env.win.WSQ.t, tSafe: env.win.WSQ.tSafe, en: env.win.WSQ.en });
/* GET /ward/blood-bank criteria as donor-criteria.js donorCriteriaFor answers for an Indian hospital with two stricter
 * settings, and for one outside India. */
const { donorCriteriaFor } = await import("../functions/_wardsynq/donor-criteria.js");
const SAVED = { minHbFemale: 13, deferrals: { tattoo: 400 } };
const CRITERIA = JSON.parse(JSON.stringify(donorCriteriaFor({ bloodDonorCriteria: SAVED }, "IN")));
const CRITERIA_US = JSON.parse(JSON.stringify(donorCriteriaFor(null, "US")));
const load = (lang) => loadSite({ lang, pages: ["stores.js", "assets.js", "bloodbank.js"] });

const STORES = {
  ok: true, categories: ["consumables", "linen"],
  items: [{ code: "GLOVE-M", name: "Gloves medium", category: "consumables", unit: "box", reorderLevel: 20, active: true }],
  locations: [{ code: "CS", name: "Central store", kind: "central", active: true }, { code: "MED-SUB", name: "Medicine ward store", kind: "sub-store", departmentId: "d1", departmentName: "General Medicine", active: true }],
  levels: [{ code: "GLOVE-M", display: "Gloves medium", location: "CS", unit: "box", level: 12, belowReorder: true }],
  negative: [], expiring: [],
  indents: [{ indentId: "i1", departmentId: "d1", departmentName: "General Medicine", fromLocation: "CS", toLocation: "MED-SUB", raisedAt: "2026-09-16T08:00:00Z", state: "part-issued",
    lines: [{ code: "GLOVE-M", display: "Gloves medium", unit: "box", requested: 40, approved: 30, issued: 20, backOrder: 10, acknowledged: 18, discrepancy: 2 }], decision: { decision: "approved" }, closure: null }],
};
const DATA_STORES = ["Gloves medium", "General Medicine", "CS", "MED-SUB", "Central store", "Medicine ward store", "40 box", "12 box", "GLOVE-M", "2026-09-16 08:00", "box", "(Gloves medium)", "Medicine ward store (General Medicine)", "Gloves medium (box)"];

test("stores: loading and a failed read are never an empty list; the store keeper gets issue, order and close; the in-charge does not", () => {
  const en = load("en"), c = ctxOf(en), S = en.win.WSQ._stores;
  assert.match(S.indentsHtml(c, null, {}), /Loading/);
  assert.match(S.indentsHtml(c, { ok: false }, {}), /Could not load indents\. Do not read this as none\./);
  assert.match(S.stockHtml(c, { ok: false }), /Do not read this as none/);
  const keeper = S.indentsHtml(c, STORES, { manage: true });
  assert.match(keeper, /data-st="issue"/); assert.match(keeper, /data-st="order"/); assert.match(keeper, /data-st="close"/);
  assert.doesNotMatch(keeper, /data-st="approve"/);
  const incharge = S.indentsHtml(c, { ...STORES, indents: [{ ...STORES.indents[0], state: "awaiting-approval" }] }, { approve: true });
  assert.match(incharge, /data-st="approve"/);
  assert.doesNotMatch(incharge, /data-st="issue"/);
  assert.match(S.stockHtml(c, STORES), /At or below reorder level/);
  assert.match(S.raiseHtml(c, { ...STORES, locations: [] }), /Stores are not set up yet/);
});

test("stores, assets, blood bank: every visible word is translated in another language; recorded values are data", () => {
  const xx = load("xx"), c = ctxOf(xx);
  const S = xx.win.WSQ._stores;
  const html = S.indentsHtml(c, STORES, { manage: true, request: true }) + S.stockHtml(c, STORES) + S.masterHtml(c, STORES) + S.locationsHtml(c, STORES, [{ id: "d1", name: "General Medicine" }]) + S.raiseHtml(c, STORES) + S.consumptionHtml(c, { ok: true, rows: [{ departmentName: "General Medicine", display: "Gloves medium", quantity: 40, unit: "box" }] });
  const orders = { ok: true, orders: [{ purchaseOrderId: "po1", indentId: "i1", vendor: "Acme Supplies", state: "open", lines: [{ index: 0, item: "GLOVE-M", unit: "box", ordered: 10, received: 0, outstanding: 10 }] }, { purchaseOrderId: "po2", vendor: "Pharma", state: "open", lines: [] }] };
  const oh = S.ordersHtml(c, orders, STORES);
  assert.match(oh, /data-st="bookin"/);
  assert.doesNotMatch(oh, /Pharma/, "a pharmacy order not raised from an indent is not on the stores screen");
  assert.deepEqual(leftovers(html + oh, [...DATA_STORES, "Acme Supplies", "10 box"]), []);

  const A = xx.win.WSQ._assets;
  const assets = { ok: true, now: "2026-09-16T00:00:00Z", categories: ["life-support"], statuses: [],
    assets: [{ assetId: "a1", tag: "BME-1", name: "Ventilator", category: "life-support", status: "under-repair", critical: true, departmentName: "ICU", location: "Bed 3", movements: [{ at: "2026-09-01T00:00:00Z", departmentName: "ICU", location: "Bed 3" }], statusHistory: [{ at: "2026-09-02T00:00:00Z", status: "under-repair", reason: "Alarm" }] }],
    jobCards: [{ jobCardId: "j1", assetId: "a1", kind: "pm", state: "assigned", scheduleId: "s1", reportedAt: "2026-09-10T00:00:00Z", engineer: "Ravi", parts: [], downtimeMinutes: null }],
    schedules: [{ scheduleId: "s1", assetId: "a1", tag: "BME-1", name: "Ventilator", kind: "pm", checklist: ["Filters"], overdue: true, dueOn: "2026-09-01" }],
    overduePm: [{ scheduleId: "s1", assetId: "a1", tag: "BME-1", name: "Ventilator", kind: "pm", overdue: true, dueOn: "2026-09-01" }], calibrationDue: [],
    contractAlerts: [{ assetId: "a1", tag: "BME-1", name: "Ventilator", kind: "AMC", until: "2026-10-01", daysLeft: 15 }], uptime: [{ tag: "BME-1", name: "Ventilator", uptime: 0.99, windowDays: 90, downMinutes: 180 }] };
  const ahtml = A.complaintHtml(c, assets) + A.jobsHtml(c, assets, true) + A.dueHtml(c, assets) + A.registerHtml(c, assets, [{ id: "d1", name: "ICU" }]);
  assert.deepEqual(leftovers(ahtml, ["BME-1", "Ventilator", "ICU", "Bed 3", "Ravi", "Filters", "Alarm", "BME-1 · Ventilator", "BME-1 · Ventilator · Bed 3", "ICU · Bed 3", "2026-09-01 00:00", "2026-09-02 00:00", "2026-09-10 00:00"]), []);

  const B = xx.win.WSQ._bloodbank;
  const bank = { ok: true, now: "2026-09-16T00:00:00Z", questions: ["illness", "high-risk"], tti: ["hiv", "malaria"],
    criteria: CRITERIA,
    components: [{ component: "prbc", shelfDays: 42, storage: "2 to 6 C" }],
    donors: [{ donorId: "dn1", donorNumber: "D-1", name: "Asha", dateOfBirth: "1990-01-01", deferral: { permanent: false, until: "2026-12-01T00:00:00Z", reason: "Low Hb" } }],
    screenings: [{ screeningId: "sc1", donorId: "dn1", outcome: "eligible", used: false, at: "2026-09-15T12:00:00Z" }],
    donations: [{ donationId: "do1", bagNumber: "BAG-1", donorId: "dn1", volumeMl: 450, collectedAt: "2026-09-15T13:00:00Z", tests: { state: "cleared", group: { abo: "O", rhD: "positive" } }, units: 1 }],
    units: [{ unitId: "u1", unitNumber: "BAG-1-PRBC", component: "prbc", abo: "O", rhD: "positive", expiresAt: "2026-10-27T00:00:00Z", storage: "2 to 6 C", status: "available" }],
    inventory: [{ group: "O+", component: "prbc", available: 1, soonestExpiry: "2026-10-27T00:00:00Z" }], expiryAlerts: [] };
  const bhtml = B.inventoryHtml(c, bank) + B.unitsHtml(c, bank) + B.donorsHtml(c, bank) + B.donationsHtml(c, bank);
  assert.deepEqual(leftovers(bhtml, ["BAG-1-PRBC", "BAG-1", "O+", "2 to 6 C", "D-1 · Asha · 1990-01-01", "D-1 · Asha", "Low Hb", "BAG-1 · D-1 · Asha · 450 mL", "D-1 · Asha · 2026-09-15 12:00", "350 mL", "450 mL", "O", "A", "B", "AB", "2026-10-27 00:00", "2026-09-15 13:00"]), []);
});

test("blood bank and Admin > Hospital: each criterion in force names where it comes from (WHO section, Schedule F item, both, or this hospital); each question's window is the deferral in force; Admin edits only stricter values", () => {
  const en = load("en"), c = ctxOf(en), B = en.win.WSQ._bloodbank;
  const bank = (criteria) => ({ ok: true, now: "2026-09-17T00:00:00Z", questions: criteria.questions, criteria, donors: [] });
  const html = B.donorsHtml(c, bank(CRITERIA)).replace(/&#39;/g, "'");
  assert.match(html, /stricter of the WHO blood donor selection guidelines \(2012\) and the Drugs and Cosmetics Rules 1945, Schedule F Part XII-B/);
  assert.match(html, /WHO blood donor selection guidelines \(2012\), section 4\.6\.1/, "men's haemoglobin: WHO is stricter");
  assert.match(html, /Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, item 4 \(stricter than WHO\)/, "intervals: the law is stricter");
  assert.match(html, /WHO 2012 section 4\.1\.1, and Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, item 2/, "minimum age: both say 18");
  assert.match(html, /This hospital's stricter setting/);
  assert.match(html, /more than 55/);
  assert.match(html, /Malaria in the last 183 days/);
  assert.match(html, /Tattoo, piercing, acupuncture or other skin-piercing procedure in the last 400 days/, "the window follows this hospital's longer deferral");
  assert.match(html, /A resident of another country who has lived in India for less than 1096 days/);
  assert.match(html, /<option value="hepatitis-b-c-unknown">Hepatitis B, C or of unknown cause \(permanent\)<\/option>/);
  assert.match(html, /id="bbScHbM"/); assert.match(html, /id="bbScType"/); assert.match(html, /id="bbScPulseReg"/); assert.match(html, /id="bbScCond1"/);
  const us = B.donorsHtml(c, bank(CRITERIA_US)).replace(/&#39;/g, "'");
  assert.match(us, /Council of Europe blood components guide \(22nd edition, 2025\), standard 2\.4\.1\.4/);
  assert.match(us, /Neither standard sets a value/);
  assert.doesNotMatch(us, /lived in India/);
  assert.doesNotMatch(B.criteriaTableHtml(c, CRITERIA, false), /data-crit=/, "the blood bank reads the criteria; only Admin edits them");
  const adm = loadSite({ lang: "en", pages: ["bloodbank.js", "admin.js"] }), ac = ctxOf(adm);
  ac.ms = () => "";
  const card = adm.win.WSQ._donorCriteriaHtml;
  assert.match(card(ac, undefined), /Loading donor criteria/);
  assert.match(card(ac, null).replace(/&#39;/g, "'"), /Do not read this as the standard's values being in force/);
  const form = card(ac, { ok: true, criteria: CRITERIA, saved: SAVED });
  assert.match(form, /data-crit="minHbFemale" value="13" placeholder="12.5"/);
  assert.match(form, /data-crit="minWeightKg450" value="" placeholder="more than 55"/);
  assert.match(form, /data-crit="deferrals.tattoo" value="400" placeholder="366"/);
  assert.doesNotMatch(form, /data-crit="deferrals.hepatitis-b-c-unknown"/, "a permanent deferral cannot be made stricter");
  assert.match(card(ac, { ok: true, criteria: CRITERIA_US, saved: {} }), /data-crit="systolicMax" value="" placeholder="WHO suggests 140"/);
  const xx = loadSite({ lang: "xx", pages: ["bloodbank.js", "admin.js"] }), xc = ctxOf(xx);
  xc.ms = () => "";
  assert.deepEqual(leftovers(xx.win.WSQ._donorCriteriaHtml(xc, { ok: true, criteria: CRITERIA, saved: {} }) + xx.win.WSQ._bloodbank.donorsHtml(xc, bank(CRITERIA)), ["120/80"]), []);
});

test("blood bank: a failed read says to check the shelf, never no units", () => {
  const en = load("en"), c = ctxOf(en), B = en.win.WSQ._bloodbank;
  assert.match(B.inventoryHtml(c, { ok: false }), /Do not read this as no units: check the shelf/);
  assert.match(B.inventoryHtml(c, null), /Loading/);
  assert.match(B.inventoryHtml(c, { ok: true, inventory: [], expiryAlerts: [] }), /No unit is available/);
  const A = en.win.WSQ._assets;
  assert.match(A.dueHtml(c, { ok: true, overduePm: null }), /cannot read maintenance schedules/);
});

test("home map: General stores, Assets and maintenance, and Blood bank tiles, each opening for its own roles", () => {
  const env = load("en");
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Hosp", code: "H", mode: "wardsynq" };
  env.st.who = { name: "Store", role: "store_keeper", caps: ["queue.view", "stores.manage", "dept.request"] };
  env.win.WSQ.render("home");
  const html = env.doc.getElementById("page").innerHTML;
  const tile = (go) => (html.match(new RegExp('<button type="button" class="tile" data-go="' + go + '"[^>]*>')) || [""])[0];
  assert.ok(tile("stores") && !/disabled/.test(tile("stores")), "the store keeper opens General stores");
  assert.ok(tile("assets") && !/disabled/.test(tile("assets")), "and can report broken equipment");
  assert.ok(/disabled/.test(tile("bloodbank")), "but not the blood bank");
  assert.ok(tile("ward:purchasing") && !/disabled/.test(tile("ward:purchasing")), "and orders through Purchasing");
});
