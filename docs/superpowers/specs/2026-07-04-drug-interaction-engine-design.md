# Drug Interaction Engine — Architecture Audit & Design Spec

**Date:** 2026-07-04
**Status:** Design for review (no code until approved)
**Decisions locked:** engine-first sequencing · curated-open + class-based ruleset

---

## 1. Current architecture audit

| System | State | Reuse |
|---|---|---|
| Drug index | D1 `drugs` (composition=generic, brand, class, chem_class, action_class, form, manufacturer, mrp, discontinued) + FTS5 + worker API `/search`,`/brand-search`,`/composition`,`/drug/:id`,`/suggest` (`api.stewardmd.in`) | Drug identity + brand→generic + class resolution |
| AI/OCR | `functions/api/ai/[[path]].js` — **existing `/api/ai/vision` `{image,kind}→{fields}`** (Gemini 2.5 Flash, Vertex→Developer failover) + `/explain`. Design is already "rule engine first, AI only explains." | OCR extraction (new `kind`) + explanation layer |
| Ward Sync / GHIS | `functions/api/ghis/[[path]].js` — per-doctor GHIS login, KV sessions, AES-GCM creds, endpoints `patients/lab/radiology`. **No patient data persisted.** | Add one `medications` endpoint on the existing authorized session |
| Storage / My Cases | `functions/api/cases/[[path]].js`, Firebase-auth, account-scoped | Save interaction reports per-user |
| Interaction engine / dataset | **Does not exist** | Build (this feature) |

**Conclusion:** all substrates exist except the interaction engine itself. Nothing here requires new auth, new AI infra, or new storage primitives.

## 2. Drug-index data model — supports this feature?

Yes. `composition` = the generic/molecule (already splits combos as `"A (x) + B (y)"`), `brand` = brand name, and `class`/`chem_class`/`action_class` give the pharmacologic taxonomy the class-based rules need. Brand→generic and class lookup run against the existing worker API/FTS. Gap: no explicit "ingredient list" normalization — we add a small parser that splits `composition` into structured ingredients (drug + strength).

## 3. Interaction ruleset schema (curated-open + class)

Versioned JSON asset, clinician-reviewed (reuse the existing KB clinician sign-off workflow). Engine runs **client-side** (like the existing clinical rule engine).

```jsonc
// interaction-rules.json  (versioned; each rule auditable)
{
  "version": "2026.07.04.1",
  "sources": [{ "id": "onc-hpddi", "title": "ONC High-Priority DDI List", "org": "ONC/NLM", "version": "...", "license": "public" }, ...],
  "rules": [{
    "id": "ddi_warfarin_nsaid",
    "type": "pair | duplicate_generic | duplicate_class | combination | context",
    "subjects": [{ "kind": "generic|class", "value": "warfarin" }, { "kind": "class", "value": "NSAID" }],
    "severity": "contraindicated | major | moderate | minor | monitor",
    "mechanism": "…plain clinical language…",
    "clinical_effect": "↑ bleeding risk",
    "action": "avoid / separate / monitor …",
    "monitoring": "INR, signs of bleeding",
    "dose_timing_separation": false,
    "specialist_review": false,
    "source_id": "onc-hpddi",
    "evidence_level": "…",
    "review_date": "2026-07-04",
    "local_override": null
  }]
}
```

Rule families covered at launch (matches prompt priorities): drug–drug pairs (open list), duplicate generic, duplicate class, and N-way **combination** rules — bleeding (anticoag+antiplatelet+NSAID), triple-whammy (ACEi/ARB+diuretic+NSAID), multiple QT-prolongers, opioid+benzo, serotonergic, nephrotoxic, hyperkalemia, hypoglycemia, CNS-depression, seizure-threshold, RAAS duplication. Context rules (renal/hepatic/QTc/K+/pregnancy) fire **only** when that context is explicitly present.

**Engine contract (isolated, unit-testable):**
`checkInteractions(medList, context?) → { critical[], major[], moderate[], monitor[], duplicates[], combinations[], reviewedCount }` — a pure function over normalized meds. No network, no AI.

## 4. OCR / photo / PDF pipeline

