"""Multi-format ECG loader (ADOPTED from ExChanGeAI, MIT).

A single entry point — `load_ecg` — reads one ECG file in any of the common exchange formats and returns
the same canonical `app.data.base.Sample` every KardioX provider yields: a 12-lead waveform in mV, on a
uniform sampling grid, with the STANDARD_12 lead order attached. This lets ad-hoc files (an operator
export, a validation record, a single upload) flow through the exact training / benchmark / validation
path as a bundled dataset — without changing anything downstream.

Formats (detected by extension via `sniff_format`):
  .npy / .npz  NumPy arrays (npz may also carry `fs` and `leads`)                        (numpy, lazy)
  .csv/.txt/.tsv  delimited text, samples x leads (or leads x samples)                   (numpy, lazy)
  .mat         MATLAB v5/v7 (PhysioNet `val`, or the largest numeric array / struct)     (scipy.io, lazy)
  .hea         WFDB record (reads the paired .dat)                                        (wfdb, lazy)
  .dcm/.dicom  DICOM 12-lead ECG WaveformSequence                                         (pydicom, lazy)
  .xml         GE MUSE (base64 int16 leads) or HL7 aECG (`<digits>`) — best effort        (stdlib)

NOTHING is bundled or downloaded and NO signal is fabricated: a file that cannot be decoded raises
`app.data.base.DatasetUnavailable` (or `ValueError` for a caller mistake) with a clear message.

Normalization applied to every input, deterministically:
  1. resample each channel to `target_fs` — FFT resample via scipy when present, else linear (numpy);
     only when the source sampling rate is known (WFDB / DICOM / aECG / an npz `fs`). Formats that carry
     no rate (bare .npy / .csv / .mat) are assumed to already be at `target_fs`.
  2. center-crop / center-pad every channel to exactly `target_fs * seconds` samples.
  3. place channels into the 12 STANDARD_12 slots by (normalized) lead name; unresolved / absent limb
     leads are reconstructed exactly from I and II via Einthoven/Goldberger (III, aVR, aVL, aVF) when
     those inputs exist, otherwise the slot is zero. When no lead names are known at all, channels fill
     the first slots positionally. Extra / unknown channels are dropped. Output is always (12, N).

Heavy dependencies (numpy, scipy, wfdb, pydicom) are imported INSIDE the functions that need them, so
this module stays importable in the pure training layer.
"""
from __future__ import annotations

import os
import re

from app.data.base import DatasetUnavailable, Sample

# Canonical 12-lead order (kept local so this module does not import the heavy app.services.models layer).
STANDARD_12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

# File extension -> canonical format token.
_EXT_FORMAT: dict[str, str] = {
    ".npy": "npy", ".npz": "npz",
    ".csv": "csv", ".txt": "csv", ".tsv": "csv",
    ".mat": "mat",
    ".hea": "wfdb",
    ".dcm": "dicom", ".dicom": "dicom",
    ".xml": "xml",
}
SUPPORTED_FORMATS: tuple[str, ...] = ("npy", "npz", "csv", "mat", "wfdb", "dicom", "xml")

# Lead-name aliases (keys are upper-cased + stripped of non-alphanumerics) -> canonical STANDARD_12 name.
_LEAD_ALIASES: dict[str, str] = {
    "I": "I", "DI": "I", "L1": "I", "1": "I",
    "II": "II", "DII": "II", "L2": "II", "2": "II",
    "III": "III", "DIII": "III", "L3": "III", "3": "III",
    "AVR": "aVR", "AVL": "aVL", "AVF": "aVF",
    "V1": "V1", "V2": "V2", "V3": "V3", "V4": "V4", "V5": "V5", "V6": "V6",
    "C1": "V1", "C2": "V2", "C3": "V3", "C4": "V4", "C5": "V5", "C6": "V6",
}


# ── numpy accessor (lazy) ────────────────────────────────────────────────────────────────────────
def _np():
    """Import numpy lazily; ImportError -> DatasetUnavailable (keeps the training layer numpy-free)."""
    try:
        import numpy as np
        return np
    except ImportError as exc:  # pragma: no cover - only when numpy is absent
        raise DatasetUnavailable("ECG loading requires numpy (pip install numpy)") from exc


