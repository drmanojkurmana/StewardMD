# Verdict: sinonasal_undifferentiated_carcinoma.md

## 1. DOSE LEAK
None. Grepped for mg / mg-m2 / Gy / AUC / cycle-N / day-N / qNw patterns: no hits. The only
numbers in the document are outcome statistics (5-year DFS 81% vs 54%; 5-year DSS 0% vs 39%)
and a survivorship timeframe ("two to three months," "one to two months" for a transient
CNS syndrome) — both lifted from DeVita's own reported figures, not doses/schedules. Correctly
no chemo dose, no RT dose (DeVita's text does state "70 Gy" for the OSU CRT series and the
sidecar correctly omits it), no AUC.

## 2. UNGROUNDED CLAIMS
One clear addition not traceable to DeVita's SNUC section (lines ~64977-65090, Ch. 28):

- "excluding NUT carcinoma or SMARCB1-deficient carcinoma, which mimic SNUC but behave and
  respond differently" (Induction chemotherapy section, poor-responder bullet). Grepped
  DeVita for "NUT carcinoma" and "SMARCB1" — both terms exist elsewhere in the book (lung/
  thymic NUT carcinoma discussion around lines 67501-67898; SMARCB1/epithelioid sarcoma/
  chordoma discussion around lines 213653-223329) but NEITHER appears anywhere near the
  sinonasal/SNUC chapter (28) or its differential table (Table 28.1, lines ~64420-64542,
  which lists SNUC vs. NEC vs. ENB by IHC markers only — no mention of NUT or SMARCB1).
  This is a real, clinically-accurate differential-diagnosis pearl (both are recognized
  SNUC mimics in the broader pathology literature) but it is NOT grounded in the cited
  DeVita text, and — unlike other passages in this same sidecar that explicitly tag
  non-DeVita content (e.g., the multidisciplinary-team sentence in "Overall approach") —
  this one is stated as plain fact with no tag, breaking the doc's own grounding discipline.

Everything else checks out, generally faithfully and conservatively (drug names/exact
agents deliberately generalized away from DeVita's specific "TPF" / "weekly carboplatin
or weekly carboplatin and paclitaxel" per the drafter's own stated omission):

- "Multimodality approach ... standard of care for SNUC" — confirmed near-verbatim, line
  ~64977.
- Amit et al. induction-response-stratified outcomes (81% vs 54% 5-yr DFS; 0% vs 39% 5-yr
  DSS in non-responders) — confirmed near-verbatim, lines ~64979-64990.
- OSU treatment algorithm (MRI/PET-CT → vision-loss triage → induction → response-based
  routing to CRT or surgery → surveillance with nasal endoscopy + imaging + lysis of
  synechiae) — confirmed, matches Figure 28.2 caption/flow lines ~64998-65017 (sidecar
  correctly generalizes "TPF induction chemotherapy" to "platinum agent, a taxane, and a
  fluoropyrimidine" and correctly omits the 70 Gy dose and specific carboplatin/paclitaxel
  detail).
- Surgical complication list (infection, poor wound healing, midface numbness/weakness,
  trismus, CSF leak, epiphora, hemorrhage; craniofacial resection: meningitis, subdural
  abscess, CSF leak, diplopia, hemorrhage) — confirmed near-verbatim, lines ~65020-65024.
- RT eye toxicity (medial-third irradiation preserves vision vs. whole-eye irradiation =
  near-certain vision loss; same patients would need exenteration if treated surgically) —
  confirmed near-verbatim, lines ~65029-65036.
- Transient CNS syndrome (vertigo, headache, decreased cerebration, lethargy; onset 2-3
  months post-treatment, resolves in 1-2 months); aseptic meningitis, chronic sinusitis,
  serous otitis media; septal perforation — confirmed near-verbatim, lines ~65076-65083
  (text continues past excerpt but matches known DeVita phrasing for this chapter).
- Proton therapy patient-reported outcomes (Pasalic et al., xerostomia/dysphagia measures,
  no chronic-follow-up changes vs. baseline, not SNUC-specific) — confirmed, lines
  ~65075-65082. NOTE: DeVita's actual finding is that proton therapy showed acute/subacute
  patient-reported toxicity that resolved by chronic follow-up (a within-cohort before/after
  finding, no photon comparator) — it does NOT establish that proton therapy reduces
  chronic toxicity relative to photon RT. The sidecar's framing, "an emerging option for
  reducing chronic patient-reported toxicity ... based on one outcomes series," is a mild
  interpretive overreach beyond what the single-arm study actually shows, though the
  sidecar's own caveat ("though this was not reported specifically for SNUC") partially
  offsets it. Not a fabricated statistic, but worth a wording tighten.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed. NCCN Guidelines (used for the general multidisciplinary-referral framing noted
above)." — name only, no page numbers, matches requirement.

## 4. VERDICT: ISSUES (minor)

- Untagged, ungrounded claim: NUT carcinoma / SMARCB1-deficient carcinoma as SNUC mimics is
  not in DeVita's SNUC section or differential table and should either be tagged "(general
  pathology standard, not from DeVita's section on this disease)" per the doc's own
  convention, or removed.
- Wording overreach on proton therapy: DeVita's cited study is a single-arm before/after
  series showing acute-not-chronic toxicity changes, not evidence that proton "reduces"
  chronic toxicity vs. photon RT — reword to avoid implying a comparative benefit that
  wasn't measured.
- No dose leak. No fabricated regimens, trial names/drug names, or statistics — survival
  percentages (81%/54%/0%/39%) all match DeVita's Amit et al. figures exactly, and the
  drafter correctly declined to fill in exact induction/CRT agent identities or the 70 Gy
  dose, per its own stated omission.

Not blocking, but R1 should decide whether to tag/trim the NUT/SMARCB1 sentence and soften
the proton-therapy framing before sign-off.
