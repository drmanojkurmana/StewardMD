# TNM Cancer Staging - content licence compliance

**Licence:** cancer staging content + software use, India-only commercial software use. Licence on file
(Licence_signed). Licensor = the staging-system rights holder; Licensee = MaiKnowledge. Signed
2026-08-17, initial term to 16 Aug 2027.

This note records how the app implements the licence so it can be re-checked at review/renewal.

## Obligations and how the app meets them

- **s.6 Neutral terminology / do not claim as our own.** The staging feature is presented only as
  "Cancer staging (TNM)" / "International TNM-based cancer staging." It is never described as
  MaiKnowledge's own proprietary criteria.
- **Licensor asked NOT to be named in user-facing text.** Per the owner relaying the licensor's
  direction, the licensor is not named anywhere in the ONCqis staging module: UI titles, tile, intro,
  version labels (shown as "8th edition" / "7th edition"), provenance, gap messages, and the shipped
  staging data (kb/onco/staging/*.json) are all neutral. Verified: `grep -r AJCC` over onco-staging.js,
  onco-home.js/.css, index.html (onco block), queue-flags.js, kb/onco/, kb/oncotree/ returns nothing.
- **s.7 Source acknowledgement watermark.** Every staging screen shows a persistent, legible footer:
  "Standard TNM-Based Cancer Staging - Licensed Content" (neutral wording standing in for the licensor
  per its direction; the licensor is not named). Do not remove/obscure. `.stg-license` in onco-home.css,
  emitted by onco-staging.js render() + verified in the APK build guard.
- **s.4 India-only territory.** The app's audience is India (StewardMD). If the app is ever distributed
  or made reachable outside India, geo-restriction of the staging feature must be added (NOT yet
  implemented - flag for public/international release).
- **s.9 No unauthorized modification of substantive criteria.** The seeded TNM criteria/cut-offs are the
  standard 8th-edition values (spot-checked correct). Content is flagged `requiresR1Verification` pending
  clinical (R1) sign-off during the oncologist validation distribution.

## Outstanding decision (owner)

- The general disease-reference knowledge base (kb/dist/kb.enrichment*.js) contains ~19 incidental
  factual mentions of the licensor's name in disease articles (e.g. "staged by the ... TNM system").
  These are general medical-education references in disease content, not the licensed staging tool, and
  arguably outside the staging licence's scope; scrubbing them from the compiled KB needs care.
  DECISION PENDING: leave as general references, or scrub for strict "name nowhere" compliance.

## If/when licensed manual text is supplied

The 16 seeded sites are accurate 8th-edition summaries authored from public references. If the licensor
supplies the official staging text, replace each site's version content in kb/onco/staging/*.json (same
schema) and keep the s.7 watermark. Add further cancer sites into the same index + schema.
