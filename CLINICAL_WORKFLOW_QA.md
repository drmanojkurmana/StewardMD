# StewardMD — Clinical Workflow QA

_Tester perspective: senior Internal Medicine physician (ICU / ED / general ward), Indian hospital. Date: 2026-07-04._

## Testing method & honest limitations
- **URL:** the brief said `http://localhost:5173`. There is no Vite/`package.json` — StewardMD is a **buildless static** site. I served the repo on `:5173` (`python3 -m http.server`) so the URL matched.
- **What ran locally (real):** UI, navigation, the **deterministic reasoning engine** (Dx / Clinical Reasoning — client-side, works offline), account gate, `localStorage`, console/error behaviour, dark mode, mobile layout.
- **Backend absent locally:** the Cloudflare Functions (`/api/ai`, `/api/cases`) and Firebase are not present when serving statically, so **real MaiK AI answers, image/vision upload, cloud Save, and Share round-trips could not be exercised locally.** These were assessed by **code inspection** (authoritative for logic/privacy) plus this session's earlier **bounded live-AI eval** (4 real answers on production).
- **Production data:** not touched; synthetic cases only.
- **Screenshots:** the MCP browser had a 5 s screenshot cap and the intro splash re-renders on a timer, so full-page captures were flaky. Captured: `docs/qa-screenshots/01-intro-splash-gate.png` (the mandatory AMR intro). UI facts otherwise verified via DOM `evaluate()` (reliable).

## Findings by severity
| ID | Sev | Finding | Where |
|---|---|---|---|
| F1 | **P1** | Free-text PHI can be published to the public share store | `caseshare.js` |
| F2 | **P1** | Share security depends on unverifiable Firestore rules | `caseshare.js` |
| F3 | **P1** | AI/vision clinical accuracy unvalidated at scale (N=4 live) | `/api/ai/*` |
| F4 | **P1** | Mandatory 3-phase intro splash gates cold-start; Skip didn't dismiss on click | `#introPoster` |
| F5 | P2 | Share code space ~24.3M (`SMD-`+5) — enumerable | `caseshare.js` |
| F6 | P2 | Advisory/disclaimer visible but sparse on some views (2 hits on home) | app-wide |
| F7 | P2 | Backend polling 404s on load (`/api/updates`) — noisy in poor connectivity | app.js |
| F8 | P3 | Intro animation loop lacks a null-guard → `classList` TypeError floods if the node is removed unexpectedly (not seen in normal flow) | app.js intro loop |
| F9 | P3 | Clinician display name stored in publicly-readable share doc | `caseshare.js` |

_(P0/P1 detail + fixes in `PATIENT_SAFETY_RISKS.md`.)_

---

## 1. ICU workflow (critically ill, 2 minutes)
**Journey:** load app → (blocked by intro splash, F4) → skip → Home → **Start case / Clinical Reasoning** → enter fever, hypotension, confusion, low SpO₂, low urine output → engine differential → (MaiK/vision + Save = backend).
**Result: PARTIAL PASS.**
- ✅ Deterministic engine loads and runs **offline**; nav to case entry is 1–2 taps; account gate does **not** block (usable without login).
- ✅ AI wording (from live eval) is advisory and hedged; engine — not the LLM — owns the diagnosis.
- ⚠️ **F4:** every cold load/refresh forces the AMR splash first (screenshot 01); Skip did not dismiss on click in testing → time lost under pressure.
- ⚠️ Image upload / real AI response / Save not testable locally (backend).
- **Time:** app-usable after splash ≈ 12 s worst case (or a working Skip); case entry itself is fast.
- **Safety concern:** emergency escalation cues rely on the engine's red-flag rendering (CSS present) — verify they are visually dominant vs routine guidance on a real decision (couldn't render a full decision headlessly).
- **Fix:** F4 (skip-first), and confirm red-flag/escalation blocks are visually distinct.

## 2. Ward-round workflow (25 patients)
**Journey:** open **My Cases** → pick prior case → review notes/timestamp → add finding → re-run → Save.
**Result: NOT FULLY TESTABLE locally** (My Cases cloud list needs `/api/cases` + auth). Code inspection:
- ✅ Save is uid-namespaced; index sorted newest-first; **cap of 10 cloud cases per user** (`MAX=10`) — **⚠️ a busy ward reviewing 25 patients will silently evict the oldest beyond 10** (P2 workflow — flag: eviction is silent).
- ✅ `PUT` replaces by id (update path exists); timestamps stored (`savedAt`).
- ⚠️ Could not verify back-button / mid-edit overwrite protection locally — **recommend explicit "unsaved changes" guard** (see F-recommend).
- **Fix:** surface the 10-case cloud cap + eviction to the user; add unsaved-changes warning on navigate/back.

