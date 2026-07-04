# StewardMD — Patient-Safety & Workflow Risks (P0 / P1)

_Senior-IM-physician QA pass, 2026-07-04. Tested via: local static serve (`:5173`) for UI/engine/console/storage/gate; **code inspection** for share/privacy/cases-API/AI-prompt safety; this session's earlier **bounded live-AI eval** for real answer wording. Not fully testable locally (backend absent, production data off-limits): real AI/vision responses, cloud save/share round-trip. **Update 2026-07-04:** the Firestore `sharedCases` rules were subsequently emulator-verified (see P1-2)._

## Summary
**No confirmed P0** (no PHI in URLs/localStorage/console; cases API is auth-gated + per-user; public share doc stores no email and no patient identifiers by design; AI answers hedge and carry an advisory). The risks below are **P1** — they must be resolved or explicitly accepted before a real clinical pilot.

**Status update (2026-07-04):** of the four P1s, **P1-1 is mitigated** (PHI guard + 7-char code shipped, `gold157`) and **P1-2 is verified secure** (Firestore rules emulator-tested — the enumeration concern did not reproduce). Remaining open: **P1-3** (full clinician-validated AI/vision eval) and **P1-4** (skip-first intro).

---

## P1-1 — Free-text PHI can be published to a publicly-readable share store — ✅ MITIGATED (gold157)
**Update (2026-07-04, shipped & live in `gold157`):** the recommended fixes are implemented in `caseshare.js` — a client-side PHI guard now **hard-blocks** a share whose content contains an MRN/UHID/IP-OP/registration number, Indian phone, 12-digit Aadhaar, or email (tested precise: `test/run-share-phi.mjs`); the share code is now **7 chars (~22 billion)**; and the note explicitly warns the link is public. Residual (unfixable in code): a clinician could still type a *bare name* into free-text — the guard deliberately doesn't fuzzy-match names to avoid false-positives, so the UI warning + reviewer discipline remain the control for names.
**Where:** `caseshare.js` → Firestore `sharedCases/{code}` (public read by code, 30-day TTL).
**Repro:**
1. Start a case; in any free-text finding type a synthetic identifier, e.g. `Ramesh Kumar, MRN 12345`.
2. Generate a decision → **Share case** → a `SMD-XXXXX` code + link is created.
3. The stored doc (`html`/`text`) now contains that free-text, readable by anyone with the code.
**Why it can harm:** the design intends de-identified content ("shares clinical findings & decision only"), but nothing *prevents* a rushed clinician from typing a name/MRN, and it's then written to a **publicly-readable** doc whose code space is only **~24.3 million** (`SMD-` + 5 chars from a 30-symbol alphabet) — brute-force enumerable if Firestore reads are unthrottled.
**Recommended fix (safe, additive):**
- Client-side PHI-pattern guard before share: if free-text matches name-like / MRN / UHID / phone / age-name patterns, block with "Remove patient identifiers before sharing." (deterministic, no medical-logic change).
- Lengthen the code to 7–8 chars (30⁷ ≈ 22 billion) to defeat enumeration.
- Reword the note from passive advice to an explicit gate: **"Shared links are public to anyone with the code. Never include patient names, MRN/UHID, or contact details."**

## ~~P1-2 — Share security depends on Firestore rules~~ — ✅ VERIFIED SECURE (2026-07-04)
**Status: RESOLVED / not a risk.** The `firestore.rules` were located (`firestore.rules`) and tested against the Firebase emulator (`test/firestore-rules/rules.test.mjs`, JDK 21). **All 11 guarantee checks pass on the current production rules** — including the enumeration test.
**Correction to the original finding:** this was initially flagged as a possible enumeration hole. The emulator **disproved it** — Firestore denies a `list`/query such as `where('expiresAt','>', now)` because the read condition references `resource.data` + the dynamic `request.time`, which the rule engine cannot satisfy for a query. So the current rules already:
- allow public read **only by exact code**, and only while unexpired (`resource.data.expiresAt > request.time`);
- **deny enumeration/listing** of the collection;
- allow `create` only for the signed-in owner (`ownerUid == auth.uid`), with TTL capped ≤ 32 days and payload ≤ 100 KB;
- allow `update`/`delete` **owner-only** (revocation supported);
- keep `users/{uid}/cases` private per user.
**Optional hardening (PR #223, not urgent):** make the no-enumeration guarantee explicit (`allow list: if false`) + ownership-immutability on `update`. Current rules are secure without it.

## P1-3 — AI / image-interpretation clinical accuracy is not validated at scale
**Where:** MaiK (`/api/ai/explain`), Vision (`/api/ai/vision`).
**Status:** the earlier bounded live eval (4 answers) showed appropriate hedging ("Educational clinical reference — verify with local protocol"), no diagnosis-as-certain, sources shown, and 92% clinical-element coverage — **encouraging but N=4**. Image interpretation (chest X-ray, unrelated/blurry/no image) was **not** tested (backend/quota). 
**Why it can harm:** an unvalidated AI/vision output relied on at the bedside could mislead. 
**Recommended:** before any pilot, run the full authenticated Tier-1 clinical eval + **clinician sign-off** (harness ready: `test/maik-eval/`); confirm vision degrades safely on wrong/blurry/no image (must never fabricate a read).

## P1-4 — Mandatory intro splash gates cold-start under time pressure
**Where:** `#introPoster` (3-phase AMR-awareness splash, "Skip Ns" countdown).
**Repro:** hard-refresh the app (doctors refresh often) → a full-screen 3-phase splash appears before any clinical tool. In testing, clicking **Skip** did **not** immediately dismiss it (stayed present; the button's visibility also toggles per phase).
**Why it can harm:** in the stated ICU/ED "2-minute" workflow, an awareness splash between the doctor and case entry costs time and reads as "app not loading" under stress.
**Recommended (needs owner OK — it's a brand feature, not a clear bug):** make **Skip** always visible and dismiss on first tap; auto-skip for returning/authenticated users; or show the splash once per device, not every load.

---
### Explicitly checked and found SAFE (no P0)
- No patient data in the URL, `localStorage` (only owner id + display/theme), or console logs observed.
- `/api/cases` verifies the Firebase ID token server-side (RS256), namespaces every case by uid, and returns **401** to unauthenticated callers — no cross-user case access.
- Public share doc stores the clinician **display name only** (explicit code comment avoids storing email) — not patient PHI.
- AI system prompts forbid presenting a diagnosis as certain and require an advisory; the deterministic engine (not the LLM) owns the diagnosis.
- Account gate is **non-blocking** — deterministic tools work offline without sign-in (good for poor-connectivity wards).
