"""KB disease search: Needle 3 (Cactus engine) vs EmbeddingGemma 2 vs lexical, on author-written queries.

  python embed_bench.py docs   OUT.npz  --needle WEIGHTS          # Needle doc vectors
  python embed_bench.py docs   OUT.npz  --server http://127.0.0.1:8099   # EmbeddingGemma 2 via llama-server
  python embed_bench.py score  --kb kb/dist/kb.disease-docs.json --queries queries.jsonl \
         --needle-npz N.npz --needle WEIGHTS --eg-npz E.npz --server URL

Docs are the first CHARS characters of each kb.disease-docs.json text (same cut for every model).
EmbeddingGemma prefixes are the ones the app's shipped vector set uses (maik-models.js):
documents "title: none | text: ", queries "task: search result | query: ".
Telemetry: run with CACTUS_TELEMETRY=0 DO_NOT_TRACK=1.
"""
import argparse, json, math, re, sys, time, urllib.request
from collections import Counter
import numpy as np

CHARS = 600
DOC_PREFIX = "title: none | text: "
QUERY_PREFIX = "task: search result | query: "

def load_kb(p):
    d = json.load(open(p))
    return [x["id"] for x in d], [x["text"][:CHARS] for x in d]

def norm(m):
    m = np.asarray(m, dtype=np.float32)
    n = np.linalg.norm(m, axis=-1, keepdims=True); n[n < 1e-12] = 1
    return m / n

def needle_embed(weights):
    import cactus
    nd = cactus.Needle(weights=weights)
    return lambda texts: [nd.embed(t) for t in texts]

def server_embed(url, prefix):
    def f(texts):
        out = []
        for i in range(0, len(texts), 16):
            body = json.dumps({"input": [prefix + t for t in texts[i:i + 16]], "model": "eg2"}).encode()
            req = urllib.request.Request(url + "/v1/embeddings", body, {"Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=600))
            out += [e["embedding"] for e in sorted(r["data"], key=lambda e: e["index"])]
        return out
    return f

TOK = re.compile(r"[a-z0-9]+")
def toks(s): return TOK.findall(s.lower())

class BM25:
    def __init__(self, ids, docs, k1=1.2, b=0.75):
        # the disease id (name) is repeated three times: lexical search in the app also leans on names
        self.d = [toks(i.replace("_", " ")) * 3 + toks(t) for i, t in zip(ids, docs)]
        self.N = len(self.d); self.avg = sum(map(len, self.d)) / self.N; self.k1, self.b = k1, b
        df = Counter(); [df.update(set(x)) for x in self.d]
        self.idf = {w: math.log(1 + (self.N - n + .5) / (n + .5)) for w, n in df.items()}
        self.tf = [Counter(x) for x in self.d]
    def scores(self, q):
        qs = toks(q); s = np.zeros(self.N, dtype=np.float32)
        for j, tf in enumerate(self.tf):
            L = len(self.d[j]); v = 0.0
            for w in qs:
                f = tf.get(w)
                if f: v += self.idf[w] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * L / self.avg))
            s[j] = v
        return s

def ranks(score_rows, ids, queries):
    res = []
    for q, s in zip(queries, score_rows):
        order = np.argsort(-s)
        rx = re.compile(q["accept"])
        r = next((k + 1 for k, j in enumerate(order[:200]) if rx.search(ids[j])), None)
        res.append((q, r, [ids[j] for j in order[:3]]))
    return res

