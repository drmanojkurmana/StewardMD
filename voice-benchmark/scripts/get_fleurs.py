#!/usr/bin/env python3
"""
get_fleurs.py — pull FLEURS test audio for te/hi/en (N per lang) as 16 kHz mono WAV.
Same clips used for every model. Writes datasets/fleurs/<id>.wav + results/fleurs_refs.jsonl
({id,lang,text}) + results/fleurs_manifest.jsonl ({id,audio,lang}). CC-BY-4.0.
"""
import json, os, sys
import soundfile as sf
from datasets import load_dataset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADIR = os.path.join(ROOT, "datasets", "fleurs"); os.makedirs(ADIR, exist_ok=True)
REFS = os.path.join(ROOT, "results", "fleurs_refs.jsonl")
MANI = os.path.join(ROOT, "results", "fleurs_manifest.jsonl")
CFG = {"te": "te_in", "hi": "hi_in", "en": "en_us"}
N = int(os.environ.get("FLEURS_N", "100"))

def main():
    refs, man = [], []
    for lang, cfg in CFG.items():
        ds = load_dataset("google/fleurs", cfg, split="test", streaming=True, trust_remote_code=True)
        i = 0
        for ex in ds:
            if i >= N: break
            _id = f"fleurs-{lang}-{i:03d}"
            wav = os.path.join(ADIR, _id + ".wav")
            a = ex["audio"]
            sf.write(wav, a["array"], 16000)  # FLEURS is already 16k
            refs.append({"id": _id, "lang": lang, "text": ex["transcription"]})
            man.append({"id": _id, "audio": wav, "lang": lang})
            i += 1
        print(f"  {lang}: {i} clips", flush=True)
    with open(REFS, "w") as fh:
        for r in refs: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(MANI, "w") as fh:
        for m in man: fh.write(json.dumps(m, ensure_ascii=False) + "\n")
    print(f"OK {len(man)} FLEURS clips")

if __name__ == "__main__":
    main()
