"""CODE-15% dataset provider — streaming 12-lead ECGs + 6 diagnostic labels from HDF5 + a CSV metadata sidecar.

CODE-15% (Ribeiro et al.) is an open-access 15% subsample of the Telehealth Network of Minas Gerais CODE
cohort: ~345k 12-lead exams at 400 Hz, each tracing zero-padded to 4096 samples. Six binary diagnoses
per exam — 1dAVb, RBBB, LBBB, SB, AF, ST — live in `exams.csv`; the waveforms live in a handful of
`exams_part*.hdf5` files as a `tracings` dataset shaped (N, 4096, 12) plus a parallel `exam_id` vector.

KardioX bundles/downloads nothing: the operator obtains CODE-15% from Zenodo under its own terms and points
`KARDIOX_DATA_CODE_15` (or `KARDIOX_DATA_ROOT/code-15`) at the extracted folder. iter_samples STREAMS the
HDF5 row-by-row — each waveform is read as a single index slice `tracings[i]`, so the multi-gigabyte
`tracings` array is NEVER materialised in RAM. Labels are joined per row from an in-memory index of the
(small) `exams.csv`; a row with no CSV match is skipped, never fabricated.

Expected input:  a local CODE-15% root containing `exams.csv` + >=1 `exams_part*.hdf5` (or `exams.hdf5`).
Expected output: iter_samples -> Iterator[Sample] with waveform (12, 4096) float, fs=400, leads in
                 STANDARD_LEADS order, labels = the subset of the 6 diagnoses flagged True for that exam.
Failure modes:   root missing/incomplete -> DatasetUnavailable (via _require); h5py not installed ->
                 DatasetUnavailable (via lazy_import); HDF5 file lacking tracings/exam_id -> that file
                 is skipped.
"""
from __future__ import annotations

import csv
import glob
import os
import re
from collections.abc import Iterator

from app.data.base import (ACCESS_OPEN, LABELS, WAVEFORM, DatasetProvider, DatasetUnavailable, Sample,
                           lazy_import)


