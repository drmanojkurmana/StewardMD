/* test/abdm-external-invoice-policy.test.mjs - owner decision 2026-09-14: an invoice received over ABDM is a clinical
 * document, never this hospital's bill. The policy wardsynq.abdm.externalInvoiceHandling has one value,
 * "clinical-document" (absent = that default).
 *
 * Pinned: the resolver and the save refusal; a landed external invoice is a ClinicalNote whose audit row names the
 * policy, value and where the value came from; no Invoice, Claim, PreAuthorisation or CostEstimate is written
 * whatever the payload says, and a mapping that ever emitted one is refused at the write; the billing report and
 * the patient's invoice list (the cashier's screen) count nothing; the composition's hospital config reader decides
 * the source, and an unreadable config applies the default and says so. The save route
 * (POST /api/queue/org/update) is pinned in org-abdm-invoice-policy-route.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/abdm-external-invoice-policy.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { serializeNdhm } from "../functions/_connect/connectors/abdm/serialize.js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { invoiceRecord } from "./connect/abdm/fixtures/sccm-records.mjs";
import { externalInvoiceHandling, externalInvoiceHandlingRefusal, abdmView, EXTERNAL_INVOICE_POLICY } from "../functions/_wardsynq/abdm-hospital.js";

/* The real SCCM adapter, with a switch that makes it emit this hospital's billing types too: the guard on the write
 * must hold even if a future mapping produced one. Mocked before abdm-land.js is loaded. */
const ADAPTER = "../wardsynq/adapters/wardsynq-sccm-adapter.js";
const real = await import(ADAPTER);
const EVIL = { on: false };
mock.module(ADAPTER, { namedExports: { ...real, sccmAdapter: () => {
  const a = real.sccmAdapter();
  const normalise = a._normalise;
  a._normalise = async (b) => {
    const out = await normalise(b);
    if (!EVIL.on) return out;
    const pid = out.entities.find((e) => e.resourceType === "Patient").id;
    const meta = out.entities[0].meta;
    return { ...out, entities: [...out.entities,
      { resourceType: "Invoice", id: "evil-inv", patientId: pid, status: "issued", lines: [{ amount: 590 }], events: [{ kind: "payment", amount: 590 }], meta },
      { resourceType: "Claim", id: "evil-claim", patientId: pid, meta }] };
  };
  return a;
} } });
const { landNdhmDocuments, makeConsumeAndLand, BILLING_TYPES } = await import("../functions/_wardsynq/abdm-land.js");
const { billingReport } = await import("../functions/_wardsynq/reports.js");
const { invoicesForPatient } = await import("../functions/_wardsynq/invoice.js");

const T = "t1";
const ctx = { now: () => new Date("2026-08-19T00:00:00.000Z"), tenant: { id: T }, hipId: "IN2810006668", envName: "sandbox" };
const CONSENT = { purpose: { code: "CAREMGT" }, actor: "fb:doctor" };
const doc = (rec) => serializeNdhm(ctx, { ...rec, profile: "InvoiceRecord" });
/* Whatever the payload says: a balanced (paid) invoice with a payment term and a net and gross total. */
const PAID = { ...invoiceRecord, invoices: invoiceRecord.invoices.map((inv) => ({ ...inv, id: "inv-paid", status: "balanced", identifierValue: "GIMSR/2026/000999", paymentTerms: "Paid in full at the counter" })) };

async function billingRows(repository) {
  let n = 0;
  for (const t of BILLING_TYPES) n += ((await repository.latestByType(T, t, 100)) || []).length;
  return n;
}

