"""Unified ECG dataset abstraction (KardioX data layer).

NO dataset is bundled or downloaded by KardioX. Every provider reads from an operator-supplied local
root (obtained per that dataset's own license / data-use agreement). Providers STREAM samples
(incremental, memory-safe) so large corpora like MIMIC-IV-ECG (~800k records) never load fully into RAM.

A single `DatasetProvider` subclass is all it takes to add a new dataset — the training, benchmark, and
validation pipelines consume the provider through this one interface.

Sample (the unified multimodal record):
  id, split, waveform (leads x samples), fs, leads, image_path, labels[], report, features{}, meta{}
Any modality may be absent (e.g. MIT-BIH has no report; MEETI adds images + interpretations).
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass, field

# ── modality + access constants ─────────────────────────────────────────────────────────────────
WAVEFORM = "waveform"
IMAGE = "image"
LABELS = "labels"
REPORT = "report"
FEATURES = "features"
ACCESS_OPEN = "open"                     # freely downloadable (may still require attribution)
ACCESS_CREDENTIALED = "credentialed-dua"  # PhysioNet credentialing + data-use agreement required


class DatasetUnavailable(RuntimeError):
    """Raised when a provider's data root is missing/incomplete. Providers NEVER fabricate samples."""


@dataclass
class Sample:
    """One multimodal ECG record. Fields are None/empty when a modality is absent for that dataset."""
    id: str
    split: str | None = None
    waveform: object | None = None       # numpy array (n_leads, n_samples) or list; None if image-only
    fs: int | None = None
    leads: list[str] | None = None
    image_path: str | None = None
    labels: list[str] = field(default_factory=list)
    report: str | None = None
    features: dict | None = None
    meta: dict = field(default_factory=dict)

    def to_signal(self) -> dict:
        """Adapt to the KardioX pipeline signal dict {"leads": {lead: {"mv": [...], "fs": fs}}}."""
        if self.waveform is None or not self.leads:
            return {"leads": {}, "duration_s": 0.0}
        rows = list(self.waveform)
        fs = int(self.fs or 500)
        leads = {}
        for i, name in enumerate(self.leads):
            if i < len(rows):
                mv = rows[i]
                leads[name] = {"mv": list(mv), "fs": fs}
        dur = (len(list(rows[0])) / fs) if rows else 0.0
        return {"leads": leads, "duration_s": round(float(dur), 3)}


class DatasetProvider(ABC):
    name: str = "base"
    homepage: str = ""
    license: str = "unknown"
    access: str = ACCESS_OPEN
    modalities: tuple[str, ...] = ()
    tasks: tuple[str, ...] = ()
    fs: int | None = None
    citation: str = ""
    redistribute: bool = False           # KardioX never redistributes any dataset

    def __init__(self, root: str | None = None):
        self.root = root or self._default_root()

    def _default_root(self) -> str | None:
        env_key = "KARDIOX_DATA_" + self.name.upper().replace("-", "_").replace("%", "PCT")
        if os.environ.get(env_key):
            return os.environ[env_key]
        base = os.environ.get("KARDIOX_DATA_ROOT")
        return os.path.join(base, self.name) if base else None

    # ── contract every dataset implements ─────────────────────────────────────────────────────
    @abstractmethod
    def available(self) -> bool:
        """True when the expected files exist at `root` (no download, no fabrication)."""

    @abstractmethod
    def label_space(self) -> list[str]:
        """The dataset's label vocabulary (empty for report-only / unlabeled corpora)."""

    @abstractmethod
    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream Samples lazily (memory-safe). Raise DatasetUnavailable if the data is not present."""

    # ── shared behaviour ──────────────────────────────────────────────────────────────────────
    def splits(self) -> list[str]:
        return ["train", "val", "test"]

    def describe(self) -> dict:
        return {"name": self.name, "homepage": self.homepage, "license": self.license,
                "access": self.access, "modalities": list(self.modalities), "tasks": list(self.tasks),
                "fs": self.fs, "root": self.root, "available": self._safe_available(),
                "redistribute": self.redistribute, "citation": self.citation}

    def _safe_available(self) -> bool:
        try:
            return bool(self.root) and self.available()
        except Exception:
            return False

    def _require(self) -> None:
        if not self._safe_available():
            env_key = "KARDIOX_DATA_" + self.name.upper().replace("-", "_").replace("%", "PCT")
            raise DatasetUnavailable(
                f"{self.name}: data not found at root={self.root!r}. Obtain it per its "
                f"{self.access} terms and set {env_key} (or KARDIOX_DATA_ROOT) / pass root=.")


def lazy_import(module: str, feature: str):
    """Import an optional data dependency, mapping ImportError to a clear DatasetUnavailable."""
    try:
        return __import__(module)
    except ImportError as e:  # pragma: no cover - only when the dep is absent
        raise DatasetUnavailable(f"{feature} requires '{module}' (pip install {module})") from e
