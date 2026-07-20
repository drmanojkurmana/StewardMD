"""MIMIC-IV-ECG dataset provider (KardioX data layer).

MIMIC-IV-ECG is the Diagnostic Electrocardiogram Matched Subset of MIMIC-IV: ~800k 10-second, 12-lead,
500 Hz records with the cart's free-text machine report (report_0..report_17) and a handful of numeric
machine measurements (intervals + axes). It has NO curated diagnostic taxonomy — downstream tasks derive
their own labels from the reports/measurements — so `label_space()` is empty by design.

Access is CREDENTIALED: KardioX bundles/downloads NOTHING. The operator obtains the corpus themselves
after PhysioNet credentialing + signing the data-use agreement, places it at a local root, and points
this provider at it (env `KARDIOX_DATA_MIMIC_IV_ECG`, or `KARDIOX_DATA_ROOT/mimic-iv-ecg`, or `root=`).
It is never redistributed.

Everything STREAMS (generators, memory-safe): the ~800k-row `record_list.csv` is read row by row, and the
waveform for a study is loaded lazily (wfdb) only when it is yielded. The one bounded in-memory structure
is the study_id -> (report, features) join lookup built from `machine_measurements.csv`; it is column-
bounded (numeric measurements are tiny; free-text reports are opt-in via `include_reports`).

Expected root layout (as distributed by PhysioNet):
  <root>/record_list.csv            columns: subject_id, study_id, file_name, path
  <root>/machine_measurements.csv   columns: subject_id, study_id, ..., report_0..report_17
  <root>/files/pXXXX/pXXXXXXXX/sXXXXXXXX/XXXXXXXX.{hea,dat}   WFDB records
  <root>/kardiox_index.jsonl        (optional) index produced by build_index() for resumable streaming
"""
from __future__ import annotations

import csv
import json
import logging
import os
import re
import sys
from collections.abc import Iterator

from app.data.base import (ACCESS_CREDENTIALED, FEATURES, REPORT, WAVEFORM, DatasetProvider,
                           DatasetUnavailable, Sample, lazy_import)

logger = logging.getLogger(__name__)

RECORD_LIST_CSV = "record_list.csv"
MACHINE_MEASUREMENTS_CSV = "machine_measurements.csv"
DEFAULT_INDEX = "kardiox_index.jsonl"

# Numeric machine-measurement columns (intervals in ms, axes in degrees) present in machine_measurements.csv.
# We select ONLY these (usecols-style) so the join lookup stays memory-bounded regardless of file size.
MEASUREMENT_COLUMNS: tuple[str, ...] = (
    "rr_interval", "p_onset", "p_end", "qrs_onset", "qrs_end", "t_end",
    "p_axis", "qrs_axis", "t_axis",
)

_REPORT_RE = re.compile(r"report_(\d+)$")


