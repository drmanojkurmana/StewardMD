# ResearchMD Phase 3 risk-of-bias contract (module L, 3.6)

Frozen before the screens. The server builder implements these routes. Auth,
roles, error envelope and pagination follow `../phase-2/errors.md`. Blinding
mirrors `../phase-2/blinding.md` (B1-B7) with the same enforcement: the API
redacts the peer assessment until both assessors submit; the screen never
receives a hidden peer judgment.

Every domain judgment keeps a supporting quote AND a locator
(`../phase-1/locator.schema.json`). A judgment without a quote is rejected
422 `locator_required` (plan integrity rule 2). Judgments are human-attested;
T1 suggestions (3.5) may pre-fill a draft but are labelled "Suggestion" and
never submit for the assessor.

## Tools (GET /v1/rob-tools)

Response `rob-tools.response.json`: `{tools:[{id, name, source, scale,
domains:[{key, label, signallingQuestions:[{key, text}], judgments:[...]}],
overallRule}]}`. Four tools, real domains and signalling questions, source
stated per tool. Signalling-question answers use the tool's own answer set.

### rob2 - RoB 2 (Cochrane)

Source: Sterne JAC et al. "RoB 2: a revised tool for assessing risk of bias in
randomised trials." BMJ 2019;366:l4898. Version assessed: individually
randomised, parallel-group, two-arm trial (the standard RoB 2). Cluster and
crossover variants are a later contract addition.

Answer set for signalling questions: `Y` (yes), `PY` (probably yes),
`PN` (probably no), `N` (no), `NI` (no information).
Domain judgment: `low`, `some_concerns`, `high`.

| key | Domain | Signalling questions |
|---|---|---|
| d1 | Bias arising from the randomization process | 1.1 Was the allocation sequence random? 1.2 Was the allocation sequence concealed until participants were enrolled and assigned? 1.3 Did baseline differences between intervention groups suggest a problem with the randomization process? |
| d2 | Bias due to deviations from intended interventions | 2.1 Were participants aware of their assigned intervention? 2.2 Were carers and people delivering the intervention aware of the assigned intervention? 2.3 If Y/PY/NI to 2.1 or 2.2: were there deviations from the intended intervention that arose because of the experimental context? 2.4 If Y/PY/NI to 2.3: were these deviations likely to have impacted the outcome? 2.5 If Y/PY/NI to 2.4: were these deviations balanced between groups? 2.6 Was an appropriate analysis used to estimate the effect of assignment to intervention? 2.7 If Y/PY/NI to 2.6: was there potential for a substantial impact on the result of the failure to analyse participants in the group to which they were randomized? |
| d3 | Bias due to missing outcome data | 3.1 Were data for all, or nearly all, participants randomized available? 3.2 If N/PN/NI to 3.1: is there evidence that the result was not biased by missing outcome data? 3.3 If N/PN to 3.2: could missingness in the outcome depend on its true value? 3.4 If Y/PY/NI to 3.3: is it likely that missingness in the outcome depended on its true value? |
| d4 | Bias in measurement of the outcome | 4.1 Was the method of measuring the outcome inappropriate? 4.2 Could measurement or ascertainment of the outcome have differed between intervention groups? 4.3 If N/PN/NI to 4.1 and 4.2: were outcome assessors aware of the intervention received by study participants? 4.4 If Y/PY/NI to 4.3: could assessment of the outcome have been influenced by knowledge of intervention received? 4.5 If Y/PY/NI to 4.4: is it likely that assessment of the outcome was influenced by knowledge of intervention received? |
| d5 | Bias in selection of the reported result | 5.1 Were the data that produced this result analysed in accordance with a pre-specified analysis plan finalized before unblinded outcome data were available? 5.2 Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain? 5.3 Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data? |

Overall rule (`overallRule:"worst_domain_rob2"`): Low if every domain Low;
High if any domain High, or Some concerns in multiple domains; otherwise Some
concerns.

### robins_i - ROBINS-I

Source: Sterne JAC et al. "ROBINS-I: a tool for assessing risk of bias in
non-randomised studies of interventions." BMJ 2016;355:i4919.

