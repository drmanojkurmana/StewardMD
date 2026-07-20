"""Confidence calibration — pure python, no ML deps; runs in the base 'test' job.

Guarantees under test: an unfitted calibrator is the honest identity (is_calibrated False, input returned
unchanged); T>1 tempers toward 0.5; T<1 sharpens away from 0.5; extremes clamp into (1e-6, 1-1e-6);
reliability bins map into measured accuracy; and from_config reads the configured temperature.
"""
from __future__ import annotations

import math
from types import SimpleNamespace

import pytest

from app.core.errors import KardioXError
from app.services.calibration import ConfidenceCalibrator


def test_identity_returns_input_and_reports_uncalibrated():
    c = ConfidenceCalibrator()
    assert c.is_calibrated is False
    for p in (0.01, 0.3, 0.5, 0.7, 0.99):
        assert c.calibrate(p) == pytest.approx(p)
    d = c.describe()
    assert d == {"calibrated": False, "temperature": 1.0, "bins": 0}


def test_temperature_gt_one_pulls_toward_half():
    c = ConfidenceCalibrator(temperature=2.0)
    assert c.is_calibrated is True
    hi, lo = c.calibrate(0.9), c.calibrate(0.1)
    # moved toward 0.5 but stayed on the same side
    assert 0.5 < hi < 0.9
    assert 0.1 < lo < 0.5
    assert abs(hi - 0.5) < abs(0.9 - 0.5)
    assert abs(lo - 0.5) < abs(0.1 - 0.5)
    assert hi == pytest.approx(0.75, abs=1e-9)  # sigmoid(ln(9)/2)


def test_temperature_lt_one_sharpens():
    c = ConfidenceCalibrator(temperature=0.5)
    out = c.calibrate(0.8)
    assert out > 0.8
    assert abs(out - 0.5) > abs(0.8 - 0.5)


def test_clamping_at_extremes_stays_in_open_interval():
    c = ConfidenceCalibrator(temperature=2.0)
    for p in (0.0, 1.0, -5.0, 5.0):
        out = c.calibrate(p)
        assert 0.0 < out < 1.0 and math.isfinite(out)
    # identity path also clamps (never returns exactly 0 or 1)
    ident = ConfidenceCalibrator()
    assert 0.0 < ident.calibrate(0.0) < 1.0
    assert 0.0 < ident.calibrate(1.0) < 1.0


def test_nan_maps_to_uncertain_half():
    assert ConfidenceCalibrator().calibrate(float("nan")) == 0.5


def test_non_numeric_input_raises_typed_error():
    c = ConfidenceCalibrator()
    for bad in (None, "abc", object()):
        with pytest.raises(KardioXError):
            c.calibrate(bad)


def test_reliability_bins_map_to_empirical_accuracy():
    c = ConfidenceCalibrator(bins=[(0.0, 0.5, 0.2), (0.5, 1.0, 0.8)])
    assert c.is_calibrated is True
    assert c.calibrate(0.9) == pytest.approx(0.8)
    assert c.calibrate(0.3) == pytest.approx(0.2)
    assert c.describe()["bins"] == 2


def test_malformed_bins_are_dropped_and_stay_honest():
    c = ConfidenceCalibrator(bins=[("x", "y", "z"), (0.6, 0.4, 0.5), (0.1,)])  # all invalid
    assert c.is_calibrated is False
    assert c.describe()["bins"] == 0
    assert c.calibrate(0.7) == pytest.approx(0.7)


def test_invalid_temperature_coerces_to_identity():
    for bad in (0.0, -3.0, float("nan"), float("inf"), "nope", None):
        c = ConfidenceCalibrator(temperature=bad)
        assert c.temperature == 1.0
        assert c.is_calibrated is False


def test_from_config_reads_temperature():
    c = ConfidenceCalibrator.from_config(SimpleNamespace(calibration_temperature=2.0))
    assert c.temperature == 2.0 and c.is_calibrated is True
    # missing attribute -> honest identity default
    c2 = ConfidenceCalibrator.from_config(SimpleNamespace())
    assert c2.temperature == 1.0 and c2.is_calibrated is False


# ── offline fitting utilities (Validation Runbook §4) ────────────────────────────────────────────

def test_fit_temperature_tempers_overconfidence():
    from app.services.calibration import fit_temperature
    # confident (0.97/0.03) but only ~50% correct -> temperature should temper (T > 1)
    probs = [0.97, 0.03] * 50
    labels = ([1, 0] * 25) + ([0, 1] * 25)
    assert fit_temperature(probs, labels) > 1.0


def test_fit_temperature_identity_on_single_class():
    from app.services.calibration import fit_temperature
    assert fit_temperature([0.6, 0.7, 0.8], [1, 1, 1]) == 1.0   # no signal -> honest identity
    assert fit_temperature([], []) == 1.0


def test_expected_calibration_error():
    from app.services.calibration import expected_calibration_error
    assert expected_calibration_error([0.0, 1.0] * 20, [0, 1] * 20) == 0.0        # perfectly calibrated
    assert expected_calibration_error([0.99] * 10, [0] * 5 + [1] * 5) > 0.4       # over-confident
