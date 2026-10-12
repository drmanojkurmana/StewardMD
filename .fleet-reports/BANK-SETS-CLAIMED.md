# Bank overlay set claims (parallel bank workers: read before publishing)

Live base: maik1-17, maikimg1-9 (R2 overlay/maik/index.json -> manifest-cda05463.json, 2026-10-12).

| Job | Sets claimed | Content | Status |
|-----|--------------|---------|--------|
| bank-mrcp | maik18 | MRCP Part 1 text items (5-option best-of-five) | claimed 2026-10-12 |
| bank-mrcp | maik19 | MRCP Part 2 Written text items (5-option) | claimed 2026-10-12 |
| bank-mrcp | maikimg10 | MRCP Part 2 Written image items (5-option) | claimed 2026-10-12 |

Rule: never publish to another job's set. Manifest/index/overlay-counts/ID-index
rebuilds must union-merge from LIVE (rebase + re-fetch) since waves publish in
parallel; stale-base overwrites hid sets before (see IMAGE-INTEGRATION-DONE.md).
