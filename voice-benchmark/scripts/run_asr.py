#!/usr/bin/env python3
"""
run_asr.py — transcribe a manifest of clips with one model; emit hyps.jsonl + timing.

Engines:
  fw  = faster-whisper (CTranslate2). Handles base names ("small","large-v3-turbo") and
        local CT2 dirs (converted fine-tunes e.g. vasista22/whisper-*-small).
  ic  = AI4Bharat IndicConformer (transformers AutoModel, trust_remote_code). CTC decode.

Manifest rows: {"id","audio","lang"}   (lang in en|hi|te|hi_en|te_en)
Out (hyps.jsonl): {"id","text"}   + a sibling <out>.timing.json with RTF/wall.

Language mapping for forced decoding: hi_en->hi, te_en->te (code-switch spoken in base lang).
CPU-only friendly. Records real wall time + audio duration for RTF. No fabrication.
"""
import argparse, json, os, sys, time, wave, contextlib

LANG_MAP = {"en": "en", "hi": "hi", "te": "te", "hi_en": "hi", "te_en": "te"}

def wav_secs(path):
    try:
        with contextlib.closing(wave.open(path, "r")) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 0.0

def run_fw(model_id, rows, force_lang):
    from faster_whisper import WhisperModel
    m = WhisperModel(model_id, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    out = []
    for r in rows:
        lang = LANG_MAP.get(r["lang"]) if force_lang else None
        segs, _ = m.transcribe(r["audio"], language=lang, beam_size=1, vad_filter=False)
        out.append({"id": r["id"], "text": " ".join(s.text for s in segs).strip()})
    return out

def run_ic(model_id, rows, force_lang):
    import torch, torchaudio  # noqa
    from transformers import AutoModel
    m = AutoModel.from_pretrained(model_id, trust_remote_code=True)
    out = []
    for r in rows:
        import torchaudio
        wav, sr = torchaudio.load(r["audio"])
        if sr != 16000:
            wav = torchaudio.functional.resample(wav, sr, 16000)
        lang = LANG_MAP.get(r["lang"], "hi")   # IndicConformer needs an explicit Indian lang; en->hi (no English support)
        lc = "te" if lang == "te" else "hi"
        try:
            txt = m(wav, lc, "ctc")
        except Exception as e:
            txt = ""
        out.append({"id": r["id"], "text": str(txt).strip()})
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["fw", "ic"], required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--force-lang", action="store_true")
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.manifest) if l.strip()]
    audio_secs = sum(wav_secs(r["audio"]) for r in rows)
    t0 = time.time()
    out = (run_fw if a.engine == "fw" else run_ic)(a.model, rows, a.force_lang)
    wall = time.time() - t0
    with open(a.out, "w") as fh:
        for o in out:
            fh.write(json.dumps(o, ensure_ascii=False) + "\n")
    timing = {"model": a.model, "engine": a.engine, "clips": len(rows),
              "audio_secs": round(audio_secs, 1), "wall_secs": round(wall, 1),
              "rtf": round(wall / audio_secs, 3) if audio_secs else None}
    json.dump(timing, open(a.out + ".timing.json", "w"), indent=2)
    print(json.dumps(timing))

if __name__ == "__main__":
    main()
