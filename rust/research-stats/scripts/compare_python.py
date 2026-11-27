#!/usr/bin/env python3
"""Replay the same inputs through the Python stats package and the Rust core.

Compares every field of every result: numbers by relative difference, text,
counts and the manifest data hash exactly. Prints the worst difference per
model and exits 1 if any result is outside the tolerance or any error code
differs.

Run from the repo root (needs numpy, scipy, statsmodels):

    cargo build --release --example run_stdin --manifest-path rust/research-stats/Cargo.toml
    python3 rust/research-stats/scripts/compare_python.py [--cases 300] [--parity path/to/parity-5d.json]

Known, deliberate differences (not counted):
- manifest.packages: Python lists numpy/scipy/statsmodels versions, Rust its own.
- logistic "iterations": statsmodels and the Rust IRLS count steps differently.
- logistic se: statsmodels takes weights from the step before the last; Rust
  from the final estimate. Estimates agree to ~1e-12, se/z/p/CI to ~1e-7.
- linear HC3 "p": Python uses the normal (statsmodels' robust default) while
  its CI and docstring use t on n - k df; Rust uses t for both.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "research"))

from stats import cox_ph, kaplan_meier, linear_regression, log_rank, logistic_regression  # noqa: E402

BIN = ROOT / "rust" / "research-stats" / "target" / "release" / "examples" / "run_stdin"
COMPLIANCE = {"ipdApproved": True, "evidenceId": "compare-synthetic"}
REL_TOL = 1e-6  # logistic and Cox stop iterating at slightly different points; closed-form models agree to ~1e-11
ABS_TOL = 1e-10


def python_run(req: dict):
    fam = req["family"]
    level = req.get("level", 0.95)
    try:
        if fam == "linear":
            return {"ok": True, "result": linear_regression(req["columns"], req["formula"], compliance=req["compliance"], robust=req.get("robust"), level=level)}
        if fam == "logistic":
            return {"ok": True, "result": logistic_regression(req["columns"], req["formula"], compliance=req["compliance"], level=level)}
        if fam == "km":
            return {"ok": True, "result": kaplan_meier(req["time"], req["event"], compliance=req["compliance"], level=level)}
        if fam == "logrank":
            return {"ok": True, "result": log_rank(req["time"], req["event"], req["group"], compliance=req["compliance"])}
        if fam == "cox":
            return {"ok": True, "result": cox_ph(req["time"], req["event"], req["covariates"], compliance=req["compliance"], level=level)}
    except Exception as exc:  # the model's ValueError text is its error code
        code = getattr(exc, "code", None) or str(exc)
        return {"ok": False, "error": code}
    raise ValueError(fam)


SKIP_KEYS = {("manifest", "packages"), ("iterations",)}


def diff(py, rs, path, worst, problems, family, robust):
    key = tuple(p for p in path if isinstance(p, str))
    if key[-2:] in SKIP_KEYS or key[-1:] in SKIP_KEYS:
        return
    if robust and len(key) >= 2 and key[0] == "coefficients" and key[-1] == "p":
        return
    if isinstance(py, bool) or isinstance(rs, bool):
        if py != rs:
            problems.append(f"{family} {path}: {py!r} != {rs!r}")
        return
    if isinstance(py, (int, float)) and isinstance(rs, (int, float)):
        a, b = float(py), float(rs)
        if math.isnan(a) and math.isnan(b):
            return
        ad = abs(a - b)
        rd = ad / max(abs(a), 1e-300)
        score = min(rd, ad / ABS_TOL * REL_TOL) if abs(a) < 1e-6 else rd
        if score > worst[0]:
            worst[0], worst[1] = score, f"{'.'.join(map(str, path))}: py {a!r} rs {b!r}"
        if ad > ABS_TOL and rd > REL_TOL:
            problems.append(f"{family} {'.'.join(map(str, path))}: py {a!r} rs {b!r} (rel {rd:.2e})")
        return
    if isinstance(py, dict) and isinstance(rs, dict):
        for k in py:
            if (key + (k,))[-2:] in SKIP_KEYS or (k,) in SKIP_KEYS:
                continue
            if k not in rs:
                problems.append(f"{family} {path}: Rust is missing key {k}")
                continue
            diff(py[k], rs[k], path + [k], worst, problems, family, robust)
        for k in rs:
            if k not in py:
                problems.append(f"{family} {path}: Rust has extra key {k}")
        return
    if isinstance(py, list) and isinstance(rs, list):
        if len(py) != len(rs):
            problems.append(f"{family} {path}: length {len(py)} != {len(rs)}")
            return
        for i, (a, b) in enumerate(zip(py, rs)):
            diff(a, b, path + [i], worst, problems, family, robust)
        return
    if py != rs:
        problems.append(f"{family} {'.'.join(map(str, path))}: {py!r} != {rs!r}")


def synth(rng: random.Random, n_cases: int):
    cases = []
    for c in range(n_cases):
        kind = ["linear", "linear_hc3", "logistic", "km", "logrank", "cox"][c % 6]
        n = rng.choice([12, 25, 60, 150, 400, 1500])
        if kind in ("linear", "linear_hc3", "logistic"):
            k = rng.randint(1, 4)
            names = [f"x{j}" for j in range(k)]
            cols = {nm: [round(rng.gauss(50 * j, 10 + j), rng.choice([0, 1, 3])) for _ in range(n)] for j, nm in enumerate(names)}
            beta = [rng.uniform(-0.05, 0.05) for _ in names]
            lin = [sum(b * (cols[nm][i] - 50 * j) for j, (b, nm) in enumerate(zip(beta, names))) for i in range(n)]
            if kind == "logistic":
                y = [1.0 if rng.random() < 1 / (1 + math.exp(-l)) else 0.0 for l in lin]
            else:
                y = [round(3 + l + rng.gauss(0, 1), 2) for l in lin]
            cols["y"] = y
            req = {"family": "logistic" if kind == "logistic" else "linear", "columns": cols,
                   "formula": "y ~ " + " + ".join(names), "compliance": COMPLIANCE}
            if kind == "linear_hc3":
                req["robust"] = "HC3"
            if rng.random() < 0.2:
                req["level"] = rng.choice([0.9, 0.99])
            cases.append(req)
            continue
        grain = rng.choice([1, 5, 30])  # coarse times make ties
        time = [float(max(1, round(rng.expovariate(1 / 300) / grain) * grain)) for _ in range(n)]
        event = [1 if rng.random() < 0.7 else 0 for _ in range(n)]
        if kind == "km":
            cases.append({"family": "km", "time": time, "event": event, "compliance": COMPLIANCE})
        elif kind == "logrank":
            g = rng.randint(2, 4)
            labels = rng.choice([list(range(1, g + 1)), [f"arm{chr(65 + i)}" for i in range(g)]])
            cases.append({"family": "logrank", "time": time, "event": event,
                          "group": [rng.choice(labels) for _ in range(n)], "compliance": COMPLIANCE})
        else:
            p = rng.randint(1, 3)
            cov = {}
            for j in range(p):
                if rng.random() < 0.5:
                    cov[f"c{j}"] = [rng.randint(0, 1) for _ in range(n)]
                else:
                    cov[f"c{j}"] = [round(rng.gauss(60, 9), 1) for _ in range(n)]
            cases.append({"family": "cox", "time": time, "event": event, "covariates": cov, "compliance": COMPLIANCE})
    # edge cases: both must refuse with the same code
    cases += [
        {"family": "km", "time": [1, 2, 3], "event": [0, 0, 0], "compliance": COMPLIANCE},
        {"family": "km", "time": [1, 2, 3], "event": [1, 0, 1], "compliance": {"ipdApproved": True}},
        {"family": "logistic", "columns": {"y": [0, 0, 0, 0], "x": [1, 2, 3, 4]}, "formula": "y ~ x", "compliance": COMPLIANCE},
        {"family": "logistic", "columns": {"y": [0, 1, 2, 0], "x": [1, 2, 3, 4]}, "formula": "y ~ x", "compliance": COMPLIANCE},
        {"family": "linear", "columns": {"y": [1, 2], "x": [1, 2]}, "formula": "y ~ x", "compliance": COMPLIANCE},
        {"family": "linear", "columns": {"y": [1, 2, 3], "x": [1, 2, 3]}, "formula": "y ~ x * z", "compliance": COMPLIANCE},
        {"family": "km", "time": [5, 5, 5], "event": [1, 1, 1], "compliance": COMPLIANCE},
        {"family": "km", "time": [1, 2, 3, 4], "event": [1, 1, 1, 1], "compliance": COMPLIANCE},
    ]
    return cases


def parity_cases(path: Path):
    p = json.loads(path.read_text())
    r = p["regression"]
    rows = p["survival"]["rows"]
    time = [row["time"] for row in rows]
    event = [1 if row["status"] == 2 else 0 for row in rows]
    age = [row["age"] for row in rows]
    sex = [row["sex"] for row in rows]
    return [
        {"family": "linear", "columns": r["columns"], "formula": r["linear"]["formula"], "compliance": COMPLIANCE},
        {"family": "linear", "columns": r["columns"], "formula": r["linear"]["formula"], "robust": "HC3", "compliance": COMPLIANCE},
        {"family": "logistic", "columns": r["columns"], "formula": r["logistic"]["formula"], "compliance": COMPLIANCE},
        {"family": "km", "time": time, "event": event, "compliance": COMPLIANCE},
        {"family": "logrank", "time": time, "event": event, "group": sex, "compliance": COMPLIANCE},
        {"family": "cox", "time": time, "event": event, "covariates": {"age": age, "sex": sex}, "compliance": COMPLIANCE},
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=300)
    ap.add_argument("--seed", type=int, default=20261127)
    ap.add_argument("--parity", type=Path, default=ROOT / "test" / "fixtures" / "research" / "parity-5d.json")
    ap.add_argument("--runner", nargs="+", default=[str(BIN)],
                    help="command that reads JSON lines on stdin and writes results, e.g. "
                         "node rust/research-stats/js/run-stdin.js target/.../research_stats.wasm")
    args = ap.parse_args()
    cases = synth(random.Random(args.seed), args.cases)
    if args.parity.exists():
        cases = parity_cases(args.parity) + cases
    proc = subprocess.run(args.runner, input="\n".join(json.dumps(c) for c in cases) + "\n",
                          capture_output=True, text=True, check=True)
    rust_out = [json.loads(line) for line in proc.stdout.splitlines()]
    assert len(rust_out) == len(cases)
    problems: list[str] = []
    worst_by: dict[str, list] = {}
    counts: dict[str, int] = {}
    for req, rs in zip(cases, rust_out):
        fam = req["family"] + ("+HC3" if req.get("robust") else "")
        counts[fam] = counts.get(fam, 0) + 1
        py = python_run(req)
        if py["ok"] != rs["ok"]:
            problems.append(f"{fam}: Python {'ok' if py['ok'] else py['error']} vs Rust {'ok' if rs['ok'] else rs['error']}")
            continue
        if not py["ok"]:
            if py["error"] != rs["error"]:
                problems.append(f"{fam}: error {py['error']!r} vs {rs['error']!r}")
            continue
        w = worst_by.setdefault(fam, [0.0, ""])
        diff(py["result"], rs["result"], [], w, problems, fam, bool(req.get("robust")))
    print(f"{len(cases)} inputs replayed through Python and Rust")
    for fam, (score, where) in sorted(worst_by.items()):
        print(f"  {fam:12s} {counts[fam]:4d} inputs, worst relative difference {score:.1e}  ({where})")
    if problems:
        print(f"\n{len(problems)} problems:")
        for p in problems[:40]:
            print("  " + p)
        sys.exit(1)
    print("\nAll results match (numbers within 1e-6 relative, text, counts and data hashes exact).")


if __name__ == "__main__":
    main()
