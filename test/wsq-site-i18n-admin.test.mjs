/* test/wsq-site-i18n-admin.test.mjs - staff-language coverage (ui-i18n-site, group "admin") for the
 * Admin Center, wardsynq/site/pages/admin.js: seed data, hospital cards (token numbers, clinical
 * settings, approval rules, lab check, critical-result alerts), security review (+ the anchor
 * acknowledgement TS() warning), system health, webhooks, connected apps (SMART), connectors and
 * hospital groups. Uses test/wsq-site-i18n-harness.mjs (loadSite/leftovers) per the ui-i18n-site spec.
 *
 * node --test --experimental-test-module-mocks test/wsq-site-i18n-admin.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

/** A context built the way a page's exposed WSQ._xHtml helpers expect - straight off win.WSQ, per
 *  the spec's "call the page's exposed helper" path. */
function ctxOf(win) {
  return { esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en };
}

// ---------------------------------------------------------------------------------------------
// Seed data (WSQ._seedHtml)
// ---------------------------------------------------------------------------------------------
test("seed data: loading, failed and loaded states translate; item content (data) is never touched", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);
  const html = win.WSQ._seedHtml;

  assert.match(html(c, undefined), /⟦Loading\.\.\.⟧/);

  const failed = html(c, { failed: true, message: "backend unreachable" });
  assert.match(failed, /⟦The sign-off state could not be loaded:⟧/);
  assert.match(failed, /backend unreachable/);
  assert.equal(leftovers(failed, ["backend unreachable"]).length, 0, `seed failed leftovers: ${JSON.stringify(leftovers(failed, ["backend unreachable"]))}`);

  const r = {
    ok: true, signatory: "Dr. Signatory", canSign: true,
    lists: [{ id: "allergy-classes", title: "Allergy classes", source: "NIH", items: [
      { id: "penicillins", label: "Penicillins", version: "3", content: "amoxicillin, ampicillin", contentHash: "h1", status: "unsigned" },
    ], unapproved: 1 }],
  };
  const loaded = html(c, r);
  const DATA = ["Dr. Signatory", "Allergy classes", "NIH", "Penicillins", "3", "amoxicillin, ampicillin"];
  assert.equal(leftovers(loaded, DATA).length, 0, `seed loaded leftovers: ${JSON.stringify(leftovers(loaded, DATA))}`);
  DATA.forEach((d) => assert.ok(loaded.includes(d), `data value kept verbatim: ${d}`));
  assert.ok(!/⟦[^⟧]*Penicillins[^⟧]*⟧/.test(loaded), "the item's own label is not translated");

  // English stays byte-identical to the inline fallback (the keys are not in i18n.js's EN catalog).
  const enEnv = loadSite({ pages: ["admin.js"] });
  const enC = ctxOf(enEnv.win);
  const enHtml = enEnv.win.WSQ._seedHtml(enC, r);
  assert.ok(!enHtml.includes("⟦"), "no translation markers in English");
  assert.ok(!enHtml.includes("en-orig"), "no en-orig span in English");
  assert.ok(!enHtml.includes('lang="en"'), "no lang=en span in English");
});

