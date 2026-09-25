"""Collect openFDA label candidates for review; NEVER turn label text into rules.

Input is the all-drug coverage CSV, not a patient medication list. Requests are
bounded and cached. Each response retains identity, route, source version and
truncation/ambiguity. FDA approval and clinical interpretation still need review.
Example: python scripts/interactions/collect_label_evidence.py coverage.csv out --limit 20
Use --drug repeatedly for targeted public-name lookups. No PHI is accepted.
"""
import argparse
import csv
import datetime
import hashlib
import json
from pathlib import Path
import _lib as L

FIELDS = ('drug_interactions', 'contraindications', 'warnings_and_cautions', 'warnings', 'boxed_warning')


def collect(drug):
    # Escape Lucene quoted query syntax, then URL encoding is handled by _lib.
    term = drug.replace('\\', '\\\\').replace('"', '\\"')
    url = L.openfda_url(search='openfda.generic_name:"' + term + '"', limit=5, sort='effective_time:desc')
    data = L.http_json(url, 'label-review-v1', drug, throttle=0.35, retries=1)
    state = 'unavailable' if data is None else 'no_match' if data.get('__notfound') else 'review_required'
    records = []
    for item in (data or {}).get('results', []):
        info = item.get('openfda') or {}
        generics = info.get('generic_name') or []
        set_id = item.get('set_id') or ''
        records.append({
            'id': item.get('id'), 'setId': set_id, 'version': item.get('version'),
            'effectiveTime': item.get('effective_time'), 'genericNames': generics,
            'exactNameMatch': any(g.casefold().strip() == drug.casefold().strip() for g in generics),
            'brands': info.get('brand_name', []), 'routes': info.get('route', []),
            'productTypes': info.get('product_type', []), 'applicationNumbers': info.get('application_number', []),
            'rxcui': info.get('rxcui', []),
            'sourceUrl': 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=' + set_id if set_id else None,
            'sections': {f: item[f] for f in FIELDS if item.get(f)},
        })
    total = (data or {}).get('meta', {}).get('results', {}).get('total', 0)
    return {'query': drug, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'status': state, 'records': records, 'totalResults': total,
            'truncated': total > len(records), 'clinicalApproval': 'not_reviewed',
            'notice': 'Label candidates only. No pair, severity or management recommendation has been inferred.'}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('coverage_csv'); ap.add_argument('output_directory')
    ap.add_argument('--limit', type=int, default=20)
    ap.add_argument('--drug', action='append', default=[])
    args = ap.parse_args()
    if not 1 <= args.limit <= 200:
        ap.error('--limit must be between 1 and 200; respect the openFDA daily quota across runs')
    output = Path(args.output_directory); output.mkdir(parents=True, exist_ok=True)
    with open(args.coverage_csv) as stream:
        rows = list(csv.DictReader(stream))
    rows.sort(key=lambda r: (r['coverage'] != 'no_active_rule_participation', r['generic']))
    names = list(dict.fromkeys(args.drug or [r['generic'] for r in rows]))
    processed = []
    for drug in names:
        target = output / (hashlib.sha256(drug.encode()).hexdigest()[:20] + '.json')
        if target.exists():
            continue
        if len(processed) >= args.limit:
            break
        result = collect(drug)
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        processed.append({'drug': drug, 'status': result['status'], 'file': target.name})
        print(drug + ': ' + result['status'], flush=True)
    (output / 'last-run.json').write_text(json.dumps({'requestedNames': len(names), 'processed': processed,
        'scope': 'bounded evidence collection only; remaining names are not assessed'}, indent=2) + '\n')


if __name__ == '__main__':
    main()
