from app.pipeline import assemble


def test_band_thresholds():
    assert assemble.band(0.72) == "High"
    assert assemble.band(0.41) == "Medium"
    assert assemble.band(0.18) == "Low"
    assert assemble.band(0.05) is None


def test_engine_result_drops_subthreshold_and_sorts():
    er = assemble.engine_result("torchxrayvision", False,
                                [("Pneumonia", 0.72), ("Nodule", 0.05), ("Effusion", 0.41)])
    labels = [f.label for f in er.findings]
    assert labels == ["Pneumonia", "Effusion"]      # 0.05 dropped, sorted desc
    assert er.educational is False


def test_educational_engine_carries_disclaimer():
    er = assemble.engine_result("xraydar", True, [("Cavity", 0.66)])
    assert er.disclaimer_key == "educational_not_clinical"
