"""Loader seam tests: manifest -> upstream inputs, refusing unverified data."""
from __future__ import annotations

import copy
import json

import pytest

from paperorchestra.adapter.po_adapter import loader
from test_po_common import make_manifest


def test_builds_upstream_inputs(tmp_path):
    manifest = make_manifest()
    inputs = loader.build_inputs(manifest, tmp_path)
    assert inputs.idea_file.exists()
    assert inputs.experimental_log_file.exists()
    assert inputs.latex_template_file.exists()
    assert inputs.conference_guidelines_file.exists()
    assert json.loads(inputs.figures_info_path.read_text()) == []
    idea = inputs.idea_file.read_text()
    assert "Protocol lock hash" in idea
    assert "10.1000/trial1" in idea
    log = inputs.experimental_log_file.read_text()
    assert "{{run:r1.estimate}}" in log
    assert "{{run:r1.ciLower}}" in log
    assert "research-engine.js" in log


def test_token_table_flattens_runs():
    table = loader.build_token_table(make_manifest()["runs"])
    assert table["r1.estimate"]["value"] == 0.62
    assert table["r1.estimate"]["null"] == 1.0  # OR
    assert table["r1.p"]["value"] == 0.02
    assert table["r1.k"]["value"] == 12


def test_null_for_ratio_vs_difference_measures():
    assert loader.null_for_measure("OR") == 1.0
    assert loader.null_for_measure("RR") == 1.0
    assert loader.null_for_measure("HR") == 1.0
    assert loader.null_for_measure("MD") == 0.0
    assert loader.null_for_measure("RD") == 0.0


def test_refuses_unverified_extraction_value(tmp_path):
    manifest = make_manifest()
    manifest["evidence"][0]["values"][0]["verified"] = False
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "unverified_value"


def test_refuses_missing_verified_flag(tmp_path):
    manifest = make_manifest()
    del manifest["evidence"][0]["values"][0]["verified"]
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "unverified_value"


def test_refuses_missing_provenance(tmp_path):
    manifest = make_manifest()
    manifest["evidence"][0]["values"][0]["quote"] = ""
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "missing_provenance"


def test_refuses_unlocked_protocol(tmp_path):
    manifest = make_manifest()
    manifest["protocol"]["lockHash"] = ""
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "protocol_unlocked"


def test_refuses_bad_manifest_version(tmp_path):
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs({"v": 2}, tmp_path)
    assert exc.value.code == "invalid_manifest"


def test_refuses_run_without_result(tmp_path):
    manifest = make_manifest()
    manifest["runs"][0]["result"] = None
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "invalid_run"


def test_manifest_not_mutated(tmp_path):
    manifest = make_manifest()
    snapshot = copy.deepcopy(manifest)
    loader.build_inputs(manifest, tmp_path)
    assert manifest == snapshot


def test_renders_rob_and_grade(tmp_path):
    manifest = make_manifest()
    manifest["rob"] = [{"studyId": "s1", "tool": "RoB 2", "domain": "randomization",
                        "judgment": "low risk", "verified": True,
                        "locator": {"page": 3}, "quote": "random sequence generated"}]
    manifest["grade"] = [{"outcome": "Y", "certainty": "moderate",
                          "rationale": "downgraded for risk of bias",
                          "domains": {"risk_of_bias": "serious"}}]
    inputs = loader.build_inputs(manifest, tmp_path)
    idea = inputs.idea_file.read_text()
    assert "Risk of bias" in idea and "low risk" in idea
    assert "random sequence generated" in idea
    assert "GRADE" in idea and "moderate certainty" in idea


def test_refuses_unverified_rob(tmp_path):
    manifest = make_manifest()
    manifest["rob"] = [{"studyId": "s1", "tool": "RoB 2", "domain": "d",
                        "judgment": "low", "verified": False,
                        "locator": {"page": 1}, "quote": "q"}]
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "unverified_rob"


def test_refuses_invalid_grade_certainty(tmp_path):
    manifest = make_manifest()
    manifest["grade"] = [{"outcome": "Y", "certainty": "certain"}]
    with pytest.raises(loader.LoaderError) as exc:
        loader.build_inputs(manifest, tmp_path)
    assert exc.value.code == "invalid_grade"