class CODE15(DatasetProvider):
    """CODE-15% — open-access 12-lead ECG corpus with six binary diagnostic labels (streamed from HDF5)."""

    name = "code-15"
    homepage = "https://zenodo.org/records/4916206"
    license = "open-access via Zenodo (verify terms; research use)"
    access = ACCESS_OPEN
    modalities = (WAVEFORM, LABELS)
    tasks = ("rhythm", "conduction")
    fs = 400
    citation = ("Ribeiro et al., 'Automatic diagnosis of the 12-lead ECG using a deep neural network', "
                "Nat Commun 11:1760 (2020); CODE-15% dataset, Zenodo doi:10.5281/zenodo.4916206.")

    # The six binary diagnoses carried in exams.csv (column names == label names). Order is the label space.
    LABEL_COLUMNS: tuple[str, ...] = ("1dAVb", "RBBB", "LBBB", "SB", "AF", "ST")
    # CODE tracings are stored as {DI, DII, DIII, AVR, AVL, AVF, V1..V6}; mapped to KardioX STANDARD_LEADS.
    LEADS: tuple[str, ...] = ("I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6")
    EXAMS_CSV = "exams.csv"

    def __init__(self, root: str | None = None):
        super().__init__(root)
        self._index: dict[int, dict] | None = None   # cached exam_id -> metadata/labels (from exams.csv)

    # ── availability ────────────────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True iff `root` holds `exams.csv` and at least one `exams_part*.hdf5` (or `exams.hdf5`)."""
        if not self.root or not os.path.isdir(self.root):
            return False
        if not os.path.isfile(os.path.join(self.root, self.EXAMS_CSV)):
            return False
        return len(self._hdf5_files()) > 0

    def label_space(self) -> list[str]:
        """The six CODE-15% binary diagnoses (multi-hot; an all-False exam is a normal ECG => [])."""
        return list(self.LABEL_COLUMNS)

    def splits(self) -> list[str]:
        """CODE-15% ships no official partition; the training layer makes its own stratified split."""
        return ["all"]

    # ── streaming ───────────────────────────────────────────────────────────────────────────────
    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream Samples lazily, one HDF5 row at a time (memory-safe; never loads the full `tracings`).

        `split` is accepted for interface parity but not used to filter (the corpus has no native split;
        every yielded Sample has split=None). `limit`, when set, caps the number of Samples yielded.
        Raises DatasetUnavailable if the data root is missing or h5py is not installed.
        """
        self._require()
        h5py = lazy_import("h5py", f"{self.name} (HDF5 tracings)")
        index = self._label_index()
        leads = list(self.LEADS)
        yielded = 0
        for path in self._hdf5_files():
            with h5py.File(path, "r") as f:
                if "tracings" not in f or "exam_id" not in f:
                    continue
                tracings = f["tracings"]        # (N, 4096, 12) dataset handle — NOT read into memory
                exam_ids = f["exam_id"]         # (N,) dataset handle
                n_rows = int(tracings.shape[0])
                source_file = os.path.basename(path)
                for i in range(n_rows):
                    if limit is not None and yielded >= limit:
                        return
                    exam_id = int(exam_ids[i])            # single-element read
                    row = index.get(exam_id)
                    if row is None:                        # no CSV metadata -> skip (never fabricate)
                        continue
                    waveform = tracings[i].T               # single-row slice -> (12, 4096)
                    labels = [c for c in self.LABEL_COLUMNS if row["labels"].get(c)]
                    yield Sample(
                        id=f"{self.name}:{exam_id}",
                        split=None,
                        waveform=waveform,
                        fs=self.fs,
                        leads=list(leads),
                        labels=labels,
                        meta={"exam_id": exam_id, "age": row["age"], "is_male": row["is_male"],
                              "patient_id": row["patient_id"], "source_file": source_file, "row_index": i},
                    )
                    yielded += 1

    # ── internals ───────────────────────────────────────────────────────────────────────────────
    def _hdf5_files(self) -> list[str]:
        """Sorted list of tracing HDF5 files: `exams_part*.hdf5` (numeric order), else `exams.hdf5`."""
        files = glob.glob(os.path.join(self.root, "exams_part*.hdf5"))
        if not files:
            files = glob.glob(os.path.join(self.root, "exams.hdf5"))
        return sorted(files, key=self._part_key)

    @staticmethod
    def _part_key(path: str) -> tuple[int, str]:
        base = os.path.basename(path)
        m = re.search(r"(\d+)", base)
        return (int(m.group(1)) if m else 0, base)

    def _label_index(self) -> dict[int, dict]:
        """Parse `exams.csv` once into exam_id -> {labels{col:bool}, age, is_male, patient_id}. Cached.

        The CSV is metadata only (one small row per exam), so holding it in a dict is memory-safe; it is
        what gives O(1) label lookup while the (huge) waveform array is streamed row-by-row.
        """
        if self._index is not None:
            return self._index
        path = os.path.join(self.root, self.EXAMS_CSV)
        index: dict[int, dict] = {}
        with open(path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for r in reader:
                exam_id = _to_int(r.get("exam_id"))
                if exam_id is None:
                    continue
                index[exam_id] = {
                    "labels": {c: _truthy(r.get(c)) for c in self.LABEL_COLUMNS},
                    "age": _to_int(r.get("age")),
                    "is_male": _truthy(r.get("is_male")),
                    "patient_id": _to_int(r.get("patient_id")),
                }
        if not index:
            raise DatasetUnavailable(f"{self.name}: {self.EXAMS_CSV} has no readable exam rows at {path!r}")
        self._index = index
        return index


def _truthy(value: object) -> bool:
    """Parse a CSV cell (CODE-15% stores 'True'/'False'; also accept 1/0, t/f, yes/no) as a bool."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("true", "1", "t", "yes", "y")


def _to_int(value: object) -> int | None:
    """Coerce a CSV cell to int (via float, since some columns are written '123.0'); None if not numeric."""
    try:
        return int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
