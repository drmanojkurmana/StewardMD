#!/bin/bash
# Add a finished scene to the registry, run the registry tests, commit and push the branch.
#   tools/figures/dev/register.sh <scene-name> <figure-id> "<commit subject>" [branch]
# The scene's registry entry lives in tools/figures/scenes/<scene-name>.reg.json.
set -e
cd "$(git rev-parse --show-toplevel)"
python3 - "$1" <<'P'
import json,sys
p='prep/figures/figures.json';r=json.load(open(p))
e=json.load(open(f'tools/figures/scenes/{sys.argv[1]}.reg.json'))
if e['id'] not in {f['id'] for f in r['figures']}: r['figures'].append(e)
json.dump(r,open(p,'w'),indent=1,ensure_ascii=False)
P
node --test --experimental-test-module-mocks --experimental-sqlite test/fig-registry.test.mjs 2>&1 | grep -E "^# (pass|fail)"
git add prep/figures/$2.html prep/figures/$2-light.html tools/figures/scenes/$1.* tools/figures/specs/$2.json prep/figures/figures.json
git commit -qm "Figures: $3"
git push -q origin "HEAD:${4:-$(git rev-parse --abbrev-ref HEAD)}"
