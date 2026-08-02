---
tags: [decisions, adr]
---
# Decisions

Dated architectural calls + why. Newest first. Keep each short: **decision · why · trade-off · status**.

## 2026-08-01 · Connect Track A (FHIR/SMART) + Track B (HL7/CSV legacy feeds)
Built on `feat/connect-fhir-smart` (off merged main; tag `pre-connect-fhir`), both behind own flags default OFF. **Track A** = synchronous FHIR R4 **pull** via SMART Backend Services (`private_key_jwt`): asymmetric-only signer (alg:none/HMAC structurally impossible), token-endpoint **trust gate** validated pre-sign + re-asserted pre-POST, envelope-sealed NON-PHI token cache, same-origin pagination, FHIR->SCCM. **Decision:** the frozen `SMART_HOST_ALLOWLIST` is a HARD CEILING — a per-tenant config override may only NARROW it (fix from the token-exchange red-team, which also caught a string-allowlist substring-match degrade + an unvalidated-fhirBase SSRF); connector is dual-mode (SMART when `secret_ref` present, else Phase-0 no-auth) for zero regression; scope is SCCM-canonical (medications family = MedicationRequest+MedicationStatement). **Track B** = HL7 v2 + file/CSV **event/push** via one HMAC-gated ingest spine (mirrors abdm/ingress): verify(constant-time HMAC)->replay(freshness+HMAC'd nonce)->correlate(authoritative tenant from `connect_feed`, headers cross-check only)->route->validate/filter/PHI-free-audit->discard; hand-written no-dep parsers, warn-never-throw, budget-bounded; no StewardMD actor on push. **Why:** realizes the reserved pull + event profiles; the egress/auth boundary lives where the secret/PHI crosses. **Trade-off:** AL1/DG1 ADT maps + local->LOINC crosswalk owner-gated/deferred. **Status:** 391 connect (incl smart/hl7/csv/abdm) + 208 top-level green, zero regression; benches under budget; DUAL-ADVERSARIAL reviews on the signer/token (SAFE, exfil HIGHs fixed) + HL7 parser + ingest spine. NOT merged/pushed — owner // VERIFY the real FHIR+AS host allow-list, client registration, and the HL7 inbound auth/transport before any real feed (see `docs/connect/track-a-b-onboarding.md`). See [[Home]].

## 2026-08-01 · Connect Track D — Enterprise RBAC + MaiK wiring behind the egress gate
Built (behind `smd_connect` + new `smd_connect_maik`, both OFF; tag `pre-connect-track-d`, branch `feat/connect-track-d-enterprise-maik`): (1) deny-by-default fail-closed RBAC (owner/admin/clinician/auditor) on the existing membership seam — PHI actions are clinician-only, `egress:baa` owner-only; (2) MaiK consumes canonical SCCM via `buildMaikContext` behind the R7 `assertEgressAllowed` gate. **Decision:** the wiring is SERVER-CENTRIC — the single existing-file touch is one flag-gated, fail-safe block in `functions/api/ai/[[path]].js` (before `renderGroundedPrompt` in `explain`); the client `home.js` is untouched; the patient binding is server-held (envelope-SEALED in KV, no raw patientRef in KV). Only the R7-GATED egress lane is folded into `pkg.patientCase`; a live bundle without `egressBaaOk` feeds the deterministic lane only (served to the clinician's device by the new `functions/api/connect/maik` surface), NEVER the LLM. **Why:** `callGemini` is the third-party egress, so the invariant must live where the egress lives; flag-off is byte-identical (63 ns hot-path). **Trade-off:** meds/allergies fold into the existing `findings` channel (no second live-function change); `research` handler + target-in-audit deferred. **Status:** 118/118 connect + 208/208 top-level green, zero regression; DUAL-ADVERSARIAL reviews on RBAC + egress gate. NOT merged/deployed — owner ratifies the RBAC matrix + flips `egressBaaOk` only after BAA/DPA + no-retention LLM tier (see `docs/connect/track-d-enterprise-maik.md`). See [[Home]].

## 2026-07-30 · Block internal source/docs from public serving
Pages serves the repo root, so `docs/` (runbook) + `CLAUDE.md` were publicly reachable (leaking team ID, SHA fingerprints, the inert-gate-key note). `functions/_middleware.js` now 404s internal paths (`docs/`, `vault/`, `ios/`, `*.md`, `CLAUDE.md`…). **Trade-off**: none for the app (only web assets are served). **Status**: live. Protects [[Home|this vault]] too.

## 2026-07-30 · On-demand native assets (fetch from stewardmd.in)
Heavy, flag-gated module assets are stripped from the native bundle and fetched on first use, cached by the WebView. First: [[FundX]] MediaPipe (~22 MB). **Why**: shrink install. **Trade-off**: one-time download on first module use (fallback: LOCAL→SELF→CDN, so nothing breaks). **Status**: phase 1 live (AAB 124→115 MB); ONNX / Learn / ML-Kit / offline-KB pending — see [[Roadmap]].

## 2026-07-30 · Vision/OCR pinned to a strong fixed model
[[Scan-Meds and Drug Index]] `/vision` used the global model → an admin model-override to `gemini-3.5-flash-lite` degraded handwriting OCR. Now `VISION_MODEL` (default `gemini-2.5-flash`), ignoring the text override + emergency-cheap. **Why**: misreading a drug is a safety risk. **Status**: live.

## 2026-07-30 · Admin access = exactly 3 owner accounts
`drmanojkurmana@` / `mkkmanojkumar0@` / `kdiwakar45@gmail.com`; removed `stewardmd.in@`. Set in ALL gates (server `_adminauth.js` + `verifications`, client `home.js`/`sidebar-redesign.js`) + env `OWNER_EMAILS`. Server (Firebase id-token email) is the real boundary; client lists = UI visibility. **Status**: live.

## 2026-07-29 · Intent Firewall = allow-list, not block-list
See [[MaiK Intent Firewall]]. Require a positive medical signal; reject the rest. **Why**: a block-list can't enumerate all non-medical topics. **Invariant**: zero false-refusals. **Status**: live (gold1041).

## Standing principles
- **Reversible changes**: big/risky changes go behind a feature **flag** + a git **recovery point** (tag/branch); made permanent only after owner approval.
- **Test before you build** (owner mandate): unit + a real headless-browser test before shipping UI/logic.
- **No em-dash** in app-facing text (MaiK AI *output* exempt).
- **Mobile-only**: the web code IS the app (Capacitor renders local `www/`).
