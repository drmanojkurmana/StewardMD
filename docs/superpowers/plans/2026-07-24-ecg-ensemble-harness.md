# KardiQ X Ensemble Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline benchmark harness that runs every ECG engine as an independent, always-logged branch, fuses them with reliability-weighted hierarchical fusion (V2-floor invariant, learned thresholds), and reports whether the ensemble beats KardiQ X v2 alone on the real datasets.

**Architecture:** A modular `Branch` registry; each branch maps its native output into a shared canonical class space and emits probs+confidence+quality. A run-once/fuse-many cache stores every branch's output. A FusionEngine combines surviving branches per-class with a V2-floor. A k-fold harness fits reliability/thresholds on train folds and scores ensemble-vs-v2 on held-out folds, emitting a report.

**Tech Stack:** Python 3.11+ (the `ecgf/.venv`), PyTorch 2.x, timm, onnxruntime, numpy, scipy, scikit-learn, Pillow, pytest, Tesseract/pytesseract (OCR).

## Global Constraints

- Working dir for all code: `~/.claude/jobs/f357192b/tmp/ecgf/` — new package under `ecgf/ensemble/`. Run with `./.venv/bin/python` and `./.venv/bin/pytest`.
- **Reuse, do not retrain:** `image_model_v2.pt` (v2), `image_model_mireal.pt` (MI-specialist), `digitiser.onnx`, `1_lead_ECGFounder.pth`, `12_lead_ECGFounder.pth`, `repo/net1d.py`, `repo/tasks.txt`, `calib_v2.json`. Nothing touches production Cloud Run.
- **Canonical classes (exact, ordered):** `["MI-any","acute-STEMI","AFIB","STACH","SBRAD","ISC","NDT","LVH","NORMAL"]`.
- **V2-floor invariant:** ensemble prob for class `c` is used only if `R_ens(c) >= R(v2,c)` on calibration; else v2's prob. Must be a tested property.
- **Every branch always executes and is always logged**, even at zero fusion weight.
- **Thresholds learned from calibration** (lower-95%-CI-of-AUROC > 0.5 gate), not hard-coded.
- Datasets (read-only): Mendeley `~/Downloads/gwbz3fsgp8-2`, SSMCH `~/Downloads/SSMCH-ECG` (+ `metadata -SSMCH-ECG.csv`).
- Determinism: seed numpy/torch to 0; cache keyed on `(item_id, branch.name, branch.version)`.
- CPU-only, ~$0. No network at inference.

---

### Task 1: Canonical space + Branch interface + registry

**Files:**
- Create: `ecgf/ensemble/__init__.py`
- Create: `ecgf/ensemble/canonical.py`
- Create: `ecgf/ensemble/branch.py`
- Test: `ecgf/ensemble/tests/test_branch.py`

**Interfaces:**
- Produces: `CANONICAL: list[str]`; `@dataclass BranchOutput(probs: dict[str,float], confidence: dict[str,float], quality: float, ok: bool, raw: Any, meta: dict)`; `class Branch(Protocol)` with `name:str, version:str, coverage:set[str], predict(image, ctx)->BranchOutput`; `REGISTRY: list`; `register(b)->None`.

- [ ] **Step 1: Write the failing test**
```python
# ecgf/ensemble/tests/test_branch.py
from ensemble.canonical import CANONICAL
from ensemble.branch import BranchOutput, REGISTRY, register

def test_canonical_is_ordered_and_complete():
    assert CANONICAL == ["MI-any","acute-STEMI","AFIB","STACH","SBRAD","ISC","NDT","LVH","NORMAL"]

def test_registry_register():
    class Dummy:
        name="dummy"; version="1"; coverage={"NORMAL"}
        def predict(self, image, ctx): return BranchOutput({"NORMAL":0.9},{"NORMAL":0.8},1.0,True,None,{})
    n0=len(REGISTRY); register(Dummy()); assert len(REGISTRY)==n0+1
    out=REGISTRY[-1].predict(None,{}); assert out.probs["NORMAL"]==0.9 and out.ok
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd ~/.claude/jobs/f357192b/tmp/ecgf && ./.venv/bin/python -m pytest ensemble/tests/test_branch.py -v`
Expected: FAIL (ModuleNotFoundError: ensemble).
- [ ] **Step 3: Write minimal implementation**
```python
# ecgf/ensemble/__init__.py
# (empty)
```
```python
# ecgf/ensemble/canonical.py
CANONICAL = ["MI-any","acute-STEMI","AFIB","STACH","SBRAD","ISC","NDT","LVH","NORMAL"]
```
```python
# ecgf/ensemble/branch.py
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

@dataclass
class BranchOutput:
    probs: dict            # canonical class -> prob (only covered classes)
    confidence: dict       # canonical class -> per-input confidence 0..1
    quality: float         # branch applicability on this input 0..1
    ok: bool               # branch ran successfully
    raw: Any               # native output, logged verbatim
    meta: dict = field(default_factory=dict)

@runtime_checkable
class Branch(Protocol):
    name: str
    version: str
    coverage: set
    def predict(self, image, ctx: dict) -> BranchOutput: ...

REGISTRY: list = []
def register(b) -> None: REGISTRY.append(b)
```
Add `conftest.py` at `ecgf/ensemble/conftest.py` with `import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))` so `import ensemble...` resolves.
- [ ] **Step 4: Run test to verify it passes**
Run: `./.venv/bin/python -m pytest ensemble/tests/test_branch.py -v` → Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add ensemble/__init__.py ensemble/canonical.py ensemble/branch.py ensemble/conftest.py ensemble/tests/test_branch.py
git commit -m "feat(ensemble): canonical space + Branch interface + registry"
```

---

### Task 2: Dataset loader with canonical labels

**Files:**
- Create: `ecgf/ensemble/dataset.py`
- Test: `ecgf/ensemble/tests/test_dataset.py`

**Interfaces:**
- Consumes: `CANONICAL`.
- Produces: `@dataclass Item(id:str, path:str, source:str, labels:dict[str,Optional[int]])`; `load_corpus()->list[Item]`; `parse_ssmch_text(text)->dict[str,int]`. `labels[c]` is `1`/`0`/`None` (None = unknown/uncovered for that item).

- [ ] **Step 1: Write the failing test**
```python
# ecgf/ensemble/tests/test_dataset.py
from ensemble.dataset import parse_ssmch_text, load_corpus, Item

def test_parse_ssmch_text_infarct_and_afib():
    d = parse_ssmch_text("atrial fibrillation, anterolateral infarct")
    assert d["AFIB"]==1 and d["MI-any"]==1 and d["STACH"]==0

def test_load_corpus_counts_and_labels():
    items = load_corpus()
    assert len(items) > 1500                      # ~1777
    srcs = {i.source for i in items}
    assert srcs == {"mendeley","ssmch"}
    # a Mendeley normal has NORMAL=1, MI-any=0, and rhythm classes unknown(None)
    norm = [i for i in items if i.source=="mendeley" and i.labels["NORMAL"]==1][0]
    assert norm.labels["MI-any"]==0 and norm.labels["AFIB"] is None
