#!/usr/bin/env python3
"""Render one flowchart, one value table and one figure spec from KB schema v2 to a static review page.

Usage: python3 scripts/kb_preview_v2.py out.html <file.json> [...]
Flowcharts are drawn in the browser by kb-flowchart.js, so the preview matches the reader renderer.
Review aid only. Not the reader.
"""
import html
import json
import os
import re
import sys


def esc(s):
    return html.escape(str(s))


HY_RE = re.compile(r"\{\{hy:([^{}]+?)\}\}")


def hy(text):
    """Escape, then turn {{hy:...}} into bold underline. Same rule as kb-highyield.js."""
    return HY_RE.sub(lambda m: f"<strong class='kb-hy'>{esc(m.group(1))}</strong>", esc(text))


def chip(text, tone):
    return f"<span class='chip chip-{tone}'>{esc(text)}</span>"


def status_chips(review):
    review = review or {}
    out = [chip(review.get("status", "unreviewed"), "warn" if review.get("status") != "approved" else "ok")]
    out.append(chip("clinician approved" if review.get("clinicianApproved") else "not clinician approved",
                    "ok" if review.get("clinicianApproved") else "warn"))
    return "".join(out)


def section_flow(fc):
    # Shape carries the meaning (diamond = decision, box = step, rounded = start or outcome). Colour is secondary.
    return (f"<section class='card' aria-labelledby='h-{esc(fc['id'])}'>"
            f"<p class='kicker'>Flowchart</p><h2 id='h-{esc(fc['id'])}'>{esc(fc.get('title', fc['id']))}</h2>"
            f"<div class='paper' data-fc='{esc(json.dumps(fc))}'></div>"
            "<dl class='key'><dt>Diamond</dt><dd>Decision</dd><dt>Box</dt><dd>Action</dd>"
            "<dt>Rounded</dt><dd>Start or outcome</dd></dl></section>")


def section_table(vt, cites):
    cols = vt.get("columns", [])
    # The first column is the row label, which the preview draws itself, so it is not repeated.
    if cols and cols[0].lower() == "parameter":
        cols = cols[1:]
    head = "".join(f"<th scope='col'>{esc(c)}</th>" for c in cols)
    body = []
    for r in vt.get("rows", []):
        cells = []
        for c in r.get("cells", []):
            text = c.get("text", "")
            tone = " class='pending'" if "needs-source" in text else ""
            cells.append(f"<td{tone}>{hy(text)}</td>")
        unit = f"<span class='unit'>{esc(r.get('unit', ''))}</span>" if r.get("unit") else ""
        body.append(f"<tr><th scope='row'>{esc(r.get('parameter', ''))}{unit}</th>{''.join(cells)}"
                    f"<td class='cite'>{esc(cites.get(r.get('cite'), r.get('cite', '')))}</td></tr>")
    foot = f"<p class='foot'>{esc(vt['footnote'])}</p>" if vt.get("footnote") else ""
    return (f"<section class='card'><p class='kicker'>Value table</p><h2>{esc(vt.get('title', vt['id']))}</h2>"
            f"<div class='scroll'><table><thead><tr><th scope='col'>Parameter</th>{head}<th scope='col'>Source</th></tr></thead>"
            f"<tbody>{''.join(body)}</tbody></table></div>{foot}</section>")


def section_figure(fig, cites):
    # Drawn in the browser by kb-figure.js. The pathway list below is the text version for screen readers and copy.
    spec = fig.get("spec", {})
    flows = "".join(f"<li>{hy(a)} <span aria-hidden='true'>&rarr;</span> {hy(b)}</li>" for a, b in spec.get("flows", []))
    return (f"<section class='card'><p class='kicker'>Figure, drawn</p>"
            f"<h2>{esc(fig.get('title', fig['id']))}</h2><p class='caption'>{hy(fig.get('caption', ''))}</p>"
            f"<div class='paper' data-fig='{esc(json.dumps(fig))}'></div>"
            f"<details><summary>Pathway as text</summary><ul class='flows'>{flows}</ul></details>"
            f"<p class='cite'>Source: {esc(cites.get(fig.get('cite'), fig.get('cite', 'none')))}</p></section>")


