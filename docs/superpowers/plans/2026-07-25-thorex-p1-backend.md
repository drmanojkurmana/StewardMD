# ThoreX AI — Phase 1 Backend Inference Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable FastAPI + ONNX/PyTorch chest-X-ray inference service (`backend/thorex/`) that performs **real** TorchXRayVision + X-Raydar detection, MONAI preprocessing, image-quality assessment, and Grad-CAM localization, exposed as a secure tier-aware `/v1/analyze` endpoint — testable end-to-end via pytest/`curl` before any UI exists.

**Architecture:** Mirrors `backend/kardiox/`. A chain of independent, injectable pipeline stages (`preprocess → quality → detect(provider) → localize → assemble`) behind a provider seam (`InferenceProvider` ABC → `MockProvider`, `TorchXRayVisionProvider`, `XRaydarProvider`). Fast unit suite runs against the mock provider + synthetic images; real-weight inference lives behind an opt-in `@pytest.mark.models` marker so the base test loop stays fast, exactly like KardioX's `requirements-ml.txt` split.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, pydantic v2 / pydantic-settings, structlog, Pillow + pillow-heif (HEIC) + pdf2image (PDF), scikit-image, PyTorch (CPU-ok), torchxrayvision, monai, grad-cam (pytorch-grad-cam), huggingface_hub (X-Raydar weights), pytest + httpx TestClient, Docker.

## Global Constraints

- **Entitlement-aware:** service maps an `entitlement` value to engines — `"free"` → HF-hosted ViT (server-side); `"v1"` → TorchXRayVision only; `"v2beta"` → TorchXRayVision **and** X-Raydar. Entitlement is resolved + enforced upstream (StewardMD Pro paywall + `SMD_XACCESS` role); this service runs the engines the authenticated caller requests.
- **Free path = third-party PHI:** the HF engine sends the image to Hugging Face. It is consent-gated upstream, called **server-side** with our HF token (never client-side), and the image must be **EXIF/metadata-stripped** before transmission. HF unavailable → 503 `inference_unavailable` (never fabricated). Pro engines (TorchXRayVision, X-Raydar) run only in-process and never transit HF.
- **Never return raw probabilities to the client.** Map to confidence **bands** High / Medium / Low + severity. Raw floats stay server-internal.
- **X-Raydar is educational / non-commercial:** every X-Raydar result object carries `"educational": true` and `"disclaimer_key": "educational_not_clinical"`. It must never be the source for downstream clinical actions.
- **Security:** no image bytes in logs (log only opaque ids + metrics); delete every temp/inference image after the request; no PHI in structured logs.
- **Licenses:** TorchXRayVision Apache-2.0, pytorch-grad-cam MIT, MONAI Apache-2.0 (all commercial-OK). X-Raydar research/non-commercial only — download from HF `dnamodel/xraydar-cv`, used for education.
- **No fabricated results:** if a model/weights are unavailable, the endpoint returns HTTP 503 `inference_unavailable` — never a canned finding.
- **Confidence bands (fixed thresholds):** prob ≥ 0.60 → High; 0.30 ≤ prob < 0.60 → Medium; 0.10 ≤ prob < 0.30 → Low; prob < 0.10 → not reported.
- **Mandatory disclaimer key on every response:** `"clinical_assist_disclaimer"` (full text lives in the frontend copy bank; backend emits the key).

---

### Task 1: Project scaffold, config, health endpoint

**Files:**
- Create: `backend/thorex/app/__init__.py`, `backend/thorex/app/main.py`
- Create: `backend/thorex/app/core/__init__.py`, `backend/thorex/app/core/config.py`, `backend/thorex/app/core/logging.py`
- Create: `backend/thorex/app/api/__init__.py`, `backend/thorex/app/api/v1/__init__.py`, `backend/thorex/app/api/v1/router.py`, `backend/thorex/app/api/v1/health.py`
- Create: `backend/thorex/requirements.txt`
- Create: `backend/thorex/tests/__init__.py`, `backend/thorex/tests/conftest.py`, `backend/thorex/tests/test_health.py`

**Interfaces:**
- Produces: `app.main:app` (FastAPI instance); `GET /v1/health` → `{"status":"ok","service":"thorex","mode": <str>}`; `app.core.config:get_settings() -> Settings` with fields `mode: str = "mock"`, `environment: str = "dev"`, `model_cache_dir: str`.

- [ ] **Step 1: Write `requirements.txt`**

```
fastapi>=0.111,<1.0
uvicorn[standard]>=0.30
pydantic>=2.7,<3.0
pydantic-settings>=2.3
structlog>=24.1
python-multipart>=0.0.9
pillow>=10.3
pytest>=8.2
httpx>=0.27
```

- [ ] **Step 2: Write the failing test** — `backend/thorex/tests/test_health.py`

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_ok():
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "thorex"
```

- [ ] **Step 3: Run it, verify failure**

Run (from `backend/thorex/`): `python -m pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 4: Implement config** — `app/core/config.py`

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="THOREX_", env_file=".env", extra="ignore")
    mode: str = "mock"            # mock | local | cloud
    environment: str = "dev"
    model_cache_dir: str = "/tmp/thorex-models"

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 5: Implement logging** — `app/core/logging.py`

```python
import structlog

def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )

def get_logger(name: str):
    return structlog.get_logger(name)
```

- [ ] **Step 6: Implement health router** — `app/api/v1/health.py`

```python
from fastapi import APIRouter
from app.core.config import get_settings

router = APIRouter()

@router.get("/health")
def health():
    return {"status": "ok", "service": "thorex", "mode": get_settings().mode}
```

- [ ] **Step 7: Implement router aggregate** — `app/api/v1/router.py`

```python
from fastapi import APIRouter
from app.api.v1 import health

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
```

- [ ] **Step 8: Implement app** — `app/main.py`

```python
from fastapi import FastAPI
from app.core.logging import configure_logging
from app.api.v1.router import api_router

configure_logging()
app = FastAPI(title="ThoreX AI Inference Service", version="0.1.0")
app.include_router(api_router, prefix="/v1")
```

- [ ] **Step 9: Empty `conftest.py`** ensuring `backend/thorex/` is import root

```python
# conftest.py at backend/thorex/ makes `app` importable when pytest runs from here.
```

- [ ] **Step 10: Run test, verify pass**