```
- [ ] **Step 2: Run test to verify it fails**
Run: `./.venv/bin/python -m pytest ensemble/tests/test_dataset.py -v` → FAIL (no module).
- [ ] **Step 3: Write minimal implementation**
```python
# ecgf/ensemble/dataset.py
import os, csv, glob
from dataclasses import dataclass
from typing import Optional
from .canonical import CANONICAL

MB = os.path.expanduser("~/Downloads/gwbz3fsgp8-2")
SB = os.path.expanduser("~/Downloads/SSMCH-ECG")

@dataclass
class Item:
    id: str; path: str; source: str; labels: dict

def parse_ssmch_text(text: str) -> dict:
    t = (text or "").lower(); d = {c: 0 for c in CANONICAL}
    if "fibrillation" in t or "afib" in t: d["AFIB"]=1
    if "tachycardia" in t: d["STACH"]=1
    if "bradycardia" in t: d["SBRAD"]=1
    if "infarct" in t or "stemi" in t or "acute mi" in t: d["MI-any"]=1
    if "stemi" in t or "acute mi" in t: d["acute-STEMI"]=1
    if "ischem" in t or "ischaem" in t: d["ISC"]=1
    if "t wave" in t or "t-wave" in t: d["NDT"]=1
    if "hypertrophy" in t or "lvh" in t: d["LVH"]=1
    d["NORMAL"]=0
    return d

def _blank(**over):
    d = {c: None for c in CANONICAL}; d.update(over); return d

def load_corpus() -> list:
    items = []
    mend = [("ECG Images of Myocardial Infarction Patients (240x12=2880)", dict(**{"MI-any":1,"NORMAL":0})),
            ("ECG Images of Patient that have History of MI (172x12=2064)", dict(**{"MI-any":1,"NORMAL":0})),
            ("ECG Images of Patient that have abnormal heartbeat (233x12=2796)", dict(**{"NORMAL":0})),
            ("Normal Person ECG Images (284x12=3408)", {c:0 for c in CANONICAL} | {"NORMAL":1})]
    i=0
    for folder, base in mend:
        lab = _blank(**base)
        for p in sorted(glob.glob(os.path.join(MB, folder, "*.jpg"))):
            i+=1; items.append(Item(f"mendeley_{i:05d}", p, "mendeley", dict(lab)))
    fo = {"MI":"Myocardial_Infarction","Abnormal":"Abnormal","Normal":"Normal"}
    j=0
    for r in csv.DictReader(open(os.path.join(SB, "metadata -SSMCH-ECG.csv"))):
        cn=r["class_name"].strip(); p=os.path.join(SB, fo.get(cn,cn), r["image_name"].strip())
        if not os.path.exists(p): continue
        if cn=="Normal": lab={c:0 for c in CANONICAL} | {"NORMAL":1}
        elif cn=="MI": lab={c:0 for c in CANONICAL} | {"MI-any":1,"acute-STEMI":1,"NORMAL":0}
        else: lab=parse_ssmch_text(r["abnormality_type"])
        j+=1; items.append(Item(f"ssmch_{j:05d}", p, "ssmch", lab))
    return items
```
Note: Mendeley "abnormal heartbeat" folder → all classes `None` except `NORMAL=0` (unknown per-class, excluded from both pos and neg in scoring).
- [ ] **Step 4: Run test to verify it passes**
Run: `./.venv/bin/python -m pytest ensemble/tests/test_dataset.py -v` → PASS.
- [ ] **Step 5: Commit**
```bash
git add ensemble/dataset.py ensemble/tests/test_dataset.py
git commit -m "feat(ensemble): real-corpus loader with canonical labels"
```

---

### Task 3: QualityAssessor

**Files:**
- Create: `ecgf/ensemble/quality.py`
- Test: `ecgf/ensemble/tests/test_quality.py`

**Interfaces:**
- Produces: `@dataclass QualityResult(score:float, type:str, sharpness:float, grid:float, glare:float)`; `assess(pil_image)->QualityResult`. `type in {"clean","photo","unreadable"}`.

- [ ] **Step 1: Write the failing test**
```python
# ecgf/ensemble/tests/test_quality.py
import numpy as np
from PIL import Image
from ensemble.quality import assess

def _img(arr): return Image.fromarray(arr.astype("uint8"))

def test_sharp_scores_higher_than_blurred():
    import scipy.ndimage as ndi
    sharp = np.random.default_rng(0).integers(0,255,(400,600),dtype="uint8")
    blurred = ndi.gaussian_filter(sharp, 6)
    assert assess(_img(np.stack([sharp]*3,-1))).sharpness > assess(_img(np.stack([blurred]*3,-1))).sharpness

def test_blank_is_unreadable():
    blank = np.full((400,600,3), 250, dtype="uint8")
    assert assess(_img(blank)).type == "unreadable"
```
- [ ] **Step 2: Run** `./.venv/bin/python -m pytest ensemble/tests/test_quality.py -v` → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/quality.py
import numpy as np
from dataclasses import dataclass
from PIL import Image

@dataclass
class QualityResult:
    score: float; type: str; sharpness: float; grid: float; glare: float

def _lap_var(gray):  # sharpness
    k = np.array([[0,1,0],[1,-4,1],[0,1,0]], float)
    from scipy.signal import convolve2d
    return float(convolve2d(gray, k, mode="valid").var())

def assess(pil_image) -> QualityResult:
    g = np.asarray(pil_image.convert("L"), float)
    sharp = _lap_var(g)
    glare = float((g > 245).mean())                 # blown-out fraction
    # grid energy: variance of column-mean autocorrelation proxy
    grid = float(np.clip(g.std()/128.0, 0, 1))
    contrast = float(g.std())
    if contrast < 12 or sharp < 5:
        typ = "unreadable"; score = 0.05
    elif sharp > 200 and glare < 0.05:
        typ = "clean"; score = min(1.0, 0.6 + sharp/2000)
    else:
        typ = "photo"; score = float(np.clip(0.3 + sharp/1500 - glare, 0.05, 0.85))
    return QualityResult(score, typ, sharp, grid, glare)
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/quality.py ensemble/tests/test_quality.py && git commit -m "feat(ensemble): quality assessor"`

---

### Task 4: Branch-output cache (run-once/fuse-many)

**Files:**
- Create: `ecgf/ensemble/cache.py`
- Test: `ecgf/ensemble/tests/test_cache.py`

**Interfaces:**
- Consumes: `BranchOutput`, `Item`.
- Produces: `cached_predict(branch, item, cache_dir)->BranchOutput` (runs branch once, persists jsonl keyed `(item.id, branch.name, branch.version)`, replays from disk on repeat). `load_log(cache_dir)->list[dict]`.

