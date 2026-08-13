# Adversarial verification — nodal_marginal_zone_lymphoma.md

Checked against: `/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt`, "Nodal Marginal Zone Lymphomas" section (DeVita 12th ed., Ch. 67, ~lines 267671-267746, pp. 1383-1384), plus the adjoining "Splenic Marginal Zone Lymphoma" section for the hepatitis-C claim.

## 1. DOSE LEAK
None. Grepped for `mg|AUC|m2|m^2|day N|qN|cycle` and for any bare numeric pattern (`%`, `month`, `year`) — the file contains only:
- "under 1% of all NHL" (incidence, matches DeVita's "<1% of all NHLs")
- "response rates in excess of 80%" (matches DeVita verbatim: "RRs in excess of 80%")
- "5-year survival ... 55% to 79%" (matches DeVita verbatim: "5-year survival for patients with nodal MZL is 55% to 79%")

None of these are a dose, mg/m2, AUC, or a numbered schedule (no cycle counts, no day-1/8/15 patterning, no drug quantities). Clean.

## 2. UNGROUNDED CLAIMS
None found that are both (a) unsupported by the DeVita section and (b) not flagged/uncontroversial.

Spot-checked and confirmed present in DeVita's Nodal MZL text:
- <1% of NHL, nodal-only by definition — matches.
- Majority stage III/IV, majority asymptomatic, BM involvement ~45% ("under half," less common than other indolent lymphomas) — matches DeVita's "Over 70% ... stage III/IV," "majority asymptomatic," "45%."
- Limited-stage RT mirroring limited-stage FL — matches DeVita verbatim.
- Chemoimmunotherapy (alkylator or purine analog + rituximab), RR >80% — matches.
- R-CHOP vs. BR phase III, no significant PFS difference — matches DeVita's RCHOP-vs-BR comparison (P<.32; sidecar correctly omits the patient count and the specific PFS months, generalizing to "no significant difference").
- Ibrutinib in relapsed MZL, ~half ORR, ~1-year PFS, FDA-approved for relapsed disease — matches DeVita's 48% ORR / 14-month PFS, correctly rounded to qualitative language per the draft's stated omission policy.
- Zanubrutinib phase II, majority responding, ~quarter CR, approved for R/R — matches DeVita's MAGNOLIA data (68% ORR / 26% CR), trial name and exact numbers correctly stripped.
- Umbralisib (PI3K inhibitor) approved in R/R MZL based on phase II — matches.
- CD19 CAR-T explored 3L+ in R/R MZL, encouraging but immature follow-up — matches DeVita's ZUMA-5 axi-cel description (85%/60% ORR/CR, immature follow-up), correctly rounded and drug/trial name dropped.
- 5-year survival 55-79%, risk of histologic transformation — matches DeVita verbatim.

Claims explicitly and honestly flagged in-line as NOT DeVita-sourced (general-oncology-standard, uncontroversial):
- Watch-and-wait for asymptomatic/low-burden disease.
- Hepatitis-C-driven MZL — treating the underlying infection (this is actually DeVita content, but from the adjoining Splenic MZL paragraph, not the Nodal MZL section — correctly caveated as such rather than misattributed).
- Surveillance-schedule rationale, referral criteria, urgent re-biopsy on transformation trigger.

Two minor unflagged-but-uncontroversial statements (would not block sign-off): "Surgery has no defined role... diagnosis by lymph node biopsy rather than resection" (para. under "Role of surgery") and "should prompt re-biopsy of any rapidly enlarging or discordant node" — neither is stated verbatim in DeVita's nodal MZL paragraph, but both are standard, non-controversial oncology practice consistent with how indolent lymphomas are generally managed elsewhere in the same DeVita chapter (transformation/re-biopsy is explicitly discussed for HT in this exact section: "Similar to other indolent lymphomas, HT can occur with nodal MZL").

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1)

No dose/regimen-number leakage, no fabricated trial names/statistics, DeVita-vs-general-standard provenance is honestly and explicitly distinguished throughout, and the citation line meets the no-page-numbers rule.