// ---------------------------------------------------------------------------------------------
// Hospital cards: token numbers, clinical settings, approval rules, lab check, critical alerts
// ---------------------------------------------------------------------------------------------
test("hospital cards translate their static text and keep department/setting data untouched", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);

  const tok = win.WSQ._tokenCard.html(c, { scope: "hospital", prefixes: {} }, [{ id: "d1", name: "General Medicine", code: "GM", active: true }]);
  assert.equal(leftovers(tok, ["General Medicine", "GM"]).length, 0, `token card leftovers: ${JSON.stringify(leftovers(tok, ["General Medicine", "GM"]))}`);

  const clin = win.WSQ._clinicalSettings.html(c, { settings: { highAlertDrugs: ["Heparin", "Insulin"], orderVerifyWithinHours: 4 }, templates: {} }, undefined);
  assert.equal(leftovers(clin, ["Heparin", "Insulin", "4"]).length, 0, `clinical settings leftovers: ${JSON.stringify(leftovers(clin, ["Heparin", "Insulin", "4"]))}`);

  // APPROVER_ROLES role ids (admin/doctor/pg_faculty/pg_hod) are shown as checkbox labels verbatim -
  // role ids are configuration data, never translated (spec: "role ids... stay as they are").
  const ap = win.WSQ._approvalRules.html(c, { approvalLevels: {}, approvalPolicy: {} });
  const apRoles = ["admin", "doctor", "pg faculty", "pg hod"];
  assert.equal(leftovers(ap, apRoles).length, 0, `approval rules leftovers: ${JSON.stringify(leftovers(ap, apRoles))}`);

  const lab = win.WSQ._labCheck.html(c, { labVerification: null });
  assert.equal(leftovers(lab, []).length, 0, `lab check leftovers: ${JSON.stringify(leftovers(lab, []))}`);

  const alert = win.WSQ._alertCard.html(c, {
    ok: true, enabled: true, levels: {}, minutes: { acknowledgeWithinMinutes: 5, escalateAfterMinutes: 15 },
    defaults: { approval: { approvedBy: "Dr. Owner", approvedOn: "2026-01-01", decision: "D-1" } },
    wardRule: { rule: "on-duty nurse", source: "default", note: "Picked by roster." },
    sms: { senderId: "WARDSY", templateName: "critical_v1", ready: true },
    failures: [], phones: { ok: true, checked: 0 }, noDevice: [],
  });
  const alertRoles = ["doctor", "resident", "supervisor", "nurse", "intern", "pg resident", "pg faculty", "pg hod"];
  const alertData = ["Dr. Owner", "2026-01-01", "D-1", "on-duty nurse", "WARDSY", "critical_v1", "Picked by roster.", ...alertRoles];
  assert.equal(leftovers(alert, alertData).length, 0, `alert card leftovers: ${JSON.stringify(leftovers(alert, alertData))}`);
});

// ---------------------------------------------------------------------------------------------
// Security review, including the anchor-acknowledgement TS() safety warning
// ---------------------------------------------------------------------------------------------
test("security review: findings, review queue and data protection translate; audit values are never marked English incorrectly and leak nothing", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);
  const html = win.WSQ._securityReviewHtml;

  assert.match(html(c, null), /⟦Loading the security review\.\.\.⟧/);
  const failed = html(c, { failed: true, message: "no access" });
  assert.equal(leftovers(failed, ["no access"]).length, 0, `security failed leftovers: ${JSON.stringify(leftovers(failed, ["no access"]))}`);

  const emptyOk = { status: "ok", findings: [], counts: {} };
  const r = {
    days: 7, note: "Findings are advisory.", counts: {}, notDetected: [],
    chartAccess: {
      status: "ok", findings: [{
        type: "chart-access-volume", actor: "nurse1@example.test", summary: "Read 40 charts.", method: "chart reads in 1 hour",
        signIns: [], evidence: [{ ts: "2026-09-14T10:00:00Z", action: "chart.read", resourceType: "Encounter", patientRef: "Patient/1", outcome: "allowed", detail: "", id: "audit-1" }],
        evidenceTotal: 1,
      }], truncated: false, partial: false,
    },
    assignmentAccess: { status: "not_evaluated", reason: "No rota configured.", exemptions: [] },
    exports: emptyOk, logins: emptyOk,
    reviewQueue: { status: "ok", awaiting: 1, missing: [], items: [
      { kind: "privileged-action", subjectId: "e1", actor: "admin1@example.test", action: "member:set", at: "2026-09-14T09:00:00Z", detail: "role changed", status: "awaiting", reviews: [], ownAction: false },
    ] },
    dataProtection: { status: "red", reasons: ["No restore test has ever been recorded."], lastBackup: null, lastRestoreTest: null },
    auditRetention: { status: "ok", configuredNote: "No retention period is configured.", oldestAuditAt: "2026-01-01", oldestRecordAt: "2026-01-01", gap: null },
  };
  const out = html(c, r);
  const DATA = ["nurse1@example.test", "Read 40 charts.", "chart reads in 1 hour", "2026-09-14T10:00:00Z", "Encounter", "Patient/1", "audit-1",
    "No rota configured.", "admin1@example.test", "role changed", "2026-09-14T09:00:00Z",
    "No restore test has ever been recorded.", "No retention period is configured.", "2026-01-01",
    "Findings are advisory.", "chart.read", "allowed", "member:set"];
  assert.equal(leftovers(out, DATA).length, 0, `security review leftovers: ${JSON.stringify(leftovers(out, DATA))}`);
  DATA.forEach((d) => assert.ok(out.includes(d), `data value kept verbatim: ${d}`));

  // The anchor-acknowledgement form (WSQ._anchorAckFormHtml) is an irreversible-action warning and
  // uses TS(): escaped translated text plus the English original in a lang="en" span underneath.
  const ackForm = win.WSQ._anchorAckFormHtml(c, "");
  assert.match(ackForm, /⟦This archives the current outside copy/, "the translated (marked) text is shown");
  assert.match(ackForm, /class="en-orig" lang="en">This archives the current outside copy/, "the English original is kept, marked lang=en, for a clinician reading in another language");

  // English: no markers anywhere, and TS() on English returns plain escaped text (no en-orig span).
  const enEnv = loadSite({ pages: ["admin.js"] });
  const enC = ctxOf(enEnv.win);
  const enOut = enEnv.win.WSQ._securityReviewHtml(enC, r);
  assert.ok(!enOut.includes("⟦") && !enOut.includes("en-orig") && !enOut.includes('lang="en"'), "English security review carries no i18n markers");
  const enAck = enEnv.win.WSQ._anchorAckFormHtml(enC, "");
  assert.ok(!enAck.includes("⟦") && !enAck.includes("en-orig"), "English ack form has no markers");
  assert.match(enAck, /This archives the current outside copy/);
});

