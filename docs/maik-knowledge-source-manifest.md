# MaiK Knowledge Source Manifest

_Canonical machine copy: `kb/manifest/source-manifest.json` (+ schema). Provenance only — no source text stored. Policy: paraphrase-only, no verbatim, no paywalled ingestion, citation required; the deterministic engine owns diagnosis & stewardship. Treatment precedence: **icmr ▸ guideline ▸ harrison**._

| Source | Type | Jurisdiction | Usage | Precedence | Verbatim stored | Approved | Reviewer needed | Clinician label |
|---|---|---|---|---|---|---|---|---|
| Harrison's Principles of Internal Medicine, 22e (2025) | textbook | — | paraphrased_reference | harrison | no | yes | on content change | Standard internal-medicine reference |
| ICMR / NCDC / National programme guidelines (India) | national_guideline | India | paraphrased_protocol | icmr | no | yes | on content change | ICMR / national guidelines |
| International society / specialty guidelines | society_guideline | — | paraphrased_protocol | guideline | no | yes | on content change | <Named society> guidelines |
| World Health Organization guidelines | who_guideline | — | paraphrased_protocol | guideline | no | yes | on content change | WHO guidelines |
| Validated clinical criteria / severity scores | clinical_criteria | — | criteria_paraphrase | guideline | no | yes | on content change | Clinical criteria |
| StewardMD Drug Index | internal_formulary | — | internal_data | formulary | no | yes | on content change | StewardMD Drug Index |
| Local hospital / ICU antibiogram overlay | hospital_overlay | — | site_configured_overlay | overlay | no | yes | on content change | Local hospital policy |

**Review cadence:** re-verify guideline versions at each Tier-1 content update; expiry = next guideline major revision. **sameAs / social:** none asserted (nothing invented).
