/* test/wardsynq-abdm-hospital.test.mjs - owner S6 phase A1: the ABDM hospital profile, pure.
 * functions/_wardsynq/abdm-hospital.js: HFR format and equality with the org, HIP/HIU id shape, HPR per
 * member, the status transitions, and a checklist that never claims what it does not know.
 *
 * node --test test/wardsynq-abdm-hospital.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, TRANSITIONS, transitionRefusal, hfrRefusal, validateShared, doctorReadiness, checklist, abdmView, ABDM_KIND } from "../functions/_wardsynq/abdm-hospital.js";

const HFR = "IN2810006668";
const ORG = { region: "IN", regionProfile: { hfrId: HFR } };
const S = (over) => ({ hfrFacilityId: HFR, hipId: "", hiuId: "", status: "draft", ...(over || {}) });

test("HFR facility ID: IN + 10 digits, no spaces, equal to the hospital record, India only", () => {
  assert.equal(hfrRefusal(HFR, ORG), null);
  assert.match(hfrRefusal("IN281000666", ORG), /IN followed by 10 digits/);
  assert.match(hfrRefusal("in2810006668", ORG), /IN followed by 10 digits/, "stored exactly as issued, not silently folded");
  assert.match(hfrRefusal("IN 2810006668", ORG), /no spaces/);
  assert.match(hfrRefusal(HFR, { region: "IN", regionProfile: {} }), /Hospital tab first/);
  assert.match(hfrRefusal("IN1111111111", ORG), /must match the one on the hospital record \(IN2810006668\)/);
  assert.match(hfrRefusal(HFR, { region: "US", regionProfile: { hfrId: HFR } }), /hospital in India/);
  assert.match(hfrRefusal(HFR, null), /hospital in India/);
});

test("HIP and HIU IDs: optional in a draft, a conservative shape when given", () => {
  assert.equal(validateShared(S(), {}, { org: ORG, previous: null }), null);
  assert.equal(validateShared(S({ hipId: HFR, hiuId: "hiu_sbx.01" }), {}, { org: ORG }), null);
  assert.match(validateShared(S({ hipId: "a b" }), {}, { org: ORG }), /HIP ID/);
  assert.match(validateShared(S({ hiuId: "x" }), {}, { org: ORG }), /HIU ID/);
  assert.match(validateShared(S({ hipId: "<script>" }), {}, { org: ORG }), /HIP ID/);
});

test("transitions: draft -> submitted -> sandbox-linked -> production-linked -> suspended, and nothing else", () => {
  assert.deepEqual(STATUSES, ["draft", "submitted", "sandbox-linked", "production-linked", "suspended"]);
  const ok = (from, to, s) => transitionRefusal(from, to, s || S({ hipId: HFR }), ORG);
  // A new profile starts as draft or submitted only.
  assert.equal(ok(null, "draft"), null);
  assert.equal(ok(null, "submitted"), null);
  for (const to of ["sandbox-linked", "production-linked", "suspended"]) assert.match(ok(null, to), /starts as a draft or submitted/);
  // Every pair outside the table is refused; staying put is allowed.
  for (const from of STATUSES) for (const to of STATUSES) {
    const r = ok(from, to);
    if (from === to) { assert.equal(r, null, `${from} stays`); continue; }
    if (!TRANSITIONS[from].includes(to)) assert.match(r, /cannot move to/, `${from} -> ${to}`);
  }
  assert.equal(ok("draft", "submitted"), null);
  assert.equal(ok("submitted", "sandbox-linked"), null);
  assert.equal(ok("submitted", "draft"), null);
  assert.equal(ok("sandbox-linked", "suspended"), null);
  assert.equal(ok("production-linked", "suspended"), null);
  assert.equal(ok("suspended", "draft"), null);
  assert.match(ok("suspended", "sandbox-linked"), /cannot move to/, "a suspended profile re-walks from draft");
  assert.match(ok("draft", "bogus"), /Status must be one of/);
  assert.match(ok("bogus", "draft"), /saved status is not one this build knows/);
});

test("transitions need their facts: submitted needs the matching HFR, sandbox-linked a HIP ID, production is not recordable yet", () => {
  assert.match(transitionRefusal("draft", "submitted", S({ hfrFacilityId: "IN0000000000" }), ORG), /must match/);
  assert.match(transitionRefusal("submitted", "sandbox-linked", S(), ORG), /Enter the HIP ID/);
  assert.equal(transitionRefusal("submitted", "sandbox-linked", S({ hipId: HFR }), ORG), null);
  assert.match(transitionRefusal("sandbox-linked", "production-linked", S({ hipId: HFR }), ORG), /held until India-region hosting exists, and needs/);
  assert.doesNotMatch(transitionRefusal("sandbox-linked", "production-linked", S({ hipId: HFR }), ORG), /owner decision/, "LT-35: no internal decision reference on screen");
});

test("identifiers are frozen once linked, and change again from draft", () => {
  const linked = S({ hipId: HFR, status: "sandbox-linked" });
  assert.match(validateShared({ ...linked, hipId: "OTHER-HIP" }, {}, { org: ORG, previous: linked }), /fixed once ABDM has linked them/);
  assert.match(validateShared({ ...linked, hiuId: "NEW-HIU" }, {}, { org: ORG, previous: linked }), /fixed/);
  assert.equal(validateShared({ ...linked }, {}, { org: ORG, previous: linked }), null, "re-saving unchanged is fine");
  const suspended = { ...linked, status: "suspended" };
  assert.equal(validateShared({ ...suspended, hipId: "NEW-HIP", status: "draft" }, {}, { org: ORG, previous: suspended }), null);
  const submitted = S({ status: "submitted" });
  assert.equal(validateShared({ ...submitted, hipId: HFR, status: "sandbox-linked" }, {}, { org: ORG, previous: submitted }), null, "the HIP ID arrives with the linkage");
  assert.match(validateShared({ ...linked, status: "draft", hipId: "X-HIP" }, {}, { org: ORG, previous: linked }), /cannot move to/, "linked cannot jump back to draft to dodge the freeze");
});

test("owner A1: the shared StewardMD bridge is the only provider, and it declares no per-hospital credential", () => {
  assert.deepEqual(Object.keys(ABDM_KIND.providers), ["shared-bridge"]);
  assert.deepEqual(ABDM_KIND.providers["shared-bridge"].secrets, []);
  assert.equal(ABDM_KIND.singleton, true);
});

test("doctors: prescribers only, registration number required, HPR ID optional and shape-checked", () => {
  const d = doctorReadiness([
    { identity: "a", email: "a@h", role: "doctor", regNo: "TSMC-1", regionProfile: { hprId: "12345678901234" }, active: true },
    { identity: "b", email: "b@h", role: "doctor", regNo: "", regionProfile: {}, active: true },
    { identity: "c", email: "c@h", role: "doctor", regNo: "X", regionProfile: { hprId: "123" }, active: true },
    { identity: "n", email: "n@h", role: "nurse", regNo: "", active: true },
    { identity: "gone", email: "g@h", role: "doctor", regNo: "Y", active: false },
  ]);
  assert.deepEqual(d.map((x) => x.identity), ["a", "b", "c"], "nurses and disabled members are not listed");
  assert.deepEqual(d.map((x) => [x.regNoSet, x.hprValid]), [[true, true], [false, null], [true, false]]);
});

test("checklist: without a registry answer nothing says verified; typed facts are entered, dpdp is not built, production is blocked", () => {
  const docs = doctorReadiness([{ identity: "a", role: "doctor", regNo: "R", active: true }]);
  const none = checklist({}, { region: "IN", regionProfile: {} }, []);
  assert.equal(none.find((i) => i.key === "hfr").status, "missing");
  assert.equal(none.find((i) => i.key === "linkage").status, "missing");
  assert.equal(none.find((i) => i.key === "doctors").status, "missing");
  const typed = checklist(S({ hipId: HFR }), ORG, docs);
  assert.equal(typed.find((i) => i.key === "hfr").status, "entered");
  assert.match(typed.find((i) => i.key === "hfr").detail, /has not checked it against the registry/);
  assert.equal(typed.find((i) => i.key === "linkage").status, "entered");
  assert.equal(typed.find((i) => i.key === "doctors").status, "entered");
  // The session is opened by the first registry check; until then it is not checked, never assumed.
  assert.equal(typed.find((i) => i.key === "session").status, "not-checked");
  // Built screens are "available", and still nothing is recorded as passed or printed.
  for (const k of ["sandbox", "counters"]) assert.equal(typed.find((i) => i.key === k).status, "available", k);
  assert.match(typed.find((i) => i.key === "sandbox").detail, /No sandbox run is recorded as passed/);
  assert.equal(typed.find((i) => i.key === "dpdp").status, "not-built");
  assert.equal(typed.find((i) => i.key === "production").status, "blocked");
  assert.equal(checklist(S({ hfrFacilityId: "IN9999999999" }), ORG, docs).find((i) => i.key === "hfr").status, "mismatch");
  // A registry answer about ANOTHER facility ID says nothing about this one: still only entered, session unchecked.
  const otherId = checklist(S({ hipId: HFR }), ORG, docs, { facility: { status: "verified", hfrFacilityId: "IN9999999999", checkedAt: "2026-09-16T00:00:00.000Z" } });
  assert.equal(otherId.find((i) => i.key === "hfr").status, "entered");
  assert.equal(otherId.find((i) => i.key === "session").status, "not-checked");
  for (const list of [none, typed, otherId]) {
    assert.ok(list.every((i) => ["entered", "missing", "mismatch", "not-built", "not-checked", "available", "blocked"].includes(i.status)));
    assert.ok(!/verified/i.test(list.map((i) => i.status + " " + i.detail).join(" ")), "no item claims verification");
  }
  // Only the registry's own answer for this very ID moves the item.
  const at = "2026-09-16T00:00:00.000Z";
  const ver = checklist(S({ hipId: HFR }), ORG, docs, { facility: { status: "verified", hfrFacilityId: HFR, facilityStatus: "Approved", checkedAt: at } });
  assert.equal(ver.find((i) => i.key === "hfr").status, "verified");
  assert.match(ver.find((i) => i.key === "hfr").detail, /registry status Approved/);
  assert.equal(ver.find((i) => i.key === "session").status, "verified");
  assert.equal(checklist(S(), ORG, docs, { facility: { status: "not-found", hfrFacilityId: HFR, checkedAt: at } }).find((i) => i.key === "hfr").status, "not-found");
  const noSession = checklist(S(), ORG, docs, { facility: { status: "unverified", reason: "session", hfrFacilityId: HFR, checkedAt: at } });
  assert.equal(noSession.find((i) => i.key === "hfr").status, "unverified");
  assert.equal(noSession.find((i) => i.key === "session").status, "unverified");
});

test("view: a new profile offers draft or submitted, production shows its blocker, the bridge is shared", () => {
  const fresh = abdmView(null, ORG, []);
  assert.equal(fresh.profile, null);
  assert.deepEqual(fresh.statusOptions.map((o) => o.status), ["draft", "submitted"]);
  assert.equal(fresh.hfrOnOrg, HFR);
  assert.equal(fresh.bridge, "shared");
  const linked = abdmView({ id: "abdm", settings: S({ hipId: HFR, status: "sandbox-linked" }), secretsSet: [] }, ORG, []);
  assert.deepEqual(linked.statusOptions.map((o) => [o.status, o.allowed]), [["sandbox-linked", true], ["production-linked", false], ["suspended", true]]);
  assert.match(linked.statusOptions[1].reason, /India-region hosting/);
  assert.match(checklist(S(), ORG, []).find((i) => i.key === "production").detail, /^Awaiting India hosting\./);
});
