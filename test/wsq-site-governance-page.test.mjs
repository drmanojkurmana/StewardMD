/* test/wsq-site-governance-page.test.mjs - the "Privacy and compliance" page and the portal's privacy section, as drawn.
 *
 * Loading, failed and empty are different sentences; an erasure never says "erased" about what the record keeps; a
 * request with no hospital clock shows no due date; a proxy in the portal cannot acknowledge or ask on the patient's
 * behalf.
 *
 * node --test test/wsq-site-governance-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function govPage() {
  const sb = { window: {} };
  sb.window.WSQ = { page() {} };
  vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/governance.js"), sb);
  return sb.window.WSQ;
}
function portal() {
  const sb = { window: {}, document: undefined };
  vm.createContext(sb);
  vm.runInContext(read("wardsynq/site/i18n.js"), sb);
  sb.WSQI18n = sb.window.WSQI18n;
  vm.runInContext(read("wardsynq/site/portal.js"), sb);
  return sb.window.WSQPortal;
}

test("erasure outcome: the clinical record is kept with the reason, removed values are not called erased, failures are named", () => {
  const W = govPage();
  const h = W._govErasureHtml({ esc }, { consentsWithdrawn: ["research"], removedFromCurrentRecord: ["abha-number"], registrationDetailsRemoved: [], failures: [{ step: "registration-details", detail: "not found" }] });
  assert.match(h, /research/);
  assert.match(h, /The clinical record\. Each class says whether a law keeps it/);
  assert.match(h, /They are not erased\./);
  assert.match(h, /Not done.*registration-details: not found/s);
  assert.ok(!/\berased\b(?! )/.test(h.replace("They are not erased.", "")), "nothing is reported erased");
});

test("a request with no hospital clock shows no due date; an overdue one says so; erasure asks before acting", () => {
  const W = govPage();
  const base = { id: "r1", patientId: "p1", kind: "access", state: "received", receivedAt: "2026-09-01T00:00:00Z", receivedVia: "email", detail: "copy" };
  const noClock = W._govRequestHtml({ esc }, { ...base, dueBy: null, overdue: null });
  assert.match(noClock, /No answer time set/);
  assert.ok(!/Overdue/.test(noClock));
  const late = W._govRequestHtml({ esc }, { ...base, dueBy: "2026-09-02T00:00:00Z", overdue: true });
  assert.match(late, /Overdue/);
  const erase = W._govRequestHtml({ esc }, { ...base, kind: "erasure", state: "in-progress" });
  assert.match(erase, /Erase and complete/);
  const closed = W._govRequestHtml({ esc }, { ...base, state: "completed", response: "Sent" });
  assert.ok(!closed.includes('data-gact="complete"'), "a closed request offers no action");
});

test("the law in force: SPDI and CERT-In today with the DPDP dates, never 'not confirmed'; a breach shows the CERT-In clock and no Board duty before commencement", () => {
  const W = govPage();
  const c = { esc, can: () => false };
  const law = { regime: "spdi-2011", dpdpInForce: false, dpdpStart: "2027-05-13", dpdpStartSource: "default", published: "2025-11-13", consentManagerStart: "2026-11-13", consentManagersInForce: false };
  const banner = W._govLawHtml(c, law);
  assert.match(banner, /SPDI Rules 2011 and the CERT-In Directions 2022 apply/);
  assert.match(banner, /G\.S\.R\. 843\(E\)/);
  assert.match(banner, /not yet in force/);
  assert.match(W._govLawHtml(c, { ...law, regime: "dpdp-2025", dpdpInForce: true }), /DPDP Rules 2025 apply to this hospital/);
  const breach = W._govBreachHtml(c, { id: "b1", state: "open", detectedAt: "2026-09-01T10:00:00Z", description: "Laptop lost", certInDueBy: "2026-09-01T16:00:00Z", certInLate: true, boardDuty: false, boardDetailedDueBy: null, principalsDueBy: "2026-09-04T10:00:00Z" });
  assert.match(breach, /CERT-In \(6 hours, in force now\)/);
  assert.match(breach, /no Board duty: the hospital became aware before DPDP commencement/);
  assert.match(breach, /Late/);
  assert.match(breach, /\(e\) Who to contact with questions/, "the five r.7(1) headings are on the form");
  assert.ok(!/not confirmed/i.test(banner + breach), "no 'not confirmed' clock text");
  const withdrawn = W._govBreachHtml(c, { id: "b2", state: "withdrawn", detectedAt: "2026-09-01T10:00:00Z", description: "Blank template", notBreachProposal: { reasons: "No personal data in it" } });
  assert.ok(!withdrawn.includes("data-gbr="), "a withdrawn record offers no action");
  const erased = W._govErasureHtml({ esc }, { consentsWithdrawn: [], removedFromCurrentRecord: [], registrationDetailsRemoved: [], failures: [],
    retained: { classes: [{ class: "clinical-ipd", keepUntil: "2035-01-04T00:00:00Z", rule: "DGHS Office Memorandum, 28 Oct 2014" }, { class: "mlc", keepUntil: "2036-01-01T00:00:00Z", untilProceedingsEnd: true, rule: "DGHS OM: ten years or till disposal" }] } });
  assert.match(erased, /clinical-ipd.*kept until/s);
  assert.match(erased, /or until any court proceedings end/);
  const holds = W._govHoldsHtml(c, [{ id: "h1", reason: "mlc", reference: "MLC/2026/00001", auto: true }], "pat-1");
  assert.match(holds, /nothing can be erased or destroyed/);
  assert.match(holds, /data-glift="h1"/);
});

test("portal privacy: loading, failed, none published and a proxy are four different things", () => {
  const P = portal();
  assert.match(P.privacySection(null), /data-state="loading"/);
  const failed = P.privacySection(false);
  assert.match(failed, /data-state="failed"/);
  assert.ok(!failed.includes('data-empty="privacy"'), "a failed read never looks like no notice");
  const none = P.privacySection({ ok: true, notice: null, requests: [], proxy: false });
  assert.match(none, /data-empty="privacy"/);
  assert.match(none, /data-act="data-request"/);
  const notice = { language: "en", text: "We collect your data to treat you.", dpoContact: "dpo@h.example", version: 1 };
  const patient = P.privacySection({ ok: true, notice, acknowledged: false, requests: [{ kind: "erasure", state: "received", receivedAt: "2026-09-01T00:00:00Z" }], proxy: false });
  assert.match(patient, /data-act="privacy-ack"/);
  assert.match(patient, /dpo@h\.example/);
  const proxy = P.privacySection({ ok: true, notice, acknowledged: false, requests: [], proxy: true });
  assert.ok(!proxy.includes('data-act="privacy-ack"') && !proxy.includes('data-act="data-request"'), "a proxy reads, and acts for nobody");
  assert.match(P.privacySection({ ok: true, notice, acknowledged: true, requests: [], proxy: false }), /data-state="acknowledged"/);
});

test("Retention and legal holds tab: every class with its layers, basis type, instrument, provision, jurisdiction, period and evidence; a policy-only class is flagged; translated around server values", async () => {
  const { loadSite, leftovers } = await import("./wsq-site-i18n-harness.mjs");
  const { classesOf, retentionMap, LEGAL } = await import("../functions/_wardsynq/retention.js");
  const { compactRetained } = await import("../functions/_wardsynq/dpdp.js");
  const classes = Object.values(classesOf({ years: { "blood-centre": 7 } }).classes).map(({ bases, ...c }) => c);
  const serverValues = (xs) => xs.flatMap((x) => [x.key || x.class, ...(x.layers || x.bases || []).flatMap((b) => [b.instrument + ", " + b.provision + " (" + b.sourceType + ", " + b.jurisdiction + ")", b.instrument + ", " + b.provision, b.note])]).filter(Boolean);
  const facts = { patient: { dob: "1980-01-01" }, encounters: [{ class: "IPD", status: "finished", periodStart: "2025-01-01T00:00:00Z", periodEnd: "2025-01-04T00:00:00Z" }], registers: { mlc: [], formf: [], mtp: [] }, documents: [], consents: [] };
  const retained = retentionMap(facts, null, Date.parse("2026-09-17T00:00:00Z")).map((x) => compactRetained(x, x.class === "clinical-ipd" ? { decision: "retain", reason: "Continuing care of a chronic patient" } : null));
  for (const lang of ["en", "xx"]) {
    const e = loadSite({ lang, pages: ["governance.js"] });
    const W = e.win.WSQ, c = { esc: W.esc, t: W.t, tSafe: W.tSafe, en: W.en, can: () => true, state: { orgId: "org-1" } };
    const html = W._govClassesHtml(c, classes, { dpdpInForce: false });
    const per = W._govRetainedHtml(c, retained);
    const form = W._govDecisionsFormHtml(c, "req-1", retained);
    if (lang === "en") {
      const row = (k) => html.split("<tr>").find((r) => r.includes(">" + k + "<"));
      assert.match(row("clinical-ipd"), /Required by law.*Indian Medical Council \(Professional Conduct, Etiquette and Ethics\) Regulations 2002, reg 1\.3\.1 \(Regulation, IN\).*3 years/s);
      assert.match(row("clinical-ipd"), /Hospital retention policy, not a legal requirement.*DGHS Office Memorandum F\. No\. A\.12034\/3\/2014-MH-II\/MH-I.*10 years/s);
      assert.ok(!row("clinical-ipd").includes("Policy only"), "a class with a statutory floor is not flagged");
      for (const k of ["clinical-opd", "mlc", "consent-artefacts"]) assert.match(row(k), /Policy only: no law identified/, k);
      for (const k of ["pcpndt", "mtp", "ndps", "h1", "schedule-x", "blood-centre", "art", "surrogacy", "audit-log"]) assert.ok(!row(k).includes("Policy only"), k);
      assert.match(row("blood-centre"), /7.*set by this hospital.*never below the legal floor of 5 years.*This hospital&#39;s retention setting/s, "a lengthening is a policy layer beside the legal floor");
      assert.match(row("audit-log"), /180 days.*from 2027-05-13/s);
      assert.match(row("pcpndt"), /href="https:\/\/indiankanoon\.org\/doc\/195755613\/"/);
      assert.match(W._govClassesHtml(c, null), /Loading the retention classes/);
      assert.match(W._govClassesHtml(c, false), /could not be loaded\. This is not the same as there being none/);
      assert.equal(retained[0].basisType, LEGAL);
      assert.match(per, /clinical-ipd.*Required by law.*Required by law until/s);
      assert.match(per, /The DPO decided to retain it:.*Continuing care/s);
      assert.match(form, /data-gdecide="req-1" data-n="1"/);
      assert.match(form, /data-gdec-class="clinical-ipd"/);
    } else {
      assert.deepEqual(leftovers(html, [...serverValues(classes), "2027-05-13"]), [], "only server values stay in English");
      const dates = retained.flatMap((x) => [x.keepUntil, x.legalUntil, ...x.bases.map((b) => b.until)]).filter(Boolean).map((d) => new Date(Date.parse(d)).toLocaleDateString());
      assert.deepEqual(leftovers(per + form, [...serverValues(retained), ...dates, "Continuing care of a chronic patient"]), []);
    }
  }
});
