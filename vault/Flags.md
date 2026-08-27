---
tags: [reference, flags]
---
# Feature flags — what is ON, what is OFF, and why

Generated from the `*-flags.js` registries on 2026-08-26. **105 flags: 74 ON, 24 OFF, 7 non-boolean.**

Regenerate rather than hand-edit — the registries are the source of truth, this is a view of them.

## The four that must NOT be turned on

Not judgement calls. Each is the repo's own instruction, and each has a specific victim.

| Flag | Why |
|---|---|
| `smd_clinix_uncleared_media` | **NEVER, LEGAL.** The repo's own text: 'Authoring escape hatch: render media whose licence is not cleared. NEVER ship on.' |
| `smd_surgx_uncleared_media` | **NEVER, LEGAL.** Same sentence, same rule: unlicensed images would render to users. |
| `smd_kardiox_demo` | **NEVER, SAFETY.** Makes Analyze return a CANNED FABRICATED result instead of real inference. Off is what guarantees a real answer or an honest 'unavailable'. |
| `smd_thorex_demo` | **NEVER, SAFETY.** Same: a canned fabricated chest X-ray result instead of real inference. |

The two `*_uncleared_media` flags render images whose licence was never cleared. The two `*_demo` flags make **Analyze return a canned, fabricated clinical result** instead of real inference — in a diagnostic app, that is the single most dangerous switch in the repo. Their being OFF is what makes "a real answer, or an honest 'inference unavailable'" true.

## Blocked on something else, not on a decision

Turning these on does not enable a feature; it breaks one.

| Flag | Blocked on |
|---|---|
| `smd_thorex_secure_egress` | The proxy fails CLOSED with 503 until THOREX_ANALYZE_URL is provisioned. Turning it on breaks analysis. |
| `smd_sknx_secure_egress` | Same posture as ThoreX: needs the server-side proxy first. |
| `smd_followcare_sms` | Needs an SMS provider configured. On without it means failed or misdirected patient messages. |
| `smd_followcare_voice` | Needs per-hospital enable plus the voice service. |

## Clinical gates — the owner's call, not a config change

| Flag | State | What it says about itself |
|---|---|---|
| `smd_kardiox` | OFF | Its own words: clinically unvalidated, regulatory-pending. Opens per device via the Experimental passcode. |
| `smd_thorex` | OFF | Its own words: needs GROQ + validation. Opens per device via the Experimental passcode. |

Both open **per device** today via the sidebar Experimental access code, so testers already reach them. Flipping the default makes them live for every user of the build.

## Everything, by module

### CliniX  <sub>5 ON · 2 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_clinix` | **ON** | CliniX clinical-learning module master flag. ON by default: the app ships only to the |
| `smd_clinix_draft` | **ON** | Render content that is not clinician-approved. ON by default because ALL CliniX content |
| `smd_clinix_haptics` | **ON** | Haptic feedback on lesson turns and answer checks (iOS native only). |
| `smd_clinix_tutor` | **ON** | MaiK tutor turns inside a lesson (Phase 2). Off = deterministic content only. |
| `smd_clinix_viva_voice` | **ON** | Spoken viva: MaiK speaks the question aloud (native TTS) and the student answers by |
| `smd_clinix_uncleared_media` | OFF | **NEVER, LEGAL.** The repo's own text: 'Authoring escape hatch: render media whose licence is not cleared. NEVER ship on.' |
| `smd_clinix_viva_tier` | `"mbbs"` | Viva difficulty tier (mbbs | pg). |

### FollowCare  <sub>6 ON · 2 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_followcare` | **ON** | FollowCare AI master flag |
| `smd_followcare_actions` | **ON** | Doctor Action Center (doctor↔patient messaging) |
| `smd_followcare_adaptive` | **ON** | Adaptive AI conversation (Phase 2). PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16) |
| `smd_followcare_ai_summary` | **ON** | AI doctor summary (Phase 2). PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16) |
| `smd_followcare_portal` | **ON** | Patient web portal |
| `smd_followcare_ui2` | **ON** | FollowCare premium UI redesign (v2) |
| `smd_followcare_sms` | OFF | **BLOCKED ON CONFIG.** Needs an SMS provider configured. On without it means failed or misdirected patient messages. |
| `smd_followcare_voice` | OFF | **BLOCKED ON CONFIG.** Needs per-hospital enable plus the voice service. |

