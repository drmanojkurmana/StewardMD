# Adversarial verification — ovarian_fibroma.md

## 1. DOSE LEAK
None. Only digit occurrences in the file are "CA125" (lab test name, x2) and "12th ed" (edition
number in the citation line). No mg / mg-m2 / AUC / cycle-number / numbered schedule anywhere.

## 2. UNGROUNDED CLAIMS
None found that misattribute sourcing. Detail:

- Draft agent's self-report ("DeVita lines grounded: 0") is slightly overstated in the negative
  direction — DeVita's ovarian-cancer chapter DOES contain a short passage naming ovarian fibroma
  directly: "Benign solid tumors of the ovary include Brenner tumor, struma ovarii, and fibroma.
  Meigs syndrome is characterized by ascites, hydrothorax, and an ovarian tumor (most commonly a
  fibroma)." (devita.txt line ~177983-177984). This *supports* the sidecar's core Meigs-syndrome
  claim and its "benign solid tumor" framing, though it is one sentence, not a dedicated management
  section — so the sidecar's FLAG ("no dedicated section... guideline-general") is still accurate
  and not misleading.
- The sidecar's explicit contrast claim — that DeVita's chapter describes "a platinum/etoposide-
  based regimen" as adjuvant chemo for malignant granulosa cell/JGCT, and a GnRH analogue for
  advanced Sertoli-Leydig cell tumors, but that these do NOT apply to benign fibroma — is verified
  against DeVita text (line ~178406-178420): "bleomycin, etoposide, and cisplatin (BEP) regimen...
  has demonstrable activity in GCTs" and "Patients with advanced Sertoli-Leydig cell tumors may
  respond to gonadotropin-releasing hormone analogs." Sidecar's paraphrase ("platinum/etoposide-
  based") omits the bleomycin component of BEP — minor imprecision, not fabrication, and no dose/
  cycle numbers are carried over. The sidecar correctly does NOT apply this regimen to the fibroma
  itself, matching the draft agent's stated intent.
- All other clinical claims (oophorectomy/fertility-sparing tumourectomy, torsion as surgical
  emergency, Meigs resolving after excision, no radiotherapy/systemic therapy role, cellular/
  borderline-fibroma recurrence risk, Gorlin/NBCCS association with bilateral fibromas, TVUS/MRI
  low-T2-signal appearance, CA125 mildly elevated in Meigs) are well-established, uncontroversial
  gynecologic-oncology/benign-pathology facts, and every one of them is explicitly inline-tagged
  "(general oncology standard, not from DeVita's section on this disease)" or attributed to "the
  KB's existing reference entry" rather than falsely cited to DeVita. No specific trial name,
  statistic, or numeric regimen is asserted as DeVita-sourced when it isn't.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1).

Note for R1: draft agent's own summary ("DeVita lines grounded: 0") undersells slightly — DeVita
does contain one directly relevant sentence (Meigs syndrome/fibroma as benign solid tumor) that
corroborates the sidecar, plus a verified passage on the adjacent malignant sex-cord-tumor regimens
used only as a deliberate contrast. This does not change the verdict; the sidecar's hedging and
non-attribution discipline are correct either way.
