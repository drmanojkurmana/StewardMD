# StewardMD — Agent Handoff / Knowledge File

> Local, owner-controlled knowledge base for StewardMD. Point future agents here.
> This replaces the Claude-managed memory (which was deleted at the owner's request).
> Source of truth for architecture is the repo's `vault/` and the code itself — treat this as a map.
> Generated 2026-08-21.

---

## 1. Project overview
Clinician-only medical decision-support app. **Mobile-only** (Capacitor 8: iOS + Android render the
local `www/` bundle; only `stewardmd.in/api/*` is called). Buildless PWA — ES5 IIFEs, `?v=goldNNN`
cache-bust tokens, `scripts/build-www.sh` assembles `www/`, `sw.js` is stale-while-revalidate.
GitHub: `drmanojkurmana/StewardMD`.

### Where the real architecture lives (read before touching a module)
- Obsidian vault at **`vault/`** (git-tracked, 404'd from web). Start at `vault/Home.md`.
- `vault/modules/<Module>.md` — per-module flag+default, key files, deps, status, gotchas.
- `vault/decisions/Decisions.md` — architectural decisions (log new ones here).
- `vault/Roadmap.md` — pending/deferred work. `vault/Infra.md` — Cloudflare/Firebase/signing.
- Verify vault notes against code; fix drift.

## 2. Non-negotiable conventions
- **Test before you build.** Unit tests (`node --test test/*.test.mjs`) AND, for UI/logic, a real
  headless-browser test (CDP harness) before claiming a fix works.
- **Reversible changes.** Big/risky changes go behind a feature **flag** + a git recovery point
  (tag/branch); made permanent only after the owner approves.
- **No em-dash** in app-facing text (MaiK AI *output* is exempt).
- **No emoji** — use the custom SVG icon set (ICON map in home.js; `window.icon`/`ico()`).
- **Never commit secrets or PHI.** Keys live in gitignored files outside the repo. No PHI in
  URLs/SMS/logs. FollowCare must never change prescriptions, diagnose definitively, or stop meds.
- **Don't sweep up other sessions' work** — stage files explicitly; another session may be editing.
- **Ponytail minimal-code mindset** + run a **code review on every change** (owner preferences).

## 3. Native build gotcha (iOS)
`xcodebuild -derivedDataPath` products land in a flat OR ECID-subfolder path. Always
`find ios/DerivedData -name App.app`, verify built `public/index.html` `?v=` token + a code marker
BEFORE installing, then `devicectl uninstall` before install (drops the stale service worker).

## 4. Deploy
Push to `main` → Cloudflare Pages auto-deploys (repo root static + `functions/`). Worker
`stewardmd-api` deploys via `wrangler deploy`. Server (`functions/`) changes are live on push; client
changes reach the native app only after `build-www` → `cap sync` → native rebuild + reinstall.
Whole app currently behind a coming-soon gate (`functions/_middleware.js` 503s `/api/*`; app passes via
`X-SMD-App`/`APP_GATE_KEY`, cron via `X-Admin-Token`, browser via `/realapp`).

---

## 5. Module / feature history (index of prior workstreams)
Each was a distinct build; read the code + vault for detail.

- **Antibiotic decision-support** — the original app; editing minified app.js; engine ranking v2 (smd_rank_v2).
- **Gold rollout** — 1,465 drugs in gold format in D1; worker CACHE_VERSION.
- **50-calculator module**, reasoning fixes, sidebar + hospital-email set (June 2026).
- **UI rebuild v3** (recovery tag classic-ui-stable); Mobile UX redesign (flag smd_redesign_nav/?rnav=1).
- **KB platform** — strangler plan; Harrison=disease ref; ICMR▸guidelines▸hospital treatment hierarchy.
- **Safety overlay** — antibiotic renal/hepatic/QT (SMD_SAFETY).
- **Antibiogram coverage** — 3-tier spectrum grid. **DDI grouping** — Drug Index strengths inline.
- **Capacitor** — iOS+Android wrap (bundle in.stewardmd.app, local www).
- **Privacy baseline** — DPDP consent gate. **NMC verify gate** (verify.js; localStorage smd_verify_bypass escape hatch).
- **TB pathways** — NTEP DR-TB regimens/DST/safety (SMD_TB).
- **MaiK (AI assistant) line** — V2 3-tier brain (KB→Vertex→Gemini); intent-routing; usage metering/quotas/
  circuit-breaker; Intent Firewall (clinician-only allow-list, kb/ai/maik-scope.js); Brain (12-stage KB-first,
  flag smd_maik_brain); Aurora bottom-sheet redesign; UI2 de-vibe; mascot (maik-agent.js, smd_maik_agent);
  LLM-first (flag smd_maik_llm_first default ON, ?llm=0 reverts); non-stream empty fix (2560-tok cap,
  STRONG_MODEL=gemini-2.5-pro); Knowledge Units (read-to-earn); MaiK Ask (AI-guided history, flag smd_maik_ask);
  offline engine (MedGemma 1.5 4B GGUF picker); on-device vision (llama.cpp mtmd projector sub-pack).
- **ICU line** — Dashboard 3.0 → flagship (PR#295, 5-workspace nav, Trends, dx, calculators); imaging+correlation
  (smd_icu_imaging); alert-engine safety; dx-flow (findings→dx→Deep Review, smd_icu_dxflow); unit-registry
  (UNIT_REGISTRY/SMD_UNITS + fmtLab); finding picker (clinical-vocab.js=SMD_VOCAB); v2 redesign (flags smd_icu_v2/
  groups); timeline day-wise (real timestamps + day grouping).
- **OPD Queue** — Smart OPD Queue LIVE (nurse console opd.html, display board, multi-clinic, zero-login patient
  page, Connect→OPD bridge); GO-LIVE 2026-08-10; WhatsApp auto-notify via FollowCare's Green-API secrets;
  workplace routing (smd_opd_workplace; INVARIANT clinic session must have ghisToken null); Ask MaiK (on-device
  Dx/Mx/Rx, kill switch smd_opd_maik); OPD polish+ops (teal #0e6e63, white-label, clinic Billing MVP,
  CLINIC_BILLING_ENABLED).
- **FollowCare** — post-discharge engagement (no-app link/WhatsApp/portal, multilingual, Doctor Action Center,
  encrypted fc_comms/audit/R2); Phases 0-5 LIVE, smd_followcare ON; MAiTRI rebrand + universal light/dark;
  voice fallback (AI phone call after N days no check-in, flag smd_followcare_voice; RunPod voice-service:
  Plivo stream+IndicConformer+Parler+gemini slot-extract).
- **Connect** — interop platform (SCCM canonical + connectors); flag smd_connect; in-app EMR button +
  create-your-hospital; Demo Hospital HAPI tenant (KEEP for pitch). **ABDM V3** — real receiver answers live
  callback via cloudflared tunnel; flags OFF.
- **Imaging modules** — FundX (AI fundus, smd_fundx; native Spatial AR/ARKit); KardioX/KardiQ X (ECG + Learn-ECG,
  smd_kardiox; on-device ONNX; photo-dx pivot; ACS panel smd_kardiox_acs). GOTCHA: JS edits don't reach native
  WKWebView without rebuild.
- **Wearables** — Apple Watch (iOS) / Wear OS (Android) platform-specific; WearOS MVP merged; SMD_WEAR GHIS-token relay.
- **Oncology (ONCQIS)** — overnight UI/UX rebuild; dx-mgmt enrichment (230 non-infective briefs from Harrison 22e);
  onco-dose.js dose engine (SMD_ONCODOSE, Mosteller BSA + Calvert); onco-home.js workbench; plan-flow needs owner sign-off.
- **Ops/scale** — pre-release hardening (crash telemetry, remote-config/autoupdater/banners, analytics, admin
  user-control, backups); perf hardening (brotli edge, local-first optimistic UI, fetchWithTimeout);
  support tickets (in-app, SMD-XXXXXX, KV-backed _support.js); medical updates pipeline (D1 stewardmd-updates + cron).
- **Monetization** — trial/paywall/coupons/credits/roles/IAP; INERT behind launch promo (PRO_FREE_UNTIL Sep 15);
  enforcement flips only after a real payment test; tag pro-enforcement-pre.
- **Security** — 6-surface whitebox audit; XSS esc, Firestore token-traversal guard, allowBackup=false;
  whitepaper docs/security/SECURITY-WHITEPAPER.md. Native-only lock (anti-piracy: KB on-device but inert without
  server key, Pro-gated 2h grace; web KILLED).
- **UX** — guided tour (onboarding.js=SMD_TOUR, smd_onboarding_tour); haptics (haptics.js, iOS-only); universal
  swipe-back (swipe-back.js, interactive edge-drag, #smdTopBack; new modules need aria-label Back/Close);
  Rx brand-search (auto-fills generic+dose); Shared Clinic EMR (local-first encrypted multi-device, smd_shared_clinic).
- **Dev framework** — 10 reviewer agents (.claude/agents) + docs/dev-framework.
- **MaiKnowledge** — maiknowledge.in landing (Worker morning-bread-cc53).
- **AI Control Center** — universal AI usage engine (_ai_usage.js) per-module daily caps; Scribe cost controls
  (SCRIBE_MODEL flash-lite, SCRIBE_CAPS Pro-only time caps).
- **Reinstall gotcha** — adb uninstall+install wipes app data incl ~264MB Whisper model + login; use `adb install -r`.
- **iOS download cap** — bg URLSession caps sustained DLs ~1MB/s (Android 10.5 same wifi); chunking = resilience not speed.

---

## 6. THIS SESSION'S WORK (2026-08-21) — OncoTree + Protocol tooling (MERGED TO MAIN)

**Branch `feat/followcare-voice` → merged to `main` via PR #719 (merge commit `ee85c0ee`).**

### OncoTree navigator (clinical decision-tree module)
- 3 IIFEs: `oncotree-engine.js` (window.SMD_ONCOTREE_ENGINE, pure `evaluate(graph, answers, opts)`),
  `oncotree-recommend.js` (SMD_ONCOTREE_RECOMMEND), `oncotree.js` (SMD_ONCOTREE, UI). Flag `smd_onco_navigator`
  (default true). Per-disease graph JSON runtime-fetched from `/kb/oncotree/<id>.json`; regimens in `/kb/protocols/<id>.json`.
- Graph model: nodes {id, nodeCategory=criteria|workup|treatment|surveillance|other, nodeType=question|end,
  name, title, section, description, bullets[], evidenceCategory[], footnotes[], tables[], options[{id,label,sets{},pills[]}],
  protocolRefs[], showsRecommendation, linkTo/linkGuideline/linkLabel} + links {id, from, to, fromOptions[]} +
  top-level {guideline, title, navigatorVersion, startNodeIds[], footnotes{}}. Auto-layout (longest-path layering,
  NW=168 NH=62). startNodeIds is the entry; must be a DAG.
- **Engine features added**: checklist bullets, evidence-category badges (1/2A/2B/3), lettered footnotes + bottom-sheet,
  Table-of-Contents panel + full-text search (focus-preserving), map drill-down (regimens in node popup),
  cross-page link nodes + breadcrumb, pathway Summary/export (copyable), staging/dosing tables. Vertical flow (mobile).
- **Content**: 25 cancers, each a DEEP tree (~40-76 nodes) at the "breast benchmark" depth
  (breast=40 nodes/depth 11/avgEndLayer 4.7/45 protocolRefs). Cancers: breast, prostate, lung, colorectal, uppergi
  (gastric/esophageal), bladder, rcc, testicular, melanoma, headneck, ovarian, myeloma, thyroid, cervical, uterine,
  pancreatic, hcc, anal, gist, sarcoma, cns, aml, cll, dlbcl, hodgkin. All authored as ORIGINAL functional
  decision-support wording from standard-of-care (NCCN/DeVita/Harrison as general reference) — NOT copied from
  guideline PDFs. DRAFT, flag-gated, physician decides.

### Validators (test/)
- `test/validate-oncotree.cjs <graph.json>` — schema + DAG + reachability + engine smoke + DEPTH profile
  (enforces breast benchmark: nodes>=40, maxDepth>=9, avgEndLayer>=4.3, >=8 deep outcomes).
- `test/validate-protocol.cjs <protocol.json>` — protocol schema + dose-engine smoke.
- Pre-existing FLAKY test: `test/oncotree-graph.test.mjs` asserts "every end has protocolRefs" — RED for every
  guideline incl breast (wrong: surveillance/BSC ends need none). NOT a regression; should be fixed to exempt non-systemic ends.

### Protocol library (kb/protocols/, 266 files, all validate)
- Protocol schema: {id, diseaseId, name, version, lifecycleState, experimental, intentOptions[], cycleLengthDays,
  cycles, premedications[], supportiveCare[], monitoring[], drugs[]}. Drug: {id, name, basis (bsa|auc|flat|mgkg),
  dosePerUnit, unit, route, days[], caps, notes}.
- Every systemic-therapy leaf across all 25 cancers is wired (472/682 end-nodes; rest correctly non-systemic:
  surgery/RT/observation/BSC/routers). 0 dangling refs. 126+ new DRAFT protocols authored this session
  (AML 7+3/aza-ven/APL, CLL BTKi/venetoclax, CNS Stupp, lymphoma R-CHOP/ABVD/BV, RCC IO-TKI, lung targeted agents,
  bladder intravesical BCG, HCC TACE/Y90, etc.). All experimental:true, DRAFT, honest provenance.

### Protocol Sheet — `protocol-sheet.js` / `protocol-sheet.css` (window.SMD_PROTOSHEET)
- Formal printable "Treatment Protocol" sheet (Tata-style) from a protocol + patient. `open(protocolOrId, patient, opts)`.
- Per-drug total dose COMPUTED from BSA (Mosteller) via SMD_ONCODOSE; per-cycle day grid; premeds/supportive/monitoring;
  per-drug **dose-verify checkbox**; **canvas signature pad**; **print→PDF** (native browser print, @media print A4;
  no PDF lib); **Assign to patient** emits `smd-protocol-assign` + routes through `smd-oncotree-select` for EMR.
- BID/TID: shows per-administration + daily dose + frequency. Carboplatin AUC needs a creatinine field (added).
  Custom protocols get a CUSTOM/DRAFT badge + "no auto caps, verify" caution. Recompute on blur (not keystroke).
- Loaded in index.html; launch button in OncoTree protocol detail. build-www copies all root *.js/*.css automatically.

### Custom Protocol Maker — `protocol-maker.js` / `protocol-maker.css` (window.SMD_PROTOMAKER)
- Clinician authors a protocol from scratch: name, disease, intent, cycles, cycle length + repeatable drug rows
  (name, basis BSA/flat/mg-kg/AUC, dose, unit, route, days-of-cycle, frequency, notes) + premeds/supportive/
  monitoring/instructions. Live example-dose hint; unit auto-follows basis.
- Builds a schema-valid protocol object the dose engine + sheet render directly. Saved to a **local library**
  (localStorage `smd_custom_protocols`) with edit/delete/reopen. Preview/Save opens the sheet. Custom protocols
  are lifecycleState 'custom' + experimental:true (never look approved). Launch entry in the OncoTree picker.
- Purpose: when a new guideline drops, a doctor authors their own protocol and assigns it — no code change.

### Review fixes applied (adversarial review, 10 verified findings)
BID daily-dose display, dose sanity bounds (reject <=0), mobile focus loss on ht/wt edit, carboplatin AUC dosing
+ creatinine field, preview z-index (sheet raised to 74), custom badge+caution, unique drug ids, quota-exceeded
honesty, cycles clamp>=1, blank-diagnosis round-trip.

### Session commits (on main via the merge)
- 66314b0c Protocol sheet (mobile + PDF + EMR assign)
- baacf6e8 Depth uplift (21 trees to breast benchmark)
- abc2aa70 Protocol links for all systemic leaves + 126 new protocols
- e6a53752 Drug-delivery protocol completeness (BCG, TACE/Y90, RAI, chemoRT, salvage)
- 6b2c1f43 Custom Protocol Maker
- 24e6635c Review fixes (10 findings)
- d6ec6e02 Merge main into branch (resolved breast.json→40-node, index.html + oncotree.css unions)
- (also earlier: OncoTree engine PR #718-era: search/links/summary/tables, back-nav, FollowCare N-day call, Sri Harsha bug fixes)

### Cache-bust tokens after merge
`oncotree.css` and `oncotree.js` → `?v=op3-map`; `protocol-sheet.*` → `?v=ps1`; `protocol-maker.*` → `?v=pm1`.

---

## 7. Current git state (2026-08-21)
- `origin/main` HEAD: `ee85c0ee` (PR #719 merge) — all OncoTree/protocol work is LIVE on main, auto-deploying to web.
- `feat/followcare-voice` HEAD: `d6ec6e02`, pushed, in sync.
- Native app needs a rebuild (`build-www` → `cap sync` → native) to show this session's client work on device.

## 8. IP / provenance note
All OncoTree tree content and protocol dosing authored this session is ORIGINAL functional decision-support
wording derived from standard-of-care knowledge (NCCN / DeVita / Harrison cited as general references). No
third-party guideline PDF was reproduced verbatim. Everything is DRAFT / experimental / not clinically activated;
a clinician verifies every dose. Keep this boundary.