### FundX  <sub>8 ON · 14 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_fundx` | **ON** | FundX master flag (home tile + module) |
| `smd_fundx_ar_guidance` | **ON** | AR overlays (arrows / ring / chips); off = camera + text coach only |
| `smd_fundx_autocapture` | **ON** | Auto-capture when diagnostic quality is held (off = manual shutter only) |
| `smd_fundx_clinical` | **ON** | Clinical advisory engine (post-acquisition). PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16) |
| `smd_fundx_corridor` | **ON** | Optical Corridor HUD (SVG spatial-AR acquisition overlay). Off = the legacy flat ring. PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on… |
| `smd_fundx_flash` | **ON** | Auto torch during capture |
| `smd_fundx_require_alignment` | **ON** | Phase 4 fusion: require native ARKit spatial alignment (on the optical axis) before auto-capture. Only tightens FSM capture timing; no-op unless spati… |
| `smd_fundx_upload` | **ON** | Workflow 2: analyze an existing/uploaded fundus image (same downstream as live capture) |
| `smd_fundx_a11y_contrast` | OFF | **OPT-IN.** Accessibility: high-contrast UI |
| `smd_fundx_a11y_cvd` | OFF | **OPT-IN.** Accessibility: color-blind-safe cues (tone icons, not colour alone) |
| `smd_fundx_a11y_large` | OFF | **OPT-IN.** Accessibility: large text |
| `smd_fundx_capture_threshold` | `60` | Manual capture-best-frame readiness % |
| `smd_fundx_cloud` | `null` | Cloud AI consent (null = ask once) |
| `smd_fundx_depth` | OFF | **INCOMPLETE.** Native ARCore/ARKit depth fusion. |
| `smd_fundx_dev` | OFF | **DEV TOOL.** Developer overlay + telemetry HUD. |
| `smd_fundx_gpu_preview` | OFF | **INCOMPLETE.** Full-res GPU camera preview. |
| `smd_fundx_lens_confirm` | OFF | **OPT-IN.** Optional operator lens-confirm fallback. |
| `smd_fundx_mode` | `"standard"` | Guidance verbosity mode |
| `smd_fundx_quality_warn` | `50` | Below-recommended quality warn % |
| `smd_fundx_sensors` | OFF | **INCOMPLETE.** IMU sensor fusion. |
| `smd_fundx_spatial_ar` | OFF | **INCOMPLETE.** True 3D AR corridor, iOS + ARKit only. |
| `smd_fundx_telemetry` | OFF | **PRIVACY DEFAULT.** Acquisition telemetry. No PHI, but off unless wanted. |

### Insulin  <sub>3 ON · 0 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_insulin` | **ON** | Insulin module master flag (home tile + module). DEFAULT ON (owner enabled). Hide with ?insulin=0. |
| `smd_insulin_dka` | **ON** | Clinician DKA insulin workflow. Access-gated. PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16). Hide with ?insulin_dka=0. |
| `smd_insulin_peds` | **ON** | Pediatric insulin workflow. Access-gated. PUBLIC-RELEASE-GATE: dev/testing default ON (owner 'flip all on' 2026-08-16). Hide with ?insulin_peds=0. |

