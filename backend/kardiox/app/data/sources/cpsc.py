"""CPSC 2018 — China Physiological Signal Challenge 2018 (12-lead classification).

Open challenge corpus of 6 877 clinical 12-lead ECGs (500 Hz) labelled with 1–3 of nine
rhythm/morphology classes. KardioX bundles NOTHING: the operator downloads CPSC 2018 per its open terms
and points KardioX at the extracted root via env `KARDIOX_DATA_CPSC` (or `KARDIOX_DATA_ROOT/cpsc`) or
`root=`. Samples are STREAMED one record at a time — the full corpus never loads into RAM.

Layout expected under `root` (as released; the recursive walk tolerates the TrainingSet1/2/3 split):
  REFERENCE.csv                     -- Recording,First_label,Second_label,Third_label  (codes 1..9)
  A0001.mat ... A6877.mat           -- one MATLAB v5 signal file per record

Each `.mat` holds the 12-lead signal either as key ``val`` (a leads×samples array, PhysioNet/CinC
re-release) or as the original ``ECG`` struct with fields ``data`` (leads×samples), ``sex``, ``age``.
Signal values are returned exactly as stored (raw ADC/amplitude units); apply the dataset's ADC gain
downstream if a specific unit is required — this provider never rescales or fabricates.
"""
from __future__ import annotations

import csv
import os
from collections.abc import Iterator

from app.data.base import (ACCESS_OPEN, LABELS, WAVEFORM, DatasetProvider, DatasetUnavailable, Sample)

# Standard 12-lead order used by CPSC 2018 (matches the .hea sig_name ordering of the release).
_LEADS: tuple[str, ...] = ("I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6")

# The nine challenge classes, indexed by their 1-based REFERENCE.csv code.
_CLASSES: list[str] = ["Normal", "AF", "I-AVB", "LBBB", "RBBB", "PAC", "PVC", "STD", "STE"]
_CODE_TO_NAME: dict[int, str] = {i + 1: name for i, name in enumerate(_CLASSES)}

_REFERENCE = "REFERENCE.csv"


def _lazy_loadmat():
    """Import scipy.io.loadmat lazily. Failure mode: scipy absent -> DatasetUnavailable."""
    try:
        from scipy.io import loadmat
    except ImportError as e:  # pragma: no cover - only when scipy is not installed
        raise DatasetUnavailable(
            "cpsc: reading .mat records requires 'scipy' (pip install scipy)") from e
    return loadmat


