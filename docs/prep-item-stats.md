# PrepNucleus Item Statistics & Blueprint Coverage Report

Published: 2026-10-12 | Quality Version: v1

## 1. Metric Definitions & Sample Size Rules (Plan Section 11)

| Metric | Definition | Interpretation Threshold |
|---|---|---|
| **Sample Size ($n$)** | Total recorded response exposures for the item | Baseline denominator |
| **Difficulty ($p$-value)** | Proportion of correct responses: $p = \text{right} / n$ | Interpreted only when $n \ge 100$: $\ge 0.8$ Easy, $0.5\text{-}0.8$ Medium, $0.25\text{-}0.5$ Hard, $<0.25$ Very hard |
| **Discrimination ($D$ / $r_{pbis}$)** | Ability to distinguish high from low performers: $D = p_{\text{upper}} - p_{\text{lower}}$ | Interpreted ONLY when $n \ge 100$; below 100 published as "not enough data" |
| **Distractor Share** | Proportion choosing each option: $o_k / n$ for $k \in \{0, 1, 2, 3\}$ | Used to audit plausibility of options |
| **Omission Rate** | Proportion leaving unanswered: $\text{blank} / n$ | Flagged for review if $\ge 25\%$ and $n \ge 100$ |
| **Average Response Time** | Mean completion time in seconds: $\text{secs} / n$ | Flagged if $<5\text{s}$ (guessing) or $>120\text{s}$ (confusing) with $n \ge 100$ |
| **Review Flags** | Statistical thresholds that mark an item `requires_review` | Never used to automatically rewrite or remove an item |

## 2. Statistical Review Flags Summary

- **Analyzed Items**: 0
- **Items with $n \ge 100$**: 0
- **Flagged Items for Owner Review**: 0

## 3. Blueprint & Learning Objective Coverage

- **Total Live Bank Questions**: 200520
- **Total Covered Modules/Objectives**: 1786
- **Viable Modules ($\ge 10$ items)**: 1737

### AMC CAT MCQ Examination (`amc-mcq`)

- Blueprint Kind: `official_counts` | Format: 150 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|
| adult-health-medicine | 36 | 0 | 0% | 36 | 0 |
| adult-health-surgery | 24 | 0 | 0% | 24 | 0 |
| womens-health | 15 | 0 | 0% | 15 | 0 |
| child-health | 15 | 0 | 0% | 15 | 0 |
| mental-health | 15 | 0 | 0% | 15 | 0 |
| population-health-and-ethics | 15 | 0 | 0% | 15 | 0 |

### FMGE (`fmge`)

- Blueprint Kind: `official_counts` | Format: 300 questions | Overall Met: 98%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|
| anatomy | 17 | 11423 | 67194% | 0 | 68 |
| physiology | 17 | 8658 | 50929% | 0 | 48 |
| biochemistry | 17 | 8471 | 49829% | 0 | 31 |
| pathology | 13 | 14028 | 107908% | 0 | 73 |
| microbiology | 13 | 10233 | 78715% | 0 | 38 |
| pharmacology | 13 | 13089 | 100685% | 0 | 71 |
| forensic-medicine | 10 | 5264 | 52640% | 0 | 24 |
| medicine | 33 | 16778 | 50842% | 0 | 110 |
| psychiatry | 5 | 4352 | 87040% | 0 | 33 |
| dermatology | 5 | 2112 | 42240% | 0 | 23 |
| surgery | 32 | 12616 | 39425% | 0 | 58 |
| anaesthesia | 5 | 3216 | 64320% | 0 | 26 |
| orthopaedics | 5 | 4032 | 80640% | 0 | 33 |
| radiology | 5 | 5573 | 111460% | 0 | 23 |
| paediatrics | 15 | 7284 | 48560% | 0 | 39 |
| ophthalmology | 15 | 6237 | 41580% | 0 | 30 |
| ent | 15 | 4778 | 31853% | 0 | 37 |
| obstetrics-gynaecology | 30 | 9699 | 32330% | 0 | 48 |
| community-medicine | 30 | 10240 | 34133% | 0 | 70 |

### INI-CET (`ini-cet`)

- Blueprint Kind: `none` | Format: 200 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### INI-SS (`ini-ss`)

- Blueprint Kind: `none` | Format: 80 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### MCCQE Part I (`mccqe-1`)

- Blueprint Kind: `none` | Format: 230 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### MRCP Part 1 (`mrcp-part1`)

- Blueprint Kind: `none` | Format: 200 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### MRCP Part 2 Written (`mrcp-part2-written`)

- Blueprint Kind: `none` | Format: 200 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### MRCS Part A (`mrcs-part-a`)

- Blueprint Kind: `none` | Format: 300 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### NEET-PG (`neet-pg`)

- Blueprint Kind: `none` | Format: 180 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### NEET-SS (`neet-ss`)

- Blueprint Kind: `none` | Format: 150 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### PLAB 1 (`plab-1`)

- Blueprint Kind: `none` | Format: 180 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### USMLE Step 1 (`usmle-step1`)

- Blueprint Kind: `none` | Format: 280 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

### USMLE Step 2 CK (`usmle-step2-ck`)

- Blueprint Kind: `none` | Format: 318 questions | Overall Met: 0%

| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |
|---|---|---|---|---|---|