### KardiQ X  <sub>11 ON · 5 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_kardiox` | **ON** | KardiQ X AI master flag (home card + module). OWNER DECISION 2026-08-26: def:true, so the module is live for every user of this build rather than only… |
| `smd_kardiox_acs` | **ON** | Optional ACS clinical-context panel on the result: add chest-pain / labs (troponin) / history -> validated HEART & TIMI scores + NSTEMI/STEMI decision… |
| `smd_kardiox_backend` | **ON** | Use the live KardioX pipeline backend (RemoteAnalyzer via /api/kardiox) instead of the on-device mock. Health-gated: falls back to mock if the pipelin… |
| `smd_kardiox_confidence` | **ON** | Always show the AI confidence % (Settings · Intelligence). |
| `smd_kardiox_feedback` | **ON** | Data flywheel: a consent-gated Confirm/Correct card on the result that stores clinician-labelled ECGs (label always; image only with consent) to build… |
| `smd_kardiox_haptics` | **ON** | Haptic feedback for taps / report-ready / urgent / quiz. |
| `smd_kardiox_image` | **ON** | Use the END-TO-END IMAGE model (Yale-style: reads the ECG photo directly, no digitiser) via the kardiox-image Cloud Run service. DEFAULT ON — the PoC… |
| `smd_kardiox_modellab` | **ON** | Model Lab (beta) kill switch. Allowed users (server-side admin allow-list) see the candidate 19-class model ALONGSIDE production (variant=compare) as… |
| `smd_kardiox_ondevice` | **ON** | Prefer FULLY ON-DEVICE analysis (offline, no PHI upload): image → on-device digitiser → ensemble, when the model pack is downloaded. PUBLIC-RELEASE-GA… |
| `smd_kardiox_ondevice_image` | **ON** | ON-DEVICE image model (ONNX Runtime Web): run the 19-class + MI-any models ENTIRELY on the phone — the ECG photo NEVER leaves the device (DPDP, no PHI… |
| `smd_kardiox_pdf` | **ON** | Digital ECG-PDF import (highest-trust path): import a vector/device ECG PDF (Apple Watch / KardiaMobile / 12-lead EMR export) -> exact signal to ECGFo… |
| `smd_kardiox_cloud` | `null` | Cloud ECG-analysis consent (null = ask once). Off = mock/offline only. |
| `smd_kardiox_demo` | OFF | **NEVER, SAFETY.** Makes Analyze return a CANNED FABRICATED result instead of real inference. Off is what guarantees a real answer or an honest 'unavailable'. |
| `smd_kardiox_dev` | OFF | **DEV TOOL.** Pipeline/timing overlay. |
| `smd_kardiox_learned` | OFF | **INCOMPLETE.** Segmentation-validation stage only; full signal reconstruction is the next increment. |
| `smd_kardiox_parity` | OFF | **DEV TOOL.** Runs a second analysis per image to measure on-device vs cloud agreement. Doubles work, dev diagnostic. |

### OPD Queue / Onco  <sub>22 ON · 0 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_onco_ctcae` | **ON** | CTCAE grading engine (P2): versioned reader over kb/onco/ctcae/catalog.json. Curated NCI CTCAE v5.0 adverse-event grades, each R1-flagged; v4.03 + un-… |
| `smd_onco_drugview` | **ON** | Onco drug + interaction view (P1): oncology-filtered list over MEDDRUGS + interaction checker, tall-man applied. Read-only, reuses the existing drug D… |
| `smd_onco_evidence_overlay` | **ON** | ONCQIS Phase C evidence overlay (onco-evidence.js): 3-layer evidence panel (core/guideline/institutional), UPDATE AVAILABLE guideline overlay, and per… |
| `smd_onco_favorites` | **ON** | Onco Home Favorites + Recent (P2): localStorage-backed star/recent list across Onco Home. Pure UX, no clinical content, private-mode safe. |
| `smd_onco_home` | **ON** | Onco Home reference workbench (P0): global search + tool grid over MEDCALC/KB/drugs. Read-only, no writes. |
| `smd_onco_iotox` | **ON** | IO toxicity (irAE) reference (P2): grade-based management PRINCIPLES by organ, grounded in ASCO/NCCN/SITC (cited by name). No doses/thresholds (fail-c… |
| `smd_onco_kb_admin` | **ON** | ONCQIS Phase J-a Knowledge Center INGESTION (admin/oncology): guideline upload + AI evidence extraction + batch Update Impact Report over ACTIVE Stand… |
| `smd_onco_navigator` | **ON** | ONCOTREE clinical navigator (oncotree.js): a deterministic disease pathway (phenotype -> applicable EXISTING Standard Protocols by reference). Decisio… |
| `smd_onco_protocols` | **ON** | Oncology treatment-plan engine (Protocol/Plan/Cycle/Administration). PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). Writes… |
| `smd_onco_protolib` | **ON** | EXPERIMENTAL grounded Standard Protocol library (v2 regimens in kb/protocols/ as lifecycleState:draft + experimental:true). When ON the onco workbench… |
| `smd_onco_protoref` | **ON** | Protocol reference library (P1): read-only browse of kb/protocols/index.json with lifecycle badges. Not for ordering/administration. |
| `smd_onco_recist` | **ON** | RECIST 1.1 response calculator (P2): real target-lesion sum -> percent change -> CR/PR/SD/PD with nadir + new-lesion handling. Reference calculation o… |
| `smd_onco_recommend` | **ON** | ONCQIS Phase B protocol recommendation engine (onco-recommend.js): suggests APPLICABLE ACTIVE Standard Protocols for a clinical phenotype and why. Dec… |
| `smd_onco_staging` | **ON** | AJCC/TNM staging engine (P1): versioned schema + version toggle. Seeded sites carry only a flagged generic TNM scaffold (R1-pending); other sites show… |
| `smd_onco_tallman` | **ON** | Tall-man lettering (P1) for oncology drug names in the Onco drug view (ISMP List of Confused Drug Names). Display-only. |
| `smd_opd_billing` | **ON** | Clinic operations BILLING station (lean MVP): patient registry + first-class orders + tariff + invoice + mark-paid (cashier role). UI at /clinic-billi… |
| `smd_opd_branding` | **ON** | Pro white-label clinic branding: upload a clinic logo (owner/admin + Pro) shown on the patient page, wall board + FollowCare with 'powered by StewardM… |
| `smd_opd_emr` | **ON** | Read-only OPD patient profile + reports (P1). PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). Read-only, so no write risk. |
| `smd_opd_emr_write` | **ON** | OPD write-back submit buttons (assessment + investigation orders live w/ QUEUE_EMR_WRITE; prescribe server-blocked). PUBLIC-RELEASE-GATE: def:TRUE for… |
| `smd_opd_queue` | **ON** | Smart OPD Queue master flag. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21); re-close or owner-gate before public release. |
| `smd_opd_queue_import` | **ON** | GHIS/EMR roster auto-import. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). Only imports when the session carries a GHIS t… |
| `smd_opd_queue_patient` | **ON** | Patient live tracking page. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). |

