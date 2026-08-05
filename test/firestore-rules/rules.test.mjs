/* StewardMD — Firestore rules emulator test. Validates the sharedCases guarantees AND the
 * Phase-5 ICU membership / doctor-directory / invite-link guarantees against the repo's
 * firestore.rules. Run via firebase emulators:exec (see README.md). Exit 0 = all pass.
 * (Not run in this repo's CI — the dev box had no Java Runtime; run locally with a JDK +
 *  `npm i -D @firebase/rules-unit-testing firebase`.)
 */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, collectionGroup, query, where, getDocs, Timestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const RULES = new URL("../../firestore.rules", import.meta.url).pathname;
const allowed = async (p) => { try { await p; return true; } catch (e) { return false; } };

const env = await initializeTestEnvironment({
  projectId: "demo-stewardmd",
  firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: 8080 },
});
await env.clearFirestore();
const now = Date.now(), future = now + 10 * 864e5, past = now - 1000;
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "sharedCases/SMDLIVE1"), { code: "SMDLIVE1", ownerUid: "docA", ownerName: "Dr A", html: "<p>cholangitis</p>", text: "cholangitis", expiresAt: future });
  await setDoc(doc(db, "sharedCases/SMDEXPD1"), { code: "SMDEXPD1", ownerUid: "docA", ownerName: "Dr A", html: "<p>old</p>", text: "old", expiresAt: past });
  await setDoc(doc(db, "users/docA/cases/c1"), { note: "private A" });
  await setDoc(doc(db, "users/docA/profile/self"), { smdId: "SMD-AAA111", name: "Dr A" });

  // ── ICU collaboration unit (PHASE 5 model — members subcollection) ──────────
  // docA = head, docG = professor (both ADMIN), docB = senior_resident (instructor, not admin),
  // docD = intern (member, not instructor). docC / docE… are NON-members.
  await setDoc(doc(db, "icuGroups/GRPI"), { name: "Medicine ICU · Unit I", unit: "Unit I", hospital: "GIMSR", createdBy: "docA", createdAt: now });
  await setDoc(doc(db, "icuGroups/GRPI/members/docA"), { uid: "docA", role: "head", name: "Dr A", addedBy: "docA", joinedAt: now });
  await setDoc(doc(db, "icuGroups/GRPI/members/docG"), { uid: "docG", role: "professor", name: "Dr G", addedBy: "docA", joinedAt: now });
  await setDoc(doc(db, "icuGroups/GRPI/members/docB"), { uid: "docB", role: "senior_resident", name: "Dr B", addedBy: "docA", joinedAt: now });
  await setDoc(doc(db, "icuGroups/GRPI/members/docD"), { uid: "docD", role: "intern", name: "Dr D", addedBy: "docA", joinedAt: now });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p1"), { name: "R.K.", dx: "bacterial meningitis", bed: "1", state: {}, severity: "critical" });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p2"), { name: "S.M.", dx: "sepsis", bed: "5", state: {} });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p1/timeline/te1"), { by: "docA", type: "round", title: "Morning round", ts: now });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p1/tasks/tSeed"), { text: "Neuro obs hourly", status: "pending", assignedBy: "docA" });
  // Invites: a valid JR link, an expired one, and one that (illegally) names an admin role.
  await setDoc(doc(db, "icuGroups/GRPI/invites/INVOK"), { role: "junior_resident", createdBy: "docA", createdByName: "Dr A", expiresAt: future, unit: "Unit I", name: "Medicine ICU · Unit I" });
  await setDoc(doc(db, "icuGroups/GRPI/invites/INVEXP"), { role: "junior_resident", createdBy: "docA", createdByName: "Dr A", expiresAt: past, unit: "Unit I", name: "Medicine ICU · Unit I" });
  await setDoc(doc(db, "icuGroups/GRPI/invites/INVBAD"), { role: "professor", createdBy: "docA", createdByName: "Dr A", expiresAt: future, unit: "Unit I", name: "Medicine ICU · Unit I" });
  // Doctor directory (source-of-truth for the StewardMD ID + email lookup).
  await setDoc(doc(db, "doctorDirectory/SMD-AAA111"), { uid: "docA", name: "Dr A", at: now });
  await setDoc(doc(db, "doctorDirectory/e_hashb"), { uid: "docB", name: "Dr B", smdId: "SMD-BBB222", at: now });
});