# ── public API ─────────────────────────────────────────────────────────────────────────────────
def sniff_format(path: str) -> str:
    """Classify an ECG file by its extension.

    Expected input:  a filesystem path (str or path-like).
    Expected output: one of SUPPORTED_FORMATS ("npy"/"npz"/"csv"/"mat"/"wfdb"/"dicom"/"xml").
    Failure modes:   an unrecognized / missing extension -> ValueError listing the supported extensions.
    """
    ext = os.path.splitext(str(path))[1].lower()
    fmt = _EXT_FORMAT.get(ext)
    if fmt is None:
        raise ValueError(
            f"unrecognized ECG file extension {ext!r} for {str(path)!r}; "
            f"supported: {sorted(_EXT_FORMAT)}")
    return fmt


def load_ecg(
    path: str,
    target_fs: int = 500,
    seconds: float = 10.0,
    leads: list[str] | None = None,
) -> Sample:
    """Load one ECG file (any supported format) into a canonical 12-lead `Sample`.

    Expected input:  `path` to a single ECG file; `target_fs` (>0) and `seconds` (>0) define the output
                     grid (N = round(target_fs * seconds) samples per lead); optional `leads` gives the
                     lead order of the INPUT channels for formats that carry no lead names (npy/csv/mat) —
                     ignored when the file names its own leads.
    Expected output: a `Sample` with waveform = numpy float32 array (12, N) in mV, fs=target_fs,
                     leads=STANDARD_12, labels=[] (this loader assigns no labels), and provenance in
                     `meta` (format, source path, source_fs, source_leads, derived_leads).
    Failure modes:   unrecognized extension or bad `target_fs`/`seconds` -> ValueError; file missing,
                     required dependency absent, or nothing decodable -> DatasetUnavailable. A signal is
                     NEVER fabricated.
    """
    p = str(path)
    if not p.strip():
        raise ValueError("load_ecg: empty path")
    fmt = sniff_format(p)  # ValueError on unknown extension

    try:
        target_fs = int(target_fs)
        seconds = float(seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"load_ecg: target_fs/seconds must be numeric, got {target_fs!r}/{seconds!r}") from exc
    if target_fs <= 0 or seconds <= 0:
        raise ValueError(f"load_ecg: target_fs and seconds must be > 0 (got {target_fs}, {seconds})")
    target_n = int(round(target_fs * seconds))
    if target_n < 1:
        raise ValueError(f"load_ecg: target_fs * seconds rounds to {target_n} samples (< 1)")

    _check_exists(fmt, p)

    if fmt in ("npy", "npz"):
        raw, src_fs, src_leads = _load_numpy(p, fmt)
    elif fmt == "csv":
        raw, src_fs, src_leads = _load_csv(p)
    elif fmt == "mat":
        raw, src_fs, src_leads = _load_mat(p)
    elif fmt == "wfdb":
        raw, src_fs, src_leads = _load_wfdb(p)
    elif fmt == "dicom":
        raw, src_fs, src_leads = _load_dicom(p)
    else:  # xml
        raw, src_fs, src_leads = _load_xml(p)

    np = _np()
    raw = np.asarray(raw, dtype=np.float32)
    if raw.ndim != 2 or raw.shape[0] < 1 or raw.shape[1] < 1:
        raise DatasetUnavailable(f"{fmt}: decoded an empty/invalid signal from {p!r} (shape={raw.shape})")

    if not src_leads and leads:
        src_leads = [str(x) for x in leads]

    matrix, derived = _standardize(raw, src_fs, src_leads, target_fs, target_n)

    rec_id = os.path.splitext(os.path.basename(p))[0] or fmt
    return Sample(
        id=f"file:{rec_id}",
        split=None,
        waveform=matrix,
        fs=int(target_fs),
        leads=list(STANDARD_12),
        image_path=None,
        labels=[],
        report=None,
        features=None,
        meta={
            "format": fmt,
            "source": p,
            "source_fs": int(src_fs) if src_fs else None,
            "source_leads": list(src_leads) if src_leads else None,
            "source_shape": [int(raw.shape[0]), int(raw.shape[1])],
            "target_fs": int(target_fs),
            "seconds": float(seconds),
            "n_samples": int(matrix.shape[1]),
            "derived_leads": derived,
        },
    )


