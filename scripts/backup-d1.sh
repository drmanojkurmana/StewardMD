#!/usr/bin/env bash
# backup-d1.sh — cold, OFF-platform archival export of every D1 database to local SQL files.
# D1 ALREADY has automatic 30-day point-in-time recovery (Time Travel) — see docs/BACKUP_DR.md.
# This is the extra off-Cloudflare copy (run on a schedule from a trusted box / CI, then push the
# output to durable storage you control). Needs `wrangler login`.
# Usage: scripts/backup-d1.sh [output-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-./d1-backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"
DBS=(stewardmd-nmc stewardmd-updates stewardmd-connect)
fail=0
for db in "${DBS[@]}"; do
  echo "== exporting $db =="
  if npx wrangler d1 export "$db" --remote --output "$OUT/$db.sql"; then
    echo "  ok: $OUT/$db.sql ($(wc -c < "$OUT/$db.sql" 2>/dev/null || echo 0) bytes)"
  else
    echo "  FAILED: $db"; fail=1
  fi
done
[ "$fail" = "0" ] && echo "D1 backup complete -> $OUT" || { echo "D1 backup had failures"; exit 1; }
ls -la "$OUT"
