#!/usr/bin/env python3
"""
fast_bench.py — FAST GPU benchmark. 4 models x 60 clips (50 public + 10 medical). ~10 min on an L4.
Self-contained: builds data, runs each model (isolated try/except), scores RAW (no normalization for
medical entities), writes RESULTS.md + results.json. Prints the simple winner block at the end.

Models: whisper-large-v3-turbo, vasista22/whisper-telugu-small, ai4bharat indic-conformer-600m, Qwen3-ASR-0.6B.
"""
import json, os, subprocess, sys, time, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "fastdata"); os.makedirs(AUD, exist_ok=True)
RES = os.path.join(ROOT, "results"); os.makedirs(RES, exist_ok=True)
HF_HUB = os.path.expanduser("~/.cache/huggingface/hub")

# ---------- data ----------
# 10 code-switch sentences per language pair (medical-flavoured); synthesized with clear English TTS so
# the drug/dose terms are audible. Not native CS speech, but IDENTICAL audio across models = fair compare.
TE_EN = [
 "Patient ki fever three days nunchi undi, ceftriaxone one gram IV BD start cheyyandi.",
 "BP high ga undi, amlodipine five mg OD ivvandi.",
 "Sugar ekkuva undi, metformin five hundred mg TDS ivvandi.",
 "Chest pain vasthundi, aspirin seventy five mg stat ivvandi.",
 "Cough tho vచ్చాడు, azithromycin five hundred mg OD three days.",
 "Dehydration undi, normal saline one litre IV start cheyyandi.",
 "Pain ekkuva undi, tramadol fifty mg IM SOS ivvandi.",
 "Vomiting agatledu, ondansetron four mg IV stat ivvandi.",
 "Breathing problem undi, salbutamol nebulization QID cheyyandi.",
 "Infection undi, amoxicillin clavulanate six twenty five mg TDS five days.",
]
HI_EN = [
 "Patient ko fever teen din se hai, ceftriaxone one gram IV BD start karo.",
 "BP high hai, amlodipine five mg OD do.",
 "Sugar zyada hai, metformin five hundred mg TDS do.",
 "Chest pain ho raha hai, aspirin seventy five mg stat do.",
 "Cough ke saath aaya, azithromycin five hundred mg OD three days.",
 "Dehydration hai, normal saline one litre IV start karo.",
 "Pain zyada hai, tramadol fifty mg IM SOS do.",
 "Vomiting ruk nahi rahi, ondansetron four mg IV stat do.",
 "Saans lene mein takleef hai, salbutamol nebulization QID karo.",
 "Infection hai, amoxicillin clavulanate six twenty five mg TDS five days.",
]
# 10 medical mini-test utterances with the entities we score (RAW substring, case-insensitive, +explicit alts).
MEDICAL = [
 {"text":"Patient ki fever three days nunchi undi, ceftriaxone one gram IV BD start cheyyandi.",
  "lang":"te_en","drug":["ceftriaxone"],"dose":["one gram","1 gram","1 g","1g"],"route":["IV"],"freq":["BD"]},
 {"text":"Amlodipine five mg OD start karo blood pressure ke liye.",
  "lang":"hi_en","drug":["amlodipine"],"dose":["five mg","5 mg","5mg"],"route":["oral","PO"],"freq":["OD"]},
 {"text":"Inj paracetamol one gram IV TDS ivvandi fever ki.",
  "lang":"te_en","drug":["paracetamol"],"dose":["one gram","1 gram","1 g"],"route":["IV"],"freq":["TDS"]},
 {"text":"Metformin five hundred mg BD do sugar control ke liye.",
  "lang":"hi_en","drug":["metformin"],"dose":["five hundred mg","500 mg","500mg"],"route":["oral","PO"],"freq":["BD"]},
 {"text":"Azithromycin five hundred mg OD three days ivvandi.",
  "lang":"te_en","drug":["azithromycin"],"dose":["five hundred mg","500 mg"],"route":["oral","PO"],"freq":["OD"]},
 {"text":"Aspirin seventy five mg stat do chest pain ke liye.",
  "lang":"hi_en","drug":["aspirin"],"dose":["seventy five mg","75 mg","75mg"],"route":["oral","PO"],"freq":["stat","STAT"]},
 {"text":"Ondansetron four mg IV stat ivvandi vomiting ki.",
  "lang":"te_en","drug":["ondansetron"],"dose":["four mg","4 mg","4mg"],"route":["IV"],"freq":["stat","STAT"]},
 {"text":"Tramadol fifty mg IM SOS do pain ke liye.",
  "lang":"hi_en","drug":["tramadol"],"dose":["fifty mg","50 mg","50mg"],"route":["IM"],"freq":["SOS","PRN"]},
 {"text":"Normal saline one litre IV over four hours start cheyyandi.",
  "lang":"te_en","drug":["normal saline"],"dose":["one litre","1 litre","1 l"],"route":["IV"],"freq":["over four hours","4 hours"]},
 {"text":"Ceftriaxone two gram IV OD do meningitis ke liye.",
  "lang":"hi_en","drug":["ceftriaxone"],"dose":["two gram","2 gram","2 g"],"route":["IV"],"freq":["OD"]},
]
TTS_LANG = {"en":"en","hi":"hi","te":"te","te_en":"en","hi_en":"en","med":"en"}
FORCE = {"en":"english","hi":"hindi","te":"telugu","te_en":"telugu","hi_en":"hindi","med":"english"}

