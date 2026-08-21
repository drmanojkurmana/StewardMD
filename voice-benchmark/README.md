# StewardMD Voice ASR benchmark

Finds the best **on-device** speech-to-text model for clinician dictation in
**English / Hindi / Telugu + Indian medical code-switching**. Ranking metric is
**clinical-entity accuracy** (does the transcript preserve the drug / dose / unit /
route / frequency the doctor said), not raw WER. **Benchmark only — no fine-tuning/training.**

## What runs
Model matrix (`scripts/run_all.py`), each in an isolated subprocess:

| model | why |
|---|---|
| whisper-small (multilingual) | FREE-tier candidate |
| whisper-large-v3-turbo | ULTIMATE en/hi candidate |
| vasista22/whisper-telugu-small | PRO Telugu route (ct2 int8) |
| vasista22/whisper-hindi-small  | PRO Hindi route (ct2 int8) |
| ai4bharat/indic-conformer-600m | Indic reference (own NeMo venv) |

Two clip sets, identical audio across models:
- **medical/** — 500 synthetic utterances (100 each en/hi/te/hi_en/te_en), gTTS. Carries entity labels.
- **fleurs/**  — 100 each te/hi/en real FLEURS test clips (CC-BY) for a WER sanity check.

## Run it (local)
```
pip install faster-whisper ctranslate2 transformers torch torchaudio soundfile gTTS jiwer whisper-normalizer "datasets<3"
python scripts/build_corpus.py      # -> results/medical_corpus.jsonl (already committed)
python scripts/synth_audio.py       # needs network (gTTS) + ffmpeg
python scripts/get_fleurs.py
python scripts/run_all.py           # -> results/BENCHMARK.json + BENCHMARK.md
```
score a single hyp file: `python scripts/score.py --ref results/medical_corpus.jsonl --hyp X.jsonl`

## Run it (GCP, ~$1-2)
```
cd voice-benchmark && ./gcp/launch.sh
gsutil cat gs://.../voice-benchmark/out/DONE          # poll until "OK"
gsutil cp gs://.../voice-benchmark/out/BENCHMARK.md . # results
```
Spot e2-standard-8, `--max-run-duration=4h`, `termination-action=DELETE` → self-deletes; hard cost cap.

## Honesty rules baked in
- Models/audio/binaries are `.gitignore`d — only scripts + the text corpus are committed.
- No real patient data anywhere; corpus is synthetic.
- On-device latency numbers stay `[PENDING]` in the report until measured on the actual device;
  VM numbers are server-CPU RTF, labeled as such.

Full analysis + recommendation: `../docs/STEWARDMD_VOICE_AI_BENCHMARK.md`.
