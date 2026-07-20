"""ECG-Digitiser (felixkrones, BSD-2) integration — learned image->signal digitizer.

ECG-Digitiser (PhysioNet/CinC-2024 winner: Hough gridline/lead-layout detection + nnU-Net trace
segmentation) reconstructs per-lead **mV signals** from a photographed / scanned paper ECG. KardioX ships
NO weights and cannot run it in this sandbox. This wrapper invokes an OPERATOR-INSTALLED ECG-Digitiser
(git clone felixkrones/ECG-Digitiser + `git lfs pull` the M1/M3 nnU-Net weights + its nnU-Net env) via a
configured command, and maps its reconstructed signals onto the KardioX digitization contract.

NOT READY: raises UpstreamUnavailable (never fabricates a signal) until KARDIOX_ECG_DIGITISER_CMD is set
and the command runs and produces output.

Wiring:
  KARDIOX_PROVIDER_DIGITIZATION=external
  KARDIOX_DIGITIZER_ENTRYPOINT=app.integrations.ecg_digitiser:digitize
  KARDIOX_ECG_DIGITISER_CMD="python -m your_ecg_digitiser --input {input} --output {output}"

The command must read the ECG image at ``{input}`` and write reconstructed signals to ``{output}`` as
EITHER a WFDB record (``{output}.hea`` + ``{output}.dat``, signals in mV) OR a NumPy array
(``{output}.npy`` shaped ``(n_leads, n_samples)`` in mV). Because ECG-Digitiser emits already-calibrated
mV, the returned traces carry a ``"signal"`` passthrough block that ``WfdbSignal.to_signal`` uses directly
(no lossy pixel round-trip).

Expected input:  raw image bytes.
Expected output: KardioX traces dict {"leads", "calibration", "signal", "layout", "method"}.
Failure modes:   cmd unset / tool missing / non-zero exit / timeout / no output -> UpstreamUnavailable.
"""
from __future__ import annotations

from app.core.errors import UpstreamUnavailable

_STAGE = "digitization"
STANDARD_12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]


def _settings():
    from app.core.config import get_settings
    return get_settings()


def _to_traces(mv_rows: list, fs: int, leads: list[str]) -> dict:
    """Map reconstructed per-lead mV rows -> KardioX traces with a pre-calibrated ``signal`` passthrough."""
    rows = [list(r) for r in mv_rows]
    dur = round(len(rows[0]) / float(fs), 3) if rows and rows[0] else 0.0
    signal = {"leads": {lead: {"mv": [round(float(v), 5) for v in row], "fs": int(fs)}
                        for lead, row in zip(leads, rows)},
              "duration_s": dur}
    return {
        # top-level "leads" satisfies the DigitizationProvider contract + lead-count/consensus checks;
        # the authoritative calibrated mV is in "signal" (used directly by WfdbSignal.to_signal).
        "leads": {lead: row for lead, row in zip(leads, rows)},
        "calibration": {"mmPerS": 25.0, "mmPerMv": 10.0, "pxPerMm": None, "method": "ecg-digitiser"},
        "signal": signal,
        "layout": "twelveLead3x4_rhythm",
        "method": "ecg-digitiser",
    }


def _load_output(out_base: str, fs_default: int) -> tuple[list, int, list[str]]:
    """Read ECG-Digitiser output ({out}.npy or a WFDB record at {out}) -> (mv_rows, fs, leads)."""
    import os
    npy = out_base + ".npy"
    if os.path.exists(npy):
        import numpy as np
        arr = np.load(npy)
        if arr.ndim != 2:
            raise UpstreamUnavailable("ecg-digitiser .npy output is not 2-D (n_leads, n_samples)", stage=_STAGE)
        if arr.shape[0] > arr.shape[1]:      # (samples, leads) -> transpose to (leads, samples)
            arr = arr.T
        rows = [arr[i].tolist() for i in range(arr.shape[0])]
        return rows, int(fs_default), STANDARD_12[:len(rows)]
    if os.path.exists(out_base + ".hea"):
        try:
            import wfdb
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("wfdb needed to read ecg-digitiser WFDB output", stage=_STAGE) from e
        rec = wfdb.rdrecord(out_base)
        sig = rec.p_signal                    # (n_samples, n_leads) in physical units (mV)
        rows = [sig[:, i].tolist() for i in range(sig.shape[1])]
        leads = list(rec.sig_name) if rec.sig_name else STANDARD_12[:len(rows)]
        return rows, int(rec.fs or fs_default), leads
    raise UpstreamUnavailable("ecg-digitiser produced no output (.npy or WFDB) at the expected path", stage=_STAGE)


def digitize(image_bytes: bytes) -> dict:
    """Run the operator-installed ECG-Digitiser on an image and return KardioX traces. Not-Ready-safe."""
    import os
    import shlex
    import subprocess
    import tempfile

    s = _settings()
    cmd_tmpl = (getattr(s, "ecg_digitiser_cmd", "") or "").strip()
    if not cmd_tmpl:
        raise UpstreamUnavailable(
            "ECG-Digitiser NOT READY: set KARDIOX_ECG_DIGITISER_CMD to the reconstruction command "
            "(install felixkrones/ECG-Digitiser + git lfs pull its weights first). KardioX ships none.",
            stage=_STAGE)
    if not image_bytes:
        from app.core.errors import BadImage
        raise BadImage("Empty image payload", stage=_STAGE)

    fs_default = int(getattr(s, "ecg_digitiser_fs", 500))
    timeout = float(getattr(s, "ecg_digitiser_timeout_s", 120.0))
    with tempfile.TemporaryDirectory() as d:
        inp = os.path.join(d, "ecg_in.png")
        out_base = os.path.join(d, "ecg_out")
        with open(inp, "wb") as f:
            f.write(image_bytes)
        try:
            cmd = shlex.split(cmd_tmpl.format(input=inp, output=out_base))
        except (KeyError, ValueError) as e:
            raise UpstreamUnavailable(f"invalid KARDIOX_ECG_DIGITISER_CMD template: {type(e).__name__}", stage=_STAGE) from e
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)  # noqa: S603 (trusted operator config, no shell)
        except FileNotFoundError as e:
            raise UpstreamUnavailable(f"ECG-Digitiser command not found: {cmd[0]!r}", stage=_STAGE) from e
        except subprocess.TimeoutExpired as e:
            raise UpstreamUnavailable(f"ECG-Digitiser timed out after {timeout:.0f}s", stage=_STAGE) from e
        if proc.returncode != 0:
            raise UpstreamUnavailable(f"ECG-Digitiser exited {proc.returncode}", stage=_STAGE)
        rows, fs, leads = _load_output(out_base, fs_default)
    if not rows:
        raise UpstreamUnavailable("ECG-Digitiser returned no leads", stage=_STAGE)
    return _to_traces(rows, fs, leads)
