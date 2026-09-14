/* S3 P0 pure pieces: the recipient ladder (PUSH-07 tiers), the owner's sign-off on the defaults (O5), the
 * device directory, the SMS window (O4), the staff alert mobile, and the Admin card's read-back.
 *
 * node --test test/wardsynq-alert-recipients.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolveRecipients, levelsFor, nextLevel, DEFAULT_LEVELS } from "../functions/_wardsynq/alert-recipients.js";
import { deviceDirectory } from "../functions/_wardsynq/device-directory.js";
import { smsFallbackDue, levelWindowMinutes, phoneCoverage } from "../functions/_wardsynq/push-alerts.js";
import { alertMobileOf, membership } from "../functions/_opd_org.js";

const records = {
  "DiagnosticReport/r1": { serviceRequestId: "sr1" },
  "ServiceRequest/sr1": { requesterId: "dr-order" },
  "Encounter/e1": { location: { ward: "Medical A", bed: "7" } },
};
const members = [
  { identity: "dr-duty", role: "doctor" }, { identity: "res-duty", role: "resident" }, { identity: "sup", role: "supervisor" },
  { identity: "nurse", role: "nurse" }, { identity: "gone", role: "doctor", active: false }, { identity: "lab", role: "lab" },
];
const onDutyIn = { "Medical A": ["dr-duty", "res-duty", "sup", "nurse", "gone", "lab"] };
const readers = (seen) => ({
  latest: async (t, id) => records[t + "/" + id] || null,
  members: async () => members,
  onDuty: async (unit) => { if (seen) seen.push(unit); return { onDuty: (onDutyIn[unit] || []).map((identity) => ({ identity, unit })) }; },
});
const loop = { id: "l1", reportId: "r1", encounterId: "e1" };

test("the default ladder: ordering clinician and on-duty doctors, then supervisors and nurses, cumulative; the inactive and other roles never", async () => {
  const due = await resolveRecipients({ orgId: "o", loop, level: "due" }, readers());
  assert.deepEqual(due.recipients, ["o~dr-order", "o~dr-duty", "o~res-duty"]);
  assert.deepEqual(due.location, { ward: "Medical A", bed: "7" });
  const over = await resolveRecipients({ orgId: "o", loop, level: "overdue" }, readers());
  assert.deepEqual(over.recipients, ["o~dr-order", "o~dr-duty", "o~res-duty", "o~sup", "o~nurse"]);
  const top = await resolveRecipients({ orgId: "o", loop, level: "escalate", policy: { levels: { escalate: { contacts: ["cmo"] } } } }, readers());
  assert.ok(top.recipients.includes("o~cmo") && top.recipients.includes("o~nurse"), "the top tier adds named contacts to everyone before");
  assert.equal(nextLevel("due"), "overdue"); assert.equal(nextLevel("overdue"), "escalate"); assert.equal(nextLevel("escalate"), null);
});

test("O5: the defaults carry the owner's sign-off; a hospital's own ladder does not borrow it", () => {
  assert.deepEqual({ ...DEFAULT_LEVELS.approval }, { approvedBy: "Dr Manoj Kurmana", approvedOn: "2026-09-14", decision: "O5" });
  assert.equal(levelsFor(null).approval, DEFAULT_LEVELS.approval);
  const own = levelsFor({ levels: { due: { roles: ["doctor"] } } });
  assert.equal(own.approval, null);
  assert.equal(own.hospitalSet, true);
  assert.deepEqual(own.due.roles, ["doctor"]);
  assert.deepEqual(own.overdue.roles, ["supervisor", "nurse"], "unset levels keep the defaults");
});

test("NO_RECIPIENT is an answer, not an empty list; an unknown ward asks the whole hospital's rota", async () => {
  const none = await resolveRecipients({ orgId: "o", loop, level: "due", policy: { levels: { due: { orderer: false, roles: [] } } } }, readers());
  assert.deepEqual(none.recipients, []);
  assert.equal(none.reason, "NO_RECIPIENT");
  const seen = [];
  await resolveRecipients({ orgId: "o", loop: { id: "l2", reportId: "r1", encounterId: "missing" }, level: "due" }, readers(seen));
  assert.deepEqual(seen, [""]);
});

test("device directory: bind under every identity form, unbind removes them all, notice pointers need a real nid", async () => {
  const m = new Map();
  const dir = deviceDirectory({ get: async (k) => m.get(k) || null, put: async (k, v) => m.set(k, v), delete: async (k) => m.delete(k) });
  await dir.bind("o", ["doc@h.in", "fb:uid1"], "tok1");
  await dir.bind("o", ["doc@h.in"], "tok2");
  assert.deepEqual(await dir.devicesFor("o", "doc@h.in"), ["tok2", "tok1"]);
  assert.deepEqual(await dir.devicesFor("o", "fb:uid1"), ["tok1"]);
  assert.deepEqual(await dir.devicesFor("other", "doc@h.in"), [], "per hospital");
  assert.equal((await dir.unbind("o", "doc@h.in")).removed, 2);
  assert.deepEqual(await dir.devicesFor("o", "fb:uid1"), []);
  await dir.putNotice("a".repeat(32), { orgId: "o" });
  assert.deepEqual(await dir.getNotice("a".repeat(32)), { orgId: "o" });
  assert.equal(await dir.getNotice("../push:who:o~x"), null);
  assert.equal(deviceDirectory(null), null);
});

test("O4 window: SMS is owed once per addressed notice with no delivered receipt, after its level's time", () => {
  const at = Date.parse("2026-09-14T10:00:00Z");
  const base = { nid: "n1", level: "due", at: new Date(at).toISOString(), recipients: ["o~a"], receipts: [] };
  const l = (n) => ({ state: "open", notifications: [n] });
  assert.equal(levelWindowMinutes("due"), 30); assert.equal(levelWindowMinutes("overdue", { acknowledgeWithinMinutes: 20, escalateAfterMinutes: 45 }), 25);
  assert.deepEqual(smsFallbackDue(l(base), at + 29 * 60000), []);
  assert.deepEqual(smsFallbackDue(l(base), at + 30 * 60000), ["n1"]);
  assert.deepEqual(smsFallbackDue(l({ ...base, receipts: [{ kind: "delivered", by: "o~a" }] }), at + 60 * 60000), []);
  assert.deepEqual(smsFallbackDue(l({ ...base, sms: { at: "x" } }), at + 60 * 60000), [], "once");
  assert.deepEqual(smsFallbackDue(l({ ...base, recipients: [] }), at + 60 * 60000), [], "nobody to text");
  assert.deepEqual(smsFallbackDue({ ...l(base), state: "acknowledged" }, at + 60 * 60000), []);
});

test("staff alert mobile: digits with an optional +, kept on the membership, nonsense dropped", () => {
  assert.equal(alertMobileOf("98765 43210"), "9876543210");
  assert.equal(alertMobileOf("+91 (98765) 43210"), "+919876543210");
  assert.equal(alertMobileOf("call me"), "");
  assert.equal(membership({ id: "m", orgId: "o", identity: "n", role: "nurse", alertMobile: "9876543210" }).alertMobile, "9876543210");
});

test("Admin card: shows the sign-off and what is missing, and saves exactly the shape the server reads", () => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sb = { window: { WSQ: { page() {} } } };
  sb.WSQ = sb.window.WSQ;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), sb);
  const C = sb.window.WSQ._alertCard;
  assert.match(C.html(esc, null), /Loading/);
  assert.match(C.html(esc, false), /could not be loaded/);
  const status = { ok: true, enabled: true, levels: levelsFor(null), defaults: DEFAULT_LEVELS, minutes: { acknowledgeWithinMinutes: 30, escalateAfterMinutes: 60 },
    failures: [{ loopId: "wsq-crit-x", level: "due", at: "2026-09-14T10:00:00Z", reason: "NO_RECIPIENT" }], noDevice: [{ identity: "o~nurse1", times: 2 }],
    sms: { ready: false, missing: ["This hospital's DLT template name for critical-result SMS is not set."], senderId: "", templateName: "" } };
  const html = C.html(esc, status);
  assert.match(html, /approved by Dr Manoj Kurmana on 2026-09-14 \(owner decision O5\)/);
  assert.match(html, /id="alEnabled" checked/);
  assert.match(html, /SMS fallback is not configured/);
  assert.match(html, /template name for critical-result SMS is not set/);
  assert.match(html, /nobody could be found to tell/);
  assert.match(html, /o~nurse1/);
  assert.doesNotMatch(html, /UNAPPROVED|—/);
  const out = C.read({ enabled: true, senderId: " WSQHSP ", templateName: "WSQ_CRITICAL", escalation: { acknowledgeWithinMinutes: 20 },
    levels: { due: { orderer: true, roles: ["doctor"], contactsText: "" }, overdue: { orderer: true, roles: ["supervisor"], contactsText: "" }, escalate: { orderer: false, roles: [], contactsText: "cmo@h.in\n\n" } } });
  const w = JSON.parse(JSON.stringify(out.wardsynq));
  assert.deepEqual(w.alerts, { push: { enabled: true }, sms: { provider: "twofactor", senderId: "WSQHSP", templateName: "WSQ_CRITICAL" } });
  assert.equal(w.criticalEscalation.acknowledgeWithinMinutes, 20, "the minutes already saved are kept");
  const back = levelsFor(w.criticalEscalation);
  assert.deepEqual(back.escalate.contacts, ["cmo@h.in"]);
  assert.deepEqual(back.due.roles, ["doctor"]);
});

test("critical results board (GET /ward/criticals on ward.js): a push to nobody is said in words; a push to phones is SENT, not 'nobody was notified'", () => {
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  const W = sb.window.WARD;
  const board = (loop) => W._render({ ...W._st, view: "critsboard", critsBoard: [{ loopId: "c1", patientId: "p1", display: "Potassium", value: 7.1, state: "open", escalation: { level: "overdue", minutesOpen: 40 }, ...loop }] });
  assert.match(board({ notifications: [{ nid: null, level: "due", reason: "NO_RECIPIENT" }] }), /Alert did not reach anyone:<\/b> nobody could be found to tell/);
  const pushed = board({ escalations: [{ level: "overdue", at: "2026-09-14T10:30:00Z", minutesOpen: 30, notification: { delivered: false, channels: [{ channel: "mobile", delivered: false }] } }],
    notifications: [{ nid: "a", level: "due", sent: 1 }, { nid: "b", level: "overdue", sent: 2 }] });
  assert.match(pushed, /sent to 2 phone\(s\), not yet confirmed/);
  assert.doesNotMatch(pushed, /nobody was notified|did not reach anyone/);
  assert.doesNotMatch(board({ notifications: [{ nid: "a", level: "due", reason: "NO_DEVICE", sms: { sent: 1 } }] }), /did not reach anyone/, "an SMS that went out told somebody");
});

test("phoneCoverage: on-duty members with a ladder role and named contacts, checked against the directory; any failed read is ok:false", async () => {
  const kv = new Map();
  const dir = deviceDirectory({ get: async (k) => kv.get(k) || null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } });
  await dir.bind("o", ["dr-duty"], "tok1");
  const rs = { members: async () => members, onDuty: async (unit) => ({ onDuty: unit === "" ? ["dr-duty", "nurse", "gone", "lab"].map((identity) => ({ identity })) : [] }) };
  const levels = levelsFor({ levels: { escalate: { contacts: ["cmo"] } } });
  const r = await phoneCoverage({ orgId: "o", directory: dir, readers: rs }, levels);
  assert.deepEqual(r, { ok: true, checked: 3, partial: false, noDevice: [{ identity: "nurse", role: "nurse", why: "on duty" }, { identity: "cmo", role: null, why: "named contact" }] });
  const broken = { ...dir, devicesFor: async () => { throw new Error("store down"); } };
  assert.equal((await phoneCoverage({ orgId: "o", directory: broken, readers: rs }, levels)).ok, false);
  assert.equal((await phoneCoverage({ orgId: "o", directory: dir, readers: { ...rs, onDuty: async () => { throw new Error("rota"); } } }, levels)).ok, false);
  assert.equal((await phoneCoverage({ orgId: "o", directory: null, readers: rs }, levels)).ok, false, "no store is not everyone having a phone");
});

test("Admin card: phones now, from the registrations; a failed read is never shown as everyone having one", () => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sb = { window: { WSQ: { page() {} } } };
  sb.WSQ = sb.window.WSQ;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), sb);
  const C = sb.window.WSQ._alertCard;
  const base = { ok: true, enabled: true, levels: levelsFor(null), defaults: DEFAULT_LEVELS, minutes: {}, failures: [], noDevice: [], sms: { ready: true } };
  const some = C.html(esc, { ...base, phones: { ok: true, checked: 3, noDevice: [{ identity: "nurse7", role: "nurse", why: "on duty" }, { identity: "cmo@h.in", role: null, why: "named contact" }] } });
  assert.match(some, /No phone registered for alerts \(2 of 3\)/);
  assert.match(some, /nurse7 \(on duty, nurse\)/);
  assert.match(some, /cmo@h.in \(named contact\)/);
  assert.match(C.html(esc, { ...base, phones: { ok: true, checked: 3, noDevice: [] } }), /All 3 people on duty/);
  for (const p of [{ ok: false, error: "read_failed" }, undefined]) {
    const h = C.html(esc, { ...base, phones: p });
    assert.match(h, /could not be read/);
    assert.doesNotMatch(h, /have a phone registered\./);
  }
  assert.match(C.html(esc, { ...base, phones: { ok: true, checked: 0, noDevice: [] } }), /nobody to check/);
});

/* Owner decision 2026-09-14: level-2 nurses by a named per-hospital rule (criticalEscalation.level2NurseRule). */
const { level2NurseRuleOf, level2NurseRuleRefusal, level2NurseRecipients, LEVEL2_NURSE_RULES } = await import("../functions/_wardsynq/alert-recipients.js");

