"""DOCX Export for ResearchMD manuscripts (Package 5A.3).

Renders IMRAD JSON manuscript to DOCX with python-docx:
- Title page
- Structured abstract
- Introduction, Methods, Results, Discussion
- Tables
- Figure placeholders embedding supplied SVG/PNG files
- Vancouver numbered references in citation order

Enforces deterministic number rendering via render_tokens.
Raises UnresolvedTokenError or UnresolvedCitationError and writes nothing
if any token or citation cannot be resolved.
"""
from __future__ import annotations

import io
from pathlib import Path
import re
from typing import Any
import uuid

import docx
from docx.shared import Inches, Pt, RGBColor

from .render_tokens import UnresolvedTokenError, render_tokens

_CITE_RE = re.compile(r"\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]")
IMRAD_ORDER = ["abstract", "introduction", "methods", "results", "discussion"]


class UnresolvedCitationError(ValueError):
    """Raised when an in-text citation cannot be resolved against references."""

    def __init__(self, key: str, detail: str = ""):
        self.key = key
        self.detail = detail
        msg = f"Unresolved citation: {key}"
        if detail:
            msg += f" ({detail})"
        super().__init__(msg)


def format_vancouver(entry: dict, number: int) -> str:
    """Vancouver reference string from a normalised reference record.

    Authors arrive as 'Family FM' strings (connector contract) or dicts.
    """
    raw_authors = entry.get("authors") or []
    author_list = []
    for a in raw_authors:
        if isinstance(a, str):
            author_list.append(a)
        elif isinstance(a, dict):
            name = a.get("name") or f"{a.get('family', '')} {a.get('given', '')}".strip()
            if name:
                author_list.append(name)

    if len(author_list) > 6:
        author_str = ", ".join(author_list[:6]) + ", et al"
    else:
        author_str = ", ".join(author_list) if author_list else "[No authors listed]"

    title = str(entry.get("title", "")).rstrip(".")
    parts = [f"{number}. {author_str}. {title}."]

    venue = entry.get("venue") or entry.get("journal") or ""
    if isinstance(venue, dict):
        venue = venue.get("name", "")
    if venue:
        parts.append(f" {venue}.")

    year = entry.get("year")
    if year:
        tail = str(year)
        if entry.get("volume"):
            tail += f";{entry['volume']}"
            if entry.get("pages"):
                tail += f":{entry['pages']}"
        parts.append(f" {tail}.")

    ext = entry.get("externalIds") or {}
    doi = entry.get("doi") or ext.get("DOI") or ""
    pmid = entry.get("pmid") or ext.get("PMID") or ""
    if doi:
        parts.append(f" doi:{doi}.")
    if pmid:
        parts.append(f" PMID:{pmid}.")

    return "".join(parts).strip()


def _extract_citation_keys_in_order(text_blocks: list[str]) -> list[str]:
    """Find citation keys in order of first appearance across text blocks."""
    keys: list[str] = []
    for block in text_blocks:
        for match in _CITE_RE.finditer(block or ""):
            raw_keys = match.group(1) or match.group(2)
            for k in raw_keys.split(","):
                key = k.strip()
                if key and key not in keys:
                    keys.append(key)
    return keys


def _replace_citations_with_numbers(text: str, citation_map: dict[str, int]) -> str:
    """Replace LaTeX and Pandoc style citations with Vancouver numbers in brackets."""

    def sub(match: re.Match) -> str:
        raw_keys = match.group(1) or match.group(2)
        keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
        numbers = []
        for k in keys:
            if k in citation_map:
                numbers.append(str(citation_map[k]))
            else:
                numbers.append(k)
        return "[" + ", ".join(numbers) + "]"

    return _CITE_RE.sub(sub, text or "")


