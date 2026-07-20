"""PTB-XL dataset provider (PhysioNet, CC-BY-4.0).

PTB-XL is a large publicly available 12-lead ECG corpus (21,799 records / 18,869 patients) with
SCP-ECG statement annotations. KardioX does NOT bundle or download it: the operator obtains the release
from PhysioNet and points a data root at it (env KARDIOX_DATA_PTB_XL or KARDIOX_DATA_ROOT/ptb-xl, or
`root=`). Samples STREAM one record at a time — the full corpus is never held in memory.

Expected root layout (as published):
  <root>/ptbxl_database.csv     — one row per ECG (ecg_id, patient_id, scp_codes, report, strat_fold,
                                  filename_lr, filename_hr, ...)
  <root>/scp_statements.csv     — SCP statement dictionary; maps each code to its diagnostic_class
                                  superclass (NORM / MI / STTC / CD / HYP) for diagnostic statements.
  <root>/records500/...         — 500 Hz WFDB records referenced by the filename_hr column.

Label space (this provider): the five PTB-XL diagnostic SUPERCLASSES ["NORM","MI","STTC","CD","HYP"].
A record's labels are the set of superclasses reached by aggregating its scp_codes through
scp_statements.csv (multi-label; a record with no diagnostic superclass yields an empty label list).

Split convention (ExChanGeAI, MIT): stratification fold 1-8 -> train, 9 -> val, 10 -> test.

Expected input:  split in {None,"train","val","test"}; optional limit (max Samples to yield).
Expected output: an Iterator[Sample] with waveform=(12, n_samples) float array (via wfdb.rdrecord),
                 fs=500, leads from the record header, labels=superclasses, report=report column.
Failure modes:   root missing/incomplete -> DatasetUnavailable (never fabricates); wfdb not installed ->
                 DatasetUnavailable; unknown split name -> ValueError; unparsable scp_codes cell -> that
                 record yields an empty label list (the row is still streamed).
"""
from __future__ import annotations

import ast
import csv
import os
from collections.abc import Iterator

from app.data.base import (
    ACCESS_OPEN,
    LABELS,
    REPORT,
    WAVEFORM,
    DatasetProvider,
    DatasetUnavailable,
    Sample,
    lazy_import,
)

# The five PTB-XL diagnostic superclasses, in the canonical order used for the label space / encoding.
SUPERCLASSES = ["NORM", "MI", "STTC", "CD", "HYP"]

_DB_CSV = "ptbxl_database.csv"
_SCP_CSV = "scp_statements.csv"
_RECORDS_500 = "records500"


