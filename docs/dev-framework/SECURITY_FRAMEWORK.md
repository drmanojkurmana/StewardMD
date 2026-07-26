# StewardMD Security Framework
_Native security review system for StewardMD. Concepts adapted from the ECC reference repo (security-reviewer, security-scan, prompt-defense); **no ECC code/tooling/deps used**. This is documentation + a checklist that the `stewardmd-security-reviewer` agent applies. It executes nothing by itself._

StewardMD handles PHI-adjacent clinical data under an India-DPDP posture across a Capacitor web app, a native iOS shell + Watch app, and AI/ML services. Security priority order: **PHI/patient-safety > secrets/auth > data-at-rest/in-transit > logging/deps > release hygiene.**

Severity: **Critical** (PHI exposure, secret leak, auth bypass, plaintext transport of clinical data), **High** (weak storage, missing validation, injection surface), **Medium** (hardening gaps), **Low** (advisory). Report confidence ≥ 80.

---

## 1. Secrets Management
**StewardMD secrets:** `RESEND_API_KEY`, `APP_GATE_KEY` (native gate), `X-Admin-Token` (cron), `PIPELINE_TOKEN` (kardiox), Vertex/Firebase service creds, Cloudflare/Wrangler tokens, experimental-access hashed codes.
- [ ] No hard-coded keys/tokens/passwords in `www/`, `ios/`, `local-plugins/`, `functions/`, or committed configs. Grep patterns: `sk-`, `AIza`, `-----BEGIN`, `api[_-]?key`, `secret`, `token`, `Bearer `, 32+ char hex/base64 literals.
- [ ] Secrets only via env/Wrangler secrets/Keychain — never in the bundled `www/`, `capacitor.config.json`, or `Info.plist`.
- [ ] Client never holds Firebase `service_role`/admin creds; only public config.
- [ ] `.gitignore` covers `.env`, service-account JSON, `*.mobileprovision`; **pre-commit secret scan** recommended (gitleaks-style regex list maintained in-repo — not the ECC package).
- [ ] Env-var validation at startup: required keys present + shaped correctly; fail fast, don't log the value.
- **Red flags:** a token in `www/*.js`, a key echoed to console, secrets in a Capgo/OTA bundle.

## 2. iOS Security (native shell + WKWebView)
- [ ] **ATS**: `NSAllowsArbitraryLoads` false; any exception justified + scoped to a domain.
- [ ] **Keychain** for tokens/credentials (via `capacitor-secure-storage-plugin`), **not** `UserDefaults`/localStorage.
- [ ] **Secure Enclave** for biometric-gated keys where feasible (Face/Touch ID protected items).
- [ ] **Background snapshot privacy**: blur/replace the app UI on `applicationWillResignActive` so clinical data isn't captured in the app switcher snapshot.
- [ ] **Screen-capture/record**: consider detecting `UIScreen.isCaptured` and masking PHI during capture/mirroring.
- [ ] **Clipboard**: don't auto-copy PHI/Rx; if copied, prefer expiring/local-only pasteboard items.
- [ ] **WKWebView**: no `allowFileAccessFromFileURLs`/arbitrary JS bridges beyond the defined Capacitor plugins; validate messages crossing the bridge.
- [ ] Jailbreak detection (optional/defense-in-depth): treat as advisory, never the sole control.

## 3. Authentication
**StewardMD auth:** Google/Apple sign-in (required for watch-lab 24/7), Firebase auth, doctor-verification, experimental-access (one-code/one-device, hashed, atomic single-use, device binding), coming-soon `/realapp` cookie + `APP_GATE_KEY`.
- [ ] Token lifecycle: short-lived access tokens; refresh handled securely; no long-lived bearer in storage.
- [ ] Refresh-token rotation + revocation on logout; refresh not logged.
- [ ] Session: server-authoritative checks (Firestore rules / Functions), not client-trust; re-auth for sensitive actions.
- [ ] **Secure logout**: clears Keychain items, cached PHI, in-memory session, and any watch-synced session state.
- [ ] Biometric auth (if gating access): `LAContext` evaluated correctly; fall back to passcode; never store the biometric result as a bypassable flag.
- **Red flags:** device-binding bypass in experimental-access, gate token reuse, session persisting after logout, tokens in Firestore readable cross-user.

## 4. Networking
- [ ] **HTTPS only** for every endpoint (Cloudflare Pages/Worker, `kardiox-image` Cloud Run, Vertex, Resend, Firestore). No `http://`.
- [ ] TLS ≥ 1.2; no disabled cert validation; no `URLSession` delegate that blindly trusts.
- [ ] **Certificate pinning** recommended for the clinical API + model endpoints (pin to the CA/leaf; plan rotation) — advisory→high for PHI paths.
- [ ] Request validation: all params server-validated; the API gate (`APP_GATE_KEY`/admin/cron tokens) enforced server-side, not just client headers.
- [ ] No sensitive data in URL query strings (PHI, tokens) — bodies + headers only.