def _rasterize_svg_to_png_bytes(svg_path_or_bytes: str | Path | bytes) -> bytes:
    """Convert SVG data to PNG bytes using PyMuPDF."""
    import pymupdf

    if isinstance(svg_path_or_bytes, (str, Path)):
        svg_doc = pymupdf.open(str(svg_path_or_bytes))
    else:
        svg_doc = pymupdf.open(stream=svg_path_or_bytes, filetype="svg")

    pix = svg_doc[0].get_pixmap(dpi=150)
    return pix.tobytes("png")


def _add_figure_to_doc(doc: docx.Document, fig_item: dict) -> None:
    """Add figure (PNG/SVG) or placeholder paragraph to document."""
    raw_caption = fig_item.get("caption") or fig_item.get("title") or "Figure"
    caption = str(raw_caption).rstrip(".")
    path = fig_item.get("path")
    fig_bytes = fig_item.get("bytes")

    embedded = False
    if path:
        p = Path(path)
        if p.exists():
            if p.suffix.lower() == ".svg":
                png_bytes = _rasterize_svg_to_png_bytes(p)
                doc.add_picture(io.BytesIO(png_bytes), width=Inches(5.5))
                embedded = True
            elif p.suffix.lower() in (".png", ".jpg", ".jpeg"):
                doc.add_picture(str(p), width=Inches(5.5))
                embedded = True
    elif fig_bytes:
        is_svg = fig_item.get("is_svg", False) or fig_bytes.lstrip().startswith(b"<svg")
        if is_svg:
            png_bytes = _rasterize_svg_to_png_bytes(fig_bytes)
            doc.add_picture(io.BytesIO(png_bytes), width=Inches(5.5))
            embedded = True
        else:
            doc.add_picture(io.BytesIO(fig_bytes), width=Inches(5.5))
            embedded = True

    if not embedded:
        # Render placeholder
        p = doc.add_paragraph()
        run = p.add_run(f"[{caption} - Image Placeholder]")
        run.italic = True
        run.font.color.rgb = RGBColor(100, 100, 100)
    else:
        cap_p = doc.add_paragraph()
        cap_run = cap_p.add_run(f"{caption}.")
        cap_run.bold = True
        cap_run.font.size = Pt(10)

    doc.add_paragraph()


def _add_table_to_doc(doc: docx.Document, tbl_item: dict, runs: list | dict) -> None:
    """Add formatted Word table with token rendering."""
    caption = tbl_item.get("caption") or tbl_item.get("title") or "Table"
    cap_p = doc.add_paragraph()
    cap_run = cap_p.add_run(render_tokens(caption, runs, strict=True))
    cap_run.bold = True

    headers = [render_tokens(str(h), runs, strict=True) for h in tbl_item.get("headers", [])]
    raw_rows = tbl_item.get("rows", [])
    rendered_rows = [
        [render_tokens(str(cell), runs, strict=True) for cell in row]
        for row in raw_rows
    ]

    if not headers and rendered_rows:
        headers = rendered_rows[0]
        rendered_rows = rendered_rows[1:]

    num_cols = len(headers) if headers else (len(rendered_rows[0]) if rendered_rows else 0)
    if num_cols == 0:
        return

    num_rows = len(rendered_rows) + (1 if headers else 0)
    table = doc.add_table(rows=num_rows, cols=num_cols)
    table.style = "Table Grid"

    current_row = 0
    if headers:
        hdr_cells = table.rows[0].cells
        for col_idx, h_text in enumerate(headers):
            if col_idx < len(hdr_cells):
                hdr_cells[col_idx].text = h_text
                for p in hdr_cells[col_idx].paragraphs:
                    for r in p.runs:
                        r.bold = True
        current_row = 1

    for r_idx, row in enumerate(rendered_rows):
        row_cells = table.rows[current_row + r_idx].cells
        for col_idx, val in enumerate(row):
            if col_idx < len(row_cells):
                row_cells[col_idx].text = val

    doc.add_paragraph()