test("level-2 nurse rule: one rule, absent is the default, an unknown stored rule is applied as the default and named; a save naming another is refused", () => {
  assert.deepEqual(Object.keys(LEVEL2_NURSE_RULES), ["all-on-duty-nurses-in-ward"]);
  const d = level2NurseRuleOf(null);
  assert.deepEqual([d.rule, d.source], ["all-on-duty-nurses-in-ward", "default"]);
  assert.match(d.note, /until a Nurse-in-Charge role or assignment is implemented/);
  assert.equal(level2NurseRuleOf({ level2NurseRule: "all-on-duty-nurses-in-ward" }).source, "hospital");
  const odd = level2NurseRuleOf({ level2NurseRule: "nurse-in-charge" });
  assert.deepEqual([odd.rule, odd.source, odd.configured], ["all-on-duty-nurses-in-ward", "unrecognised", "nurse-in-charge"]);
  assert.equal(level2NurseRuleRefusal({ level2NurseRule: "all-on-duty-nurses-in-ward" }), null);
  assert.equal(level2NurseRuleRefusal({ acknowledgeWithinMinutes: 20 }), null);
  assert.equal(level2NurseRuleRefusal(null), null);
  assert.match(level2NurseRuleRefusal({ level2NurseRule: "nurse-in-charge" }), /"nurse-in-charge" was not saved\. The only rule built is "all-on-duty-nurses-in-ward"/);
  assert.throws(() => level2NurseRecipients("nurse-in-charge", { active: new Map(), duty: [] }), /has no resolver/);
});

