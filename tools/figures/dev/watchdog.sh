#!/bin/bash
# Keeps the unattended figure jobs alive without any Claude session. Run once:
#   nohup caffeinate -i bash tools/figures/dev/watchdog.sh > ~/Documents/figure-watchdog.out 2>&1 &
# Every 4 minutes: restart the drug-scene queue and the mastery generator if they died, restart agy once if it died with no files,
# and when both finish run the tests, commit mastery.json and the tool changes, drop the backup branch. Never pushes.
REPO="$HOME/Developer/StewardMD"; LOG="$HOME/Documents/figure-run.log"; cd "$REPO" || exit 1
export PATH="$HOME/.local/bin:$PATH" MUSE_MODEL=muse-spark-1.3 ANATOMY_DIR="$HOME/anatomy" ANIMA_DIR="$HOME/anima" CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
say() { echo "$(date +%H:%M:%S) watchdog: $*" | tee -a "$LOG"; }
scenes_done() { grep -q "finished: scenes registered" <(tail -n 3 "$LOG") && python3 -c "import json;print(sum(1 for f in json.load(open('prep/figures/figures.json'))['figures'] if f.get('scene')))" | awk '{exit !($1>=230)}'; }
missing_mastery() { python3 - <<'P'
import json,os
f=json.load(open('prep/figures/figures.json'))['figures']
m=json.load(open('prep/figures/mastery.json'))['items'] if os.path.exists('prep/figures/mastery.json') else {}
print(sum(1 for x in f if x['id'] not in m))
P
}
agy_tries=0; final_done=0
say "started (model $MUSE_MODEL)"
while true; do
  if ! scenes_done && ! pgrep -f "run-queue.py" >/dev/null; then say "restarting scene queue"; nohup python3 tools/figures/dev/run-queue.py "$HOME/Documents/prepnucleus-figure-queue4.tsv" --batch 8 --target-scenes 230 > "$HOME/Documents/figure-queue4.out" 2>&1 < /dev/null & fi
  mm=$(missing_mastery)
  if [ "$mm" -gt 0 ] && ! pgrep -f "mastery-gen.py" >/dev/null && ! pgrep -f "run-queue.py" >/dev/null; then say "restarting mastery generator ($mm figures without an entry)"; nohup python3 tools/figures/dev/mastery-gen.py --chunk 10 --parallel 4 > "$HOME/Documents/figure-mastery.out" 2>&1 < /dev/null & fi
  if ! pgrep -f "agy .*incretin" >/dev/null && [ ! -f tools/figures/scenes/incretin.mjs ] && [ "$agy_tries" -lt 2 ]; then agy_tries=$((agy_tries+1)); say "agy not running and no incretin scene, relaunch $agy_tries"
    nohup agy --dangerously-skip-permissions --effort high -p "Working directory: $REPO. Read tools/figures/dev/briefs/incretin.md and build the scene exactly as it describes, following tools/figures/dev/AGENT-BRIEF.md. export ANATOMY_DIR=\$HOME/anatomy ANIMA_DIR=\$HOME/anima CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' before node commands. No git add, commit or push. Edit only the files the brief lists." > "$HOME/Documents/figure-incretin-agy.out" 2>&1 < /dev/null & fi
  if scenes_done && [ "$mm" -eq 0 ] && [ "$final_done" -eq 0 ] && ! pgrep -f "run-queue.py|mastery-gen.py" >/dev/null; then
    say "all generation finished, running the final checks"
    if node --test --experimental-test-module-mocks --experimental-sqlite test/fig-mastery.test.mjs test/fig-registry.test.mjs test/fig-fonts.test.mjs 2>&1 | grep -q "^ℹ fail 0"; then
      printf 'Mechanism mastery: five-step entries for every figure\n\nGenerated with muse, validated by mastery-merge.mjs, AI-assisted and awaiting clinician review.\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_018vzZP5z3vJ8JzeSHLXJLU7\n' > /tmp/wd-msg.txt
      git add prep/figures/mastery.json tools/figures/dev/run-queue.py tools/figures/dev/mastery-gen.py tools/figures/dev/watchdog.sh 2>/dev/null; git commit -q -F /tmp/wd-msg.txt && say "committed mastery.json and tool changes" || say "nothing to commit or commit failed"
      git branch -D backup/pre-reword >/dev/null 2>&1; rm -f prep/figures/.mastery-missing.txt
      say "ALL DONE: scenes and mastery complete, nothing pushed"; final_done=1
    else say "final tests failed, leaving everything uncommitted for review"; final_done=1; fi
  fi
  [ "$final_done" -eq 1 ] && ! pgrep -f "agy .*incretin" >/dev/null && { say "exiting"; exit 0; }
  sleep 240
done
