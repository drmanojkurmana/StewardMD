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
  const c = { esc };
  assert.match(C.html(c, null), /Loading/);
  assert.match(C.html(c, false), /could not be loaded/);
  const status = { ok: true, enabled: true, levels: levelsFor(null), defaults: DEFAULT_LEVELS, minutes: { acknowledgeWithinMinutes: 30, escalateAfterMinutes: 60 },
    failures: [{ loopId: "wsq-crit-x", level: "due", at: "2026-09-14T10:00:00Z", reason: "NO_RECIPIENT" }], noDevice: [{ identity: "o~nurse1", times: 2 }],
    sms: { ready: false, missing: ["This hospital's DLT template name for critical-result SMS is not set."], senderId: "", templateName: "" } };
  const html = C.html(c, status);
  assert.match(html, /approved by Dr Manoj Kurmana on 2026-09-14 \(owner decision O5\)/);
  assert.match(html, /id="alEnabled" checked/);
  assert.match(html, /SMS fallback is not configured/);
  assert.match(html, /template name for critical-result SMS is not set/);
  assert.match(html, /nobody could be found to tell/);
  assert.match(html, /o~nurse1/);
  assert.doesNotMatch(html, /UNAPPROVED|—/);
  const out = C.read(c, { enabled: true, senderId: " WSQHSP ", templateName: "WSQ_CRITICAL", escalation: { acknowledgeWithinMinutes: 20 },
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
  const c = { esc };
  const base = { ok: true, enabled: true, levels: levelsFor(null), defaults: DEFAULT_LEVELS, minutes: {}, failures: [], noDevice: [], sms: { ready: true } };
  const some = C.html(c, { ...base, phones: { ok: true, checked: 3, noDevice: [{ identity: "nurse7", role: "nurse", why: "on duty" }, { identity: "cmo@h.in", role: null, why: "named contact" }] } });
  assert.match(some, /No phone registered for alerts \(2 of 3\)/);
  assert.match(some, /nurse7 \(on duty, nurse\)/);
  assert.match(some, /cmo@h.in \(named contact\)/);
  assert.match(C.html(c, { ...base, phones: { ok: true, checked: 3, noDevice: [] } }), /All 3 people on duty/);
  for (const p of [{ ok: false, error: "read_failed" }, undefined]) {
    const h = C.html(c, { ...base, phones: p });
    assert.match(h, /could not be read/);
    assert.doesNotMatch(h, /have a phone registered\./);
  }
  assert.match(C.html(c, { ...base, phones: { ok: true, checked: 0, noDevice: [] } }), /nobody to check/);
});

/* Owner decision 2026-09-15: level 2 tells the WARD TEAM on duty now (nurses, residents, consultants) by a named rule
 * (criticalEscalation.level2WardRule, the earlier level2NurseRule read as a fallback). Each condition of the rule is
 * pinned by its own case below, so removing any one of them fails a named assertion. */
const AR = await import("../functions/_wardsynq/alert-recipients.js");
const NOW = Date.parse("2026-09-15T10:00:00Z");
const esc0 = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const team = [
  { identity: "n1", role: "nurse" }, { identity: "n2", role: "nurse" }, { identity: "r1", role: "resident" }, { identity: "pg1", role: "pg_resident" },
  { identity: "c1", role: "doctor" }, { identity: "cash", role: "cashier" }, { identity: "sup", role: "supervisor" }, { identity: "nx", role: "nurse", active: false },
];
const activeOf = (list) => new Map(list.filter((m) => m.active !== false).map((m) => [m.identity, m.role]));
const ids = (people) => people.map((p) => p.identity).sort();
const rotaMedA = ["n1", "r1", "c1", "cash", "sup", "nx"].map((identity) => ({ identity, unit: "Medical A" }));
const later = NOW + 3600000, earlier = NOW - 1;