class MimicIVECG(DatasetProvider):
    """Streaming provider for the MIMIC-IV-ECG matched diagnostic subset.

    Flags:
      include_waveform  load p_signal lazily via wfdb (default True). False => report/feature-only stream
                        (no signal I/O), useful for building report-generation / label-mining datasets.
      include_reports   store the concatenated free-text machine report (default True). False => skip the
                        report columns entirely when building the join lookup, to minimize memory.
      index_path        optional path to a build_index() JSONL; if omitted, <root>/kardiox_index.jsonl is
                        used when present, else record_list.csv is streamed directly.
    """

    name = "mimic-iv-ecg"
    homepage = "https://physionet.org/content/mimic-iv-ecg"
    license = "PhysioNet Credentialed Health Data License 1.5.0 + data-use agreement"
    access = ACCESS_CREDENTIALED
    modalities = (WAVEFORM, REPORT, FEATURES)
    tasks = ("report-generation", "representation-learning")
    fs = 500
    citation = (
        "Gow, B., Pollard, T., Nathanson, L. A., et al. (2023). MIMIC-IV-ECG: Diagnostic "
        "Electrocardiogram Matched Subset (version 1.0). PhysioNet. https://doi.org/10.13026/4nqg-sb35"
    )
    redistribute = False

    def __init__(self, root: str | None = None, *, include_waveform: bool = True,
                 include_reports: bool = True, index_path: str | None = None):
        super().__init__(root)
        self.include_waveform = bool(include_waveform)
        self.include_reports = bool(include_reports)
        self.index_path = index_path
        self._meas_cache: dict[str, tuple[str | None, dict | None]] | None = None

    # ── path helpers ───────────────────────────────────────────────────────────────────────────
    def _record_list_path(self) -> str:
        return os.path.join(self.root, RECORD_LIST_CSV)

    def _measurements_path(self) -> str:
        return os.path.join(self.root, MACHINE_MEASUREMENTS_CSV)

    def _resolve_index_path(self) -> str | None:
        if self.index_path:
            return self.index_path
        return os.path.join(self.root, DEFAULT_INDEX) if self.root else None

    # ── contract ───────────────────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True when <root>/record_list.csv exists (the minimum needed to stream the corpus)."""
        return bool(self.root) and os.path.isfile(self._record_list_path())

    def label_space(self) -> list[str]:
        """Empty: MIMIC-IV-ECG has no curated taxonomy. Labels are free-text machine reports; downstream
        tasks (e.g. report-derived diagnostic classes) build their own label space from `Sample.report`."""
        return []

    def splits(self) -> list[str]:
        """["all"] — MIMIC-IV-ECG ships no official train/val/test split. Define reproducible
        subject-level (subject_id) splits downstream to avoid patient leakage across folds."""
        return ["all"]

    def describe(self) -> dict:
        d = super().describe()
        d.update({
            "include_waveform": self.include_waveform,
            "include_reports": self.include_reports,
            "recordList": self.available(),
            "machineMeasurements": bool(self.root) and os.path.isfile(self._measurements_path()),
            "index": bool(self._resolve_index_path()) and os.path.isfile(self._resolve_index_path()),
            "splitsNote": "no official split; define subject-level splits downstream",
        })
        return d

    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream Samples lazily (memory-safe), joining record_list <-> machine_measurements on study_id.

        Expected input:  optional `split` (only "all"/None; MIMIC has no official split, so it is ignored)
                         and optional `limit` (max samples to yield).
        Expected output: an iterator of Sample(id=study_id, split="all", waveform=(n_leads,n_samples) or
                         None, fs, leads, labels=[], report=<concatenated machine report or None>,
                         features=<numeric measurements or None>, meta={subject_id, path, file_name}).
        Failure modes:   raises DatasetUnavailable if the root/record_list is absent, or (only when
                         include_waveform) if wfdb/numpy are not installed. Individual unreadable/corrupt
                         records are logged and skipped — the stream never crashes on a single bad record.
        """
        self._require()
        lookup = self._measurement_lookup()
        count = 0
        for rec in self._iter_records():
            if limit is not None and count >= limit:
                return
            study_id = rec.get("study_id")
            if not study_id:
                continue
            report, features = lookup.get(study_id, (None, None))
            waveform: object | None = None
            leads: list[str] | None = None
            fs = self.fs
            if self.include_waveform:
                loaded = self._load_waveform(rec.get("path") or "", rec.get("file_name") or "")
                if loaded is None:
                    continue  # unreadable record — already logged; skip, never crash the stream
                waveform, leads, fs = loaded
            yield Sample(
                id=study_id, split="all", waveform=waveform, fs=fs, leads=leads,
                image_path=None, labels=[], report=report, features=features,
                meta={"subject_id": rec.get("subject_id"), "path": rec.get("path") or "",
                      "file_name": rec.get("file_name") or ""},
            )
            count += 1

    # ── incremental index ────────────────────────────────────────────────────────────────────────
    def build_index(self, out_jsonl_path: str) -> str:
        """Stream record_list.csv and write one JSON line per study for resumable/incremental processing.

        Expected input:  `out_jsonl_path` — destination JSONL. If it already exists, its study_ids are
                         read first and skipped so the build is RESUMABLE (append-only, idempotent).
        Expected output: writes lines {study_id, subject_id, path, file_name}; returns `out_jsonl_path`.
        Failure modes:   raises DatasetUnavailable if the data root/record_list is absent.
        """
        self._require()
        existing: set[str] = set()
        if os.path.isfile(out_jsonl_path):
            for rec in self._iter_index_rows(out_jsonl_path):
                if rec.get("study_id"):
                    existing.add(rec["study_id"])
        out_dir = os.path.dirname(os.path.abspath(out_jsonl_path))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        written = 0
        with open(out_jsonl_path, "a", encoding="utf-8") as f:
            for rec in self._iter_record_rows():
                sid = rec.get("study_id")
                if not sid or sid in existing:
                    continue
                f.write(json.dumps({
                    "study_id": sid, "subject_id": rec.get("subject_id"),
                    "path": rec.get("path") or "", "file_name": rec.get("file_name") or "",
                }, ensure_ascii=False) + "\n")
                existing.add(sid)
                written += 1
        logger.info("%s: build_index wrote %d new studies -> %s", self.name, written, out_jsonl_path)
        return out_jsonl_path

    # ── record iteration (index if present, else record_list.csv) ─────────────────────────────────
    def _iter_records(self) -> Iterator[dict]:
        index_path = self._resolve_index_path()
        if index_path and os.path.isfile(index_path):
            logger.info("%s: streaming from index %s", self.name, index_path)
            yield from self._iter_index_rows(index_path)
        else:
            yield from self._iter_record_rows()

    def _iter_record_rows(self) -> Iterator[dict]:
        """Read record_list.csv row by row (never loading all rows at once)."""
        self._widen_csv_limit()
        with open(self._record_list_path(), newline="", encoding="utf-8", errors="replace") as f:
            for row in csv.DictReader(f):
                yield {
                    "study_id": (row.get("study_id") or "").strip(),
                    "subject_id": (row.get("subject_id") or "").strip() or None,
                    "path": (row.get("path") or "").strip(),
                    "file_name": (row.get("file_name") or "").strip(),
                }

    def _iter_index_rows(self, index_path: str) -> Iterator[dict]:
        """Read a build_index() JSONL line by line."""
        with open(index_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("%s: skipping malformed index line", self.name)
                    continue
                yield {
                    "study_id": str(rec.get("study_id") or "").strip(),
                    "subject_id": rec.get("subject_id"),
                    "path": rec.get("path") or "",
                    "file_name": rec.get("file_name") or "",
                }

    # ── machine_measurements.csv join lookup ──────────────────────────────────────────────────────
    def _measurement_lookup(self) -> dict[str, tuple[str | None, dict | None]]:
        """Build (once, cached) study_id -> (report, features), reading ONLY the report + measurement
        columns to bound memory. Returns {} if machine_measurements.csv is absent (waveform-only mode)."""
        if self._meas_cache is not None:
            return self._meas_cache
        path = self._measurements_path()
        lookup: dict[str, tuple[str | None, dict | None]] = {}
        if not os.path.isfile(path):
            logger.info("%s: no %s at %r; reports/features unavailable",
                        self.name, MACHINE_MEASUREMENTS_CSV, path)
            self._meas_cache = lookup
            return lookup
        self._widen_csv_limit()
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            fields = reader.fieldnames or []
            report_cols = self._report_columns(fields) if self.include_reports else []
            meas_cols = [c for c in MEASUREMENT_COLUMNS if c in fields]
            for row in reader:
                sid = (row.get("study_id") or "").strip()
                if not sid:
                    continue
                report = self._join_reports(row, report_cols) if report_cols else None
                features = self._extract_features(row, meas_cols) or None
                lookup[sid] = (report, features)
        logger.info("%s: measurement lookup built for %d studies (reports=%s)",
                    self.name, len(lookup), self.include_reports)
        self._meas_cache = lookup
        return lookup

    @staticmethod
    def _report_columns(fields: list[str]) -> list[str]:
        cols = [c for c in fields if _REPORT_RE.match(c)]
        return sorted(cols, key=lambda c: int(_REPORT_RE.match(c).group(1)))

    @staticmethod
    def _join_reports(row: dict, cols: list[str]) -> str | None:
        parts = []
        for c in cols:
            v = row.get(c)
            if v and str(v).strip():
                parts.append(str(v).strip())
        return " ".join(parts) if parts else None

    @staticmethod
    def _extract_features(row: dict, cols: list[str]) -> dict:
        out: dict = {}
        for c in cols:
            v = row.get(c)
            if v is None or str(v).strip() == "":
                continue
            try:
                out[c] = float(v)
            except (TypeError, ValueError):
                continue
        return out

    # ── waveform loading (lazy wfdb) ──────────────────────────────────────────────────────────────
    def _load_waveform(self, path: str, file_name: str):
        """Load one record via wfdb; return (waveform (n_leads,n_samples), leads, fs) or None on failure.

        Missing wfdb/numpy is a hard environment error (DatasetUnavailable). A per-record read failure is
        logged and returns None so the caller can skip that study without crashing the stream.
        """
        if not file_name:
            logger.warning("%s: record missing file_name (path=%r); skipping", self.name, path)
            return None
        np = lazy_import("numpy", "MIMIC-IV-ECG waveform streaming")
        wfdb = lazy_import("wfdb", "MIMIC-IV-ECG waveform streaming")
        rec_base = os.path.join(self.root, path, file_name)
        try:
            record = wfdb.rdrecord(rec_base)
            sig = np.asarray(record.p_signal, dtype="float32")
            if sig.ndim != 2 or sig.size == 0:
                raise ValueError(f"empty/malformed p_signal (shape={getattr(sig, 'shape', None)})")
            waveform = sig.T  # (n_samples, n_leads) -> (n_leads, n_samples)
            leads = list(record.sig_name) if record.sig_name else None
            fs = int(record.fs) if record.fs else self.fs
            return waveform, leads, fs
        except DatasetUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - guard every per-record failure; never crash the stream
            logger.warning("%s: failed to read record %r: %s: %s",
                           self.name, rec_base, type(e).__name__, e)
            return None

    @staticmethod
    def _widen_csv_limit() -> None:
        """Allow long free-text report fields (default csv field limit can be too small)."""
        try:
            csv.field_size_limit(sys.maxsize)
        except OverflowError:  # pragma: no cover - platform-dependent C long overflow
            csv.field_size_limit(2 ** 31 - 1)
