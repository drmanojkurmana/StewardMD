/* test/discharge-ui.test.mjs — the WardSynQ discharge summary workstation (discharge.js).
 * Pure _render, no DOM/network.
 *
 * The tests that matter are the promises the screen makes: it never invents clinical information,
 * it never lets the record's words and a clinician's be confused, a signed summary is finished, and
 * outstanding work is visible before the sign-off rather than after it.
 *
 * node --test test/discharge-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../discharge.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.DISCHARGE;
}

const ASSEMBLED = {
  admission: "Ward: Medical A, bed 12.\nAdmitted: 2026-09-07T08:00:00.000Z.",
  diagnoses: "Active:\nPneumonia, unspecified organism [J18.9] - confirmed",
  allergies: "Penicillin - severity high, verified",
  vitals: "On admission (2026-09-07): Heart rate 96 /min",
  investigations: "Chest X-ray (completed)",
  medications: "Paracetamol 500mg - 500 mg, oral, TID (active); doses administered on this admission: 3",
  assessment: "Not recorded.",
  plan: "Not recorded.",
  // The assembler's real provenance wording (migrate-discharge.js), not a paraphrase of it.
  provenance: "Assembled automatically from this admission's clinical record: the admission encounter, "
    + "recorded observations, medication orders and administrations, documented allergies, "
    + "investigation requests and clinician notes. Nothing here is generated or inferred; a section "
    + 'reading "Not recorded." means no such entry exists in the record. Review and sign before use.',
};
const base = {
  orgId: "org-wsq", encounterId: "wsq-adm-1", patientId: "opd-pat-1",
  patient: { name: "Asha Rao", mrn: "SMD-WARD01-00001", sex: "female", dob: "1972-04-02", provisional: false },
  encounter: { status: "finished", class: "IPD", ward: "Medical A", bed: "12", admittedAt: "2026-09-07T08:00:00.000Z", dischargedAt: "2026-09-10T06:00:00.000Z", disposition: "home" },
  assembled: ASSEMBLED, sections: { ...ASSEMBLED }, edited: [], pending: [],
  signed: false, signedBy: null, noteId: null, version: 1, recordedAt: null,
  canAuthor: true, hasDraft: true,
  editing: "", compare: {}, busy: false, loaded: true, err: "", note: "", refusal: null,
};
const S = (over) => ({ ...base, ...(over || {}) });

test("patient identity and encounter status are on the document, and are never guessed at", () => {
  const html = load()._render(S());
  assert.match(html, /Asha Rao/);
  assert.match(html, /SMD-WARD01-00001/);
  assert.match(html, /Medical A, bed 12/);
  assert.match(html, /Discharged/);
  // A stay that is still open says so: a summary drafted mid-stay must not read as a closed one.
  const openStay = load()._render(S({ encounter: { ...base.encounter, status: "in-progress", dischargedAt: null } }));
  assert.match(openStay, /Still admitted/);
  assert.ok(!/Discharged<\/dt><dd>[^n]/.test(openStay) || /not yet/.test(openStay), "and does not claim a discharge time it does not have");
  assert.match(openStay, /not yet/);
});

test("an unmerged trauma identity is flagged, because this document leaves the hospital", () => {
  const html = load()._render(S({ patient: { ...base.patient, provisional: true } }));
  assert.match(html, /Provisional identity, not yet merged/);
  assert.ok(!/Provisional/.test(load()._render(S())), "and a confirmed identity is not labelled");
});

test("all eight assembled sections are rendered, in a clinical reading order, and none are invented", () => {
  const W = load();
  assert.deepEqual(W._sections.map((s) => s.k),
    ["admission", "diagnoses", "allergies", "vitals", "investigations", "medications", "assessment", "plan"],
    "allergies sit high, where a receiving clinician looks");
  const html = W._render(S());
  for (const s of W._sections) assert.match(html, new RegExp(`id="dsec-${s.k}"`), `${s.k} is missing`);
  // The screen renders only what the assembler produces. It has no ninth section of its own.
  assert.equal(W._sections.length, 8);
});

test("NEVER INVENTS: an absent section says so explicitly rather than rendering as blank space", () => {
  const html = load()._render(S());
  assert.match(html, /class="d-body absent">Not recorded\./, "an absence is stated, not left as a gap");
  assert.match(html, /Nothing here is generated or inferred/, "and the provenance line travels with it");
});

test("THE RECORD'S WORDS AND THE CLINICIAN'S ARE NEVER CONFUSED", () => {
  const W = load();
  // Untouched: marked as coming from the record.
  const clean = W._render(S());
  assert.match(clean, /From record/);
  assert.ok(!/Clinician edited/.test(clean));
  assert.match(clean, /Every section above is assembled from the record\. Nothing has been edited\./);

  // Edited: marked as the clinician's, and the record's own text stays one tap away.
  const edited = S({ edited: ["plan"], sections: { ...ASSEMBLED, plan: "Review in clinic in one week." } });
  const html = W._render(edited);
  assert.match(html, /Clinician edited/);
  assert.match(html, /Review in clinic in one week\./);
  assert.match(html, /data-d-act="compare:plan"/, "the record's version is reachable");
  assert.ok(!html.includes("Assembled from the record</span>"), "and collapsed until asked for");
  assert.match(html, /Corrected by a clinician: plan and follow-up/, "the provenance block names which sections");

  // Expanded, both are on screen at once and attributed.
  const open = W._render({ ...edited, compare: { plan: true } });
  assert.match(open, /Assembled from the record/);
  assert.match(open, /Review in clinic in one week\./);
  assert.match(open, /Hide what the record says/);
});

test("editing one section cannot destroy the others", () => {
  const W = load();
  const html = W._render(S({ editing: "assessment" }));
  assert.match(html, /id="dEdit"/);
  assert.match(html, /Saved text replaces this section only\. Every other section keeps refreshing from the record\./);
  // The save sends ONLY the edited key; the server re-assembles everything else.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(code, /patch\[k\] = val\("dEdit"\)/, "one key, not the whole document");
  assert.ok(!/sections: st\.sections/.test(code), "the screen never posts its whole section set back");

  // A correction can be taken back rather than being frozen forever.
  assert.match(W._render(S({ editing: "plan", edited: ["plan"] })), /data-d-act="revert:plan"/);
  assert.ok(!/data-d-act="revert:/.test(W._render(S({ editing: "plan" }))), "nothing to revert on an untouched section");
});

test("A SIGNED SUMMARY IS FINISHED: every edit affordance is gone, not merely disabled", () => {
  const W = load();
  const signed = S({ signed: true, signedBy: "cfa:doctor", recordedAt: "2026-09-10T07:00:00.000Z", version: 3, edited: ["plan"] });
  const html = W._render(signed);
  assert.ok(!/data-d-act="edit:/.test(html), "no edit buttons");
  assert.ok(!/data-d-act="draft"/.test(html), "no save");
  assert.ok(!/data-d-act="sign"/.test(html), "and it cannot be signed twice");
  assert.ok(!/id="dEdit"/.test(html), "no editor");
  assert.match(html, /Signed off/);
  assert.match(html, /this version is locked/);
  assert.match(html, /A correction is a new signed version, not a change to this one\./);
  assert.match(html, /v3/, "the version is on the document");
  assert.match(html, /Clinician edited/, "and signing did not erase whose words these were");
  // Printing stays available on a signed document; that is the point of one.
  assert.match(html, /data-d-act="print"/);
});

test("signing is guarded, visually distinct from saving, and warns about what is unresolved", () => {
  const W = load();
  const html = W._render(S({ pending: [{ kind: "dose", id: "m1", status: "verified", orderId: "rx-1", drug: "Paracetamol" }] }));
  assert.match(html, /class="d-btn sign"/, "the locking act is not styled as another Save");
  assert.match(html, /1 outstanding/, "and the action bar says so where the button is");

  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(code, /confirmed\(/, "signing goes through an explicit confirmation");
  assert.match(code, /CANNOT be edited/, "which states that it is irreversible");
  assert.match(code, /still outstanding on this stay/, "and repeats what is unresolved at the moment of signing");
});

test("OUTSTANDING WORK IS SHOWN BEFORE SIGN-OFF, and restrained: it does not block a discharge", () => {
  const W = load();
  const html = W._render(S({ pending: [
    { kind: "dose", id: "m1", status: "verified", orderId: "rx-1", drug: "Paracetamol" },
    { kind: "investigation", id: "sr-1", status: "active", display: "Blood culture" },
    { kind: "problem", id: "p1", status: "provisional", display: "Query sepsis" },
  ] }));
  assert.match(html, /Outstanding &middot; 3/);
  assert.match(html, /Dose not finished/);
  assert.match(html, /Blood culture/);
  assert.match(html, /Diagnosis unconfirmed/);
  assert.match(html, /None of this stops a discharge\. It should be a decision, not a discovery\./);
  // Amber, never the critical tier: this is information, not an alarm.
  assert.match(html, /class="d-card warn"/);
  assert.ok(!/d-banner err/.test(html), "nothing here is an error");

  assert.match(W._render(S()), /Nothing is left open on this stay\./);
});

test("IT ASKS FOR NOTHING IT CANNOT DO: a reader gets no author or sign controls", () => {
  const W = load();
  const ro = W._render(S({ canAuthor: false }));
  assert.ok(!/data-d-act="sign"/.test(ro));
  assert.ok(!/data-d-act="draft"/.test(ro));
  assert.ok(!/data-d-act="edit:/.test(ro));
  assert.match(ro, /Authoring and signing it needs a treating clinician\./);
  assert.match(ro, /data-d-act="print"/, "but a reader can still print what is on screen");
  assert.match(ro, /Read only for you/);
});

test("a refusal keeps its reason codes, and an error is not dressed up as one", () => {
  const W = load();
  assert.deepEqual(W._problem({ ok: false, error: "governance", reasons: ["WRITE_NOT_PERMITTED"] }).refusal.reasons, ["WRITE_NOT_PERMITTED"]);
  assert.match(W._problem({ ok: false, error: "already_signed", detail: "this discharge summary is signed" }).err, /signed/);
  assert.equal(W._problem({ ok: true }), null);
  const html = W._render(S({ refusal: { reasons: ["WRITE_NOT_PERMITTED"], detail: "The record service refused this write." } }));
  assert.match(html, /WRITE_NOT_PERMITTED/);
  assert.match(html, /class="d-banner warn"/);
});

test("the printed document is its own artifact, and an unsigned one says it is a draft", () => {
  const W = load();
  W._render(S());                       // _printable reads module state, so render a state in first
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  // Built from plain markup rather than printing the themed overlay: a dark-mode summary on paper
  // is exactly the failure this avoids.
  // It takes the state it prints, so the paper can never describe a different document than the
  // screen. It read module state in the first draft, which made the two able to drift apart.
  assert.match(code, /function printable\(s\)/);
  assert.ok(!/function printable\(\)/.test(code));
  assert.match(code, /UNSIGNED DRAFT - not a final discharge summary\./);
  assert.match(code, /Signed by/);
  // Every section reaches the paper, not just the ones that fit on screen.
  assert.match(code, /SECTIONS\.map\(function \(sec, i\)/);
});

test("HTML is escaped: hostile record text cannot inject markup into a clinical document", () => {
  const html = load()._render(S({
    patient: { ...base.patient, name: '<img src=x onerror=alert(1)>' },
    sections: { ...ASSEMBLED, plan: "</p><script>bad()</script>" },
  }));
  assert.ok(!html.includes("<script>bad()"), "script tag escaped");
  assert.ok(!html.includes("<img"), "tag never opens");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("no emoji anywhere: icons are the bundled Material Symbols, as everywhere else in the app", () => {
  // The house rule, stated in queue.css, opd-emr.js and ward.css. Worth enforcing rather than
  // trusting, because one stray emoji in a medico-legal document is a real problem.
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SRC), "discharge.js carries no emoji");
  assert.match(SRC, /function ms\(name, fill\)/);
});
