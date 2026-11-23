"""Output writer seam (SEAMS.md seam 5): JSON manuscript model, not LaTeX/PDF.

Upstream writes .tex files and compiles PDFs (CVPR/ICLR templates). The
adapter keeps upstream's section-writing agent but parses its LaTeX output
into an IMRAD JSON manuscript model with Vancouver references. The canonical
section text keeps {{run:...}} tokens; render_tokens is a deterministic
preview/render helper (final rendering and version lock are Phase 5A.2/5A.3).
DOCX export is Phase 5A and deliberately NOT implemented here.

Plots are never produced by the model (plan section 8): the plotting agent
and LaTeX templates are vendored but unused.
"""
from __future__ import annotations

import re

_SECTION_RE = re.compile(r"\\(section|subsection)\*?\{([^}]*)\}")
IMRAD_ORDER = ["abstract", "introduction", "methods", "results", "discussion"]


def _slug(heading: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")


def parse_latex_sections(tex: str) -> list:
    r"""Deterministic split of a draft into sections. No LLM, no latex parser
    dependency; handles \section and \subsection (starred or not).
    LaTeX comments are NOT stripped: deleting text before the integrity gates
    could hide numbers or claims (a bare % in "95% CI" is prose, not a comment).
    """
    tex = re.sub(r"\\(?:begin|end)\{document\}", "", tex or "")
    matches = list(_SECTION_RE.finditer(tex))
    sections = []
    for i, match in enumerate(matches):
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(tex)
        heading = match.group(2).strip()
        text = tex[start:end].strip()
        text = re.sub(r"\\(?:maketitle|tableofcontents|newpage|clearpage)\b", "", text)
        sections.append({"id": _slug(heading), "heading": heading,
                         "level": 1 if match.group(1) == "section" else 2,
                         "text": text.strip()})
    return sections


def vancouver(entry: dict, number: int) -> str:
    """Vancouver reference string from a normalised reference record.
    Authors arrive as 'Family FM' strings (connector contract)."""
    authors = entry.get("authors") or []
    if len(authors) > 6:
        author_str = ", ".join(authors[:6]) + ", et al"
    else:
        author_str = ", ".join(authors) if authors else "[No authors listed]"
    parts = [f"{number}. {author_str}. {entry.get('title', '').rstrip('.')}."]
    venue = entry.get("venue") or entry.get("journal") or ""
    if isinstance(venue, dict):
        venue = venue.get("name", "")
    year = entry.get("year")
    if venue:
        parts.append(f" {venue}.")
    if year:
        tail = str(year)
        if entry.get("volume"):
            tail += f";{entry['volume']}"
            if entry.get("pages"):
                tail += f":{entry['pages']}"
        parts.append(f" {tail}.")
    if entry.get("doi"):
        parts.append(f" doi:{entry['doi']}.")
    if entry.get("pmid"):
        parts.append(f" PMID:{entry['pmid']}.")
    return "".join(parts).strip()


def _citation_keys_in_order(sections) -> list:
    keys = []
    cite_re = re.compile(r"\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]")
    for section in sections:
        for match in cite_re.finditer(section.get("text", "")):
            for key in (match.group(1) or match.group(2)).split(","):
                key = key.strip()
                if key and key not in keys:
                    keys.append(key)
    return keys


def render_tokens(text: str, token_table: dict) -> str:
    """Deterministic token -> value substitution for previews. The canonical
    manuscript text keeps tokens (plan rule 6). Unknown tokens are left as-is
    so the gates can still flag them."""
    def sub(match):
        entry = token_table.get(f"{match.group(1)}:{match.group(2)}")
        return str(entry["value"]) if entry else match.group(0)
    return re.sub(r"\{\{run:([A-Za-z0-9_-]+):([A-Za-z0-9_.]+)\}\}", sub, text)


def build_manuscript(*, title, sections, token_table, references=None,
                     citation_map=None, manifest=None, outline=None) -> dict:
    """Assemble the JSON manuscript model. sections: parsed draft sections
    (parse_latex_sections output or equivalent dicts)."""
    references = list(references or [])
    citation_map = citation_map or {}
    by_key = {r["key"]: r for r in references if r.get("key")}
    by_key.update({k: v for k, v in citation_map.items() if k not in by_key})

    ordered = sorted(sections, key=lambda s: (
        IMRAD_ORDER.index(s["id"]) if s.get("id") in IMRAD_ORDER
        else len(IMRAD_ORDER), s.get("heading", "")))

    ref_entries = []
    for number, key in enumerate(_citation_keys_in_order(ordered), 1):
        entry = by_key.get(key)
        if entry is None:
            ref_entries.append({"number": number, "key": key, "citation": "",
                                "doi": "", "pmid": "", "resolved": False})
            continue
        ext = entry.get("externalIds") or {}
        doi = entry.get("doi") or ext.get("DOI") or ""
        pmid = entry.get("pmid") or ext.get("PMID") or ""
        ref_entries.append({"number": number, "key": key,
                            "citation": vancouver(entry, number),
                            "doi": doi, "pmid": pmid, "resolved": bool(doi or pmid)})

    protocol = (manifest or {}).get("protocol") or {}
    return {
        "v": 1,
        "title": title or protocol.get("title", ""),
        "sections": ordered,
        "references": ref_entries,
        "tokens": token_table,
        "provenance": {
            "protocolHash": protocol.get("lockHash", ""),
            "runIds": sorted({e["runId"] for e in token_table.values()}),
            "engines": sorted({f"{r.get('engine', '')}:{r.get('engineVersion', '')}"
                               for r in (manifest or {}).get("runs") or []}),
            "generatedBy": "po_adapter",
            "upstreamCommit": "d9bae997e793a015ed38bb1605be9eb58c00284f",
        },
        "outline": outline,
    }