test("ward team rule: ROLE - only nurses, residents and consultants who are active members; a cashier or supervisor on duty is not in the team", () => {
  const got = AR.level2WardRecipients("all-on-duty-ward-team", { unit: "Medical A", active: activeOf(team), duty: rotaMedA, statuses: [], nowMs: NOW });
  assert.deepEqual(ids(got), ["c1", "n1", "r1"]);
  assert.deepEqual(got.map((p) => p.group).sort(), ["consultant", "nurse", "resident"]);
  assert.deepEqual([...AR.WARD_TEAM_ROLES.resident], ["resident", "pg_resident"]);
  assert.equal(AR.wardTeamGroupOf("pg_hod"), "consultant");
  assert.equal(AR.wardTeamGroupOf("intern"), null, "interns are not in the ward team (owner follow-up)");
});

test("ward team rule: WARD - on the rota in another ward, or marked on duty for another ward, is not told", () => {
  const duty = [...rotaMedA, { identity: "n2", unit: "Surgical B" }];
  const statuses = [{ identity: "pg1", status: "on", unit: "Surgical B", expiresAt: later }];
  const got = AR.level2WardRecipients("all-on-duty-ward-team", { unit: "Medical A", active: activeOf(team), duty, statuses, nowMs: NOW });
  assert.ok(!ids(got).includes("n2"), "rostered in another ward");
  assert.ok(!ids(got).includes("pg1"), "marked on duty for another ward");
  assert.deepEqual(ids(AR.level2WardRecipients("all-on-duty-ward-team", { unit: "Surgical B", active: activeOf(team), duty, statuses, nowMs: NOW })), ["n2", "pg1"]);
});

test("ward team rule: DUTY - not on the rota is not told; marked ON for this ward is told without a rota shift; OFF overrides the rota; an expired mark counts for nothing", () => {
  const ctx = (statuses) => ({ unit: "Medical A", active: activeOf(team), duty: rotaMedA, statuses, nowMs: NOW });
  assert.ok(!ids(AR.level2WardRecipients("all-on-duty-ward-team", ctx([]))).includes("n2"), "a nurse member with no shift and no mark");
  assert.ok(ids(AR.level2WardRecipients("all-on-duty-ward-team", ctx([{ identity: "n2", status: "on", unit: "Medical A", expiresAt: later }]))).includes("n2"), "self-marked on duty in this ward");
  const off = AR.level2WardRecipients("all-on-duty-ward-team", ctx([{ identity: "n1", status: "off", unit: "", expiresAt: later }]));
  assert.ok(!ids(off).includes("n1"), "off duty overrides the rota");
  const expired = AR.level2WardRecipients("all-on-duty-ward-team", ctx([{ identity: "n1", status: "off", expiresAt: earlier }, { identity: "n2", status: "on", unit: "Medical A", expiresAt: earlier }]));
  assert.ok(ids(expired).includes("n1"), "an expired OFF no longer excludes");
  assert.ok(!ids(expired).includes("n2"), "an expired ON no longer includes");
});

test("rule of record: absent = ward team (default); level2WardRule wins; level2NurseRule is the fallback that keeps nurse-only; unknown applies the default and is named", () => {
  assert.deepEqual(Object.keys(AR.LEVEL2_WARD_RULES), ["all-on-duty-ward-team", "all-on-duty-nurses-in-ward"]);
  const d = AR.level2WardRuleOf(null);
  assert.deepEqual([d.rule, d.source, d.key], ["all-on-duty-ward-team", "default", undefined]);
  const old = AR.level2WardRuleOf({ level2NurseRule: "all-on-duty-nurses-in-ward" });
  assert.deepEqual([old.rule, old.source, old.key], ["all-on-duty-nurses-in-ward", "hospital", "level2NurseRule"], "a hospital that chose nurse-only keeps it");
  const both = AR.level2WardRuleOf({ level2WardRule: "all-on-duty-ward-team", level2NurseRule: "all-on-duty-nurses-in-ward" });
  assert.deepEqual([both.rule, both.key], ["all-on-duty-ward-team", "level2WardRule"]);
  const odd = AR.level2WardRuleOf({ level2WardRule: "nurse-in-charge" });
  assert.deepEqual([odd.rule, odd.source, odd.configured], ["all-on-duty-ward-team", "unrecognised", "nurse-in-charge"]);
  assert.equal(AR.level2WardRuleRefusal({ level2WardRule: "all-on-duty-ward-team", level2NurseRule: "all-on-duty-nurses-in-ward" }), null);
  assert.equal(AR.level2WardRuleRefusal(null), null);
  assert.match(AR.level2WardRuleRefusal({ level2NurseRule: "x" }), /"x" was not saved/);
  assert.throws(() => AR.level2WardRecipients("nurse-in-charge", { active: new Map(), duty: [] }), /has no resolver/);
  assert.deepEqual(ids(AR.level2WardRecipients("all-on-duty-nurses-in-ward", { unit: "Medical A", active: activeOf(team), duty: rotaMedA, statuses: [], nowMs: NOW })), ["n1"], "nurse-only tells no resident or consultant");
});

