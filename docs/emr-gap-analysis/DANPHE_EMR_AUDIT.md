# Danphe EMR (opensource-emr/hospital-management-emr) — forensic source audit

Full agent report, 100 tool calls into the actual cloned source (commit 99638225, 2024-09-02).
See conversation for the complete text; this file preserves it for the record.

## One-paragraph verdict
A real, formerly-commercial hospital system (Danphe EMR, Nepal, "live in 50+ hospitals") that was
open-sourced and then abandoned as an open-source project. Genuinely deep in three places: the
pharmacy/inventory stock ledger (batch/expiry/PO-to-payment, all transactional), a real double-entry
accounting engine, and a multi-level append-only approval-chain model. But the security posture is
broken in ways that would be disqualifying for a real hospital today: the server-side permission
check is literally commented out with a note explaining why, a public endpoint executes arbitrary
SQL against the live database, its own login-check function never actually compares the password,
and every password in the system is reversibly encrypted with a hardcoded key sitting in the public
MIT-licensed source. There is no drug-interaction checking, no allergy checking against
prescriptions, and no lab critical-value flagging anywhere in the codebase — confirmed by direct
code search, not assumed. Its "300 configurable settings" claim is real in breadth but 271 of the
300 are read only by the on-screen app, with nothing on the server enforcing them at all.

## Where WardSynQ is already ahead, confirmed
- Any real authorization/permission model at all (Danphe's is disabled).
- Any drug-interaction, allergy, or clinical-safety checking (Danphe has none).
- Any real audit trail on the clinical record itself (Danphe only audits money and demographics).
- Multi-branch/multi-tenant support (Danphe has essentially none — one database per branch).
- A modern, actively maintained stack (Danphe's is fully end-of-life: .NET Framework 4.6, Angular 7).

## What's worth studying (not copying the code, the design)
- The pharmacy stock ledger: batch + expiry + MRP history, append-only stock transactions,
  purchase-order → goods-receipt → supplier-ledger → payment, all in real transactions.
- The append-only, multi-level approval-chain model (a real, reconstructable history instead of a
  single "approved" flag), with genuine server-side permission checks tied to it — the one place in
  the whole codebase where authorization is actually done properly.
- The double-entry accounting engine and its configurable billing-line-to-ledger mapping.
- What a real national tax-authority and national-insurer integration costs to build (relevant if
  WardSynQ ever needs to satisfy a regulator or a government payer the way this system had to).
