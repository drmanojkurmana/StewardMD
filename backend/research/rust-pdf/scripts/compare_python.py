"""Compare the Rust reader with the worker's extract.py on a set of PDFs.

Usage: python compare_python.py RUN_FILE_BINARY PDF [PDF ...]
Run from the repo root with a venv that has pdfplumber 0.11.

The reference is the pdfplumber version of extract.py, read from git history
(REF below): the worker itself now uses this crate, so comparing against the
current file would compare the crate with itself.

OCR is switched off on the Python side (Rust leaves it to Python), so this
compares page sizes, words with boxes, page text and tables, exactly. A page
Rust marks needs_ocr must be one Python would OCR.
"""
import json
import os
import subprocess
import sys
import time

import types  # noqa: E402

# Last commit where extract.py read PDFs with pdfplumber.
REF = os.environ.get("EXTRACT_REF", "f7dcae3b8b3f53937f245f51252a62c2ca14a5c8")
_src = subprocess.run(["git", "show", REF + ":backend/research/worker/research_worker/extract.py"],
                      capture_output=True, check=True, text=True).stdout
ex = types.ModuleType("extract_pdfplumber_reference")
exec(compile(_src, "extract_pdfplumber_reference.py", "exec"), ex.__dict__)

ex._ocr_page = lambda page, deadline, cancel: ([], "")


def py_run(data):
    t = time.perf_counter()
    try:
        out = ex.extract_pdf(data, max_pages=10_000)
    except (ex.CeilingError, ex.ExtractError) as e:
        out = {"error": e.code}
    return out, time.perf_counter() - t


def rs_run(binary, path):
    t = time.perf_counter()
    out = subprocess.run([binary, path, "--max-pages", "10000"], capture_output=True, check=True).stdout
    return json.loads(out), time.perf_counter() - t


def diff_page(pp, rp):
    probs = []
    if rp.get("needs_ocr"):
        if not pp["ocr"]:
            probs.append("rust says OCR, python has text")
        return probs
    if pp["ocr"]:
        return ["python OCRs, rust found text"]
    for k in ("n", "width", "height", "text", "tables"):
        if pp[k] != rp[k]:
            probs.append(f"{k}: py={pp[k]!r:.200} rs={rp[k]!r:.200}")
    pw, rw = pp["words"], rp["words"]
    if len(pw) != len(rw):
        probs.append(f"word count py={len(pw)} rs={len(rw)}")
    for i, (a, b) in enumerate(zip(pw, rw)):
        if a != b:
            probs.append(f"word {i}: py={a} rs={b}")
            break
    return probs


def main():
    binary, paths = sys.argv[1], sys.argv[2:]
    total_py = total_rs = 0.0
    bad = 0
    for path in paths:
        data = open(path, "rb").read()
        po, pt = py_run(data)
        ro, rt = rs_run(binary, path)
        name = os.path.basename(path)
        if "unsupported" in ro:
            print(f"{name}: rust hands back to python ({ro['unsupported']}), python {pt:.2f}s")
            continue
        if "error" in po or "error" in ro:
            ok = po.get("error") == ro.get("error")
            print(f"{name}: errors py={po.get('error')} rs={ro.get('error')} {'OK' if ok else 'MISMATCH'}")
            bad += not ok
            continue
        total_py += pt
        total_rs += rt
        probs = []
        if len(po["pages"]) != len(ro["pages"]):
            probs.append(f"page count py={len(po['pages'])} rs={len(ro['pages'])}")
        for pp, rp in zip(po["pages"], ro["pages"]):
            for p in diff_page(pp, rp):
                probs.append(f"p{pp['n']}: {p}")
        if po["sha256"] != ro["sha256"]:
            probs.append("sha256 differs")
        nwords = sum(len(p["words"]) for p in po["pages"])
        ntables = sum(len(p["tables"]) for p in po["pages"])
        status = "MATCH" if not probs else "DIFF"
        print(f"{name}: {status} pages={len(po['pages'])} words={nwords} tables={ntables} py={pt:.3f}s rs={rt:.3f}s")
        for p in probs[:8]:
            print("   ", p)
        bad += bool(probs)
    print(f"TOTAL py={total_py:.2f}s rs={total_rs:.2f}s files_with_diffs={bad}")


main()
