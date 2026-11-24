"""Shared gates and manifests for the 5D stats package.

No LLM call and no network client exists in this package. Patient-level rows
never leave the worker process; only aggregate statistics and a data hash are
written to result.json (plan 5C.3, integrity rules 5 and 10).
"""
from __future__ import annotations

import hashlib
import json
import math
import platform

import numpy as np
import scipy
import statsmodels

ENGINE = "research-stats"
__version__ = "1.0.0"


class IpdGateError(ValueError):
    """The input lacks the 5C.3 compliance flag; the model refuses to run."""

    def __init__(self, message: str = "ipd_gate"):
        super().__init__(message)
        self.code = "ipd_gate"


def require_ipd_approval(compliance) -> None:
    """Refuse unless compliance == {"ipdApproved": True, "evidenceId": <str>}.

    evidenceId names the IRB/consent evidence uploaded under 5C.1. The flag is
    checked on every public entry point, not only at upload time.
    """
    if not isinstance(compliance, dict):
        raise IpdGateError()
    if compliance.get("ipdApproved") is not True:
        raise IpdGateError()
    evidence = compliance.get("evidenceId")
    if not isinstance(evidence, str) or not evidence.strip() or len(evidence) > 200:
        raise IpdGateError()


def data_hash(data) -> str:
    """sha256 of the canonical JSON of the input data (sorted keys, no NaN)."""
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def package_versions() -> dict:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "statsmodels": statsmodels.__version__,
    }


def model_manifest(model: dict, data, n: int, engine_version: str) -> dict:
    """Every result records the model spec, a data hash and package versions."""
    return {
        "engine": ENGINE,
        "engineVersion": engine_version,
        "model": model,
        "dataHash": data_hash(data),
        "n": n,
        "packages": package_versions(),
    }


def as_float_array(values, name: str) -> np.ndarray:
    arr = np.asarray(values, dtype=float)
    if arr.ndim != 1:
        raise ValueError(f"{name} must be a one-dimensional array")
    if not np.all(np.isfinite(arr)):
        raise ValueError(f"{name} contains non-finite values")
    return arr


def check_columns(columns: dict, names: list[str]) -> dict[str, np.ndarray]:
    """Validate a column-oriented dataset; return finite float arrays."""
    if not isinstance(columns, dict):
        raise ValueError("columns must be an object of named arrays")
    out = {}
    n = None
    for name in names:
        if name not in columns:
            raise ValueError(f"missing column {name}")
        arr = as_float_array(columns[name], name)
        if n is None:
            n = len(arr)
        elif len(arr) != n:
            raise ValueError(f"column {name} has a different length")
        out[name] = arr
    if n is None or n == 0:
        raise ValueError("empty dataset")
    return out


def z_value(level: float) -> float:
    if not 0 < level < 1:
        raise ValueError("level must be between 0 and 1")
    from scipy.stats import norm

    return float(norm.ppf((1 + level) / 2))


def finite_or_none(x) -> float | None:
    x = float(x)
    return x if math.isfinite(x) else None