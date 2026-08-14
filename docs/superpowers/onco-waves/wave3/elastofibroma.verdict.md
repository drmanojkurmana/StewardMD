# Adversarial verification — elastofibroma.md

## 1. DOSE LEAK
None. No mg, mg/m², AUC, or numbered schedule anywhere in the sidecar. The only numeric content is "Up to a third of cases are familial" (a fraction, not a dose) and prose fractions of a clinical description — no drug/dose numbers.

## 2. UNGROUNDED CLAIMS
DeVita's elastofibroma section (12th ed, Ch. 60 Soft Tissue Sarcoma, ~lines 212126–212244) contains, verbatim in substance: rare/slow-growing/benign, characteristic subscapular location, may be bilateral, may grow large, rarely at infraolecranon/ischial tuberosities (omitted by sidecar, fine), thought reactive/linked to repetitive manual tasks (omitted, fine), up to a third familial → bilateral subscapular diagnosable on history+imaging alone, unilateral/spontaneous disease → biopsy commonly employed, histology (eosinophilic collagen/elastic fibers + fibroblast-like cells), copy-number-alteration cytogenetics, and the single closing sentence: "If the diagnosis of elastofibroma is definitive, surgical resection can be reserved for the symptomatic patient." That's the entire grounding text — no drug therapy, no radiotherapy, no "marginal excision," no recurrence-rate statement, no complication (seroma/haematoma) statement.

Against that, the sidecar contains several claims not supported by the grounding text:

- **"Marginal excision is the surgical approach used, and it is generally curative for symptomatic disease with a low recurrence rate"** (Treatment section) and **"recurrence after marginal excision is uncommon"** (Monitoring section). DeVita's sentence only says resection "can be reserved for the symptomatic patient" — it does not name "marginal excision" specifically nor make any curative/recurrence-rate claim. Grepped `marginal excision` / `recurrence rate` / `low recurrence` across the whole devita.txt — no hits tied to elastofibroma. This is standard general surgical-oncology knowledge for benign soft-tissue masses (arguably "uncontroversial guideline-standard"), but it is presented as if drawn from the DeVita elastofibroma passage, and it isn't.
- **"Attention to surgical technique (adequate drainage/compression of the resulting cavity) matters because seroma or haematoma is the main complication of excision in this deep, often large, periscapular space"** (Role of surgery section). Grepped `seroma`/`hematoma`/`haematoma` in devita.txt — the only hits are in an unrelated neck-dissection complications passage (line 57715), nothing near the elastofibroma section. This specific surgical-technique/complication claim is fabricated relative to the cited source — it's not merely omitted background, it's an invented specific clinical detail attributed (by proximity/context) to the grounding text.
- **"When imaging and clinical context are classic, a confident diagnosis without biopsy is reasonable; biopsy should be reserved for atypical presentations..."** DeVita's actual statement is the reverse emphasis: for unilateral/spontaneous disease, "biopsy is commonly employed" — it does not say biopsy can be skipped for classic-looking sporadic lesions. The sidecar's diagnostic algorithm here is an extrapolation beyond what DeVita states, not a direct restatement.
- Minor: the rationale clause "given the differential includes other soft-tissue masses of the chest wall/back" (Diagnosis section) is the sidecar's own inserted reasoning, not stated in DeVita, though it's an uncontroversial clinical rationale rather than a specific fact claim.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES

- Fabricated/unsourced surgical-complication detail (seroma/haematoma as "the main complication," drainage/compression technique) not present anywhere in DeVita's elastofibroma passage or nearby text — should be cut or explicitly flagged as general surgical knowledge, not DeVita-derived.
- "Marginal excision," "generally curative," and "low/uncommon recurrence" for elastofibroma are not stated in the DeVita passage (only "surgical resection can be reserved for the symptomatic patient" is stated) — currently presented as if grounded; should be softened or marked as outside-DeVita general knowledge.
- The no-biopsy-if-classic-imaging framing inverts/extends DeVita's actual statement about unilateral disease (which says biopsy is *commonly employed*, not skippable) — recommend rewording to track the source more closely.
- Dose/regimen leak check: clean, no numeric doses found.
- Citation line: present and correctly formatted.

Recommend the draft agent trim the three flagged clinical-detail claims (or explicitly caveat them as general surgical knowledge beyond the DeVita citation) before this goes to R1.
