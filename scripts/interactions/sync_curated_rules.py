"""Update named curated rules in both shipped consumers without replacing class maps.

The browser and WardSynq class maps differ. A full emit requires the original
classification inputs and independent consumer verification. This narrow path
only synchronizes explicitly named, source-backed rules from mechanism_rules.
Usage: python scripts/interactions/sync_curated_rules.py RULE_ID [RULE_ID ...]
"""
import json
from pathlib import Path
import sys
import _lib as L
import validate


def run(ids):
    if not ids:
        raise SystemExit('Specify curated rule IDs; no implicit bulk update.')
    curated = {r['id']: r for r in L.curated('mechanism_rules.json')['rules']}
    selected = [curated[rid] for rid in ids]
    for rule in selected:
        if not rule.get('sourceUrl', '').startswith('https://'):
            raise SystemExit('Direct clinical source required: ' + rule['id'])
    writes = []
    for name in ('interaction-rules.js', 'data/interaction-rules.json'):
        file = Path(L.ROOT) / name
        text = file.read_text()
        if name.endswith('.js'):
            prefix, tail = text.split('  window.INTERACTION_RULES = ', 1)
            body, suffix = tail.rsplit(';\n})();', 1)
            payload = json.loads(body)
        else:
            payload = json.loads(text)
        errors, warnings = validate.validate(payload, selected)
        if errors:
            raise SystemExit('\n'.join(errors))
        if warnings:
            raise SystemExit('Resolve rule validation warnings before syncing: ' + '; '.join(warnings))
        updates = {r['id']: r for r in selected}
        existing = {r['id'] for r in payload['rules']}
        payload['rules'] = [updates.get(r['id'], r) for r in payload['rules']]
        payload['rules'].extend(r for r in selected if r['id'] not in existing)
        payload['version'] = '1.0.2'
        payload['generated'] = '2026-09-25'
        encoded = json.dumps(payload, ensure_ascii=False, indent=2)
        writes.append((file, prefix + '  window.INTERACTION_RULES = ' + encoded + ';\n})();' + suffix if name.endswith('.js') else encoded + '\n'))
    for file, content in writes:
        file.write_text(content)
        print(str(file.relative_to(L.ROOT)) + ': updated ' + ', '.join(ids))


if __name__ == '__main__':
    run(sys.argv[1:])
