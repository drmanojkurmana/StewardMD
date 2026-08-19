#!/usr/bin/env python3
"""
score.py — score ASR hypotheses against the medical corpus + FLEURS refs.

Two metric families:
  (A) WER / CER   — jiwer + Indic-aware normalization (whisper_normalizer if present, else builtin).
  (B) Clinical-entity accuracy — the RANKING metric: does the hypothesis preserve the
      drug / dose / unit / route / frequency / number the doctor said? (WER-agnostic.)

Inputs:
  --ref   refs.jsonl   rows: {"id","lang","text","entities":{...}}  (entities optional for FLEURS)
  --hyp   hyps.jsonl   rows: {"id","text"}
Output: JSON to stdout (and --out) with per-language WER/CER + entity accuracies.

Pure stdlib + optional jiwer/whisper_normalizer. Runs anywhere.
"""
import argparse, json, re, sys, unicodedata

try:
    import jiwer  # noqa
    HAVE_JIWER = True
except Exception:
    HAVE_JIWER = False
try:
    from whisper_normalizer.indic_normalizer import IndicTextNormalizer  # type: ignore
    HAVE_INDIC = True
except Exception:
    HAVE_INDIC = False

WORD2NUM = {"zero":"0","one":"1","two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7",
            "eight":"8","nine":"9","ten":"10","half":"0.5","point":"."}
ROUTE_ALIASES = {
    "IV": ["iv","i v","intravenous","intravenously"], "IM": ["im","i m","intramuscular"],
    "PO": ["po","p o","oral","orally","by mouth","per oral"], "SC": ["sc","s c","subcutaneous","subcut"],
}
FREQ_ALIASES = {
    "OD": ["od","o d","once daily","once a day","q24h"], "BD": ["bd","b d","bid","twice daily","twice a day"],
    "TDS": ["tds","t d s","tid","three times","thrice"], "QID": ["qid","four times"],
    "HS": ["hs","at night","bedtime","nocte"], "SOS": ["sos","prn","if needed","as needed"],
    "STAT": ["stat","immediately","now","at once"], "Q6H": ["q6h","every 6 hours","6 hourly"],
    "Q8H": ["q8h","every 8 hours","8 hourly"],
}
UNIT_ALIASES = {
    "mg": ["mg","milligram","milligrams","milli gram"], "g": ["g","gram","grams","gm"],
    "mcg": ["mcg","microgram","micrograms","ug"], "ml": ["ml","millilitre","milliliter","mls"],
    "units": ["units","unit","u"], "IU": ["iu","international unit","international units"],
}

def norm(s):
    s = unicodedata.normalize("NFC", str(s or "")).lower()
    s = s.replace("‌", "").replace("‍", "")            # ZWNJ/ZWJ
    s = re.sub(r"[^\wऀ-ॿఀ-౿\s.]", " ", s)     # keep latin, devanagari, telugu, dot
    s = re.sub(r"\s+", " ", s).strip()
    return s

def spoken_to_digits(s):
    return " ".join(WORD2NUM.get(w, w) for w in s.split())

def indic_norm(s, lang):
    if HAVE_INDIC and lang in ("hi", "te"):
        try:
            code = "hi" if lang == "hi" else "te"
            return IndicTextNormalizer(code).normalize(str(s))
        except Exception:
            pass
    return s

def wer_cer(refs, hyps):
    if HAVE_JIWER:
        w = jiwer.wer(refs, hyps) if refs else 0.0
        c = jiwer.cer(refs, hyps) if refs else 0.0
        return round(w * 100, 2), round(c * 100, 2)
    # tiny fallback WER (Levenshtein on words) so the script never hard-fails without jiwer
    def lev(a, b):
        dp = list(range(len(b) + 1))
        for i, x in enumerate(a, 1):
            prev = dp[0]; dp[0] = i
            for j, y in enumerate(b, 1):
                prev, dp[j] = dp[j], min(dp[j] + 1, dp[j-1] + 1, prev + (x != y))
        return dp[-1]
    tot_w = tot_c = err_w = err_c = 0
    for r, h in zip(refs, hyps):
        rw, hw = r.split(), h.split()
        err_w += lev(rw, hw); tot_w += len(rw) or 1
        err_c += lev(list(r), list(h)); tot_c += len(r) or 1
    return round(100 * err_w / tot_w, 2), round(100 * err_c / tot_c, 2)

def entity_hit(kind, gold, hyp_norm):
    if not gold:
        return None
    g = str(gold).lower().strip()
    if kind == "drug":
        return 1 if g in hyp_norm else 0                        # normalized substring
    if kind in ("dose", "number"):
        d = spoken_to_digits(hyp_norm)
        return 1 if (g in d.split() or g in d) else 0
    table = {"route": ROUTE_ALIASES, "freq": FREQ_ALIASES, "unit": UNIT_ALIASES}.get(kind)
    if table is not None:
        for canon, aliases in table.items():
            if canon.lower() == g or g in [a.lower() for a in aliases]:
                return 1 if any(a in hyp_norm for a in ([canon.lower()] + aliases)) else 0
        return 1 if g in hyp_norm else 0
    if kind in ("dx", "lab"):
        toks = [t for t in re.split(r"\W+", g) if len(t) >= 2]   # keep acronyms (ECG/CBC/CRP)
        if not toks:
            return 0
        need = 1 if len(toks) == 1 else max(1, (len(toks) + 1) // 2)   # single→require it, phrase→majority
        return 1 if sum(t in hyp_norm for t in toks) >= need else 0
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True); ap.add_argument("--hyp", required=True)
    ap.add_argument("--model", default="?"); ap.add_argument("--out")
    a = ap.parse_args()
    refs = {json.loads(l)["id"]: json.loads(l) for l in open(a.ref) if l.strip()}
    hyps = {json.loads(l)["id"]: json.loads(l).get("text", "") for l in open(a.hyp) if l.strip()}
    by_lang = {}
    ent_kinds = ["drug", "dose", "unit", "route", "freq", "number", "dx", "lab"]
    ent = {k: [0, 0] for k in ent_kinds}
    for _id, r in refs.items():
        lang = r.get("lang", "en"); h = hyps.get(_id, "")
        rn = indic_norm(norm(r["text"]), lang); hn = indic_norm(norm(h), lang)
        by_lang.setdefault(lang, {"ref": [], "hyp": []})
        by_lang[lang]["ref"].append(rn); by_lang[lang]["hyp"].append(hn)
        for k in ent_kinds:
            gold = (r.get("entities") or {}).get(k)
            if k == "number":
                gold = ((r.get("entities") or {}).get("numbers") or [None])[0]
            hit = entity_hit(k, gold, hn)
            if hit is not None:
                ent[k][0] += hit; ent[k][1] += 1
    langs = {}
    for lang, d in by_lang.items():
        w, c = wer_cer(d["ref"], d["hyp"]); langs[lang] = {"n": len(d["ref"]), "WER": w, "CER": c}
    entity = {k: (round(100 * v[0] / v[1], 1) if v[1] else None) for k, v in ent.items()}
    overall = [entity[k] for k in ["drug","dose","unit","route","freq"] if entity[k] is not None]
    result = {"model": a.model, "haveJiwer": HAVE_JIWER, "haveIndicNorm": HAVE_INDIC,
              "languages": langs, "entity_accuracy_pct": entity,
              "clinical_entity_overall_pct": round(sum(overall)/len(overall), 1) if overall else None}
    txt = json.dumps(result, ensure_ascii=False, indent=2)
    print(txt)
    if a.out:
        open(a.out, "w").write(txt)

if __name__ == "__main__":
    main()
