"""MIT-BIH Arrhythmia Database provider (WFDB records → AAMI beat labels).

The MIT-BIH Arrhythmia Database (PhysioNet `mitdb`) is 48 two-lead, 30-minute ambulatory ECG records
sampled at 360 Hz, each shipped as a WFDB triple `<rec>.hea/.dat/.atr`. The `.atr` reference annotations
mark every heartbeat with a beat symbol; the field-standard AAMI EC57 mapping (de Chazal et al., 2004)
collapses those symbols into five superclasses N / S / V / F / Q, which is this provider's label space.

NO data is bundled or downloaded — the operator obtains `mitdb` under its ODC-BY 1.0 (PhysioNet open)
terms and points KARDIOX_DATA_MIT_BIH (or KARDIOX_DATA_ROOT/mit-bih) at the folder. Records are streamed
one at a time (a single record's signal is loaded, its beats are emitted, then it is released), so beat
corpora never load fully into RAM. A record that fails to read is skipped, never fabricated.

Expected input:  a local root containing WFDB records (`100.hea`+`100.dat`+`100.atr`, ...), any depth.
Expected output: `iter_samples` yields `Sample`s. granularity="beat" (default) → one Sample per beat, a
                 fixed R-peak-centred window (`waveform` = (n_leads, pre+post) float32, labels=[AAMI]);
                 granularity="record" → one Sample per record (full signal, labels = AAMI classes present,
                 per-beat symbols/classes/R-peak samples in `meta`).
Failure modes:   root missing/no complete record → DatasetUnavailable (via `_require`); wfdb/numpy absent
                 → DatasetUnavailable (lazy import); a corrupt/unreadable record → skipped; an unknown
                 `split` → ValueError; a record with no beat annotations → skipped.
"""
from __future__ import annotations

import glob
import os
from collections import Counter
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


def _lazy_wfdb():
    """Import wfdb lazily; ImportError → DatasetUnavailable (keeps the training layer torch/wfdb-free)."""
    return lazy_import("wfdb", "MIT-BIH (WFDB .hea/.dat/.atr records)")


def _lazy_np():
    """Import numpy lazily; ImportError → DatasetUnavailable."""
    return lazy_import("numpy", "MIT-BIH waveform arrays")