1. Client compresses/resizes image (canvas → ~1600px longest edge, JPEG ~0.7); strips EXIF.
2. PDFs: extract text locally first (pdf.js); only render pages to images if scanned; cap page count with progress.
3. POST to existing `/api/ai/vision` with a new `kind: "medication_list"` (+ prompt) → returns **candidate rows only** `{detected_text, generic, strength, route, frequency, confidence, page}`.
4. Mandatory **review screen** — nothing is added without clinician confirmation. Low-confidence/handwriting flagged with alternatives.
5. No raw image/PDF retained after extraction unless explicitly saved to an authorized case; never logged.

## 5. Ward Sync / GHIS integration (incl. Medication History import)

Safest feasible approach (no new auth, no scraping outside the session): add `GET /api/ghis/medications?patient=<id>` to the existing Function. It uses the doctor's authorized session, fetches the patient's **Medications→History** page, parses rows **server-side**, strips PHI (name/MRN/UHID/bed/clinician/billing), and returns only medication fields + internal source metadata. Combination products (e.g. `"ROSUVASTATIN 20MG & FENOFIBRATE 160MG"`) split into two ingredients linked to one GHIS order. Consumables excluded to "Needs review." Client shows the review screen (recognized / expanded / needs-review / consumables-excluded) before anything enters the list. Deterministic parse first; AI only for low-confidence mapping, sent **de-identified**.

## 6. Privacy / storage model

- Guest → temporary **local-only** (sessionStorage); cleared on logout.
- Logged-in → saved only under the Firebase user via `functions/api/cases`.
- GHIS/scan data never persisted server-side; no PHI, no raw images/HTML/OCR/prompts in analytics or logs.
- Ward Sync data bound only to the explicitly selected authorized patient; cleared on patient-switch/logout.
- "Save/Share/Export/Attach" always scoped to current authenticated user.

## 7. Files to change (per PR — additive; no existing clinical/MaiK/privacy logic modified)

- **New:** `medlist.js` (list builder UI), `interactions.js` (engine), `interaction-rules.json` (ruleset), `interactions.css` if needed.
- **Entry points (additive edits):** `drugs.js`, `calculators.js`, `icu.js`, `ghis-ward.js`, `home.js` (button wiring only).
- **OCR:** reuse `/api/ai/vision` (+ new `kind`) — small server prompt addition.
- **GHIS:** add `medications` route in `functions/api/ghis/[[path]].js`.
- **Save:** reuse `functions/api/cases/[[path]].js`.
- **Tests:** `test/run-interactions.mjs`, `test/run-medlist-parse.mjs`, `test/run-ghis-meds.mjs`.

## 8. Risks / licensing / gaps

- **Curation burden:** open ruleset is not exhaustive for every minor pair; we prioritize clinically-meaningful/high-risk and label "No *known* significant interaction in current dataset" (never "safe"). Needs clinician sign-off (reuse KB workflow).
- **Licensing:** use only open/permissioned sources (ONC/NLM HPDDI, openFDA labeling, CredibleMeds QT). No proprietary DB scraping. Source manifest + review dates stored per rule.
- **OCR/handwriting** accuracy is imperfect → always clinician-reviewed, never auto-added.
- **GHIS page-structure drift** → parser isolated in one function; graceful "needs review"/error states.
- **False reassurance** is the key clinical risk → explicit advisory badge; deterministic-only severities; MaiK cannot invent or downgrade.

## 9. Phased implementation plan (gated; approval between each; no auto-deploy)

- **PR 1** — Medication list builder + Drug Index search + manual entry + paste parsing ("Did you mean?" mapping).
- **PR 2** — Deterministic interaction engine + versioned ruleset + severity UI + duplicate/high-risk detection.
- **PR 3** — Photo/PDF OCR extraction + review workflow + compression pipeline.
- **PR 4** — Ward Sync + **GHIS Medication History import** + account-scoped saving + My Cases.
- **PR 5** — MaiK explanation layer + full test matrix + mobile/safe-area regression hardening.

Each PR: run tests, before/after screenshots, test results, PR number; **wait for approval** before the next. No Cloudflare bindings/secrets/Firebase/production-config changes.

## Out of scope (YAGNI v1)
Exhaustive minor-pair coverage; pharmacokinetic modelling; multi-language OCR; offline ruleset sync to the paid offline DB (revisit later).
