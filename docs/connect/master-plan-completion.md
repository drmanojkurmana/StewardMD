# StewardMD Connect — Master Plan Completion Tracker

Source of truth: `~/Desktop/StewardMD Connect Design.rtf` (4-Part plan). This tracks every Part's "complete only when" against real status, and the ordered path to finish. Updated as increments land.

Legend: ✅ done · 🟡 partial · 🔨 building now · 🔴 not started

---

## PART 1 — Foundation (Vision & Universal Architecture) — ✅ DONE
Canonical model (SCCM), connector contract (pull/event profiles), module architecture, tenant/secrets/audit foundation. Shipped as Phase 0 (walking skeleton), reviewed, on origin.

## PART 2 — Universal Connector Engine — 🟡 PARTIAL (~half)
Required 10 connectors + auto-discovery/sync/monitoring/AI-field-mapping.
- FHIR ✅ · SMART-on-FHIR ✅ · HL7 v2 ✅ · CSV ✅ · Connector SDK ✅ · ABDM ✅ (bonus, Phase 1)
- REST 🔴 · GraphQL 🔴 · Database read-replica 🔴 · DICOM/DICOMweb 🔴 · Webhook/push 🔴
- Auto-discovery engine 🔴 · Sync/scheduler engine 🔴 · Monitoring/health 🔴 · AI-assisted field mapping 🔴 · Retry/error-recovery queues 🔴

## PART 3 — Self-Service Hospital Onboarding & Enterprise — 🟡 BACKEND ONLY
Backend done: RBAC ✅ · multi-tenant isolation ✅ · audit ✅ · secrets/encryption ✅ · consent (ABDM) ✅.
NOT built (the Part-3 point — "hospital IT admin configures it independently"):
- Self-Service Onboarding Wizard / Hospital Integration Portal 🔨 **BUILDING (Increment 1: backend of the "Connect EMR" flow)**
- Enterprise Dashboard 🔴 · Monitoring & Alerting UI 🔴 · Security Center 🔴 · Config Management UI 🔴 · Backup & Recovery 🔴 · Deployment Profiles (on-prem/hybrid) 🔴 · AI-Assisted Field-Mapping UI 🔴

