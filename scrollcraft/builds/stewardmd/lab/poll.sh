#!/bin/bash
U=https://fix-audit-sweep-2026-08-26.stewardmd.pages.dev/product/
for i in $(seq 1 20); do
  t=$(curl -s "$U?cb=$i" | grep -oE '<title>[^<]*</title>' | head -1)
  echo "$i  $t"
  if echo "$t" | grep -q "the decision, with its reasons"; then
    echo "DEPLOYED"
    exit 0
  fi
  sleep 15
done
echo "NOT DEPLOYED after 5 min"
exit 1