def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)

def synth(text, lang, path):
    if os.path.exists(path): return
    from gtts import gTTS
    mp3 = path[:-4] + ".mp3"
    gTTS(text, lang=TTS_LANG[lang]).save(mp3)
    sh(f'ffmpeg -y -loglevel error -i "{mp3}" -ar 16000 -ac 1 "{path}"'); os.remove(mp3)

def build_data():
    """Return list of clip dicts {id,audio,lang,ref, [entities]}."""
    clips = []
    # public real audio: FLEURS test 10 each en/hi/te
    try:
        from datasets import load_dataset
        import soundfile as sf
        for lang, cfg in [("en","en_us"),("hi","hi_in"),("te","te_in")]:
            ds = load_dataset("google/fleurs", cfg, split="test", streaming=True, trust_remote_code=True)
            i = 0
            for ex in ds:
                if i >= 10: break
                _id = f"{lang}-{i:02d}"; wav = os.path.join(AUD, _id + ".wav")
                sf.write(wav, ex["audio"]["array"], 16000)
                clips.append({"id":_id,"audio":wav,"lang":lang,"ref":ex["transcription"]}); i += 1
            print(f"  fleurs {lang}: {i}", flush=True)
    except Exception as e:
        print("FLEURS failed:", e, flush=True)
    # code-switch (synth)
    for lang, arr in [("te_en",TE_EN),("hi_en",HI_EN)]:
        for i, t in enumerate(arr):
            _id = f"{lang}-{i:02d}"; wav = os.path.join(AUD, _id + ".wav"); synth(t, lang, wav)
            clips.append({"id":_id,"audio":wav,"lang":lang,"ref":t})
    # medical mini-test (synth) — carries entities
    for i, m in enumerate(MEDICAL):
        _id = f"med-{i:02d}"; wav = os.path.join(AUD, _id + ".wav"); synth(m["text"], "med", wav)
        clips.append({"id":_id,"audio":wav,"lang":"med","ref":m["text"],
                      "entities":{k:m[k] for k in ("drug","dose","route","freq")}})
    print(f"  total clips: {len(clips)}", flush=True)
    return clips

# ---------- model runners (each returns {id: {"text","sec"}} or raises) ----------
def dir_size_mb(pattern):
    tot = 0
    for d in glob.glob(os.path.join(HF_HUB, pattern)):
        for r,_,fs in os.walk(d):
            for f in fs:
                try: tot += os.path.getsize(os.path.join(r,f))
                except: pass
    return round(tot/1e6, 1)

def run_whisper_hf(model_id, clips, force_lang=True):
    import torch
    from transformers import pipeline
    pipe = pipeline("automatic-speech-recognition", model=model_id, device=0, torch_dtype=torch.float16)
    out = {}
    for c in clips:
        lang = FORCE[c["lang"]]
        # some fine-tunes (vasista22) ship an outdated generation_config that rejects BOTH language= and
        # task=; they have Telugu transcribe baked in, so pass NO kwargs and let them decode natively.
        gk = {"language":lang,"task":"transcribe"} if force_lang else {}
        t0 = time.time()
        try:
            r = pipe(c["audio"], generate_kwargs=gk, chunk_length_s=30)
            txt = r["text"]
        except Exception as e:
            txt = f"[ERR {e}]"
        out[c["id"]] = {"text":txt.strip(), "sec":round(time.time()-t0,3)}
    del pipe; torch.cuda.empty_cache()
    return out

