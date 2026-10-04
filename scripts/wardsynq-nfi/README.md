# wardsynq-nfi: building `wardsynq/adapters/nfi-tables.js`

The NFI renal, pregnancy and lactation tables (owner decision 2026-10-04; `vault/decisions/Decisions.md`). The output file is
signed off table by table (`functions/_wardsynq/seed-signoff.js`, list `nfi-tables`): regenerating it with ANY change turns the
changed table off until the owner signs it again.

Source: National Formulary of India, 6th Edition 2019-20 (Draft Version), Indian Pharmacopoeia Commission,
https://ipc.gov.in/images/Draft_Version_NFI_6th_edition.pdf (sha256 269be2d4f2d8033dab2c40b6c68e72b7b5159b3a69298efe286f7ad3aa33a585).
Cross-check for the renal table: NFI 2011 (4th edition), https://qps.nhsrcindia.org/sites/default/files/2022-01/National%20Formulary%20of%20India%20(NFI),%202011.pdf

Steps, in a work folder outside the repo (`NFI_WORK`), with Python 3 + pypdf and Node:

1. Download both PDFs; extract every page's text with pypdf to `draft-pages.json` and `nfi2011-pages.json` (a JSON array of page strings).
2. `rows.py` is the hand transcription of Appendix 10d (renal) and 10b (lactation). `python3 verify_rows.py` checks each row
   against the PDF text layers (renal rows contiguous in NFI 2011, every cell token on the draft's pages) and writes `row-pages.json`;
   then `python3 fix_lactation_pages.py`; then `python3 -c "import json; from rows import R,L; json.dump({'R':R,'L':L},open('rows.json','w'))"`.
3. `python3 parse_mono.py` splits the draft's monographs into fields (`monographs.json`); `python3 clean_mono.py` tags them.
4. `NFI_WORK=<folder> node scripts/wardsynq-nfi/gen.mjs` writes `wardsynq/adapters/nfi-tables.js`.
5. `NFI_PAGES_JSON=<folder>/draft-pages.json npm test -- test/wardsynq-nfi-tables.test.mjs` checks every entry against the PDF's text.

The encoding policy is printed in `NFI_SOURCE.encoding` and is part of what is signed.
