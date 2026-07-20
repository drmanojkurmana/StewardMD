"""MEETI dataset provider (KardioX data layer).

MEETI (PKUDigitalHealth) is a MULTIMODAL derivative of MIMIC-IV-ECG. For each ECG it aligns four
modalities under one shared id:
  * the 12-lead WAVEFORM (the underlying MIMIC-IV-ECG signal, 500 Hz),
  * a plotted 12x1 IMAGE of that tracing,
  * a set of extracted numeric FEATURES (intervals / amplitudes / axes), and
  * an LLM-generated free-text interpretation (stored as the Sample REPORT).

Because MEETI is built ON TOP of MIMIC-IV-ECG signals, it INHERITS MIMIC-IV-ECG's access terms: it is
CREDENTIALED (PhysioNet credentialing + the MIMIC data-use agreement). KardioX therefore bundles and
downloads NOTHING and NEVER redistributes it. This module is an ADAPTER + DOCUMENTATION only: the
operator obtains MEETI themselves (from the Hugging Face dataset repo, under the inherited DUA), places
it at a local root, and points this provider at it (env `KARDIOX_DATA_MEETI`, or
`KARDIOX_DATA_ROOT/meeti`, or `root=`).

There is NO curated diagnostic taxonomy — the supervision signal is the free-text interpretation — so
`label_space()` is empty by design (interpretation-based). Downstream tasks derive their own labels from
`Sample.report`.

Everything STREAMS (generators, memory-safe): the manifest/index (csv / tsv / jsonl / json / parquet) is
read row-by-row (parquet in batches), and each ECG's waveform is loaded lazily (numpy .npy/.npz or wfdb)
ONLY when its Sample is yielded. The full corpus is never held in RAM.

Expected root layout (MEETI does not fix a single on-disk layout, so this provider PROBES for common
names and is tolerant of the operator's arrangement). A manifest is discovered, in this order, in the
root and in a `data/` or `metadata/` subdir:
  <root>/meeti.{jsonl,csv,parquet}        (also metadata.* / manifest.* / index.* / data.* / train.*)
  ... else the first *.jsonl / *.ndjson / *.parquet / *.csv / *.tsv found in those dirs (sorted).
Each manifest row maps one id -> a signal file, an image file, extracted features, and the
interpretation text, via tolerant column-name matching (see the *_KEYS class attributes). Referenced
files are resolved against the root and common subdirs (`signals/`, `images/`, `features/`, ...):
  <root>/signals/<id>.npy | .npz | WFDB <id>.hea+.dat      (waveform)
  <root>/images/<id>.png                                   (plotted 12x1 image)
  <root>/features/<id>.json                                (or inline JSON in the manifest cell)

Expected input:  a local MEETI root (or `root=`); iter_samples(split, limit) — MEETI ships no official
                 split, so pass split=None; if the manifest carries a split column, split filters on it.
Expected output: iter_samples -> Iterator[Sample] with id="meeti:<id>", waveform=(n_leads,n_samples) or
                 None, fs=500, leads, image_path=<plot>, report=<interpretation>, features=<dict>, and
                 the resolved refs in meta. label_space()=[].
Failure modes:   root/manifest missing -> DatasetUnavailable (via _require; never fabricates); numpy/wfdb
                 (waveform) or pyarrow (parquet manifest) not installed -> DatasetUnavailable; an
                 unreadable signal/feature file is logged and left None (the row still streams).
"""
from __future__ import annotations

import csv
import glob
import json
import logging
import os
import sys
from collections.abc import Iterator

from app.data.base import (ACCESS_CREDENTIALED, FEATURES, IMAGE, REPORT, WAVEFORM, DatasetProvider,
                           DatasetUnavailable, Sample, lazy_import)

logger = logging.getLogger(__name__)

# Canonical 12-lead order, used to name unlabeled numpy waveforms that carry exactly 12 leads.
STANDARD_LEADS: tuple[str, ...] = (
    "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6",
)