test("level 2: a nurse off duty, or on duty in another ward, is not alerted; the result names the rule and how many nurses", async () => {
  const people = [...members, { identity: "nurse-off", role: "nurse" }, { identity: "nurse-surg", role: "nurse" }];
  // A rota reader that (wrongly) hands back another ward's nurse too: the rule checks the assignment's own ward itself.
  const leaky = { ...readers(), members: async () => people,
    onDuty: async (unit) => ({ onDuty: [...onDutyIn[unit].map((identity) => ({ identity, unit })), { identity: "nurse-surg", unit: "Surgical B" }] }) };
  const over = await resolveRecipients({ orgId: "o", loop, level: "overdue" }, leaky);
  assert.ok(over.recipients.includes("o~nurse"), "the on-duty nurse in the patient's ward");
  assert.ok(!over.recipients.includes("o~nurse-off"), "a nurse with no shift now is not alerted");
  assert.ok(!over.recipients.includes("o~nurse-surg"), "a nurse on duty in another ward is not alerted");
  assert.deepEqual(over.nurseRule, { rule: "all-on-duty-nurses-in-ward", source: "default", ward: "Medical A", nurses: 1 });
  assert.equal((await resolveRecipients({ orgId: "o", loop, level: "due" }, leaky)).nurseRule, undefined, "level 1 has no nurse rule");
  const top = await resolveRecipients({ orgId: "o", loop, level: "escalate", policy: { level2NurseRule: "all-on-duty-nurses-in-ward" } }, leaky);
  assert.deepEqual([top.nurseRule.source, top.nurseRule.nurses], ["hospital", 1], "the top tier still carries the level-2 nurses, by the same rule");
  const odd = await resolveRecipients({ orgId: "o", loop, level: "overdue", policy: { level2NurseRule: "nurse-in-charge" } }, leaky);
  assert.ok(odd.recipients.includes("o~nurse"), "an unknown stored rule never silences the ward's nurses");
  assert.deepEqual([odd.nurseRule.source, odd.nurseRule.configured], ["unrecognised", "nurse-in-charge"]);
});

