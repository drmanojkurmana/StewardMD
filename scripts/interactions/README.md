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
