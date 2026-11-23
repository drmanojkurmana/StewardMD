"""Tests for manuscript version hash and lock record (Package 5A.3).

Verifies:
- sha256 over canonical JSON + run IDs
- stability across dictionary key insertion order
- stability across run_ids list ordering
- lock record creation and verification
"""
from __future__ import annotations

from manuscript.version_lock import (
    LockRecord,
    compute_version_hash,
    create_lock_record,
    verify_lock_record,
)


def test_version_hash_stable_across_key_order():
    # Construct two manuscripts with identical semantics but different key orders
    m1 = {
        "title": "Meta-analysis of Intervention X",
        "sections": [
            {"id": "introduction", "heading": "Introduction", "level": 1, "text": "Background info."},
            {"id": "results", "heading": "Results", "level": 1, "text": "OR {{run:r1:estimate}}."},
        ],
        "references": [
            {"key": "ref1", "doi": "10.1000/1", "title": "Paper 1"},
        ],
        "tokens": {
            "r1:estimate": {"value": 0.62},
        },
        "metadata": {"tags": ["review", "cardiology"], "author_count": 2},
    }

    m2 = {
        "metadata": {"author_count": 2, "tags": ["review", "cardiology"]},
        "tokens": {
            "r1:estimate": {"value": 0.62},
        },
        "references": [
            {"title": "Paper 1", "key": "ref1", "doi": "10.1000/1"},
        ],
        "sections": [
            {"heading": "Introduction", "level": 1, "text": "Background info.", "id": "introduction"},
            {"level": 1, "heading": "Results", "text": "OR {{run:r1:estimate}}.", "id": "results"},
        ],
        "title": "Meta-analysis of Intervention X",
    }

    hash1 = compute_version_hash(m1, ["r1"])
    hash2 = compute_version_hash(m2, ["r1"])

    assert len(hash1) == 64
    assert hash1 == hash2


def test_version_hash_stable_across_run_ids_order():
    manuscript = {
        "title": "Review",
        "sections": [{"id": "results", "heading": "Results", "text": "Findings."}],
    }
    hash_a = compute_version_hash(manuscript, ["run_b", "run_a", "run_c"])
    hash_b = compute_version_hash(manuscript, ["run_a", "run_c", "run_b"])
    assert hash_a == hash_b


def test_version_hash_changes_with_content():
    m1 = {"title": "Title A", "sections": []}
    m2 = {"title": "Title B", "sections": []}
    assert compute_version_hash(m1, ["r1"]) != compute_version_hash(m2, ["r1"])

    # Changing run_ids changes the hash
    assert compute_version_hash(m1, ["r1"]) != compute_version_hash(m1, ["r2"])


def test_lock_record_creation_and_verification():
    manuscript = {
        "title": "Locked Review",
        "sections": [
            {"id": "introduction", "heading": "Introduction", "text": "Text 1"},
            {"id": "results", "heading": "Results", "text": "Text 2"},
        ],
        "references": [{"key": "ref1", "doi": "10.1000/1"}],
    }
    record = create_lock_record(manuscript, ["r1", "r2"], locked_by="dr_smith")
    assert isinstance(record, LockRecord)
    assert record.locked_by == "dr_smith"
    assert record.manuscript_title == "Locked Review"
    assert record.section_count == 2
    assert record.reference_count == 1
    assert record.status == "locked"
    assert record.run_ids == ["r1", "r2"]

    # Verification passes
    assert verify_lock_record(record, manuscript, ["r2", "r1"]) is True

    # Verification fails if manuscript is modified
    tampered = dict(manuscript, title="Modified Title")
    assert verify_lock_record(record, tampered, ["r1", "r2"]) is False

    # Roundtrip serialization
    d = record.to_dict()
    restored = LockRecord.from_dict(d)
    assert restored.version_hash == record.version_hash
    assert restored.locked_at == record.locked_at
