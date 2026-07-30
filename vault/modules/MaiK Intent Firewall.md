---
tags: [module, ai, security]
status: live
flag: always-on
---
# MaiK Intent Firewall

Enforces that [[MaiK]] answers **only** clinical questions. **Allow-list**, not block-list: require a
positive medical signal, reject everything else (covers infinitely many non-medical prompts).

## Key files
- `kb/ai/maik-scope.js` (`window.MaiKScope`, UMD — browser + node/server) — the classifier, SINGLE source
- `home.js` — client gate at the top of `runClinical` (before KB/router/Vertex)
- `functions/api/ai/[[path]].js` — server `firewallBlock()` on `/refine` + `/research`

## Why allow-list (the lesson)
gold1039 put the check in the Vertex path → the instant local KB answered first ("write a code" →
"Writer's cramp"). gold1040 used a block-list → "how to eat apple" slipped to web research. **gold1041 =
allow-list** (require a medical signal). Invariant: **ZERO false-refusals** of real clinical questions —
`MEDICAL` is broad (morphology …itis/…cillin + symptoms + drugs + scores), ambiguous 2-letter abbrevs excluded.

## Tests
`test/maik-scope.test.mjs` — clinical corpus (0 false-refusals) + non-medical set. Configurable via `window.MAIK_SCOPE_CONFIG`.

See [[Decisions]] · analytics feed → [[AI Control Center]].
