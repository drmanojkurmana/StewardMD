"""Manuscript package for ResearchMD (Package 5A.3).

Provides deterministic token rendering, version locking, and DOCX export
for IMRAD JSON manuscripts.
"""
from __future__ import annotations

from .docx_export import UnresolvedCitationError, export, format_vancouver
from .render_tokens import (
    RULE_TABLE,
    UnresolvedTokenError,
    format_apa_p_value,
    format_ci,
    format_count,
    format_effect,
    format_heterogeneity,
    render_tokens,
)
from .version_lock import (
    LockRecord,
    compute_version_hash,
    create_lock_record,
    verify_lock_record,
)

__all__ = [
    "LockRecord",
    "RULE_TABLE",
    "UnresolvedCitationError",
    "UnresolvedTokenError",
    "compute_version_hash",
    "create_lock_record",
    "export",
    "format_apa_p_value",
    "format_ci",
    "format_count",
    "format_effect",
    "format_heterogeneity",
    "format_vancouver",
    "render_tokens",
    "verify_lock_record",
]