CSS = """
:root{--bg:#f6f5f2;--surface:#ffffff;--ink:#1a1a18;--ink-2:#55534d;--line:#d9d6ce;--paper:#ffffff;
--warn-bg:#fff4e0;--warn-ink:#7a4300;--ok-bg:#e7f5ea;--ok-ink:#1d5c2b;--focus:#1f5fbf;--radius:12px;
color-scheme:light}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){--bg:#121211;--surface:#1c1c1a;--ink:#f1efe9;--ink-2:#b3afa5;--line:#3a3935;
  --warn-bg:#3a2a10;--warn-ink:#ffd9a0;--ok-bg:#15301d;--ok-ink:#b8e6c4;--focus:#8fb8ff;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121211;--surface:#1c1c1a;--ink:#f1efe9;--ink-2:#b3afa5;--line:#3a3935;
--warn-bg:#3a2a10;--warn-ink:#ffd9a0;--ok-bg:#15301d;--ok-ink:#b8e6c4;--focus:#8fb8ff;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font:16px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;padding:16px;max-width:920px;margin-inline:auto;overflow-wrap:break-word}
header{margin:8px 0 20px}
h1{font-size:22px;margin:0 0 4px}
header p{margin:0;color:var(--ink-2);font-size:14px}
h2{font-size:19px;line-height:1.3;margin:2px 0 12px;text-wrap:balance}
h3{font-size:15px;margin:14px 0 6px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin:0 0 20px}
.kicker{margin:0;font-size:13px;color:var(--ink-2)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.chip{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.chip-warn{background:var(--warn-bg);color:var(--warn-ink)}
.chip-ok{background:var(--ok-bg);color:var(--ok-ink)}
.paper{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.paper .kbfc-wrap{overflow-x:auto;max-width:100%}
.key{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;color:var(--ink-2);margin:10px 0 0}
.key dt{font-weight:600;color:var(--ink)}.key dd{margin:0}
.scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px;padding:8px}
table{border-collapse:collapse;width:100%;min-width:520px;font-size:14px;font-variant-numeric:tabular-nums}
th,td{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
thead th{background:var(--bg);font-weight:600}
tbody th{font-weight:600;width:24%}
.unit{display:block;font-weight:400;color:var(--ink-2);font-size:12px}
td.pending{color:var(--warn-ink);background:var(--warn-bg);font-style:italic}
.cite{font-size:12px;color:var(--ink-2)}
.foot{font-size:13px;color:var(--ink-2);margin:10px 0 0}
.caption{color:var(--ink-2);margin:0 0 10px}
.kb-hy{font-weight:700;text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.18em}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.col{border:1px solid var(--line);border-radius:8px;padding:10px}
.col h3{margin-top:0}
.col ul,.flows{margin:0;padding-left:18px;font-size:14px}
.flows{list-style:none;padding-left:0}
.flows li{padding:4px 0;border-bottom:1px dashed var(--line)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
@media (max-width:480px){body{padding:16px}.card{padding:12px}}
"""

SCRIPT_TAIL = """
document.querySelectorAll('[data-fc]').forEach(function (h) {
  h.innerHTML = KBFlowchart.render(JSON.parse(h.getAttribute('data-fc')));
});
document.querySelectorAll('[data-fig]').forEach(function (h) {
  h.innerHTML = KBFigure.render(JSON.parse(h.getAttribute('data-fig')));
});
"""


def main(argv):
    out_path, paths = argv[0], argv[1:]
    body = []
    for p in paths:
        with open(p) as fh:
            d = json.load(fh)
        title = d.get("title") or d.get("name") or p
        body.append(f"<header><h1>{esc(title)}</h1><p>{esc(p)}</p>"
                    f"<div class='chips'>{status_chips(d.get('review'))}</div></header>")
        body += [section_flow(f) for f in d.get("flowcharts", [])[:1]]
        cites = {c["id"]: c.get("label", c["id"]) for c in d.get("citations", [])}
        body += [section_table(t, cites) for t in d.get("valueTables", [])[:1]]
        body += [section_figure(f, cites) for f in d.get("figures", [])[:1]]

    here = os.path.dirname(os.path.abspath(__file__))
    libs = ""
    for name in ("kb-highyield.js", "kb-flowchart.js", "kb-figure.js"):
        with open(os.path.join(here, "..", name)) as fh:
            libs += fh.read() + "\n"

    doc = ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
           "<meta name='viewport' content='width=device-width,initial-scale=1'>"
           "<meta name='color-scheme' content='light dark'>"
           "<title>KB pilot preview</title><style>" + CSS + "</style></head><body>"
           + "".join(body) + "<script>" + libs + SCRIPT_TAIL + "</script></body></html>")
    with open(out_path, "w") as fh:
        fh.write(doc)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main(sys.argv[1:])