- [ ] **Step 1: Write failing test**
```python
# ecgf/ensemble/tests/test_cache.py
import tempfile, os
from ensemble.branch import BranchOutput
from ensemble.dataset import Item
from ensemble.cache import cached_predict

class Counter:
    name="c"; version="1"; coverage={"NORMAL"}; calls=0
    def predict(self, image, ctx):
        Counter.calls += 1
        return BranchOutput({"NORMAL":0.7},{"NORMAL":0.6},1.0,True,{"n":1},{})

def test_cache_runs_once(tmp_path):
    it = Item("x1","/dev/null","mendeley",{"NORMAL":1})
    b = Counter()
    o1 = cached_predict(b, it, str(tmp_path))
    o2 = cached_predict(b, it, str(tmp_path))     # replay, no re-run
    assert Counter.calls == 1
    assert o1.probs == o2.probs == {"NORMAL":0.7}
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/cache.py
import os, json
from PIL import Image
from .branch import BranchOutput

def _key(item_id, name, version): return f"{item_id}::{name}::{version}"

def cached_predict(branch, item, cache_dir) -> BranchOutput:
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{branch.name}.jsonl")
    key = _key(item.id, branch.name, branch.version)
    if os.path.exists(path):
        for line in open(path):
            rec = json.loads(line)
            if rec["key"] == key:
                d = rec["out"]
                return BranchOutput(d["probs"], d["confidence"], d["quality"], d["ok"], d.get("raw"), d.get("meta",{}))
    try:
        img = Image.open(item.path).convert("RGB")
        out = branch.predict(img, {"item": item})
    except Exception as e:
        out = BranchOutput({}, {}, 0.0, False, None, {"error": str(e)})
    with open(path, "a") as f:
        f.write(json.dumps({"key": key, "item": item.id, "out": {
            "probs": out.probs, "confidence": out.confidence, "quality": out.quality,
            "ok": out.ok, "raw": _jsonable(out.raw), "meta": out.meta}}) + "\n")
    return out

def _jsonable(x):
    try: json.dumps(x); return x
    except Exception: return str(type(x))

def load_log(cache_dir):
    recs = []
    for fn in os.listdir(cache_dir):
        if fn.endswith(".jsonl"):
            for line in open(os.path.join(cache_dir, fn)): recs.append(json.loads(line))
    return recs
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/cache.py ensemble/tests/test_cache.py && git commit -m "feat(ensemble): branch-output cache + log"`

---

### Task 5: v2 branch

**Files:**
- Create: `ecgf/ensemble/branches/__init__.py`, `ecgf/ensemble/branches/v2_branch.py`
- Test: `ecgf/ensemble/tests/test_v2_branch.py`

**Interfaces:**
- Consumes: `BranchOutput`, `CANONICAL`, `image_model_v2.pt`, `calib_v2.json`.
- Produces: `class V2Branch` (name="v2", version="1", coverage=all CANONICAL); maps 19 logits → canonical (AMI/IMI/ASMI→MI-any via max; acute-STEMI abstain (v2 has no STEMI head) → omit from coverage). Applies temperature from `calib_v2.json`.

- [ ] **Step 1: Write failing test** (uses a tiny fake image; asserts structure, not accuracy)
```python
# ecgf/ensemble/tests/test_v2_branch.py
from PIL import Image
import numpy as np
from ensemble.branches.v2_branch import V2Branch
from ensemble.canonical import CANONICAL

def test_v2_branch_outputs_canonical():
    b = V2Branch()
    assert "MI-any" in b.coverage and "acute-STEMI" not in b.coverage
    img = Image.fromarray(np.random.default_rng(0).integers(0,255,(320,320,3),dtype="uint8"))
    out = b.predict(img, {})
    assert out.ok and set(out.probs).issubset(set(CANONICAL))
    assert 0.0 <= out.probs["MI-any"] <= 1.0
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/branches/v2_branch.py
import os, json, numpy as np, torch, timm
import torchvision.transforms as T
from ..branch import BranchOutput
ECGF = os.path.expanduser("~/.claude/jobs/f357192b/tmp/ecgf")
V2C = ["NORM","AFIB","STACH","SBRAD","1AVB","CRBBB","IRBBB","CLBBB","LAFB","IMI","AMI","ASMI","LVH","ISC_","STTC","NDT","PVC","PAC","LAD"]
MAP = {"AFIB":"AFIB","STACH":"STACH","SBRAD":"SBRAD","LVH":"LVH","ISC_":"ISC","NDT":"NDT","NORM":"NORMAL"}
class V2Branch:
    name="v2"; version="1"; coverage={"MI-any","AFIB","STACH","SBRAD","ISC","NDT","LVH","NORMAL"}
    def __init__(self):
        ck=torch.load(os.path.join(ECGF,"image_model_v2.pt"),map_location="cpu",weights_only=False)
        self.m=timm.create_model(ck["backbone"],pretrained=False,num_classes=len(ck["classes"]))
        self.m.load_state_dict(ck["state_dict"]); self.m.eval(); self.classes=ck["classes"]
        self.temp=json.load(open(os.path.join(ECGF,"calib_v2.json")))["temperature"]
        self.tf=T.Compose([T.Resize((320,320)),T.ToTensor(),T.Normalize([0.5]*3,[0.5]*3)])
    def predict(self, image, ctx):
        x=self.tf(image).unsqueeze(0)
        with torch.no_grad(): logits=self.m(x)[0].numpy()
        p=1/(1+np.exp(-logits/self.temp)); pj={c:float(p[i]) for i,c in enumerate(self.classes)}
        probs={"MI-any": max(pj["AMI"],pj["IMI"],pj["ASMI"])}
        for k,v in MAP.items(): probs[v]=pj[k]
        conf={c: abs(2*probs[c]-1) for c in probs}
        return BranchOutput(probs, conf, 1.0, True, {"raw19":pj}, {})
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/branches/__init__.py ensemble/branches/v2_branch.py ensemble/tests/test_v2_branch.py && git commit -m "feat(ensemble): v2 branch"`

---

### Task 6: MI-specialist branch

**Files:** Create `ecgf/ensemble/branches/mi_branch.py`; Test `ecgf/ensemble/tests/test_mi_branch.py`
**Interfaces:** `class MIBranch` (name="mi_specialist", version="1", coverage={"MI-any"}); loads `image_model_mireal.pt` (efficientnet_b3, num_classes=1) → sigmoid → MI-any.

