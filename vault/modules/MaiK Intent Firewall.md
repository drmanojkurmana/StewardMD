---
tags: [module, ai, security]
status: live
flag: always-on
---
# MaiK Intent Firewall

Enforces that [[MaiK]] answers **only** clinical questions. **Allow-list**, not block-list: require a
positive medical signal.

**Two-layer since 2026-08-20.** The deterministic layer refuses only what it can POSITIVELY identify as
non-clinical; an *unrecognised* query is passed to the model, which refuses non-medical itself. Use
`MaiKScope.isRefusable(q)` for gating - never `classify(q).medical === false`.

## Key files
- `kb/ai/maik-scope.js` (`window.MaiKScope`, UMD — browser + node/server) — the classifier, SINGLE source
- `home.js` — client gate at the top of `runClinical` (before KB/router/Vertex)
- `functions/api/ai/[[path]].js` — server `firewallBlock()` on `/refine` + `/research`

## Why allow-list (the lesson)
gold1039 put the check in the Vertex path → the instant local KB answered first ("write a code" →
"Writer's cramp"). gold1040 used a block-list → "how to eat apple" slipped to web research. **gold1041 =
allow-list** (require a medical signal). Invariant: **ZERO false-refusals** of real clinical questions —
`MEDICAL` is broad (morphology …itis/…cillin + symptoms + drugs + scores), ambiguous 2-letter abbrevs excluded.

## The false-refusal incident (2026-08-20)
A doctor's own device transcript showed MaiK refusing **"What is PCOD?"** and **"What is SGLT2 drugs
mechanism of action?"** with "MaiK is for healthcare professionals. It answers only medical and clinical
questions." Three independent causes, all fixed:

1. **`non_medical` was treated as "not medical".** It is really "no signal in our vocabulary". The client
   gate refused it; the server never did. Now `classify()` returns `certain:true|false` and only
   `certain` refusals gate. An unrecognised query goes to the model.
2. **Vocabulary holes.** No pharmacology at all (`mechanism of action`, `half life`, `bioavailability`),
   no drug CLASSES (`SGLT2`, `DPP-4`, `GLP-1`, `ACE inhibitor`, `PPI`), no common abbreviations
   (`PCOD`, `PCOS`, `BPH`, `GDM`, `T2DM`, `ITP`). Added as `DRUG_CLASS` + `ABBREV_COMMON` + a
   pharmacology block in `CLINICAL_ACTION`.
3. **`lexiconMedical()` was an EXACT whole-string lookup**, so runtime widening only ever fired on a bare
   term: `PCOD` resolved, `What is PCOD?` did not. `core()` strips question wrappers first.

**Also:** `maikRoute` in `home.js` kept its OWN ~40-word clinical keyword regex, so `"PCOD?"` and
`"Side effects?"` were dead-ended into "Could you tell me the condition…" even when the firewall said
medical. It now defers to MaiKScope. One source of truth.

**Cloud half:** `MEDICAL_ONLY` is appended to `KNOWLEDGE_SYS` / `RESEARCH_SYS` /
`RESEARCH_SYS_SNIPPETS` / `EVIDENCE_REVIEW_SYS`. It names the refusal line AND explicitly forbids
over-refusing an unfamiliar clinical question - without that clause the model just becomes the new
source of the same bug.

## Tests
- `test/maik-scope.test.mjs` — clinical corpus (0 false-refusals) + non-medical set + the certain/uncertain contract
- `test/maik-scope-widen.test.mjs` — doctor shorthand via the runtime lexicons
- `test/maik-cloud-scope.test.mjs` — the scope rule is attached to all four chat prompts, server uses the shared predicate
- `test/maik-router-scope.test.mjs` — the client gate requires certainty; no rival keyword list in `maikRoute`
Configurable via `window.MAIK_SCOPE_CONFIG`.

See [[Decisions]] · analytics feed → [[AI Control Center]].