def run_indicconformer(clips):
    import torch, torchaudio
    from transformers import AutoModel
    m = AutoModel.from_pretrained("ai4bharat/indic-conformer-600m-multilingual", trust_remote_code=True).to("cuda")
    out = {}
    for c in clips:
        wav, sr = torchaudio.load(c["audio"])
        if sr != 16000: wav = torchaudio.functional.resample(wav, sr, 16000)
        lc = "te" if c["lang"] in ("te","te_en") else "hi"   # no English; en/med default hi
        t0 = time.time()
        try: txt = str(m(wav.to("cuda"), lc, "ctc"))
        except Exception as e:
            try: txt = str(m(wav, lc, "ctc"))
            except Exception as e2: txt = f"[ERR {e2}]"
        out[c["id"]] = {"text":txt.strip(), "sec":round(time.time()-t0,3)}
    del m; torch.cuda.empty_cache()
    return out

def run_qwen(clips):
    # Qwen3-ASR is a dedicated ASR model (NOT CausalLM) — let the ASR pipeline auto-pick the class.
    import torch
    from transformers import pipeline
    pipe = pipeline("automatic-speech-recognition", model="Qwen/Qwen3-ASR-0.6B",
                    device=0, torch_dtype=torch.float16, trust_remote_code=True)
    out = {}
    for c in clips:
        t0 = time.time()
        try:
            txt = pipe(c["audio"], chunk_length_s=30)["text"]
        except Exception as e:
            txt = f"[ERR {e}]"
        out[c["id"]] = {"text":str(txt).strip(), "sec":round(time.time()-t0,3)}
    del pipe; torch.cuda.empty_cache()
    return out

# order: sure things first (whisper via transformers), then the flaky/heavy ones. indic-conformer needs
# NeMo (installed after pass 1), so it errors on pass 1 and is retried on pass 2 via resume.
MODELS = [
 {"name":"whisper-large-v3-turbo", "fn":lambda cl: run_whisper_hf("openai/whisper-large-v3-turbo", cl), "size":"models--openai--whisper-large-v3-turbo"},
 {"name":"vasista22-telugu-small", "fn":lambda cl: run_whisper_hf("vasista22/whisper-telugu-small", cl, force_lang=False), "size":"models--vasista22--whisper-telugu-small"},
 {"name":"qwen3-asr-0.6b",         "fn":run_qwen, "size":"models--Qwen--Qwen3-ASR-0.6B"},
 {"name":"indic-conformer-600m",   "fn":run_indicconformer, "size":"models--ai4bharat--indic-conformer-600m-multilingual"},
]

# ---------- scoring ----------
def wer(ref, hyp):
    try:
        import jiwer
        def n(s): return " ".join("".join(ch for ch in s.lower() if ch.isalnum() or ch.isspace()).split())
        r, h = n(ref), n(hyp)
        return round(jiwer.wer(r, h)*100, 1) if r else None
    except Exception:
        return None

def entity_present(hyp, alts):
    # RAW transcript (never modified). Case-insensitive, and we ALSO accept the no-space spelling of each
    # expected form (e.g. "5mg" for "5 mg") — that broadens valid answers, it does not normalize the hyp.
    h = hyp.lower()
    accepted = set()
    for a in alts:
        a = a.lower(); accepted.add(a); accepted.add(a.replace(" ", ""))
    return any(a in h for a in accepted)

