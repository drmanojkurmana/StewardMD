/* StewardMD — Firestore rules emulator test. Validates the sharedCases guarantees against the
 * repo's firestore.rules. Run via firebase emulators:exec (see README.md). Exit 0 = all pass.
 * (Not run in this repo's CI — the dev box had no Java Runtime; run locally with a JDK.)
 */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
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
  // ICU collaboration unit: docA=head, docB=senior_resident (instructor), docD=intern
  // (member but NOT an instructor). docC is a NON-member.
  await setDoc(doc(db, "icuGroups/GRPI"), { name: "Medicine ICU · Unit I", unit: "Unit I", hospital: "GIMSR", createdBy: "docA", roles: { docA: "head", docB: "senior_resident", docD: "intern" }, members: ["docA", "docB", "docD"] });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p1"), { name: "R.K.", dx: "bacterial meningitis", bed: "1", state: {}, severity: "critical" });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p2"), { name: "S.M.", dx: "sepsis", bed: "5", state: {} });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p1/timeline/te1"), { by: "docA", type: "round", title: "Morning round", ts: now });
  await setDoc(doc(db, "icuGroups/GRPI/patients/p1/tasks/tSeed"), { text: "Neuro obs hourly", status: "pending", assignedBy: "docA" });
});
const anon = env.unauthenticatedContext().firestore();
const A = env.authenticatedContext("docA").firestore();   // head
const B = env.authenticatedContext("docB").firestore();   // senior_resident (instructor)
const C = env.authenticatedContext("docC").firestore();   // non-member
const D = env.authenticatedContext("docD").firestore();   // intern (member, not instructor)

// [operation, actualAllowed, expectedAllowed, guarantee]
const cases = [
  ["get by exact code (unexpired)", await allowed(getDoc(doc(anon, "sharedCases/SMDLIVE1"))), true, "#2 public link -> one case"],
  ["get expired share", await allowed(getDoc(doc(anon, "sharedCases/SMDEXPD1"))), false, "#4 expiry enforced"],
  ["LIST/enumerate all shares", await allowed(getDocs(query(collection(anon, "sharedCases"), where("expiresAt", ">", now)))), false, "#1 no enumeration"],
  ["create own share", await allowed(setDoc(doc(A, "sharedCases/SMDNEW01"), { code: "SMDNEW01", ownerUid: "docA", html: "x", text: "x", expiresAt: future })), true, "owner create"],
  ["create with spoofed ownerUid", await allowed(setDoc(doc(B, "sharedCases/SMDNEW02"), { code: "SMDNEW02", ownerUid: "docA", expiresAt: future })), false, "#3 can't impersonate"],
  ["create with TTL > 32 days", await allowed(setDoc(doc(A, "sharedCases/SMDNEW03"), { code: "SMDNEW03", ownerUid: "docA", expiresAt: now + 90 * 864e5 })), false, "#4 TTL capped"],
  ["update another's share", await allowed(updateDoc(doc(B, "sharedCases/SMDLIVE1"), { text: "hacked" })), false, "#3 no cross-user edit"],
  ["delete another's share", await allowed(deleteDoc(doc(B, "sharedCases/SMDLIVE1"))), false, "#3 no cross-user delete"],
  ["delete own share (revoke)", await allowed(deleteDoc(doc(A, "sharedCases/SMDLIVE1"))), true, "#4 revocation"],
  ["read own private case", await allowed(getDoc(doc(A, "users/docA/cases/c1"))), true, "private ok for owner"],
  ["read another's private case", await allowed(getDoc(doc(B, "users/docA/cases/c1"))), false, "#3 private isolation"],

  // ── ICU collaboration groups (icuGroups) ──────────────────────────────────
  ["group: member reads unit", await allowed(getDoc(doc(A, "icuGroups/GRPI"))), true, "icu membership read"],
  ["group: non-member reads unit", await allowed(getDoc(doc(C, "icuGroups/GRPI"))), false, "icu non-member denied"],
  ["group: create own unit (self=head)", await allowed(setDoc(doc(C, "icuGroups/GRPNEW"), { name: "New", createdBy: "docC", roles: { docC: "head" }, members: ["docC"] })), true, "icu create as head"],
  ["group: create with spoofed createdBy", await allowed(setDoc(doc(D, "icuGroups/GRPSPOOF"), { name: "X", createdBy: "docA", roles: { docD: "head" }, members: ["docD"] })), false, "icu no spoofed createdBy"],
  ["group: create not-as-head", await allowed(setDoc(doc(C, "icuGroups/GRPJR"), { name: "X", createdBy: "docC", roles: { docC: "senior_resident" }, members: ["docC"] })), false, "icu creator must be head"],
  ["task: instructor (senior_resident) creates", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/tasks/tB"), { text: "ABG q6h", status: "pending", assignedBy: "docB" })), true, "icu instructor task-create"],
  ["task: non-instructor (intern) creates", await allowed(setDoc(doc(D, "icuGroups/GRPI/patients/p1/tasks/tD"), { text: "x", status: "pending", assignedBy: "docD" })), false, "icu non-instructor task-create denied"],
  ["task: member updates status", await allowed(updateDoc(doc(D, "icuGroups/GRPI/patients/p1/tasks/tSeed"), { status: "done" })), true, "icu any member completes"],
  ["timeline: member creates as self", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/timeline/eB"), { by: "docB", type: "note", title: "pressor up" })), true, "icu append-self allowed"],
  ["timeline: create spoofing author", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/timeline/eS"), { by: "docA", type: "note", title: "x" })), false, "icu author must be self"],
  ["timeline: update (append-only)", await allowed(updateDoc(doc(A, "icuGroups/GRPI/patients/p1/timeline/te1"), { title: "edited" })), false, "icu timeline immutable"],
  ["timeline: delete (append-only)", await allowed(deleteDoc(doc(A, "icuGroups/GRPI/patients/p1/timeline/te1"))), false, "icu timeline no-delete"],
  ["presence: write self", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/presence/docB"), { name: "Dr B", at: now })), true, "icu presence self"],
  ["presence: write another", await allowed(setDoc(doc(B, "icuGroups/GRPI/patients/p1/presence/docD"), { name: "x", at: now })), false, "icu presence self-only"],
  ["patient: member (intern) updates status", await allowed(setDoc(doc(D, "icuGroups/GRPI/patients/p1"), { name: "R.K.", dx: "sepsis" }, { merge: true })), true, "icu all members update status"],
  ["patient: non-instructor deletes", await allowed(deleteDoc(doc(D, "icuGroups/GRPI/patients/p2"))), false, "icu delete needs instruct"],
  ["patient: head deletes", await allowed(deleteDoc(doc(A, "icuGroups/GRPI/patients/p2"))), true, "icu head may delete"],
];
await env.cleanup();

let fail = 0;
console.log("\n" + "operation".padEnd(32) + "want   got    guarantee");
for (const [op, got, want, g] of cases) {
  const ok = got === want; if (!ok) fail++;
  console.log((ok ? "PASS " : "FAIL ") + op.padEnd(30) + (want ? "ALLOW" : "deny ") + "  " + (got ? "ALLOW" : "deny ") + "  " + g);
}
console.log(`\n${fail ? "FAILED: " + fail + " guarantee(s) VIOLATED" : "ALL GREEN — sharedCases guarantees hold"}`);
process.exitCode = fail ? 1 : 0;
