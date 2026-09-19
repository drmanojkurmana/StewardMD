# Review: "StewardMD + MAiK Medical Core" plan

Reviewed 2026-09-19 against the code in this repo and the vault notes. Verdict first, then section
by section, then the things the plan does not say that decide whether it can happen at all.

## Verdict

The premise checks out and the safety posture is right. The plan is wrong about the repository it is
planning for: roughly half of what it proposes to build (event bus, safety layer, alert identity and
deduplication, shadow deployment, drift and subgroup gating, auto rollback, versioned audit,
deterministic calculators, refusal-on-incomplete-data semantics) is already built and tested in
`wardsynq/`, and the plan does not reference any of it. Rewritten as "what plugs into WardSynQ", it
shrinks by more than half.

The one genuinely load-bearing item, labelled clinical training data, gets one section (9) and is
the entire critical path. Nothing from M2 onward can start without it, and it is not an engineering
task.

## 1. The external premise is real (verified, not assumed)

TypeSafe's Jev and the "System One model" category are real and were announced on 2026-09-15:
typed decisions with calibrated probabilities instead of text, a parallel sampler rather than
autoregressive decoding, and a training method the company calls RLCD (Reinforcement Learning for
Calibrated Decisions). The plan is correct that the RLCD implementation is not public, and correct
to say "RLCD-inspired" rather than claiming to reproduce it.

