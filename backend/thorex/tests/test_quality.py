import numpy as np
from app.pipeline import quality


def test_uniform_image_flagged_inadequate():
    flat = np.zeros((224, 224), dtype="float32")   # no content
    rep = quality.assess(flat)
    assert rep.adequate is False
    assert "under-exposed" in rep.issues or "low-contrast" in rep.issues


def test_report_shape():
    img = (np.random.rand(224, 224).astype("float32") * 2048) - 1024
    rep = quality.assess(img)
    assert rep.view in {"PA", "AP", "portable", "lateral", "unknown"}
    assert isinstance(rep.issues, list)