class PTBXL(DatasetProvider):
    """Streaming provider for PhysioNet PTB-XL (500 Hz records, SCP diagnostic superclasses)."""

    name = "ptb-xl"
    homepage = "https://physionet.org/content/ptb-xl/"
    license = "CC-BY-4.0"
    access = ACCESS_OPEN               # open download; attribution required (cite Wagner et al. 2020)
    modalities = (WAVEFORM, LABELS, REPORT)
    tasks = ("diagnostic-superclass-classification",)
    fs = 500
    citation = (
        "Wagner P, Strodthoff N, Bousseljot R-D, Kreiseler D, Lunze FI, Samek W, Schaeffter T. "
        "PTB-XL, a large publicly available electrocardiography dataset. Scientific Data 7, 154 (2020). "
        "PhysioNet, https://doi.org/10.13026/kfzx-aw45."
    )

    # ExChanGeAI split convention: fold 1-8 = train, 9 = val, 10 = test (insertion order = split order).
    _FOLD_SPLIT: dict[str, set[int]] = {
        "train": set(range(1, 9)),
        "val": {9},
        "test": {10},
    }

    def __init__(self, root: str | None = None):
        super().__init__(root=root)
        self._scp_map: dict[str, str] | None = None   # scp code -> superclass (parsed once, lazily)

    # ── availability ────────────────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True when the two index CSVs and the 500 Hz records directory all exist under `root`."""
        if not self.root:
            return False
        return (
            os.path.isfile(os.path.join(self.root, _DB_CSV))
            and os.path.isfile(os.path.join(self.root, _SCP_CSV))
            and os.path.isdir(os.path.join(self.root, _RECORDS_500))
        )

    # ── label / split surface ───────────────────────────────────────────────────────────────────
    def label_space(self) -> list[str]:
        """The five PTB-XL diagnostic superclasses (fixed, order-stable for multi-hot encoding)."""
        return list(SUPERCLASSES)

    def splits(self) -> list[str]:
        """["train","val","test"] — mapped onto stratification folds (1-8 / 9 / 10)."""
        return list(self._FOLD_SPLIT)

    # ── streaming ───────────────────────────────────────────────────────────────────────────────
    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream Samples for `split` (all splits when None), at most `limit` records.

        Reads ptbxl_database.csv row by row; skips rows outside the requested fold BEFORE touching the
        waveform, then loads the 500 Hz record lazily via wfdb.rdrecord. Memory footprint is one record
        at a time. Raises DatasetUnavailable if the root is missing or wfdb is not installed, and
        ValueError for an unknown split name.
        """
        self._require()
        if split is not None and split not in self._FOLD_SPLIT:
            raise ValueError(f"unknown split {split!r} (have: {list(self._FOLD_SPLIT)})")
        wanted_folds = self._FOLD_SPLIT[split] if split is not None else None

        wfdb = lazy_import("wfdb", "PTB-XL waveform loading")   # DatasetUnavailable if absent
        scp_map = self._load_scp_map()
        db_path = os.path.join(self.root, _DB_CSV)

        emitted = 0
        with open(db_path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                if limit is not None and emitted >= limit:
                    break
                fold = _to_int(row.get("strat_fold"))
                if wanted_folds is not None and fold not in wanted_folds:
                    continue

                filename_hr = (row.get("filename_hr") or "").strip()
                waveform = None
                fs = self.fs
                leads: list[str] | None = None
                if filename_hr:
                    record = wfdb.rdrecord(os.path.join(self.root, filename_hr))
                    # wfdb p_signal is (n_samples, n_leads); KardioX Sample wants (n_leads, n_samples).
                    waveform = record.p_signal.T
                    fs = int(record.fs) if record.fs else self.fs
                    leads = list(record.sig_name)

                ecg_id = (row.get("ecg_id") or "").strip()
                yield Sample(
                    id=f"ptbxl-{ecg_id}" if ecg_id else f"ptbxl-row{emitted}",
                    split=self._fold_to_split(fold),
                    waveform=waveform,
                    fs=fs,
                    leads=leads,
                    labels=self._labels_for(row.get("scp_codes"), scp_map),
                    report=(row.get("report") or None),
                    meta={
                        "ecg_id": ecg_id,
                        "patient_id": (row.get("patient_id") or "").strip(),
                        "strat_fold": fold,
                        "filename_hr": filename_hr,
                        "scp_codes": (row.get("scp_codes") or ""),
                    },
                )
                emitted += 1

    # ── internals ───────────────────────────────────────────────────────────────────────────────
    def _load_scp_map(self) -> dict[str, str]:
        """Parse scp_statements.csv once into {scp_code: superclass} for the five diagnostic classes.

        The CSV's first column (the SCP code) has an empty header; only rows whose `diagnostic_class`
        is one of the five superclasses are retained (i.e. diagnostic statements).
        """
        if self._scp_map is not None:
            return self._scp_map
        scp_path = os.path.join(self.root, _SCP_CSV)
        mapping: dict[str, str] = {}
        with open(scp_path, newline="", encoding="utf-8") as fh:
            reader = csv.reader(fh)
            try:
                header = next(reader)
            except StopIteration:
                self._scp_map = mapping
                return mapping
            try:
                dc_idx = header.index("diagnostic_class")
            except ValueError as exc:
                raise DatasetUnavailable(
                    f"{self.name}: {_SCP_CSV} has no 'diagnostic_class' column (got {header!r})"
                ) from exc
            superclasses = set(SUPERCLASSES)
            for parts in reader:
                if not parts:
                    continue
                code = parts[0].strip()
                dclass = parts[dc_idx].strip() if dc_idx < len(parts) else ""
                if code and dclass in superclasses:
                    mapping[code] = dclass
        self._scp_map = mapping
        return mapping

    def _labels_for(self, scp_raw: str | None, scp_map: dict[str, str]) -> list[str]:
        """Aggregate a record's scp_codes dict-string into ordered, de-duplicated superclass labels."""
        if not scp_raw:
            return []
        try:
            codes = ast.literal_eval(scp_raw)
        except (ValueError, SyntaxError):
            return []
        if not isinstance(codes, dict):
            return []
        found = {scp_map[str(code)] for code in codes if str(code) in scp_map}
        return [sc for sc in SUPERCLASSES if sc in found]   # canonical, stable order

    @classmethod
    def _fold_to_split(cls, fold: int) -> str | None:
        for name, folds in cls._FOLD_SPLIT.items():
            if fold in folds:
                return name
        return None


def _to_int(value: object) -> int:
    """Best-effort int parse for a CSV cell (PTB-XL fold values are integers stored as text)."""
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return 0