## PART 4 — MaiK & Ecosystem Orchestration — 🟡 STARTED
- ✅ Clinical Context Assembler DONE + backed up — `functions/_connect/maik/clinical-context.js`, feat/connect-clinical-context @ 910e52f8 (origin), 419/419 (+14). Deterministic SCCM→structured-MaiK-context; TESTED no-fabrication guard (every clinical string verbatim-in-source; bare bundle → diagnosis-free); abnormal-lab detection via interpretation-flag OR out-of-range; hostile-bundle bounded; aligned w/ maik-context.js. Concern: SCCM v1 has no Procedure resource (keyProcedures future-proofed []).
- 🔨 BUILDING: Clinical Alert Framework `functions/_connect/maik/clinical-alerts.js` (same branch) — deterministic alerts from the context: allergy-conflict / duplicate-therapy / abnormal-lab / polypharmacy, SURFACE-NOT-DECIDE (no diagnose/recommend/stop-med), no-fabrication + no-directive-verb guards, TDD. (drug-interaction + renal-dose alerts = later, need the main app's engines.)
(below = original PART 4 status)
## PART 4 — MaiK & Ecosystem Orchestration — 🔴 PLUMBING ONLY (baseline)
Built: the MaiK egress gate + deterministic/LLM lanes (Track D) — the pipe.
NOT built (the intelligence):
- Unified Clinical Context Engine 🔴 · Clinical Timeline 🔴 · Intelligent Module Orchestrator 🔴 · Workflow Intelligence 🔴 · Clinical Alert Framework (interactions/renal/allergy/duplicate/lab) 🔴 · Enterprise Analytics 🔴

---

## Ordered path to finish (executing top-down; each = reviewed increment)
1. **Self-service EMR onboarding** (Part 3 core — the visible win): backend 🔨 → "Connect EMR" UI → live-verify against a public FHIR server. Flag `smd_connect_onboard`.
2. **Part-2 connector breadth**: Webhook/push, DICOMweb (imaging), REST/config, DB read (Hyperdrive), GraphQL — each via the Connector SDK, each in the wizard's type-picker.
3. **Part-2 ops layer**: auto-discovery, sync scheduler, health/monitoring, retry/recovery.
4. **Rest of Part 3**: enterprise dashboard, monitoring/alerting UI, security center, deployment profiles, AI field-mapping UI.
5. **Part 4 orchestration**: unified context engine → clinical timeline → module orchestrator → clinical alert framework → analytics.

## Honest scope note
This is a multi-part program (a dozen+ connectors, a full portal, clinical orchestration) — it lands as a steady stream of working, reviewed increments, not one finish. Each increment is TDD + reviewed + zero-regression, behind a flag, before the next. Real-PHI go-live for any of it still needs the owner gates (D1/secrets provisioning, BAA, // VERIFY endpoint pins).

## Current build state
- Increment 1 backend: ✅ DONE — `feat/connect-emr-onboard` @ `4fd32822`, 438/0 (+33 tests). Routes: POST /onboard/emr, /test/:id, GET /list, POST /pull/:id, DELETE /:id. SSRF guard `assertPublicHttpsUrl` (functions/_connect/onboard/ssrf.js), envelope-sealed creds, RBAC (connector:write/validate/read), flag `smd_connect_onboard` OFF. Owner // VERIFY: DNS-rebinding deferred; onboard-pull PHI to admin (clinician-only?); SMART needs privateKeyJwk under auth.*.
- Increment 1 UI: ✅ DONE — `859a8bd6`, admin/connect-emr.html (self-contained, additive; NOT linked from admin nav yet = conflict-free). Firebase owner auth + api() pattern; wired to all 5 onboard routes; Token+SMART auth; per-error-class copy; graceful flag-off state; token=password. Headless CDP test test/run-connect-emr-ui.mjs 10/10, zero console errors; 438/0. Concerns: admin types tenant-id (later: membership dropdown); pulled bundle shows PHI as JSON for the verify-tester (LLM egress still BAA-gated); nav-link deferred.
- Increment 1 backend SECURITY REVIEW: ✅ done → VERDICT FAIL, 1 CRITICAL. Redirect-follow SSRF (raw fetch redirect:"follow" on probe.js:26/28/57/75/85 + connector.js:50/62 → a public host 302s to 169.254.169.254/internal, guard bypassed + SMART assertion/custom-header exfil on cross-origin redirect) + Important trailing-dot name bypass (localhost./metadata.google.internal. pass ssrf.js:54). At-rest creds/authz/IDOR = SAFE. Alt-IP encodings + IPv6 + userinfo = SAFE. DNS-rebinding = documented residual.
- Increment 1 backend SSRF FIX: ✅ DONE + CONTROLLER-VERIFIED — `f4df2db2`, 447/0 (+9 adversarial). makeSafeFetch (net.js) redirect:manual + per-hop revalidate + drop creds/body cross-origin, routed through ALL onboard fetches (discovery via injected {fetch:sfetch} at probe.js:56, token POST, probes, pull via ctx.fetch=safeFetch); connector.js + paginate.js redirect:manual + same-origin. Trailing-dot strip in ssrf.js. Controller grep+read confirmed NO raw-fetch bypass. DNS-rebinding = documented // VERIFY residual (resolve-then-pin before untrusted admins).
=> INCREMENT 1 (self-service Connect EMR: backend + UI + SSRF-hardened) COMPLETE on feat/connect-emr-onboard @ f4df2db2, 447/0, flag smd_connect_onboard OFF.
- Increment 1 LIVE-VERIFY: ✅ PASS against a REAL server (r4.smarthealthit.org, Smile CDR, FHIR 4.0.0, commit 32cc523c). Probe→{fhirVersion 4.0.0, Smile CDR}; pull+normalize→valid SCCM v1.0 bundle for synthetic patient (106 enc/14 cond/8 med/62 obs/4 dx, real SNOMED/LOINC/RxNorm), PHI-free audit. No bugs. 447/0.
=> **INCREMENT 1 (self-service Connect EMR, FHIR) COMPLETE + SECURITY-HARDENED + LIVE-PROVEN + BACKED UP** (origin/feat/connect-emr-onboard). This IS the Part-3 self-service onboarding centerpiece, working end-to-end for FHIR EMRs.

### INCREMENT 2 — CSV upload path — ✅ DONE
- `a45b2a93`, 458/0 (+11), UI smoke 14/0, verified green-as-committed. POST /api/connect/onboard/csv (type-dispatched, 2MB double-cap, reuses Track-B csv.js+normalize.js UNTOUCHED, inferColumnMap header auto-map) → one-shot upload→SCCM bundle+warnings. Wizard "CSV" type active. DoS caps proven through endpoint (20k-col→512, 120k-row→maxRows). PHI-free audit. RBAC connector:read pull-parity (owner // VERIFY: tighten to :write?).

### INCREMENT 3 — HL7 feed path — ✅ DONE + BACKED UP
- `465d15b1`, 466/0 (+8), UI 19/0, origin-backed. POST/GET/DELETE /onboard/hl7-feed → feedId + 32B CSPRNG HMAC secret (envelope-sealed, shown once) + connect_feed row (connector_id hl7v2) + real ingestUrl. Reuses Track-B ingest spine; 1 additive backward-compat line in ingest.js (sealed-secret fallback — Workers env can't write at runtime). CREATE→INGEST ROUND-TRIP PROVEN vs the SHIPPED spine (signed ORU→202+SCCM; wrong/tampered/revoked→401). Two flags (smd_connect_onboard mgmt + smd_connect_hl7 ingest). Owner: ALTER connect_feed ADD secret_sealed.
=> **WIZARD NOW COVERS FHIR + CSV + HL7 SELF-SERVICE** = the standards-based majority of hospitals, no per-hospital engineering. This is the substance of Part 3's self-service promise.
- SELF-SERVICE FEATURE WHOLE-BRANCH REVIEW: ✅ **VERDICT READY** — no Critical/Important across all 4 increments. SSRF airtight (all fetches via makeSafeFetch, discovery-path confirmed safe); secrets sealed+no-leak (FHIR/CSV/HL7); RBAC/IDOR clean (tenant server-derived, WHERE tenant_id scoped); ingest.js change backward-compat+constant-time; DoS caps; flag-OFF inert (404); PHI/audit clean. => **SELF-SERVICE EMR FEATURE (Part-3 centerpiece) COMPLETE, SECURE, LIVE-PROVEN, REVIEW-READY.**
  Minor/deferred (logged, non-blocking): (1) CSV request.json() buffers before byteLen on a chunked no-Content-Length req (platform-bounded, authed); (2) no server-side `name` length cap (UI caps 120); (3) ownerOk dead in deps; (4) flag-decoupling revocation quirk (feed keeps ingesting on smd_connect_hl7 alone but can't be revoked from wizard if smd_connect_onboard off); (5) DELETE hl7-feed no-id → 404; (6) DNS-rebinding SSRF residual (resolve-then-pin later). OWNER POLICY //VERIFY: onboard-pull + CSV expose SCCM PHI to owner/admin under connector:read (matrix reserves context:load PHI for clinicians) — ratify.
- ✅ Connections Dashboard + tenant picker DONE + backed up (a789bcd6, 476/0, UI 27/27, recovery tag pre-onboard-dashboard). GET /onboard/tenants (self-scoped membership, IDOR-safe TESTED) → dropdown replaces typed tenant-id; GET /onboard/all → unified FHIR+HL7 table (reuses safeView, no secret drift). => **SELF-SERVICE EMR FEATURE = complete Part-3 deliverable: connect (FHIR/CSV/HL7) + manage + dashboard + tenant picker, whole-branch REVIEW-READY, live-proven.**
- 🔨 Generic push Webhook (Part 2 breadth) BUILDING — fhir-push feed via the ingest spine + normalizeFhir, wizard type, create→push→normalize round-trip. Completes the "Webhook" connector line.

### PART 4 progress (worktree StewardMD-p4, feat/connect-clinical-context, origin-backed @1cc6cc29):
- ✅ Clinical Context Assembler (910e52f8)
- ✅ Clinical Alert Framework (1cc6cc29, 433/0) — allergy/duplicate/abnormal-lab/polypharmacy, surface-not-decide + no-directive-verb + no-fabrication all TESTED; false-negative honesty documented (no drug DB v1)
- ✅ Intelligent Module Orchestrator (b86e456d, 453/0, backed up) — deterministic rules: cardiac→kardiox, respiratory→thorx, diabetic/retinal→fundx, meds→drug-db+rx, renal-lab→renal-calc, active-problems→protocols+guidelines, thin-context→research. suggest-not-launch (no directive/launch/decision verbs, "may be" framing — TESTED) + no-fabrication + false-suggestion-guarded (sepsis≠cardiac-imaging; I10 not ECG). Owner sign-off: scribe-on-any-encounter (weak); research-thin-only (no coverage DB v1).
- ✅ Clinical Timeline Engine (ac8187f3, 467/0, backed up) — chronological events (encounters/onsets/labs/reports/meds), date-DESC, undated bucket (no date fabrication — TESTED), bounded.
- ✅ Unified MaiK Patient Brief capstone (44d0644a, 483/0, backed up) — `buildMaikPatientBrief(bundle)` composes all 4 modules; brief = counts + verbatim strings; no-fabrication + no-directive-verb + fail-safe all TESTED.
- ✅ Integration-Health Analytics DONE + backed up (b263f82e, 503/0) — PHI-free connector health (per-connector ok/failed/failureRate, recentFailures, warnings) over audit events; PHI-exclusion airtight (TESTED: patient/consent/txn hashes + PHI-shaped reasons never surface, safeReason guard); tenant-scoped (TESTED cross-tenant denied); GET /onboard/health, flag-gated.
=> **PART 4 DETERMINISTIC ENGINE 100% COMPLETE** — 6 modules @b263f82e on origin/feat/connect-clinical-context: context + alerts + orchestrator + timeline + patient-brief + integration-health. All deterministic, safety-guarded (surface-not-decide / no-fabrication), backed up. Remaining Part 4 = ONLY the owner-gated live pieces (wire patient-brief into the live MaiK path = Track-D egress; drug-interaction/renal alerts = need main-app drug DB engines).
=== INTEGRATION DONE + VERIFIED (2026-08-01, NOT pushed to main) ===
Branch `feat/connect-integration` @ 09cfad11 (backed up on origin), based on origin/main 41b04bb0. Merged ALL feature branches onto main in one throwaway worktree (StewardMD-integrate): (1) Track A/B/D 9a6d63b6 [router conflict = trivial imports-combine; api/ai egress hook auto-merged, KEPT flag-OFF/inert], (2) self-service emr-onboard f4aeb964 [no conflict], (3) Part-4 clinical-context 09cfad11 [onboard-router add/add conflict resolved by keeping the full self-service router + grafting the /health analytics route + re-exporting onboardFlagOn as flagOnboardOn for the analytics test]. **Connect suite 752/752 GREEN.** Main-app regression check: the ONLY 2 top-level failures (maik-native-stream, maik-routing) FAIL IDENTICALLY on plain main 41b04bb0 = PRE-EXISTING/environmental (Vertex/network, sandbox-flaky), NOT introduced. 118 files, +9787, flag-OFF (guards present: 7 in connect router, 4 in onboard router). SDK (Track C) DEFERRED — a framework needing a deliberate /context registry-resolution rewire (its router edit didn't auto-apply → 3 router.test failures); backed up on origin/feat/connect-sdk for separate integration. NOTE: origin/main advanced 41b04bb0→74cf61fa while integrating (main moves frequently) → landing needs a trivial refresh (merge latest main in, disjoint app commit). origin/main UNTOUCHED. Ready to land on OWNER go-ahead (touches the live AI-endpoint neighborhood + big prod change; flag-OFF so inert until the go-live gates + flag flips).

INTEGRATION TOPOLOGY (mapped): origin/main=27110d1d; connect branches (all flag-OFF, backed up): fhir-smart[A/B/D]=38765d25, sdk[C]=0fd39081, emr-onboard[selfservice]=a789bcd6(+webhook building), clinical-context[Part4]=b263f82e. emr+clinical-context descend from fhir-smart; sdk separate base. Merge is ~90% clean additive (functions/_connect/*, functions/api/connect/*). ONE real conflict: functions/api/ai/[[path]].js (Track-D MaiK-egress hook vs main's #598 AI-usage-caps — the LIVE MaiK endpoint). INTEGRATION PLAN: after webhook lands → merge all connect branches in a TEST worktree off main, resolve api/ai/[[path]].js by KEEPING main's AI-usage version + DEFERRING the egress hook (flag-OFF, documented owner step), verify FULL suite green+inert, present READY (not pushed) → owner one-word go-ahead to land (touches the live endpoint's neighborhood).
=> **PART 4 DETERMINISTIC CLINICAL ENGINE COMPLETE** (5 modules @44d0644a: context+alerts+orchestrator+timeline+patient-brief, all backed up) + analytics(building). 
=> INFLECTION: the deterministic + self-service work (the safely-autonomous bulk) is nearly done. REMAINING for "100% all 4 parts" is now mostly OWNER-GATED / integration: (a) INTEGRATE the branches onto main (a deploy consolidation); (b) wire the patient-brief into the LIVE MaiK path = touches the running app (Track-D egress); (c) drug-interaction + renal-dose alerts = need the main app's drug DB engines; (d) lower-value breadth (REST/GraphQL/DICOM/DB connectors) + Part-3 enterprise config (deploy-profiles/security-center/backup) + AI-mapping. All flag-OFF, all backed up on origin branches.

=== LANDED TO MAIN (2026-08-01) ===
All 4 Parts INTEGRATED + landed on `origin/main` @ `d5480be8` (fast-forward, flag-OFF/inert, 752/752 connect green, zero new regressions; verified `d5480be8` is an ancestor of current origin/main). SDK (Track C) DEFERRED, backed up `origin/feat/connect-sdk`.

=== POST-LANDING CONTINUATION — branch `feat/connect-onboard-golive` (off origin/main, recovery tag `pre-connect-onboard-golive`) ===
Real-EMR go-live readiness + roadmap continuation, all flag-OFF, NOT pushed until owner "land it":
- ✅ **Real-EMR owner runbook** — `docs/connect/onboard/owner-onboarding.md`: the direct-EMR (non-ABDM) self-service go-live gate + hospital-admin self-onboarding guide. Generic/multi-tenant. Exact bindings (`CONNECT_DB` + `db/connect_schema.sql` + `db/connect_hl7_schema.sql`, reuse `MAIK_KV`), secret (`CONNECT_MASTER_KEY`), flags (`CONNECT_FLAG`+`CONNECT_ONBOARD_FLAG`; `CONNECT_HL7_FLAG`; `CONNECT_FHIR_PUSH_FLAG`), BAA/R7-egress gate, PHI-to-admin policy + DNS-rebinding residual. Coming-soon gate confirmed pass-through for /api + /admin.
- ✅ **CI gap FIXED (checklist Section E)** — `package.json` test glob now includes `test/connect/*/*.test.mjs`; the 51 subdir suites (abdm/onboard/smart/file/hl7v2) that never ran under `npm test` are now covered (verified 50/50 green before the change).
- ✅ Cross-referenced from `docs/connect-GO-LIVE-CHECKLIST.md` Section G.
- ✅ **Auto-discovery** (27ef28f6) — `POST /api/connect/onboard/discover`: unauthenticated FHIR capability probe (version/software/SMART) for wizard pre-fill; SSRF-safe, RBAC+flag-gated, PHI-free audit. Adversarially reviewed -> 2 Important fixes landed (b4c537d2): audit-safe malformed-CapabilityStatement handling + wire the connector:validate rate limit (429) into discover + testConnection.
- ✅ **SDK (Track C) integration** (b5f6abf2) — Connector SDK (descriptor + conformance kit + fail-closed registry + catalog) behind new flag `CONNECT_SDK_FLAG`/`smd_connect_sdk` default OFF. The /context registry rewire is FLAG-CONDITIONAL: OFF = byte-identical to main, ON = pull-profile subset of the registry. Fixed a genuine fhir-r4 fail-closed gap the conformance kit caught (bare network rejection now typed as UpstreamError, typed errors preserved). 94/94 connect green.
- 🔨 NEXT: connector-breadth + ops + enterprise self-management UI increments (each reviewed, flag-gated).
- Owner note: real-PHI go-live for any of this STILL needs the owner gates (D1/secret provisioning + BAA + flag flips) — these live in the Cloudflare account, not code.