Sources: [TypeSafe AI blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev) ·
[DataCamp](https://www.datacamp.com/blog/system-one-models-jev) ·
[MindStudio on RLCD vs RLHF](https://www.mindstudio.ai/blog/typesafe-jev-rlcd-vs-rlhf)

What does not follow from that premise: that StewardMD needs the same architecture. Jev is a general
decision model over arbitrary typed tasks. The Medical Core as scoped here is ~50-100 decisions over
20-60 tabular clinical variables and their trends. Those are different problems.

## 2. What the plan proposes that already exists

| Plan section | Already in this repo |
|---|---|
| 8, deterministic engine | `calculators.js` + `icu-autoscores.js`. SOFA, qSOFA, APACHE II, NEWS2, GCS, RASS, CURB-65, MELD, Child-Pugh, Wells, CHA2DS2-VASc all present. **Only CAM-ICU is missing** from the plan's list: it exists in `icu.js` only as a rounds-checklist prompt (line 2715), not as a calculator. |
| 14, abstention | `wardsynq/wardsynq-deterioration.js` already refuses rather than approximates: a missing parameter is never 0, stale observations are rejected with a reason, Scale 2 only where prescribed, under-16 refused to PEWS, obstetric refused to MEOWS. `wardsynq/wardsynq-vitals.js` is the shared "is this observation usable" gate and filters IoMT artefact. |
| 15, safety layer | `wardsynq/wardsynq-safety.js` (pure, injected rule pack), plus the design rule that the eMAR contains no pharmacology. |
| 16, alert fusion | `wardsynq/wardsynq-orchestrator.js` already holds one alert identity across channels so a push, a pager and a station screen are one answerable alert. `wardsynq/wardsynq-recognition.js` already implements prompt-not-alert with per-patient-per-code deduplication. |
| 17, versioned auditable output | `wardsynq/wardsynq-lineage.js`, the bi-temporal store (`wardsynq-store.js`, `wardsynq-temporal.js`), append-only with full history. |
| 20, event-driven inference | `wardsynq/wardsynq-events.js` (`ClinicalEventBus`: vector clocks, idempotent emit, bounded retry, dead-letter). |
| 21, 24, 25, 26 | `wardsynq/wardsynq-mlops.js` already refuses to mark a model deployable on retrospective numbers, enforces shadow mode meaning the output reaches nobody, detects drift on inputs not only outputs, rolls back automatically on a floor breach, and treats a subgroup failure as a failure. `wardsynq/wardsynq-shadow.js` is a working shadow harness. |
| 23, provenance | The `meta` envelope on every WardSynQ entity (`recordedAt` / `effectiveAt` / `amendedAt`, `source`, `derivedFrom`). |

Action: rewrite sections 8, 14, 15, 16, 17, 20, 21, 23, 24, 25 and 26 as integration contracts
against those files. Anything that ends up duplicating them is a second system with a second idea of
what "delivered", "current" or "deployable" means, which is the failure WardSynQ was written to end.

## 3. The critical path is data, and the plan buries it

Section 9 is the whole project. There is no clinical dataset in this repository, no data access
agreement, no ethics approval, and no labelling program. The vault already records the shape of this
problem for WardSynQ: "blocked on people, not on code" (`vault/Roadmap.md`).

Before M1 is worth starting, three questions need answers from outside engineering:

1. Which hospital provides retrospective ICU/ward data, under what agreement, de-identified by whom?
2. Who adjudicates labels, and what is the per-label prediction window and outcome window?
3. Who is the named clinician or committee that can move anything to CLINICALLY APPROVED
   (`vault/modules/WardSynQ.md` status taxonomy, level 4, which nothing currently holds)?

If those have no answer, the honest plan is a 3-month gate: pursue data access only, build nothing
past a paper label specification, and stop if access does not materialise.

## 4. Four data hazards the plan does not mention

1. **Measurement frequency is a shortcut feature.** Sick patients are observed more often. A model
   given timestamps learns "how often was this patient measured" and scores well on retrospective
   data while learning nothing clinical. It collapses in prospective use. This must be tested for
   explicitly (train a model on frequency-only features and show it is not competitive).
2. **The treatment paradox.** Outcomes in retrospective data are contaminated by the care that
   existing alerts and clinicians already delivered. A patient who deteriorated and was rescued is
   labelled as not deteriorating. Section 9.4's "rule != ground truth" gets at a corner of this; the
   general form is bigger and affects every label in section 7.
3. **Units.** `vault/modules/WardSynQ.md` records that GHIS `wardToSI` converts SI-labelled results
   *back* to conventional units, and that the adapter therefore deliberately does not normalise at
   all (`unitNormalised: false`, `sourceValue`/`sourceUnit` kept verbatim). A model fed those values
   is being fed mixed units across sites. Normalisation for the model is a new, separately verified
   step, not something to assume the adapter did.
4. **`dob` is an age.** Same note, trap 1: GHIS sends age in years as a string. Any feature builder
   that parses `dob` as a date produces patients born in year 45.

## 5. The architecture choice is probably wrong for the data volume

80-100M parameters, 6-8 layers, a tokenizer and a bidirectional transformer, for ~50-100 decisions
over structured vitals, labs and their trends. This is likely to be a model far larger than the
dataset can support, and an uncalibrated large model is exactly what section 30 says not to build.

Recommend inverting the order:

- Baseline first: per-signal regularised logistic regression and gradient-boosted trees on
  hand-built temporal features (current value, delta, rate of change, time since last measurement,
  missingness indicators), with isotonic or Platt calibration. These are strong on tabular clinical
  data, train on thousands rather than millions of examples, are inspectable by a clinician, and
  give the calibration metrics in section 13 immediately.
- A shared encoder is justified only if it beats that baseline on the same split, on the same
  operating points, with the same calibration. Section 12 already says "require measurable benefit"
  for the RLCD stage; apply the identical rule to the transformer itself.
- Parameter count then comes out of the benchmark, not out of the plan.

The repo has the pipeline experience to do either: MaiK Lite is StewardMD's own LoRA fine-tune
served on device, and the CRNN-CTC digit reader (1.5M parameters, 3MB) ships on both platforms from
one checkpoint via PyTorch to ONNX to TFLite. Training capability is not the constraint. Data is.

## 6. 50-100 signals is too many to start

Most of section 7's list are not independent labels. "overall deterioration", "rapid deterioration",
"worsening trajectory" and "multisystem deterioration pattern" are four names for one outcome with
different thresholds, and each needs its own adjudicated definition, window and inclusion criteria
(section 9.1's own requirement). Eighty of those cannot be defined rigorously by one team.

Start with at most 8, each with a written outcome definition: unplanned ICU transfer within 24h,
cardiac arrest within 24h, new vasopressor within 12h, new invasive ventilation within 24h, AKI
stage 2+ within 48h, and so on. Every one of those is an event with a date in the record, which is
what makes it labellable at all. "Respiratory deterioration" is not.

## 7. Deployment conflicts with the actual infrastructure

Section 21 proposes a hospital server as the primary target. There is no on-prem product today:
StewardMD is mobile-only Capacitor calling `stewardmd.in/api/*`, hosted on Cloudflare Pages and
Workers with Firebase and R2 (`vault/Infra.md`), and GHIS is a site adapter reached from the phone.
A central per-hospital deployment is a new product line with its own install, update, backup and
support story.

Also, section 17's `MedicalCoreService` payload carries `patient_id` plus full vitals and labs to a
service. That is against the current posture, which is deliberate and documented: pushes carry no
patient name, MRN, test or value (`wardsynq-alert-ui.js`, owner decision O3), and MaiK receives
de-identified context. Any Medical Core transport needs the same treatment: pseudonymous id,
hospital-scoped credential, and a server that 404s another hospital's record before reading it.

Realistic options to put to the owner, in order of cost: (a) on device, int8, same runtime path as
KardiQ X and ThoreX; (b) in the Worker, CPU only, which bounds the model size hard; (c) on-prem,
which is a product decision, not a deployment detail.

## 8. The UI mock is alert fatigue

Section 18 shows Deterioration HIGH, Respiratory HIGH, Hemodynamic HIGH, Renal MODERATE in one card.
Four correlated signals about one deteriorating patient presented as four findings is the duplicate
alerting section 16 is meant to prevent. One patient, one signal, with the systems as its evidence.

Two repo rules the mock breaks: all ICU styling lives in one place (`injectCSS()` in `icu.js`), and
status colour is reserved for status (`vault/modules/ICU.md`). A new panel with its own colour
vocabulary is not how this app is built.

## 9. What is worth building now, with no training data at all

The two most useful parts of the section 18 mock need no learned model:

- **"What changed"**: MAP falling, SpO2 falling, lactate rising. This is deterministic trend
  detection over `mergedVitals` / the WardSynQ flowsheet, and it is genuinely missing today.
- **"Missing information"**: no recent urine output, no current mental status. This is a coverage
  check against what the existing scores need. `icu-autoscores.js` already returns
  `{__missing:[...]}` per score, so the data is there and unused at the patient level.

Both are flag-gated, testable today, and would carry most of the clinical value of the panel while
the data question is being answered. They also produce the feature builder that a model would later
need.

## 10. Process corrections

- **M0's deliverable is wrong.** `STEWARDMD_CURRENT_ARCHITECTURE.md` duplicates the vault and will
  drift within a week. `CLAUDE.md` puts architecture in `vault/`. M0 should produce
  `vault/modules/Medical Core.md` plus edits to `vault/Home.md`, `vault/Roadmap.md`,
  `vault/Flags.md` and a `vault/decisions/Decisions.md` entry.
- **Flag and recovery point.** Per the repo conventions this needs `smd_medcore`, default OFF,
  shadow-only at first, listed in `vault/Flags.md` with the reason, plus a git tag before the first
  integration commit.
- **Hazards, not a parallel evaluation document.** Sections 24 to 26 should become a new hazard
  (say HAZ-ML-01) in the existing safety case so that `node scripts/wardsynq-assurance.mjs` reports
  on it. A model evaluated outside the assurance script is evaluated where nobody looks.
- **Status words.** Adopt the four levels from `vault/modules/WardSynQ.md` (IMPLEMENTED, VERIFIED
  software, VERIFIED device, CLINICALLY APPROVED) throughout the plan. Section 25's stages map onto
  them cleanly and the plan currently has no vocabulary for "built and tested but clinically
  worthless", which is where every milestone before M7 lands.
- **Regulatory owner unnamed.** A calibrated probability displayed to change clinical behaviour is a
  decision-support claim. Sections 25 and 27 describe the evidence but name nobody who accepts it.

## 11. What the plan gets right and should keep unchanged

- Section 8's split: the deterministic calculator owns the exact score, the model only notices.
- Section 15's hard rule: no path from a probability to an order.
- Section 14: abstention as a first-class output, not a low probability.
- Section 27: measuring alerts per patient per day and override rate, not only AUROC.
- Section 30's list of what not to build, especially "another independent alert engine".
- Section 32's division of labour, which matches how this repo is already built.

## Recommended next step

Do not start M1. Split the plan in two:

1. **Now, engineering.** The deterministic "what changed" and "missing information" work in section
   9 above, behind `smd_medcore`, plus the CAM-ICU calculator gap. No model, no data dependency.
2. **In parallel, not engineering.** Answer the three data questions in section 3. If they are
   answerable, the first model milestone is a calibrated per-signal baseline on 8 adjudicated
   labels, evaluated inside the WardSynQ assurance script, in shadow mode, reaching nobody.