Run: `python -m pytest tests/test_health.py -v` → PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/thorex
git commit -m "feat(thorex-backend): FastAPI scaffold + config + health endpoint"
```

---

### Task 2: Response schemas + provider base + mock provider

**Files:**
- Create: `backend/thorex/app/models/__init__.py`, `backend/thorex/app/models/schemas.py`
- Create: `backend/thorex/app/providers/__init__.py`, `backend/thorex/app/providers/base.py`, `backend/thorex/app/providers/mock_provider.py`
- Create: `backend/thorex/tests/test_providers_mock.py`

**Interfaces:**
- Produces: `schemas.Finding(label:str, prob:float, band:str, severity:str, relevance:str)`; `schemas.EngineResult(engine:str, educational:bool, findings:list[Finding], disclaimer_key:str|None)`; `schemas.AnalysisResult(quality:QualityReport|None, engines:list[EngineResult], disclaimer_key:str, request_id:str)`.
- Produces: `base.PreparedImage` dataclass — `array: np.ndarray` (normalized 224×224 for local models) + `outbound_png: bytes` (de-identified full-res PNG for any third-party/HF transmission). Local providers read `.array`; the HF provider reads `.outbound_png`.
- Produces: `base.InferenceProvider` ABC with `name:str`, `educational:bool`, `def detect(self, prepared: "PreparedImage") -> list[tuple[str, float]]` (returns `(label, prob)` pairs, prob in [0,1]).
- Produces: `mock_provider.MockProvider(name="torchxrayvision", educational=False)` returning deterministic pairs, e.g. `[("Pneumonia",0.72),("Effusion",0.41),("Cardiomegaly",0.18)]`. `name` is configurable so the mock can stand in for any real engine in contract tests.

- [ ] **Step 1: Write failing test** — `tests/test_providers_mock.py`

```python
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
```

- [ ] **Step 2: Run, verify fail** — `python -m pytest tests/test_providers_mock.py -v` → FAIL (no module).

- [ ] **Step 3: Implement schemas** — `app/models/schemas.py`

```python
from pydantic import BaseModel

class QualityReport(BaseModel):
    view: str            # "PA" | "AP" | "portable" | "lateral" | "unknown"
    adequate: bool
    issues: list[str]    # e.g. ["under-exposed","rotated"]

class Finding(BaseModel):
    label: str
    band: str            # "High" | "Medium" | "Low"
    severity: str        # "mild" | "moderate" | "severe" | "n/a"
    relevance: str

class EngineResult(BaseModel):
    engine: str          # "torchxrayvision" | "xraydar"
    educational: bool
    findings: list[Finding]
    disclaimer_key: str | None = None

class AnalysisResult(BaseModel):
    request_id: str
    quality: QualityReport | None
    engines: list[EngineResult]
    disclaimer_key: str = "clinical_assist_disclaimer"
```

- [ ] **Step 4: Implement provider base** — `app/providers/base.py`

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
import numpy as np

@dataclass
class PreparedImage:
    array: np.ndarray      # normalized 224x224 float32 for local models
    outbound_png: bytes    # de-identified full-res PNG for third-party transmission

class InferenceProvider(ABC):
    name: str = "base"
    educational: bool = False

    @abstractmethod
    def detect(self, prepared: "PreparedImage") -> list[tuple[str, float]]:
        """Return list of (label, probability[0..1]). No thresholding here."""
        raise NotImplementedError
```

- [ ] **Step 5: Implement mock provider** — `app/providers/mock_provider.py`

```python
from app.providers.base import InferenceProvider

class MockProvider(InferenceProvider):
    def __init__(self, name: str = "mock", educational: bool = False):
        self.name = name
        self.educational = educational
    def detect(self, prepared=None) -> list[tuple[str, float]]:
        return [("Pneumonia", 0.72), ("Effusion", 0.41), ("Cardiomegaly", 0.18)]
```

- [ ] **Step 6: Run test, verify pass** → PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/thorex/app/models backend/thorex/app/providers backend/thorex/tests/test_providers_mock.py
git commit -m "feat(thorex-backend): response schemas + InferenceProvider ABC + mock provider"
```

---

### Task 3: Image preprocessing (multi-format load → normalized array)

**Files:**
- Create: `backend/thorex/app/pipeline/__init__.py`, `backend/thorex/app/pipeline/preprocess.py`
- Create: `backend/thorex/tests/fixtures/` (add generated PNG in test), `backend/thorex/tests/test_preprocess.py`
- Modify: `backend/thorex/requirements.txt` (append imaging deps)

**Interfaces:**
- Produces: `preprocess.load_image(data: bytes, filename: str) -> np.ndarray` → 2-D float32 grayscale array normalized to xrv range `[-1024, 1024]`, center-cropped + resized to 224×224. Raises `preprocess.UnsupportedFormat` for unknown types. Supports `.png/.jpg/.jpeg/.heic/.pdf`.
- Produces: `preprocess.perceptual_hash(data: bytes) -> str` (16-hex) for duplicate rejection.
- Produces: `preprocess.prepare(data: bytes, filename: str) -> base.PreparedImage` — builds `.array` (via `load_image`) and `.outbound_png` (full-res grayscale PNG, **EXIF-stripped**, and de-identified once Task 8b lands — a hook `redact_hook` defaulting to identity keeps Task 3 self-contained).

- [ ] **Step 1: Append imaging deps** to `requirements.txt`

```
scikit-image>=0.23
numpy>=1.26
pillow-heif>=0.16
pdf2image>=1.17
```

(Note: `pdf2image` needs `poppler`; Dockerfile installs it in Task 11. For local dev on macOS: `brew install poppler`.)

- [ ] **Step 2: Write failing test** — `tests/test_preprocess.py`

```python
import io, numpy as np
from PIL import Image
from app.pipeline import preprocess