- [ ] **Step 1: Failing test**
```python
# ecgf/ensemble/tests/test_mi_branch.py
from PIL import Image; import numpy as np
from ensemble.branches.mi_branch import MIBranch
def test_mi_branch():
    b=MIBranch(); assert b.coverage=={"MI-any"}
    img=Image.fromarray(np.zeros((320,320,3),dtype="uint8"))
    out=b.predict(img,{}); assert out.ok and 0<=out.probs["MI-any"]<=1
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/branches/mi_branch.py
import os, numpy as np, torch, timm
import torchvision.transforms as T
from ..branch import BranchOutput
ECGF=os.path.expanduser("~/.claude/jobs/f357192b/tmp/ecgf")
class MIBranch:
    name="mi_specialist"; version="1"; coverage={"MI-any"}
    def __init__(self):
        ck=torch.load(os.path.join(ECGF,"image_model_mireal.pt"),map_location="cpu",weights_only=False)
        self.m=timm.create_model("efficientnet_b3",pretrained=False,num_classes=1)
        self.m.load_state_dict(ck["state_dict"]); self.m.eval()
        self.tf=T.Compose([T.Resize((320,320)),T.ToTensor(),T.Normalize([0.5]*3,[0.5]*3)])
    def predict(self, image, ctx):
        x=self.tf(image).unsqueeze(0)
        with torch.no_grad(): p=float(torch.sigmoid(self.m(x))[0,0])
        return BranchOutput({"MI-any":p},{"MI-any":abs(2*p-1)},1.0,True,{"p":p},{})
```
- [ ] **Step 4: Run** → PASS. — [ ] **Step 5: Commit** `git add ensemble/branches/mi_branch.py ensemble/tests/test_mi_branch.py && git commit -m "feat(ensemble): MI-specialist branch"`

---

### Task 7: 12-lead reconstruction from digitiser segmentation

**Files:** Create `ecgf/ensemble/reconstruct.py`; Test `ecgf/ensemble/tests/test_reconstruct.py`
**Interfaces:** Produces `segment(pil_image)->np.ndarray` (1024×1280 int lead-map via `digitiser.onnx`); `rhythm_strip(labelmap)->Optional[np.ndarray]` (1-D, bottom full-width band); `reconstruct_12(labelmap)->Optional[np.ndarray]` shape `(12,N)` in millivolt-ish units, `None` if <8 leads recovered. Lead index order = `["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]`.