test("level 2: the ward's on-duty nurse set empty and nobody else on the tier is NO_RECIPIENT, with the rule and zero nurses recorded", async () => {
  const empty = { ...readers(), onDuty: async () => ({ onDuty: [{ identity: "nurse", unit: "Surgical B" }] }) };
  const policy = { levels: { due: { orderer: false, roles: [] }, overdue: { orderer: false, roles: ["nurse"] } } };
  const r = await resolveRecipients({ orgId: "o", loop, level: "overdue", policy }, empty);
  assert.deepEqual(r.recipients, []);
  assert.equal(r.reason, "NO_RECIPIENT");
  assert.equal(r.nurseRule.nurses, 0);
});

test("Critical result alerts card: the level 2 nurse rule is shown read-only with its Nurse-in-Charge note", () => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sb = { window: { WSQ: { page() {} } } };
  sb.WSQ = sb.window.WSQ;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), sb);
  const C = sb.window.WSQ._alertCard;
  const base = { ok: true, enabled: true, levels: levelsFor(null), defaults: DEFAULT_LEVELS, minutes: {}, failures: [], noDevice: [], sms: { ready: true }, phones: { ok: true, checked: 0, noDevice: [] } };
  const html = C.html(esc, { ...base, nurseRule: level2NurseRuleOf(null) });
  assert.match(html, /Level 2 nurse rule<\/dt><dd><span class="mono">all-on-duty-nurses-in-ward<\/span> <span class="quiet">\(default\)/);
  assert.match(html, /until a Nurse-in-Charge role or assignment is implemented\. It cannot be changed on this card/);
  assert.doesNotMatch(html, /—/);
  assert.match(C.html(esc, { ...base, nurseRule: level2NurseRuleOf({ level2NurseRule: "nurse-in-charge" }) }), /saved rule "nurse-in-charge" is not one this build has/);
  assert.match(C.html(esc, base), /level 2 nurse rule could not be read/);
  // The card's own save keeps the saved rule: readAlertCard carries every criticalEscalation key it does not edit.
  const out = C.read({ enabled: true, senderId: "", templateName: "", escalation: { level2NurseRule: "all-on-duty-nurses-in-ward" }, levels: {} });
  assert.equal(out.wardsynq.criticalEscalation.level2NurseRule, "all-on-duty-nurses-in-ward");
});
