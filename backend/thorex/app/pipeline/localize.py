"""Grad-CAM localization: turn a model + class index into a heatmap overlay.

Only used for the TorchXRayVision (local) engine — Grad-CAM needs direct
access to the model's convolutional feature maps, which the HF/free and
X-Raydar engines (remote API / vendored classifier without a documented
target layer) don't expose in P1.
"""
import io
import base64
import numpy as np
import torch
from PIL import Image
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget


def heatmap_for(model, img: np.ndarray, class_index: int, target_layer) -> str:
    """Compute a Grad-CAM heatmap for one class and return it as a base64 PNG.

    ``img`` is the same normalized 224x224 single-channel array used for
    inference (``PreparedImage.array``). Returns a 224x224 RGBA overlay
    (red intensity + alpha proportional to activation) base64-encoded.
    """
    t = torch.from_numpy(img[None, None, ...].astype("float32"))
    cam = GradCAM(model=model, target_layers=[target_layer])
    grayscale = cam(input_tensor=t, targets=[ClassifierOutputTarget(class_index)])[0]  # HxW 0..1
    # colorize (simple red overlay on alpha)
    h = (grayscale * 255).astype("uint8")
    rgba = np.zeros((*h.shape, 4), dtype="uint8")
    rgba[..., 0] = h                     # red channel
    rgba[..., 3] = (grayscale * 180).astype("uint8")  # alpha by intensity
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").resize((224, 224)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def default_target_layer(model):
    """TorchXRayVision DenseNet121 final norm layer (last conv-feature layer)."""
    return model.features.norm5