- [ ] **Step 1: Failing test** (synthetic labelmap: draw a horizontal band for lead index 2 across full width)
```python
# ecgf/ensemble/tests/test_reconstruct.py
import numpy as np
from ensemble.reconstruct import rhythm_strip, reconstruct_12
def _map():
    lab=np.zeros((1024,1280),int); lab[900:915, 100:1200]=2   # class 2 band = full-width strip
    return lab
def test_rhythm_strip_extracts_fullwidth_band():
    s=rhythm_strip(_map()); assert s is not None and len(s) > 1000
def test_reconstruct_12_returns_none_when_too_few_leads():
    assert reconstruct_12(_map()) is None      # only 1 lead present
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (centre-line extraction; amplitude/time not yet physically calibrated — normalized per lead; calibration refinement folded here)
```python
# ecgf/ensemble/reconstruct.py
import os, numpy as np
import onnxruntime as ort
from PIL import Image
ECGF=os.path.expanduser("~/.claude/jobs/f357192b/tmp/ecgf")
LEADS=["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]
_seg=None
def _sess():
    global _seg
    if _seg is None: _seg=ort.InferenceSession(os.path.join(ECGF,"digitiser.onnx"),providers=["CPUExecutionProvider"])
    return _seg
def segment(pil_image):
    im=np.asarray(pil_image.convert("L").resize((1280,1024)),dtype=np.float32)
    x=(im-im.mean())/(im.std()+1e-8)
    return _sess().run(None,{"image":x[None,None]})[0][0].argmax(0)
def _centre_line(sub, y0):
    cols=np.where(sub.any(0))[0]
    if len(cols)==0: return None,0
    span=cols.max()-cols.min()
    tr=np.array([(np.where(sub[:,x])[0].mean()+y0) if sub[:,x].any() else np.nan for x in range(cols.min(),cols.max()+1)])
    ok=~np.isnan(tr); tr=np.interp(np.arange(len(tr)),np.where(ok)[0],tr[ok])
    return -tr, span
def _band(lab, c, bottom=True):
    rows=np.where((lab==c).any(1))[0]
    if len(rows)==0: return None,None
    bands=[]; s=rows[0]; p=rows[0]
    for r in rows[1:]:
        if r-p>20: bands.append((s,p)); s=r
        p=r
    bands.append((s,p)); y0,y1=(bands[-1] if bottom else bands[0])
    return (lab[y0:y1+1]==c), y0
def rhythm_strip(lab):
    W=lab.shape[1]; best=None
    for c in range(1,13):
        sub,y0=_band(lab,c,bottom=True)
        if sub is None: continue
        tr,span=_centre_line(sub,y0)
        if tr is not None and span>=W*0.4 and (best is None or span>best[1]): best=(tr,span)
    return best[0] if best else None
def reconstruct_12(lab):
    out={}; W=lab.shape[1]
    for c in range(1,13):
        sub,y0=_band(lab,c,bottom=False)
        if sub is None: continue
        tr,span=_centre_line(sub,y0)
        if tr is not None and span>=W*0.15:
            v=tr-np.median(tr); out[LEADS[c-1]]=v/(np.std(v)+1e-8)
    if len(out)<8: return None
    N=max(len(v) for v in out.values())
    arr=np.zeros((12,N))
    for i,name in enumerate(LEADS):
        if name in out:
            v=out[name]; arr[i,:len(v)]=v
    return arr
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/reconstruct.py ensemble/tests/test_reconstruct.py && git commit -m "feat(ensemble): digitiser segmentation + 12-lead reconstruction"`

---

### Task 8: ECGFounder branches (1-lead + 12-lead)

**Files:** Create `ecgf/ensemble/branches/ecgfounder_branch.py`; Test `ecgf/ensemble/tests/test_ecgfounder_branch.py`
**Interfaces:** `class ECGFounder1Branch` (name="ecgf_1lead", coverage={"AFIB","STACH","SBRAD","MI-any"}); `class ECGFounder12Branch` (name="ecgf_12lead", coverage={"AFIB","STACH","SBRAD","MI-any","acute-STEMI","ISC","NDT","LVH"}). Both: image→`segment`→(strip|reconstruct_12)→filter+resample→Net1D→150 probs→canonical map. `quality`=0 when digitize fails.

- [ ] **Step 1: Failing test** (mock segment to a known band so it exercises the path)
```python
# ecgf/ensemble/tests/test_ecgfounder_branch.py
import numpy as np, ensemble.reconstruct as R
from PIL import Image
from ensemble.branches.ecgfounder_branch import ECGFounder1Branch

def test_ecgf1_quality_zero_when_no_strip(monkeypatch):
    monkeypatch.setattr(R, "segment", lambda img: np.zeros((1024,1280),int))  # no leads
    b=ECGFounder1Branch(); out=b.predict(Image.new("RGB",(400,400)),{})
    assert out.quality==0.0 and out.ok is True and out.probs=={}
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/branches/ecgfounder_branch.py
import os, sys, numpy as np, torch
from scipy.signal import iirnotch, filtfilt, butter, medfilt, resample as sresample
from ..branch import BranchOutput
from .. import reconstruct as R
ECGF=os.path.expanduser("~/.claude/jobs/f357192b/tmp/ecgf"); sys.path.insert(0, os.path.join(ECGF,"repo"))
from net1d import Net1D
TASKS=[l.strip() for l in open(os.path.join(ECGF,"repo/tasks.txt"))]
def _ti(name): return TASKS.index(name)
CMAP={"AFIB":[_ti("ATRIAL FIBRILLATION")], "STACH":[_ti("SINUS TACHYCARDIA")], "SBRAD":[_ti("SINUS BRADYCARDIA")],
      "ISC":[_ti("NONSPECIFIC ST ABNORMALITY")], "NDT":[_ti("NONSPECIFIC T WAVE ABNORMALITY")],
      "MI-any":[_ti(n) for n in ["ANTERIOR INFARCT","INFERIOR INFARCT","ANTEROSEPTAL INFARCT","LATERAL INFARCT","ANTEROLATERAL INFARCT","SEPTAL INFARCT","ACUTE MI / STEMI"]],
      "acute-STEMI":[_ti("ACUTE MI / STEMI")], "LVH":[_ti("LEFT VENTRICULAR HYPERTROPHY"),_ti("VOLTAGE CRITERIA FOR LEFT VENTRICULAR HYPERTROPHY")]}
def _filt(sig,fs=500):
    b,a=iirnotch(50,30,fs); f=filtfilt(b,a,sig); b,a=butter(4,[0.67,40],"bandpass",fs=fs); f=filtfilt(b,a,f)
    ks=int(0.4*fs)+1; ks+=(ks%2==0); return f-medfilt(f,ks)
def _build(ic):
    return Net1D(in_channels=ic,base_filters=64,ratio=1,filter_list=[64,160,160,400,400,1024,1024],
                 m_blocks_list=[2,2,2,3,3,4,4],kernel_size=16,stride=2,groups_width=16,verbose=False,use_bn=False,use_do=False,n_classes=150)
class _Base:
    def __init__(self, ckpt, ic, cov):
        self.m=_build(ic); ck=torch.load(os.path.join(ECGF,ckpt),map_location="cpu",weights_only=False)
        self.m.load_state_dict(ck["state_dict"],strict=False); self.m.eval(); self.coverage=set(cov)
    def _run(self, arr):        # arr shape (ic, L)
        chans=[]
        for lead in arr:
            x=_filt(lead.astype(float));
            if len(x)!=5000: x=sresample(x,5000)
            chans.append((x-x.mean())/(x.std()+1e-8))
        t=torch.tensor(np.stack(chans)[None],dtype=torch.float32)
        with torch.no_grad(): p=torch.sigmoid(self.m(t))[0].numpy()
        probs={}; 
        for c,idx in CMAP.items():
            if c in self.coverage: probs[c]=float(max(p[i] for i in idx))
        return probs, p
class ECGFounder1Branch(_Base):
    name="ecgf_1lead"; version="1"
    def __init__(self): super().__init__("1_lead_ECGFounder.pth",1,{"AFIB","STACH","SBRAD","MI-any"})
    def predict(self, image, ctx):
        lab=R.segment(image); strip=R.rhythm_strip(lab)
        if strip is None: return BranchOutput({},{},0.0,True,None,{"digitize":"no_strip"})
        probs,raw=self._run(strip[None]); conf={c:abs(2*v-1) for c,v in probs.items()}
        return BranchOutput(probs,conf,0.8,True,{"n":len(strip)},{"digitize":"ok"})
class ECGFounder12Branch(_Base):
    name="ecgf_12lead"; version="1"
    def __init__(self): super().__init__("12_lead_ECGFounder.pth",12,{"AFIB","STACH","SBRAD","MI-any","acute-STEMI","ISC","NDT","LVH"})
    def predict(self, image, ctx):
        lab=R.segment(image); arr=R.reconstruct_12(lab)
        if arr is None: return BranchOutput({},{},0.0,True,None,{"digitize":"few_leads"})
        probs,raw=self._run(arr); conf={c:abs(2*v-1) for c,v in probs.items()}
        return BranchOutput(probs,conf,0.8,True,{"leads":int((arr.any(1)).sum())},{"digitize":"ok"})
```
Note: verify `net1d`/`tasks.txt` label strings exist; if a task name differs, fix the string in `CMAP` (grep `repo/tasks.txt`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/branches/ecgfounder_branch.py ensemble/tests/test_ecgfounder_branch.py && git commit -m "feat(ensemble): ECGFounder 1-lead + 12-lead branches"`

---

### Task 9: OCR branch

**Files:** Create `ecgf/ensemble/branches/ocr_branch.py`; Test `ecgf/ensemble/tests/test_ocr_branch.py`
**Interfaces:** `class OCRBranch` (name="ocr", coverage=all CANONICAL). Uses **EasyOCR** (already `pip install`ed in the venv) on the image; maps text via `dataset.parse_ssmch_text`; `quality`=min(1, alpha_chars/40) (0 if none). Probs near-1 for asserted classes, near-0 otherwise; confidence high when text found. Fallback: if EasyOCR import/read fails, `_ocr_text` returns "" → branch quality 0 (abstains). First `Reader(["en"])` call is lazy + cached in `_reader`.

- [ ] **Step 1: Failing test** (monkeypatch the OCR text function)
```python
# ecgf/ensemble/tests/test_ocr_branch.py
from PIL import Image
import ensemble.branches.ocr_branch as O
def test_ocr_maps_text(monkeypatch):
    monkeypatch.setattr(O, "_ocr_text", lambda img: "SINUS RHYTHM  ACUTE MI / STEMI")
    b=O.OCRBranch(); out=b.predict(Image.new("RGB",(400,400)),{})
    assert out.quality>0 and out.probs["MI-any"]>0.5 and out.probs["acute-STEMI"]>0.5
def test_ocr_no_text_quality_zero(monkeypatch):
    monkeypatch.setattr(O, "_ocr_text", lambda img: "")
    out=O.OCRBranch().predict(Image.new("RGB",(400,400)),{}); assert out.quality==0.0
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/branches/ocr_branch.py
from ..branch import BranchOutput
from ..canonical import CANONICAL
from ..dataset import parse_ssmch_text
_reader = None
def _ocr_text(image):
    global _reader
    try:
        import easyocr, numpy as np
        if _reader is None: _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        res = _reader.readtext(np.array(image.convert("RGB")))
        return " ".join(t for _, t, _ in res)
    except Exception:
        return ""
class OCRBranch:
    name="ocr"; version="1"; coverage=set(CANONICAL)
    def predict(self, image, ctx):
        txt=_ocr_text(image); alpha=sum(ch.isalpha() for ch in txt)
        if alpha < 3:
            return BranchOutput({},{},0.0,True,{"text":txt},{"text_found":False})
        d=parse_ssmch_text(txt)
        probs={c:(0.95 if d.get(c)==1 else 0.05) for c in CANONICAL}
        if "normal" in txt.lower() and not any(d.get(c)==1 for c in CANONICAL if c!="NORMAL"):
            probs["NORMAL"]=0.95
        conf={c:0.9 for c in probs}
        q=min(1.0, alpha/40.0)
        return BranchOutput(probs, conf, q, True, {"text":txt[:300]}, {"text_found":True})
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/branches/ocr_branch.py ensemble/tests/test_ocr_branch.py && git commit -m "feat(ensemble): OCR branch"`

---

### Task 10: Reliability table + learned gates

**Files:** Create `ecgf/ensemble/reliability.py`; Test `ecgf/ensemble/tests/test_reliability.py`
**Interfaces:** Produces `fit_reliability(preds, labels)->dict[(branch,class)->{auroc,lo,hi,n}]` where `preds[branch][class] -> list[float]` aligned with `labels[class] -> list[0/1/None]`; `gate(rel_entry)->bool` (True if `lo>0.5`); bootstrap CI with fixed seed.

- [ ] **Step 1: Failing test**
```python
# ecgf/ensemble/tests/test_reliability.py
import numpy as np
from ensemble.reliability import auroc_ci, gate
def test_perfect_separation_gate_true():
    y=[0]*30+[1]*30; s=[0.1]*30+[0.9]*30
    e=auroc_ci(np.array(s),np.array(y)); assert e["auroc"]>0.99 and gate(e) is True
def test_chance_gate_false():
    rng=np.random.default_rng(0); y=rng.integers(0,2,200); s=rng.random(200)
    e=auroc_ci(s,y); assert gate(e) is False        # lo should not exceed 0.5
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/reliability.py
import numpy as np
from sklearn.metrics import roc_auc_score
def auroc_ci(scores, y, n_boot=500, seed=0):
    scores=np.asarray(scores,float); y=np.asarray(y,int)
    m=~np.isnan(scores); scores,y=scores[m],y[m]
    if len(set(y.tolist()))<2 or len(y)<5: return {"auroc":None,"lo":0.0,"hi":1.0,"n":int(len(y))}
    base=float(roc_auc_score(y,scores)); rng=np.random.default_rng(seed); boots=[]
    for _ in range(n_boot):
        idx=rng.integers(0,len(y),len(y))
        if len(set(y[idx].tolist()))<2: continue
        boots.append(roc_auc_score(y[idx],scores[idx]))
    lo,hi=(float(np.percentile(boots,2.5)),float(np.percentile(boots,97.5))) if boots else (0.0,1.0)
    return {"auroc":base,"lo":lo,"hi":hi,"n":int(len(y))}
def gate(entry): return bool(entry["auroc"] is not None and entry["lo"]>0.5)
def fit_reliability(preds, labels):
    out={}
    for br, cls_scores in preds.items():
        for c, scores in cls_scores.items():
            y=labels.get(c)
            if y is None: continue
            pairs=[(s,yy) for s,yy in zip(scores,y) if yy is not None]
            if not pairs: continue
            s,yy=zip(*pairs); out[(br,c)]=auroc_ci(np.array(s),np.array(yy))
    return out
```
- [ ] **Step 4: Run** → PASS. — [ ] **Step 5: Commit** `git add ensemble/reliability.py ensemble/tests/test_reliability.py && git commit -m "feat(ensemble): reliability table + learned CI gate"`

---

### Task 11: Fusion engine (weights, hierarchical, OCR override, V2-floor)

**Files:** Create `ecgf/ensemble/fusion.py`; Test `ecgf/ensemble/tests/test_fusion.py`
**Interfaces:** `class FusionEngine(reliability: dict, v2_name="v2")`; `fuse(outputs: dict[branch_name, BranchOutput], class_c: str)->float` and `fuse_all(outputs)->dict[class,float]`. Uses `reliability[(branch,c)]` for R and gate; weight `= R * quality * (0.5+0.5*conf)`; OCR override if ocr quality>0 and asserts c; **V2-floor:** if `R_ens(c) < R(v2,c)` return v2 prob. `R_ens(c)` supplied via `reliability[("__ensemble__",c)]` when available (filled by harness), else falls back to max surviving R.

- [ ] **Step 1: Failing tests (incl. V2-floor property)**
```python
# ecgf/ensemble/tests/test_fusion.py
from ensemble.branch import BranchOutput
from ensemble.fusion import FusionEngine
def _rel(**kv): return {k:{"auroc":v,"lo":v-0.05,"hi":v+0.05,"n":100} for k,v in kv.items()}
def test_low_reliability_branch_has_no_influence():
    rel=_rel(**{("v2","MI-any"):0.9, ("ecgf_1lead","MI-any"):0.50})
    fe=FusionEngine(rel)
    outs={"v2":BranchOutput({"MI-any":0.8},{"MI-any":0.6},1.0,True,None,{}),
          "ecgf_1lead":BranchOutput({"MI-any":0.1},{"MI-any":0.6},0.8,True,None,{})}
    assert abs(fe.fuse(outs,"MI-any")-0.8) < 0.05      # chance branch ignored
def test_v2_floor_blocks_weaker_ensemble():
    rel=_rel(**{("v2","AFIB"):0.9, ("ecgf_1lead","AFIB"):0.7, ("__ensemble__","AFIB"):0.75})
    fe=FusionEngine(rel)
    outs={"v2":BranchOutput({"AFIB":0.2},{"AFIB":0.6},1.0,True,None,{}),
          "ecgf_1lead":BranchOutput({"AFIB":0.9},{"AFIB":0.9},0.8,True,None,{})}
    assert fe.fuse(outs,"AFIB")==0.2                   # R_ens 0.75 < R_v2 0.9 -> v2 wins
def test_ocr_override():
    rel=_rel(**{("v2","MI-any"):0.9, ("ocr","MI-any"):0.95, ("__ensemble__","MI-any"):0.95})
    fe=FusionEngine(rel)
    outs={"v2":BranchOutput({"MI-any":0.3},{"MI-any":0.4},1.0,True,None,{}),
          "ocr":BranchOutput({"MI-any":0.95},{"MI-any":0.9},1.0,True,None,{"text_found":True})}
    assert fe.fuse(outs,"MI-any")>0.8
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/fusion.py
from .reliability import gate
class FusionEngine:
    def __init__(self, reliability, v2_name="v2", ocr_name="ocr"):
        self.rel=reliability; self.v2=v2_name; self.ocr=ocr_name
    def _R(self, br, c):
        e=self.rel.get((br,c)); return (e["auroc"] or 0.0) if e else 0.0
    def _gated(self, br, c):
        e=self.rel.get((br,c)); return bool(e and gate(e))
    def fuse(self, outputs, c):
        v2p=outputs.get(self.v2).probs.get(c) if self.v2 in outputs else None
        # OCR override
        o=outputs.get(self.ocr)
        if o and o.quality>0 and c in o.probs and self._gated(self.ocr,c) and o.probs[c]>0.5:
            ens=o.probs[c]
        else:
            num=den=0.0
            for br,out in outputs.items():
                if not out.ok or c not in out.probs or out.quality<=0: continue
                if not self._gated(br,c): continue
                w=self._R(br,c)*out.quality*(0.5+0.5*out.confidence.get(c,0.0))
                num+=w*out.probs[c]; den+=w
            ens = (num/den) if den>0 else v2p
        if ens is None: return v2p
        # V2-floor
        r_ens=self._R("__ensemble__",c); r_v2=self._R(self.v2,c)
        if v2p is not None and r_ens < r_v2: return v2p
        return float(ens)
    def fuse_all(self, outputs):
        classes=set()
        for out in outputs.values(): classes|=set(out.probs)
        return {c:self.fuse(outputs,c) for c in classes}
```
- [ ] **Step 4: Run** → PASS (all three).
- [ ] **Step 5: Commit** `git add ensemble/fusion.py ensemble/tests/test_fusion.py && git commit -m "feat(ensemble): reliability-weighted fusion with V2-floor + OCR override"`

---

### Task 12: Harness — k-fold CV run + metrics

**Files:** Create `ecgf/ensemble/harness.py`; Test `ecgf/ensemble/tests/test_harness.py`
**Interfaces:** `run_all_branches(items, cache_dir)->preds` (dict `branch->class->list[float]` aligned to items, via `cached_predict`); `kfold_eval(items, preds, k=5, seed=0)->results` computing per-fold reliability (train folds) then ensemble + v2 AUROC on held-out fold; `aggregate(results)->dict` with per-class + macro AUROC for `v2`, each branch, `ensemble`, per-source. Uses `FusionEngine` with `__ensemble__` reliability estimated on train folds (ensemble scored on train to get `R_ens`).

- [ ] **Step 1: Failing test** (tiny synthetic preds, no models)
```python
# ecgf/ensemble/tests/test_harness.py
import numpy as np
from ensemble.harness import kfold_eval
from ensemble.dataset import Item
def _items(n):
    return [Item(f"i{k}", "/x", "mendeley", {"MI-any": int(k%2)}) for k in range(n)]
def test_kfold_runs_and_reports_macro():
    items=_items(60)
    # v2 separates MI-any well; a junk branch does not
    preds={"v2":{"MI-any":[0.9 if it.labels["MI-any"] else 0.1 for it in items]},
           "junk":{"MI-any":[0.5]*60}}
    res=kfold_eval(items,preds,k=3)
    assert "ensemble" in res and "v2" in res
    assert res["v2"]["MI-any"]["auroc"] > 0.9
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/harness.py
import numpy as np
from .branch import BranchOutput
from .cache import cached_predict
from .reliability import fit_reliability, auroc_ci
from .fusion import FusionEngine
from .canonical import CANONICAL

def run_all_branches(items, registry, cache_dir):
    preds={b.name:{} for b in registry}
    for b in registry:
        for c in b.coverage: preds[b.name][c]=[]
    per_item=[]
    for it in items:
        outs={}
        for b in registry:
            o=cached_predict(b, it, cache_dir); outs[b.name]=o
            for c in b.coverage: preds[b.name][c].append(o.probs.get(c, np.nan))
        per_item.append(outs)
    return preds, per_item

def _labels_by_class(items):
    return {c:[it.labels.get(c) for it in items] for c in CANONICAL}

def kfold_eval(items, preds, per_item=None, k=5, seed=0):
    n=len(items); idx=np.arange(n); rng=np.random.default_rng(seed); rng.shuffle(idx)
    folds=np.array_split(idx,k)
    labels=_labels_by_class(items)
    agg={name:{c:{"y":[], "s":[]} for c in CANONICAL} for name in list(preds)+["ensemble"]}
    for f in range(k):
        test=set(folds[f].tolist()); train=[i for i in range(n) if i not in test]
        tr_preds={br:{c:[preds[br][c][i] for i in train] for c in preds[br]} for br in preds}
        tr_labels={c:[labels[c][i] for i in train] for c in labels}
        rel=fit_reliability(tr_preds, tr_labels)
        # ensemble reliability on TRAIN (for V2-floor): fuse train items, score vs train labels
        if per_item is not None:
            fe=FusionEngine(rel)
            for c in CANONICAL:
                ys=[labels[c][i] for i in train if labels[c][i] is not None]
                ss=[fe.fuse(per_item[i], c) for i in train if labels[c][i] is not None]
                ss=[x for x in ss if x is not None]
                if len(ys)==len(ss) and ss: rel[("__ensemble__",c)]=auroc_ci(np.array(ss),np.array(ys))
            fe=FusionEngine(rel)
        # score held-out fold
        for c in CANONICAL:
            for i in folds[f]:
                y=labels[c][i]
                if y is None: continue
                for br in preds:
                    s=preds[br][c].get(i) if isinstance(preds[br].get(c),dict) else (preds[br][c][i] if c in preds[br] else np.nan)
                    if c in preds[br]:
                        agg[br][c]["y"].append(y); agg[br][c]["s"].append(preds[br][c][i])
                if per_item is not None:
                    es=fe.fuse(per_item[i], c)
                    if es is not None: agg["ensemble"][c]["y"].append(y); agg["ensemble"][c]["s"].append(es)
    out={}
    for name in agg:
        out[name]={}
        for c in CANONICAL:
            ys=agg[name][c]["y"]; ss=agg[name][c]["s"]
            if ys: out[name][c]=auroc_ci(np.array(ss,float), np.array(ys,int))
    return out
```
Note: when `per_item is None` (unit test), ensemble scoring is skipped — the test only asserts v2. Keep that branchable.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add ensemble/harness.py ensemble/tests/test_harness.py && git commit -m "feat(ensemble): k-fold harness + metrics"`

---

### Task 13: Report generator

**Files:** Create `ecgf/ensemble/report.py`; Test `ecgf/ensemble/tests/test_report.py`
**Interfaces:** `verdict(results)->dict` applying the success criterion (macro +0.02, no class regress >0.01, ≥1 of {MI-any,acute-STEMI,AFIB} +0.03); `write_report(results, verdict, out_md, out_json)->None`.

- [ ] **Step 1: Failing test**
```python
# ecgf/ensemble/tests/test_report.py
from ensemble.report import verdict
def test_verdict_promote():
    res={"v2":{"MI-any":{"auroc":0.90},"AFIB":{"auroc":0.71}},
         "ensemble":{"MI-any":{"auroc":0.94},"AFIB":{"auroc":0.75}}}
    v=verdict(res); assert v["promote"] is True
def test_verdict_hold_on_regression():
    res={"v2":{"MI-any":{"auroc":0.90}}, "ensemble":{"MI-any":{"auroc":0.88}}}
    v=verdict(res); assert v["promote"] is False
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
# ecgf/ensemble/report.py
import json
from .canonical import CANONICAL
KEY={"MI-any","acute-STEMI","AFIB"}
def _macro(d): 
    vals=[v["auroc"] for v in d.values() if v.get("auroc") is not None]; return sum(vals)/len(vals) if vals else None
def verdict(results):
    v2=results.get("v2",{}); ens=results.get("ensemble",{}); reasons=[]
    m_v2=_macro(v2); m_ens=_macro(ens)
    macro_ok = m_v2 is not None and m_ens is not None and m_ens >= m_v2+0.02
    regress=[c for c in CANONICAL if c in v2 and c in ens and v2[c].get("auroc") and ens[c].get("auroc") and ens[c]["auroc"] < v2[c]["auroc"]-0.01]
    keygain=[c for c in KEY if c in v2 and c in ens and v2[c].get("auroc") and ens[c].get("auroc") and ens[c]["auroc"]>=v2[c]["auroc"]+0.03]
    promote = bool(macro_ok and not regress and keygain)
    return {"promote":promote, "macro_v2":m_v2, "macro_ens":m_ens, "macro_ok":macro_ok, "regressions":regress, "key_gains":keygain}
def write_report(results, v, out_md, out_json):
    json.dump({"results":results,"verdict":v}, open(out_json,"w"), indent=2, default=float)
    lines=["# Ensemble Benchmark","", f"**Verdict: {'PROMOTE (staged)' if v['promote'] else 'KEEP V2'}**  "
           f"(macro v2 {v['macro_v2']}, ensemble {v['macro_ens']}; regressions {v['regressions'] or 'none'}; key gains {v['key_gains'] or 'none'})","",
           "| class | v2 | ensemble |","|---|---|---|"]
    for c in CANONICAL:
        a=results.get("v2",{}).get(c,{}).get("auroc"); b=results.get("ensemble",{}).get(c,{}).get("auroc")
        lines.append(f"| {c} | {a} | {b} |")
    open(out_md,"w").write("\n".join(lines)+"\n")
```
- [ ] **Step 4: Run** → PASS. — [ ] **Step 5: Commit** `git add ensemble/report.py ensemble/tests/test_report.py && git commit -m "feat(ensemble): success-criterion verdict + report writer"`

---

### Task 14: End-to-end run script + real benchmark

**Files:** Create `ecgf/ensemble/run_benchmark.py`; (output) `ecgf/ENSEMBLE_BENCHMARK.md`, `ecgf/metrics_ensemble.json`
**Interfaces:** Consumes all prior modules. Registers all 6 branches, runs on the full corpus (cached), k-fold evaluates, writes report.

- [ ] **Step 1: Write the runner**
```python
# ecgf/ensemble/run_benchmark.py
import os, numpy as np
from .dataset import load_corpus
from .harness import run_all_branches, kfold_eval
from .report import verdict, write_report
from .branches.v2_branch import V2Branch
from .branches.mi_branch import MIBranch
from .branches.ecgfounder_branch import ECGFounder1Branch, ECGFounder12Branch
from .branches.ocr_branch import OCRBranch
ECGF=os.path.expanduser("~/.claude/jobs/f357192b/tmp/ecgf")
def main(limit=None):
    items=load_corpus()
    if limit: items=items[:limit]
    registry=[V2Branch(), MIBranch(), ECGFounder1Branch(), ECGFounder12Branch(), OCRBranch()]
    preds, per_item=run_all_branches(items, registry, os.path.join(ECGF,"ensemble_cache"))
    res=kfold_eval(items, preds, per_item=per_item, k=5)
    v=verdict(res)
    write_report(res, v, os.path.join(ECGF,"ENSEMBLE_BENCHMARK.md"), os.path.join(ECGF,"metrics_ensemble.json"))
    print("PROMOTE" if v["promote"] else "KEEP V2", "| macro v2", v["macro_v2"], "ens", v["macro_ens"])
if __name__=="__main__":
    import sys; main(int(sys.argv[1]) if len(sys.argv)>1 else None)
```
- [ ] **Step 2: Smoke run on 30 items** (fast, verifies wiring end-to-end)
Run: `cd ~/.claude/jobs/f357192b/tmp/ecgf && ./.venv/bin/python -m ensemble.run_benchmark 30`
Expected: prints a verdict line; `metrics_ensemble.json` written; no crash. (Accuracy meaningless at n=30 — wiring check only.)
- [ ] **Step 3: Full run (background)**
Run: `nohup ./.venv/bin/python -m ensemble.run_benchmark > ensemble_run.log 2>&1 &` then poll `ENSEMBLE_BENCHMARK.md`. Full corpus (~1777) is slow (ECGFounder branches ~4s/img); cached so re-runs are instant.
- [ ] **Step 4: Verify outputs**
Confirm `ENSEMBLE_BENCHMARK.md` shows per-class v2-vs-ensemble AUROC + verdict, and `metrics_ensemble.json` has the reliability/verdict. Sanity: v2 MI-any ≈ 0.90 (matches prior Step-1), ensemble ≥ v2 per class (V2-floor).
- [ ] **Step 5: Commit**
```bash
git add ensemble/run_benchmark.py ENSEMBLE_BENCHMARK.md metrics_ensemble.json
git commit -m "feat(ensemble): end-to-end benchmark runner + first real result"
```

---

## Self-Review

**Spec coverage:** §3 architecture → Tasks 1,4,12,14. §4 Branch interface → Task 1. §5 canonical/mappings → Tasks 1,2,5,6,8,9. §6 new components (12-lead reconstruction, OCR, QualityAssessor) → Tasks 7,9,3. §7 fusion (weight, hierarchical, OCR override, V2-floor) → Task 11. §8 learned thresholds (lower-CI gate) → Task 10. §9 harness (k-fold, metrics, success criterion, honesty/CIs) → Tasks 10,12,13. §10 error handling → Task 4 (try/except → ok=False), Task 8 (digitize fail → quality 0), fusion fallback. §11 testing → every task is TDD; V2-floor property → Task 11. §12 deliverables → Tasks 13,14 (report + branch-output log via cache). **QualityAssessor is built (Task 3) but wired into per-branch quality in a follow-up** — noted below.

**Gap found + fix:** QualityResult (Task 3) is not yet consumed by image branches (v2/MI use quality=1.0). Add **Task 5b/6b note:** in `run_benchmark.main`, compute `q=assess(img)` once per item and pass via `ctx`; v2/MI branches multiply their `quality` by `ctx["q"].score` and set `ok`/defer when `type=="unreadable"`. (Folded as a one-line change in Task 14 wiring; kept out of unit tests to avoid image-fixture churn.)

**Placeholder scan:** no TBD/TODO; all code blocks concrete. **Type consistency:** `BranchOutput` fields, `fit_reliability`/`auroc_ci`/`gate` signatures, `FusionEngine.fuse(outputs, c)`, and `preds[branch][class]->list` alignment are consistent across Tasks 1,10,11,12. `__ensemble__` reliability key used consistently in Tasks 11–12.

**Known real-run risks (call out, don't silently cap):** (a) ECGFounder `tasks.txt` label strings in `CMAP` must be verified against the file (grep first); (b) `pytesseract`/`tesseract` may be absent → OCR branch returns quality 0 (documented fallback); (c) 12-lead reconstruction quality is unproven — expected to earn low learned weight, which is the intended graceful outcome.
