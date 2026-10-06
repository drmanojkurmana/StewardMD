#!/bin/sh
# Local battle smoke: real Durable Objects, alarms, RPC and D1 in workerd; auth bypassed (smoke/entry.js).
set -e
cd "$(dirname "$0")"
S=${S:-/tmp/prep-arena-smoke}
rm -rf "$S"; mkdir -p "$S/bank"
npx wrangler d1 execute prep-arena-db --local --persist-to "$S" --file ../schema.sql >/dev/null
node -e '
const fs=require("fs"),d=process.argv[1];
fs.writeFileSync(d+"/index.json",JSON.stringify({id:"anatomy",topics:[{id:"ana-s",count:10,file:"mcq/ana-s.json"}]}));
fs.writeFileSync(d+"/mod.json",JSON.stringify({items:Array.from({length:10},(_,i)=>({id:"s"+i,q:"Smoke "+i,o:["A","B","C","D"],a:0,exp:"",t:"ana-s",d:1}))}));' "$S/bank"
npx wrangler r2 object put stewardmd-offline/prep-bank/v1/anatomy/index.json --local --persist-to "$S" --file "$S/bank/index.json" >/dev/null
npx wrangler r2 object put stewardmd-offline/prep-bank/v1/anatomy/mcq/ana-s.json --local --persist-to "$S" --file "$S/bank/mod.json" >/dev/null
npx wrangler dev --local --port 8799 --persist-to "$S" > "$S/dev.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -m 2 -o /dev/null http://localhost:8799/ && break; sleep 1; done
node client.mjs ws://localhost:8799/battle
FORFEIT=1 node client.mjs ws://localhost:8799/battle
npx wrangler d1 execute prep-arena-db --local --persist-to "$S" --command "SELECT uidh, rating, battles, wins FROM arena_players; SELECT id, a, b, a_score, b_score, winner, a_after, b_after FROM arena_battles;" 2>/dev/null | grep -E '"(uidh|rating|battles|wins|a_score|b_score|winner|a_after|b_after)"' | tr -d ' \n'; echo
