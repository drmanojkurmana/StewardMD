---
tags: [module, stewardship, clinical-data]
status: rebuilt 2026-09-26 (flag ON). Data read from published Indian antibiograms; every number traceable to its page.
flag: smd_abg_v2 (antibiogram-flags.js, def:true, ?abg2=0 restores the previous resistance view on the same data)
kill-switch: smd_abg_data (def:true; ?abgdata=0 or localStorage smd_abg_data=0 makes the console, reasoning and antibiotic choice ignore the store and use the built-in ICMR 2024 national summary in app.js, as before the rebuild)
---
# Antibiogram

Cumulative antibiograms (percent of isolates susceptible, by organism, antibiotic, specimen and setting)
from Indian hospitals, surveillance networks and published hospital studies. One data layer feeds four
places:
- **Antibiogram screen** (Knowledge Library tab and `window.ABG.open()`): tabs Antibiotic coverage
  (qualitative spectrum grid, unchanged), **Resistance rates**, **Sources**, **My hospital**.
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
   `validation-report.json` and the source sheet ("The source's own tables disagree"). SKIMS 2025 has 4
   (respiratory S. aureus IPD/OPD swapped between tables; pus Acinetobacter IPD/ICU 60 isolates apart).
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
fever blood; diarrhoea stool; "all specimens except urine" last for non-urinary syndromes. A syndrome never
gets a different specimen's figures (no urine data for meningitis): the result is empty instead, and the
panel says which specimen was used when it fell back.

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

## Tests
`node --test test/antibiogram-rules.test.mjs test/antibiogram-build.test.mjs test/antibiogram-store.test.mjs`
(the build test runs `--check`, so a stale bundle fails) and `node test/run-antibiogram-ui.mjs` (real app,
390 px: screen, keyboard access, search, exports, breakpoint notes, sources, import including the % resistant
check, console, reasoning, flag off, kill switch off, no em dash). CI: `.github/workflows/antibiogram-ui.yml`.

## Status and next
Census and extraction log: `vault/handoff/2026-09-26-antibiogram-rebuild.md`. Pending items in
[[Roadmap]]: remaining institutional PDFs, older ICMR editions at stratum level, regional-centre tables,
a yearly re-check of the census URLs.
