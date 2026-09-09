/* test/ward-integration-ui.test.mjs — TASK 7.10: the integration console (ward.js). Pure _render.
 *
 * The one rule this screen must not bend: a count it could not READ must never look like a count of
 * zero. On a clinical operations board those two answers mean opposite things - "nothing is stuck"
 * and "something may be stuck and I cannot tell" - and the second one is how a result sits
 * undelivered for a week.
 *
 * node --test test/ward-integration-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}
const base = {
  orgId: "org-wsq", ward: "", patients: [], view: "integration", sel: null,
  problems: [], due: [], dueAt: "", busy: false, err: "", note: "", refusal: null, loaded: true,
};
const view = (integration) => load()._render(Object.assign({}, base, { integration }));

const FULL = {
  errors: [],
  exceptions: { ok: true, open: [{ id: "x1", reason: "identity-ambiguous" }, { id: "x2", reason: "conflict-medication" }] },
  grants: { ok: true, grants: [
    { id: "g1", sourceSystem: "epic-a", actorId: "cfa:doc", state: "active", active: true, expired: false, grantedAt: "2026-09-01T00:00:00.000Z" },
    { id: "g2", sourceSystem: "lab-old", actorId: "cfa:lab", state: "expired", active: true, expired: true, expiresAt: "2026-08-01T00:00:00.000Z" },
    { id: "g3", sourceSystem: "gone-his", actorId: "cfa:x", state: "revoked", active: false, revokedReason: "contract ended" },
  ] },
  destinations: { ok: true, destinations: [
    { id: "d1", name: "partner-hospital", url: "https://fhir.partner.example/r4", resourceTypes: ["Patient"], active: true, auth: { kind: "bearer", configured: true } },
    { id: "d2", name: "old-registry", url: "https://old.example/r4", resourceTypes: ["Patient"], active: false, auth: { kind: "none" } },
  ] },
  outbound: { ok: true, counts: { queued: 3, failed: 1, delivered: 12, "dead-letter": 2 }, deadLetter: 2, deliveries: [
    { id: "dl-1", state: "dead-letter", destinationName: "partner-hospital", target: { resourceType: "Patient", id: "pat-1", version: 3, fhirType: "Patient" }, attempts: [1, 2, 3, 4, 5], lastError: "the destination answered 500" },
    { id: "f-1", state: "failed", destinationName: "partner-hospital", target: { resourceType: "Patient", id: "pat-2", version: 1, fhirType: "Patient" }, attempts: [1], nextAttemptAt: "2026-09-09T10:00:00.000Z", lastError: "the destination answered 503" },
    { id: "q-1", state: "queued", destinationName: "partner-hospital", target: { resourceType: "Patient", id: "pat-3", version: 1, fhirType: "Patient" }, attempts: [] },
    { id: "ok-1", state: "delivered", destinationName: "partner-hospital", target: { resourceType: "Patient", id: "pat-4", version: 1, fhirType: "Patient" }, attempts: [1] },
  ] },
};

/* ---- 1 ------------------------------------------------------------------------------------------ */

test("1. the console shows both directions and what is stuck in each", () => {
  const html = view(FULL);
  assert.match(html, /Integration/);
  assert.match(html, /Coming in/);
  assert.match(html, /Going out/);
  // Held, queued, retrying, given up, lapsed - the five things somebody may have to act on.
  assert.match(html, /held for a decision/);
  assert.match(html, /waiting to go out/);
  assert.match(html, /retrying/);
  assert.match(html, /given up/);
  assert.match(html, /lapsed authorisations/);
});

test("2. a count that could NOT be read renders as ? and says so, never as zero", () => {
  const html = view({ errors: ["outbound", "grants"], exceptions: { ok: true, open: [] } });
  assert.match(html, /could not be read/);
  assert.match(html, /do not read a zero here as nothing outstanding/);
  assert.ok(!/could not be read<\/small><\/li>\s*<li[^>]*><b>0<\/b>/.test(html), "an unread count is not also printed as 0");
  assert.match(html, /<b>\?<\/b>/, "the unreadable counts render as ?");
  // And the lists themselves say they could not be read rather than looking empty.
  assert.match(html, /The authorisation list could not be read/);
  assert.match(html, /The outbound queue could not be read/);
});

test("3. an empty console says plainly that nothing is connected, which is different from unreadable", () => {
  const html = view({ errors: [], exceptions: { ok: true, open: [] }, grants: { ok: true, grants: [] },
    destinations: { ok: true, destinations: [] }, outbound: { ok: true, counts: {}, deliveries: [] } });
  assert.match(html, /No source system has been authorised/);
  assert.match(html, /This hospital sends nothing out/);
  assert.match(html, /Nothing is waiting, retrying or stopped/);
  assert.ok(!html.includes("could not be read"), "nothing here is reported as unreadable");
});

/* ---- 4: the states a person acts on ------------------------------------------------------------- */

test("4. a lapsed authorisation is shown as lapsed, with which kind of lapse it was", () => {
  const html = view(FULL);
  assert.match(html, /epic-a/);
  assert.match(html, /lab-old/);
  assert.match(html, /expired/);
  assert.match(html, /gone-his/);
  assert.match(html, /contract ended/, "a revoked grant carries the reason it was revoked");
  // Only the live one can be withdrawn; the dead ones offer no button that would do nothing.
  assert.match(html, /data-w-act="srcrevoke:epic-a\|cfa:doc"/);
  assert.ok(!html.includes('data-w-act="srcrevoke:gone-his'), "a revoked grant is not offered for revocation");
});

test("5. only a dead-lettered delivery offers to be sent again, and delivered ones are not listed", () => {
  const html = view(FULL);
  assert.match(html, /data-w-act="outreplay:dl-1"/, "the one that gave up can be re-queued by a person");
  assert.ok(!html.includes('data-w-act="outreplay:f-1"'), "one that is still retrying is not");
  assert.ok(!html.includes('data-w-act="outreplay:q-1"'), "nor one that has not been tried");
  assert.ok(!html.includes("pat-4"), "what already reached the far end is not on an operations list");
  assert.match(html, /the destination answered 500/, "the far end's own words, not a paraphrase");
});

test("6. a destination whose credential is missing SAYS so, because it will never send", () => {
  const html = view({ errors: [], exceptions: { ok: true, open: [] }, grants: { ok: true, grants: [] },
    outbound: { ok: true, counts: {}, deliveries: [] },
    destinations: { ok: true, destinations: [{ id: "d", name: "partner", url: "https://p.example/r4", resourceTypes: ["Patient"], active: true, auth: { kind: "bearer", configured: false } }] } });
  assert.match(html, /NO CREDENTIAL CONFIGURED/);
});

test("7. the screen never claims to have sent anything, and says what sending actually is", () => {
  const html = view(FULL);
  assert.match(html, /Send what is due now/);
  assert.match(html, /Sending is not scheduled by this screen/);
  assert.ok(!/\bSent\b/.test(html), "nothing on this screen says 'sent'");
});

test("8. the console is reachable from the ward list, hospital-wide", () => {
  const html = load()._render(Object.assign({}, base, { view: "list" }));
  assert.match(html, /data-w-act="integration"/);
  assert.match(html, /Integration<\/button>/);
});