test("resolver: absent is the default, the hospital's value is named, an unknown stored value is never followed", () => {
  assert.deepEqual(BILLING_TYPES, ["Invoice", "Claim", "PreAuthorisation", "CostEstimate"]);
  const d = externalInvoiceHandling(null);
  assert.equal(d.policy, "wardsynq.abdm.externalInvoiceHandling");
  assert.equal(d.value, "clinical-document");
  assert.equal(d.source, "default");
  assert.match(d.reason, /never becomes a bill, charge, payment or ledger entry/);
  assert.equal(externalInvoiceHandling({ abdm: { externalInvoiceHandling: "clinical-document" } }).source, "hospital");
  const odd = externalInvoiceHandling({ abdm: { externalInvoiceHandling: "billing" } });
  assert.deepEqual([odd.value, odd.source, odd.configured], ["clinical-document", "unrecognised", "billing"]);

  assert.equal(externalInvoiceHandlingRefusal({ abdm: { externalInvoiceHandling: "clinical-document" } }), null);
  assert.equal(externalInvoiceHandlingRefusal({ abdm: { externalInvoiceHandling: null } }), null, "clearing returns to the default");
  assert.equal(externalInvoiceHandlingRefusal({ alerts: {} }), null, "a save that does not touch it");
  assert.match(externalInvoiceHandlingRefusal({ abdm: { externalInvoiceHandling: "billing" } }), /"billing" was not saved.*billing model for external invoices is not built/);
  assert.match(externalInvoiceHandlingRefusal({ abdm: "billing" }), /must be an object/);
  assert.equal(abdmView(null, { region: "IN", wardsynq: null }, []).invoiceHandling.value, "clinical-document", "the ABDM card is told the policy");
});

test("landing: an external invoice, even a paid one, is a ClinicalNote; nothing billing is written; its audit row names the policy", async () => {
  const repository = new MemoryRepository();
  const out = await landNdhmDocuments({}, { repository, pseudonym: async () => null }, {
    tenantId: T, transactionId: "txn-inv-1", consent: CONSENT, documents: [doc(invoiceRecord), doc(PAID)],
    invoiceHandling: externalInvoiceHandling({ abdm: { externalInvoiceHandling: "clinical-document" } }),
  });
  assert.equal(out.refused, 0, JSON.stringify(out.results));
  assert.equal(await billingRows(repository), 0, "no invoice, claim, pre-authorisation or estimate");
  const notes = ((await repository.latestByType(T, "ClinicalNote", 50)) || []).filter((n) => n.noteType === "external-invoice");
  assert.equal(notes.length, 2);
  for (const n of notes) {
    const rows = repository.audit.filter((e) => e.action === "record.ingest" && e.scope && e.scope.id === n.id);
    assert.equal(rows.length, 1, "one audit row for the note");
    assert.deepEqual(rows[0].scope.decidedBy, { policy: EXTERNAL_INVOICE_POLICY, value: "clinical-document", source: "hospital" });
  }
  const other = repository.audit.filter((e) => e.action === "record.ingest" && e.scope && e.scope.resourceType === "Patient");
  assert.ok(other.length && other.every((e) => !e.scope.decidedBy), "only the invoice notes carry the policy");
  // The ledger never sees a payment or charge: every row written is a clinical or identity type.
  const types = new Set(repository.audit.filter((e) => e.action === "record.ingest").map((e) => e.scope.resourceType));
  for (const t of types) assert.ok(!BILLING_TYPES.includes(t), t);
});

test("guard: a mapping that emitted an Invoice or Claim is refused at the write and nothing billing lands", async () => {
  const repository = new MemoryRepository();
  EVIL.on = true;
  let out;
  try {
    out = await landNdhmDocuments({}, { repository, pseudonym: async () => null }, { tenantId: T, transactionId: "txn-evil", consent: CONSENT, documents: [doc(invoiceRecord)] });
  } finally { EVIL.on = false; }
  assert.equal(await billingRows(repository), 0, JSON.stringify(out));
  assert.equal(out.results[0].refused, 2, "both billing entities refused, named in the result");
  assert.equal(((await repository.latestByType(T, "ClinicalNote", 50)) || []).filter((n) => n.noteType === "external-invoice").length, 1, "the document itself still lands");
  const note = repository.audit.find((e) => e.action === "record.ingest" && e.scope && e.scope.decidedBy);
  assert.equal(note.scope.decidedBy.source, "default", "no hospital config given: the default decided");
});

