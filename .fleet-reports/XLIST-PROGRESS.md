# XLIST-PROGRESS: cross-list shared modules across subjects

Branch: `xlist-crosslist` (worktree `/private/tmp/xlist-crosslist`, base `fdb813bf0`).

## 00:00-00:30 — discovery + crosslist.json first

- Queried graphify and read `prep/taxonomy.json`, `prep/taxonomy/*.json`, `prep.js` (`topicOf`, `loadIndex`, `loadModule`, `overlaysOfSid`, `mergeOverlay`, progress keys), `tools/prep-build-bank` and prep-overlay tools.
- Wrote `prep/taxonomy/crosslist.json` FIRST with stable ids for the nucleus360-full job. Final shape: `{ "v": 1, "groups": [{ "id", "title": {"en"}, "members": [[sid, mid]] }] }` (object wrapper, not the flat array in the job text). 26 groups, every member verified against the taxonomy.

## 00:30-02:00 — implementation

- `prep.js` (+153): cross-listed group shown in every member subject's list (`xgroupsFor`, `xlistRow` union counts); opening from any subject loads the UNION once (`unionItems`, shared `mod:x:` cache, `_m` group tag, write-back of exact counts); progress/mistakes/bookmarks keyed by item, share/item ids unchanged; lesson/KB shared by link; fetches via same getJSON/bank client; offline + OTA fail-open intact.
- `tools/prep-build-bank.mjs` (+57 union pass + skip crosslist in loadTaxonomy), new `tools/prep-crosslist-index.mjs`, 23 served bank indexes gained additive-only `group: xlist` rows.
- Bank gate untouched: zero diff in `functions/api/prep/bank` and `prep-bank-client.js`.
- New `test/prep-crosslist.test.mjs` (9 tests: stable ids, stem normalisation, union dedupe, both-sides-once, progress carry, index build, served indexes, non-member-identical).

## 02:00+ — verification (independently re-run)

- `test/prep-crosslist.test.mjs`: 9/9 pass. Surrounding suites (prep-subject, prep-app, prep-build-bank, prep-lessons): 74/74 pass. Total 83/83.
- Spot check: `ss-gynaecological-oncology/index.json` carries `x-cervical-cancer` count 350 / ov 72.
- Rejected (conservative, same disease/procedure only): sso-vs-son (modality), pon-vs-paediatric splits (age-bundled), hnc bundled-vs-split, onc-molecular-vs-pat (discipline), can-vs-sca (procedures-vs-diseases), pgt/php-vs-sgi/shp (bundled-vs-adult), rep-endocrine-surgery-vs-obg (bundled), sgm-hcc-lesions-vs-hcc (broader scope). 4 gyn triples use bundled gyn stubs per task instruction.
- Unresolved: live R2 union over real mcq files (no network at build time); MaiK runtime overlay write-back; search reachability (runtime-built); `ss-radiation-oncology` absent from taxonomy.

## Next

- Browser verification, then plain squash PR, then remove the `/private/tmp` worktree. See XLIST-DONE.md for the final record.
