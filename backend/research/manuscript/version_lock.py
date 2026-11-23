"""Manuscript version hash and lock record (Package 5A.3).

Provides deterministic SHA-256 version hash over canonical JSON and saved run IDs,
plus a verifiable LockRecord for frozen manuscript versions.
"""
from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from typing import Any


def canonical_json_dumps(obj: Any) -> str:
    """Serialize object to canonical JSON string with sorted keys and no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_json_bytes(obj: Any) -> bytes:
    """Encode object to canonical UTF-8 JSON bytes."""
    return canonical_json_dumps(obj).encode("utf-8")


def _extract_run_ids(manuscript_json: dict, run_ids: list[str] | None = None) -> list[str]:
    """Extract and sort unique run IDs."""
    ids = set()
    if run_ids:
        ids.update(str(r) for r in run_ids if r)
    provenance = manuscript_json.get("provenance") or {}
    if isinstance(provenance, dict) and provenance.get("runIds"):
        ids.update(str(r) for r in provenance["runIds"] if r)
    tokens = manuscript_json.get("tokens") or {}
    if isinstance(tokens, dict):
        for k in tokens.keys():
            # Canonical token keys are "<runId>.<fieldPath>"; runIds carry no dot.
            run_id = k.split(".", 1)[0]
            if run_id:
                ids.add(run_id)
    return sorted(ids)


def compute_version_hash(manuscript_json: dict, run_ids: list[str] | None = None) -> str:
    """Compute deterministic SHA-256 hash over canonical JSON and sorted run IDs.

    Stable across key insertion order in manuscript_json and arbitrary order in run_ids.
    """
    clean_manuscript = copy.deepcopy(manuscript_json)
    sorted_run_ids = _extract_run_ids(clean_manuscript, run_ids)
    canonical_payload = {
        "manuscript": clean_manuscript,
        "runIds": sorted_run_ids,
    }
    return hashlib.sha256(canonical_json_bytes(canonical_payload)).hexdigest()


@dataclass
class LockRecord:
    version_hash: str
    locked_at: str
    locked_by: str
    run_ids: list[str]
    manuscript_title: str
    section_count: int
    reference_count: int
    status: str = "locked"
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> LockRecord:
        return cls(
            version_hash=data["version_hash"],
            locked_at=data["locked_at"],
            locked_by=data.get("locked_by", "researcher"),
            run_ids=data.get("run_ids", []),
            manuscript_title=data.get("manuscript_title", ""),
            section_count=data.get("section_count", 0),
            reference_count=data.get("reference_count", 0),
            status=data.get("status", "locked"),
            metadata=data.get("metadata", {}),
        )


def create_lock_record(
    manuscript_json: dict,
    run_ids: list[str] | None = None,
    *,
    locked_by: str = "researcher",
    locked_at: str | None = None,
    metadata: dict | None = None,
) -> LockRecord:
    """Create a new LockRecord for the manuscript."""
    sorted_run_ids = _extract_run_ids(manuscript_json, run_ids)
    v_hash = compute_version_hash(manuscript_json, sorted_run_ids)
    ts = locked_at or datetime.now(timezone.utc).isoformat()
    title = str(manuscript_json.get("title", ""))
    sections = manuscript_json.get("sections") or []
    references = manuscript_json.get("references") or []
    return LockRecord(
        version_hash=v_hash,
        locked_at=ts,
        locked_by=locked_by,
        run_ids=sorted_run_ids,
        manuscript_title=title,
        section_count=len(sections),
        reference_count=len(references),
        status="locked",
        metadata=metadata or {},
    )


def verify_lock_record(
    record: LockRecord | dict,
    manuscript_json: dict,
    run_ids: list[str] | None = None,
) -> bool:
    """Verify that manuscript and run IDs match the lock record version hash."""
    expected_hash = record.version_hash if isinstance(record, LockRecord) else record.get("version_hash")
    if not expected_hash:
        return False
    computed = compute_version_hash(manuscript_json, run_ids)
    return computed == expected_hash