### SURGX  <sub>6 ON · 3 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_surgx` | **ON** | SURGX (Surgical Intelligence) master flag. ON for testers; the app ships only to the |
| `smd_surgx_dest_drive` | **ON** | Offer 'Google Drive' as a save destination for a finalised note. Native only (the |
| `smd_surgx_dest_emr` | **ON** | Offer 'Hospital EMR (GHIS)' as a save destination. Writes over the SAME verified |
| `smd_surgx_draft` | **ON** | Render content that is not clinician-approved. ON by default because the authored |
| `smd_surgx_haptics` | **ON** | Haptic feedback on protocol band reveal and note field confirmation (native only). |
| `smd_surgx_notes` | **ON** | Surgical Notes section. Additionally gated at runtime to clinician roles |
| `smd_surgx_mentor` | OFF | **OPT-IN.** Senior Surgeon Mode: MaiK challenge turns inside a case (Phase 2). Off = the case |
| `smd_surgx_notes_verify` | OFF | **OPT-IN.** Require a VERIFIED medical registration to author Surgical Notes. OFF by owner |
| `smd_surgx_uncleared_media` | OFF | **NEVER, LEGAL.** Same sentence, same rule: unlicensed images would render to users. |

### SknX  <sub>6 ON · 1 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_sknx` | **ON** | — |
| `smd_sknx_cloud` | **ON** | — |
| `smd_sknx_haptics` | **ON** | — |
| `smd_sknx_ondevice` | **ON** | — |
| `smd_sknx_realvision` | **ON** | — |
| `smd_sknx_rx` | **ON** | — |
| `smd_sknx_secure_egress` | OFF | **BLOCKED ON SERVER.** Same posture as ThoreX: needs the server-side proxy first. |

### StewardMD ID  <sub>2 ON · 0 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_steward_id` | **ON** | Verified-email / Apple-proxy anchor capture UI. ON by owner decision 2026-08-26. The ID itself was already minted on sign-in regardless (smd_steward_i… |
| `smd_steward_id_mint` | **ON** | Mint the universal StewardMD ID on sign-in. DEFAULT ON. |

### ThoreX  <sub>5 ON · 4 OFF</sub>

| Flag | Def | Why |
|---|---|---|
| `smd_thorex` | **ON** | ThoreX AI master flag (home card + module). OWNER DECISION 2026-08-26: def:true, so the module is live for every user of this build rather than only o… |
| `smd_thorex_backend` | **ON** | Use the live ThoreX pipeline backend (RemoteAnalyzer via /api/thorex) instead of the on-device path. HEALTH-GATED: /v1/health is probed first and it f… |
| `smd_thorex_confidence` | **ON** | Always show the AI confidence % (Settings · Intelligence). |
| `smd_thorex_haptics` | **ON** | Haptic feedback for taps / result-ready / urgent. |
| `smd_thorex_ondevice` | **ON** | Prefer FULLY ON-DEVICE inference (onnxruntime-web via thorex-ort.js) — no upload, runs in the WebView. Runs BOTH engines: Clinical Engine 1 (torchxray… |
| `smd_thorex_cloud` | `null` | Cloud analysis consent (null = ask once). Off = offline only. |
| `smd_thorex_demo` | OFF | **NEVER, SAFETY.** Same: a canned fabricated chest X-ray result instead of real inference. |
| `smd_thorex_dev` | OFF | **DEV TOOL.** Pipeline/timing overlay. |
| `smd_thorex_secure_egress` | OFF | **BLOCKED ON SERVER.** The proxy fails CLOSED with 503 until THOREX_ANALYZE_URL is provisioned. Turning it on breaks analysis. |

### Verification & account lifecycle (SERVER env / KV, not client flags)  <sub>1 ON · 2 OFF</sub>

Set in Cloudflare (env or the billing-cfg KV, which wins). These are not `localStorage` flags.

| Flag | Def | Why |
|---|---|---|
| `VERIFY_REQUIRED_FOR_PRO` | **ON** | Pro requires a verified NMC/SMC registration (`_entitlement.js` `isPro`). Set `0` to restore the pre-2026-08-27 launch-promo free-for-all with no deploy; `test/entitlement-trial.test.mjs` pins that path. |
| `VERIFIED_PRO_DAYS` | `7` | Length of the free Pro window a doctor earns by verifying. |
| `UNVERIFIED_PURGE_ON` | OFF | **DESTRUCTIVE.** Arms the 7-day unverified-account sweep. OFF = it reports what it would do and changes nothing. Warning emails send either way. |
| `UNVERIFIED_PURGE_HARD_DELETE` | OFF | **IRREVERSIBLE.** Second switch: with it OFF the armed sweep *disables* an account (recoverable); ON it deletes the Firebase user, orphaning saved cases / ICU membership. |
| `UNVERIFIED_PURGE_DAYS` | `7` | Age at which an unverified account is removed. |
| `UNVERIFIED_WARN_DAYS` | `5` | Age at which the single warning email goes out. Nobody is removed who was never warned. |

## Reading the defaults

- **ON does not mean released.** Many `def:true` entries carry a `PUBLIC-RELEASE-GATE` marker meaning the opposite of what it sounds like: they are open *for dev and testing* and must be **re-closed or owner-gated before a public release**. `queue-flags.js` says so at the top and tells you to `grep PUBLIC-RELEASE-GATE` and re-close every hit.

- **So the pre-release direction of travel is to close gates, not open them.** A request to "turn everything on" runs against what these files are for.

- `smd_surgx` and `smd_surgx_draft` both default ON *because the app is a tester build*, and `surgx-flags.js` says: FLIP BOTH TO FALSE BEFORE ANY NON-TESTER RELEASE. `smd_clinix` is the same by owner decision on 2026-08-23.


## A flag is not a switch: 14 of these cannot be turned on at all

Checked by finding every READER of each flag, not by reading its description. Two ways a flag can
be inert, and both were found here:

**Nothing reads them.** The name appears in its `*-flags.js` registry and nowhere else in the repo.
Editing `def:` changes nothing, ever — there is no code on the other side.

| Flag | Status |
|---|---|
| `smd_fundx_a11y_contrast` | no reader anywhere |
| `smd_fundx_a11y_large` | no reader anywhere |
| `smd_fundx_a11y_cvd` | no reader anywhere |
| `smd_surgx_mentor` | no reader — Senior Surgeon Mode is Phase 2, unbuilt |
| `smd_kardiox_dev` | no reader |
| `smd_thorex_dev` | no reader |

**They bypass the registry.** These read `localStorage` DIRECTLY (`fundx.js`, `fundx-sensors.js`),
so the registry default is never consulted. They are per-device toggles in FundX Settings, and the
only way to turn them on is on the device.

`smd_fundx_depth` · `smd_fundx_gpu_preview` · `smd_fundx_sensors` · `smd_fundx_spatial_ar` ·
`smd_fundx_lens_confirm` · `smd_fundx_telemetry` · `smd_fundx_dev`

**Why this matters beyond FundX:** a request to "turn on all flags" cannot be satisfied by editing
the registries, and a session that edited `def:` and reported success would be reporting something
untrue. Check the reader before promising a flag does anything.

## Turned ON on 2026-08-26 (owner decision)

| Flag | Was | Note |
|---|---|---|
| `smd_kardiox` | OFF | Module live for everyone, not only passcode-unlocked devices. **The clinical position is unchanged: still unvalidated and regulatory-pending.** `?kardiox=0` still closes it. |
| `smd_thorex` | OFF | Same. `GROQ_API_KEY` is provisioned (verified against the Pages secret list); the *validation* half of the original gate is still outstanding. |
| `smd_thorex_backend` | OFF | Safe because it is health-gated: `/v1/health` is probed and it falls back on its own if the pipeline is unreachable. |
| `smd_clinix_tutor` | OFF | Complete feature; the default was the only thing holding it back. |
| `smd_clinix_viva_voice` | OFF | **This one changes a stated property.** It was "a per-device student opt-in, never forced on". It is now on by default, so a student wanting a silent viva must switch it off. |
| `smd_steward_id` | OFF | Only controls the anchor-capture UI. The ID itself was already minted on sign-in (`smd_steward_id_mint`, long ON), so this adds a surface rather than changing identity behaviour. |

Three tests asserted the old defaults and were re-pointed, not deleted: each now asserts the new
default **plus** that the per-device escape hatch still works, which is the property that actually
protects a user.

## NOT turned on, and why

| Flag | Why not |
|---|---|
| `smd_thorex_secure_egress` | Would **break** chest X-ray analysis. `functions/api/thorex/[[path]].js` fails CLOSED with 503 until `THOREX_ANALYZE_URL` exists, and it is **not** in the Pages secret list. Provision it first, then flip. |
| `smd_sknx_secure_egress` | Same posture, same missing server side. |
| `smd_thorex_demo` | Makes Analyze return a **canned fabricated result** instead of real inference. |
| `smd_surgx_uncleared_media` | Renders media whose licence was never cleared. |
| `smd_kardiox_learned` | Segmentation-validation stage only; full reconstruction is unbuilt. Turning it on exposes unfinished work, it does not complete it. |
| `smd_kardiox_parity` | A dev measurement tool that runs a SECOND analysis on every image — doubles inference cost and time for no user-facing gain. |
| `smd_surgx_notes_verify` | Turning it on **restricts** rather than enables: `surgx-entitlement.js` reads `if (!flag(...)) return "allowed"`, so ON re-imposes the verified-registration requirement on SURGX Notes. |
| `smd_followcare_sms` / `_voice` | Need provider config; on without it means failed or misdirected patient messages. |
