---
tags: [module, stewardship, clinical-data]
status: rebuilt 2026-09-26 (flag ON). Data read from published Indian antibiograms; every number traceable to its page.
flag: smd_abg_v2 (antibiogram-flags.js, def:true, ?abg2=0 restores the previous resistance view on the same data)
redesign: smd_abg_pro (def:true, 2026-09-27; ?abgpro=0 or localStorage smd_abg_pro=0 restores the previous look and the four tabs; pre-redesign main is 3983aeac6)
kill-switch: smd_abg_data (def:true; ?abgdata=0 or localStorage smd_abg_data=0 makes the console, reasoning and antibiotic choice ignore the store and use the built-in ICMR 2024 national summary in app.js, as before the rebuild)
---
# Antibiogram

Cumulative antibiograms (percent of isolates susceptible, by organism, antibiotic, specimen and setting)
from Indian hospitals, surveillance networks and published hospital studies. One data layer feeds four
places:
- **Antibiogram screen** (Knowledge Library tab and `window.ABG.open()`): tabs **Spectrum** (the qualitative
  spectrum grid), **Resistance** and **My hospital**. **Sources** opens from the action row under the table
  (Export CSV, Save as PDF, Sources) and keeps Resistance selected, with a back link. With `smd_abg_pro=0`
  the previous four tabs (Antibiotic coverage, Resistance rates, Sources, My hospital) return.
- **Stewardship console** Step 4 (`asp-region.js` augments the minified `window.ASP`): the syndrome's
  organisms for the active profile.
- **Syndrome reasoning** (`reasoning.js` `regionSuscHTML`): resistance chips for the lead syndrome.
- **Profiles** (`policy.js` `window.HOSPITAL`): one active profile app-wide (ICMR default).

## Files
| File | Role |
|---|---|
| `data/antibiogram/sources/<ID>.json` | One file per source document (institution edition, network report, study), as read from the PDF. Schema in the header of the build script. |
| `data/antibiogram/register.json` | The census: every antibiogram found on Indian websites, integrated or not, with the reason. |
| `scripts/build-antibiogram.mjs` | Validates every source, applies the rules, derives combined rows, cross-checks count tables, writes the bundle, `antibiogram-data.js` and `validation-report.json`, and syncs `?v=` tokens. `--check` (CI guard), `--validate`, `--file <path>` (one source, for extraction). |
| `antibiogram-rules.js` | UMD (browser + node). Dictionaries (drugs with lab codes and WHO AWaRe 2023, organisms, specimens, settings), intrinsic resistance (CLSI M100 App. B, EUCAST expected phenotypes), `validateRow`, pooling, phenotype rates, WISCA, CSV imports. |
| `kb/antibiogram/antibiogram.json` | Built bundle (compact rows). Fetched by the store, `?v=` = bundle version. |
| `antibiogram-data.js` | GENERATED. Only `window.ABG_INDEX` (version + source list) so profile pickers exist before the bundle loads. The old literature composite (`window.ABG_DATA`) is gone. |
| `antibiogram-store.js` | `window.ABG_STORE`: load, scopes, `table`, `cell`, `phenotypes`, `wisca`, `rank`, `trend`, `susceptibility`, `legacyAbg`, syndrome strata, device-local import. |
| `antibiogram-v2.js` | `window.ABG_V2`: the Resistance, Sources and My hospital tabs inside `antibiogram.js`. |
| `antibiogram-flags.js` | `window.SMD_ABG_FLAGS`: `on()` = flag `smd_abg_v2` (the screen), `data()` = kill switch `smd_abg_data` (decision support). `policy.js` reads the kill switch directly when this file has not run yet (it loads later). |
| `scripts/abg-migrate-legacy.mjs` | One-off: moved the 20 literature studies of `data/antibiogram-raw.json` and the GIMSR/ICMR tables that were typed into `app.js` into source files. |

## How a number gets to the screen
1. **Extraction** (per document): text layer (pdfplumber) or page image, then compared value by value with
   the rendered page. `verification.status`: `double-checked`, `single-checked` or `transcribed` (the
   ICMR 2024 summary that was typed into app.js without isolate counts). Brief:
   `EXTRACT.md` in the session scratchpad; the rules it states are also in the build script header.