def summary(name, res):
    cats = sorted(set(q["cat"] for q, _, _ in res))
    def m(rs):
        n = len(rs); h1 = sum(1 for _, r, _ in rs if r == 1); h5 = sum(1 for _, r, _ in rs if r and r <= 5)
        mrr = sum(1 / r for _, r, _ in rs if r) / n
        return "%2d/%2d top-1, %2d/%2d top-5, MRR %.2f" % (h1, n, h5, n, mrr)
    print("%-22s ALL  %s" % (name, m(res)))
    for c in cats: print("%-22s %-8s %s" % ("", c, m([x for x in res if x[0]["cat"] == c])))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode"); ap.add_argument("out", nargs="?")
    ap.add_argument("--kb", default="kb/dist/kb.disease-docs.json"); ap.add_argument("--queries")
    ap.add_argument("--needle"); ap.add_argument("--server")
    ap.add_argument("--needle-npz"); ap.add_argument("--eg-npz"); ap.add_argument("--show", action="store_true")
    ap.add_argument("--app", help="app_names.mjs output: the app's own offline name match per query")
    a = ap.parse_args()
    ids, docs = load_kb(a.kb)
    if a.mode == "docs":
        # Resumable: vectors are appended to OUT.partial.npy every 200 docs, so a stopped run continues.
        import os
        f = needle_embed(a.needle) if a.needle else server_embed(a.server, DOC_PREFIX)
        part = a.out + ".partial.npy"
        V = list(np.load(part)) if os.path.exists(part) else []
        t = time.time(); start = len(V)
        for i in range(start, len(docs), 200):
            V += [np.asarray(v, dtype=np.float32) for v in f(docs[i:i + 200])]
            np.save(part, np.stack(V)); print("docs %d/%d" % (len(V), len(docs)), flush=True)
        el = time.time() - t; n = max(1, len(V) - start)
        np.savez_compressed(a.out, v=norm(np.stack(V))); os.remove(part)
        print("docs", len(V), "dims", len(V[0]), "%.1f s (%.1f ms/doc this run)" % (el, 1000 * el / n))
        return
    Q = [json.loads(l) for l in open(a.queries)]
    qs = [q["q"] for q in Q]
    out = {}
    bm = BM25(ids, docs); out["lexical BM25"] = ranks([bm.scores(q) for q in qs], ids, Q)
    if a.needle_npz:
        D = np.load(a.needle_npz)["v"]; t = time.time(); qv = norm(needle_embed(a.needle)(qs))
        print("needle query embed %.1f ms/query (this CPU)" % (1000 * (time.time() - t) / len(qs)))
        out["Needle 3 (4.1.0)"] = ranks(qv @ D.T, ids, Q)
    if a.eg_npz:
        D = np.load(a.eg_npz)["v"]; t = time.time(); qv = norm(server_embed(a.server, QUERY_PREFIX)(qs))
        print("embeddinggemma-2 query embed %.1f ms/query (this CPU, batched)" % (1000 * (time.time() - t) / len(qs)))
        out["EmbeddingGemma 2 Q5"] = ranks(qv @ D.T, ids, Q)
        if "lexical BM25" in out:   # reciprocal-rank fusion, the shape steward-ai uses for hybrid retrieval
            bs = [bm.scores(q) for q in qs]; es = qv @ D.T; fused = []
            for b, e in zip(bs, es):
                rb = np.empty(len(ids)); rb[np.argsort(-b)] = np.arange(1, len(ids) + 1)
                re_ = np.empty(len(ids)); re_[np.argsort(-e)] = np.arange(1, len(ids) + 1)
                fused.append(1 / (60 + rb) + 1 / (60 + re_))
            out["EG2 + BM25 (RRF)"] = ranks(fused, ids, Q)
    for k, v in out.items(): summary(k, v)
    if a.app:   # the realistic pipeline: the app's name match answers first; the model only when it found nothing
        app = {j["q"]: j for j in (json.loads(l) for l in open(a.app))}
        print("\napp name match first, else the method's top-1 (right / wrong disease shown / none):")
        for k, v in out.items():
            right = wrong = 0
            for q, r, top in v:
                j = app[q["q"]]
                if j["id"]: right += j["ok"]; wrong += not j["ok"]
                elif r == 1: right += 1
                else: wrong += 1
            print("  %-22s %2d right, %2d wrong" % (k, right, wrong))
        n_right = sum(1 for j in app.values() if j["ok"]); n_wrong = sum(1 for j in app.values() if j["id"] and not j["ok"])
        print("  %-22s %2d right, %2d wrong, %2d no answer" % ("app name match alone", n_right, n_wrong, len(app) - n_right - n_wrong))
    if a.show:
        for k, v in out.items():
            print("\n==", k)
            for q, r, top in v: print("  %-45s rank %-4s %s" % (q["q"], r, top))

if __name__ == "__main__": main()
