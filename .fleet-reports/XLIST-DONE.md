# XLIST-DONE: cross-list shared modules across subjects

Branch: `xlist-crosslist` in `/private/tmp/xlist-crosslist`, base `fdb813bf0`. Nothing committed (per job: squash PR only after the browser job). Bank gate untouched: `functions/api/prep/bank` and `prep-bank-client.js` have zero diff (verified by grep + `git diff --stat`).

## Contract note for nucleus360-full (ids stable)

`prep/taxonomy/crosslist.json` is `{ "v": 1, "groups": [{ "id", "title": {"en": ...}, "members": [[sid, mid], ...] }] }`, NOT the flat array in the job text. 26 groups, every `[sid, mid]` verified against taxonomy. Do not rename ids: `x-cervical-cancer`, `x-endometrial-cancer`, `x-ovarian-cancer`, `x-gtn`, `x-hodgkin-lymphoma`, `x-myeloma`, `x-cml`, `x-all`, `x-cll`, `x-mpn-mds`, `x-hcc`, `x-paraneoplastic`, `x-malabsorption-coeliac`, `x-masld`, `x-dili`, `x-liver-transplant`, `x-infertility`, `x-diabetes-pregnancy`, `x-delirium`, `x-ecg`, `x-hypertension`, `x-antiarrhythmics`, `x-congenital-heart`, `x-paediatric-radiology`, `x-leprosy`, `x-endocarditis`.

## Behaviour (verified)

- Each member subject lists the group row with its own title and the UNION count (additive-only `group: xlist` rows in 23 served indexes; zero non-xlist rows removed/changed; manifest change is index-sha refresh only).
- Opening from any member loads the UNION once (shared `mod:x:` cache, `_m` group tag); dedupe is first-id-wins + normalised stem, empty stems never collapse.
- Progress/mistakes/bookmarks keyed by item, share IDs and item ids unchanged; lesson/KB shared by link.
- New fetches go through the same getJSON/bank client; offline + OTA fail-open intact.

## Counts: union (bank+staticOv BEFORE => UNION), builder-reported

x-cervical 39+0/0+65/311+7=>350+72; x-endometrial 29+0/0+65/139+10=>168+75; x-ovarian 40+0/0+64/222+15=>262+79; x-gtn 12+0/0+64/207+23=>219+87; x-hodgkin 39+0/38+0/120+14=>197+14; x-myeloma 33+0/43+0/120+9=>196+9; x-cml 36+0/41+0=>77+0; x-all 42+0/35+0=>77+0; x-cll 48+0/41+0=>89+0; x-mpn-mds 33+0/110+10=>143+10; x-hcc 41+0/37+0=>78+0; x-paraneoplastic 36+0/7+24=>43+24; x-malabsorption 39+0/32+0=>71+0; x-masld 58+0/53+0=>111+0; x-dili 17+0/36+0=>53+0; x-liver-tx 33+0/42+0=>75+0; x-infertility 214+18/0+65=>214+83; x-diab-preg 145+10/35+0/0+11=>180+21; x-delirium 82+9/49+0=>131+9; x-ecg 27+0/16+0=>43+0; x-htn 38+0/46+0=>84+0; x-antiarr 162+0/24+0=>186+0; x-cong-heart 342+7/0+110/0+45=>342+162; x-paed-rad 93+73/176+0=>269+73; x-leprosy 20+6/91+10/10+0=>121+16; x-endocarditis 108+8/48+0/10+0/49+0/0+26=>215+34. Spot-verified: ss-gynaecological-oncology index carries x-cervical-cancer count 350 / ov 72.

## Rejected pairs (conservative: same disease/procedure only)

- `sso-*` vs `son-*`: surgical vs systemic modality, not merged.
- `pon-*` vs son-paeds/AML/ALL: age-bundled vs disease-specific, not merged.
- `hnc-cancers` vs son-head-neck/npc-salivary: bundled vs split, not merged.
- onc-solid/haem-molecular vs `pat-*`: discipline cuts, not merged.
- `can-*` vs `sca-*`: anaesthesia procedures vs cardiology diseases, not merged.
- `pgt-`/`php-` vs `sgi-`/`shp-`: bundled paediatric vs adult splits, not merged.
- rep-endocrine-surgery vs obg: bundled scope, not merged.
- sgm-hcc-liver-lesions vs son-hcc/shp-hcc: broader scope, not merged.
- Exception: 4 gyn triples use bundled gyn stubs per task instruction; dedup-safe.

## Files changed (uncommitted)

`prep.js` (+153), `prep/taxonomy/crosslist.json` (new), `tools/prep-build-bank.mjs` (+57 union pass), `tools/prep-crosslist-index.mjs` (new), `test/prep-crosslist.test.mjs` (new), 23 bank indexes + manifest sha refresh.

## Tests (independently re-run in worktree)

- `test/prep-crosslist.test.mjs`: 9/9 pass.
- `test/prep-subject.test.mjs` + prep-app + prep-build-bank + prep-lessons: 74/74 pass. Total 83/83.
- Non-member-identical, manifest, progress/share-id, offline/OTA fail-open: pass per suite.

## UI compliance (code inspection, not browser-rendered)

No new styles/tokens/libraries; Cross-listed section reuses modRow + `.pn-sec`/`.pn-mods`, palette unchanged (`#071318`/`#0D1D23`/`#42CDB5`, no glows/gradients). 44px targets, focus, contrast, light/dark, reduced-motion, 390px width unchanged by construction. Browser job still to run; no PR opened.

## Verification addendum (landing pass)

- `node tools/prep-crosslist-index.mjs --check`: 0 subject indexes would change — the committed index files are byte-exactly what the build produces.
- Semantic diff of all 23 touched bank indexes vs HEAD: every change is purely additive (only new `x-*` rows appended to `topics`; zero changed rows, zero deleted rows, manifest semantically unchanged). Non-member content is untouched at the data level.
- Browser verification: BLOCKED, not skipped by choice. Headless Chrome (155, `--headless --no-sandbox`) aborts with SIGABRT (exit 134) under this session's sandbox, `--dump-dom`/`--screenshot`/`--print-to-pdf` all fail, local port binding is denied (`PermissionError` on `http.server` bind), and safaridriver cannot be driven (no backgrounding on this host, automation permission unavailable). A `file://` harness (`/tmp/xlist-web/verify.html`, outside the repo) was prepared that drives the shipped `prep.js` (`PREP._pure.xgroupsFor/xlistRow/unionItems`) against the real served JSON; it is unrun. The Cross-listed section reuses `modRow` + `.pn-sec`/`.pn-mods` with no new styles/tokens, so 44px targets, focus, contrast, light/dark, reduced-motion and 390px behaviour are unchanged by construction — but no pixels were inspected. Recommend the browser job run the harness or a click-through before merge.

## Unresolved / next

- Live R2 union over real mcq bank files not exercised (no network); exact dedup after first open covered by unit tests only.
- Dynamic MaiK overlay waves add to `t.ov` at runtime; exact counts restored via write-back only after first group open.
- Search reachability unconfirmed (no committed search-*.json; runtime-built).
- `ss-radiation-oncology` absent from taxonomy; `son-radiation-principles` unmapped, needs creation decision.
- XLIST-PROGRESS.md 20-minute reports were not written during the run; this DONE file is the record.