2. **Rules** (`validateRow`), each cell gets an action the app shows:
   - `intrinsic`: never a number (e.g. Klebsiella ampicillin, enterococci and cephalosporins, Salmonella
     aminoglycosides per CLSI).
   - `hide`: not relevant to the specimen (nitrofurantoin outside urine, daptomycin in respiratory,
     tigecycline/eravacycline/moxifloxacin in urine: too little reaches the urine, IDSA 2024).
   - `suppress`: impossible (an MRSA row that is beta-lactam susceptible; a mixed S. aureus row more
     beta-lactam susceptible than cefoxitin susceptible).
   - `caution` also for exceptional resistance that needs confirmation before it is believed
     (`unusualReason`: staphylococcal vancomycin under 90, S. aureus linezolid under 90, typhoidal
     Salmonella carbapenems under 95, beta-haemolytic streptococci and penicillin/ampicillin under 95,
     pneumococcal vancomycin/linezolid under 95; enterococcal and CoNS linezolid deliberately not, India
     has real resistance there) and tetracycline more than 15 points above doxycycline or minocycline.
   - `caution`: shown in grey with `*`, never pooled, never used by reasoning: approximate (estimated
     from a bar height; printed chart labels are exact), arithmetically impossible for n, cefotaxime vs
     ceftriaxone > 20 points apart (Enterobacterales), imipenem vs meropenem > 25 (E. coli, Klebsiella),
     fosfomycin outside urine, colistin/polymyxin B under 50% for Enterobacterales and non-fermenters
     (CLSI has no susceptible category; the cell sheet says a figure is the share intermediate), and
     `conflict`: the extractor found the source contradicting itself
     (ICMR 2024 prints Morganella urine amikacin 8.6% where its counts give 121/154 = 78.6%; the
     arithmetic check cannot catch that, 8.6% is possible for some n).
   - Row flags: `lowN` (n < 30, CLSI M39), `noN`. A drug tested on fewer than 30 isolates (`nt`) is
     treated as low too (ICMR HAI UTI E. faecalis linezolid 1/5), even in a row of 61.
3. **% resistant reports** (NARS-Net, state networks): `r:{}` or `measure:"R"`; stored as 100 - %R with
   the cell marked `fromR`. Intermediate then counts as susceptible; the cell sheet says so.
4. **Derived rows** (marked "combined", `how` says from what): S. aureus from MRSA + MSSA (cefoxitin %S
   from the counts); all settings and all inpatients from ward/OPD/ICU; all specimens from specimen rows.
   Only when complete: every setting (or specimen) the source reports, including those only in its count
   tables, is present, or its count is 0, or under 10% is missing (said in `how`). "All specimens except
   urine" combines only with urine (no double counting). ICU device-infection rows (`cohort:"hai"`) are
   never combined.
5. **Count checks**: rows are compared with the source's own organism count tables; mismatches go to
   `validation-report.json` and the source sheet ("The source's own tables disagree"). SKIMS 2025 has 5
   (respiratory S. aureus IPD/OPD swapped between tables; pus Acinetobacter IPD/ICU 60 isolates apart;
   pus OPD Enterococcus 16 in the organism table against 20 in the antibiogram table).
   Not a disagreement: a genus line that means "other species" (the count table also lists the
   species), species rows adding up to less than a genus count (species without a row), an
   all-settings row above its summed location counts (isolates without a location), and rows marked
   `n_tested` (the table's n is isolates tested, e.g. ICMR 2023 Tables 4.2/4.5).
6. **Carried-over figures** (`copyChecks`): a row that repeats another row of the same institution
   value for value (6+ identical figures, at least 75% of the shared ones, 4+ strictly between 0 and
   100) is copied, not new data.
   Across editions the later row's figures become cautions; within one report both rows (when their
   n differ). Listed on the source sheet under "Figures repeated from another table or edition".
   Catches NARS-Net 2025 reprinting the 2024 outpatient and ICU urine E. coli series.
7. **Pooling** (India, regions): isolate-weighted mean of the latest edition per institution, only
   `keep` cells, rows with n >= 30, only `kind:"institution"` sources without `focus` whose data year is
   within the five most recent (`poolFrom`). Networks are never pooled with institutions (same isolates
   twice); published studies and focus reports are never pooled either (shown on their own).
   Pooled "all settings" takes each institution's all-settings row, else its all-inpatient row; ICU-,
   ward- and OPD-only reports pool under their own setting. A pooled single-setting figure needs 3
   institutions, else the stratum picker uses all settings.

