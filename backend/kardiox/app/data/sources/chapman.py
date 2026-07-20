"""Chapman-Shaoxing 12-lead ECG — DatasetProvider (open, CC-BY-4.0).

The Chapman University / Shaoxing People's Hospital corpus: WFDB 12-lead records (500 Hz, ~10 s) plus a
per-record diagnosis table mapping each recording to one or more SNOMED-CT condition codes. KardioX does
NOT bundle or download the data — the operator obtains it under its own CC-BY terms and points KARDIOX at
the local root. Samples STREAM one record at a time (each waveform is read via lazy `wfdb` only when the
generator reaches it), so the ~45k-record corpus never loads fully into RAM.

Labelling: a curated built-in SNOMED-CT -> short condition-name map covers the common rhythm/conduction
classes (SB, SR, AFIB, ST, ...). Codes outside the map are ignored (never fabricated); a diagnosis cell
already containing those short names (some releases store acronyms, not codes) is accepted as-is. The
label space is the map's condition-name set.

Expected root layout (any nesting works — records are located by header basename):
  <root>/.../<RECORD>.hea + <RECORD>.mat|.dat   # WFDB 12-lead signal records
  <root>/.../Diagnostics.csv                    # header with a record-id column + a SNOMED/Dx column
"""
from __future__ import annotations

import csv
import os
import re
from collections.abc import Iterator

from app.data.base import (
    ACCESS_OPEN,
    LABELS,
    WAVEFORM,
    DatasetProvider,
    DatasetUnavailable,
    Sample,
    lazy_import,
)

# ── curated SNOMED-CT -> KardioX short condition name ─────────────────────────────────────────────
# A deliberately small, high-confidence subset (PhysioNet-2020 SNOMED mapping) covering the common
# Chapman-Shaoxing rhythm + conduction/morphology classes. Unmapped codes are silently ignored.
_SNOMED_TO_CONDITION: dict[str, str] = {
    # rhythms
    "426177001": "SB",      # sinus bradycardia
    "426783006": "SR",      # sinus rhythm
    "164889003": "AFIB",    # atrial fibrillation
    "164890007": "AFL",     # atrial flutter
    "427084000": "ST",      # sinus tachycardia
    "427393009": "SA",      # sinus arrhythmia
    "426761007": "SVT",     # supraventricular tachycardia
    "713422000": "AT",      # atrial tachycardia
    "233896004": "AVNRT",   # AV-nodal reentrant tachycardia
    "233897008": "AVRT",    # AV reentrant tachycardia
    # conduction / axis
    "270492004": "IAVB",    # first-degree AV block
    "164909002": "LBBB",    # left bundle branch block
    "59118001": "RBBB",     # right bundle branch block
    "713427006": "CRBBB",   # complete right bundle branch block
    "445118002": "LAnFB",   # left anterior fascicular block
    "698252002": "NSIVCB",  # non-specific intraventricular conduction block
    "39732003": "LAD",      # left axis deviation
    "47665007": "RAD",      # right axis deviation
    # ectopy / morphology
    "284470004": "PAC",     # premature atrial contraction
    "427172004": "PVC",     # premature ventricular contractions
    "164917005": "QAb",     # abnormal Q wave
    "164934002": "TAb",     # abnormal T wave
    "59931005": "TInv",     # T-wave inversion
    "429622005": "STD",     # ST depression
    "251146004": "LQRSV",   # low QRS voltage
    "55827005": "LVH",      # left ventricular hypertrophy
    "111975006": "LQT",     # prolonged QT interval
}
_CONDITION_NAMES: frozenset[str] = frozenset(_SNOMED_TO_CONDITION.values())
# case-insensitive acronym -> canonical name, so a release storing "TINV"/"LANFB" still maps correctly
_UPPER_TO_CANONICAL: dict[str, str] = {v.upper(): v for v in _SNOMED_TO_CONDITION.values()}

