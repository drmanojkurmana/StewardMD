#!/usr/bin/env python3
"""
synth_audio.py — TTS the medical corpus to 16 kHz mono WAV (same audio for every model).
gTTS (needs network) for te/hi/en; code-switch spoken in the base language (hi_en->hi, te_en->te).
Writes datasets/medical/<id>.wav + results/medical_manifest.jsonl {id,audio,lang}.
Note: TTS voice, not clinician speech — but IDENTICAL audio across models = a fair relative comparison.
"""
import json, os, subprocess, sys
from gtts import gTTS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "results", "medical_corpus.jsonl")
ADIR = os.path.join(ROOT, "datasets", "medical"); os.makedirs(ADIR, exist_ok=True)
MANI = os.path.join(ROOT, "results", "medical_manifest.jsonl")
TLANG = {"en": "en", "hi": "hi", "te": "te", "hi_en": "hi", "te_en": "te"}

def main():
    rows = [json.loads(l) for l in open(CORPUS) if l.strip()]
    man = []
    for i, r in enumerate(rows):
        wav = os.path.join(ADIR, r["id"] + ".wav")
        if not os.path.exists(wav):
            mp3 = wav[:-4] + ".mp3"
            gTTS(r["text"], lang=TLANG[r["lang"]]).save(mp3)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3, "-ar", "16000", "-ac", "1", wav], check=True)
            os.remove(mp3)
        man.append({"id": r["id"], "audio": wav, "lang": r["lang"]})
        if i % 50 == 0: print(f"  {i}/{len(rows)}", flush=True)
    with open(MANI, "w") as fh:
        for m in man: fh.write(json.dumps(m, ensure_ascii=False) + "\n")
    print(f"OK {len(man)} clips -> {ADIR}")

if __name__ == "__main__":
    main()