const anon = env.unauthenticatedContext().firestore();
const A = env.authenticatedContext("docA").firestore();   // head (admin)
const B = env.authenticatedContext("docB").firestore();   // senior_resident (instructor, NOT admin)
const C = env.authenticatedContext("docC").firestore();   // non-member
const D = env.authenticatedContext("docD").firestore();   // intern (member, not instructor)
const G = env.authenticatedContext("docG").firestore();   // professor (admin, not head)
const E = env.authenticatedContext("docE").firestore();   // new joiner (non-member)
const F = env.authenticatedContext("docF").firestore();
const H = env.authenticatedContext("docH").firestore();
const I = env.authenticatedContext("docI").firestore();
const J = env.authenticatedContext("docJ").firestore();
const K = env.authenticatedContext("docK").firestore();

// [operation, actualAllowed, expectedAllowed, guarantee]
const cases = [
  // ── sharedCases (unchanged guarantees) ────────────────────────────────────
  ["get by exact code (unexpired)", await allowed(getDoc(doc(anon, "sharedCases/SMDLIVE1"))), true, "#2 public link -> one case"],
  ["get expired share", await allowed(getDoc(doc(anon, "sharedCases/SMDEXPD1"))), false, "#4 expiry enforced"],
  ["LIST/enumerate all shares", await allowed(getDocs(query(collection(anon, "sharedCases"), where("expiresAt", ">", now)))), false, "#1 no enumeration"],
  ["create own share", await allowed(setDoc(doc(A, "sharedCases/SMDNEW01"), { code: "SMDNEW01", ownerUid: "docA", html: "x", text: "x", expiresAt: future })), true, "owner create"],
  ["create with spoofed ownerUid", await allowed(setDoc(doc(B, "sharedCases/SMDNEW02"), { code: "SMDNEW02", ownerUid: "docA", expiresAt: future })), false, "#3 can't impersonate"],
  ["read own private case", await allowed(getDoc(doc(A, "users/docA/cases/c1"))), true, "private ok for owner"],
  ["read another's private case", await allowed(getDoc(doc(B, "users/docA/cases/c1"))), false, "#3 private isolation"],

  // ── users/{uid}/profile — private per-user (Doctor ID cache) ───────────────
  ["profile: read own", await allowed(getDoc(doc(A, "users/docA/profile/self"))), true, "profile private to owner"],
  ["profile: read another's", await allowed(getDoc(doc(B, "users/docA/profile/self"))), false, "profile not cross-readable"],

  // ── icuGroups unit doc ────────────────────────────────────────────────────
  ["group: member reads unit", await allowed(getDoc(doc(A, "icuGroups/GRPI"))), true, "icu membership read"],
  ["group: non-member reads unit", await allowed(getDoc(doc(C, "icuGroups/GRPI"))), false, "icu non-member denied"],
  ["group: create own unit (self=createdBy)", await allowed(setDoc(doc(C, "icuGroups/GRPNEW"), { name: "New", unit: "", hospital: "", createdBy: "docC", createdAt: now })), true, "icu create own unit"],
  ["group: create spoofed createdBy", await allowed(setDoc(doc(D, "icuGroups/GRPSPOOF"), { name: "X", createdBy: "docA", createdAt: now })), false, "icu no spoofed createdBy"],

  // ── members: creator bootstrap (self-head) ─────────────────────────────────
  ["member: creator bootstraps self-head", await allowed(setDoc(doc(C, "icuGroups/GRPNEW/members/docC"), { uid: "docC", role: "head", name: "Dr C", addedBy: "docC", joinedAt: now })), true, "creator becomes head"],
  ["member: bootstrap head in another's unit", await allowed(setDoc(doc(D, "icuGroups/GRPI/members/docD_h"), { uid: "docD_h", role: "head", addedBy: "docD", joinedAt: now })), false, "only the creator may self-head"],

  // ── members: SELF-JOIN VIA LINK (security-critical) ────────────────────────
  ["member: self-join via valid JR invite", await allowed(setDoc(doc(E, "icuGroups/GRPI/members/docE"), { uid: "docE", role: "junior_resident", name: "Dr E", addedBy: "link", joinedAt: now, via: "INVOK" })), true, "link self-join (link role)"],
  ["member: self-join escalated to professor", await allowed(setDoc(doc(F, "icuGroups/GRPI/members/docF"), { uid: "docF", role: "professor", addedBy: "link", joinedAt: now, via: "INVOK" })), false, "link can't confer admin"],
  ["member: self-join via admin-role invite", await allowed(setDoc(doc(H, "icuGroups/GRPI/members/docH"), { uid: "docH", role: "professor", addedBy: "link", joinedAt: now, via: "INVBAD" })), false, "link role must be non-admin"],
  ["member: self-join via expired invite", await allowed(setDoc(doc(I, "icuGroups/GRPI/members/docI"), { uid: "docI", role: "junior_resident", addedBy: "link", joinedAt: now, via: "INVEXP" })), false, "expired invite denied"],
  ["member: self-join role != invite role", await allowed(setDoc(doc(J, "icuGroups/GRPI/members/docJ"), { uid: "docJ", role: "intern", addedBy: "link", joinedAt: now, via: "INVOK" })), false, "role must match invite"],
  ["member: self-join for ANOTHER uid", await allowed(setDoc(doc(K, "icuGroups/GRPI/members/docL"), { uid: "docL", role: "junior_resident", addedBy: "link", joinedAt: now, via: "INVOK" })), false, "can't join on someone's behalf"],
  ["member: create without invite (no via)", await allowed(setDoc(doc(F, "icuGroups/GRPI/members/docF2"), { uid: "docF2", role: "junior_resident", addedBy: "link", joinedAt: now })), false, "no self-join without an invite"],

  // ── members: ADMIN-ADD ─────────────────────────────────────────────────────
  ["member: head admin-adds SR", await allowed(setDoc(doc(A, "icuGroups/GRPI/members/docN1"), { uid: "docN1", role: "senior_resident", addedBy: "docA", joinedAt: now })), true, "admin adds member"],
  ["member: admin-add as head (blocked)", await allowed(setDoc(doc(A, "icuGroups/GRPI/members/docN2"), { uid: "docN2", role: "head", addedBy: "docA", joinedAt: now })), false, "can't admin-add a head"],
  ["member: head grants professor", await allowed(setDoc(doc(A, "icuGroups/GRPI/members/docN3"), { uid: "docN3", role: "professor", addedBy: "docA", joinedAt: now })), true, "head may grant professor"],
  ["member: professor grants professor", await allowed(setDoc(doc(G, "icuGroups/GRPI/members/docN4"), { uid: "docN4", role: "professor", addedBy: "docG", joinedAt: now })), false, "only head grants professor"],
  ["member: professor admin-adds JR", await allowed(setDoc(doc(G, "icuGroups/GRPI/members/docN5"), { uid: "docN5", role: "junior_resident", addedBy: "docG", joinedAt: now })), true, "professor is an admin"],
  ["member: non-admin (SR) adds member", await allowed(setDoc(doc(B, "icuGroups/GRPI/members/docN6"), { uid: "docN6", role: "intern", addedBy: "docB", joinedAt: now })), false, "instructor is not an admin"],

  // ── members: role change (update) ──────────────────────────────────────────
  ["member: head promotes intern→SR", await allowed(updateDoc(doc(A, "icuGroups/GRPI/members/docD"), { role: "senior_resident" })), true, "admin role change"],
  ["member: head promotes →head (blocked)", await allowed(updateDoc(doc(A, "icuGroups/GRPI/members/docD"), { role: "head" })), false, "can't create a second head"],
  ["member: professor grants professor via update", await allowed(updateDoc(doc(G, "icuGroups/GRPI/members/docD"), { role: "professor" })), false, "only head grants professor"],
  ["member: self role escalation", await allowed(updateDoc(doc(B, "icuGroups/GRPI/members/docB"), { role: "professor" })), false, "no self role change"],
  ["member: admin edits the head's role", await allowed(updateDoc(doc(G, "icuGroups/GRPI/members/docA"), { role: "professor" })), false, "head role immutable"],

  // ── members: leave / remove ────────────────────────────────────────────────
  ["member: head self-leave (blocked)", await allowed(deleteDoc(doc(A, "icuGroups/GRPI/members/docA"))), false, "head can't bare-leave"],
  ["member: professor removes head (blocked)", await allowed(deleteDoc(doc(G, "icuGroups/GRPI/members/docA"))), false, "head can't be removed"],
  ["member: intern removes SR (non-admin)", await allowed(deleteDoc(doc(D, "icuGroups/GRPI/members/docB"))), false, "non-admin can't remove"],
  ["member: admin removes SR", await allowed(deleteDoc(doc(G, "icuGroups/GRPI/members/docN1"))), true, "admin removes a member"],   // remove a spare SR (docN1), not docB — docB is reused by the task/timeline cases below
  ["member: self-leave (intern/SR now)", await allowed(deleteDoc(doc(D, "icuGroups/GRPI/members/docD"))), true, "anyone may leave on their own"],

  // ── invites ────────────────────────────────────────────────────────────────
  ["invite: signed-in holder gets code", await allowed(getDoc(doc(C, "icuGroups/GRPI/invites/INVOK"))), true, "holder may preview invite"],
  ["invite: LIST/enumerate invites", await allowed(getDocs(collection(C, "icuGroups/GRPI/invites"))), false, "invites not enumerable"],
  ["invite: admin creates", await allowed(setDoc(doc(A, "icuGroups/GRPI/invites/INVNEW"), { role: "junior_resident", createdBy: "docA", expiresAt: future, unit: "Unit I", name: "Medicine ICU" })), true, "admin creates invite"],
  ["invite: non-admin creates", await allowed(setDoc(doc(D, "icuGroups/GRPI/invites/INVX"), { role: "junior_resident", createdBy: "docD", expiresAt: future })), false, "only admin creates invites"],

  // ── collectionGroup('members') self-query (subscribeGroups — the on-device fix) ──────────────
  // Firestore routes a collectionGroup query through the recursive `/{path=**}/members/{mid}` rule.
  // A member may read ONLY member docs whose `uid` is their own, so the self-scoped query is allowed
  // and a query for someone else's memberships is denied (can't enumerate who is in which unit).
  ["members: self collectionGroup query", await allowed(getDocs(query(collectionGroup(A, "members"), where("uid", "==", "docA")))), true, "subscribeGroups self-query"],
  ["members: query another's memberships", await allowed(getDocs(query(collectionGroup(A, "members"), where("uid", "==", "docB")))), false, "can't list others' memberships"],

  // ── doctorDirectory ─────────────────────────────────────────────────────────
  ["dir: signed-in gets by exact key", await allowed(getDoc(doc(C, "doctorDirectory/SMD-AAA111"))), true, "resolve by ID (get only)"],
  ["dir: signed-in gets email entry", await allowed(getDoc(doc(C, "doctorDirectory/e_hashb"))), true, "resolve by email (get only)"],
  ["dir: LIST/enumerate directory", await allowed(getDocs(collection(C, "doctorDirectory"))), false, "directory never listable"],
  ["dir: create own entry", await allowed(setDoc(doc(E, "doctorDirectory/SMD-NEWEEE"), { uid: "docE", name: "Dr E", at: now })), true, "own directory entry"],
  ["dir: create spoofed uid", await allowed(setDoc(doc(E, "doctorDirectory/SMD-SPOOF1"), { uid: "docA", name: "x", at: now })), false, "can't claim another's uid"],
  ["dir: overwrite another's entry", await allowed(updateDoc(doc(B, "doctorDirectory/SMD-AAA111"), { uid: "docB" })), false, "ID uniqueness protected"],

  // ── patients / timeline / tasks / presence (new isMember/canInstruct) ───────
  ["task: instructor (SR) creates", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/tasks/tB"), { text: "ABG q6h", status: "pending", assignedBy: "docB" })), true, "icu instructor task-create"],
  ["timeline: member creates as self", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/timeline/eB"), { by: "docB", type: "note", title: "pressor up" })), true, "icu append-self allowed"],
  ["timeline: create spoofing author", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/timeline/eS"), { by: "docA", type: "note", title: "x" })), false, "icu author must be self"],
  ["timeline: update (append-only)", await allowed(updateDoc(doc(A, "icuGroups/GRPI/patients/p1/timeline/te1"), { title: "edited" })), false, "icu timeline immutable"],
  ["presence: write self", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1/presence/docA"), { name: "Dr A", at: now })), true, "icu presence self"],
  ["presence: write another", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1/presence/docG"), { name: "x", at: now })), false, "icu presence self-only"],
  ["patient: member updates status", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1"), { name: "R.K.", dx: "sepsis" }, { merge: true })), true, "icu members update status"],
  ["patient: non-member updates", await allowed(setDoc(doc(C, "icuGroups/GRPI/patients/p1"), { dx: "x" }, { merge: true })), false, "icu non-member denied"],
  ["patient: head deletes", await allowed(deleteDoc(doc(A, "icuGroups/GRPI/patients/p2"))), true, "icu instructor may delete"],

  // ── DPDP retention cap (retentionCapped) — client-set `expiresAt` bounded to ~8 days ──────────
  // Guards the 7-day auto-clear: a member (or a client bug) must not be able to write a far-future
  // expiresAt and defeat the TTL delete. Cap-when-present, so an absent field still passes (above).
  ["retention: patient update w/ valid expiresAt (now+7d)", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1"), { dx: "x", expiresAt: Timestamp.fromMillis(now + 7 * 864e5) }, { merge: true })), true, "cap allows now+7d"],
  ["retention: patient update w/ max-window expiresAt (now+60d)", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1"), { dx: "x", expiresAt: Timestamp.fromMillis(now + 60 * 864e5) }, { merge: true })), true, "cap allows the widened 90d window"],
  ["retention: patient update w/ far-future expiresAt (now+95d)", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1"), { dx: "x", expiresAt: Timestamp.fromMillis(now + 95 * 864e5) }, { merge: true })), false, "cap blocks beyond ~91d"],
  ["retention: patient update w/ non-timestamp expiresAt", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1"), { dx: "x", expiresAt: now }, { merge: true })), false, "cap requires a Timestamp"],
  ["retention: timeline create w/ far-future expiresAt", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/timeline/eCap"), { by: "docB", type: "note", title: "x", expiresAt: Timestamp.fromMillis(now + 95 * 864e5) })), false, "cap blocks far-future (timeline)"],
  ["retention: task create w/ far-future expiresAt", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/tasks/tCap"), { text: "x", status: "pending", assignedBy: "docB", expiresAt: Timestamp.fromMillis(now + 95 * 864e5) })), false, "cap blocks far-future (tasks)"],
  ["retention: presence write w/ valid expiresAt (now+7d)", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1/presence/docA"), { name: "Dr A", at: now, expiresAt: Timestamp.fromMillis(now + 7 * 864e5) })), true, "cap allows now+7d (presence)"],
  ["retention: presence write w/ far-future expiresAt", await allowed(setDoc(doc(A, "icuGroups/GRPI/patients/p1/presence/docA"), { name: "Dr A", at: now, expiresAt: Timestamp.fromMillis(now + 95 * 864e5) })), false, "cap blocks far-future (presence)"],
];
await env.cleanup();

let fail = 0;
console.log("\n" + "operation".padEnd(42) + "want   got    guarantee");
for (const [op, got, want, g] of cases) {
  const ok = got === want; if (!ok) fail++;
  console.log((ok ? "PASS " : "FAIL ") + op.padEnd(40) + (want ? "ALLOW" : "deny ") + "  " + (got ? "ALLOW" : "deny ") + "  " + g);
}
console.log(`\n${fail ? "FAILED: " + fail + " guarantee(s) VIOLATED" : "ALL GREEN — sharedCases + ICU membership/directory/invite guarantees hold"}`);
process.exitCode = fail ? 1 : 0;