test("billing screens and reports: the billing report and the patient's invoice list count no external invoice", async () => {
  const repository = new MemoryRepository();
  await landNdhmDocuments({}, { repository, pseudonym: async () => null }, { tenantId: T, transactionId: "txn-inv-2", consent: CONSENT, documents: [doc(PAID)] });
  const note = ((await repository.latestByType(T, "ClinicalNote", 50)) || []).find((n) => n.noteType === "external-invoice");
  assert.ok(note && note.patientId);
  const request = new Request("https://x/api/queue/ward/billing-report");
  const c = {
    migration: { mode: "live", tenantId: T },
    recordDeps: { repository, pseudonym: async () => null },
    actorDeps: { db: { prepare: () => ({ bind: () => ({ first: async () => ({ id: T }) }) }) }, identifyFn: async () => ({ id: "cashier-1", email: "cashier@h.in" }),
      orgForTenant: async () => ({ id: "o" }), authorizeOrg: async () => ({ ok: true, role: "billing" }) },
  };
  const rep = await billingReport(request, {}, c);
  assert.equal(rep.ok, true, JSON.stringify(rep));
  assert.deepEqual([rep.invoiceCount, rep.charged, rep.collected, rep.outstanding], [0, 0, 0, 0]);
  const list = await invoicesForPatient(request, {}, { ...c, patientId: note.patientId });
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.deepEqual(list.invoices, []);
  assert.equal(list.outstandingBalance, 0);
});

test("composition: the hospital's config decides the source; an unreadable config applies the default and says 'unread'", async () => {
  const run = async (hospitalConfigFor) => {
    const repository = new MemoryRepository();
    const land = makeConsumeAndLand({
      env: {}, consumeTransfer: async () => ({ acked: true, decrypted: [JSON.stringify(doc(invoiceRecord))] }), consumeDeps: {},
      recordDeps: () => ({ repository, pseudonym: async () => null }), consentFor: async () => CONSENT, hospitalConfigFor,
    });
    const out = await land({ tenantId: T, transactionId: "txn-" + Math.random(), consentId: "c1" });
    assert.equal(out.refused, 0, JSON.stringify(out));
    assert.equal(await billingRows(repository), 0);
    return repository.audit.find((e) => e.scope && e.scope.decidedBy).scope.decidedBy;
  };
  assert.equal((await run(async () => ({ abdm: { externalInvoiceHandling: "clinical-document" } }))).source, "hospital");
  assert.equal((await run(async () => null)).source, "default");
  assert.deepEqual(await run(async () => ({ abdm: { externalInvoiceHandling: "post-to-ledger" } })), { policy: EXTERNAL_INVOICE_POLICY, value: "clinical-document", source: "unrecognised", configured: "post-to-ledger" });
  assert.equal((await run(async () => { throw new Error("firestore down"); })).source, "unread");
});

test("ABDM card (Admin > Integrations > ABDM): the policy is shown read-only with its reason; an unknown saved value is named", () => {
  const sb = { window: { WSQ: { page() {} } } };
  sb.WSQ = sb.window.WSQ;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/abdm.js", import.meta.url), "utf8"), sb);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const view = (w) => ({ ok: true, ...abdmView(null, { region: "IN", regionProfile: {}, wardsynq: w }, []) });
  const html = sb.window.WSQ._abdmHtml({ esc }, view(null));
  assert.match(html, /Invoices received from other facilities/);
  assert.match(html, /wardsynq\.abdm\.externalInvoiceHandling/);
  assert.match(html, /<b>clinical-document<\/b> <span class="quiet">\(default\)/);
  assert.match(html, /billing model for external invoices is not built/);
  assert.match(html, /cannot be changed on this screen/);
  assert.doesNotMatch(html, /id="abdmInvoice|—/, "no control and no em dash");
  assert.match(sb.window.WSQ._abdmHtml({ esc }, view({ abdm: { externalInvoiceHandling: "billing" } })), /saved value "billing" is not one this build has/);
});
