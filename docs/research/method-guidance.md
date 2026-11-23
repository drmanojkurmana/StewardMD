# ResearchMD Method Guidance: Statistical Decision Trees for Meta-Analysis

> **DRAFT: Needs sign-off by a qualified statistician (plan decision D-7) before it is shown in the app.**

This document provides plain-language, decision-tree guidance for clinician researchers using ResearchMD inside the StewardMD mobile app. It explains how to choose effect measures, select statistical models, interpret heterogeneity, evaluate small-study effects, and adjust for complex trial designs directly from your phone or tablet.

All statistical calculations in ResearchMD are executed deterministically by the canonical engine (`research-engine.js`). LLMs never perform statistical calculations or modify numbers.

---

## 1. Choosing the Effect Measure

Selecting the right effect measure depends on the nature of your clinical outcome: binary events, continuous measurements, or time-to-event survival data.

```
What is the clinical outcome type?
├── Binary (yes/no, dead/alive, event/no event)
│   ├── Is baseline risk variable across studies and clinical interpretation paramount?
│   │   └── Choose Risk Ratio (RR / Relative Risk)
│   ├── Is the study design case-control or are odds ratios natively reported?
│   │   └── Choose Odds Ratio (OR)
│   └── Is absolute clinical impact, number needed to treat, or rare-event risk paramount?
│       └── Choose Risk Difference (RD)
├── Continuous (blood pressure, pain score, hospital stay duration)
│   ├── Did all included studies use the exact same measurement scale and unit?
│   │   └── Choose Mean Difference (MD)
│   └── Did studies measure the same construct using different instruments or scales?
│       └── Choose Standardised Mean Difference (SMD, Hedges' g)
└── Time-to-Event / Survival (time to death, relapse-free survival)
    └── Extract reported Hazard Ratios (HR) or log HR with SE
        └── Choose Generic Inverse-Variance Hazard Ratio (HR)
```

### Binary Outcomes: RR, OR, or RD?

- **Risk Ratio (RR, Relative Risk):**
  - **Clinical meaning:** The ratio of risk in the intervention group to risk in the control group. An RR of 0.80 means a 20% relative reduction in risk.
  - **When to choose:** Preferred in randomized controlled trials and cohort studies where events accumulate over a defined time horizon. Clinicians find RR more intuitive to interpret than odds ratios.
  - **Engine note:** Ratio measures are pooled on the log scale (`log RR`) and exponentiated for display. Studies with zero events in both arms are excluded from RR pooling because they provide no information about relative risk.

- **Odds Ratio (OR):**
  - **Clinical meaning:** The odds of an event in the intervention group divided by the odds in the control group.
  - **When to choose:** Mandatory for case-control studies where baseline risk cannot be calculated directly. Also standard in logistic regression models.
  - **Clinical warning:** In common conditions where event rates exceed 10% to 15%, odds ratios can substantially exaggerate the apparent effect size compared to risk ratios. Clinicians must not interpret an OR of 2.0 as a doubling of risk when event rates are high.
  - **Engine note:** Pooled on the log scale (`log OR`). Double-zero studies are excluded from OR pooling.

- **Risk Difference (RD, Absolute Risk Reduction):**
  - **Clinical meaning:** The absolute difference in event rates between groups (for example, 5% in treated vs 10% in control equals an RD of -0.05, or a 5 percentage point reduction). The inverse is the Number Needed to Treat (NNT = 1 / |RD|).
  - **When to choose:** Useful for clinical decision-making, health economics, and evaluating rare adverse events.
  - **Engine note:** Pooled directly on the natural scale without logarithmic transformation. Unlike OR and RR, studies with zero events in both arms are retained in RD pooling with finite variance, because zero events in both arms provide valid evidence that the absolute risk difference is near zero.

*Guidance reference: Cochrane Handbook v6.5, Chapter 6 (Section 6.4).*

---

### Continuous Outcomes: MD vs SMD (Hedges' g)