## 5. AI Security (MaiK/Vertex LLM, KardiQ X image AI, FundX, Whisper, OCR)
- [ ] **Prompt injection**: treat uploaded content (ECG/fundus images, OCR text, guideline PDFs, patient-typed notes) and any web/retrieved text as **untrusted**; never let it override system prompts or trigger tool/actions. MaiK system prompt hardened; user content clearly delimited.
- [ ] **PHI in prompts/telemetry**: minimize PHI sent to Vertex/OpenAI/Gemini; strip identifiers; honor DPDP consent + data-residency; no PHI in model-provider logs.
- [ ] **Sensitive-data leakage**: model outputs can't echo other patients' data; no cross-tenant context bleed; RAG/context scoped to the current user.
- [ ] **Unsafe logging**: never log full prompts/responses containing PHI or the raw uploaded image/audio; `loggingBehavior` = none in prod (was reverted debug→none — keep it).
- [ ] **Model misuse**: KardiQ X / FundX outputs framed as decision-support, not diagnosis; calibration + defer/`reviewRecommended` guards intact; no confident output on out-of-distribution/garbage input.
- [ ] **Input validation**: enforce image type/size limits before inference (reject oversized/non-image); Whisper audio length caps; OCR (EasyOCR) input sanitized; reject adversarial payloads.
- [ ] On-device Whisper: audio stays on-device where promised; no silent upload.

## 6. Medical Data Protection (at rest + cleanup)
Covers: Firestore, local cache, temp files, uploaded **ECG/fundus images**, generated **PDF reports**, **voice recordings** (MaiK Scribe/Whisper).
- [ ] Local at-rest PHI encrypted (Keychain/encrypted store); not in plaintext `localStorage`/`UserDefaults`/Documents.
- [ ] **Deterministic cleanup**: temp images/audio/PDFs deleted after use (use the job `tmp` pattern; wipe on logout + on task completion); no PHI left in caches or the Capacitor filesystem.
- [ ] Uploaded images/audio: retention policy defined; deleted from device + backend when no longer needed; not backed up to iCloud unless intended (`isExcludedFromBackup` for PHI temp files).
- [ ] Firestore: per-user/facility isolation via rules; no `CASCADE`-style loss of clinical records; audit trail on clinical CRUD.
- [ ] PDFs/reports: generated locally where possible; not left in a shared/cached dir; share-sheet exports are user-initiated.

## 7. Apple Watch Security
- [ ] **WatchConnectivity**: only non-PHI or minimally-necessary data over the session; validate/size-check transferred payloads; no secrets in `applicationContext`/`userInfo`.
- [ ] Data sync: watch mirrors only what's needed (lab values/alerts); clears on companion logout; no long-term PHI cache on the watch.
- [ ] **HealthKit**: request the minimum permissions; usage strings accurate; don't persist HealthKit-derived PHI beyond need.
- [ ] Background transfers: sized + rate-limited; failures don't leak; the `capacitor-watch-bridge` plugin validates messages both directions.
- [ ] Watch complications/widgets don't render PHI on a locked-screen surface beyond policy.

## 8. Logging Review
Detect and block in production:
- [ ] Patient identifiers (name/MRN/DOB), clinical values, Rx.
- [ ] API keys/tokens/bearer headers.
- [ ] Full stack traces / verbose errors shipped to users or persisted.
- [ ] Debug-only logging left on: `loggingBehavior` must be `none` in release; `FUNDX_DBG`/verbose device consoles gated to DEBUG builds only.
- [ ] Crash/analytics payloads scrubbed of PHI before send.

## 9. Dependency Review
Surfaces: `package.json` + `node_modules` (Capacitor + plugins), Swift/SPM packages, `local-plugins/*` (incl. `capacitor-whisper` whisper-cpp), and the separate Python backend (torch/onnx/easyocr — server-side, out of the app trust boundary).
- [ ] Outdated/vulnerable packages flagged (advisory list maintained in-repo; do **not** adopt ECC's npm audit tooling — use `npm audit`/`osv` locally as chosen).
- [ ] Unused + duplicate deps removed (bundle size + attack surface — see also the Performance Reviewer + the 25 MiB deploy limit).
- [ ] Pinned versions for anything in the PHI path; review transitive deps of new plugins.
- [ ] Native binaries (whisper-cpp models/libs) sourced from trusted origin + checksummed.

## 10. Release Security Checklist (every release)
- [ ] Production configuration active (no dev endpoints, no test flags).
- [ ] Debug flags OFF; `loggingBehavior` none; verbose/AI-debug consoles disabled.
- [ ] Secrets removed from bundle/config; only runtime-injected.
- [ ] Logging configured to scrub PHI; crash reporting configured + PHI-scrubbed.
- [ ] Privacy permissions reviewed (camera/mic/HealthKit/photos usage strings accurate + minimal).
- [ ] **`PrivacyInfo.xcprivacy` manifest** validated (required-reason APIs + data-collection declared); matches App Store privacy form and actual behavior.
- [ ] ATS/entitlements/associated-domains correct; APNs env matches build (sandbox vs production).
- [ ] Access gate (`APP_GATE_KEY`/`/realapp`/cron token) behaves for the target audience; experimental-access enforcement server-side.
- [ ] DPDP consent gate intact; data-residency honored; deletion path works.
- [ ] Recovery tag/branch + one-command rollback noted.

---
_Operationalized by `.claude/agents/stewardmd-security-reviewer.md`. Cross-refs: `docs/dev-framework/README.md` (workflow + release), `docs/privacy*`/`experimental-access` docs, and the clinical golden-regression gate (`stewardmd-clinical-reviewer`)._
