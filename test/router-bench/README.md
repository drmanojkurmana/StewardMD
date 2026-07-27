# MaiK router benchmark
Scores the LIVE production semantic router (`/api/ai/route`) against a gold-labelled multi-specialty
physician-query bank (concept / intent / ambiguity accuracy + latency).

Run: `node test/router-bench/run.mjs [perSpecialty]`  (hits prod; the "router" quota type is rate-exempt)

Banks are `*.json` = `[{q, concept, intent, ambiguous}]`. Add queries; every router change should
be re-scored here (no optimisation counts without a measured, regression-free improvement).