- **Mean Difference (MD):**
  - **When to choose:** Use when every included study reported the outcome on the identical scale and unit (for example, systolic blood pressure measured in mmHg, or fasting glucose in mmol/L).
  - **Clinical interpretation:** The pooled estimate retains the original physical units, making direct clinical translation straightforward.

- **Standardised Mean Difference (SMD, Hedges' g):**
  - **When to choose:** Use when studies evaluated the same clinical construct using different measurement tools or scales (for example, depression measured by the Hamilton Rating Scale vs the Beck Depression Inventory; pain measured by 0 to 10 VAS vs 0 to 100 visual scales).
  - **Engine implementation:** ResearchMD uses Hedges' g with exact small-sample correction factor J:
    `J = 1 - 3 / (4 * df - 1)`
    This avoids the upward bias that unadjusted Cohen's d exhibits in small sample sizes.
  - **Rule of thumb for interpretation:** 0.2 represents a small effect, 0.5 a moderate effect, and 0.8 a large effect. Always report the clinical scales contributing to the synthesis.

*Guidance reference: Cochrane Handbook v6.5, Chapter 6 (Section 6.5).*

---

### Time-to-Event Outcomes: Hazard Ratio (HR)

- **Why raw counts are insufficient:** Binary 2x2 counts ignore when events happened and drop information on censoring. Analyzing survival trials by simple event counts at a single follow-up time point introduces severe bias when follow-up lengths vary.
- **How ResearchMD handles HR:** HR requires generic inverse-variance input. Clinicians enter either:
  1. The reported hazard ratio with its 95% confidence interval (`effect`, `ciLower`, `ciUpper`), or
  2. The natural log hazard ratio with its standard error (`yi`, `se`).
- **Engine note:** The engine converts reported confidence intervals to log HR and standard error using the study-specific confidence level (default 95%). Pooled results are exponentiated for mobile display.

*Guidance reference: Cochrane Handbook v6.5, Chapter 6 (Section 6.8).*

---

## 2. Fixed-Effect vs Random-Effects Models

```
Which pooling model should you select?
├── Fixed-Effect (Common-Effect) Model
│   ├── Assumption: Exactly ONE true effect size underlies every study.
│   │   Differences between study results are assumed to be 100% sampling error.
│   └── When to use:
│       └── Identical protocols, populations, interventions, and measurement methods.
│           Rarely plausible in clinical medicine outside direct laboratory replications.
└── Random-Effects Model
    ├── Assumption: True effects vary across studies following a distribution.
    │   The pooled estimate represents the AVERAGE of this distribution of true effects.
    └── When to use:
        └── Standard default for clinical meta-analyses. Patient ages, co-morbidities,
            drug dosages, surgical skills, and care settings naturally vary across trials.
```

### Clinical Interpretation Differences

1. **Fixed-Effect Model:**
   - Asks: "What is the single best estimate of the common effect size shared by all included studies?"
   - Weights studies strictly by their inverse within-study variance (`w_i = 1 / v_i`).
   - A single massive trial can completely dominate the meta-analysis, receiving 80% or more of the total weight.

2. **Random-Effects Model:**
   - Asks: "What is the average treatment effect across the spectrum of clinical settings represented by these studies?"
   - Incorporates between-study heterogeneity variance tau squared into the weights (`w_i = 1 / (v_i + tau^2)`).
   - Distributes weight more evenly across studies than fixed-effect pooling. Smaller studies have greater relative influence than under fixed-effect weighting.

*Guidance reference: Cochrane Handbook v6.5, Chapter 10 (Section 10.10).*

---

## 3. Estimating Between-Study Variance: DerSimonian-Laird vs REML

When you choose a random-effects model, the engine must estimate tau squared (between-study variance). ResearchMD provides two estimators:

```
Which tau-squared estimator should you choose?
├── DerSimonian-Laird (DL)
│   ├── Non-iterative method of moments. Historical standard in early meta-analysis software.
│   ├── Flaw: Systematically underestimates tau squared, especially with small study counts (k)
│   │   or moderate-to-large heterogeneity, producing falsely narrow confidence intervals.
│   └── App behavior: If selected with Wald tests, the app displays a method notice recommending REML.
└── Restricted Maximum Likelihood (REML) [RECOMMENDED]
    ├── Iterative likelihood-based method via Fisher scoring with step-halving.
    ├── Advantage: Minimally biased estimator of tau squared; modern methodological standard.
    └── App behavior: Clamped at tau squared = 0. Capped at 1000 iterations.
```

### Methodological Evidence

- **Veroniki et al. (2016):** Extensive systematic evaluation of between-study variance estimators demonstrated that the DerSimonian-Laird method frequently underestimates tau squared, leading to inflated type I error rates (false positives).
- **Langan et al. (2019):** Simulation studies established that iterative likelihood methods such as REML perform substantially better than method-of-moments estimators across clinical scenarios.
- **Cochrane Handbook v6.5 recommendation:** Chapter 10 advises moving away from DerSimonian-Laird toward REML or exact likelihood approaches.
- **Convergence notice in the app:** In rare cases where REML fails to reach numerical convergence within 1000 iterations, ResearchMD flags a notice (`REML-did-not-converge`) and reports the last iterate with a caution.

*Primary citations: Veroniki 2016; Langan 2019. Cochrane Handbook v6.5, Chapter 10 (Section 10.10.4).*

---

## 4. Confidence Intervals and Hypothesis Testing: Wald vs HKSJ

```
Which confidence interval method should you use for the pooled effect?
├── Wald Test (Standard Normal Z)
│   ├── Uses standard normal critical values (+/- 1.96 for 95% CI).
│   └── Severe flaw: Assumes tau squared is known with complete certainty.
│       When study count k is small (k < 10 to 20), false-positive error rates
│       are substantially inflated (often reaching 15% to 25% instead of 5%).
└── Hartung-Knapp-Sidik-Jonkman (HKSJ / knha) [RECOMMENDED]
    ├── Uses Student-t distribution with k - 1 degrees of freedom.
    ├── Incorporates uncertainty in the estimation of tau squared.
    ├── Maintains true type I error rates near the nominal 5% level (IntHout 2014).
    └── What if the HKSJ CI is narrower than the Wald CI?
        └── ResearchMD automatically activates the Truncated (Ad-hoc) Variant (Rover 2015).
```

### The Hartung-Knapp-Sidik-Jonkman (HKSJ) Method

The traditional Wald approach assumes the estimated between-study variance tau squared is the exact true parameter. In reality, tau squared is estimated with considerable uncertainty, especially when the number of studies is small.

IntHout et al. (2014) showed that HKSJ consistently outperforms the standard DerSimonian-Laird/Wald method across realistic medical scenarios, preventing spurious statistically significant findings. Cochrane Handbook v6.5 Chapter 10 recommends HKSJ for random-effects meta-analyses.

### The Truncated (Ad-hoc) Variant

Under specific conditions, a known statistical anomaly occurs: when studies have very similar effect sizes (yielding a Cochran's Q statistic that is small relative to degrees of freedom k - 1), the HKSJ standard error can paradoxically become smaller than the unadjusted Wald standard error. This produces an artificially narrow, overly optimistic confidence interval.

To resolve this issue, Röver et al. (2015) proposed an ad-hoc truncation:
- If the HKSJ confidence interval is narrower than the Wald confidence interval, ResearchMD automatically reports the **truncated variant**, which bases the margin of error on the larger standard error combined with the Student-t critical value.
- The app screen highlights this with a badge: `hksj-truncated`.

### Caution with Very Few Studies (k < 5)

When pooling very few trials (such as k = 2, 3, or 4):
- The Student-t critical value on k - 1 degrees of freedom is very large (at df = 1, t = 12.71; at df = 2, t = 4.30).
- This produces very wide confidence intervals that accurately reflect the lack of data, but may surprise clinicians accustomed to overly narrow Wald intervals.
- If between-study variance cannot be estimated reliably with tiny k, clinicians must describe the findings as exploratory and avoid drawing definitive conclusions.

*Primary citations: IntHout 2014; Rover 2015. Cochrane Handbook v6.5, Chapter 10 (Section 10.10.4).*

---

## 5. Prediction Intervals (When and How to Interpret, k >= 3)

```
Confidence Interval vs Prediction Interval:
├── 95% Confidence Interval:
│   └── "Where does the AVERAGE true effect across all clinical settings lie?"
│       Reflects precision of the pooled mean.
└── 95% Prediction Interval:
    └── "In what range will the true effect size fall in the NEXT future clinical trial
        or in a SPECIFIC hospital setting?"
        Reflects dispersion of individual true effects in clinical practice.
```

### Why Prediction Intervals Matter Clinically

A meta-analysis may report a pooled effect that is statistically significant (for example, Risk Ratio 0.75, 95% CI 0.65 to 0.86). However, if there is substantial heterogeneity, the 95% prediction interval might span from 0.45 to 1.25.

**Clinical takeaway:** While the treatment is beneficial on average, in approximately 5% to 10% of real-world patient subgroups or hospital settings, the intervention may have no effect or could even be harmful. Clinicians must not assume an intervention works everywhere simply because the confidence interval excludes the null.

### Engine Rules for Prediction Intervals

1. **Study count threshold:** ResearchMD displays a prediction interval only when the number of included studies is at least 3 (`k >= 3`). For k < 3, the engine returns null because estimating the spread of a distribution requires at least 3 data points.
2. **Degrees of freedom:** Under the HKSJ test (`knha`), the prediction interval uses a Student-t critical value with `k - 2` degrees of freedom. Under the Wald test, it uses the standard normal critical value.
3. **Formula:**
   `Standard Deviation of Prediction = sqrt(tau^2 + SE_pooled^2)`
   `Prediction Interval = Pooled Effect +/- t_crit * Standard Deviation of Prediction`

*Guidance reference: Cochrane Handbook v6.5, Chapter 10 (Section 10.10.4).*

---

## 6. Handling Zero Cells and Double-Zero Studies

Zero events in one or both arms of a randomized trial create mathematical challenges for ratio measures because division by zero is undefined and the logarithm of zero is negative infinity.

```
How are zero events handled in ResearchMD?
├── Single-Zero Studies (events in one arm, 0 in the other)
│   ├── Applied to: OR, RR, and RD.
│   └── Solution: Continuity correction of 0.5 added to all four cells of the 2x2 table.
│       Enables computation of finite log ratios and variances.
└── Double-Zero Studies (0 events in BOTH arms, or 100% events in both)
    ├── If Effect Measure is Odds Ratio (OR) or Risk Ratio (RR):
    │   └── EXCLUDED from analysis (tagged: "double-zero").
    │       Rationale: Studies with zero events in both arms contain no mathematical
    │       information regarding relative risk or odds.
    └── If Effect Measure is Risk Difference (RD):
        └── KEPT in analysis with 0.5 continuity correction and finite variance.
            Rationale: Zero events in both arms provide valid, finite evidence that
            the absolute risk difference between interventions is zero.
```

### Recommendations for Rare-Event Meta-Analysis

When investigating rare clinical outcomes (such as severe drug adverse effects occurring in fewer than 1% of patients):
- Standard continuity corrections (adding 0.5) can introduce conservative bias toward no effect when arm sizes are unbalanced.
- If multiple studies have zero events, prioritize Risk Difference (RD) or consider exact non-continuity methods in consultation with a statistician.

*Guidance reference: Cochrane Handbook v6.5, Chapter 10 (Section 10.4.4).*

---

## 7. Heterogeneity, Subgroup Analyses, and Leave-One-Out Sensitivity

```
Evaluating Diversity Across Studies:
├── Statistical Heterogeneity Metrics
│   ├── Cochran's Q (chi-square test of homogeneity; low power at small k)
│   ├── I-squared (percentage of variability due to true heterogeneity, 0% to 100%)
│   └── Tau-squared (absolute between-study variance on the analysis scale)
├── Subgroup Analyses
│   ├── Meaningful ONLY when pre-specified in the protocol.
│   ├── Requires at least 2 included studies per subgroup (clinically prefer 4 to 5).
│   └── Engine evaluates differences via fixed-effect between-group Q test.
└── Leave-One-Out Sensitivity Analysis
    ├── Meaningful ONLY when k >= 3 included studies.
    └── Systematically recalculates pooled effect omitting one study at a time
        to detect influential outlier trials.
```

### Interpreting Heterogeneity Metrics

1. **Cochran's Q:**
   - Tests the null hypothesis that all studies share a single common effect size.
   - P-value < 0.10 is conventionally treated as evidence of heterogeneity (due to low statistical power when study counts or sample sizes are small).
   - Warning: With very large sample sizes, Q can yield a tiny p-value over clinically trivial differences.

2. **I-squared (I2):**
   - Quantifies the proportion of observed variance that is attributable to true heterogeneity between studies rather than random sampling error.
   - Rough guide (Cochrane Handbook v6.5, Chapter 10):
     - 0% to 40%: Might not be important.
     - 30% to 60%: May represent moderate heterogeneity.
     - 50% to 90%: May represent substantial heterogeneity.
     - 75% to 100%: Considerable heterogeneity.
   - Important limitation: I-squared depends heavily on within-study precision. In meta-analyses of massive trials, I-squared can be 90% even when absolute between-study differences are clinically negligible. Always evaluate tau squared alongside I-squared.

3. **Tau-squared (tau2) and Tau:**
   - The absolute variance and standard deviation of true effects on the analysis scale (for example, log OR or natural units).
   - Tau provides a direct clinical measure of how widely true effect sizes vary across clinical settings.

---

### Subgroup Analyses: Rules and Best Practices

- **Pre-specification is mandatory:** Subgroup analyses must be defined in your locked protocol (PICO/PECO builder) before reviewing results. Post-hoc subgroup hunting based on looking at forest plots is a primary cause of spurious clinical claims.
- **Minimum studies per subgroup:** ResearchMD requires at least 2 included studies in each subgroup. Clinically, attempting to estimate a subgroup mean with fewer than 4 or 5 studies per group is unreliable.
- **Between-subgroup test:** The engine calculates the fixed-effect between-group Q statistic (`between.q`, degrees of freedom = number of subgroups minus 1) and its chi-square p-value. A non-significant between-group p-value (p >= 0.05) indicates no statistical evidence that the treatment works differently across subgroups.

---

### Leave-One-Out Sensitivity Analysis

- **When to inspect:** Available when at least 3 included studies are present (`k >= 3`).
- **What to look for:**
  - Does omitting a single large study flip the pooled estimate from statistically significant to non-significant?
  - Does omitting a single study reduce tau squared or I-squared from 70% to near 0%?
  - If a single trial drives the entire conclusion, the finding lacks clinical robustness and must be highlighted in the manuscript discussion.

*Guidance reference: Cochrane Handbook v6.5, Chapter 10 (Sections 10.10 and 10.11).*

---

## 8. Publication Bias and Small-Study Effects (The 10-Study Rule)

```
Assessing Funnel Plot Asymmetry and Publication Bias:
├── Number of included studies k < 10:
│   └── DO NOT perform statistical tests for funnel plot asymmetry.
│       The engine strictly refuses Egger test runs for k < 10.
│       Rationale: Statistical power is too low to distinguish real asymmetry from chance.
└── Number of included studies k >= 10:
    ├── Inspect Funnel Plot: Effect estimate vs standard error.
    └── Run Egger Linear Regression Test:
        └── Evaluates relationship between effect size and precision (k - 2 df).
```

### The 10-Study Rule

Statistical tests for funnel plot asymmetry (such as the Egger regression test) have notoriously low power when meta-analyses contain fewer than 10 studies. Under k < 10, tests frequently miss severe publication bias, while random variation can easily masquerade as asymmetry.

Cochrane Handbook v6.5 Chapter 13 explicitly dictates that tests for funnel plot asymmetry should not be used when there are fewer than 10 studies. ResearchMD enforces this rule directly in code: the engine throws an error and refuses to run the Egger test if k < 10.

### Asymmetry Is Not Synonymous with Publication Bias

If your funnel plot or Egger test demonstrates asymmetry (p < 0.10), clinicians must not jump immediately to the conclusion of commercial suppression of negative trials. Funnel plot asymmetry can stem from:
1. **True clinical heterogeneity:** Smaller trials may have targeted higher-risk patients who experienced greater biological benefits.
2. **Methodological quality:** Smaller trials may have had lower methodological rigor (such as inadequate allocation concealment), exaggerating treatment effects.
3. **Selective outcome reporting:** Reporting only positive outcomes among multiple measured endpoints within published studies.
4. **Chance:** Random sampling variation in small sets of trials.

*Guidance reference: Cochrane Handbook v6.5, Chapter 13 (Sections 13.3 and 13.4).*

---

## 9. Converting Median and IQR/Range to Mean and SD (Wan 2014)

Clinical trials frequently summarize continuous outcomes using the median and interquartile range (IQR) or minimum/maximum range, particularly for non-normally distributed outcomes like hospital length of stay, intensive care unit days, or cost.

However, standard meta-analysis formulas for Mean Difference (MD) and Standardised Mean Difference (SMD) require sample means and standard deviations.

```
Which continuous summary format does the study report?
├── Mean and Standard Deviation (SD) -> Direct input into raw continuous fields.
├── Median, 1st Quartile (Q1), 3rd Quartile (Q3), and Sample Size (n)
│   └── Use Wan 2014 Scenario S2 (medianToMean)
└── Median, Minimum, Maximum, and Sample Size (n)
    └── Use Wan 2014 Scenario S1 (rangeToMean)
```

### Conversion Formulas Implemented in ResearchMD

ResearchMD implements the peer-reviewed methods of Wan et al. (2014):

1. **Scenario S2: Median and Quartiles (Q1, Q3, n):**
   - Estimated Mean:
     `Mean = (Q1 + Median + Q3) / 3`
   - Estimated SD:
     `SD = (Q3 - Q1) / (2 * Phi^-1((0.75 * n - 0.125) / (n + 0.25)))`
   - Where `Phi^-1` is the standard normal quantile function.

2. **Scenario S1: Median and Range (Min, Max, n):**
   - Estimated Mean:
     `Mean = (Min + 2 * Median + Max) / 4`
   - Estimated SD:
     `SD = (Max - Min) / (2 * Phi^-1((n - 0.375) / (n + 0.25)))`

### Critical Clinical Caveats

- **Normal Distribution Assumption:** The Wan 2014 formulas mathematically assume that the underlying patient data follow an approximately symmetric, normal distribution.
- **Heavily Skewed Data:** In medical research, when investigators report medians and IQRs, it is often because the data are severely skewed (for example, length of stay with a long right tail, or blood biomarker levels). In such cases:
  - The sample median does not approximate the sample mean.
  - Converting median/IQR to mean/SD can introduce substantial distortion.
  - A useful clinical heuristic: if the mean or median is smaller than twice the standard deviation, the data cannot be normally distributed if values must be non-negative.
- **Reporting requirements:**
  1. Clearly declare in your manuscript which study values were converted from medians.
  2. Always run a sensitivity analysis excluding converted studies to confirm that your primary conclusions do not depend on the conversion.

*Primary citation: Wan 2014. Cochrane Handbook v6.5, Chapter 6 (Section 6.5.2).*

---

## 10. Study Design Adjustments (Multi-Arm, Cluster, Crossover)

Standard meta-analysis formulas assume that every comparison consists of two independent, parallel groups of individual patients. When trials deviate from this design, adjustments are necessary to prevent unit-of-analysis errors.

```
Does the study design deviate from simple two-arm parallel RCTs?
├── Multi-Arm Trial (e.g. Dose A vs Dose B vs Control in one trial)
│   └── Risk: Double-counting the control group falsely inflates precision.
│       Solution: Use splitSharedControl to divide control events and n.
├── Cluster-Randomised Trial (e.g. randomization by clinic, hospital, or village)
│   └── Risk: Ignores clustering, artificially narrowing CIs and increasing false positives.
│       Solution: Use clusterAdjust to divide effective sample size by Design Effect.
└── Crossover Trial (e.g. patients receive Treatment A then Treatment B)
    └── Risk: Treating as parallel groups ignores paired within-patient correlation.
        Solution: Use crossoverAdjust using paired difference SE or imputed correlation.
```

---

### Multi-Arm Trials: Avoiding Double-Counting

- **The Clinical Problem:** A trial tests two active interventions (such as Drug 5 mg and Drug 10 mg) against a single Placebo control group. If both comparisons are entered into the same meta-analysis, the placebo patients are counted twice. This creates an artificial appearance of more patient data than actually existed, falsely narrowing the pooled confidence interval and introducing correlated errors.
- **The ResearchMD Solution:** The engine provides `splitSharedControl(arms)`:
  - Evenly splits the control group's sample size `n` and event count `events` across the active treatment comparisons.
  - Handles integer divisions cleanly without fractional patients: any remainder units are distributed one-by-one so the sum of the split control arms matches the original trial total.
  - Prevents unit-of-analysis errors per Cochrane Handbook v6.5 Chapter 23 (Section 23.3.4).

---

### Cluster-Randomised Trials: Adjusting for Intracluster Correlation

- **The Clinical Problem:** In cluster trials, whole clinics, general practices, or hospital wards are randomized rather than individual patients. Outcomes among patients within the same clinic tend to be more similar than outcomes across different clinics (intracluster correlation). Ignoring clustering treats patients as independent, yielding spuriously low p-values and overly narrow confidence intervals.
- **The ResearchMD Solution:** The engine provides `clusterAdjust(study, icc, meanClusterSize)`:
  - Computes the Design Effect (DE):
    `DE = 1 + (meanClusterSize - 1) * ICC`
  - Where `meanClusterSize` is the average number of patients per cluster, and `ICC` is the intracluster correlation coefficient.
  - For binary outcomes, both event counts and sample sizes in each arm are divided by DE:
    `Effective_n = n / DE`
    `Effective_events = events / DE`
  - For continuous outcomes, sample size is divided by DE while means and SDs remain unchanged.
- **Clinical Best Practice:** If the original paper does not report an ICC, search for published ICCs from similar trials or conduct sensitivity analyses across a range of plausible values (such as ICC = 0.01 to 0.05).

*Guidance reference: Cochrane Handbook v6.5, Chapter 23 (Section 23.1).*

---

### Crossover Trials: Accounting for Paired Observations

- **The Clinical Problem:** In a crossover trial, each participant receives both treatments sequentially in random order (separated by a washout period). Because each patient acts as their own control, within-person comparisons have substantially less variability than between-person comparisons. Analyzing a crossover trial as if it were a two-arm parallel trial wastes statistical power and overestimates variance.
- **The ResearchMD Solution:** The engine provides `crossoverAdjust(input)` with two supported approaches:
  1. **Paired Reported:** If the publication directly reports the paired mean difference and its standard error (`md`, `se`), the engine uses them directly.
  2. **Paired Imputed Correlation:** If the publication reports only arm summary statistics (`mean1`, `sd1`, `mean2`, `sd2`, `n`) along with an established within-patient correlation `corr` (r):
     `Var(MD) = (sd1^2 + sd2^2 - 2 * r * sd1 * sd2) / n`
     `SE = sqrt(Var(MD))`
- **Clinical Best Practice:**
  - Verify that the trial had an adequate washout period to prevent carryover effects.
  - If correlation r is not reported in the paper, never guess a single value without sensitivity testing. A common conservative default is r = 0.5, accompanied by sensitivity analyses across r = 0.2 to 0.8.

*Guidance reference: Cochrane Handbook v6.5, Chapter 23 (Section 23.2).*

---

## 11. Summary of Methodological Standards and Key References

The table below summarizes each statistical decision point, the corresponding chapter in the Cochrane Handbook for Systematic Reviews of Interventions (v6.5), the primary foundational paper, and the key rule enforced in ResearchMD.

| Statistical Topic | Cochrane Handbook v6.5 | Primary Citation | Key Takeaway for Clinicians |
|---|---|---|---|
| Effect measure selection | Chapter 6 | IntHout 2014 | Use RR for intuitive trial risk; OR for case-control; RD for absolute impact; MD for identical units; SMD (Hedges' g) for differing scales; log HR for time-to-event. |
| Pooling model | Chapter 10 | Veroniki 2016 | Random-effects is standard in clinical research due to patient and clinical diversity across trials; fixed-effect assumes zero between-study variation. |
| Heterogeneity variance (tau2) | Chapter 10 | Langan 2019; Veroniki 2016 | REML is recommended over DerSimonian-Laird. DL systematically underestimates tau squared in small meta-analyses. |
| Small-sample CI adjustment | Chapter 10 | IntHout 2014; Rover 2015 | HKSJ controls false-positive rates using Student-t distribution; use truncated variant if HKSJ CI is narrower than Wald CI. |
| Prediction intervals | Chapter 10 | Rover 2015 | Evaluates true effect dispersion in future clinical settings; calculated only when study count k is at least 3. |
| Zero-cell corrections | Chapter 10 | Veroniki 2016 | Add 0.5 continuity correction to all 4 cells. Double-zero studies are excluded from OR/RR pooling but retained for RD. |
| Subgroup and sensitivity analyses | Chapter 10 | IntHout 2014 | Subgroups must be pre-specified in the protocol; leave-one-out requires k at least 3 to detect dominant outlier trials. |
| Publication bias tests | Chapter 13 | Langan 2019 | Egger regression test requires at least 10 studies (k >= 10); testing with fewer studies is barred due to lack of power. |
| Median and IQR conversion | Chapter 6 | Wan 2014 | Converts median and IQR or range to mean and SD under normality assumption; caution with heavily skewed clinical data. |
| Trial design adjustments | Chapter 23 | IntHout 2014; Rover 2015 | Multi-arm split prevents double-counting controls; cluster adjustment accounts for ICC; crossover accounts for paired correlation. |

---

## 12. Checklist for Authors Prior to Protocol Lock and Analysis Run

Before locking your protocol in ResearchMD and executing your final analysis run on your mobile device, verify that you have addressed each of the following questions:

1. **Have you pre-specified your primary effect measure?**
   - RR, OR, RD, MD, SMD, or generic log HR documented in the protocol builder.
2. **Is your random-effects model plan documented?**
   - REML specified as the between-study variance estimator, paired with the Hartung-Knapp-Sidik-Jonkman (HKSJ) adjustment.
3. **Are your planned subgroup analyses limited and justified?**
   - Hypotheses pre-specified with clear biological or clinical rationale; exploratory post-hoc splits avoided.
4. **Have all study extractions been verified against source PDFs?**
   - ResearchMD requires 100% human verification of extracted data points before pooling. Unverified studies are blocked by the engine.
5. **Are study-design adjustments documented?**
   - Multi-arm control splits, cluster design effects, and crossover correlations recorded with full provenance.
6. **Are publication bias caveats respected?**
   - If your meta-analysis includes fewer than 10 studies, acknowledge that formal statistical tests for funnel plot asymmetry cannot be performed.
7. **Has a qualified biostatistician reviewed the analytical plan?**
   - Ensure protocol design and complex model choices have received specialist sign-off before manuscript finalization.
