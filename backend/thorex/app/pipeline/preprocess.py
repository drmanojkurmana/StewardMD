import io, hashlib
import numpy as np
from PIL import Image
import torchxrayvision as xrv
import torchvision

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

class UnsupportedFormat(Exception):
    pass

_TRANSFORM = torchvision.transforms.Compose(
    [xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(224)]
)

def _pil_from(data: bytes, filename: str) -> Image.Image:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "pdf":
        from pdf2image import convert_from_bytes
        pages = convert_from_bytes(data, dpi=200, first_page=1, last_page=1)
        if not pages:
            raise UnsupportedFormat("empty pdf")
        return pages[0].convert("L")
    if ext in {"png", "jpg", "jpeg", "heic", "heif", "webp", "bmp"}:
        try:
            return Image.open(io.BytesIO(data)).convert("L")
        except Exception as e:
            raise UnsupportedFormat(str(e))
    raise UnsupportedFormat(f"unsupported extension: {ext!r}")

def load_image(data: bytes, filename: str) -> np.ndarray:
    pil = _pil_from(data, filename)
    arr = np.asarray(pil).astype("float32")          # HxW, 0..255
    arr = xrv.datasets.normalize(arr, 255)           # -> [-1024,1024]
    arr = arr[None, ...]                             # 1xHxW for transforms
    arr = _TRANSFORM(arr)                           # 1x224x224
    return arr[0].astype("float32")

def perceptual_hash(data: bytes) -> str:
    pil = Image.open(io.BytesIO(data)).convert("L").resize((16, 16))
    a = np.asarray(pil); bits = (a > a.mean()).flatten()
    v = 0
    for b in bits[:64]:
        v = (v << 1) | int(b)
    return f"{v:016x}"

# De-identification hook; replaced by redact.redact_burned_in_text in Task 8b's wiring.
def _identity_redact(png: bytes) -> bytes:
    return png

def prepare(data: bytes, filename: str, redact_hook=_identity_redact):
    from app.providers.base import PreparedImage
    array = load_image(data, filename)                       # raises UnsupportedFormat
    pil = _pil_from(data, filename)                          # grayscale, no EXIF carried
    buf = io.BytesIO(); pil.save(buf, format="PNG")          # re-encode strips metadata
    outbound = redact_hook(buf.getvalue())                   # de-identify text (Task 8b)
    return PreparedImage(array=array, outbound_png=outbound)
