/* CDSCO "new drugs approved" lists: the evidence behind a Clinical Bulletin's India status.
 *
 * Network and Workers AI are mocked; the page, iframe and PDF layouts mirror what cdsco.gov.in served on
 * 2026-09-28. What must hold: only yearly new-drug lists from 2020 on are read; the PDF address comes out
 * of the download page's iframe; a drug is found with its own entry and approval date; a refresh only
 * re-downloads missing, re-released or recent lists, at most 3 a run, and does nothing without Workers AI;
 * lookups are for signers only and never set a bulletin's India status.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/cdsco.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-owner-doc": { sub: "u-owner", email: "drmanojkurmana@gmail.com", email_verified: true, verified: true },
  "tok-doc2": { sub: "u-doc2", email: "doc2@example.com", email_verified: true, verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
const realAdmin = await import("../functions/_fbadmin.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[((req.headers && req.headers.get("Authorization")) || "").replace(/^Bearer\s+/i, "")] || null } });
mock.module("../functions/_fbadmin.js", { namedExports: { ...realAdmin, getUserClaims: async () => ({ verified: true }), lookupUidByEmail: async () => null } });

const { parseListPage, iframePdf, findInList, refreshCdscoLists, lookup } = await import("../functions/_cdsco.js");
const { onRequest } = await import("../functions/api/updates/[[path]].js");

const row = (n, title, release, id) => `<tr><td>${n}</td><td>${title}</td><td>${release}</td><td><a href='/opencms/opencms/system/modules/CDSCO.WEB/elements/download_file_division.jsp?num_id=${id}='><img src='x.png'></a></td><td>11 KB</td></tr>`;
const PAGE = `<table><tr><th>S.no</th><th>Title</th><th>Release Date</th><th>Download Pdf</th><th>Pdf Size</th></tr>` +
  row(1, "List of new drugs approved in the year 2001", "2026-Jul-02", "A1") +
  row(2, "List of New Drugs approved in year 2026 to till date", "2026-Mar-12", "A2026") +
  row(3, "List of New Drugs approved in year 2025 to till date", "2025-Oct-29", "A2025") +
  row(4, "List of new drugs approved in the year 2024 till date", "2024-Dec-27", "A2024") +
  row(5, "List of new drugs approved in the year 2023 till date", "2023-Dec-29", "A2023") +
  row(6, "Additional Approval status of drugs from 2000 to till date", "2024-Jan-01", "ADD") + `</table>`;
const IFRAME = (y) => `<iframe src='/opencms/resources/UploadCDSCOWeb/2018/UploadApprovalNewDrugs/List of New Drugs approved in the year ${y} till date.pdf' width='100%'></iframe>`;
// Same layout as the real 2025 list: numbered entries, wrapped names, dd.mm.yyyy dates.
const TEXT = {
  2026: "List of New Drugs approved in the year 2026 till date S.No. Name of New Drug Indication Date of Approval 1. Examplimab Injection 100 mg For the treatment of a rare disease in adults. 14.02.2026",
  2025: "List of New Drugs approved in the year 2025 till date S.No. Name of New Drug Indication Date of Approval\n 1. Tafamidis Bulk Drug Not applicable as it is a bulk drug 16.01.2025\n 2.\nLetermovir Bulk Drug\n&Letermovir Tablets\n240mg and 480 mg\nLetermovir is indicated for prophylaxis of cytomegalovirus infection 17.01.2025\n 7.\nRimegepant Oral\ndisintegrating tablets (ODT)\n75 mg\nFor Acute treatment of migraine 27.03.2025",
  2024: "List of new drugs approved in the year 2024 till date 1. Tirzepatide Injection For glycaemic control 15.07.2024",
  2023: "List of new drugs approved in the year 2023 till date 1. Oldamab Injection 01.02.2023",
};

test("page: yearly new-drug lists from 2020 on, newest first; other tables ignored", () => {
  const rows = parseListPage(PAGE);
  assert.deepEqual(rows.map((r) => r.year), [2026, 2025, 2024, 2023]);
  assert.equal(rows[1].release, "2025-Oct-29");
  assert.equal(rows[1].jsp, "https://cdsco.gov.in/opencms/opencms/system/modules/CDSCO.WEB/elements/download_file_division.jsp?num_id=A2025=");
});

test("download page: the PDF address is read from the iframe and made a full, encoded URL", () => {
  assert.equal(iframePdf(IFRAME(2025)), "https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadApprovalNewDrugs/List%20of%20New%20Drugs%20approved%20in%20the%20year%202025%20till%20date.pdf");
  assert.equal(iframePdf("<p>no file</p>"), "");
});

test("match: the drug's own entry and approval date; combinations split; short or absent names find nothing", () => {
  const l = findInList(TEXT[2025], "letermovir");
  assert.equal(l[0].date, "2025-01-17");
  assert.match(l[0].excerpt, /^\.\.\.2\. Letermovir Bulk Drug/);
  assert.equal(findInList(TEXT[2025], "Rimegepant")[0].date, "2025-03-27");
  assert.equal(findInList(TEXT[2025], "camizestrant").length, 0);
  assert.equal(findInList(TEXT[2025], "tafamidis, rimegepant").length, 2);
  assert.equal(findInList(TEXT[2025], "abc").length, 0, "under 4 letters is too loose to search");
  assert.equal(findInList("Letermovirum tablets 01.01.2025", "letermovir").length, 0, "whole words only");
});

const SCHEMA = readFileSync(new URL("../functions/db/updates_schema.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:"); db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => (db.prepare(sql).run(...args), { success: true }), first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }), _exec: () => db.prepare(sql).run(...args) });
  return { _db: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
const realFetch = globalThis.fetch;
let FETCHES = [], PAGE_NOW = PAGE;
function mockNet() {
  FETCHES = [];
  globalThis.fetch = async (url) => {
    url = String(url); FETCHES.push(url);
    if (url.indexOf("Approved-New-Drugs") >= 0) return { ok: true, status: 200, text: async () => PAGE_NOW };
    const jsp = url.match(/num_id=A(\d{4})=/);
    if (jsp) return { ok: true, status: 200, text: async () => IFRAME(jsp[1]) };
    const pdf = url.match(/year%20(\d{4})%20till/);
    if (pdf) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("PDF" + pdf[1]).buffer };
    throw new Error("unexpected " + url);
  };
}
function ai() {
  return { toMarkdown: async ({ blob }) => { const y = (await blob.text()).slice(3); return [{ format: "markdown", data: TEXT[y] || "" }]; } };
}

test("refresh: at most 3 lists a run, newest first; then only missing, re-released or recent lists", { skip: SKIP }, async () => {
  const env = { UPDATES_DB: d1(), AI: ai() };
  mockNet(); PAGE_NOW = PAGE;
  try {
    const now = Date.parse("2026-09-28T00:00:00Z");
    const r1 = await refreshCdscoLists(env, { now });
    assert.deepEqual([r1.ok, r1.fetched, r1.errors.length], [true, 3, 0]);
    const years = () => env.UPDATES_DB._db.prepare("SELECT year FROM cdsco_lists ORDER BY year DESC").all().map((x) => x.year);
    assert.deepEqual(years(), [2026, 2025, 2024]);
    const r2 = await refreshCdscoLists(env, { now: now + 3600000 });
    assert.equal(r2.fetched, 1, "the missing 2023 list only");
    assert.deepEqual(years(), [2026, 2025, 2024, 2023]);
    const r3 = await refreshCdscoLists(env, { now: now + 7200000 });
    assert.equal(r3.fetched, 0, "nothing stale");
    PAGE_NOW = PAGE.replace("2024-Dec-27", "2025-Jan-05");
    const r4 = await refreshCdscoLists(env, { now: now + 10800000 });
    assert.equal(r4.fetched, 1, "a re-released list is fetched again");
    const r5 = await refreshCdscoLists(env, { now: now + 8 * 86400000 });
    assert.equal(r5.fetched, 2, "the current and previous year are refreshed weekly");
    const res = await lookup(env, "letermovir");
    assert.equal(res.checked.length, 4);
    assert.deepEqual(res.matches.map((m) => [m.year, m.date]), [[2025, "2025-01-17"]]);
  } finally { globalThis.fetch = realFetch; PAGE_NOW = PAGE; }
});

test("refresh: without the Workers AI binding it does nothing and says why", { skip: SKIP }, async () => {
  const r = await refreshCdscoLists({ UPDATES_DB: d1() });
  assert.deepEqual(r, { ok: false, reason: "no-ai-or-db" });
});

async function call(env, method, path, tok, admin) {
  const h = {}; if (tok) h.Authorization = "Bearer " + tok; if (admin) h["X-Admin-Token"] = admin;
  const req = new Request("https://stewardmd.in/api/updates/" + path, { method, headers: h });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) }, waitUntil: () => {} });
  return { status: res.status, data: await res.json() };
}

test("routes: lookup is for signers; refresh is for owners; the admin token does neither", { skip: SKIP }, async () => {
  const env = { UPDATES_DB: d1(), AI: ai(), UPDATES_ADMIN_TOKEN: "admintok-123456" };
  env.UPDATES_DB._db.prepare("INSERT INTO bulletin_signers (uid, name, reg_no, council, active, added_by, added_ts) VALUES ('u-owner','Manoj Kurmana','APMC-1','APMC',1,'u-owner',1)").run();
  env.UPDATES_DB._db.prepare("INSERT INTO cdsco_lists (year, url, title, release, fetched_ts, text) VALUES (2025,'u','List 2025','2025-Oct-29',1,?)").run(TEXT[2025]);
  const ok = await call(env, "GET", "bulletins/cdsco?q=rimegepant", "tok-owner-doc");
  assert.equal(ok.status, 200);
  assert.equal(ok.data.matches[0].date, "2025-03-27");
  assert.equal((await call(env, "GET", "bulletins/cdsco?q=rimegepant", "tok-doc2")).status, 403, "verified but not a signer");
  assert.equal((await call(env, "GET", "bulletins/cdsco?q=rimegepant", null, "admintok-123456")).status, 401);
  assert.equal((await call(env, "GET", "bulletins/cdsco?q=abc", "tok-owner-doc")).status, 400);
  assert.equal((await call(env, "POST", "bulletins/cdsco/refresh", "tok-doc2")).status, 403);
  mockNet();
  try {
    const r = await call(env, "POST", "bulletins/cdsco/refresh", "tok-owner-doc");
    assert.equal(r.status, 200); assert.equal(r.data.ok, true);
  } finally { globalThis.fetch = realFetch; }
});
