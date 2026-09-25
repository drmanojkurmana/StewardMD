# Drug-Interaction Data Pipeline

Build-time pipeline that generates StewardMD's drug–drug interaction dataset
(`/interaction-rules.js` + `/data/interaction-rules.json`) from **open,
commercially-safe** sources. The runtime engine (`/interactions.js`) is pure and
offline; this pipeline only produces the data it consumes.

> ⚠️ Clinical decision support only. Output is a broad **class/mechanism screen**,
> NOT an exhaustive commercial compendium. Absence of a finding does **not** mean a
> combination is safe. New `contraindicated`/`major` rules require clinician
> sign-off (see `curated/signoff.json`) or the build fails.

## Sources (all open / public domain except where noted)

- **RxNorm / RxClass** (NLM, public domain) — drug normalization + auto-classification
  (ATC, DailyMed EPC, MED-RT MoA/PE). The coverage multiplier.
- **ONC / NLM High-Priority DDI list** (public domain) — curated pairwise seeds.
- **openFDA** structured product labeling (public domain) — class/brand enrichment
  + evidence provenance (never NLP-mined into rules).
- **CredibleMeds QT** — QT-prolongation membership. *Non-commercial educational
  terms — verify licence before commercial redistribution.*

## How it works

`build_all.py` runs: fetch (cached) → classify → merge rules → validate → emit.

Fetch/classify stages: `fetch_rxnorm` (normalize) → `fetch_rxclass` (per-drug curated classes incl. CYP) → `fetch_class_members` (all members of each curated class) → `fetch_all_epc` (every DailyMed EPC class + members, for full breadth) → `fetch_openfda` (enrichment/evidence) → `build_gold` (fold in worker/data/gold compositions). `build_classmap` unions them all; `build_rules` adds curated + auto low-severity duplicate-class rules.

```
python scripts/interactions/build_all.py            # full build (fetch if cache missing)
python scripts/interactions/build_all.py --no-fetch  # rebuild from cache only
python scripts/interactions/build_all.py --fetch     # force re-fetch from the network
python scripts/interactions/validate.py              # schema + sign-off gate only
```

No third-party Python deps (stdlib `urllib` only). Set `OPENFDA_API_KEY` for a
higher openFDA rate limit. Raw API responses are cached under `build/` (gitignored),
so re-runs are fast and offline.

### Bootstrapping the drug universe

`curated/drug_universe.json` is dumped from the live app (MEDDRUGS + ASP_DRUGS +
INTERACTION_RULES) via headless Chrome:

```
CHROME=/path/to/chrome node scripts/interactions/dump_universe.mjs
```

`extract_legacy.mjs` (run once) split the pre-pipeline `interaction-rules.js` into
the `curated/legacy_*.json` seeds so the migration preserved every existing rule.

## Editing the data (source of truth = `curated/`)

The pipeline **only reads** `curated/`; never hand-edit the generated
`interaction-rules.js`.

| File | Purpose |
|---|---|
| `class_taxonomy.json` | RxClass class → internal snake_case tag |
| `mechanism_rules.json` | class×class rules (the coverage multiplier) |
| `curated_overrides.json` | class pins, denies, exclusions, name aliases |
| `universe_additions.json` | drugs to add beyond the app formularies |
| `crediblemeds_qt.json` | QT-prolongation membership |
| `onc_hpddi.json` | extra ONC-derived pairwise rules |
| `legacy_*.json` | verbatim migration of the pre-pipeline ruleset |
| `signoff.json` | clinician sign-off manifest (gates the build) |
| `sources.json` | provenance blocks surfaced as `INTERACTION_RULES.sources` |

After a rebuild, bump the `?v=` on `interaction-rules.js` (and `medlist.js` if the
UI changed) in `index.html`, then run the CDP tests:

```
CHROME=... node test/run-interactions.mjs
CHROME=... node test/run-medlist.mjs
```

## Coverage auditing and evidence review

`node scripts/interactions/audit_coverage.mjs /output/directory` inventories every
name in the shipped rules, ward formulary and offline index. It writes coverage
CSV, rule inventory, consumer differences and a monograph-prose review queue.
These are structural diagnostics, NOT a gold-standard accuracy benchmark. A name
mention, a taxonomy match or an absent pair never establishes clinical safety.

`python scripts/interactions/collect_label_evidence.py coverage.csv /output/labels --limit 20`
collects bounded openFDA label candidates, preserving identity, route, version,
sections and truncation. Repeated `--drug` values restrict collection to named
public medicines. Never pass patient lists. Existing outputs are skipped; use a
new output directory for a fresh snapshot. Observe openFDA daily quotas. Text is
never promoted automatically to executable advice.

The two shipped consumers have existing class/rule differences. For a narrowly
reviewed change, use `python scripts/interactions/sync_curated_rules.py RULE_ID ...`
to update explicit source-backed mechanism rules while preserving both class maps.
It validates all selected rules against both consumers before writing either.
A full `emit` must not be used to erase consumer differences without review.
