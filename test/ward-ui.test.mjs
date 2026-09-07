/* test/ward-ui.test.mjs — the WardSynQ inpatient ward screen (ward.js). Pure _render, no DOM/network.
 *
 * The tests that matter here are the three rules the screen must not bend: it never decides a dose
 * is safe, it renders a refusal verbatim, and it never invents a due time.
 *
 * node --test test/ward-ui.test.mjs
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
  orgId: "org-wsq", ward: "", patients: [], view: "list", sel: null,
  problems: [], due: [], dueAt: "", busy: false, err: "", note: "", refusal: null, loaded: true,
};
const chart = Object.assign({}, base, {
  view: "chart",
  sel: { encounterId: "wsq-adm-x", patientId: "opd-pat-x", ward: "Ward A", bed: "12", admittedAt: "2026-09-07T04:00:00.000Z" },
});

test("the ward list shows a bed per admitted patient and says so plainly when empty", () => {
  const W = load();
  const empty = W._render(base);
  assert.match(empty, /No patients are currently admitted/);
  assert.ok(!empty.includes("data-w-act=\"open:"), "nothing to open");

  const full = W._render(Object.assign({}, base, {
    patients: [{ encounterId: "wsq-adm-1", patientId: "opd-pat-1", ward: "Ward A", bed: "07", admittedAt: "2026-09-07T04:00:00.000Z" }],
  }));
  assert.match(full, /data-w-act="open:wsq-adm-1"/);
  assert.match(full, />07</);
  assert.match(full, /Ward A/);
});

test("A REFUSAL IS RENDERED VERBATIM: every reason code reaches the nurse, none are collapsed", () => {
  const html = load()._render(Object.assign({}, chart, {
    refusal: { action: "administer", reasons: ["ALLERGY_CONTRAINDICATION", "DOSE_CEILING_EXCEEDED"], detail: "The order exceeds the daily ceiling." },
  }));
  assert.match(html, /ALLERGY_CONTRAINDICATION/);
  assert.match(html, /DOSE_CEILING_EXCEEDED/);
  assert.match(html, /The order exceeds the daily ceiling\./);
  assert.match(html, /Refused on administer/);
  assert.ok(!/\bfailed\b/i.test(html), "a refusal is never flattened into a generic failure");
});

test("a governance refusal keeps its reason codes too, and an ordinary error does not masquerade as one", () => {
  const W = load();
  assert.deepEqual(W._problem({ ok: false, error: "governance", reasons: ["WRITE_NOT_PERMITTED"] }).refusal.reasons, ["WRITE_NOT_PERMITTED"]);
  // The server's own message is shown, because "only available for a WardSynQ-native hospital" is
  // actionable and "something went wrong" is not.
  assert.equal(W._problem({ ok: false, error: "not_a_wardsynq_hospital", message: "The inpatient ward is only available for a WardSynQ-native hospital." }).err,
    "The inpatient ward is only available for a WardSynQ-native hospital.");
  assert.equal(W._problem({ ok: true }), null);
  assert.match(W._problem(null).err, /No response/);
});

test("the due time is the server's, computed from the frequency - the screen never derives one", () => {
  // This replaces the old rule 3. The nurse used to have to pick a round time and the screen had to
  // say the system was asserting nothing, because nothing computed a schedule. Now mar-schedule.js
  // does, and the two datetime fields are a VIEW WINDOW, not a claim about when a dose is due.
  const html = load()._render(Object.assign({}, chart, {
    from: "2026-09-09T00:00", to: "2026-09-10T00:00",
    due: [{ orderId: "rx-1", drug: "Paracetamol", dose: { value: 500, unit: "mg" }, frequency: "TDS", dueAt: "2026-09-09T02:30:00.000Z", status: null }],
  }));
  assert.match(html, /id="wFrom"/);
  assert.match(html, /id="wTo"/);
  assert.ok(!/wDueAt/.test(html), "the per-dose time picker is gone");
  assert.ok(!/round time is the one you chose/.test(html), "and so is the disclaimer it needed");

  // The dose carries its own computed time, and the action addresses it BY INDEX so a click acts on
  // the row the nurse is looking at rather than a time recomputed in the browser.
  assert.match(html, /data-w-act="mar:verify\|0"/);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(code, /dueAt: d\.dueAt/, "the server's own dueAt is sent back verbatim");
  assert.ok(!/new Date\(st\.dueAt\)/.test(code), "the browser never derives a dose time");
});

test("an overdue dose is marked, and one that was dealt with is not chased", () => {
  const html = load()._render(Object.assign({}, chart, {
    from: "2026-09-09T00:00", to: "2026-09-10T00:00",
    due: [
      { orderId: "rx-1", drug: "Paracetamol", dueAt: "2026-09-09T02:30:00.000Z", status: null, overdue: true },
      { orderId: "rx-2", drug: "Amoxicillin", dueAt: "2026-09-09T08:30:00.000Z", status: "administered", administeredAt: "2026-09-09T08:35:00.000Z", overdue: false },
    ],
  }));
  assert.match(html, /<li class="overdue">/);
  assert.match(html, /<span class="w-st overdue">overdue<\/span>/);
  assert.equal((html.match(/>overdue</g) || []).length, 1, "only the one that is actually overdue");
});

test("PRN is shown APART from the round, and an unreadable frequency is surfaced loudly", () => {
  const html = load()._render(Object.assign({}, chart, {
    from: "2026-09-09T00:00", to: "2026-09-10T00:00", due: [],
    prn: [{ orderId: "rx-3", drug: "Morphine", dose: { value: 5, unit: "mg" }, route: "iv" }],
    unscheduled: [{ orderId: "rx-4", drug: "Enoxaparin", frequency: "alternate days after dialysis", reason: "frequency_not_understood" }],
  }));
  // As-needed is visible to the ward but never among the doses that are due.
  assert.match(html, /As needed \(PRN\)/);
  assert.match(html, /Morphine/);
  assert.ok(!/data-w-act="mar:[a-z]+\|/.test(html), "a PRN drug gets no round action");
  assert.match(html, /Given on the patient/);
  // An order the ward cannot see on the round is a dose nobody knows is missing.
  assert.match(html, /Not on the round/);
  assert.match(html, /Enoxaparin/);
  assert.match(html, /alternate days after dialysis/);
  assert.match(html, /w-sub warn/);
});

test("a truncated round says so rather than looking complete", () => {
  const html = load()._render(Object.assign({}, chart, { truncated: true, due: [] }));
  assert.match(html, /More doses fall in this window than can be listed/);
});

test("the MAR offers only the transitions the state machine accepts, and nothing after a dose is given", () => {
  const W = load();
  // The eMAR's states are LOWER CASE (wardsynq-meds.js STATES). This map was written in capitals
  // first, so every lookup missed and the round rendered no buttons at all once a dose had a status.
  assert.deepEqual(W._nextFor(null), ["verify"], "an unstarted dose can only be verified");
  assert.deepEqual(W._nextFor("administered"), [], "a given dose has nowhere left to go");
  assert.deepEqual(W._nextFor("refused"), []);
  assert.ok(W._nextFor("dispensed").includes("scan"));
  assert.ok(!W._nextFor("dispensed").includes("administer"), "administering skips the scan; the five rights are checked on a scan");
  assert.deepEqual(W._nextFor("DISPENSED"), W._nextFor("dispensed"), "case never empties the round");

  const html = W._render(Object.assign({}, chart, {
    dueAt: "2026-09-07T09:00",
    due: [
      { orderId: "rx-1", drug: "Paracetamol", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS", status: "dispensed", administrationId: "mar-1" },
      { orderId: "rx-2", drug: "Amoxicillin", dose: { value: 250, unit: "mg" }, status: "administered", administeredAt: "2026-09-07T09:05:00.000Z" },
    ],
  }));
  // Doses are addressed by their index in the loaded round: rx-1 is 0, rx-2 is 1.
  assert.match(html, /data-w-act="mar:scan\|0"/);
  assert.ok(!html.includes('data-w-act="mar:administer|0"'), "no administer button before the scan");
  assert.ok(!html.includes('|1"'), "a given dose offers no action at all");
  assert.match(html, /No further action\./);
  assert.match(html, /500 mg/);
});

test("IT NEVER DECIDES A DOSE IS SAFE: there is no client-side safety rule anywhere in the file", () => {
  // A second copy of the rules is how the screen and the server start disagreeing about whether a
  // drug is contraindicated. This asserts the absence, because the absence IS the safety property.
  // Comments are stripped first: the file explains at length why it has no safety logic, and
  // scanning the prose would fail on the very sentences that promise the code is not there.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(!/allerg|interaction|contraindicat|maxdose|ceiling|cross.?react/i.test(code), "no clinical rule logic in the UI");
  assert.ok(!/wardsynq-safety|SafetyEngine|resolveGeneric|rulePack/i.test(code), "the UI does not reach for the safety engine");
  // It must not decide the five rights itself either: the scans go to the server untouched, and the
  // server compares them against the order. The UI only collects and forwards.
  assert.ok(!/scan\.patient\s*[=!]==|scan\.drug\s*[=!]==/.test(code), "the UI never compares a scan itself");
  assert.match(code, /body\.scan = \{ patient: val\("wScanP"\), drug: val\("wScanD"\) \}/, "scans are forwarded verbatim");
});

test("critical results sit ABOVE everything else on the chart, and say whose call each one was", () => {
  const html = load()._render(Object.assign({}, chart, {
    criticals: [
      { loopId: "l1", code: "2823-3", display: "Potassium", value: 7.4, unit: "mmol/L", basis: "limit", state: "open", escalation: { level: "escalate", minutesOpen: 95 } },
      { loopId: "l2", code: "Blood culture", display: "Blood culture", value: null, basis: "lab", state: "acknowledged", acknowledgedBy: "cfa:doc", escalation: { level: "none", minutesOpen: 0 } },
    ],
    problems: [{ problemId: "p1", display: "Pneumonia", codeSystem: "text", verificationStatus: "confirmed" }],
  }));
  assert.match(html, /Critical results &middot; 2/);
  assert.ok(html.indexOf("Critical results") < html.indexOf("Problem list"), "first on the chart");
  assert.match(html, /7\.4 mmol\/L/);
  // A laboratory's own flag and a configured threshold are never presented as the same thing.
  assert.match(html, /outside critical limit/);
  assert.match(html, /flagged by the lab/);
  assert.match(html, /95 min since reported/);
  assert.match(html, /ESCALATE/);
  // An open loop can be acknowledged; one already acknowledged names who saw it and offers nothing.
  assert.match(html, /data-w-act="ack:l1"/);
  assert.ok(!html.includes('data-w-act="ack:l2"'));
  assert.match(html, /acknowledged by cfa:doc/);
  assert.match(html, /It is not a way to clear the list\./);
});

test("a transfer is reachable from the chart, and a busy bed is explained rather than just refused", () => {
  const W = load();
  assert.match(W._render(chart), /data-w-act="move"/);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  // "bed 12 already has someone in it" is what a ward acts on; "could not transfer" is not.
  assert.match(code, /bed_occupied/);
  assert.match(code, /Choose another bed/);
  assert.match(code, /occupiedBy/);
  // The UI never decides a bed is free: it asks, and reports what the server says. Occupancy is
  // checked against every open admission, which the screen does not have and must not guess at.
  assert.ok(!/\.bed\s*===|occupied\s*=|isFree|bedFree/.test(code), "no client-side occupancy logic");
  assert.match(code, /apiPost\("\/ward\/transfer"/, "it asks the server");
});

test("fluid balance shows in and out beside the net, never the net alone", () => {
  const W = load();
  const html = W._render(Object.assign({}, chart, {
    balance: { intake: 3000, output: 2600, balance: 400, entries: 8, unit: "mL", complete: true, gaps: [], hours: [{}], byKind: {} },
  }));
  // "+400" alone hides whether this patient drank 400 and passed nothing, or took three litres and
  // passed 2.6. Those are different patients and one of them is in trouble.
  assert.match(html, /3000 mL/);
  assert.match(html, /2600 mL/);
  assert.match(html, /\+400 mL/);
  assert.match(html, /Every hour of this period has an entry\./);

  // An incomplete chart says so, in the caution tier, right beside the number.
  const thin = W._render(Object.assign({}, chart, {
    balance: { intake: 200, output: 0, balance: 200, entries: 1, unit: "mL", complete: false, gaps: new Array(11).fill("h"), hours: [{}], byKind: {} },
  }));
  assert.match(thin, /11 of the last 12 hours have nothing charted/);
  assert.match(thin, /Read this balance as incomplete\./);
  assert.match(thin, /w-hint warn/);
  // No balance at all is stated, not rendered as zero.
  assert.match(W._render(chart), /No fluid charted for this period\./);
  assert.ok(!/0 mL/.test(W._render(chart)), "an absent balance is never drawn as zeroes");
});

test("A FAILED READ NEVER LOOKS LIKE A CLEAR CHART", () => {
  const W = load();
  // No card at all when nothing is open, so it cannot become wallpaper a ward stops seeing.
  assert.ok(!/Critical results/.test(W._render(chart)));
  // But an unreachable list is not an empty one, and the difference is calm versus dangerous.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(code, /Do not read this chart as clear/);
  // Acknowledging requires a sentence: an acknowledgement with no action recorded is a tick-box.
  assert.match(code, /An acknowledgement records what was done/);
});

test("the problem list is read-only on the ward screen: a nurse sees the diagnosis, she does not assert one", () => {
  const html = load()._render(Object.assign({}, chart, {
    problems: [{ problemId: "p1", display: "Pneumonia", code: "J18.9", codeSystem: "ICD-10", verificationStatus: "confirmed", clinicalStatus: "active" }],
  }));
  assert.match(html, /Pneumonia/);
  assert.match(html, /J18\.9/);
  assert.match(html, /confirmed/);
  assert.ok(!/data-w-act="problem/.test(html), "no way to add a diagnosis from the ward screen");
  const none = load()._render(chart);
  assert.match(none, /A diagnosis is entered by the treating doctor\./);
});

test("vitals: every field the record path accepts is on the form, and blanks are not defaulted", () => {
  const html = load()._render(chart);
  for (const k of ["sbp", "dbp", "pulse", "rr", "temp", "spo2", "weight"]) {
    assert.match(html, new RegExp(`id="wv_${k}"`), `${k} is missing from the ward vitals form`);
  }
  assert.match(html, /Blank fields are not recorded/);
  assert.match(html, /never guessed at/);
});

test("HTML is escaped: a hostile ward or drug name cannot inject markup", () => {
  const html = load()._render(Object.assign({}, base, {
    patients: [{ encounterId: "<img src=x onerror=alert(1)>", patientId: "p&p", ward: '"><script>bad()</script>', bed: "1" }],
  }));
  assert.ok(!html.includes("<script>bad()"), "script tag escaped");
  // The payload's TEXT survives - that is correct, it is being displayed. What must not survive is
  // any character that could end an attribute or open a tag, so it can never stop being text.
  assert.ok(!html.includes("<img"), "tag never opens");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, "rendered as inert text");
  assert.ok(!/value="[^"]*"[^>]*<script/.test(html), "the quoted attribute is never broken out of");
  assert.match(html, /p&amp;p/);
});

test("THE CO-SIGN WORKLIST SAYS WHO WROTE IT, HOW LONG IT HAS WAITED, AND WHAT IS STILL BLANK", () => {
  const W = load();
  const q = {
    canSign: true,
    notes: [{ noteId: "n1", noteType: "progress", authorId: "cfa:locum", waitingMinutes: 195, incompleteSections: ["plan"] }],
    mine: [],
  };
  const html = W._render(Object.assign({}, base, { cosign: q }));
  assert.match(html, /written by cfa:locum/, "the author is named, not replaced by the signer");
  assert.match(html, /waiting 3 h 15 min/);
  /* The gap travels WITH the note to the person being asked to put their name to it: a signature
   * does not fill in a missing plan, and the signer should know before they sign, not after. */
  assert.match(html, /plan not filled in/);
  assert.match(html, /data-w-act="cosign:n1"/);

  // A reader who cannot sign is TOLD SO, rather than shown a button that will be refused - or a
  // silently empty list, which is how a queue grows while everybody assumes it is handled.
  const cannot = W._render(Object.assign({}, base, { cosign: Object.assign({}, q, { canSign: false }) }));
  assert.ok(!cannot.includes('data-w-act="cosign:n1"'));
  assert.match(cannot, /no verified registration/);

  // The author's own unfinished note offers the other half of the loop, and says plainly that
  // submitting is not signing.
  const mine = W._render(Object.assign({}, base, { cosign: { canSign: false, notes: [], mine: [{ noteId: "n2", noteType: "progress", incompleteSections: [] }] } }));
  assert.match(mine, /data-w-act="submitnote:n2"/);
  assert.match(mine, /It is not a signature/);
  assert.match(mine, /No notes are waiting on a signature/);

  // Nothing waiting and nothing of mine: the card stays off the screen entirely.
  assert.ok(!W._render(base).includes("Notes awaiting signature"));
});

