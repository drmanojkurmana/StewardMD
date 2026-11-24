"""po_adapter: ResearchMD adapter seams for vendored PaperOrchestra (Phase 3.7).

Upstream lives unchanged in ../upstream and uses absolute imports
(`utils.*`, `methods.*`, `autoraters.*`), so its root must be on sys.path.
Importing this package puts it there. Nothing inside upstream/ is ever edited;
seams.py replaces the names each upstream module imported at runtime.

Contracts: docs/research/contracts/phase-3/{phi-gate,ceilings,callback}.md,
plan sections 8, 11, 12. See ../SEAMS.md for the seam map and D-5 evidence.
"""
from __future__ import annotations

import sys
from pathlib import Path

UPSTREAM_DIR = Path(__file__).resolve().parents[2] / "upstream"
UPSTREAM_COMMIT = "d9bae997e793a015ed38bb1605be9eb58c00284f"

if str(UPSTREAM_DIR) not in sys.path:
    sys.path.insert(0, str(UPSTREAM_DIR))

__all__ = ["UPSTREAM_DIR", "UPSTREAM_COMMIT"]