# ── existence checks ─────────────────────────────────────────────────────────────────────────────
def _check_exists(fmt: str, path: str) -> None:
    """Verify the file (and, for WFDB, its paired .dat) is present before importing anything heavy."""
    if fmt == "wfdb":
        if not os.path.isfile(path):
            raise DatasetUnavailable(f"wfdb: header not found: {path!r}")
        base = path[:-4]  # strip ".hea"
        if not os.path.isfile(base + ".dat"):
            raise DatasetUnavailable(f"wfdb: paired signal file not found: {base + '.dat'!r}")
        return
    if not os.path.isfile(path):
        raise DatasetUnavailable(f"{fmt}: file not found: {path!r}")


# ── per-format loaders — each returns (raw (n_leads, n_samples) float in mV, src_fs|None, leads|None) ──
def _load_numpy(path: str, fmt: str):
    """Load a .npy array or a .npz archive (its `fs`/`leads` sidecar arrays are honored when present)."""
    np = _np()
    fs = None
    leads = None
    if fmt == "npz":
        with np.load(path, allow_pickle=False) as archive:
            arr = _pick_npz_array(archive)
            if arr is None:
                raise DatasetUnavailable(f"npz: no numeric array in {path!r} (keys={list(archive.files)})")
            arr = np.asarray(arr)
            for key in ("fs", "sampling_rate", "sample_rate", "sampfreq", "sfreq"):
                if key in archive.files:
                    fs = _scalar_int(archive[key])
                    if fs:
                        break
            for key in ("leads", "lead_names", "sig_name", "channels", "lead"):
                if key in archive.files:
                    leads = _str_list(archive[key])
                    if leads:
                        break
    else:
        try:
            arr = np.load(path, allow_pickle=False)
        except ValueError as exc:  # pickled object arrays are refused (allow_pickle=False) — do not execute
            raise DatasetUnavailable(f"npy: {path!r} is not a plain numeric array ({exc})") from exc
    return _orient(arr), fs, leads


def _pick_npz_array(archive):
    """Choose the waveform array in an npz: a known key first, else the largest numeric >=1-D array."""
    np = _np()
    for key in ("signal", "ecg", "ekg", "waveform", "tracings", "val", "x", "data", "arr_0"):
        if key in archive.files and _is_numeric(archive[key]):
            return archive[key]
    best = None
    for key in archive.files:
        v = archive[key]
        if _is_numeric(v) and getattr(v, "ndim", 0) >= 1 and v.size > 1:
            if best is None or v.size > best.size:
                best = np.asarray(v)
    return best


def _load_csv(path: str):
    """Load delimited text (comma/semicolon/tab/whitespace auto-sniffed); a non-numeric header is dropped."""
    np = _np()
    delimiter = _sniff_delimiter(path)
    arr = np.atleast_2d(np.genfromtxt(path, delimiter=delimiter, dtype="float32", comments="#"))
    arr = arr[~np.all(np.isnan(arr), axis=1)]                    # drop all-NaN rows (header line)
    if arr.size == 0:
        raise DatasetUnavailable(f"csv: no numeric data parsed from {path!r}")
    arr = arr[:, ~np.all(np.isnan(arr), axis=0)]                 # drop all-NaN columns (index/label column)
    if arr.size == 0:
        raise DatasetUnavailable(f"csv: no numeric columns parsed from {path!r}")
    arr = np.nan_to_num(arr, nan=0.0)                            # zero stray un-parseable cells
    return _orient(arr), None, None


def _load_mat(path: str):
    """Load a MATLAB v5/v7 file; use PhysioNet `val` if present else the largest numeric array/struct field."""
    try:
        from scipy.io import loadmat
    except ImportError as exc:
        raise DatasetUnavailable("mat: reading .mat requires scipy (pip install scipy)") from exc
    np = _np()
    try:
        mat = loadmat(path)
    except Exception as exc:  # noqa: BLE001 - scipy raises many types (v7.3/HDF5, corrupt, etc.)
        raise DatasetUnavailable(f"mat: cannot read {path!r} ({type(exc).__name__}: {exc})") from exc

    fs = None
    for key in ("fs", "Fs", "FS", "sampling_rate", "SamplingRate", "sampfreq", "freq"):
        if key in mat:
            fs = _scalar_int(mat[key])
            if fs:
                break
    leads = None
    for key in ("leads", "lead_names", "sig_name", "labels", "lead"):
        if key in mat:
            leads = _str_list(mat[key])
            if leads:
                break

    best = None
    for key, value in mat.items():
        if key.startswith("__"):
            continue
        if key == "val" and _as_numeric_2d(value) is not None:   # PhysioNet convention wins outright
            best = _as_numeric_2d(value)
            break
        cand = _as_numeric_2d(value)
        if cand is not None and (best is None or cand.size > best.size):
            best = cand
    if best is None:
        raise DatasetUnavailable(f"mat: no numeric signal array in {path!r} (keys={_nonpriv_keys(mat)})")
    return _orient(best), fs, leads