def _to_int(value: object) -> int | None:
    """Parse a REFERENCE.csv label cell to an int code, or None for blank/NaN/garbage."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in ("nan", "na", "none"):
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _as_text(v: object) -> str:
    """Coerce a scipy struct scalar (0-d/1-elem char array) to a stripped str."""
    try:
        return str(v.item()).strip()  # type: ignore[attr-defined]
    except Exception:
        try:
            return str(v.reshape(-1)[0]).strip()  # type: ignore[attr-defined]
        except Exception:
            return str(v).strip()


def _as_number(v: object) -> float | None:
    """Coerce a scipy struct scalar to float, or None when it is not numeric."""
    try:
        return float(v.item())  # type: ignore[attr-defined]
    except Exception:
        try:
            return float(v.reshape(-1)[0])  # type: ignore[attr-defined]
        except Exception:
            return None


def _extract_ecg_struct(ecg: object, meta: dict) -> object:
    """Pull the leads×samples array out of the original ``ECG`` MATLAB struct.

    Records sex/age into `meta` when present. Returns `ecg` unchanged if it is not the expected struct
    (then the caller validates its shape).
    """
    names = getattr(getattr(ecg, "dtype", None), "names", None) or ()
    if "data" not in names:
        return ecg
    if "sex" in names:
        meta["sex"] = _as_text(ecg["sex"][0, 0])  # type: ignore[index]
    if "age" in names:
        age = _as_number(ecg["age"][0, 0])  # type: ignore[index]
        if age is not None:
            meta["age"] = age
    return ecg["data"][0, 0]  # type: ignore[index]


def _first_2d_array(mat: dict) -> object | None:
    """Fallback for non-standard keys: first non-metadata 2-D value in the loaded .mat dict."""
    for key, value in mat.items():
        if key.startswith("__"):
            continue
        shape = getattr(value, "shape", None)
        if shape and len(shape) == 2 and min(shape) >= 1:
            return value
    return None


class CPSC2018(DatasetProvider):
    """China Physiological Signal Challenge 2018 — 12-lead, 9-class classification (waveform + labels).

    Expected input:  a local `root` holding REFERENCE.csv and the A####.mat signal files (operator
                     supplied; nothing is downloaded).
    Expected output: `iter_samples` streams `Sample`s with `waveform` (12×N raw), `fs`=500, `leads`,
                     `labels` (1–3 of the nine class names), `meta` (record id, sex, age when present).
    Failure modes:   root/REFERENCE.csv missing -> DatasetUnavailable; scipy absent -> DatasetUnavailable;
                     an individual unreadable/corrupt or missing .mat is skipped (never fabricated).
    """

    name = "cpsc"
    homepage = "http://2018.icbeb.org/Challenge.html"
    license = "CC-BY-4.0 (challenge open data)"
    access = ACCESS_OPEN
    modalities = (WAVEFORM, LABELS)
    tasks = ("classification",)
    fs = 500
    citation = ("Liu F, Liu C, Zhao L, et al. An Open Access Database for Evaluating the Algorithms of "
                "ECG Rhythm and Morphology Abnormality Detection. J Med Imaging Health Inform. "
                "2018;8(7):1368-1373.")

    # ── contract ────────────────────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True when `root` exists and a REFERENCE.csv is present (no download, no fabrication)."""
        return bool(self.root) and os.path.isdir(self.root) and self._find_reference() is not None

    def label_space(self) -> list[str]:
        """The nine CPSC 2018 classes in canonical (code 1..9) order. Static; needs no data."""
        return list(_CLASSES)

    def splits(self) -> list[str]:
        """CPSC 2018 ships no official train/val/test split — one pool tagged 'train'."""
        return ["train"]

    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream labelled 12-lead records lazily from REFERENCE.csv + per-record .mat files.

        Expected input:  optional `split` (only 'train' yields; others yield nothing) and `limit`.
        Expected output: iterator of `Sample`; one .mat is decoded per step (memory-safe).
        Failure modes:   data/scipy absent -> DatasetUnavailable before any yield; a row whose .mat is
                         missing or unreadable is skipped so a partial download still streams.
        """
        self._require()
        if split is not None and split not in self.splits():
            return
        ref = self._find_reference()
        if not ref:  # pragma: no cover - guarded by _require/available above
            raise DatasetUnavailable(f"cpsc: {_REFERENCE} not found under root={self.root!r}")

        loadmat = _lazy_loadmat()
        index = self._index_records()
        emitted = 0
        with open(ref, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                if limit is not None and emitted >= limit:
                    break
                low = {(k or "").strip().lower(): v for k, v in row.items()}
                rec = str(low.get("recording") or "").strip()
                if not rec:
                    continue
                path = index.get(rec.upper())
                if not path or not os.path.isfile(path):
                    continue  # missing record file (partial download) -> skip, never fabricate
                meta: dict = {"record": rec, "source": self.name}
                try:
                    waveform = self._read_signal(loadmat, path, meta)
                except (ValueError, OSError, KeyError, IndexError, TypeError):
                    continue  # corrupt/unreadable record -> skip, never fabricate
                n_leads = int(waveform.shape[0])
                leads = (list(_LEADS[:n_leads]) if n_leads <= len(_LEADS)
                         else [f"lead{i + 1}" for i in range(n_leads)])
                yield Sample(id=f"{self.name}:{rec}", split="train", waveform=waveform, fs=self.fs,
                             leads=leads, labels=self._row_labels(low), meta=meta)
                emitted += 1

    # ── internals ───────────────────────────────────────────────────────────────────────────────
    def _find_reference(self) -> str | None:
        """Locate REFERENCE.csv at the root or (case-insensitively) anywhere beneath it."""
        if not self.root:
            return None
        direct = os.path.join(self.root, _REFERENCE)
        if os.path.isfile(direct):
            return direct
        for dirpath, _dirs, files in os.walk(self.root):
            for fn in files:
                if fn.lower() == _REFERENCE.lower():
                    return os.path.join(dirpath, fn)
        return None

    def _index_records(self) -> dict[str, str]:
        """One-time recursive scan mapping RECORD-stem (upper) -> .mat path. Caches filenames only
        (not signals), so streaming stays memory-safe even for the whole corpus."""
        cached = getattr(self, "_mat_index", None)
        if cached is not None:
            return cached
        index: dict[str, str] = {}
        for dirpath, _dirs, files in os.walk(self.root or ""):
            for fn in files:
                if fn.lower().endswith(".mat"):
                    stem = os.path.splitext(fn)[0].upper()
                    index.setdefault(stem, os.path.join(dirpath, fn))
        self._mat_index = index
        return index

    def _read_signal(self, loadmat, path: str, meta: dict):
        """Decode one .mat to a leads×samples array (via key 'val' or the 'ECG' struct).

        Failure modes: no recognisable signal / non-2-D content -> ValueError (caller skips the record).
        """
        mat = loadmat(path)
        if "val" in mat:
            arr = mat["val"]
        elif "ECG" in mat:
            arr = _extract_ecg_struct(mat["ECG"], meta)
        else:
            arr = _first_2d_array(mat)
        shape = getattr(arr, "shape", None)
        if arr is None or not shape or len(shape) != 2:
            raise ValueError(f"cpsc: no 2-D ECG signal in {path!r} (shape={shape!r})")
        rows, cols = int(shape[0]), int(shape[1])
        if rows != len(_LEADS) and cols == len(_LEADS):
            arr = arr.T  # stored samples×leads -> leads×samples
        return arr

    def _row_labels(self, low: dict) -> list[str]:
        """Map a REFERENCE.csv row's 1–3 label codes to class names (ordered, de-duplicated)."""
        out: list[str] = []
        for col in ("first_label", "second_label", "third_label"):
            name = _CODE_TO_NAME.get(_to_int(low.get(col)) or -1)
            if name and name not in out:
                out.append(name)
        return out