def score(clips, hyps):
    langs = ["en","hi","te","te_en","hi_en"]
    per_lang = {}
    for lang in langs:
        cs = [c for c in clips if c["lang"]==lang]
        ws = [wer(c["ref"], hyps.get(c["id"],{}).get("text","")) for c in cs]
        ws = [w for w in ws if w is not None]
        per_lang[lang] = round(sum(ws)/len(ws),1) if ws else None
    # medical entity preservation (RAW)
    ent = {"drug":[0,0],"dose":[0,0],"route":[0,0],"freq":[0,0]}
    med_detail = []
    for c in clips:
        if c["lang"]!="med": continue
        hyp = hyps.get(c["id"],{}).get("text","")
        row = {"ref":c["ref"],"hyp":hyp,"hits":{}}
        for k,alts in c["entities"].items():
            hit = entity_present(hyp, alts); ent[k][0]+=hit; ent[k][1]+=1; row["hits"][k]=bool(hit)
        med_detail.append(row)
    ent_pct = {k:(round(100*v[0]/v[1],0) if v[1] else None) for k,v in ent.items()}
    secs = [v["sec"] for v in hyps.values() if isinstance(v.get("sec"),(int,float))]
    avg_sec = round(sum(secs)/len(secs),3) if secs else None
    return {"per_lang_wer":per_lang, "entity_pct":ent_pct, "avg_sec_per_clip":avg_sec, "medical":med_detail}

def main():
    print("=== build data ===", flush=True)
    clips = build_data()
    # resume: keep models already scored OK (retry errored/missing ones) — lets pass 2 add indic after NeMo
    jf = os.path.join(RES,"fast_results.json")
    results = json.load(open(jf)) if os.path.exists(jf) else {}
    for m in MODELS:
        if m["name"] in results and not results[m["name"]].get("error"):
            print(f"=== {m['name']} (cached, skip) ===", flush=True); continue
        print(f"=== {m['name']} ===", flush=True)
        t0 = time.time()
        try:
            hyps = m["fn"](clips)
            sc = score(clips, hyps)
            sc["size_mb"] = dir_size_mb(m["size"])
            sc["wall_sec"] = round(time.time()-t0,1)
            sc["hyps"] = hyps
            results[m["name"]] = sc
            print(f"  ok: wer={sc['per_lang_wer']} ent={sc['entity_pct']} size={sc['size_mb']}MB", flush=True)
        except Exception as e:
            results[m["name"]] = {"error":f"{type(e).__name__}: {e}", "size_mb":dir_size_mb(m["size"])}
            print(f"  ERROR: {e}", flush=True)
        json.dump(results, open(os.path.join(RES,"fast_results.json"),"w"), ensure_ascii=False, indent=1)
    write_md(clips, results)
    print("DONE", flush=True)

def write_md(clips, results):
    L=["# Fast GPU Voice Benchmark — 4 models x 60 clips (50 public + 10 medical)","",
       "WER = word error rate % (lower better). Entity % = RAW medical-term preservation (no normalization).",""]
    L.append("| Model | English WER | Hindi WER | Telugu WER | CS te_en/hi_en WER | Med entity % (drug/dose/route/freq) | Avg s/clip | Size MB |")
    L.append("|---|---|---|---|---|---|---|---|")
    for name,r in results.items():
        if r.get("error"):
            L.append(f"| {name} | ERROR: {r['error'][:60]} |||||| {r.get('size_mb','?')} |"); continue
        pl=r["per_lang_wer"]; e=r["entity_pct"]
        L.append(f"| {name} | {pl['en']} | {pl['hi']} | {pl['te']} | {pl['te_en']}/{pl['hi_en']} | "
                 f"{e['drug']}/{e['dose']}/{e['route']}/{e['freq']} | {r['avg_sec_per_clip']} | {r['size_mb']} |")
    L.append("")
    # example transcripts per language (first 3 clips per lang) for each ok model
    for name,r in results.items():
        if r.get("error"): continue
        L.append(f"\n## {name} — sample transcripts")
        hy=r["hyps"]
        for lang in ["en","hi","te","te_en","hi_en"]:
            cs=[c for c in clips if c["lang"]==lang][:3]
            L.append(f"\n**{lang}**")
            for c in cs:
                L.append(f"- REF: {c['ref']}")
                L.append(f"- HYP: {hy.get(c['id'],{}).get('text','')}")
        L.append("\n**medical (entity preservation)**")
        for row in r["medical"]:
            L.append(f"- REF: {row['ref']}")
            L.append(f"- HYP: {row['hyp']}")
            L.append(f"  hits: {row['hits']}")
    open(os.path.join(RES,"RESULTS.md"),"w").write("\n".join(L)+"\n")

if __name__ == "__main__":
    main()