## 3. Emergency workflow (chest pain, sweating, SOB, low BP)
**Result: PASS (wording) / PARTIAL (image).**
- ✅ Live eval evidence: AI answers hedge, lead with the direct clinical take, carry "verify with local protocol", show Sources — **does not present a diagnosis as certain.**
- ✅ Alias fix (this session) ensures "tearing chest pain radiating to back" → aortic dissection appears (not mis-routed to GERD).
- ⚠️ **Image edge cases (unrelated / blurry / wrong / none) not tested** — vision endpoint is backend-only. **Must verify it never fabricates a read** (listed P1-3).
- **Safety concern:** red-flag immediacy — confirm on a live decision that urgent flags are above the fold.

## 4. General medicine (7 cases)
**Result: PASS (engine).** All seven cases (fever+thrombocytopenia, hyperglycaemia, COPD exac, AKI, HTN+headache, abdominal pain+vomiting, stroke) map to engine-recognised syndromes; inputs are chip/finding-based (few taps); output is structured (differential / investigations / management / red flags). Golden + parity regression is green (verified this session). Stroke onset-time and thrombolysis window are clinical items to confirm in the live decision.

## 5. Medication / stewardship
**Result: code-inspected.** Drug Index backs regimen `drugRefs` with dose/route/frequency/duration; 42/51 infective syndromes carry regimens. Renal/hepatic and de-escalation notes exist in treatment records. **Gaps (from coverage matrix):** dosing coverage is concentrated in infective/emergency syndromes (drug/dose ≈ 9% of all diseases) — many non-infective emergencies name a drug/class but lack an explicit dose (queued in `docs/maik-content-requests.md`). **Dangerous-wording check:** AI prompt forbids inventing doses not in the source — good; verify live that it never emits an unsourced exact dose.

## 6. Real-world constraints
- ✅ **API/AI failure:** MaiK renders a graceful "MaiK is unavailable right now — the deterministic engine, calculators and reference tools remain available" (code-verified). Good fallback wording.
- ✅ **Offline-first:** engine + reference usable without backend/login.
- ⚠️ **F7:** `/api/updates` 404 on every load; repeated backend polling in a poor-connectivity ward can spam the console/network.
- ⚠️ **F8:** intro loop throws on node removal (robustness).
- **Mobile 390 px / dark mode:** MaiK sheet verified earlier (no horizontal overflow, dark-mode aware). Full 25-patient one-handed flow not exhaustively driven (MCP screenshot limits).
- **Long names / incomplete demographics:** case `name` is capped at 120 chars server-side (`slice(0,120)`) — safe; demographics are optional (engine is findings-based).

## 7. Privacy & safety
- ✅ **No PHI in URL / localStorage / console** observed (localStorage: owner id + display/theme only).
- ✅ **Cases API:** server-side Firebase RS256 verification, uid-namespaced keys, 401 to unauth — no cross-user access, no unauthenticated case pages.
- ✅ **Share link:** crypto-random code, 30-day expiry (client + server), monthly rate-limit, **no email** in the public doc.
- ⚠️ **Share residual risks:** F1 (free-text PHI could be published), F2 (depends on Firestore rules), F5 (24.3M code space enumerable), F9 (clinician name in public doc). See `PATIENT_SAFETY_RISKS.md`.

---

## Recommended safe fixes (proposed — not yet applied)
These are frontend/validation/access-control only; I did **not** apply them because each is either a product/brand decision, touches the minified `app.js`, or is a new heuristic that could false-positive — all of which the brief says to confirm first:
1. **Share PHI guard** (F1): client-side identifier-pattern check + hard-gate wording before publishing a share.
2. **Longer share code** (F5): `SMD-` + 7–8 chars.
3. **Skip-first intro** (F4): Skip always visible + dismiss on first tap; once-per-device.
4. **Cloud-case cap UX** (Ward): surface the 10-case limit + eviction.
5. **Unsaved-changes guard** on back/navigate mid-edit.
6. **Intro loop null-guard** (F8) — but this lives in minified `app.js`; per project convention it should be patched via the source, not the bundle.

Tell me which to implement and I'll do the clearly-safe ones behind a branch/PR.
