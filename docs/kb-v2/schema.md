# KB schema v2: what every disease entry gets

Worktree: /Users/diwakarkumar/Developer/StewardMD/.claude/worktrees/kb-10-pilot
Edit only the JSON files in your batch list. Never edit kb/dist, scripts, js, css, html, index.json.
Never run git. Never commit. Keep every existing key as it is; only ADD or EXTEND the v2 keys below.
If a file already has v2 keys (pilot entries), keep what is there and add only the missing table kinds.
Write JSON with 2-space indent and ensure_ascii false (python: json.dump(d, f, ensure_ascii=False, indent=2) then a trailing newline).
No em dash (U+2014) or en dash (U+2013) anywhere in text you write. Use "to", commas or hyphens.
No HTML in strings. Units with numbers ("<20 mEq/L"). Plain clinical English.

## Keys

"citations": [ { "id": "c1", "label": "Short source name, year", "url": "https://...", "kind": "web" | "user-supplied" | "entry" } ]
  - kind "entry" = facts taken from this entry's own existing text; label it with the entry's existing source string (for example "Harrison's Principles of Internal Medicine, 22e") and no url.
  - kind "user-supplied" = the owner's tables PDF; label like "Tables PDF, Table 44-2"; no url.

"valueTables": up to three tables, each with a "kind":
  {
    "id": "<entry-id>-diagnostic" | "<entry-id>-ddx" | "<entry-id>-treatment",
    "kind": "diagnostic" | "ddx" | "treatment",
    "title": "...",
    "rowHeader": "Criterion" | "Condition" | "Option",
    "columns": ["...", "..."],            // value columns only; the row label column is rowHeader
    "rows": [ { "parameter": "row label", "unit": "optional", "cells": [ { "text": "..." , "op": ">", "value": 20 } ], "cite": "c1" } ],
    "footnote": "optional caveat"
  }
  diagnostic: diagnostic criteria, key lab or imaging values, scores. Numeric cells carry op+value or "range": [lo, hi].
  ddx: rows = look-alike conditions; columns like ["Key distinguishing feature", "Best test to separate"].
  treatment: rows = options in order (first line, alternative, escalation, supportive); columns like ["When to use", "Notes"]. Doses ONLY when the cited source states them, copied as stated.
  Every row has "cite". Each row has the same number of cells as columns.

"flowcharts": [ {
    "id": "<entry-id>-dx-mgmt",
    "title": "Diagnosis and management of <disease>",
    "start": "n1",
    "nodes": [ { "id": "n1", "type": "start" | "decision" | "action" | "outcome", "text": "...", "cite": "c1" } ],
    "edges": [ { "from": "n1", "to": "n2", "label": "Yes" | "No" | "Next" | short condition } ]
  } ]
  Every decision has 2 or more labelled outgoing edges. Outcomes have none. Every node reachable from start. Every node has cite.
  Keep it 6 to 18 nodes. Node text under 90 characters.

High-yield markup: wrap the single most important point per table row only when it is clearly the key exam or bedside point: {{hy:text}}. Use sparingly (0 to 3 per table).

## Truth rules (non-negotiable)
- Every number, threshold, dose, percentage, drug name in a treatment table, and every diagnostic criterion must come from a cited source (web page you actually opened, the owner's tables PDF inventory, or this entry's own text).
- If you cannot source a cell, write "needs-source" as the cell text with no number. Never fill from memory.
- Paraphrase. Do not copy sentences verbatim from any source.
- review.status stays "ai_drafted". Never set approved. Never add a reviewer.

## Validate before you finish each file
python3 scripts/kb_validate_v2.py <file>   (run from the worktree; must print "ok")
