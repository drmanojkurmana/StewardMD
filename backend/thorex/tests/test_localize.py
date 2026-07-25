import numpy as np, torch, torch.nn as nn, base64
from app.pipeline import localize


class _Tiny(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential()
        self.features.add_module("conv", nn.Conv2d(1, 4, 3, padding=1))
        self.features.add_module("norm5", nn.BatchNorm2d(4))
        self.head = nn.Linear(4, 3)

    def forward(self, x):
        f = self.features(x)
        return self.head(f.mean(dim=(2, 3)))


def test_heatmap_returns_base64_png():
    m = _Tiny().eval()
    img = (np.random.rand(224, 224).astype("float32") * 2048) - 1024
    b64 = localize.heatmap_for(m, img, class_index=0, target_layer=m.features.norm5)
    raw = base64.b64decode(b64)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"     # PNG magic


def test_default_target_layer_is_features_norm5():
    m = _Tiny().eval()
    assert localize.default_target_layer(m) is m.features.norm5