test("resolveRecipients at level 2: the record keeps the rule, source, ward and counts per role; off duty is told nothing, not even as the orderer", async () => {
  const people = [...members, { identity: "dr-order", role: "doctor" }, { identity: "pg-self", role: "pg_resident" }, { identity: "nurse-off", role: "nurse" }];
  const hour = Date.now() + 3600000;
  const rs = { ...readers(), members: async () => people,
    onDuty: async (unit) => ({ onDuty: [...onDutyIn[unit].map((identity) => ({ identity, unit })), { identity: "nurse-off", unit }] }),
    dutyStatuses: async () => ({ statuses: [
      { identity: "pg-self", status: "on", unit: "Medical A", expiresAt: hour },
      { identity: "nurse-off", status: "off", unit: "", expiresAt: hour },
      { identity: "dr-order", status: "off", unit: "", expiresAt: hour },
    ] }) };
  const over = await resolveRecipients({ orgId: "o", loop, level: "overdue" }, rs);
  assert.ok(over.recipients.includes("o~pg-self"), "a PG resident marked on duty in the ward, with no shift");
  assert.ok(!over.recipients.includes("o~nurse-off"), "a rostered nurse marked off duty");
  assert.ok(!over.recipients.includes("o~dr-order"), "the ordering doctor marked off duty");
  assert.deepEqual(over.wardRule, { rule: "all-on-duty-ward-team", source: "default", ward: "Medical A", counts: { nurse: 1, resident: 2, consultant: 1 } });
  const due = await resolveRecipients({ orgId: "o", loop, level: "due" }, rs);
  assert.equal(due.wardRule, undefined, "level 1 has no ward rule");
  const nurseOnly = await resolveRecipients({ orgId: "o", loop, level: "overdue", policy: { level2NurseRule: "all-on-duty-nurses-in-ward" } }, rs);
  assert.deepEqual([nurseOnly.wardRule.rule, nurseOnly.wardRule.key, nurseOnly.wardRule.counts], ["all-on-duty-nurses-in-ward", "level2NurseRule", { nurse: 1 }]);
});

test("level 2 with nobody on duty in the ward is NO_RECIPIENT with zero counts", async () => {
  const empty = { ...readers(), onDuty: async () => ({ onDuty: [{ identity: "nurse", unit: "Surgical B" }] }), dutyStatuses: async () => ({ statuses: [] }) };
  const policy = { levels: { due: { orderer: false, roles: [] }, overdue: { orderer: false, roles: ["nurse"] } } };
  const r = await resolveRecipients({ orgId: "o", loop, level: "overdue", policy }, empty);
  assert.deepEqual([r.recipients, r.reason, r.why], [[], "NO_RECIPIENT", undefined]);
  assert.deepEqual(r.wardRule.counts, { nurse: 0, resident: 0, consultant: 0 });
});

/* Owner decision 2026-09-15: a patient with NO WARD recorded alerts the doctor the patient is admitted under
 * (Encounter.attendingId) and the residents on duty, replacing hospital-wide on-duty cover. One case per condition. */
