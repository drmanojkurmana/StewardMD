/* Referrals on the chart and the hospital referral inbox, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const SEL = { patientId: "p1", name: "Asha Rao" };
const REF = { id: "r1", version: 1, kind: "internal", specialty: "Cardiology", urgency: "urgent", reason: "New AF", clinicalSummary: "AF 130", referringProvider: "dr.a", requestedAt: "2026-09-13T10:00:00.000Z", status: "requested" };

test("loading, failed and none are different; the chart offers a referral form", () => {
  const W = loadWard();
  const v = (referrals) => W._render({ ...W._st, view: "referrals", sel: SEL, referrals });
  assert.match(v(null), /Loading referrals/);
  assert.match(v({ failed: true }), /Do not read this as none/);
  assert.ok(!v({ failed: true }).includes("No referrals for this patient"));
  const none = v({ ok: true, referrals: [] });
  assert.match(none, /No referrals for this patient/);
  assert.ok(none.includes('id="wRefSummary"') && none.includes('data-w-act="refcreate"'));
});

test("each state offers only the actions that state allows, and shows the reply or the decline reason", () => {
  const W = loadWard();
  const v = (r) => W._render({ ...W._st, view: "referrals", sel: SEL, referrals: { ok: true, referrals: [r] } });
  const req = v(REF);
  for (const a of ["accept", "decline", "cancel"]) assert.ok(req.includes(`data-w-act="refact:r1~${a}~1"`), a);
  assert.ok(!req.includes("~close~"));
  const responded = v({ ...REF, status: "responded", version: 5, response: "Start metoprolol" });
  assert.ok(responded.includes('data-w-act="refact:r1~close~5"'));
  assert.match(responded, /Reply:<\/b> Start metoprolol/);
  const declined = v({ ...REF, status: "declined", declineReason: "Wrong clinic" });
  assert.match(declined, /Declined:<\/b> Wrong clinic/);
  assert.ok(declined.includes("~close~"), "a declined referral is closed deliberately, not left open");
  assert.ok(!v({ ...REF, status: "closed" }).includes('data-w-act="refact:'));
});

test("the inbox has a specialty filter and a sent-by-me view, states a partial scan, and is a hospital tile", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "referralinbox", referrals: { ok: true, referrals: [], partialWarning: "Only the latest 500 referrals were checked; older open ones may be missing." } });
  assert.ok(html.includes('id="wRefSpec"') && html.includes('option value="sent"'));
  assert.match(html, /older open ones may be missing/);
  assert.match(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"), /go: "ward:referralinbox"/);
});