def export(
    manuscript_json: dict,
    runs: list | dict,
    references: list | dict,
    out_path: str | Path,
    *,
    figures: dict | list | None = None,
    tables: list | None = None,
) -> Path:
    """Render IMRAD JSON manuscript to DOCX with python-docx.

    Title page, structured abstract, Introduction/Methods/Results/Discussion,
    tables, figure placeholders with embedded SVG/PNG, Vancouver references.

    Every {{run:...}} token is rendered deterministically from supplied runs.
    An unresolved token or unresolved citation raises and nothing is written.
    """
    out_file = Path(out_path)

    # 1. Normalize references
    if isinstance(references, list):
        refs_by_key = {r["key"]: r for r in references if isinstance(r, dict) and r.get("key")}
    elif isinstance(references, dict):
        refs_by_key = dict(references)
    else:
        refs_by_key = {}

    # Extract all text blocks to scan for citations and validate tokens
    title = str(manuscript_json.get("title", "ResearchMD Systematic Review"))
    raw_sections = manuscript_json.get("sections") or []

    # Sort sections in IMRAD order where standard IDs exist
    def _section_sort_key(s: dict):
        sid = str(s.get("id", "")).lower()
        if sid in IMRAD_ORDER:
            return (0, IMRAD_ORDER.index(sid))
        return (1, s.get("heading", ""))

    sorted_sections = sorted(raw_sections, key=_section_sort_key)

    # Collect text blocks
    text_blocks_for_citations: list[str] = []
    abstract_text = ""
    for s in sorted_sections:
        sid = str(s.get("id", "")).lower()
        stext = s.get("text", "")
        if sid == "abstract":
            abstract_text = stext
        text_blocks_for_citations.append(stext)

    # Also check if top-level abstract exists separately
    if not abstract_text and manuscript_json.get("abstract"):
        abstract_val = manuscript_json["abstract"]
        if isinstance(abstract_val, str):
            abstract_text = abstract_val
        elif isinstance(abstract_val, dict):
            abstract_text = "\n\n".join(str(v) for v in abstract_val.values())
        text_blocks_for_citations.append(abstract_text)

    # 2. Resolve citations in citation order
    ordered_keys = _extract_citation_keys_in_order(text_blocks_for_citations)
    citation_map: dict[str, int] = {}
    vancouver_records: list[str] = []

    for num, key in enumerate(ordered_keys, 1):
        if key not in refs_by_key:
            raise UnresolvedCitationError(key, "citation key not found in supplied references")
        entry = refs_by_key[key]
        ext = entry.get("externalIds") or {}
        doi = entry.get("doi") or ext.get("DOI") or ""
        pmid = entry.get("pmid") or ext.get("PMID") or ""
        if not doi and not pmid:
            raise UnresolvedCitationError(key, "citation has neither DOI nor PMID")
        citation_map[key] = num
        vancouver_records.append(format_vancouver(entry, num))

    # 3. Validate and render all tokens in memory (strict=True)
    # If any token is unresolved, UnresolvedTokenError raises before any file is written.
    rendered_title = render_tokens(title, runs, strict=True)
    rendered_abstract = render_tokens(abstract_text, runs, strict=True) if abstract_text else ""

    processed_sections = []
    for s in sorted_sections:
        sid = str(s.get("id", "")).lower()
        if sid in ("abstract", "references"):
            # Handled in dedicated sections
            continue
        heading = render_tokens(s.get("heading", ""), runs, strict=True)
        raw_text = s.get("text", "")
        token_rendered_text = render_tokens(raw_text, runs, strict=True)
        final_text = _replace_citations_with_numbers(token_rendered_text, citation_map)
        processed_sections.append({
            "id": sid,
            "heading": heading,
            "level": s.get("level", 1),
            "text": final_text,
        })

    # Prepare figures
    fig_items: list[dict] = []
    if figures:
        if isinstance(figures, list):
            fig_items.extend(figures)
        elif isinstance(figures, dict):
            for fid, fval in figures.items():
                if isinstance(fval, dict):
                    fig_items.append({"id": fid, **fval})
                else:
                    fig_items.append({"id": fid, "path": str(fval), "caption": f"Figure: {fid}"})
    if manuscript_json.get("figures"):
        m_figs = manuscript_json["figures"]
        if isinstance(m_figs, list):
            fig_items.extend(m_figs)
        elif isinstance(m_figs, dict):
            for fid, fval in m_figs.items():
                if isinstance(fval, dict):
                    fig_items.append({"id": fid, **fval})
                else:
                    fig_items.append({"id": fid, "path": str(fval), "caption": f"Figure: {fid}"})

    # Prepare tables
    tbl_items: list[dict] = []
    if tables:
        tbl_items.extend(tables)
    if manuscript_json.get("tables"):
        tbl_items.extend(manuscript_json["tables"])

    # 4. Build python-docx Document in memory
    doc = docx.Document()

    # Set 1-inch margins
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    # --- Title Page ---
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(36)
    title_p.paragraph_format.space_after = Pt(18)
    title_run = title_p.add_run(rendered_title)
    title_run.font.size = Pt(22)
    title_run.bold = True

    authors = manuscript_json.get("authors")
    if authors:
        auth_p = doc.add_paragraph()
        auth_p.paragraph_format.space_after = Pt(12)
        if isinstance(authors, list):
            auth_str = ", ".join(str(a) for a in authors)
        else:
            auth_str = str(authors)
        auth_run = auth_p.add_run(auth_str)
        auth_run.font.size = Pt(12)

    affil = manuscript_json.get("affiliations") or manuscript_json.get("institution")
    if affil:
        affil_p = doc.add_paragraph()
        affil_run = affil_p.add_run(str(affil))
        affil_run.font.size = Pt(10)
        affil_run.italic = True

    doc.add_page_break()

    # --- Structured Abstract ---
    if rendered_abstract:
        abs_h = doc.add_heading("Abstract", level=1)
        abs_h.paragraph_format.space_before = Pt(12)
        abs_h.paragraph_format.space_after = Pt(12)

        # Split abstract paragraphs
        abs_text_with_cites = _replace_citations_with_numbers(rendered_abstract, citation_map)
        for para in abs_text_with_cites.split("\n\n"):
            p_strip = para.strip()
            if p_strip:
                doc.add_paragraph(p_strip)

        doc.add_page_break()

    # --- Main Sections (IMRAD) ---
    for s in processed_sections:
        level = s["level"]
        h_level = 1 if level == 1 else (2 if level == 2 else 3)
        h = doc.add_heading(s["heading"], level=h_level)
        h.paragraph_format.space_before = Pt(12)
        h.paragraph_format.space_after = Pt(6)

        for para in s["text"].split("\n\n"):
            p_strip = para.strip()
            if p_strip:
                doc.add_paragraph(p_strip)

    # --- Tables ---
    if tbl_items:
        doc.add_heading("Tables", level=1)
        for tbl in tbl_items:
            _add_table_to_doc(doc, tbl, runs)

    # --- Figures ---
    if fig_items:
        doc.add_heading("Figures", level=1)
        for fig in fig_items:
            _add_figure_to_doc(doc, fig)

    # --- Vancouver Numbered References ---
    if vancouver_records:
        doc.add_heading("References", level=1)
        for ref_str in vancouver_records:
            doc.add_paragraph(ref_str)

    # 5. Write to out_path atomically
    out_file.parent.mkdir(parents=True, exist_ok=True)
    temp_file = out_file.with_name(f".tmp.{uuid.uuid4().hex}.{out_file.name}")
    try:
        doc.save(str(temp_file))
        temp_file.replace(out_file)
    finally:
        if temp_file.exists():
            temp_file.unlink()

    return out_file