const NW = {
  records: {
    "Encounter/nw": { location: { ward: null, bed: null }, attendingId: "adm" },
    "Encounter/nw-unscoped": { location: {}, attendingId: "adm2" },
    "Encounter/nw-nodoc": { location: {} },
  },
  members: [
    { identity: "adm", role: "doctor", scope: { departments: ["cardio"] } }, { identity: "adm2", role: "doctor", scope: { departments: [] } },
    { identity: "resC", role: "resident", scope: { departments: ["cardio"] } }, { identity: "pgWard", role: "pg_resident", scope: { departments: [] } },
    { identity: "resS", role: "resident", scope: { departments: ["surg"] } }, { identity: "resOff", role: "resident", scope: { departments: ["cardio"] } },
    { identity: "resHome", role: "resident", scope: { departments: ["cardio"] } },
    { identity: "nurseD", role: "nurse", scope: { departments: ["cardio"] } }, { identity: "cons2", role: "doctor", scope: { departments: ["cardio"] } },
    { identity: "sup", role: "supervisor" },
  ],
  duty: [["resC", "Ward 1"], ["pgWard", "CCU"], ["resS", "Ward 2"], ["resOff", "Ward 1"], ["nurseD", "Ward 1"], ["cons2", "Ward 1"], ["sup", "Ward 1"]].map(([identity, unit]) => ({ identity, unit })),
  wards: [{ name: "CCU", departmentId: "cardio" }, { name: "Ward 1", departmentId: null }, { name: "Ward 2", departmentId: "surg" }],
};
const nwReaders = ({ statuses = [], duty = NW.duty, seen } = {}) => ({
  latest: async (t, id) => NW.records[t + "/" + id] || null,
  members: async () => NW.members,
  onDuty: async (unit) => { if (seen) seen.push(["onDuty", unit]); return { onDuty: duty }; },
  dutyStatuses: async () => ({ statuses: [{ identity: "resOff", status: "off", unit: "", expiresAt: Date.now() + 3600000 }, ...statuses] }),
  wards: async () => { if (seen) seen.push(["wards"]); return NW.wards; },
});
const nwLoop = (encounterId) => ({ id: "l-nw", encounterId });

test("no ward: the admitting doctor is alerted, and the record names the rule, ward null and the cover", async () => {
  const r = await resolveRecipients({ orgId: "o", loop: nwLoop("nw"), level: "overdue" }, nwReaders());
  assert.ok(r.recipients.includes("o~adm"), "the doctor the patient is admitted under");
  assert.deepEqual(r.wardRule, { rule: AR.NO_WARD_RULE, ward: null, noWardCover: { admittingDoctor: "adm", admittingSkipped: null, residentScope: "department", residents: 2 } });
  assert.equal(r.reason, undefined);
});

test("no ward: an admitting doctor marked OFF duty is skipped, with why; an expired off does not skip", async () => {
  const off = await resolveRecipients({ orgId: "o", loop: nwLoop("nw"), level: "due" }, nwReaders({ statuses: [{ identity: "adm", status: "off", unit: "", expiresAt: Date.now() + 3600000 }] }));
  assert.ok(!off.recipients.includes("o~adm"));
  assert.match(off.wardRule.noWardCover.admittingSkipped, /^marked off duty until \d{4}-/);
  const expired = await resolveRecipients({ orgId: "o", loop: nwLoop("nw"), level: "due" }, nwReaders({ statuses: [{ identity: "adm", status: "off", unit: "", expiresAt: Date.now() - 1 }] }));
  assert.ok(expired.recipients.includes("o~adm"));
  assert.equal(expired.wardRule.noWardCover.admittingSkipped, null);
});

test("no ward, department known: residents on duty in it are alerted (by membership or by the ward they are on duty in); off duty and other departments are not", async () => {
  const seen = [];
  const r = await resolveRecipients({ orgId: "o", loop: nwLoop("nw"), level: "overdue" }, nwReaders({ seen }));
  assert.ok(r.recipients.includes("o~resC"), "a resident on duty whose department is the admitting doctor's");
  assert.ok(r.recipients.includes("o~pgWard"), "a PG resident on duty in a ward of that department");
  assert.ok(!r.recipients.includes("o~resOff"), "a resident of the department marked off duty");
  assert.ok(!r.recipients.includes("o~resHome"), "a resident of the department who is not on duty");
  assert.ok(!r.recipients.includes("o~resS"), "a resident on duty in another department");
  assert.equal(r.wardRule.noWardCover.residentScope, "department");
  assert.deepEqual(seen, [["onDuty", ""], ["wards"]], "the whole hospital's rota, then the wards to map a ward to its department");
});