// ---------------------------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------------------------
test("system health: loading, failed and loaded (mixed up/down) states translate; dependency names/reasons (data) stay put", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);
  const html = win.WSQ._systemHealthHtml;

  assert.match(html(c, null), /⟦Checking each dependency\.\.\.⟧/);
  const failed = html(c, { failed: true, message: "timed out" });
  assert.equal(leftovers(failed, ["timed out"]).length, 0, `health failed leftovers: ${JSON.stringify(leftovers(failed, ["timed out"]))}`);

  const r = {
    overall: "degraded", generatedAt: "2026-09-14T10:00:00Z", timeoutMs: 2000,
    dependencies: [
      { name: "Firestore", status: "up", checkedAt: "2026-09-14T10:00:00Z" },
      { name: "KV anchors", status: "down", checkedAt: "2026-09-14T10:00:00Z", consequence: "Tamper checks are unavailable.", reason: "connect ECONNREFUSED" },
    ],
  };
  const out = html(c, r);
  const DATA = ["Firestore", "KV anchors", "2026-09-14T10:00:00Z", "Tamper checks are unavailable.", "connect ECONNREFUSED"];
  assert.equal(leftovers(out, DATA).length, 0, `system health leftovers: ${JSON.stringify(leftovers(out, DATA))}`);
});

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------
test("webhooks: intro, table and add-form translate; addresses/labels/event ids (data) are untouched", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);
  const html = win.WSQ._webhooksHtml;

  assert.match(html(c, null), /⟦Loading webhooks\.\.\.⟧/);

  const r = {
    ok: true, keyConfigured: true,
    eventTypes: [{ id: "patient.admitted", label: "Patient admitted" }],
    webhooks: [{ id: "wh1", url: "https://example.test/hook", description: "Bed board", active: true, status: "active",
      eventTypes: ["patient.admitted"], lastAttemptAt: "2026-09-14T10:00:00Z", lastOk: true, lastResponseCode: 200 }],
  };
  const out = html(c, r, { url: "https://example.test/hook", secret: "shh-secret-value" });
  const DATA = ["https://example.test/hook", "Bed board", "Patient admitted", "2026-09-14T10:00:00Z", "200", "shh-secret-value"];
  assert.equal(leftovers(out, DATA).length, 0, `webhooks leftovers: ${JSON.stringify(leftovers(out, DATA))}`);

  const deliveries = win.WSQ._webhookDeliveriesHtml(c, {
    ok: true, deliveries: [{ at: "2026-09-14T10:00:00Z", eventType: "patient.admitted", eventId: "evt-1", attempt: 1, status: "delivered", responseCode: 200 }],
  }, "https://example.test/hook", false);
  assert.equal(leftovers(deliveries, ["https://example.test/hook", "2026-09-14T10:00:00Z", "patient.admitted", "evt-1", "200"]).length, 0,
    `webhook deliveries leftovers: ${JSON.stringify(leftovers(deliveries, ["https://example.test/hook", "2026-09-14T10:00:00Z", "patient.admitted", "evt-1", "200"]))}`);
});

