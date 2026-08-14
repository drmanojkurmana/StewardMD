# Adversarial verification (re-check after REVISE) — nodal_marginal_zone_lymphoma.md

Checked against: `/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt`, "Nodal Marginal Zone Lymphomas" section (DeVita 12th ed., ~lines 267671-267746, pp. 1383-1384), plus the adjoining "Splenic Marginal Zone Lymphoma" section for the hepatitis-C claim.

## 1. DOSE LEAK
None. Grepped for `mg|mg/m2|AUC|cycle N|day N|qN` and scanned every numeric token in the file. The only occurrences are epidemiologic/response-rate statistics, not doses/schedules:
- "under 1% of all NHL" (matches DeVita's "<1% of all NHLs")
- "response rates in excess of 80%" (matches DeVita verbatim: "RRs in excess of 80%")
- "5-year survival ... 55% to 79%" (matches DeVita verbatim)
The "Deliberately omitted" section names the word "doses" with no number attached. No mg/m2, AUC, or numbered regimen/schedule anywhere.

## 2. UNGROUNDED / MISLABELLED CLAIMS
None found. All three prior REVISE items are now correctly resolved:

- **Umbralisib (Critical #1 — was stated as an approved option):** now reads "previously held accelerated approval ... but this was voluntarily withdrawn from the market in 2022 after an overall-survival detriment signal ... it is no longer an available treatment option," inline-labelled "(regulatory status current as of this writing, not from DeVita's section on this disease)" — repeated consistently in the systemic-therapy bullet and the Lines-of-therapy/referral bullets. Matches the known Ukoniq/UNITY-CLL 2022 withdrawal.
- **Ibrutinib (Critical #2 — was stated as an approved option):** ORR/PFS description ("roughly half" / "about a year") still correctly traces to DeVita's 48% ORR / 14-month PFS, but the approval claim is now reframed: "its US accelerated approval for this indication was voluntarily withdrawn in 2023, so it is now a historical/off-label option," labelled non-DeVita/regulatory-current. Consistent with the actual 2023 AbbVie/Janssen voluntary withdrawal of ibrutinib's MCL/MZL accelerated approvals.
- **R-CHOP vs. BR trial (Important #3 — was mis-attributed as an MZL-dedicated trial):** softened to "a randomised phase III comparison of rituximab-CHOP against bendamustine-rituximab in indolent lymphoma, including a subset of marginal zone lymphoma" — accurate to DeVita's own description ("included 67 patients with MZL NOS," no PFS difference, P<.32), left correctly unlabelled since it is DeVita-sourced.
- **Zanubrutinib:** left as "it remains an approved option for relapsed or refractory disease" — matches DeVita verbatim ("also an FDA-approved option for patients with relapsed/refractory disease"); correctly distinguished from the withdrawn drugs, and correctly still unlabelled (genuinely DeVita-grounded, still current).
- **CD19 CAR-T, hepatitis-C/autoimmune adjunct, watch-and-wait, surveillance rationale, referral criteria:** each still appropriately labelled "(general oncology standard, not from DeVita's section on this disease)" where the fact is external or from an adjoining (splenic MZL) section, and left unlabelled where genuinely DeVita-sourced for nodal MZL (epidemiology, staging, RT, chemoimmunotherapy RR, 5-year survival).
- No remaining claim presents a withdrawn/non-current regimen as a live approved option, and no claim is mis-attributed to DeVita's nodal-MZL section that isn't actually there.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers.

## 4. Other hard-rule check
No em dash or en dash anywhere in the file (byte-grepped for both); title now uses a colon ("Nodal marginal zone lymphoma (NMZL): management").

## VERDICT: CLEAN — ready for R1 re-review.