test("no ward, department not known: residents on duty anywhere in the hospital, recorded as hospital scope", async () => {
  for (const enc of ["nw-unscoped", "nw-nodoc"]) {
    const seen = [];
    const r = await resolveRecipients({ orgId: "o", loop: nwLoop(enc), level: "overdue" }, nwReaders({ seen }));
    assert.deepEqual(r.recipients.filter((x) => /res|pg/.test(x)).sort(), ["o~pgWard", "o~resC", "o~resS"], enc);
    assert.equal(r.wardRule.noWardCover.residentScope, "hospital", enc);
    assert.ok(!seen.some((x) => x[0] === "wards"), "no department to map wards to");
  }
});

test("no ward: nurses, supervisors and consultants other than the admitting doctor on duty are NOT alerted, at any level", async () => {
  for (const level of ["due", "overdue", "escalate"]) {
    const r = await resolveRecipients({ orgId: "o", loop: nwLoop("nw"), level }, nwReaders());
    for (const who of ["o~nurseD", "o~cons2", "o~sup"]) assert.ok(!r.recipients.includes(who), level + " " + who);
    assert.deepEqual(r.recipients.sort(), ["o~adm", "o~pgWard", "o~resC"], level);
  }
});

test("no ward, no admitting doctor, no resident on duty: NO_RECIPIENT, loud, with the reason; the push notice records it", async () => {
  const r = await resolveRecipients({ orgId: "o", loop: nwLoop("nw-nodoc"), level: "overdue" }, nwReaders({ duty: NW.duty.filter((a) => !/res|pg/.test(a.identity)) }));
  assert.deepEqual([r.recipients, r.reason, r.why], [[], "NO_RECIPIENT", "no ward, no admitting doctor, no resident on duty"]);
  assert.deepEqual(r.wardRule.noWardCover, { admittingDoctor: null, admittingSkipped: null, residentScope: "hospital", residents: 0 });
  const off = await resolveRecipients({ orgId: "o", loop: nwLoop("nw"), level: "due" }, nwReaders({ duty: [], statuses: [{ identity: "adm", status: "off", expiresAt: Date.now() + 60000 }] }));
  assert.match(off.why, /^no ward, admitting doctor marked off duty until .*, no resident on duty in the admitting doctor's department$/);

  const { serverPushChannel } = await import("../functions/_wardsynq/push-alerts.js");
  const payload = { loopId: "l-nw", encounterId: "nw-nodoc", level: "overdue", notices: [] };
  const ch = serverPushChannel({ orgId: "o", tenantId: "t", policy: null, readers: nwReaders({ duty: [] }), directory: { devicesFor: async () => [], putNotice: async () => {} }, sendToTokens: async () => ({ sent: 0, total: 0 }) });
  const out = await ch(payload);
  assert.equal(out.detail, "NO_RECIPIENT: no ward, no admitting doctor, no resident on duty");
  const n = payload.notices[0];
  assert.deepEqual([n.reason, n.why], ["NO_RECIPIENT", "no ward, no admitting doctor, no resident on duty"]);
  assert.deepEqual(n.wardRule, { rule: AR.NO_WARD_RULE, ward: null, noWardCover: { admittingDoctor: null, admittingSkipped: null, residentScope: "hospital", residents: 0 }, recipients: 0 });
});

test("wardAlertCover: counts per role now, zeros named; dutyExpiry: end of the rostered shift, else 12 hours, never later", async () => {
  const cover = AR.wardAlertCover({ policy: null, members: team, duty: rotaMedA, statuses: [{ identity: "n1", status: "off", expiresAt: later }], unit: "Medical A", nowMs: NOW });
  assert.deepEqual(cover, { rule: "all-on-duty-ward-team", source: "default", ward: "Medical A", counts: { nurse: 0, resident: 1, consultant: 1 }, total: 2 });
  const R = await import("../functions/_roster.js");
  const shifts = { day: { id: "day", name: "Day", unit: "Medical A", start: "08:00", end: "20:00" }, long: { id: "long", name: "Long", unit: "Medical A", start: "08:00", end: "07:59" } };
  const at = Date.parse("2026-09-15T10:00:00Z"); // 15:30 local at +330
  const day = R.dutyExpiry(at, 330, shifts, [{ identity: "n1", date: "2026-09-15", shiftId: "day" }], "n1");
  assert.deepEqual([new Date(day.expiresAt).toISOString(), day.basis, day.shift.unit], ["2026-09-15T14:30:00.000Z", "shift", "Medical A"]);
  const none = R.dutyExpiry(at, 330, shifts, [], "n1");
  assert.deepEqual([none.expiresAt - at, none.basis, none.shift], [12 * 3600000, "hours", null]);
  const capped = R.dutyExpiry(at, 330, shifts, [{ identity: "n1", date: "2026-09-15", shiftId: "long" }], "n1");
  assert.deepEqual([capped.expiresAt - at, capped.basis], [12 * 3600000, "hours"], "a shift ending after 12 hours is capped");
});

test("screens: the Alerts card explains the ward rule; the ward board names who would be alerted now; the critical board says ward null; the rota lists duty by ward", () => {
  const sb = { window: { WSQ: { page() {} } } }; sb.WSQ = sb.window.WSQ;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), sb);
  const C = sb.window.WSQ._alertCard;
  const base = { ok: true, enabled: true, levels: levelsFor(null), defaults: DEFAULT_LEVELS, minutes: {}, failures: [], noDevice: [], sms: { ready: true }, phones: { ok: true, checked: 0, noDevice: [] } };
  const html = C.html({ esc: esc0 }, { ...base, wardRule: AR.level2WardRuleOf(null) });
  assert.match(html, /Level 2 ward rule<\/dt><dd><span class="mono">all-on-duty-ward-team<\/span> <span class="quiet">\(default\)/);
  assert.match(html, /Every nurse, resident and consultant on duty now in the patient&#39;s ward/);
  assert.match(html, /off duty lasts until the end of their rostered shift, or 12 hours/);
  assert.match(html, /Patient with no ward recorded:<\/b> at every level the alert goes to the doctor the patient is admitted under, unless that doctor has marked themselves off duty, and to the residents on duty now in that doctor's department \(anywhere in the hospital when the department is not known\)/);
  assert.match(html, /No nurse, supervisor or other consultant on duty is told/);
  assert.match(C.html({ esc: esc0 }, { ...base, wardRule: AR.level2WardRuleOf({ level2WardRule: "x" }) }), /saved rule "x" is not one this build has/);
  assert.match(C.html({ esc: esc0 }, base), /level 2 ward rule could not be read/);
  assert.doesNotMatch(html, /—/);
  const out = C.read({ esc: esc0 }, { enabled: true, senderId: "", templateName: "", escalation: { level2NurseRule: "all-on-duty-nurses-in-ward" }, levels: {} });
  assert.equal(out.wardsynq.criticalEscalation.level2NurseRule, "all-on-duty-nurses-in-ward", "the card's own save keeps a saved rule");

  const wsb = { navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date };
  wsb.window = wsb; wsb.self = wsb; vm.createContext(wsb); vm.runInContext(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), wsb);
  const W = wsb.window.WARD;
  const list = (extra) => W._render({ ...W._st, view: "list", loaded: true, ...extra });
  assert.match(list({ alertCover: null }), /Loading who would be alerted now/);
  assert.match(list({ alertCover: false }), /could not be read\. Do not read this as nobody on duty/);
  const cov = list({ alertCover: { ok: true, wards: [{ ward: "Cardio", total: 0, counts: { nurse: 0, resident: 0, consultant: 0 } }, { ward: "Medical A", total: 3, counts: { nurse: 2, resident: 1, consultant: 0 } }] } });
  assert.match(cov, /<b>Cardio<\/b>: level 2 alert would reach <b>nobody on duty<\/b>/);
  assert.match(cov, /<b>Medical A<\/b>: level 2 alert would reach 2 nurses, 1 resident, 0 consultants/);
  assert.match(list({ duty: null }), /Loading your duty status/);
  assert.match(list({ duty: false }), /Do not read this as on or off duty/);
  assert.doesNotMatch(list({ duty: { notWardTeam: true } }), /My duty/, "no card for a role outside the ward team");
  const off = list({ duty: { ok: true, status: { status: "off", unit: "", expiresAt: "2026-09-15T14:30:00Z", basis: "shift" }, rota: { name: "Day", unit: "Medical A" }, wards: ["Medical A"], hours: 12 } });
  assert.match(off, /<b>Off duty<\/b> until .*\(end of your shift\)\. You get no critical-result alerts until then/);
  assert.match(off, /data-w-act="dutyset:on"/); assert.match(off, /data-w-act="dutyset:off"/);
  assert.match(list({ duty: { ok: true, status: null, rota: null, wards: ["Medical A"], hours: 12 } }), /Not on the rota now and not marked on duty/);
  const board = (wardRule) => W._render({ ...W._st, view: "critsboard", critsBoard: [{ loopId: "c1", patientId: "p1", display: "Potassium", value: 7.1, state: "open", escalation: { level: "overdue" }, notifications: [{ nid: "a", level: "overdue", sent: 1, wardRule }] }] });
  assert.match(board({ rule: "all-on-duty-ward-team", ward: "Medical A", counts: { nurse: 2, resident: 1, consultant: 1 } }), /Level 2 ward team on duty in Medical A: 2 nurses, 1 resident, 1 consultant/);
  assert.match(board({ rule: "all-on-duty-ward-team", ward: null, counts: { nurse: 3, resident: 0, consultant: 1 } }), /<b>No ward recorded for this patient:<\/b> level 2 went to everyone on duty in the hospital/, "an older loop, recorded before the no-ward rule");
  const nwb = board({ rule: AR.NO_WARD_RULE, ward: null, noWardCover: { admittingDoctor: "dr.rao", admittingSkipped: null, residentScope: "department", residents: 2 } });
  assert.match(nwb, /<b>No ward recorded for this patient:<\/b> alerted the admitting doctor dr\.rao, and 2 residents on duty in the admitting doctor(&#39;|')s department/);
  assert.doesNotMatch(nwb, /everyone on duty in the hospital/);
  assert.match(board({ rule: AR.NO_WARD_RULE, ward: null, noWardCover: { admittingDoctor: "dr.rao", admittingSkipped: "marked off duty until 2026-09-15T14:30:00.000Z", residentScope: "hospital", residents: 1 } }),
    /admitting doctor dr\.rao not alerted \(marked off duty until 2026-09-15T14:30:00\.000Z\), and 1 resident on duty anywhere in the hospital \(department not known\)/);
  const nobody = W._render({ ...W._st, view: "critsboard", critsBoard: [{ loopId: "c2", patientId: "p2", display: "Potassium", value: 7.1, state: "open", escalation: { level: "due" },
    notifications: [{ nid: null, level: "due", reason: "NO_RECIPIENT", why: "no ward, no admitting doctor, no resident on duty", wardRule: { rule: AR.NO_WARD_RULE, ward: null, noWardCover: { admittingDoctor: null, admittingSkipped: null, residentScope: "hospital", residents: 0 } } }] }] });
  assert.match(nobody, /Alert did not reach anyone:<\/b> nobody could be found to tell \(no ward, no admitting doctor, no resident on duty\)/);
  assert.match(nobody, /no admitting doctor recorded, and 0 residents on duty anywhere in the hospital/);

  const rsb = { window: { WSQ: { page() {} } } }; rsb.WSQ = rsb.window.WSQ;
  vm.createContext(rsb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/rota.js", import.meta.url), "utf8"), rsb);
  const Rt = rsb.window.WSQ._rota, c = { esc: esc0 };
  assert.match(Rt.dutyWardsHtml(c, null), /Loading duty by ward/);
  assert.match(Rt.dutyWardsHtml(c, { ok: false }), /Do not read this as none/);
  const dw = Rt.dutyWardsHtml(c, { ok: true, wards: [{ ward: "Medical A", people: [{ identity: "n1", role: "nurse", via: "rota" }, { identity: "pg1", role: "pg_resident", via: "self", until: "2026-09-15T20:00:00Z" }] }], off: [{ identity: "n2", role: "nurse", until: "2026-09-15T14:30:00Z" }] });
  assert.match(dw, /Medical A \(2\)/); assert.match(dw, /pg1, pg_resident: marked on duty until 2026-09-15 20:00/);
  assert.match(dw, /Marked off duty \(1\).*n2, nurse: off duty until 2026-09-15 14:30\. Not alerted/);
});