def _load_wfdb(path: str):
    """Load a WFDB record (physical mV) via wfdb.rdrecord; leads/fs come from the header."""
    try:
        import wfdb
    except ImportError as exc:
        raise DatasetUnavailable("wfdb: reading .hea/.dat requires wfdb (pip install wfdb)") from exc
    np = _np()
    base = path[:-4] if path.endswith(".hea") else path
    try:
        record = wfdb.rdrecord(base)
    except Exception as exc:  # noqa: BLE001 - wfdb raises assorted errors on malformed records
        raise DatasetUnavailable(f"wfdb: cannot read record {base!r} ({type(exc).__name__}: {exc})") from exc
    signal = getattr(record, "p_signal", None)
    if signal is None:
        signal = getattr(record, "d_signal", None)               # digital fallback (uncalibrated)
    if signal is None:
        raise DatasetUnavailable(f"wfdb: record {base!r} has no signal samples")
    arr = np.asarray(signal, dtype=np.float32).T                 # (n_samples, n_leads) -> (n_leads, n_samples)
    fs = int(record.fs) if getattr(record, "fs", None) else None
    leads = list(record.sig_name) if getattr(record, "sig_name", None) else None
    return arr, fs, leads


def _load_dicom(path: str):
    """Load a DICOM 12-lead ECG WaveformSequence (channel physical units scaled to mV)."""
    try:
        import pydicom
    except ImportError as exc:
        raise DatasetUnavailable("dicom: reading .dcm requires pydicom (pip install pydicom)") from exc
    np = _np()
    try:
        ds = pydicom.dcmread(path)
    except Exception as exc:  # noqa: BLE001 - pydicom raises assorted errors on non-DICOM/corrupt input
        raise DatasetUnavailable(f"dicom: cannot read {path!r} ({type(exc).__name__}: {exc})") from exc
    seq = getattr(ds, "WaveformSequence", None)
    if not seq:
        raise DatasetUnavailable(f"dicom: {path!r} has no WaveformSequence (not an ECG waveform object)")
    try:
        wave = ds.waveform_array(0)                              # (n_samples, n_channels), physical units
    except (AttributeError, NotImplementedError) as exc:
        raise DatasetUnavailable(
            f"dicom: waveform decoding unavailable ({type(exc).__name__}); pydicom>=1.4 required") from exc
    except Exception as exc:  # noqa: BLE001
        raise DatasetUnavailable(f"dicom: cannot decode waveform in {path!r} ({type(exc).__name__})") from exc
    arr = np.asarray(wave, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr[:, None]
    arr = arr.T                                                  # (n_channels, n_samples)
    group = seq[0]
    fs = _scalar_int(getattr(group, "SamplingFrequency", None))
    leads, factors = _dicom_channels(group, arr.shape[0])
    for i, factor in enumerate(factors):
        if factor != 1.0 and i < arr.shape[0]:
            arr[i] = arr[i] * factor                             # per-channel unit -> mV
    return arr, fs, leads


def _load_xml(path: str):
    """Best-effort XML: GE MUSE (base64 int16 leads) first, then HL7 aECG (`<digits>`)."""
    import xml.etree.ElementTree as ET
    np = _np()
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise DatasetUnavailable(f"xml: cannot parse {path!r} ({exc})") from exc

    leads, fs = _parse_muse(root)
    if not leads:
        leads, fs = _parse_hl7_aecg(root)
    if not leads:
        raise DatasetUnavailable(
            f"xml: no recognizable ECG lead data in {path!r} (supported: GE MUSE, HL7 aECG)")

    names = list(leads.keys())
    length = min(int(leads[n].size) for n in names)
    if length < 1:
        raise DatasetUnavailable(f"xml: decoded lead(s) are empty in {path!r}")
    arr = np.stack([np.asarray(leads[n][:length], dtype=np.float32) for n in names], axis=0)
    return arr, fs, names


# ── XML parsers ────────────────────────────────────────────────────────────────────────────────
def _local(tag: str) -> str:
    """Strip an XML namespace ('{ns}Tag' -> 'Tag')."""
    return tag.rsplit("}", 1)[-1]


def _iter_local(element, name: str):
    """Yield every element (self + descendants) whose local tag name equals `name`."""
    for el in element.iter():
        if _local(el.tag) == name:
            yield el


def _find_local(element, name: str):
    """First element (self + descendants) whose local tag name equals `name`, else None."""
    for el in element.iter():
        if _local(el.tag) == name:
            return el
    return None


def _parse_muse(root):
    """GE MUSE: <LeadData> blocks of base64 int16 samples; amplitude scaled to mV. Returns ({name:arr}, fs)."""
    np = _np()
    import base64
    leads: dict = {}
    fs = None
    sb = _find_local(root, "SampleBase")
    if sb is not None and (sb.text or "").strip():
        try:
            fs = int(round(float(sb.text.strip())))
        except ValueError:
            fs = None
    for block in _iter_local(root, "LeadData"):
        id_el = _find_local(block, "LeadID")
        data_el = _find_local(block, "WaveFormData")
        if id_el is None or data_el is None or not (data_el.text or "").strip():
            continue
        name = _canon_lead(id_el.text)
        if not name or name in leads:
            continue
        try:
            raw = np.frombuffer(base64.b64decode(data_el.text.strip()), dtype="<i2").astype(np.float32)
        except (ValueError, TypeError):
            continue
        if raw.size < 1:
            continue
        upb_el = _find_local(block, "LeadAmplitudeUnitsPerBit")
        unit_el = _find_local(block, "LeadAmplitudeUnits")
        scale = _to_float((upb_el.text if upb_el is not None else None), default=1.0)
        unit = (unit_el.text or "").strip().upper() if unit_el is not None else ""
        mv = raw * scale
        if "MILLI" in unit:                                     # already mV per bit
            pass
        else:                                                    # MUSE default is microvolts per bit
            mv = mv / 1000.0
        leads[name] = mv
    return leads, fs


def _parse_hl7_aecg(root):
    """HL7 annotated-ECG: <sequence> blocks with a <code> lead id and <digits>; scaled to mV. Returns ({},fs)."""
    np = _np()
    leads: dict = {}
    fs = None
    for seq in _iter_local(root, "sequence"):
        code_el = _find_local(seq, "code")
        code = (code_el.get("code") if code_el is not None else None) or ""
        if "TIME" in code.upper():                               # time axis -> sampling rate from increment
            inc = _find_local(seq, "increment")
            if inc is not None and inc.get("value"):
                dt = _to_float(inc.get("value"), default=0.0)
                unit = (inc.get("unit") or "s").strip().lower()
                if unit in ("ms", "msec", "millisecond"):
                    dt = dt / 1000.0
                if dt > 0:
                    fs = int(round(1.0 / dt))
            continue
        digits_el = _find_local(seq, "digits")
        if digits_el is None or not (digits_el.text or "").strip():
            continue
        name = _canon_lead(code.replace("MDC_ECG_LEAD_", ""))
        if not name or name in leads:
            continue
        try:
            raw = np.asarray([float(tok) for tok in digits_el.text.split()], dtype=np.float32)
        except ValueError:
            continue
        if raw.size < 1:
            continue
        scale_el = _find_local(seq, "scale")
        origin_el = _find_local(seq, "origin")
        scale = _to_float(scale_el.get("value") if scale_el is not None else None, default=1.0)
        origin = _to_float(origin_el.get("value") if origin_el is not None else None, default=0.0)
        unit = ((scale_el.get("unit") if scale_el is not None else "") or "").strip().lower()
        vals = origin + raw * scale
        if unit in ("uv", "microvolt", "µv"):
            vals = vals / 1000.0
        elif unit in ("v", "volt"):
            vals = vals * 1000.0
        leads[name] = vals
    return leads, fs


def _dicom_channels(group, n_channels: int):
    """Return (lead_names|None, per-channel mV scale factors) from a DICOM multiplex group's channels."""
    defs = getattr(group, "ChannelDefinitionSequence", None) or []
    names: list[str] = []
    factors: list[float] = []
    for ch in defs:
        label = None
        src = getattr(ch, "ChannelSourceSequence", None) or []
        if src:
            label = getattr(src[0], "CodeMeaning", None) or getattr(src[0], "CodeValue", None)
        names.append(str(label) if label else "")
        factors.append(_dicom_channel_mv_factor(ch))
    if len(factors) < n_channels:
        factors += [1.0] * (n_channels - len(factors))
    cleaned = [n for n in names if n]
    return (names if cleaned else None), factors


def _dicom_channel_mv_factor(channel) -> float:
    """Factor converting a channel's physical unit to mV (uV -> 1/1000, V -> 1000, else 1)."""
    units = getattr(channel, "ChannelSensitivityUnitsSequence", None) or []
    if not units:
        return 1.0
    code = (getattr(units[0], "CodeValue", None) or getattr(units[0], "CodeMeaning", None) or "")
    code = str(code).strip().lower()
    if code in ("uv", "microvolt", "µv"):
        return 1.0 / 1000.0
    if code in ("v", "volt"):
        return 1000.0
    return 1.0


# ── standardization (resample -> fit length -> 12-lead ordering + limb derivation) ─────────────────
def _standardize(raw, src_fs, src_leads, target_fs: int, target_n: int):
    """Turn a raw (n_leads, n_samples) array into a (12, target_n) mV matrix in STANDARD_12 order.

    Returns (matrix, derived_leads) where derived_leads lists any limb leads reconstructed from I & II.
    """
    np = _np()
    arr = _resample_matrix(raw, src_fs, target_fs)
    arr = _fit_length(arr, target_n)

    rows: dict[str, object] = {}
    if src_leads:
        for i, raw_name in enumerate(src_leads):
            if i >= arr.shape[0]:
                break
            name = _canon_lead(raw_name)
            if name and name not in rows:
                rows[name] = arr[i]

    out = np.zeros((12, target_n), dtype=np.float32)
    derived: list[str] = []
    if rows:
        for j, name in enumerate(STANDARD_12):
            if name in rows:
                out[j] = rows[name]
        derived = _derive_limb_leads(out, rows)
    else:
        k = min(arr.shape[0], 12)
        out[:k] = arr[:k]
    return out, derived


def _resample_matrix(arr, src_fs, dst_fs: int):
    """Resample every channel from `src_fs` to `dst_fs` (FFT via scipy, else linear). No-op if fs unknown."""
    np = _np()
    if not src_fs or int(src_fs) <= 0 or int(src_fs) == int(dst_fs) or arr.shape[1] < 2:
        return np.asarray(arr, dtype=np.float32)
    n_new = max(2, int(round(arr.shape[1] * float(dst_fs) / float(src_fs))))
    try:
        from scipy.signal import resample
        return np.asarray(resample(arr, n_new, axis=1), dtype=np.float32)
    except Exception:  # noqa: BLE001 - scipy missing OR resample failure -> deterministic linear fallback
        old = np.linspace(0.0, 1.0, arr.shape[1], dtype=np.float64)
        new = np.linspace(0.0, 1.0, n_new, dtype=np.float64)
        out = np.empty((arr.shape[0], n_new), dtype=np.float32)
        for i in range(arr.shape[0]):
            out[i] = np.interp(new, old, arr[i]).astype(np.float32)
        return out


def _fit_length(arr, n: int):
    """Center-crop or center-pad every channel to exactly `n` samples."""
    np = _np()
    length = arr.shape[1]
    if length == n:
        return np.asarray(arr, dtype=np.float32)
    if length > n:
        start = (length - n) // 2
        return np.asarray(arr[:, start:start + n], dtype=np.float32)
    out = np.zeros((arr.shape[0], n), dtype=np.float32)
    start = (n - length) // 2
    out[:, start:start + length] = arr
    return out


def _derive_limb_leads(out, rows) -> list[str]:
    """Fill any absent III/aVR/aVL/aVF exactly from I & II (Einthoven/Goldberger). Returns derived names."""
    lead_i = rows.get("I")
    lead_ii = rows.get("II")
    if lead_i is None or lead_ii is None:
        return []
    derived: list[str] = []
    if "III" not in rows:
        out[STANDARD_12.index("III")] = lead_ii - lead_i
        derived.append("III")
    if "aVR" not in rows:
        out[STANDARD_12.index("aVR")] = -(lead_i + lead_ii) / 2.0
        derived.append("aVR")
    if "aVL" not in rows:
        out[STANDARD_12.index("aVL")] = lead_i - lead_ii / 2.0
        derived.append("aVL")
    if "aVF" not in rows:
        out[STANDARD_12.index("aVF")] = lead_ii - lead_i / 2.0
        derived.append("aVF")
    return derived


# ── small shared helpers ─────────────────────────────────────────────────────────────────────────
def _orient(arr):
    """Coerce an array to 2-D (n_leads, n_samples): 1-D -> single lead; put the shorter axis first."""
    np = _np()
    arr = np.squeeze(np.asarray(arr, dtype=np.float32))
    if arr.ndim == 1:
        return arr[None, :]
    if arr.ndim != 2:
        raise DatasetUnavailable(f"cannot interpret array of shape {arr.shape} as a 2-D ECG (leads x samples)")
    if arr.shape[0] > arr.shape[1]:                              # samples >> leads -> transpose to (leads, samples)
        arr = arr.T
    return arr


def _canon_lead(name) -> str | None:
    """Normalize a lead label (e.g. 'DI', 'MDC_ECG_LEAD_V1', 'Lead II') to a STANDARD_12 name, else None."""
    if not name:
        return None
    key = re.sub(r"[^A-Za-z0-9]", "", str(name)).upper()
    key = key.replace("MDCECGLEAD", "")
    if key.startswith("LEAD"):
        key = key[4:]
    return _LEAD_ALIASES.get(key)


def _is_numeric(value) -> bool:
    """True for a numpy array with an integer/unsigned/float dtype."""
    return getattr(getattr(value, "dtype", None), "kind", "") in ("f", "i", "u")


def _as_numeric_2d(value, depth: int = 0):
    """Best numeric 1-D/2-D array inside `value` (recurses MATLAB structs/cell arrays), as float32, or None."""
    np = _np()
    if depth > 5:
        return None
    try:
        arr = np.asarray(value)
    except Exception:  # noqa: BLE001
        return None
    if arr.dtype.names:                                          # MATLAB struct -> search fields
        best = None
        for field in arr.dtype.names:
            try:
                sub = _as_numeric_2d(arr[field], depth + 1)
            except Exception:  # noqa: BLE001
                sub = None
            if sub is not None and (best is None or sub.size > best.size):
                best = sub
        return best
    if arr.dtype.kind == "O":                                    # MATLAB cell array -> search elements
        best = None
        for el in arr.ravel():
            sub = _as_numeric_2d(el, depth + 1)
            if sub is not None and (best is None or sub.size > best.size):
                best = sub
        return best
    if arr.dtype.kind in ("f", "i", "u") and arr.size > 1:
        arr = np.squeeze(arr).astype(np.float32)
        if arr.ndim == 1:
            return arr[None, :]
        if arr.ndim == 2:
            return arr
        if arr.ndim > 2:
            return arr.reshape(arr.shape[0], -1)
    return None


def _scalar_int(value) -> int | None:
    """First element of `value` as a positive int, or None."""
    np = _np()
    try:
        flat = np.asarray(value).ravel()
        if flat.size == 0:
            return None
        val = float(flat[0])
    except (TypeError, ValueError):
        return None
    return int(round(val)) if val > 0 else None


def _str_list(value) -> list[str] | None:
    """Flatten `value` into a list of non-empty strings (bytes decoded), or None if empty."""
    np = _np()
    out: list[str] = []
    try:
        items = np.asarray(value).ravel().tolist()
    except Exception:  # noqa: BLE001
        return None
    for item in items:
        if isinstance(item, bytes):
            item = item.decode("utf-8", "ignore")
        text = str(item).strip()
        if text:
            out.append(text)
    return out or None


def _to_float(value, default: float = 0.0) -> float:
    """Parse a float from a string/number, returning `default` on failure."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _nonpriv_keys(mat: dict) -> list[str]:
    """MATLAB variable names (drop scipy's __header__/__version__/__globals__)."""
    return [k for k in mat if not k.startswith("__")]
