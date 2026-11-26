DRAFT - NEEDS LEGAL REVIEW

STATUS 2026-11-27: WITHDRAWN. Legal review F-01: this v0 override MUST NOT ship. The hard block is the default; the override only exists while the server switch RESEARCH_PHI_OVERRIDE is "1" (unset in production). Version v1 (legal review F-02 to F-05) replaces this text.

# Patient Identifier Override Terms (`rmd-phi-override-v0`)

Version: `rmd-phi-override-v0`
Scope: ResearchMD interactive `POST /v1/projects/{id}/ai-draft` requests only.

## Plain-English Terms

When ResearchMD detects possible patient identifiers in text you are about to send to MaiK on `/ai-draft`, you may override the warning only when all of the following are true:

1. **Authority to share**: You confirm that you have the right to share this text (for example, it is a false positive, synthetic or anonymised text, or text for which valid patient consent and institutional approval are in place).
2. **Necessity for the task**: Sending this text is needed for the drafting task you requested.
3. **Legal and institutional responsibility**: You accept responsibility for this disclosure under the Digital Personal Data Protection (DPDP) Act, 2023 and your institution's privacy and research ethics rules.
4. **Override audit logging**: StewardMD logs this override (`ai_phi_override`) with your user ID, timestamp, route and task, terms version (`rmd-phi-override-v0`), and the identifier category names flagged. StewardMD never logs or stores the flagged text itself in the override audit record.
5. **Clinician review of AI output**: Any AI-generated draft must be reviewed and verified by you before clinical, academic, or publication use.

## Short In-App Copy

> By continuing, you confirm that you have the right to share this text, that it is needed for this draft, and that you accept responsibility under the DPDP Act 2023 and your institution's rules. StewardMD logs this override (user, time, and identifier type, never the text itself). Always check AI output before use.