# CSV header detection (case-insensitive). A diagnosis table needs one column of each kind.
_ID_COLS: tuple[str, ...] = (
    "filename", "file_name", "record", "recording", "recordname", "record_name", "ecg_id", "id",
)
_CODE_COLS: tuple[str, ...] = (
    "dx", "diagnosis", "diagnoses", "snomed", "snomedctcode", "snomed_ct_code", "snomed_ct",
    "codes", "code", "labels", "label", "rhythm",
)
# Preferred diagnosis-table filenames (a plain code dictionary like ConditionNames_SNOMED-CT.csv is
# deprioritised — it lacks a record-id column and so fails header detection anyway).
_PREFERRED_CSV: frozenset[str] = frozenset({
    "diagnostics.csv", "diagnosis.csv", "diagnoses.csv", "labels.csv", "dx.csv", "record_labels.csv",
})
_TOKEN_SPLIT = re.compile(r"[;,|/\s]+")


class Chapman(DatasetProvider):
    """Chapman-Shaoxing 12-lead ECG (WFDB records + SNOMED-CT diagnosis CSV). Open / CC-BY-4.0."""

    name = "chapman"
    homepage = "https://physionet.org/content/ecg-arrhythmia/"
    license = "CC-BY-4.0"
    access = ACCESS_OPEN
    modalities = (WAVEFORM, LABELS)
    tasks = ("rhythm", "classification")
    fs = 500
    citation = (
        "Zheng J, et al. A 12-lead electrocardiogram database for arrhythmia research covering more "
        "than 10,000 patients. Scientific Data 7:48 (2020). PhysioNet CC-BY-4.0."
    )

    def __init__(self, root: str | None = None):
        super().__init__(root)
        self._index_cache: dict[str, str] | None = None

    # ── contract ────────────────────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True when the root holds a valid diagnosis CSV AND at least one WFDB header.

        Expected input:  none (reads self.root).
        Expected output: bool — no download, no fabrication.
        Failure modes:   returns False (never raises) for a missing/partial root.
        """
        root = self.root
        if not root or not os.path.isdir(root):
            return False
        return self._diagnosis_csv() is not None and self._has_any_record()

    def label_space(self) -> list[str]:
        """The mapped condition vocabulary (sorted, deduplicated) — the built-in SNOMED map's values."""
        return sorted(_CONDITION_NAMES)

    def splits(self) -> list[str]:
        """Chapman ships no official train/val/test partition; the whole corpus is one split ("all").
        Use the training pipeline's stratified 80/20 split instead of asking a provider for folds."""
        return ["all"]

    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream Chapman records lazily, one fully-loaded Sample at a time (memory-safe).

        Expected input:  split=None or "all" (any other value yields nothing — Chapman has no folds);
                         optional limit on the number of samples yielded.
        Expected output: Sample(waveform=(n_leads, n_samples), fs, leads, labels=[condition names], ...)
                         built by streaming the diagnosis CSV row-by-row and reading each WFDB record
                         via lazy `wfdb` as it is reached.
        Failure modes:   DatasetUnavailable if the root/CSV is missing or `wfdb` is not installed;
                         rows whose record file is absent/unreadable are skipped (never fabricated).
        """
        self._require()
        if split is not None and split not in self.splits():
            return
        wfdb = lazy_import("wfdb", "Chapman 12-lead waveform loading")
        found = self._diagnosis_csv()
        if found is None:  # defensive — _require() already validated availability
            raise DatasetUnavailable(f"{self.name}: no diagnosis CSV under root={self.root!r}")
        csv_path, id_idx, code_idx = found
        index = self._record_index()

        n = 0
        with open(csv_path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.reader(fh)
            if next(reader, None) is None:  # skip header
                return
            for row in reader:
                if limit is not None and n >= limit:
                    return
                if id_idx >= len(row) or code_idx >= len(row):
                    continue
                rec_id = (row[id_idx] or "").strip()
                if not rec_id:
                    continue
                base = os.path.splitext(os.path.basename(rec_id))[0]
                path = index.get(base)
                if path is None:  # record file not present locally — cannot supply a waveform
                    continue
                try:
                    rec = wfdb.rdrecord(path)
                    sig = getattr(rec, "p_signal", None)
                    if sig is None:
                        continue
                    waveform = sig.T  # WFDB stores (n_samples, n_leads) -> (n_leads, n_samples)
                except Exception:  # noqa: BLE001 — an unreadable record must not abort the stream
                    continue
                leads = [str(x) for x in (getattr(rec, "sig_name", None) or [])]
                rec_fs = int(getattr(rec, "fs", None) or self.fs or 500)
                labels = self._map_codes(row[code_idx])
                yield Sample(
                    id=base,
                    split="all",
                    waveform=waveform,
                    fs=rec_fs,
                    leads=leads,
                    labels=labels,
                    meta={"dataset": self.name, "record": rec_id, "codes": (row[code_idx] or "").strip()},
                )
                n += 1

    # ── helpers ───────────────────────────────────────────────────────────────────────────────────
    def _map_codes(self, cell: str) -> list[str]:
        """Map a diagnosis cell to KardioX condition names (order-preserving, deduplicated).

        Accepts SNOMED-CT codes (via the built-in map) and already-short condition names/acronyms;
        unrecognised tokens are dropped. Never invents a label.
        """
        out: list[str] = []
        seen: set[str] = set()
        for raw in _TOKEN_SPLIT.split((cell or "").strip()):
            tok = raw.strip()
            if not tok:
                continue
            name = _SNOMED_TO_CONDITION.get(tok) or _UPPER_TO_CANONICAL.get(tok.upper())
            if name and name not in seen:
                seen.add(name)
                out.append(name)
        return out

    def _record_index(self) -> dict[str, str]:
        """Map WFDB header basename -> extension-less record path (built once, cached; paths only)."""
        if self._index_cache is not None:
            return self._index_cache
        idx: dict[str, str] = {}
        root = self.root
        if root and os.path.isdir(root):
            for dirpath, _dirs, files in os.walk(root):
                for f in files:
                    if f.endswith(".hea"):
                        idx.setdefault(f[:-4], os.path.join(dirpath, f[:-4]))
        self._index_cache = idx
        return idx

    def _has_any_record(self) -> bool:
        """True as soon as one WFDB header is found under root (early-exit walk)."""
        root = self.root
        if not root or not os.path.isdir(root):
            return False
        for _dirpath, _dirs, files in os.walk(root):
            if any(f.endswith(".hea") for f in files):
                return True
        return False

    def _diagnosis_csv(self) -> tuple[str, int, int] | None:
        """Locate the diagnosis table and its (record-id, code) column indices, or None if absent.

        Prefers well-known filenames, then any other CSV whose header exposes both a record-id column
        and a diagnosis/SNOMED column.
        """
        root = self.root
        if not root or not os.path.isdir(root):
            return None
        candidates: list[str] = []
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.lower().endswith(".csv"):
                    candidates.append(os.path.join(dirpath, f))

        def rank(path: str) -> tuple[int, str]:
            base = os.path.basename(path).lower()
            if base in _PREFERRED_CSV:
                return (0, path)
            if base == "conditionnames_snomed-ct.csv":  # code dictionary, not a record table
                return (2, path)
            return (1, path)

        for path in sorted(candidates, key=rank):
            cols = self._detect_columns(path)
            if cols is not None:
                return (path, cols[0], cols[1])
        return None

    @staticmethod
    def _detect_columns(path: str) -> tuple[int, int] | None:
        """Return (record-id column index, code column index) from a CSV header, or None if it is not a
        record-level diagnosis table."""
        try:
            with open(path, newline="", encoding="utf-8-sig") as fh:
                header = next(csv.reader(fh), None)
        except (OSError, UnicodeDecodeError, csv.Error):
            return None
        if not header:
            return None
        norm = [(h or "").strip().lower() for h in header]
        # Pick by candidate priority (not file order) so a SNOMED/Dx column beats a plain "rhythm" one.
        id_idx = next((norm.index(c) for c in _ID_COLS if c in norm), None)
        code_idx = next((norm.index(c) for c in _CODE_COLS if c in norm), None)
        if id_idx is None or code_idx is None:
            return None
        return (id_idx, code_idx)