class MITBIH(DatasetProvider):
    """MIT-BIH Arrhythmia Database → AAMI-class beat/record samples.

    Args:
      root: dataset root (defaults to KARDIOX_DATA_MIT_BIH / KARDIOX_DATA_ROOT/mit-bih).
      granularity: "beat" (default, one windowed Sample per annotated beat) or "record"
        (one Sample per record with per-beat labels in `meta`).
      pre_s / post_s: seconds kept before / after each beat's R peak for the beat window (default 0.25 /
        0.40 → ~0.65 s, capturing QRS + T at 360 Hz). Beats whose window would run off either edge of the
        record are skipped so every emitted beat window has an identical length.
      ann_ext: annotation extension to read (default "atr", the reference cardiologist annotations).
    """

    name = "mit-bih"
    homepage = "https://physionet.org/content/mitdb/1.0.0/"
    license = "ODC-BY 1.0 (PhysioNet open)"
    access = ACCESS_OPEN
    modalities = (WAVEFORM, LABELS)
    tasks = ("beat", "arrhythmia")
    fs = 360
    citation = (
        "Moody GB, Mark RG. The impact of the MIT-BIH Arrhythmia Database. IEEE Eng Med Biol Mag "
        "2001;20(3):45-50. PhysioNet doi:10.13026/C2F305."
    )
    redistribute = False

    # AAMI EC57 superclasses (fixed order = label-space index order).
    AAMI_CLASSES: list[str] = ["N", "S", "V", "F", "Q"]

    # WFDB beat symbol → AAMI class (de Chazal et al., 2004). Non-beat symbols (rhythm/quality/waveform
    # markers such as '+', '~', '|', '"', '=', '(' , ')') are absent here and therefore skipped.
    SYMBOL_TO_AAMI: dict[str, str] = {
        # N — normal, bundle-branch-block and (non-ectopic) escape beats
        "N": "N", "L": "N", "R": "N", "e": "N", "j": "N", "n": "N", "B": "N",
        # S — supraventricular ectopic beats
        "A": "S", "a": "S", "J": "S", "S": "S",
        # V — ventricular ectopic beats
        "V": "V", "E": "V", "r": "V",
        # F — fusion of ventricular and normal beat
        "F": "F",
        # Q — paced / fusion-of-paced / unclassifiable / unlabelled beats
        "/": "Q", "f": "Q", "Q": "Q", "?": "Q",
    }

    # de Chazal inter-patient paradigm (AAMI): the 44 non-paced records split into disjoint train/test
    # sets. Records 102, 104, 107, 217 (paced) belong to neither and stream only when split is None.
    _DS1: frozenset[str] = frozenset(
        {"101", "106", "108", "109", "112", "114", "115", "116", "118", "119", "122", "124",
         "201", "203", "205", "207", "208", "209", "215", "220", "223", "230"}
    )
    _DS2: frozenset[str] = frozenset(
        {"100", "103", "105", "111", "113", "117", "121", "123", "200", "202", "210", "212",
         "213", "214", "219", "221", "222", "228", "231", "232", "233", "234"}
    )

    def __init__(
        self,
        root: str | None = None,
        granularity: str = "beat",
        pre_s: float = 0.25,
        post_s: float = 0.40,
        ann_ext: str = "atr",
    ):
        super().__init__(root)
        if granularity not in ("beat", "record"):
            raise ValueError(f"granularity must be 'beat' or 'record', got {granularity!r}")
        if pre_s < 0 or post_s < 0 or (pre_s + post_s) <= 0:
            raise ValueError("pre_s/post_s must be >= 0 and sum to > 0")
        self.granularity = granularity
        self.pre_s = float(pre_s)
        self.post_s = float(post_s)
        self.ann_ext = ann_ext

    # ── discovery ───────────────────────────────────────────────────────────────────────────────
    def _discover(self) -> list[tuple[str, str]]:
        """Find complete WFDB records (need .hea + .dat + .<ann_ext>) under root, recursively.

        Returns a list of (record_id, record_path_without_extension) sorted by id and de-duplicated by id
        (first path wins). Empty when the root is unset/missing or holds no complete record.
        """
        if not self.root or not os.path.isdir(self.root):
            return []
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for hea in sorted(glob.glob(os.path.join(self.root, "**", "*.hea"), recursive=True)):
            base = hea[:-4]  # strip ".hea"
            rec_id = os.path.basename(base)
            if rec_id in seen:
                continue
            if os.path.exists(base + ".dat") and os.path.exists(base + "." + self.ann_ext):
                seen.add(rec_id)
                out.append((rec_id, base))
        return out

    def _split_ids(self, split: str | None) -> frozenset[str] | None:
        """Resolve a split name to the record-id set to keep (None = every discovered record)."""
        if split is None:
            return None
        s = split.strip().lower()
        if s in ("ds1", "train", "training"):
            return self._DS1
        if s in ("ds2", "test", "testing", "eval", "val"):
            return self._DS2
        raise ValueError(f"unknown split {split!r} for {self.name} (use 'DS1'/'train' or 'DS2'/'test')")

    def _record_split(self, rec_id: str) -> str | None:
        """The de Chazal DS the record belongs to ('DS1'/'DS2'), or None for the paced/excluded records."""
        if rec_id in self._DS1:
            return "DS1"
        if rec_id in self._DS2:
            return "DS2"
        return None

    # ── DatasetProvider contract ──────────────────────────────────────────────────────────────────
    def available(self) -> bool:
        """True when at least one complete WFDB record exists under root (no download, no fabrication)."""
        return bool(self._discover())

    def label_space(self) -> list[str]:
        """The five AAMI EC57 beat superclasses (static; independent of what is on disk)."""
        return list(self.AAMI_CLASSES)

    def splits(self) -> list[str]:
        """The de Chazal inter-patient folds (this dataset ships no train/val/test split of its own)."""
        return ["DS1", "DS2"]

    def iter_samples(
        self, split: str | None = None, limit: int | None = None
    ) -> Iterator[Sample]:
        """Stream beat- (or record-) level Samples, one record loaded at a time.

        Expected input:  optional `split` ('DS1'/'train' or 'DS2'/'test'; None = all records) and `limit`
                         (max Samples to yield).
        Expected output: `Sample`s per this provider's `granularity` (see class docstring).
        Failure modes:   DatasetUnavailable if the root/data or wfdb/numpy are missing, or if no discovered
                         record matches `split`; ValueError for an unknown `split`. Unreadable records and
                         beat-less records are skipped (never fabricated).
        """
        self._require()
        keep = self._split_ids(split)  # raises ValueError before any heavy import for a bad split
        wfdb = _lazy_wfdb()
        np = _lazy_np()

        records = [rp for rp in self._discover() if keep is None or rp[0] in keep]
        if not records:
            raise DatasetUnavailable(
                f"{self.name}: no complete WFDB record for split={split!r} under root={self.root!r}")

        emitted = 0
        for rec_id, rec_path in records:
            try:
                record = wfdb.rdrecord(rec_path)
                ann = wfdb.rdann(rec_path, self.ann_ext)
            except Exception:  # noqa: BLE001 — guard per-record: a bad file must not break the stream
                continue

            signal = getattr(record, "p_signal", None)
            if signal is None:
                continue
            sig_t = np.asarray(signal, dtype="float32").T  # (n_leads, n_samples)
            if sig_t.ndim != 2 or sig_t.shape[1] < 2:
                continue
            n_samples = int(sig_t.shape[1])
            fs = int(getattr(record, "fs", None) or self.fs or 360)
            leads = list(record.sig_name) if getattr(record, "sig_name", None) else None
            rec_split = self._record_split(rec_id)

            symbols = list(ann.symbol or [])
            centers = [int(s) for s in (ann.sample.tolist() if hasattr(ann.sample, "tolist") else ann.sample)]

            if self.granularity == "beat":
                pre = int(round(self.pre_s * fs))
                post = int(round(self.post_s * fs))
                for center, sym in zip(centers, symbols):
                    aami = self.SYMBOL_TO_AAMI.get(sym)
                    if aami is None:
                        continue
                    start, end = center - pre, center + post
                    if start < 0 or end > n_samples:  # drop edge beats → uniform window length
                        continue
                    yield Sample(
                        id=f"{rec_id}#{center}",
                        split=rec_split,
                        waveform=sig_t[:, start:end],
                        fs=fs,
                        leads=leads,
                        labels=[aami],
                        meta={"dataset": self.name, "record": rec_id, "symbol": sym, "aami": aami,
                              "r_sample": center, "window": [start, end]},
                    )
                    emitted += 1
                    if limit is not None and emitted >= limit:
                        return
            else:  # granularity == "record"
                beats = [(c, sym, self.SYMBOL_TO_AAMI[sym])
                         for c, sym in zip(centers, symbols) if sym in self.SYMBOL_TO_AAMI]
                if not beats:  # no reference beats → nothing to label; skip (never fabricate)
                    continue
                aami_present = sorted({b[2] for b in beats}, key=self.AAMI_CLASSES.index)
                yield Sample(
                    id=rec_id,
                    split=rec_split,
                    waveform=sig_t,
                    fs=fs,
                    leads=leads,
                    labels=aami_present,
                    meta={"dataset": self.name, "record": rec_id, "n_beats": len(beats),
                          "beat_samples": [b[0] for b in beats],
                          "beat_symbols": [b[1] for b in beats],
                          "beat_aami": [b[2] for b in beats],
                          "symbol_counts": dict(Counter(b[1] for b in beats)),
                          "aami_counts": dict(Counter(b[2] for b in beats))},
                )
                emitted += 1
                if limit is not None and emitted >= limit:
                    return
