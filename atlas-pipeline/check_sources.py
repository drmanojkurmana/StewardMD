"""The clearance gate. Every pipeline entry point calls require_clear() first.

Rationale: the licence research found several obvious, high-quality sources are
unusable for a commercial product — FSL's terms even reach the development process,
so merely using it to compute coordinates taints the output. A gate in code is
cheaper and more reliable than remembering.
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT = os.path.join(_HERE, "sources.json")


class SourceNotCleared(Exception):
    pass


def load_sources(path=None):
    """The register, keyed by source id. Keys starting with "_" are notes, not sources."""
    with open(path or _DEFAULT, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def require_clear(*source_ids):
    """Raise unless every id is present in the register with verdict CLEAR."""
    reg = load_sources()
    for sid in source_ids:
        row = reg.get(sid)
        if row is None:
            raise SourceNotCleared(
                "%r is not in the clearance register. Add a verified row to "
                "atlas-pipeline/sources.json before using it." % sid)
        if row.get("verdict") != "CLEAR":
            raise SourceNotCleared(
                "%r is %s: %s" % (sid, row.get("verdict"),
                                  row.get("blocking_clause") or row.get("note") or "not cleared"))