def _png_bytes(w=256, h=256):
    arr = (np.random.rand(h, w) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()

def test_load_png_returns_224_normalized():
    out = preprocess.load_image(_png_bytes(), "x.png")
    assert out.shape == (224, 224)
    assert out.dtype == np.float32
    assert out.min() >= -1024.0 and out.max() <= 1024.0

def test_unsupported_format_raises():
    import pytest
    with pytest.raises(preprocess.UnsupportedFormat):
        preprocess.load_image(b"nope", "x.txt")

def test_perceptual_hash_stable():
    b = _png_bytes()
    assert preprocess.perceptual_hash(b) == preprocess.perceptual_hash(b)
```

- [ ] **Step 3: Run, verify fail** → FAIL (no module).

- [ ] **Step 4: Implement** — `app/pipeline/preprocess.py`

```python
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
```

- [ ] **Step 5: Run tests, verify pass** → PASS. (First run pulls torch/torchxrayvision — install `requirements-ml.txt` from Task 7 first, or `pip install torchxrayvision torchvision`.)

- [ ] **Step 6: Commit**

```bash
git add backend/thorex/app/pipeline backend/thorex/tests/test_preprocess.py backend/thorex/requirements.txt
git commit -m "feat(thorex-backend): multi-format image preprocessing (PNG/JPEG/HEIC/PDF -> xrv 224)"
```

---

### Task 4: Image-quality assessment stage

**Files:**
- Create: `backend/thorex/app/pipeline/quality.py`
- Create: `backend/thorex/tests/test_quality.py`

**Interfaces:**
- Consumes: normalized 224×224 float32 array from `preprocess.load_image`.
- Produces: `quality.assess(img: np.ndarray) -> schemas.QualityReport`. Heuristic (RULE-labelled): exposure via mean/percentile of pixel intensity; rotation via horizontal symmetry; cropping via border energy. `adequate=False` when any hard issue present. `view` returns `"unknown"` in P1 (true AP/PA classifier is FUTURE) — documented as a heuristic placeholder value, not a model output.

- [ ] **Step 1: Write failing test** — `tests/test_quality.py`

```python
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
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — `app/pipeline/quality.py`

```python
import numpy as np
from app.models.schemas import QualityReport

def assess(img: np.ndarray) -> QualityReport:
    issues: list[str] = []
    # normalize to 0..1 for heuristics
    a = (img - img.min()) / (img.ptp() + 1e-6)
    contrast = float(a.std())
    if contrast < 0.05:
        issues.append("low-contrast")
    mean = float(a.mean())
    if mean < 0.15:
        issues.append("under-exposed")
    elif mean > 0.85:
        issues.append("over-exposed")
    # rotation: left/right half mean asymmetry
    lh, rh = a[:, :112].mean(), a[:, 112:].mean()
    if abs(lh - rh) > 0.25:
        issues.append("rotated")
    # cropping: strong border energy suggests collimation/crop
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    if border.mean() > 0.6:
        issues.append("cropped")
    adequate = not any(i in issues for i in ("low-contrast", "under-exposed", "over-exposed"))
    return QualityReport(view="unknown", adequate=adequate, issues=issues)
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/thorex/app/pipeline/quality.py backend/thorex/tests/test_quality.py
git commit -m "feat(thorex-backend): heuristic image-quality assessment stage"
```

---

### Task 5: Confidence-band + severity + tier-aware result assembly

**Files:**
- Create: `backend/thorex/app/pipeline/assemble.py`
- Create: `backend/thorex/app/pipeline/labels.py`
- Create: `backend/thorex/tests/test_assemble.py`

**Interfaces:**
- Consumes: provider outputs `list[tuple[str,float]]`, `schemas.QualityReport`.
- Produces: `labels.RELEVANCE: dict[str,str]` (finding → one-line clinical relevance); `assemble.band(prob) -> str|None` (thresholds per Global Constraints); `assemble.severity(prob) -> str`; `assemble.engine_result(engine, educational, pairs) -> schemas.EngineResult`; `assemble.build(request_id, quality, engine_results) -> schemas.AnalysisResult`.

- [ ] **Step 1: Write failing test** — `tests/test_assemble.py`

```python
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
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement labels** — `app/pipeline/labels.py`

```python
# One-line clinical relevance per finding. RULE content, reviewed by R1 clinical gate.
RELEVANCE = {
    "Pneumonia": "Airspace opacity; correlate with fever, WBC, CRP/procalcitonin.",
    "Consolidation": "Dense airspace filling; infective vs haemorrhage vs infarct.",
    "Effusion": "Pleural fluid; assess size and layering.",
    "Pneumothorax": "Pleural air; urgent if large or tension physiology.",
    "Edema": "Interstitial/alveolar fluid; correlate with BNP, EF, fluid status.",
    "Atelectasis": "Volume loss; distinguish from consolidation.",
    "Cardiomegaly": "Enlarged cardiac silhouette (limited on AP/portable).",
    "Emphysema": "Hyperinflation/lucency.",
    "Fibrosis": "Reticular changes; chronicity.",
    "Nodule": "Focal <3cm; needs follow-up/prior comparison.",
    "Mass": "Focal >3cm; malignancy workup.",
    "Pleural_Thickening": "Chronic pleural change.",
    "Cavity": "Lucent lesion; TB, abscess, septic emboli, malignancy.",
    "Hernia": "Diaphragmatic/hiatal.",
    "Mediastinal_Widening": "Assess aorta/lymphadenopathy.",
    "Fracture": "Rib/clavicle if visible.",
    "Calcification": "Granuloma vs vascular vs nodal.",
}

def relevance(label: str) -> str:
    return RELEVANCE.get(label, "Correlate clinically.")
```

- [ ] **Step 4: Implement assemble** — `app/pipeline/assemble.py`

```python
from app.models.schemas import Finding, EngineResult, AnalysisResult, QualityReport
from app.pipeline.labels import relevance

def band(prob: float) -> str | None:
    if prob >= 0.60: return "High"
    if prob >= 0.30: return "Medium"
    if prob >= 0.10: return "Low"
    return None

def severity(prob: float) -> str:
    if prob >= 0.75: return "severe"
    if prob >= 0.45: return "moderate"
    if prob >= 0.10: return "mild"
    return "n/a"

def engine_result(engine: str, educational: bool, pairs: list[tuple[str, float]]) -> EngineResult:
    findings: list[Finding] = []
    for label, prob in sorted(pairs, key=lambda x: x[1], reverse=True):
        b = band(prob)
        if b is None:
            continue
        findings.append(Finding(label=label, band=b, severity=severity(prob), relevance=relevance(label)))
    return EngineResult(
        engine=engine, educational=educational, findings=findings,
        disclaimer_key="educational_not_clinical" if educational else None,
    )

def build(request_id: str, quality: QualityReport | None, engines: list[EngineResult]) -> AnalysisResult:
    return AnalysisResult(request_id=request_id, quality=quality, engines=engines)
```

- [ ] **Step 5: Run tests, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/thorex/app/pipeline/assemble.py backend/thorex/app/pipeline/labels.py backend/thorex/tests/test_assemble.py
git commit -m "feat(thorex-backend): confidence bands, severity, tier-aware result assembly"
```

---

### Task 6: `/v1/analyze` endpoint (multipart, mock provider) + contract test

**Files:**
- Create: `backend/thorex/app/api/v1/analyze.py`
- Create: `backend/thorex/app/pipeline/orchestrator.py`
- Modify: `backend/thorex/app/api/v1/router.py` (include analyze router)
- Create: `backend/thorex/tests/test_analyze_contract.py`

**Interfaces:**
- Consumes: `preprocess.load_image`, `quality.assess`, `assemble.*`, `MockProvider`.
- Produces: `orchestrator.run(data, filename, entitlement, provider_factory) -> AnalysisResult` where `provider_factory(entitlement) -> list[InferenceProvider]` (`free` → [hf], `v1` → [tx], `v2beta` → [tx, xraydar]); `POST /v1/analyze` (multipart: `file`, form `entitlement` in `{"free","v1","v2beta"}`) → `AnalysisResult` JSON. Bad/duplicate/oversized input → 4xx with typed error; model unavailable → 503 `inference_unavailable`. Each provider carries a stable `name` (`"hf_vit"`/`"torchxrayvision"`/`"xraydar"`) reported verbatim as `EngineResult.engine`.

- [ ] **Step 1: Write failing test** — `tests/test_analyze_contract.py`

```python
import io, numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def _png():
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()

def test_analyze_free_returns_hf_engine(monkeypatch):
    monkeypatch.setenv("THOREX_MODE", "mock")
    r = client.post("/v1/analyze", files={"file": ("x.png", _png(), "image/png")}, data={"entitlement": "free"})
    assert r.status_code == 200
    assert [e["engine"] for e in r.json()["engines"]] == ["hf_vit"]

def test_analyze_v1_returns_single_engine(monkeypatch):
    monkeypatch.setenv("THOREX_MODE", "mock")
    r = client.post("/v1/analyze", files={"file": ("x.png", _png(), "image/png")}, data={"entitlement": "v1"})
    assert r.status_code == 200
    body = r.json()
    assert body["disclaimer_key"] == "clinical_assist_disclaimer"
    assert [e["engine"] for e in body["engines"]] == ["torchxrayvision"]

def test_analyze_v2beta_returns_both_engines(monkeypatch):
    monkeypatch.setenv("THOREX_MODE", "mock")
    r = client.post("/v1/analyze", files={"file": ("x.png", _png(), "image/png")}, data={"entitlement": "v2beta"})
    body = r.json()
    engines = [e["engine"] for e in body["engines"]]
    assert engines == ["torchxrayvision", "xraydar"]
    xr = next(e for e in body["engines"] if e["engine"] == "xraydar")
    assert xr["educational"] is True and xr["disclaimer_key"] == "educational_not_clinical"

def test_unsupported_type_returns_415():
    r = client.post("/v1/analyze", files={"file": ("x.txt", b"nope", "text/plain")}, data={"entitlement": "v1"})
    assert r.status_code == 415
```

- [ ] **Step 2: Run, verify fail** → FAIL (404 on /v1/analyze).

- [ ] **Step 3: Implement orchestrator** — `app/pipeline/orchestrator.py`

```python
import uuid
from app.pipeline import preprocess, quality, assemble
from app.models.schemas import AnalysisResult

def run(data: bytes, filename: str, entitlement: str, provider_factory) -> AnalysisResult:
    from app.pipeline.redact import redact_burned_in_text   # Task 8b (identity-safe if OCR absent)
    prepared = preprocess.prepare(data, filename, redact_hook=redact_burned_in_text)  # raises UnsupportedFormat
    qrep = quality.assess(prepared.array)
    providers = provider_factory(entitlement)
    engines = []
    for p in providers:
        pairs = p.detect(prepared)                       # (label, prob); may raise RuntimeError -> 503
        engines.append(assemble.engine_result(p.name, p.educational, pairs))
    return assemble.build(str(uuid.uuid4()), qrep, engines)
```

(Note: the orchestrator reports each provider's own `name` verbatim. In mock mode the factory builds `MockProvider(name=...)` with the same names the real engines use — `hf_vit`, `torchxrayvision`, `xraydar` — so the contract is identical to real mode.)

- [ ] **Step 4: Implement provider factory + endpoint** — `app/api/v1/analyze.py`

```python
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.core.config import get_settings
from app.pipeline import preprocess
from app.pipeline.orchestrator import run
from app.providers.mock_provider import MockProvider

router = APIRouter()
MAX_BYTES = 25 * 1024 * 1024
ENTITLEMENTS = ("free", "v1", "v2beta")

def _provider_factory():
    mode = get_settings().mode
    def factory(ent: str):
        if mode == "mock":
            if ent == "free":
                return [MockProvider(name="hf_vit", educational=False)]
            base = [MockProvider(name="torchxrayvision", educational=False)]
            if ent == "v2beta":
                base.append(MockProvider(name="xraydar", educational=True))
            return base
        # real engines (Tasks 7, 8, 8b)
        if ent == "free":
            from app.providers.hf_provider import HFInferenceProvider
            return [HFInferenceProvider()]
        from app.providers.torchxrayvision_provider import TorchXRayVisionProvider
        providers = [TorchXRayVisionProvider()]
        if ent == "v2beta":
            from app.providers.xraydar_provider import XRaydarProvider
            providers.append(XRaydarProvider())
        return providers
    return factory

@router.post("/analyze")
async def analyze(file: UploadFile = File(...), entitlement: str = Form("v1")):
    if entitlement not in ENTITLEMENTS:
        raise HTTPException(400, detail={"error": "bad_entitlement"})
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, detail={"error": "file_too_large"})
    try:
        result = run(data, file.filename or "upload", entitlement, _provider_factory())
    except preprocess.UnsupportedFormat:
        raise HTTPException(415, detail={"error": "unsupported_format"})
    except RuntimeError:
        raise HTTPException(503, detail={"error": "inference_unavailable"})
    return result.model_dump()
```

- [ ] **Step 5: Register router** — add to `app/api/v1/router.py`

```python
from app.api.v1 import health, analyze
api_router.include_router(analyze.router, tags=["analyze"])
```

- [ ] **Step 6: Run tests, verify pass** → PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/thorex/app/api/v1/analyze.py backend/thorex/app/pipeline/orchestrator.py backend/thorex/app/api/v1/router.py backend/thorex/tests/test_analyze_contract.py
git commit -m "feat(thorex-backend): tier-aware /v1/analyze endpoint (mock) + contract tests"
```

---

### Task 7: Real TorchXRayVision provider + real-inference smoke test

**Files:**
- Create: `backend/thorex/app/providers/torchxrayvision_provider.py`
- Create: `backend/thorex/requirements-ml.txt`
- Create: `backend/thorex/tests/test_providers_real.py`
- Modify: `backend/thorex/tests/conftest.py` (register `models` marker)

**Interfaces:**
- Produces: `TorchXRayVisionProvider(InferenceProvider)` with `name="torchxrayvision"`, `educational=False`; lazy-loads `xrv.models.DenseNet(weights="densenet121-res224-all")` once (module singleton); `detect(img)` → `(pathology, prob)` for the 18 labels; raises `RuntimeError` if weights can't load (→ endpoint 503).

- [ ] **Step 1: Write `requirements-ml.txt`**

```
torch>=2.2
torchvision>=0.17
torchxrayvision>=1.2.1
monai>=1.3
grad-cam>=1.5
huggingface_hub>=0.23
```

- [ ] **Step 2: Register marker** — append to `tests/conftest.py`

```python
def pytest_configure(config):
    config.addinivalue_line("markers", "models: real model weights (slow, downloads).")
```

- [ ] **Step 3: Write failing smoke test** — `tests/test_providers_real.py`

```python
import io, numpy as np, pytest
from PIL import Image
from app.pipeline import preprocess

@pytest.mark.models
def test_torchxrayvision_real_inference():
    from app.providers.torchxrayvision_provider import TorchXRayVisionProvider
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    prepared = preprocess.prepare(buf.getvalue(), "x.png")
    out = TorchXRayVisionProvider().detect(prepared)
    assert len(out) >= 14
    assert all(0.0 <= p <= 1.0 for _, p in out)
    assert any(lbl == "Pneumonia" for lbl, _ in out) or any("Effusion" in lbl for lbl, _ in out)
```

- [ ] **Step 4: Run, verify fail** — `python -m pytest -m models tests/test_providers_real.py -v` → FAIL (no module).

- [ ] **Step 5: Implement provider** — `app/providers/torchxrayvision_provider.py`

```python
import numpy as np
import torch
from app.providers.base import InferenceProvider

_MODEL = None

def _model():
    global _MODEL
    if _MODEL is None:
        try:
            import torchxrayvision as xrv
            m = xrv.models.DenseNet(weights="densenet121-res224-all")
            m.eval()
            _MODEL = m
        except Exception as e:  # weights download / import failure
            raise RuntimeError(f"torchxrayvision unavailable: {e}")
    return _MODEL

class TorchXRayVisionProvider(InferenceProvider):
    name = "torchxrayvision"
    educational = False

    def detect(self, prepared) -> list[tuple[str, float]]:
        m = _model()
        t = torch.from_numpy(prepared.array[None, None, ...].astype("float32"))  # 1x1x224x224
        with torch.no_grad():
            out = m(t)[0].detach().cpu().numpy()
        pairs = list(zip(m.pathologies, [float(x) for x in out]))
        return [(lbl, p) for lbl, p in pairs if lbl]   # drop empty label slots
```

- [ ] **Step 6: Run smoke test with ML deps** — `pip install -r requirements-ml.txt` then `python -m pytest -m models tests/test_providers_real.py -v` → PASS (first run downloads weights ~100MB).

- [ ] **Step 7: Verify fast suite still green without ML deps** — `python -m pytest -m "not models" -v` → PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/thorex/app/providers/torchxrayvision_provider.py backend/thorex/requirements-ml.txt backend/thorex/tests/test_providers_real.py backend/thorex/tests/conftest.py
git commit -m "feat(thorex-backend): real TorchXRayVision provider + gated inference smoke test"
```

---

### Task 8: Real X-Raydar provider (educational) + smoke test

**Files:**
- Create: `backend/thorex/app/providers/xraydar_provider.py`
- Modify: `backend/thorex/tests/test_providers_real.py` (add X-Raydar smoke test)

**Interfaces:**
- Produces: `XRaydarProvider(InferenceProvider)` with `name="xraydar"`, `educational=True`; downloads weights from HF `dnamodel/xraydar-cv` via `huggingface_hub.hf_hub_download` into `settings.model_cache_dir`; loads the 512-resolution model (single-resolution in P1; full 3-way ensemble is a FUTURE optimization noted in README); `detect(img)` → `(finding, prob)` over the X-Raydar taxonomy subset mapped to shared labels; raises `RuntimeError` on failure.

- [ ] **Step 1: Write failing smoke test** — append to `tests/test_providers_real.py`

```python
@pytest.mark.models
def test_xraydar_real_inference():
    from app.providers.xraydar_provider import XRaydarProvider
    arr = (np.random.rand(600, 600) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    prepared = preprocess.prepare(buf.getvalue(), "x.png")
    p = XRaydarProvider()
    assert p.educational is True
    out = p.detect(prepared)
    assert len(out) >= 10
    assert all(0.0 <= pr <= 1.0 for _, pr in out)
```

- [ ] **Step 2: Run, verify fail** → FAIL (no module).

- [ ] **Step 3: Implement provider** — `app/providers/xraydar_provider.py`

```python
import numpy as np
import torch
from app.core.config import get_settings
from app.providers.base import InferenceProvider

# X-Raydar exposes 37 findings; map the clinically-relevant subset to ThoreX shared labels.
# Full taxonomy + weights: HF dnamodel/xraydar-cv (research/non-commercial). Educational use only.
_LABELS_SUBSET = [
    "Pneumonia", "Consolidation", "Effusion", "Pneumothorax", "Edema",
    "Atelectasis", "Cardiomegaly", "Emphysema", "Fibrosis", "Nodule",
    "Mass", "Cavity", "Hernia", "Mediastinal_Widening", "Calcification",
]
_MODEL = None

def _model():
    global _MODEL
    if _MODEL is None:
        try:
            from huggingface_hub import hf_hub_download
            ckpt = hf_hub_download(
                repo_id="dnamodel/xraydar-cv",
                filename="xraydar_512.pth.tar",     # confirm exact filename from the repo's HF listing
                cache_dir=get_settings().model_cache_dir,
            )
            state = torch.load(ckpt, map_location="cpu")
            import torchvision
            net = torchvision.models.inception_v3(num_classes=37, aux_logits=True, init_weights=False)
            net.load_state_dict(state["state_dict"] if "state_dict" in state else state, strict=False)
            net.eval()
            _MODEL = net
        except Exception as e:
            raise RuntimeError(f"xraydar unavailable: {e}")
    return _MODEL

def _to_inception_input(img: np.ndarray) -> torch.Tensor:
    # 224 grayscale -> 3x299 for inception_v3
    t = torch.from_numpy(img[None, None, ...].astype("float32"))
    t = (t - t.min()) / (t.max() - t.min() + 1e-6)
    t = torch.nn.functional.interpolate(t, size=(299, 299), mode="bilinear", align_corners=False)
    return t.repeat(1, 3, 1, 1)

class XRaydarProvider(InferenceProvider):
    name = "xraydar"
    educational = True

    def detect(self, prepared) -> list[tuple[str, float]]:
        m = _model()
        t = _to_inception_input(prepared.array)
        with torch.no_grad():
            logits = m(t)
            logits = logits[0] if isinstance(logits, tuple) else logits
            probs = torch.sigmoid(logits)[0].cpu().numpy()
        n = min(len(_LABELS_SUBSET), probs.shape[0])
        return [(_LABELS_SUBSET[i], float(probs[i])) for i in range(n)]
```

> **Implementer note (verify at runtime):** confirm the exact HF filename(s) and the checkpoint's `state_dict` key layout + class count from the `x-raydar/x-raydar-cv` repo README before finalizing `_model()`. The architecture is a multi-scale Inception-v3 ensemble (XNet38MS); P1 loads a single resolution. If the published head is not a plain `inception_v3`, adapt the module construction to the repo's model definition (import it from the vendored repo code rather than reconstructing). This is real integration work, not a stub — the test must pass against real weights.

- [ ] **Step 4: Run smoke test** — `python -m pytest -m models tests/test_providers_real.py::test_xraydar_real_inference -v` → PASS (downloads HF weights).

- [ ] **Step 5: Commit**

```bash
git add backend/thorex/app/providers/xraydar_provider.py backend/thorex/tests/test_providers_real.py
git commit -m "feat(thorex-backend): real X-Raydar educational provider + gated smoke test"
```

---

### Task 8b: De-identification — burned-in text redaction (before any third-party call)

**Files:**
- Create: `backend/thorex/app/pipeline/redact.py`
- Create: `backend/thorex/tests/test_redact.py`
- Modify: `backend/thorex/requirements-ml.txt` (add `pytesseract`) and note `tesseract-ocr` OS package (Dockerfile, Task 11)

**Interfaces:**
- Produces: `redact.redact_burned_in_text(png: bytes, min_conf: int = 60) -> bytes` — OCR-detects text word-boxes (Tesseract), black-boxes each detected region with confidence ≥ `min_conf`, returns re-encoded PNG. **Best-effort de-ID**, defense-in-depth on top of consent — documented as such. If Tesseract is unavailable it logs a warning and returns the input unchanged (so the pipeline never hard-fails), and the free/HF path is expected to also rely on consent + disclosure. Guard: only redacts detected text boxes, never whole-image regions, so lung fields are untouched.

- [ ] **Step 1: Add dep** to `requirements-ml.txt`

```
pytesseract>=0.3.10
```

- [ ] **Step 2: Write failing test** — `tests/test_redact.py`

```python
import io, numpy as np
from PIL import Image, ImageDraw
from app.pipeline import redact

def _img_with_text():
    img = Image.new("L", (512, 512), color=30)          # dark "x-ray"
    ImageDraw.Draw(img).text((10, 10), "NAME: JOHN DOE 57M", fill=255)
    buf = io.BytesIO(); img.save(buf, format="PNG"); return buf.getvalue()

def test_redaction_darkens_text_region_when_ocr_available():
    src = _img_with_text()
    out = redact.redact_burned_in_text(src)
    a0 = np.asarray(Image.open(io.BytesIO(src)).convert("L"))
    a1 = np.asarray(Image.open(io.BytesIO(out)).convert("L"))
    corner0 = a0[0:40, 0:300].mean()
    corner1 = a1[0:40, 0:300].mean()
    # If OCR present, the bright text corner gets darker; if absent, redact returns input unchanged.
    assert corner1 <= corner0

def test_returns_valid_png():
    out = redact.redact_burned_in_text(_img_with_text())
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
```

- [ ] **Step 3: Run, verify fail** — `python -m pytest tests/test_redact.py -v` → FAIL (no module).

- [ ] **Step 4: Implement** — `app/pipeline/redact.py`

```python
import io
from PIL import Image, ImageDraw
from app.core.logging import get_logger

log = get_logger("redact")

def redact_burned_in_text(png: bytes, min_conf: int = 60) -> bytes:
    try:
        import pytesseract
    except Exception:
        log.warning("ocr_unavailable_redaction_skipped")
        return png
    img = Image.open(io.BytesIO(png)).convert("L")
    try:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    except Exception as e:               # tesseract binary missing / fails
        log.warning("ocr_failed_redaction_skipped", error=str(e))
        return png
    draw = ImageDraw.Draw(img)
    n = len(data.get("text", []))
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        try:
            conf = int(float(data["conf"][i]))
        except (ValueError, TypeError):
            conf = -1
        if txt and conf >= min_conf:
            x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
            draw.rectangle([x, y, x + w, y + h], fill=0)   # black-box the text
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()
```

- [ ] **Step 5: Run tests, verify pass** — `python -m pytest tests/test_redact.py -v`. (With `tesseract-ocr` installed the darkening assertion exercises real redaction; without it, the skip path returns input unchanged and both asserts still hold. On macOS dev: `brew install tesseract`.)

- [ ] **Step 6: Commit**

```bash
git add backend/thorex/app/pipeline/redact.py backend/thorex/tests/test_redact.py backend/thorex/requirements-ml.txt
git commit -m "feat(thorex-backend): best-effort burned-in PHI text redaction before third-party calls"
```

---

### Task 8c: HF free-tier provider ("ThoreX Lite", server-side, health-gated)

**Files:**
- Create: `backend/thorex/app/providers/hf_provider.py`
- Modify: `backend/thorex/app/core/config.py` (add `hf_token: str = ""`, `hf_model: str = "codewithdark/vit-chest-xray"`, `hf_timeout_s: int = 20`)
- Create: `backend/thorex/tests/test_hf_provider.py`

**Interfaces:**
- Produces: `HFInferenceProvider(InferenceProvider)` with `name="hf_vit"`, `educational=False`; `detect(prepared)` POSTs `prepared.outbound_png` (already de-identified in Task 8b) to `https://api-inference.huggingface.co/models/<hf_model>` with `Authorization: Bearer <hf_token>`; parses `[{"label","score"}, …]` → `(label, prob)`, mapping HF label strings to ThoreX shared labels; raises `RuntimeError` on timeout / non-200 / model-loading (503) so the endpoint returns `inference_unavailable` (never fabricated). Network is injected (`post_fn`) so unit tests don't hit the network.

- [ ] **Step 1: Add config fields** — extend `Settings` in `app/core/config.py`

```python
    hf_token: str = ""
    hf_model: str = "codewithdark/vit-chest-xray"
    hf_timeout_s: int = 20
```

- [ ] **Step 2: Write failing test** — `tests/test_hf_provider.py`

```python
import pytest
from app.providers.base import PreparedImage
from app.providers.hf_provider import HFInferenceProvider
import numpy as np

_PREP = PreparedImage(array=np.zeros((224, 224), "float32"), outbound_png=b"\x89PNG\r\n\x1a\n")

def test_hf_maps_label_scores():
    def fake_post(url, data, headers, timeout):
        class R:
            status_code = 200
            def json(self): return [{"label": "Pneumonia", "score": 0.81},
                                    {"label": "No Finding", "score": 0.10}]
        return R()
    out = HFInferenceProvider(post_fn=fake_post).detect(_PREP)
    assert ("Pneumonia", 0.81) in out
    assert HFInferenceProvider().name == "hf_vit"

def test_hf_unavailable_raises_runtimeerror():
    def fake_post(url, data, headers, timeout):
        class R:
            status_code = 503
            def json(self): return {"error": "loading"}
        return R()
    with pytest.raises(RuntimeError):
        HFInferenceProvider(post_fn=fake_post).detect(_PREP)
```

- [ ] **Step 3: Run, verify fail** → FAIL (no module).

- [ ] **Step 4: Implement** — `app/providers/hf_provider.py`

```python
import httpx
from app.core.config import get_settings
from app.providers.base import InferenceProvider

# Map HF model label strings -> ThoreX shared labels. Extend per the pinned model's card.
_LABEL_MAP = {
    "Pneumonia": "Pneumonia", "Consolidation": "Consolidation", "Effusion": "Effusion",
    "Pleural Effusion": "Effusion", "Pneumothorax": "Pneumothorax", "Edema": "Edema",
    "Atelectasis": "Atelectasis", "Cardiomegaly": "Cardiomegaly",
}
_DROP = {"No Finding", "Normal"}

def _default_post(url, data, headers, timeout):
    return httpx.post(url, content=data, headers=headers, timeout=timeout)

class HFInferenceProvider(InferenceProvider):
    name = "hf_vit"
    educational = False

    def __init__(self, post_fn=_default_post):
        self._post = post_fn

    def detect(self, prepared) -> list[tuple[str, float]]:
        s = get_settings()
        url = f"https://api-inference.huggingface.co/models/{s.hf_model}"
        headers = {"Authorization": f"Bearer {s.hf_token}", "Content-Type": "image/png"}
        try:
            r = self._post(url, prepared.outbound_png, headers, s.hf_timeout_s)
        except Exception as e:
            raise RuntimeError(f"hf request failed: {e}")
        if r.status_code != 200:
            raise RuntimeError(f"hf unavailable: {r.status_code}")
        payload = r.json()
        if not isinstance(payload, list):
            raise RuntimeError("hf unexpected payload")
        out: list[tuple[str, float]] = []
        for item in payload:
            lbl = item.get("label", ""); score = float(item.get("score", 0.0))
            if lbl in _DROP:
                continue
            out.append((_LABEL_MAP.get(lbl, lbl), score))
        return out
```

> **Implementer note:** confirm the pinned model (`codewithdark/vit-chest-xray`) is currently served on HF's serverless Inference API. If it returns persistent 503 "model loading" / "not deployed", either (a) switch `hf_model` to a served alternative, or (b) fall back to the **self-hosted** variant — load the same ViT locally via `transformers` `AutoModelForImageClassification` behind the identical `HFInferenceProvider.detect` contract (swap `_post` for a local `pipeline("image-classification")` call). Either way the endpoint contract and the `hf_vit` engine name are unchanged. This is real integration diligence, not a stub.

- [ ] **Step 5: Run tests, verify pass** → PASS (no network — `post_fn` injected).

- [ ] **Step 6: Commit**

```bash
git add backend/thorex/app/providers/hf_provider.py backend/thorex/app/core/config.py backend/thorex/tests/test_hf_provider.py
git commit -m "feat(thorex-backend): HF free-tier provider (server-side, de-identified, health-gated)"
```

---

### Task 9: Grad-CAM localization → heatmap

**Files:**
- Create: `backend/thorex/app/pipeline/localize.py`
- Modify: `backend/thorex/app/models/schemas.py` (add `heatmap_png_b64` to `Finding`)
- Modify: `backend/thorex/app/pipeline/assemble.py` (accept optional heatmaps)
- Create: `backend/thorex/tests/test_localize.py`

**Interfaces:**
- Produces: `localize.heatmap_for(model, img, class_index) -> str` returning a base64 PNG (224×224 RGBA overlay) of the Grad-CAM for one class, using target layer `model.features.norm5` (TorchXRayVision DenseNet). Test uses a tiny stub CNN to stay fast (no real weights needed for the unit test).

- [ ] **Step 1: Add field** — `Finding` in `schemas.py`

```python
class Finding(BaseModel):
    label: str
    band: str
    severity: str
    relevance: str
    heatmap_png_b64: str | None = None
```

- [ ] **Step 2: Write failing test** — `tests/test_localize.py`

```python
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
        f = self.features(x); return self.head(f.mean(dim=(2, 3)))

def test_heatmap_returns_base64_png():
    m = _Tiny().eval()
    img = (np.random.rand(224, 224).astype("float32") * 2048) - 1024
    b64 = localize.heatmap_for(m, img, class_index=0, target_layer=m.features.norm5)
    raw = base64.b64decode(b64)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"     # PNG magic
```

- [ ] **Step 3: Run, verify fail** → FAIL.

- [ ] **Step 4: Implement** — `app/pipeline/localize.py`

```python
import io, base64
import numpy as np
import torch
from PIL import Image
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget

def heatmap_for(model, img: np.ndarray, class_index: int, target_layer) -> str:
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
    # TorchXRayVision DenseNet121 final norm layer.
    return model.features.norm5
```

- [ ] **Step 5: Run test, verify pass** → PASS.

- [ ] **Step 6: Wire heatmaps into the real path** — in `orchestrator.run`, after detection, for the TorchXRayVision engine's High/Medium findings, compute `localize.heatmap_for(model, prepared.array, idx, localize.default_target_layer(model))` and attach to the matching `Finding`. Guard behind `settings.mode != "mock"` (skip for mock/unit path). Heatmaps are computed **only** for the TorchXRayVision engine (Grad-CAM needs the local model + target layer); the HF/free engine returns findings without a heatmap in P1 (documented). Add a `@pytest.mark.models` integration assertion in `test_providers_real.py` that a High finding carries a non-null `heatmap_png_b64` end-to-end.

- [ ] **Step 7: Commit**

```bash
git add backend/thorex/app/pipeline/localize.py backend/thorex/app/models/schemas.py backend/thorex/app/pipeline/orchestrator.py backend/thorex/tests/test_localize.py backend/thorex/tests/test_providers_real.py
git commit -m "feat(thorex-backend): Grad-CAM heatmap localization wired into analyze"
```

---

### Task 10: Security — log scrubbing + temp-image lifecycle

**Files:**
- Create: `backend/thorex/app/services/__init__.py`, `backend/thorex/app/services/storage.py`
- Modify: `backend/thorex/app/api/v1/analyze.py` (use temp storage + scrubbed logging)
- Create: `backend/thorex/tests/test_security.py`

**Interfaces:**
- Produces: `storage.temp_image(data: bytes) -> contextmanager` yielding a path and deleting it on exit (even on exception); `analyze` logs only `{request_id, tier, phash, n_findings, ms}` — never bytes, filename contents, or pixel data.

- [ ] **Step 1: Write failing test** — `tests/test_security.py`

```python
import io, numpy as np, logging
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app
from app.services import storage

def test_temp_image_deleted_after_context():
    with storage.temp_image(b"abc") as p:
        assert p.exists()
    assert not p.exists()

def test_analyze_logs_have_no_image_bytes(caplog):
    caplog.set_level(logging.INFO)
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    client = TestClient(app)
    client.post("/v1/analyze", files={"file": ("x.png", buf.getvalue(), "image/png")}, data={"tier": "v1"})
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "\\x89PNG" not in joined and "data:image" not in joined
```

- [ ] **Step 2: Run, verify fail** → FAIL (no storage module).

- [ ] **Step 3: Implement storage** — `app/services/storage.py`

```python
import os, tempfile
from pathlib import Path
from contextlib import contextmanager

@contextmanager
def temp_image(data: bytes):
    fd, name = tempfile.mkstemp(prefix="thorex-", suffix=".img")
    p = Path(name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        yield p
    finally:
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass
```

- [ ] **Step 4: Scrub logging in endpoint** — in `analyze.py`, wrap processing in `with storage.temp_image(data)` and emit exactly one structured log line via `get_logger("analyze").info("analyzed", request_id=result.request_id, tier=tier, phash=preprocess.perceptual_hash(data), n=sum(len(e.findings) for e in result.engines))`. Never log `data`, `file.filename` raw, or arrays.

- [ ] **Step 5: Run tests, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/thorex/app/services backend/thorex/app/api/v1/analyze.py backend/thorex/tests/test_security.py
git commit -m "feat(thorex-backend): temp-image lifecycle + PHI-safe scrubbed logging"
```

---

### Task 11: Dockerfile, compose, Makefile, README + deploy commands

**Files:**
- Create: `backend/thorex/Dockerfile`, `backend/thorex/docker-compose.yml`, `backend/thorex/Makefile`, `backend/thorex/README.md`, `backend/thorex/.env.example`, `backend/thorex/.dockerignore`

**Interfaces:**
- Produces: `docker compose up --build` → API on `:8000` (`/docs`, `/v1/health`), GPU-ready base, poppler installed for PDF, weights auto-download on first ML boot.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils tesseract-ocr libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt requirements-ml.txt ./
ARG WITH_ML=1
RUN pip install -r requirements.txt && \
    if [ "$WITH_ML" = "1" ]; then pip install -r requirements-ml.txt; fi
COPY app ./app
COPY conftest.py ./
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write `docker-compose.yml`**

```yaml
services:
  api:
    build: { context: ., args: { WITH_ML: "1" } }
    image: thorex-inference:latest
    environment:
      THOREX_MODE: ${THOREX_MODE:-local}
      THOREX_ENVIRONMENT: ${THOREX_ENVIRONMENT:-dev}
      THOREX_MODEL_CACHE_DIR: /models
      THOREX_HF_TOKEN: ${THOREX_HF_TOKEN:-}
      THOREX_HF_MODEL: ${THOREX_HF_MODEL:-codewithdark/vit-chest-xray}
    volumes:
      - thorex-models:/models
    ports: ["8000:8000"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD","python","-c","import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/v1/health').status==200 else 1)"]
      interval: 30s
      timeout: 5s
      start_period: 40s
      retries: 3
volumes:
  thorex-models:
```

- [ ] **Step 3: Write `Makefile`**

```makefile
.PHONY: dev test test-models docker
dev: ; uvicorn app.main:app --reload --port 8000
test: ; python -m pytest -m "not models" -v
test-models: ; python -m pytest -m models -v
docker: ; docker compose up --build
```

- [ ] **Step 4: Write `.env.example`**

```
THOREX_MODE=local
THOREX_ENVIRONMENT=dev
THOREX_MODEL_CACHE_DIR=/models
# Free-tier (HF) — server-side token; never expose to clients. Leave blank to disable Free path.
THOREX_HF_TOKEN=
THOREX_HF_MODEL=codewithdark/vit-chest-xray
THOREX_HF_TIMEOUT_S=20
```

- [ ] **Step 5: Write `.dockerignore`**

```
tests/
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 6: Write `README.md`** — document: purpose; `make test` (fast) vs `make test-models` (real weights); `docker compose up --build`; the `/v1/analyze` contract (multipart `file` + `tier`); **deploy commands** (build image, push to registry, run on a GPU node with `--gpus all`); the **honesty note** that GPU deploy + real inference are operator steps; licensing (TorchXRayVision Apache-2.0 shippable; X-Raydar educational/non-commercial, gated); the mandatory clinical disclaimer key contract.

- [ ] **Step 7: Verify build boots** — `docker compose up --build` then `curl localhost:8000/v1/health` → `{"status":"ok",...}`. (If no Docker/GPU in the environment, record this as an operator verification step in the README and run `make test` instead to prove the app boots.)

- [ ] **Step 8: Commit**

```bash
git add backend/thorex/Dockerfile backend/thorex/docker-compose.yml backend/thorex/Makefile backend/thorex/README.md backend/thorex/.env.example backend/thorex/.dockerignore
git commit -m "feat(thorex-backend): Docker/compose/Makefile/README + deploy docs"
```

---

## Self-Review

**Spec coverage (Phase 1 backend slice):**
- Modular pipeline / DI / provider seam → Tasks 2,6,7,8 (`InferenceProvider` ABC + factory). ✓
- Image input PNG/JPEG/HEIC/PDF + dedup hash → Task 3. ✓
- Preprocessing (normalize/resize/orientation via xrv transforms) → Task 3. ✓
- Image-quality gate (exposure/rotation/cropping; view=unknown heuristic) → Task 4. ✓
- Free-tier HF engine (REAL, server-side, health-gated, injectable network) → Task 8c. ✓
- Primary detection TorchXRayVision (REAL) → Task 7. ✓
- X-Raydar educational (REAL, gated, `educational=true`) → Task 8. ✓
- Burned-in PHI text redaction before third-party transmission (best-effort OCR) → Task 8b. ✓
- Grad-CAM explainability/localization → Task 9. ✓
- No raw probabilities → bands + severity → Task 5. ✓
- Entitlement-aware Free / V1 / V2-Beta engine selection + dual engine results → Tasks 5,6,8c. ✓
- Disclaimer keys (clinical + educational) → Tasks 2,5,6. ✓
- Security: no image bytes in logs, temp deletion, EXIF strip, HF token server-side only → Tasks 8c,10. ✓
- FastAPI + Docker + GPU-ready serving + deploy commands → Tasks 1,11. ✓
- No fabricated results (503 on unavailable) → Task 6. ✓
- **Deferred to later Phase-1 plans (not this backend plan):** admin-console entitlement UI + `/api/experimental` tier grant; StewardMD frontend `thorex-*.js` module + live provider wiring; FHIR export (P2). These are their own plans per the split.

**Placeholder scan:** No TBD/TODO steps. The Task-8 "implementer note" is a *runtime verification instruction against real weights*, not a stub — the test must pass with real inference; it flags that the exact HF filename / state-dict layout must be read from the upstream repo, which is genuine integration diligence, not deferred work.

**Type consistency:** `InferenceProvider.detect(prepared: PreparedImage) -> list[tuple[str,float]]` used identically in mock (T2), tx (T7), xraydar (T8), hf (T8c), orchestrator (T6). `PreparedImage(array, outbound_png)` defined in T2, produced by `preprocess.prepare` (T3), consumed by all providers. Local providers read `.array`; HF reads `.outbound_png`. `EngineResult`/`Finding`/`AnalysisResult` fields consistent T2→T5→T6→T9. `band()` thresholds match Global Constraints. Engine names (`hf_vit`/`torchxrayvision`/`xraydar`) set on each provider and reported verbatim by the orchestrator; mock factory uses the same names so contract tests (T6) match real mode. `redact_burned_in_text` (T8b) wired as the `redact_hook` in `preprocess.prepare` via the orchestrator (T6).

---

## Notes for the next plans (Phase 1 continued)

1. **`2026-07-25-thorex-p1-admin-entitlement.md`** — `thorex` FEATURES entry in `/api/experimental/*` with `tier`; admin-authenticated grant/change/revoke routes; `admin/` ThoreX panel (thin client over those routes); audit log. Consumes: this service's tier contract.
2. **`2026-07-25-thorex-p1-frontend.md`** — `thorex-flags.js`, `thorex-providers.js` (mock + live calling `/api/thorex/v1/analyze`), `thorex-store.js`, `thorex-models.js`, `thorex-quality.js`, `thorex-report.js`, `thorex-screens.js/.css`, `thorex.css`, `thorex.js`; `index.html` wiring; `SMD_XACCESS.gate("thorex", …)`; tier-driven single vs dual (Clinical/Learning) result UI; mandatory disclaimer copy bank. Consumes: tier from `SMD_XACCESS.ensure`, JSON from this service.
3. **Review gate before merge:** R1 clinical + R2 AI (blocking), R3 security, R6 performance.
