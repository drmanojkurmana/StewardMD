"""Confidence calibration (Phase 5F+) — pure-python, HONEST: identity until fitted.

The rule engine (services/rules.py) and rhythm providers emit a raw confidence in [0, 1]. A raw model
score is rarely a true probability: it is usually over- or under-confident. This module maps that raw
score to a better-calibrated one WITHOUT ever inventing certainty it does not have — an unfitted
calibrator returns the input unchanged and reports `calibrated=False`.

Two model-free, deterministic mechanisms:
  • Temperature scaling in logit space — logit = ln(p/(1-p)); p_cal = sigmoid(logit / T).
    T = 1.0 is the identity. T > 1 pulls scores toward 0.5 (tempers over-confidence); T < 1 sharpens.
  • Piecewise reliability mapping — a list of (low, high, empirical_accuracy) bins from a reliability
    diagram; a score falling in [low, high] is mapped to that bin's measured accuracy. Applied AFTER
    temperature scaling when both are configured.

A fitted T (and/or bins) must be estimated on a HELD-OUT labelled ECG set before being trusted; shipping
T = 1.0 keeps the pipeline honest (uncalibrated) rather than fabricating calibration.

Expected input:  a raw probability `prob` in [0, 1] (clamped to (1e-6, 1-1e-6)); config via `from_config`.
Expected output: `calibrate` -> a float in (1e-6, 1-1e-6); `describe` -> {calibrated, temperature, bins}.
Failure modes:   non-numeric `prob` -> KardioXError(code="bad_input"); NaN -> 0.5 (maximally uncertain);
                 invalid temperature (<=0, non-finite, non-numeric) -> coerced to 1.0 (safe identity);
                 malformed bins -> silently dropped (never crash on partial config).
Boundary:        no learning here — T and bins are parameters that require offline calibration + clinical
                 validation. This module only APPLIES them deterministically.
"""
from __future__ import annotations

import math

from app.core.errors import KardioXError

_EPS = 1e-6
_LO = _EPS
_HI = 1.0 - _EPS

Bin = tuple[float, float, float]  # (low, high, empirical_accuracy)


def _clamp_open(p: float) -> float:
    """Clamp a finite float into the open interval (1e-6, 1-1e-6)."""
    if p <= _LO:
        return _LO
    if p >= _HI:
        return _HI
    return p


def _sigmoid(x: float) -> float:
    """Numerically stable logistic sigmoid; never overflows for large |x|."""
    if x >= 0.0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _coerce_prob(prob: float) -> float:
    """Coerce `prob` to a float clamped into (1e-6, 1-1e-6).

    NaN maps to 0.5 (maximally uncertain); +/-inf clamp to the interval bounds. Non-numeric input is a
    programming error and raises KardioXError rather than silently masking it.
    """
    try:
        p = float(prob)
    except (TypeError, ValueError) as e:
        raise KardioXError("prob must be a real number in [0, 1]", stage="calibration",
                           code="bad_input", http=400) from e
    if math.isnan(p):
        return 0.5
    return _clamp_open(p)


class ConfidenceCalibrator:
    """Deterministic confidence calibrator; identity (and honest) until a T or bins are supplied.

    Expected input:  temperature > 0 (1.0 = identity) and/or reliability bins.
    Expected output: `calibrate(prob)` in (1e-6, 1-1e-6); `is_calibrated`; `describe()`.
    Failure modes:   invalid temperature -> 1.0; malformed bins dropped; see module docstring.
    Boundary:        applies calibration parameters only; it does not fit them.
    """

    def __init__(self, temperature: float = 1.0, bins: list[Bin] | None = None) -> None:
        self.temperature: float = self._safe_temperature(temperature)
        self._bins: list[Bin] = self._clean_bins(bins)

    @staticmethod
    def _safe_temperature(temperature: float) -> float:
        """Return a strictly-positive finite temperature; fall back to 1.0 (identity) on bad input."""
        try:
            t = float(temperature)
        except (TypeError, ValueError):
            return 1.0
        if not math.isfinite(t) or t <= 0.0:
            return 1.0
        return t

    @staticmethod
    def _clean_bins(bins: list[Bin] | None) -> list[Bin]:
        """Validate + sort reliability bins; drop any malformed entry (fail-safe, never raises)."""
        clean: list[Bin] = []
        for b in bins or []:
            try:
                low, high, acc = b
                low, high, acc = float(low), float(high), float(acc)
            except (TypeError, ValueError):
                continue
            if not (math.isfinite(low) and math.isfinite(high) and math.isfinite(acc)):
                continue
            if high <= low:
                continue
            clean.append((low, high, min(1.0, max(0.0, acc))))
        clean.sort(key=lambda t: t[0])
        return clean

    @property
    def is_calibrated(self) -> bool:
        """True only when a real transform is configured (T != 1.0 or >=1 valid bin); else honest False."""
        return self.temperature != 1.0 or bool(self._bins)

    def _map_bins(self, p: float) -> float | None:
        """Return the empirical accuracy of the first bin containing `p`, or None if no bin matches."""
        for low, high, acc in self._bins:
            if low <= p <= high:
                return acc
        return None

    def calibrate(self, prob: float) -> float:
        """Map a raw probability to a calibrated one in (1e-6, 1-1e-6).

        Expected input:  `prob` coercible to float; ideally in [0, 1].
        Expected output: calibrated float; the exact clamped input when this calibrator is unfitted.
        Failure modes:   non-numeric -> KardioXError(bad_input); NaN -> 0.5.
        Boundary:        temperature scaling then (optionally) reliability-bin mapping; both deterministic.
        """
        p = _coerce_prob(prob)
        if not self.is_calibrated:
            return p  # honest identity — no fabricated confidence
        if self.temperature != 1.0:
            logit = math.log(p / (1.0 - p))
            p = _clamp_open(_sigmoid(logit / self.temperature))
        if self._bins:
            mapped = self._map_bins(p)
            if mapped is not None:
                p = _clamp_open(mapped)
        return p

    def describe(self) -> dict:
        """Report calibration state: {"calibrated": bool, "temperature": float, "bins": int}."""
        return {"calibrated": self.is_calibrated, "temperature": self.temperature, "bins": len(self._bins)}

    @classmethod
    def from_config(cls, settings) -> "ConfidenceCalibrator":  # noqa: ANN001 - Settings duck-typed
        """Build from app settings, reading `calibration_temperature` (default 1.0 = identity).

        Expected input:  a settings object (may lack the attribute).
        Expected output: a calibrator; identity when the temperature is absent/1.0.
        Failure modes:   missing/invalid attribute -> default 1.0 (never raises here).
        Boundary:        bins are not sourced from config; supply them explicitly once measured.
        """
        return cls(temperature=getattr(settings, "calibration_temperature", 1.0))
