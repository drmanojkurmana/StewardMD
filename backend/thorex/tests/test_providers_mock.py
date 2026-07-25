from app.providers.mock_provider import MockProvider

def test_mock_provider_returns_label_prob_pairs():
    p = MockProvider(name="torchxrayvision")
    out = p.detect(None)
    assert p.name == "torchxrayvision"
    assert all(isinstance(lbl, str) and 0.0 <= pr <= 1.0 for lbl, pr in out)
    assert ("Pneumonia", 0.72) in out

def test_mock_provider_name_defaults_and_educational_flag():
    assert MockProvider().name == "mock"
    assert MockProvider(name="xraydar", educational=True).educational is True