Domain judgment: `low`, `moderate`, `serious`, `critical`, `no_information`.
Signalling questions answered `Y`/`PY`/`PN`/`N`/`NI` within each domain.

| key | Domain | Signalling questions (abridged to the tool's numbered items) |
|---|---|---|
| d1 | Bias due to confounding | 1.1 Is there potential for confounding of the effect of intervention in this study? 1.2 If Y/PY/NI to 1.1: was there adjustment for the most important confounding factors? 1.3 If Y/PY/NI to 1.2: were the confounding factors measured validly and reliably? 1.4 If Y/PY/NI to 1.3: was adjustment for time-varying confounding appropriate? |
| d2 | Bias in selection of participants into the study | 2.1 Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of intervention? 2.2 If Y/PY/NI to 2.1: were the analyses adjusted for the factors on which selection was based? 2.3 Do start of follow-up and start of intervention coincide for most participants? 2.4 If N/PN/NI to 2.3: were adjustment techniques used that are likely to correct for the presence of selection biases? |
| d3 | Bias in classification of interventions | 3.1 Were intervention groups well defined? 3.2 Was information used to define intervention groups recorded at the start of the intervention? 3.3 Could classification of intervention status have been affected by knowledge of the outcome or risk of the outcome? |
| d4 | Bias due to deviations from intended interventions | 4.1 Were there deviations from the intended intervention beyond what would be expected in usual practice? 4.2 If Y/PY/NI to 4.1: were these deviations from intended intervention balanced between groups? 4.3 If Y/PY/NI to 4.2: were these deviations likely to have affected the outcome? 4.4 Was an appropriate analysis used to estimate the effect of adhering to intervention? |
| d5 | Bias due to missing data | 5.1 Were data for all, or nearly all, participants available? 5.2 If N/PN/NI to 5.1: is there evidence that the result was not biased by missing data? 5.3 If N/PN to 5.2: could missingness in the data depend on the true value of the outcome? 5.4 If Y/PY/NI to 5.3: is it likely that missingness in the data depended on the true value of the outcome? |
| d6 | Bias in measurement of outcomes | 6.1 Could measurement or ascertainment of the outcome have differed between intervention groups? 6.2 Could outcome assessors have been aware of the intervention received by participants? 6.3 If Y/PY/NI to 6.2: could assessment of the outcome have been influenced by knowledge of intervention received? 6.4 If Y/PY/NI to 6.3: is it likely that assessment of the outcome was influenced by knowledge of intervention received? |
| d7 | Bias in selection of the reported result | 7.1 Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain? 7.2 Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data? |

Overall rule (`overallRule:"worst_domain"`): the worst domain judgment
(Critical > Serious > Moderate > Low). `no_information` in a domain is carried
as No information overall unless another domain is worse.

### quadas2 - QUADAS-2

Source: Whiting PF et al. "QUADAS-2: a revised tool for the quality assessment
of diagnostic accuracy studies." Ann Intern Med 2011;155:529-536.

Domain judgment (risk of bias): `low`, `high`, `unclear`. The first three
domains also carry an applicability concern: `low`, `high`, `unclear`.
Signalling questions answered `Y`/`N`/`Unclear`.

| key | Domain | Signalling questions | Applicability |
|---|---|---|---|
| patient_selection | Patient selection | Was a consecutive or random sample of patients enrolled? Was a case-control design avoided? Did the study avoid inappropriate exclusions? | yes |
| index_test | Index test | Were the index test results interpreted without knowledge of the results of the reference standard? If a threshold was used, was it pre-specified? | yes |
| reference_standard | Reference standard | Is the reference standard likely to correctly classify the target condition? Were the reference standard results interpreted without knowledge of the results of the index test? | yes |
| flow_timing | Flow and timing | Was there an appropriate interval between index test and reference standard? Did all patients receive the same reference standard? Were all patients included in the analysis? | no |

Overall rule (`overallRule:"domain_level"`): QUADAS-2 deliberately reports at
domain level, not as a single score. The screen shows each domain's risk and
applicability; a convenience flag marks the study "High risk" if any domain is
High, but the domain judgments are the authoritative output.

### nos - Newcastle-Ottawa Scale

Source: Wells GA et al. "The Newcastle-Ottawa Scale (NOS) for assessing the
quality of nonrandomised studies in meta-analyses." Ottawa Hospital Research
Institute. Cohort form shown; the case-control form swaps Outcome for Exposure
(a later contract addition selects the form).

Items award stars (0 or 1; comparability awards 0, 1 or 2). Max 9 stars.

| key | Category / item | Stars |
|---|---|---|
| sel1 | Selection: representativeness of the exposed cohort | 0-1 |
| sel2 | Selection: selection of the non-exposed cohort | 0-1 |
| sel3 | Selection: ascertainment of exposure | 0-1 |
| sel4 | Selection: demonstration that outcome of interest was not present at start | 0-1 |
| comp1 | Comparability: comparability of cohorts on the basis of design or analysis | 0-2 |
| out1 | Outcome: assessment of outcome | 0-1 |
| out2 | Outcome: was follow-up long enough for outcomes to occur | 0-1 |
| out3 | Outcome: adequacy of follow-up of cohorts | 0-1 |

Overall rule (`overallRule:"stars_threshold"`): total stars 0-9. Project
convention (not a NOS-published cutoff): Good >= 7, Fair 5-6, Poor <= 4. The
screen labels this threshold as a project convention and shows the star total.

## Assessment, blinding and consensus

Assessment is keyed by `(projectId, studyId, tool)`, two assessors. Schema
`rob-assessment.schema.json`.

```
GET /v1/projects/{projectId}/studies/{studyId}/rob?tool=rob2
```

All member roles read (reviewer sees blinded). Returns `{assessment}`:
`{tool, self:{submitted, domains:[{key, judgment, quote, locator, signallingAnswers, applicability?}], overall}, peer:{hidden:true} | {submitted, domains, overall}, outcome:"pending"|"agreed"|"conflict", conflictId?, consensus?}`.
`peer.hidden:true` with NO domains until both submit (B1). Viewer sees only
`outcome` and `consensus`, never votes.

```
POST /v1/projects/{projectId}/studies/{studyId}/rob
```

Request `rob-submit.request.json`:
`{tool, domains:[{key, judgment, quote, locator, signallingAnswers?, applicability?}], version?}`.
Owner/editor/analyst/reviewer vote. Each domain needs judgment + quote +
locator (422 `locator_required` otherwise). Re-submit before unblinding inserts
a new row (B2). Once both assessors have submitted: if every domain judgment
agrees, outcome `agreed`; if any domain disagrees (or a judgment is
`no_information`/`unclear`), the API opens one conflict per study+tool and
outcome `conflict` with `conflictId` (B3). Voting with an open conflict returns
409 `conflict_open`. Returns `{assessment, outcome, conflictId?}`.

```
GET /v1/projects/{projectId}/rob-conflicts
```

`{conflicts:[{id, projectId, studyId, tool, status:"open"|"resolved", createdTs}]}`
open first. Owner/editor see both assessments unblinded.

```
POST /v1/rob-conflicts/{conflictId}/resolve
```

Request `rob-resolve.request.json`:
`{domains:[{key, judgment, quote, locator, applicability?}], note}`.
Owner/editor only (403 `resolver_only`); a voter may resolve only when no
non-voter owner/editor exists and the note records that (B4). The consensus
domain judgments replace the conflicted ones; overall is recomputed by the
tool's `overallRule`. Returns `{conflict, assessment}` with `consensus` set.

```
GET /v1/projects/{projectId}/studies/{studyId}/rob/audit?tool=rob2
```

`{events:[...]}` (submitted, unblinded, conflict_opened, resolved) with by/ts.

## Error codes added

| HTTP | code | When |
|---|---|---|
| 404 | `assessment_not_found` | no such study/tool assessment |
| 404 | `rob_conflict_not_found` | no such conflict |
| 409 | `conflict_open` | submitting with an open conflict |
| 409 | `already_decided` | resolving an already-resolved conflict |
| 422 | `locator_required` | domain judgment without quote+locator |
| 422 | `invalid_judgment` | judgment not in the tool's domain set |
| 403 | `resolver_only` | consensus needs owner/editor |