8. **Other groups**: a genus line printed beside larger species rows is "the rest" (AIIMS Bhopal "Other
   Enterococcus sp."), filed as the genus's `_other` key (enterococcus_other, enterobacter_other,
   citrobacter_other, streptococcus_other, burkholderia_other, candida_other, providencia_other,
   shigella_other; `markOtherGroups` in the build), so "Enterococcus spp." combines E. faecalis and
   E. faecium instead of answering from 14 leftover isolates.
9. **n from the organism table** (`nFrom`): a susceptibility table without its own n takes the exact
   organism count of that stratum, and the screen says so.
10. **Breakpoints**: `breakpoints` (source key) records the standard as the document states it
   ("CLSI M100, 33rd edition", "CLSI, edition not stated"); absent = not stated (54 of 108 sources). The source
   sheet shows it. `BP_CHANGES` (rules) lists CLSI revisions that move %S without any change in the
   bacteria: fluoroquinolones 2019 (Enterobacterales except Salmonella, P. aeruginosa), polymyxins 2020
   (intermediate and resistant only), piperacillin-tazobactam 2022 (Enterobacterales) and 2023
   (P. aeruginosa), aminoglycosides 2023 (Enterobacterales, P. aeruginosa; Aggarwal, IJMM 2024: Indian
   isolates re-read lose about 15 points of gentamicin and 22 of amikacin). A trend or pool whose data
   years straddle one (edition year, or the year before) carries the note; citations are in the code.

