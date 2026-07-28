# Clinical Dialogue Manager (CDM) — Design Spec

**Date:** 2026-07-28
**Status:** Approved (design), implementing
**Problem:** An underspecified broad query (e.g. "meningitis") silently resolves to an arbitrary subtype
("Viral (Aseptic) Meningitis") instead of a general overview or a clarification. A good clinician first
clarifies an underspecified question. We want MaiK to do the same — generically, from the ontology, not
a hardcoded disease list.

## Goal
Add a deterministic, client-side **Clinical Dialogue Manager** at the top of `home.js runClinical`,
*above* the local-first bypass and the semantic router. For a broad concept with multiple clinically
important subtypes it must NOT arbitrarily pick one: prefer a general/umbrella overview (with tappable
subtype chips), and ask one concise clarification only when no single safe KB answer exists. No Vertex —
so broad-concept handling is instant and offline-capable.

## Ontology-driven detection (no hardcoded disease lists)
Given a query, extract its **bare term** (strip intent lead-in/trailing words: "meningitis treatment" →
"meningitis"). A term is a **broad candidate** iff, among **answerable** KB entries (has a DX_MGMT brief
or curated management — this excludes rare reference-tier name-variants), the term is the shared
head-noun of **≥2 entries with distinct clinical qualifiers** ("bacterial/viral/tuberculous meningitis";
"type 1/2/gestational diabetes"). Qualifiers that are connectives/meta (and, due, hereditary, acquired,
neonatal, complications, management, …) do NOT count. A query that is already qualified ("viral
meningitis", "type 2 diabetes", "septic shock") is specific → CDM is skipped entirely.

This one rule generalizes across every domain (meningitis, diabetes, hepatitis, anaemia, shock,
pneumonia, arthritis, colitis, …). Validated: all flag broad; specifics (pheochromocytoma, MG, sepsis,
viral meningitis, type 2 diabetes) do not.

## Decision (low-harm by construction)
For a broad candidate:
1. **General answer available → OVERVIEW + chips.** Show the umbrella/dominant KB answer instantly, and
   attach subtype **drill-down chips** built from the KB subtypes. "Umbrella" = an entry named exactly
   the bare term, or term + a generic completion ("Diabetes **Mellitus**"), or an "Acute <term>" entry
   whose aliases span ≥2 subtypes ("Acute Meningitis"); else fall back to the normal resolver's dominant
   single match. The answer states it is a category overview. Tapping a chip re-runs on that subtype.
   *This path is low-harm even if broadness is borderline (sarcoidosis, endocarditis) — it is just a
   normal answer with a helpful drill-down affordance.*
2. **No single safe answer → ASK.** Only when the query resolves to no confident single/umbrella entry
   (e.g. "shock" — no "Shock" entry), ask one concise question with subtype chips
   ("Which type of shock? Septic / Cardiogenic / Hypovolemic / Distributive"). This — the only
   interrupting path — is gated strictly, so annoying false-interrupts are near-zero.
3. Not broad → existing pipeline (local-first bypass → router), unchanged.

## Chips
Derived from the KB subtypes for the term, filtered to answerable/diagnostic entries, de-duplicated by
qualifier, capped at ~5. Reuse existing UI: overview chips via the `@@REFINE:` mechanism
(`maikRenderAnswer` already renders/handles them); the ASK path reuses the router's existing
`_askAmbiguous(options)` "Did you mean" chip path. **No new UI.**

## Placement / interaction with existing pipeline
`runClinical` → **CDM.check(question, pkg)** →
- returns `{mode:"overview", kb, chips}` → `finishKB` + chips (instant, no Vertex)
- returns `{mode:"ask", options}` → `_askAmbiguous(options)` (instant, no Vertex)
- returns `null` → fall through to the local-first bypass → semantic router (unchanged)

Runs BEFORE the local-first bypass, because a broad term could otherwise bypass to an arbitrary subtype
(the bypass's literal-token gate would pass "meningitis" against "viral meningitis"). CDM must intercept
first.

## Safety / non-regression
- Overview path returns the SAME deterministic KB answer engine output (no new answer content) — just
  the *right* concept + chips. No fabrication.
- ASK path only fires with no confident single answer → cannot suppress a good answer.
- Specific/qualified queries bypass CDM entirely → zero change to the 80%+ that already work.
- Deterministic + offline; no added Vertex/Gemini calls (latency-positive for broad queries: they
  currently pay the ~3s router, now instant).

## Validation plan (offline, before ship)
1. Broad set {meningitis, diabetes, hepatitis, anaemia, shock, pneumonia, arthritis, colitis} → all
   broad, sensible overview-or-ask.
2. Specific set {pheochromocytoma, MG, sarcoidosis, sepsis, viral meningitis, type 2 diabetes, hepatitis
   b, iron deficiency anemia, septic shock} → none take the ASK path.
3. Meningitis regression: "meningitis" → Acute Meningitis overview + [Bacterial/Viral/Fungal/TB] chips
   (not silent viral).
4. Interrupt-FP rate (ASK path) over answerable disease names → target < 2%.

## Out of scope
Router-side breadth signal (LLM-judged); multi-turn dialogue memory beyond the existing chip re-run.
