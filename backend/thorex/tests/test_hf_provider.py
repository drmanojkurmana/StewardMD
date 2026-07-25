import pytest
from app.providers.base import PreparedImage
from app.providers.hf_provider import HFInferenceProvider
import numpy as np

_PREP = PreparedImage(array=np.zeros((224, 224), "float32"), outbound_png=b"\x89PNG\r\n\x1a\n")


def test_hf_maps_label_scores():
    def fake_post(url, data, headers, timeout):
        class R:
            status_code = 200
            def json(self):
                return [{"label": "Pneumonia", "score": 0.81},
                        {"label": "No Finding", "score": 0.10}]
        return R()
    out = HFInferenceProvider(post_fn=fake_post).detect(_PREP)
    assert ("Pneumonia", 0.81) in out
    assert HFInferenceProvider().name == "hf_vit"


def test_hf_unavailable_raises_runtimeerror():
    def fake_post(url, data, headers, timeout):
        class R:
            status_code = 503
            def json(self):
                return {"error": "loading"}
        return R()
    with pytest.raises(RuntimeError):
        HFInferenceProvider(post_fn=fake_post).detect(_PREP)


def test_hf_non_numeric_score_raises_runtimeerror():
    def fake_post(url, data, headers, timeout):
        class R:
            status_code = 200
            def json(self):
                return [{"label": "Pneumonia", "score": "high"}]
        return R()
    with pytest.raises(RuntimeError):
        HFInferenceProvider(post_fn=fake_post).detect(_PREP)