## Profiles (policy.js)
`HOSPITAL.list` = base hospitals + `INDIA_POOLED`, `REGION_*`, `ABG_<source id>` (latest edition per
institution, every network) and `LOCAL` (the device-local import). Each has `abgScope` (a store scope:
`india`, `region:north`, `src:<ID>`, `inst:<INST>`, `local`). The ICMR profile reads the newest ICMR AMRSN
source with isolate numbers, else the transcribed summary. `HOSPITAL.optionsHTML(cur)` is the one grouped
picker (National, Pooled, each region, My hospital, Other hospitals). Old ids (`ABG_SGRD_KLEB`) alias.
`getSusceptibility(org, drug, {spec, set})` returns only n >= 30 figures, else the national fallback
marked `national` (the national summary is never returned as a profile's own figure). An equivalent agent
answers when the report printed only the other one, and the result names it (`as`, `asKey`):
cefoxitin/oxacillin for staphylococci, cefotaxime/ceftriaxone (same CLSI and EUCAST breakpoints) except
for N. gonorrhoeae. Reasoning shows one chip per agent actually tested. Profiles need `usable >= 3`
cells (SAVEETHA-type one-row studies are not hospital profiles); focus reports are never profiles.
Kill switch off: `getSusceptibility` and `getAntibiogram` skip the store; asp-region.js leaves the
console's own ICMR block untouched.

## Syndrome strata (store `SYN`, `synCtx(synId)`)
The stratum is chosen **per organism** (`pickStratumFor`): ICMR prints Enterobacterales for "all
specimens except urine" but staphylococci by specimen, so one stratum per scope would hide E. coli for
sepsis. Options per syndrome: `cohort:"hai"` (catheter UTI, VAP, device infection read ICU
device-associated surveillance first; no other syndrome ever does) and `only` (pneumococcal meningitis:
CSF figures or none, never blood figures read with non-meningeal breakpoints). Staphylococcal cefoxitin
and oxacillin answer for each other.

Specimen preference list + setting per syndrome: UTI urine (OPD for cystitis/pyelonephritis, inpatient for
complicated/catheter); pneumonia respiratory (ICU for VAP and severe CAP); SSTI pus then deep; meningitis
CSF, sterile fluids, blood; cholangitis/SBP sterile fluids then blood; sepsis/FN/IE/device blood; enteric
fever blood; diarrhoea stool; "all specimens except urine" next for non-urinary syndromes, then (except CNS
syndromes, `noAll`) "all specimens", which includes urine isolates: a source that prints only an
all-specimen table is still used, and the console says so ("the figures for all specimens are shown instead
(they include urine isolates)"). A syndrome never gets a different named specimen's figures (no urine data
for meningitis): the result is empty instead.

Setting fallbacks stay in the syndrome's world (`candidates`): ICU or ward syndromes fall back to all
inpatients, then all settings; outpatient syndromes to all settings only (never ICU figures); CNS
syndromes (meningitis, encephalitis, brain abscess: `noAll`) never fall back to all-specimen figures.

Agents a syndrome cannot rely on are left out, with the reason, by the console and reasoning (`synDrug`,
store): urine-only agents (nitrofurantoin, fosfomycin, norfloxacin, nalidixic acid) outside cystitis;
tigecycline, eravacycline and moxifloxacin for urinary syndromes; tigecycline and eravacycline for
bloodstream syndromes; daptomycin for pneumonia; the `NO_CNS` list (first- and second-generation
cephalosporins, amoxicillin-clavulanate, macrolides, clindamycin, tetracyclines, tigecycline,
eravacycline, daptomycin) for CNS syndromes.

## My hospital (device-local)
Summary CSV (organism, specimen, setting, n, drug columns of %S, lab codes accepted) or isolate list
(patient, date, specimen, location, organism, S/I/R columns): CLSI M39 first isolate per patient per
organism, %S = S / tested (I and SDD not susceptible), MRSA expert rule (methicillin R makes every
beta-lactam R except ceftaroline) and MRSA/MSSA rows. Patient IDs are hashed in memory and never stored;
only the summary is saved (`smd_abg_local`). It becomes profile `LOCAL`; never pooled.
A summary file can be % susceptible or % resistant (a two-way choice; % resistant is stored as 100
minus and each figure says so). The check questions the other reading when intrinsic resistance comes
out near 100 as "% susceptible" (Klebsiella ampicillin 100) or near 0 as "% resistant", or when a
header says resistant, with a one-tap re-read. Drug columns may carry their unit ("Meropenem %S").

## Exports and accessibility
CSV and the printable page carry the source, period, citation (or the institutions pooled), data
version, date, every figure with a caution marked `*` and listed with its reason under Checks, low-count
rows, and derived rows. On the web the button prints (Save as PDF from the print dialog); native shares
a PDF. Every figure in the table is a `<button>` inside its cell (Tab, Enter or Space; the table keeps
its headers for screen readers; the button's label names organism, agent and value). Search says what
it matched, and says so when nothing did.

## Gotchas
- `ABG_STORE.table()` results are memoised and shared: never mutate them. The memo clears on load and
  on local import changes.
- After editing a source file, the rules or the store: `node scripts/build-antibiogram.mjs` (tokens,
  bundle, index). The version hash covers the rules and the store, so their `?v=` tokens move with it.
  `antibiogram-v2.js`, `antibiogram.js`, `asp-region.js`, `policy.js`, `reasoning.js` tokens are bumped by hand.
- The old `window.ABG_DATA` no longer exists. Anything new must go through `ABG_STORE` / `HOSPITAL`.
- Caution cells render grey on purpose (a failed figure must not look reliable). Do not "fix" to colour.
- `app.js` still carries `ASP_ABG` (national summary + GIMSR) for the minified console's own block,
  which asp-region.js hides; it is the fallback before the bundle loads.
- Species keys: K. oxytoca, K. aerogenes (ex Enterobacter aerogenes), E. cloacae complex, P. stuartii
  (intrinsic gentamicin/tobramycin/netilmicin) and P. rettgeri are separate from the genus groups
  "Klebsiella pneumoniae / spp.", "Enterobacter spp.", "Providencia spp.".
- Cohort rows (`cohort:"hai"`) are kept apart everywhere: dedup keys, pooling groups, derivation.
- CoNS species: S. epidermidis, S. haemolyticus, S. hominis and Other CoNS have keys (parent `cons`);
  a CoNS query combines them isolate-weighted. All stay out of blood WISCA by default (contaminants).
- `focus` (source key): what a report covers when it is not a hospital-wide cumulative antibiogram
  (KARS-NET Shigella 2026, SGPGIMS departments, and 16 of the 18 journal studies, e.g. SRM Chennai:
  carbapenem-resistant isolates only). Shown as "Covers X only", never pooled, never a profile. Give it
  its own `inst` so it never becomes a network's "latest edition".
- Journal studies (`kind:"study"`, 18) are shown on their own and never pooled; their notes were
  rewritten for clinicians on 2026-09-26 (method detail is in `verification.note`). SAVEETHA_URO was
  removed (four strains' zone diameters, no percentages).
- Enterococcal gentamicin: plain `gentamicin` is shown as intrinsic (low-level). Only a paper that says
  high-level gentamicin gets `gentamicin_hl` (ASSAM, KIMS Bhubaneswar, RML Lucknow, HAYES, IGGMC,
  MG Jaipur). SKIMS and others print "gentamicin" without saying which: left as intrinsic.
- Screens that show "page N" (antibiogram overlay, console panel, reasoning panel, toast) carry the
  class `smd-books-keep`, or the app-wide emoji-icons scrub deletes page numbers as book citations.
  Toasts go through `window.ABG.toast` for the same reason.
- `specimen_as_printed` reaches the screen ("Specimen as printed") when the key is broader than
  what the source printed. NCDC-protocol "Pus aspirate (PA)" is filed as `deep` in every network.
- Trend links renamed rows across editions (Proteus spp. one year, P. mirabilis the next); such a
  point says "reported as". The WISCA "no data" share uses each source's exact setting count.
- Order when data change: `node scripts/abg-register.mjs` THEN `node scripts/build-antibiogram.mjs`
  (the register goes into the bundle). Commit `antibiogram-store.js` too: the build writes its ABG_V.
- **Review round 2 checks (2026-09-26)** in `validateRow`, each a caution only when the two figures describe
  (nearly) the same isolates (tested numbers within 25%; ICMR tests levofloxacin on a subset):
  ciprofloxacin/levofloxacin gap over 35 (all bacteria), and for Enterobacterales and staphylococci
  ciprofloxacin or ofloxacin more than 10 above levofloxacin; imipenem/meropenem gap over 25 for
  Enterobacterales except the Proteeae, over 30 for P. aeruginosa and Acinetobacter (not Burkholderia or
  Stenotrophomonas); penicillin/ampicillin (or amoxicillin) gap over 25 in streptococci; ampicillin or
  amoxicillin more than 10 above amoxicillin-clavulanate or ampicillin-sulbactam. `unusualReason` adds
  S. aureus teicoplanin under 90, beta-haemolytic streptococci vancomycin or linezolid under 95, and
  Gram-positive tigecycline under 90. High-level gentamicin/streptomycin outside enterococci is hidden.
- **Review round 3 (2026-09-26)**: Enterobacterales hierarchy cautions (ceftriaxone or cefotaxime more than
  20 above meropenem or imipenem; ertapenem more than 10 above meropenem; cefuroxime more than 10 above
  ceftriaxone or cefotaxime; gentamicin more than 20 above amikacin). Imipenem far below meropenem questions
  imipenem only (unstable disks); the reverse questions both. S. aureus: penicillin above an oxacillin of 0 is
  suppressed; a penicillinase-stable beta-lactam (not piperacillin alone or ceftazidime) more than 20 below
  methicillin is a caution; cefoxitin/oxacillin must agree within 20. Daptomycin: E. faecium has no
  susceptible category (CLSI 2019+), E. faecalis under 90 is exceptional. WISCA counts an intrinsic 0 only
  when the drug is measured for some organism in the mix. Pooled lookups walk on through the syndrome's
  strata to the first figure from 3 institutions (`candidatesFor`, `suscAt`); institutions count only if
  they contribute a usable row, and a region is pooled only if some stratum has a pooled figure (the West
  had none: AIIMS Bhopal, BVDU and SKNMC rarely report the same stratum). Cells from too few institutions
  carry `few` and say so ("too few institutions", not "failed a data check").
- **Review round 4 (2026-09-27)**:
  - **Clinical antibiograms**: `clinical: "what it is"` marks a table that combines laboratory results with how
    patients responded to treatment (AIIMS Rishikesh MICU 2023 p18 and Rishikesh 2024 book p107, HAP/VAP).
    Every figure is a caution and the build adds the row flag `clinical`; the store treats such a row as not
    usable (`rowUsable`, `usableInfo`, WISCA `mix`, pooled `usable`, `legacyAbg`), so VAP in the MICU
    profile reads the unit's laboratory table (meropenem 3.9), never the clinical 46.66.
  - **Paired checks read the figures as they stood after the per-cell checks** (`base` in `validateRow`), so
    one check never shields its partner. SKIMS 2024 urine E. coli: imipenem 23 and ertapenem 47 survived
    beside ceftriaxone 87. Ceftriaxone or cefotaxime more than 20 above ertapenem is now a caution too.
  - **`atMost` with different numbers tested** compares counts, not percentages. The susceptible count of the
    broader agent cannot fall below the narrower one's minus the isolates it may not have been tested on
    (Bhopal 2021 E. cloacae: ertapenem 25 of 52, meropenem 7 of 86).
  - **New cautions**: daptomycin for a genus Enterococcus row; C. glabrata fluconazole (no susceptible
    category); echinocandins more than 20 apart for Candida.
  - **One answer for console and reasoning.** `susceptibility()` walks on drug by drug in pooled scopes. The
    console now asks it for each drug (`drugsFor` lists what it can reach) and marks a figure taken from
    another stratum with a number and a note. Reasoning groups its chips by stratum: the lead stratum names
    its organism isolates (from the table, not the largest number tested for one drug), and the others are
    marked and footnoted.
  - **WISCA is antibacterial only**: yeasts and moulds are left out of the mix (India blood meropenem 42.5,
    not 40.1). The screen says "bacteria".
  - **Pooled views cite only the sources behind their figures** (meta line, CSV and print): SKNMC feeds no
    figure. The CSV key and print legend say "or from fewer than 3 institutions".
  - **Plain view** (reasoning, default on) keeps the resistance panel outside the folded guideline box.
  - **An indwelling catheter implies `complicatedUTIRisk`** (reasoning `ALIAS`), so a catheterised patient
    never leads with uncomplicated cystitis.
  - **SKIMS 2020 to 2024 reliability pass**: every kept 0 (575 cells) read against its page. None was an
    extraction error, and those tables print a dash for untested agents, so a printed 0 is a result. 68 rows
    are marked `unreliable`: 2021's blood Gram-negative table repeats 2020 figures, 2023's blood tables are
    2022's nudged by 1 to 4 points (median difference 1.0, against 8 to 11 for pus and urine), and 2024's
    urine Gram-negative table is garbled (E. coli ceftriaxone 87 beside carbapenems at 23). 16 cells get a
    `conflict` note (e.g. 2021 P. aeruginosa meropenem 0 beside imipenem 17.6) and one 0 is `untested`.
    Those editions only feed trends: pools use SKIMS 2025.
  - **Tool names**: the build rejects a source text that names a tool or library (PyMuPDF, poppler and so on).
  - **Messages**: in the open overlay a message takes the header subtitle's place. The rotate hint is a
    strip at the foot of the overlay, not a floating pill over the table or a sheet.
- **Row flags from the lead**: `unreliable: "what is inconsistent"` makes every figure of a row a caution
  (BVDU Pune 2024 page 12 Gram-negative rows; SKNMC Pune 2024 Pseudomonas lists); `untested: {drug: why}`
  turns a printed 0 that means "not tested" into a caution (RIMS Imphal 2023-24 blood cefazolin).
- **Pools need 3 institutions** (store `POOL_MIN_K`, counted by hospital name so a hospital's second
  series is not a second institution): a pooled cell from 1 or 2 is a caution that names them, never used by
  the console or reasoning; phenotype cards and cell sheets say how many institutions; a region with fewer
  than 3 has no pooled scope or profile (South and East, 2026-09-26). Urinary agents and fosfomycin rank
  only for urine.
- **Bundle layout**: repeated row strings (table names, notes, how a row was combined) are indices into
  `strs`; per-source notes, reporting, method, how it was read, second-reader notes and exclusions live in
  `kb/antibiogram/antibiogram-detail.json`, fetched when a source sheet opens (`ABG_STORE.detail(id)`); the
  sheet shows `summary` (first sentences of the notes) and a plain checking status. build-www copies both.
- **Fungal series**: an institution whose fungal antibiogram is a separate issue (Sir Ganga Ram Hospital's
  second newsletter issue each year, `SGRH_FUNGAL_<year>`) gets its own `inst` (`SGRH_DELHI_FUNGAL`,
  short "Sir Ganga Ram Hospital, fungal"). Under the bacterial `inst` a fungal and a bacterial issue of
  the same year read as "H1"/"H2" editions and the fungal data never becomes "latest". Candida tables
  are blood, all settings, n = isolates tested; NA, not done and susceptible-dose-dependent cells are left
  out (C. glabrata fluconazole "0#" too: no susceptible category exists, 0% would read as resistance).
  Intrinsic: C. krusei fluconazole, Aspergillus fluconazole, Cryptococcus and Trichosporon echinocandins.
- **Fungi in bacterial charts**: a named fungal species in an organism chart is recorded as a count
  unless the same panel also prints an unnamed "Fungal isolates" entry (then it is a partial count and
  goes to `excluded`). SGRH 2013 labels its fungal bar "Candida spp." (recorded).
- **Sources with no direct link** (SGRH 2012 to 2021 serve PDFs only by POST from
  sgrh.com/en/publications): `url` null, `page` set; the screen offers "Open the web page that lists it".
  The register dedupes by URL, so a shared form URL must never be recorded as the document's `url`.
- ICMR 2024 Table 9.44 (VAP) is excluded on purpose (identical counts repeated across agents, e.g.
  2/81 five times; A. baumannii tigecycline 2.5% vs 75.8% in the bloodstream table).

## Redesign (2026-09-27, flag `smd_abg_pro`)
Owner: move Sources beside the exports and "make the whole module look professional, no AI slop".
- **One theme on the app's own tokens.** `.abg.abg-pro` inherits `--panel`, `--ink`, `--line` from the page
  (`--x: inherit` undoes the overlay's private copies) and maps `--bg` to `--paper`, `--tl` to `--teal`,
  `--mut` to `--slate-soft`, `--ink2` to `--slate`, so the screen follows the chosen theme in light and dark.
  All pro rules are scoped `.abg-pro ...` and appended after the base CSS (shell in `antibiogram.js`,
  screens in `ABG_V2.css`). Base `body.dark .abg-x` rules outrank `.abg-pro .abg-x`: restate them as
  `.abg-pro .x, body.dark .abg-pro .x`.
- **Look**: hairline cards, 8 to 10 px radii, no gradients, glass blur or coloured shadows; sentence case (no
  uppercase tracked labels); one segmented control for the tabs and the % toggles; chips tinted, not filled.
- **Heat scale**: tinted fills with dark text (`--h5b/--h5f` ... `--h1b/--h1f`, dark variants), contrast 5.7:1
  or better; the number is always printed. Resistance phenotype tiles carry a severity dot, the figure in ink.
- **Plain drug names**: the overlay carries `no-druglink`, so drug-link.js does not bold or glow names on this
  data screen (it did in the meta panel, phenotype tiles and Sources prose).
- **Appearance styles** (appearance.css, `data-appearance`) make each `.abg-tab` a glass tile; the pro CSS undoes
  that for unselected tabs and for `.abg-note` with `html[data-appearance] #abgOverlay.abg-pro:not(#_)`.
- **Copy**: Title Case and arrow labels in the Spectrum sheets became plain sentences ("Microbiology notes",
  "Show on the grid", "Open X in the drug database"). Sources leads with four figures (websites checked,
  documents found and integrated, isolates); how figures are checked and why documents are not used are
  collapsed. The meta panel's "(see Sources)" became "Show them", which opens that source's sheet. WISCA
  per-organism detail is a table; the single-agent ranking lists value right-aligned with its data share.

## Tests
`node --test test/antibiogram-rules.test.mjs test/antibiogram-build.test.mjs test/antibiogram-store.test.mjs`
(the build test runs `--check`, so a stale bundle fails) and `node test/run-antibiogram-ui.mjs` (real app,
390 px: screen, keyboard access, search, exports, breakpoint notes, sources, import including the % resistant
check, console, reasoning, flag off, kill switch off, no em dash, the redesign's three one-line tabs, Sources
beside the exports with a way back, plain drug names, and the redesign flag off). CI: `.github/workflows/antibiogram-ui.yml`.

## Status and next
Census and extraction log: `vault/handoff/2026-09-26-antibiogram-rebuild.md`. Pending items in
[[Roadmap]]: remaining institutional PDFs, older ICMR editions at stratum level, regional-centre tables,
a yearly re-check of the census URLs.