// ---------------------------------------------------------------------------------------------
// Connected apps (SMART) and Connectors
// ---------------------------------------------------------------------------------------------
test("connected apps (SMART) and connectors translate; client/connector names and scopes (data) stay put", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);

  const scHtml = win.WSQ._smartClientsHtml;
  assert.match(scHtml(c, null), /⟦Loading connected apps\.\.\.⟧/);
  const scR = {
    ok: true, enabled: true, scopeCatalog: { user: ["patient/*.read"], patient: [], special: [] },
    clients: [{ clientId: "app-1", name: "Bedside Tablet", kind: "public", redirectUris: ["https://app.test/cb"], scopes: ["patient/*.read"], keys: [], keyCount: 0 }],
  };
  const scOut = scHtml(c, scR, null);
  // a.kind ("public"/"backend") is a technical connection kind shown verbatim, like price-list "kind".
  const scData = ["app-1", "Bedside Tablet", "https://app.test/cb", "patient/*.read", "public"];
  assert.equal(leftovers(scOut, scData).length, 0, `smart clients leftovers: ${JSON.stringify(leftovers(scOut, scData))}`);

  const cnHtml = win.WSQ._connectorsHtml;
  assert.match(cnHtml(c, null), /⟦Loading connectors\.\.\.⟧/);
  const cnR = {
    ok: true, keyConfigured: true,
    catalogue: [{ kind: "imaging", label: "Imaging archive", help: "Connects to the PACS.", singleton: false,
      providers: [{ id: "dicom", label: "DICOM", help: "", testable: true, settings: [{ key: "host", label: "Host", type: "text" }], secrets: [{ key: "apiKey", label: "API key" }] }] }],
    connectors: [{ id: "cn1", kind: "imaging", provider: "dicom", name: "Main PACS", active: true, settings: { host: "pacs.local" }, secretsSet: [], secretsSetAt: null }],
  };
  const cnOut = cnHtml(c, cnR);
  const cnData = ["Imaging archive", "Connects to the PACS.", "DICOM", "Host", "API key", "Main PACS", "pacs.local"];
  assert.equal(leftovers(cnOut, cnData).length, 0, `connectors leftovers: ${JSON.stringify(leftovers(cnOut, cnData))}`);
});

// ---------------------------------------------------------------------------------------------
// Hospital groups
// ---------------------------------------------------------------------------------------------
test("hospital groups (side + run) translate; group/hospital names and ids (data) stay put", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);

  const side = win.WSQ._groupAdmin.side(c, {
    groups: [{ groupId: "g1", name: "Regional Network", state: "member", policy: { labVerification: {} }, policyVersion: 2 }],
    snapshot: { publishedAt: 1, publishedBy: "admin1@example.test" },
  });
  assert.equal(leftovers(side, ["Regional Network", "labVerification", "2", "admin1@example.test"]).length, 0,
    `group side leftovers: ${JSON.stringify(leftovers(side, ["Regional Network", "labVerification", "2", "admin1@example.test"]))}`);

  const run = win.WSQ._groupAdmin.run(c, {
    groups: [{ id: "g1", name: "Regional Network", adminUids: ["u1"], members: [{ name: "Hospital A", orgId: "org-a" }], invited: [], policyVersion: 1, policy: null, staleAfterMinutes: 60 }],
  });
  assert.equal(leftovers(run, ["Regional Network", "u1", "Hospital A", "org-a"]).length, 0,
    `group run leftovers: ${JSON.stringify(leftovers(run, ["Regional Network", "u1", "Hospital A", "org-a"]))}`);
});
