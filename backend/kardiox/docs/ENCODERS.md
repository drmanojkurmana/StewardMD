# KardioX — Foundation Encoders (ECG-FM / DeepECG-SSL / HeartGPT)

Foundation ECG encoders are **self-supervised feature extractors** with commercially-licensed public
weights. They emit **embeddings, not diagnoses** — so KardioX integrates them as (1) feature extractors
and (2) fine-tuning bases, and does **not** claim they classify on their own. Multiple encoders can run
simultaneously (concatenated embeddings via the ensemble backend). KardioX ships **no weights**; each
encoder is Not-Ready until its checkpoint is configured.

| Encoder | Source | License | Input spec | Notes |
|---|---|---|---|---|
| **ECG-FM** | bowang-lab / HF `wanglab/ecg-fm` | **MIT** | `ecgfm_500hz_5s` | wav2vec2 SSL (fairseq-signals) |
| **DeepECG-SSL** | HeartWise-AI / HF `heartwise` | Apache-2.0* | `deepecg_250hz_10s` | contrastive/masked-lead SSL (*confirm bare-encoder license) |
| **HeartGPT** | harryjdavies/HeartGPT | **MIT** | `heartgpt_leadii` | decoder-only transformer over a tokenized single lead |

## Export once, then wire by config
KardioX loads each encoder through its **exported** checkpoint via the verified `ModelBackend` seam — it
does not re-implement fairseq-signals / GPT loaders. Export the encoder to **ONNX** (preferred) or
TorchScript in a training env (confirm the input length/normalization in each model card; ECG-FM may need
a thin nn.Module wrapper around the fairseq-signals model before tracing), then:
```
KARDIOX_ENCODERS_JSON='{"ecg-fm": {"path": "/models/ecgfm_encoder.onnx", "kind": "onnx"}}'
```
`/v1/health` lists each encoder under `encoders[]` (ready only when a checkpoint + runtime are present).

## Use 1 — feature extraction (embeddings)
```python
from app.services.models import get_encoder
emb = get_encoder("ecg-fm").encode(signal)   # numpy embedding; raises Not-Ready until configured
```

## Use 2 — fine-tune a head (the clinical path)
An encoder + a trained head = a classifier. Train the head with `FineTuningPipeline` (automatic
head-adaptation to your label count), export the (encoder+head) to ONNX, register it in the `ModelRegistry`,
and serve it through the ONNX model seam like any classifier (its outputs then flow into the fusion /
Differential Diagnosis Engine). See `docs/TRAINING.md` § *Foundation-model fine-tuning*.
```
KARDIOX_PROVIDER_RHYTHM=torchecg  KARDIOX_RHYTHM_MODEL_KIND=onnx \
KARDIOX_RHYTHM_MODEL_PATH=/models/ecgfm_head.onnx  KARDIOX_RHYTHM_MODEL_INPUT_SPEC=ecgfm_500hz_5s
```

## Multiple encoders simultaneously
Load several via an `EnsembleBackend`; its `raw()` **concatenates** member embeddings, giving a combined
feature vector a head can consume.

## Honesty + validation
Not Ready (raises `pipeline_unavailable`) until configured + runtime installed; never fabricates an
embedding. Fine-tuned heads require clinical validation + calibration before `smd_kardiox` is enabled.