def _lazy_parquet():
    """Import pyarrow.parquet lazily; ImportError -> DatasetUnavailable (keeps the layer torch/arrow-free)."""
    try:
        import pyarrow.parquet as pq  # noqa: PLC0415 - intentionally lazy (heavy optional dep)
    except ImportError as e:
        raise DatasetUnavailable(
            "MEETI parquet manifest requires 'pyarrow' (pip install pyarrow)") from e
    return pq


class MEETI(DatasetProvider):
    """Streaming provider for MEETI — MIMIC-IV-ECG signals + plotted images + features + LLM text.

    Args:
      root: dataset root (defaults to KARDIOX_DATA_MEETI / KARDIOX_DATA_ROOT/meeti).
      manifest_path: explicit manifest file to read; if omitted, one is auto-discovered under root.
      include_waveform: load the signal lazily (numpy/wfdb) per row (default True). False => stream only
        image + interpretation + features (no signal I/O), useful for report-only / vision-only datasets.
    """

    name = "meeti"
    homepage = "https://huggingface.co/datasets/PKUDigitalHealth/MEETI"
    # Derived from MIMIC-IV-ECG signals, so it inherits MIMIC's credentialed access + data-use agreement.
    license = "derived from MIMIC-IV-ECG -> inherits PhysioNet Credentialed + DUA"
    access = ACCESS_CREDENTIALED
    modalities = (WAVEFORM, IMAGE, REPORT, FEATURES)
    tasks = ("report-generation", "ecg-interpretation", "multimodal-representation-learning")
    fs = 500
    citation = (
        "PKUDigitalHealth, MEETI: a multimodal ECG dataset (12-lead signals, plotted images, extracted "
        "features, and LLM interpretations) derived from MIMIC-IV-ECG. Hugging Face: "
        "https://huggingface.co/datasets/PKUDigitalHealth/MEETI. Cite the underlying MIMIC-IV-ECG "
        "(Gow et al., PhysioNet, https://doi.org/10.13026/4nqg-sb35)."
    )
    redistribute = False   # credentialed derivative — KardioX never redistributes it

    # ── tolerant column-name matching (all compared case-insensitively) ─────────────────────────────
    ID_KEYS: tuple[str, ...] = ("id", "ecg_id", "study_id", "sample_id", "record_id", "uid", "key")
    SIGNAL_KEYS: tuple[str, ...] = (
        "signal", "signal_path", "signal_file", "waveform", "waveform_path", "npy", "npy_path",
        "record", "record_path", "record_name", "ecg", "ecg_path", "wfdb", "wfdb_path",
    )
    IMAGE_KEYS: tuple[str, ...] = (
        "image", "image_path", "image_file", "img", "img_path", "plot", "plot_path",
        "figure", "figure_path", "png", "png_path",
    )
    REPORT_KEYS: tuple[str, ...] = (
        "interpretation", "llm_interpretation", "report", "text", "diagnosis", "caption",
        "answer", "response", "description", "label_text", "output",
    )
    FEATURE_KEYS: tuple[str, ...] = (
        "features", "feature", "ecg_features", "measurements", "attributes", "feature_json",
        "features_path", "feature_path",
    )
    SPLIT_KEYS: tuple[str, ...] = ("split", "fold", "partition", "subset")

    # ── subdirectories probed when resolving a referenced file (""=root) ────────────────────────────
    SIGNAL_SUBDIRS: tuple[str, ...] = ("", "signals", "signal", "waveforms", "records", "ecg", "npy")
    IMAGE_SUBDIRS: tuple[str, ...] = ("", "images", "image", "plots", "figures", "png", "img")
    FEATURE_SUBDIRS: tuple[str, ...] = ("", "features", "feature", "attributes")

    # ── manifest discovery (ordered): explicit names, then a glob fallback per directory ────────────
    _MANIFEST_DIRS: tuple[str, ...] = ("", "data", "metadata")
    _MANIFEST_NAMES: tuple[str, ...] = (
        "meeti.jsonl", "meeti.ndjson", "meeti.csv", "meeti.tsv", "meeti.parquet",
        "metadata.jsonl", "metadata.csv", "metadata.parquet",
        "manifest.jsonl", "manifest.csv", "manifest.parquet",
        "index.jsonl", "index.csv", "index.parquet", "meeti_index.jsonl",
        "data.jsonl", "data.csv", "data.parquet",
        "train.jsonl", "train.csv", "train.parquet",
    )
    _MANIFEST_GLOBS: tuple[str, ...] = ("*.jsonl", "*.ndjson", "*.parquet", "*.csv", "*.tsv")

    def __init__(self, root: str | None = None, *, manifest_path: str | None = None,
                 include_waveform: bool = True):
        super().__init__(root)
        self.manifest_path = manifest_path
        self.include_waveform = bool(include_waveform)

    # ── DatasetProvider contract ────────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True when a MEETI manifest is discoverable under `root` (no download, no fabrication)."""
        return bool(self.root) and self._find_manifest() is not None

    def label_space(self) -> list[str]:
        """Empty by design: MEETI is interpretation-based (free-text). Downstream tasks build their own
        label space from `Sample.report`."""
        return []

    def splits(self) -> list[str]:
        """["all"] — MEETI ships no official train/val/test split. Define reproducible subject-level
        splits downstream (to avoid MIMIC patient leakage), or filter on a manifest 'split' column."""
        return ["all"]

    def describe(self) -> dict:
        d = super().describe()
        manifest = self._find_manifest() if self.root else None
        d.update({
            "include_waveform": self.include_waveform,
            "manifest": manifest,
            "manifestFormat": self._manifest_format(manifest) if manifest else None,
            "labelSpaceNote": "empty by design — MEETI is interpretation-based (free-text)",
            "splitsNote": "no official split; pass split=None (or filter on a manifest 'split' column)",
        })
        return d

    def iter_samples(self, split: str | None = None, limit: int | None = None) -> Iterator[Sample]:
        """Stream multimodal Samples lazily (memory-safe), one manifest row at a time.

        Expected input:  optional `split` — None/"all" yields every row; any other value keeps only rows
                         whose manifest split column matches it (case-insensitive), since MEETI has no
                         fixed split set. Optional `limit` caps the number of Samples yielded.
        Expected output: an iterator of Sample(id="meeti:<id>", waveform=(n_leads,n_samples) float32 or
                         None, fs=500, leads, image_path=<plot>, labels=[], report=<interpretation>,
                         features=<dict or None>, meta={raw refs + resolved paths + split}).
        Failure modes:   raises DatasetUnavailable if the root/manifest is absent, if the manifest format
                         is unreadable, or (only when a modality is actually loaded) if numpy/wfdb
                         (waveform) or pyarrow (parquet manifest) are not installed. A per-row unreadable
                         signal/feature file is logged and left None; the row is still streamed.
        """
        self._require()
        manifest = self._find_manifest()
        if manifest is None:  # pragma: no cover - _require already guarantees availability
            raise DatasetUnavailable(f"{self.name}: no manifest found under root={self.root!r}")

        want = None if split is None else str(split).strip().lower()
        if want in ("", "all"):
            want = None

        count = 0
        seen = 0
        for raw in self._iter_manifest_rows(manifest):
            # Lower-case the keys once so tolerant matching is case-insensitive across formats.
            row = {str(k).lower(): v for k, v in raw.items()}
            row_split_raw = self._pick(row, self.SPLIT_KEYS)
            row_split = _clean_str(row_split_raw) or None
            if want is not None and (row_split or "").lower() != want:
                seen += 1
                continue

            if limit is not None and count >= limit:
                return

            sid = _clean_str(self._pick(row, self.ID_KEYS)) or f"row{seen}"
            sig_ref = _clean_str(self._pick(row, self.SIGNAL_KEYS)) or None
            img_ref = _clean_str(self._pick(row, self.IMAGE_KEYS)) or None
            report = _clean_str(self._pick(row, self.REPORT_KEYS)) or None
            features = self._resolve_features(self._pick(row, self.FEATURE_KEYS))

            waveform: object | None = None
            leads: list[str] | None = None
            fs = self.fs
            signal_path: str | None = None
            if self.include_waveform and sig_ref:
                signal_path = self._resolve_signal(sig_ref)
                if signal_path:
                    loaded = self._load_waveform(signal_path)
                    if loaded is not None:
                        waveform, leads, fs = loaded

            image_path = self._resolve_file(img_ref, self.IMAGE_SUBDIRS) if img_ref else None

            yield Sample(
                id=f"{self.name}:{sid}",
                split=row_split,
                waveform=waveform,
                fs=fs,
                leads=leads,
                image_path=image_path,
                labels=[],
                report=report,
                features=features,
                meta={
                    "meeti_id": sid,
                    "signal_ref": sig_ref,
                    "signal_path": signal_path,
                    "image_ref": img_ref,
                    "manifest": os.path.basename(manifest),
                    "row_index": seen,
                    "split": row_split,
                },
            )
            count += 1
            seen += 1

    # ── manifest discovery ──────────────────────────────────────────────────────────────────────────
    def _find_manifest(self) -> str | None:
        """Locate the manifest: an explicit `manifest_path`, else the first known name / glob match.

        Searches the root and its `data/` and `metadata/` subdirs, trying the fixed candidate names
        first and then a per-directory glob (jsonl/ndjson/parquet/csv/tsv). Returns a path or None.
        """
        if self.manifest_path:
            return self.manifest_path if os.path.isfile(self.manifest_path) else None
        if not self.root or not os.path.isdir(self.root):
            return None
        for d in self._MANIFEST_DIRS:
            base = os.path.join(self.root, d) if d else self.root
            if not os.path.isdir(base):
                continue
            for name in self._MANIFEST_NAMES:
                cand = os.path.join(base, name)
                if os.path.isfile(cand):
                    return cand
        for d in self._MANIFEST_DIRS:
            base = os.path.join(self.root, d) if d else self.root
            if not os.path.isdir(base):
                continue
            for pattern in self._MANIFEST_GLOBS:
                matches = sorted(glob.glob(os.path.join(base, pattern)))
                if matches:
                    return matches[0]
        return None

    @staticmethod
    def _manifest_format(path: str) -> str | None:
        """Map a manifest path to a format tag: 'jsonl' | 'json' | 'csv' | 'tsv' | 'parquet' | None."""
        ext = os.path.splitext(path)[1].lower()
        if ext in (".jsonl", ".ndjson"):
            return "jsonl"
        if ext == ".json":
            return "json"
        if ext == ".csv":
            return "csv"
        if ext == ".tsv":
            return "tsv"
        if ext == ".parquet":
            return "parquet"
        return None

    def _iter_manifest_rows(self, path: str) -> Iterator[dict]:
        """Stream manifest rows as dicts, one at a time, dispatching on the file format.

        jsonl/ndjson and csv/tsv stream line/row-by-line; parquet streams in record batches; a top-level
        json array (or {"data":[...]}) is read once (metadata only). Unknown/unreadable format ->
        DatasetUnavailable.
        """
        fmt = self._manifest_format(path)
        if fmt == "jsonl":
            yield from self._iter_jsonl(path)
        elif fmt == "json":
            yield from self._iter_json(path)
        elif fmt in ("csv", "tsv"):
            yield from self._iter_csv(path, delimiter="\t" if fmt == "tsv" else ",")
        elif fmt == "parquet":
            yield from self._iter_parquet(path)
        else:
            raise DatasetUnavailable(
                f"{self.name}: unsupported manifest format {os.path.basename(path)!r} "
                f"(expected .jsonl/.ndjson/.json/.csv/.tsv/.parquet)")

    def _iter_jsonl(self, path: str) -> Iterator[dict]:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for lineno, line in enumerate(fh):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("%s: skipping malformed manifest line %d in %s",
                                   self.name, lineno + 1, os.path.basename(path))
                    continue
                if isinstance(rec, dict):
                    yield rec

    def _iter_json(self, path: str) -> Iterator[dict]:
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                obj = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            raise DatasetUnavailable(
                f"{self.name}: cannot read JSON manifest {path!r}: {type(e).__name__}: {e}") from e
        rows = obj.get("data") if isinstance(obj, dict) else obj
        if not isinstance(rows, list):
            raise DatasetUnavailable(
                f"{self.name}: JSON manifest {os.path.basename(path)!r} is not a list of rows "
                f"(or a {{'data': [...]}} object)")
        for rec in rows:
            if isinstance(rec, dict):
                yield rec

    def _iter_csv(self, path: str, delimiter: str) -> Iterator[dict]:
        self._widen_csv_limit()
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            for row in csv.DictReader(fh, delimiter=delimiter):
                yield row

    def _iter_parquet(self, path: str) -> Iterator[dict]:
        pq = _lazy_parquet()
        pf = pq.ParquetFile(path)
        for batch in pf.iter_batches(batch_size=512):   # stream in batches — never load the whole table
            cols = batch.to_pydict()
            keys = list(cols)
            n = batch.num_rows
            for i in range(n):
                yield {k: cols[k][i] for k in keys}

    # ── modality resolution / loading ────────────────────────────────────────────────────────────────
    def _pick(self, row: dict, keys: tuple[str, ...]):
        """Return the first present, non-empty value among `keys` (row keys already lower-cased)."""
        for k in keys:
            if k in row and _nonempty(row[k]):
                return row[k]
        return None

    def _resolve_file(self, ref, subdirs: tuple[str, ...]) -> str | None:
        """Resolve a referenced regular file against root + `subdirs` (by basename). None if not found."""
        ref = _clean_str(ref)
        if not ref or not self.root:
            return None
        cands: list[str] = []
        if os.path.isabs(ref):
            cands.append(ref)
        cands.append(os.path.join(self.root, ref))
        base = os.path.basename(ref)
        for d in subdirs:
            cands.append(os.path.join(self.root, d, base) if d else os.path.join(self.root, base))
        for c in cands:
            if os.path.isfile(c):
                return c
        return None

    def _resolve_signal(self, ref) -> str | None:
        """Resolve a signal reference to an existing file OR a WFDB base (<base>.hea/.dat present).

        Returns the numpy file path (.npy/.npz), or the extensionless WFDB base when a .hea/.dat exists,
        or None when nothing matching is found (the waveform is then left None — never fabricated).
        """
        ref = _clean_str(ref)
        if not ref or not self.root:
            return None
        cands: list[str] = []
        if os.path.isabs(ref):
            cands.append(ref)
        cands.append(os.path.join(self.root, ref))
        base = os.path.basename(ref)
        for d in self.SIGNAL_SUBDIRS:
            cands.append(os.path.join(self.root, d, base) if d else os.path.join(self.root, base))
        for c in cands:
            if os.path.isfile(c):
                return c
            stem = os.path.splitext(c)[0]   # allow a WFDB base referenced with/without an extension
            if os.path.isfile(stem + ".hea") or os.path.isfile(stem + ".dat"):
                return stem
        return None

    def _load_waveform(self, path: str):
        """Load one waveform lazily; return (waveform (n_leads,n_samples) float32, leads, fs) or None.

        numpy (.npy/.npz) is oriented to leads-major and named with STANDARD_LEADS when it carries 12
        leads; WFDB (.hea/.dat/extensionless base) uses the header's sig_name/fs. Missing numpy/wfdb is a
        hard environment error (DatasetUnavailable); a per-file read failure is logged and returns None.
        """
        ext = os.path.splitext(path)[1].lower()
        try:
            if ext in (".npy", ".npz"):
                np = lazy_import("numpy", f"{self.name} numpy waveform loading")
                arr = self._read_numpy(np, path, ext)
                if arr is None:
                    return None
                return arr, self._lead_names(int(arr.shape[0])), self.fs
            if ext in (".hea", ".dat", ""):
                wfdb = lazy_import("wfdb", f"{self.name} WFDB waveform loading")
                np = lazy_import("numpy", f"{self.name} WFDB waveform loading")
                base = os.path.splitext(path)[0] if ext in (".hea", ".dat") else path
                record = wfdb.rdrecord(base)
                sig = np.asarray(record.p_signal, dtype="float32")
                if sig.ndim != 2 or sig.size == 0:
                    raise ValueError(f"empty/malformed p_signal (shape={getattr(sig, 'shape', None)})")
                waveform = sig.T   # (n_samples, n_leads) -> (n_leads, n_samples)
                leads = list(record.sig_name) if getattr(record, "sig_name", None) else \
                    self._lead_names(int(waveform.shape[0]))
                fs = int(record.fs) if getattr(record, "fs", None) else self.fs
                return waveform, leads, fs
            logger.warning("%s: unsupported signal file type %r; leaving waveform None", self.name, path)
            return None
        except DatasetUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - guard per-file so one bad signal never crashes the stream
            logger.warning("%s: failed to read signal %r: %s: %s",
                           self.name, path, type(e).__name__, e)
            return None

    @staticmethod
    def _read_numpy(np, path: str, ext: str):
        """Load and orient a numpy waveform to (n_leads, n_samples) float32; None if not 2-D usable."""
        if ext == ".npz":
            with np.load(path, allow_pickle=False) as z:
                keys = list(z.keys())
                chosen = next((k for k in ("signal", "waveform", "ecg", "x", "arr_0") if k in z),
                              keys[0] if keys else None)
                if chosen is None:
                    return None
                arr = np.asarray(z[chosen], dtype="float32")
        else:
            arr = np.asarray(np.load(path, allow_pickle=False), dtype="float32")
        if arr.ndim == 1:
            arr = arr[None, :]              # a single-lead vector -> one row
        if arr.ndim != 2 or arr.size == 0:
            return None
        if arr.shape[0] > arr.shape[1]:     # (n_samples, n_leads) -> (n_leads, n_samples)
            arr = arr.T
        return arr

    @staticmethod
    def _lead_names(n_leads: int) -> list[str]:
        """Lead names for an unlabeled array: STANDARD_LEADS when 12, else generic lead1..leadN."""
        if n_leads == len(STANDARD_LEADS):
            return list(STANDARD_LEADS)
        return [f"lead{i + 1}" for i in range(max(n_leads, 0))]

    def _resolve_features(self, val) -> dict | None:
        """Resolve extracted features to a dict: a struct/dict cell, inline JSON, or a .json file path.

        Returns None when nothing usable is present (never fabricated). A referenced .json file that
        cannot be read/parsed is treated as absent (logged) rather than raising.
        """
        if isinstance(val, dict):
            return {str(k): v for k, v in val.items()} or None
        s = _clean_str(val)
        if not s:
            return None
        if s[0] in "{[":
            try:
                obj = json.loads(s)
            except json.JSONDecodeError:
                obj = None
            if isinstance(obj, dict):
                return obj or None
        if s.lower().endswith(".json"):
            p = self._resolve_file(s, self.FEATURE_SUBDIRS)
            if p:
                try:
                    with open(p, encoding="utf-8") as fh:
                        obj = json.load(fh)
                except (OSError, json.JSONDecodeError) as e:
                    logger.warning("%s: cannot read features %r: %s", self.name, p, type(e).__name__)
                    return None
                if isinstance(obj, dict):
                    return obj or None
        return None

    @staticmethod
    def _widen_csv_limit() -> None:
        """Allow long free-text interpretation cells (the default csv field limit can be too small)."""
        try:
            csv.field_size_limit(sys.maxsize)
        except OverflowError:  # pragma: no cover - platform-dependent C long overflow
            csv.field_size_limit(2 ** 31 - 1)


def _nonempty(v) -> bool:
    """True when a manifest cell carries usable content (not None, not NaN, not blank/whitespace)."""
    if v is None:
        return False
    if isinstance(v, float) and v != v:   # NaN (parquet/csv null) is empty
        return False
    if isinstance(v, str) and not v.strip():
        return False
    return True


def _clean_str(v) -> str:
    """Stringify a manifest cell to a stripped str; empty string for None/NaN/blank (never 'None')."""
    if not _nonempty(v):
        return ""
    return str(v).strip()
