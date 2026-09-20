/* test/wsq-site-dialysis-page.test.mjs - R3-4 the Dialysis unit screen on wardsynq.com.
 *
 * Rendered from answers shaped like GET /api/queue/ward/dialysis-unit, /ward/dialysis-patient and /org/dialysis-settings
 * (built with dialysis.js's own readDialysisSettings and urr): loading and a failed read never look like an empty list,
 * unset settings say "not configured", URR shows its inputs or why it is not computable, recording is offered only with
 * emr.vitals, every word goes through the site catalog (a fake "xx" language marks it), and the home map offers the tile.
 *
 * node --test test/wsq-site-dialysis-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";
const { readDialysisSettings, urr } = await import("../functions/_wardsynq/dialysis.js");

const ctxOf = (env) => ({ esc: env.win.WSQ.esc, t: env.win.WSQ.t, tSafe: env.win.WSQ.tSafe, en: env.win.WSQ.en });
const load = (lang) => loadSite({ lang, pages: ["dialysis.js"] });
const SET = readDialysisSettings({ dialysis: { serologyGroups: ["HBsAg positive", "Negative"], maxReuses: 2, stations: [{ id: "hd-1", name: "HD 1", serologyGroup: "Negative" }] } });
const UNSET = readDialysisSettings(null);
const SESSION = (u) => ({ sessionId: "s1", version: 2, patientId: "p1", encounterId: "e1", stationId: "hd-1", stationName: "HD 1", accessType: "av-fistula",
  preWeightKg: 70, postWeightKg: 71, preBp: { systolic: 150, diastolic: 90 }, postBp: null, targetUfMl: 2000, achievedUfMl: 1500, weightReason: "Ward scale",
  startAt: "2026-09-17T04:00:00Z", endAt: null, dialyzerId: "DZ-1", reuseNumber: 1, complications: "Cramps", nurse: "Sister Anu", doctor: "Dr Rao",
  preUrea: { value: 120, unit: "mg/dL", observationId: "o1" }, postUrea: u, urr: urr({ value: 120, unit: "mg/dL", observationId: "o1" }, u), missingPost: u ? [] : ["postBp", "endAt"] });
const UNIT = (settings) => ({ ok: true, date: "2026-09-17", settings, accessTypes: ["av-fistula"],
  stations: settings.stations.map((s) => ({ ...s, bookings: [{ bookingId: "b1", patientId: "p1", name: "Ravi Menon", mrn: "MRN-500", startAt: "2026-09-17T04:00:00Z", minutes: 240 }] })),
  sessions: [], missingPost: [{ ...SESSION(null), name: "Ravi Menon", mrn: "MRN-500" }] });
const PATIENT = (settings, u) => ({ ok: true, settings, accessTypes: ["av-fistula", "av-graft"], patient: { patientId: "p1", name: "Ravi Menon", mrn: "MRN-500" },
  serology: settings.segregation ? { group: "Negative", testedOn: "2026-09-01", note: "ELISA" } : null,
  encounters: [{ encounterId: "e1", class: "OPD", status: "in-progress", periodStart: "2026-09-17T03:00:00Z" }],
  labResults: [{ observationId: "o1", code: "3094-0", value: 120, unit: "mg/dL", at: "2026-09-17T03:30:00Z" }],
  dialyzers: [{ dialyzerId: "DZ-1", firstUseAt: "2026-09-10T04:00:00Z", uses: 2, reuses: 1, discarded: true, discardedAt: "2026-09-17T09:00:00Z", discardReason: "Clotted" }],
  sessions: [SESSION(u)] });

test("dialysis screen: every visible word is translated in another language; recorded values are data", () => {
  const xx = load("xx"), c = ctxOf(xx), D = xx.win.WSQ._dialysis;
  const post = { value: 40, unit: "mg/dL", observationId: null, source: "Lab report 77" };
  const html = D.scheduleHtml(c, UNIT(SET)) + D.missingHtml(c, UNIT(SET)) + D.patientHtml(c, PATIENT(SET, post), null, true) + D.patientHtml(c, PATIENT(SET, null), SESSION(null), true) +
    D.settingsHtml(c, { ok: true, settings: SET }) + D.scheduleHtml(c, UNIT(UNSET)) + D.patientHtml(c, PATIENT(UNSET, null), null, true) + D.settingsHtml(c, { ok: true, settings: UNSET });
  assert.deepEqual(leftovers(html, ["HD 1", "Negative", "HBsAg positive, Negative", "HBsAg positive", "Ravi Menon", "MRN-500", "2026-09-17 04:00", "Ward scale", "Cramps", "Sister Anu · Dr Rao",
    "DZ-1", "Clotted", "ELISA", "120 mg/dL", "40 mg/dL", "Lab report 77", "70 / 71 kg", "150/90 / -", "2000 / 1500 mL", "OPD · 2026-09-17 03:00", "3094-0 · 120 mg/dL · 2026-09-17 03:30",
    "HD 1 · Negative", "hd-1 | HD 1 | Negative", "HBsAg positive; Negative"]), []);
});

test("dialysis screen: loading and a failed read never read as none; unset settings say not configured; URR shows inputs or why not", () => {
  const en = load("en"), c = ctxOf(en), D = en.win.WSQ._dialysis;
  assert.match(D.scheduleHtml(c, null), /Loading/);
  assert.match(D.missingHtml(c, { ok: false }), /Could not load sessions missing post-dialysis values\. Do not read this as none\./);
  assert.match(D.settingsHtml(c, { ok: false }), /Could not load the dialysis settings/);
  const unset = D.scheduleHtml(c, UNIT(UNSET));
  assert.match(unset, /Serology segregation: not configured/);
  assert.match(unset, /Dialyzer reuse: not configured/);
  assert.match(unset, /No stations are set/);
  assert.match(D.patientHtml(c, { ok: false, detail: "No patient has this hospital number." }, null, true), /could not be opened[\s\S]*No patient has this hospital number/);
  const done = D.patientHtml(c, PATIENT(SET, { value: 40, unit: "mg/dL", observationId: "o2" }), null, true);
  assert.match(done, /URR 66\.7%/);
  assert.match(done, /120 mg\/dL/);
  assert.match(done, /A dialyzer may be reused 2 times/);
  const pending = D.patientHtml(c, PATIENT(SET, null), null, true);
  assert.match(pending, /URR not computable:<\/?[^>]*>? ?no post-dialysis urea|URR not computable: no post-dialysis urea/);
  assert.doesNotMatch(pending, /URR 0/);
  assert.match(pending, /Kt\/V is not calculated/);
  assert.match(pending, /data-dy="session"/);
  const readOnly = D.patientHtml(c, PATIENT(SET, null), null, false);
  assert.doesNotMatch(readOnly, /data-dy="(session|book|dialyzer|serology)"/, "reading the chart offers no recording");
});

test("home map: the Dialysis unit tile opens for a nurse and not for the cashier", () => {
  const tileFor = (caps) => {
    const env = load("en");
    env.st.tokType = "staff"; env.st.orgId = "org-1";
    env.st.org = { id: "org-1", name: "Hosp", code: "H", mode: "wardsynq" };
    env.st.who = { name: "X", role: "x", caps };
    env.win.WSQ.render("home");
    const html = env.doc.getElementById("page").innerHTML;
    return (html.match(/<button type="button" class="tile" data-go="dialysis"[^>]*>/) || [""])[0];
  };
  const nurse = tileFor(["queue.view", "emr.vitals", "emr.view"]);
  assert.ok(nurse && !/disabled/.test(nurse), nurse);
  assert.ok(/disabled/.test(tileFor(["queue.view", "billing.charge"])));
});