test("THE OUTBOX NEVER READS 'SENT' AS 'ARRIVED', and an unsent prescription is named", () => {
  const W = load();
  const withTx = Object.assign({}, chart, {
    due: [{ orderId: "wsq-rx-1", drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, route: "oral", dueAt: "2026-09-07T09:00:00.000Z", status: null }],
    prn: [{ orderId: "wsq-rx-2", drug: "Paracetamol", dose: { value: 1, unit: "g" }, route: "oral" }],
    outbox: [
      { transmissionId: "wsq-tx-1", orderId: "wsq-rx-1", orderVersion: 2, channel: "pharmacy", destination: "City Pharmacy", state: "sent", outstanding: true, queuedAt: "2026-09-07T08:00:00.000Z" },
    ],
  });
  const html = W._render(withTx);
  /* The whole point of the card: "sent" is the transport saying it left, not the pharmacy saying it
   * has it. A screen that showed those as the same thing would tell a nurse a prescription is at the
   * counter when it is sitting in an outbox. */
  assert.match(html, /sent, not confirmed/);
  assert.ok(!/confirmed received/.test(html), "nothing has been confirmed here");
  assert.match(html, /order v2/, "and the version that left is on the row");
  assert.match(html, /data-w-act="txr:wsq-tx-1"/, "an outstanding one can be dealt with");

  // The medicine with nothing in the outbox is NAMED. An order nobody sent looks exactly like one
  // that arrived, unless the screen says otherwise.
  assert.match(html, /Not sent anywhere/);
  assert.match(html, /data-w-act="tx:wsq-rx-2"/);
  assert.ok(!html.includes('data-w-act="tx:wsq-rx-1"'), "the one already in the outbox is not offered again");

  // A failure carries its reason, and resolving it never restyles it as delivered.
  const failed = W._render(Object.assign({}, withTx, {
    outbox: [{ transmissionId: "wsq-tx-1", orderId: "wsq-rx-1", channel: "pharmacy", state: "failed", outstanding: false, failureReason: "Pharmacy endpoint refused the message.", resolvedAt: "2026-09-07T10:00:00.000Z", resolution: "Printed and handed over." }],
  }));
  assert.match(failed, /Pharmacy endpoint refused the message\./);
  assert.match(failed, /not delivered/);
  assert.match(failed, /Dealt with: Printed and handed over\./);
  assert.ok(!/confirmed received/.test(failed), "a resolved failure is not a delivery");

  // Nothing prescribed and nothing sent: the card stays off the chart rather than showing an empty box.
  assert.ok(!W._render(chart).includes("Prescriptions sent"));
});
