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

_SECTION_RE = re.compile(r"\\(section|subsection|subsubsection)\*?\{([^}]*)\}")
IMRAD_ORDER = ["abstract", "introduction", "methods", "results", "discussion"]

_MATH_SYMBOLS = {
    "times": "\u00d7",
    "pm": "\u00b1",
    "le": "\u2264",
    "leq": "\u2264",
    "ge": "\u2265",
    "geq": "\u2265",
    "approx": "\u2248",
    "tau": "\u03c4",
    "chi": "\u03c7",
    "alpha": "\u03b1",
    "beta": "\u03b2",
    "mu": "\u03bc",
    "sigma": "\u03c3",
    "Delta": "\u0394",
}
_STRIP_NOARG_CMDS = re.compile(
    r"\\(?:noindent|smallskip|medskip|bigskip|centering|maketitle|"
    r"tableofcontents|newpage|clearpage|hline|toprule|midrule|bottomrule)"
    r"(?![A-Za-z@])[ \t]*"
)
_DROP_ARG_CMDS = {
    "label", "vspace", "hspace", "setlength", "addtolength", "color",
    "usepackage", "documentclass", "bibliographystyle", "bibliography",
    "includegraphics", "cline", "cmidrule",
}
_TWO_ARG_KEEP_SECOND = {"href", "textcolor", "colorbox"}


def _slug(heading: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")


def parse_latex_sections(tex: str) -> list:
    r"""Deterministic split of a draft into sections. No LLM, no latex parser
    dependency; handles \section, \subsection, and \subsubsection (starred or not).
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
        kind = match.group(1)
        level = 1 if kind == "section" else (2 if kind == "subsection" else 3)
        sections.append({"id": _slug(heading), "heading": heading,
                         "level": level, "text": text.strip()})
    return sections


def _even_backslashes(text: str, pos: int) -> bool:
    count = 0
    i = pos - 1
    while i >= 0 and text[i] == "\\":
        count += 1
        i -= 1
    return (count % 2) == 0


def _find_matching_brace(text: str, open_idx: int) -> int:
    depth = 1
    i = open_idx + 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            i += 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _find_matching_bracket(text: str, open_idx: int) -> int:
    depth = 1
    i = open_idx + 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            i += 2
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _skip_optional_args(text: str, pos: int) -> int:
    n = len(text)
    while pos < n and text[pos] == "[":
        end = _find_matching_bracket(text, pos)
        if end < 0:
            break
        pos = end + 1
    return pos


def _wrap_markdown(marker: str, content: str) -> str:
    if not content or not content.strip():
        return content
    lead = content[:len(content) - len(content.lstrip(" \t"))]
    trail = content[len(content.rstrip(" \t")):]
    core = content.strip(" \t")
    return f"{lead}{marker}{core}{marker}{trail}"


def _convert_tabular_envs(text: str) -> str:
    begin_re = re.compile(r"\\begin\{(tabular\*?)\}")
    out = []
    pos = 0
    while True:
        m = begin_re.search(text, pos)
        while m and not _even_backslashes(text, m.start()):
            m = begin_re.search(text, m.start() + 1)
        if not m:
            out.append(text[pos:])
            break
        out.append(text[pos:m.start()])
        env = m.group(1)
        cursor = m.end()
        if env == "tabular*" and cursor < len(text) and text[cursor] == "{":
            w_end = _find_matching_brace(text, cursor)
            if w_end >= 0:
                cursor = w_end + 1
        cursor = _skip_optional_args(text, cursor)
        if cursor < len(text) and text[cursor] == "{":
            spec_end = _find_matching_brace(text, cursor)
            if spec_end >= 0:
                cursor = spec_end + 1
        end_tag = f"\\end{{{env}}}"
        end_idx = text.find(end_tag, cursor)
        while end_idx >= 0 and not _even_backslashes(text, end_idx):
            end_idx = text.find(end_tag, end_idx + 1)
        if end_idx < 0:
            out.append(text[m.start():])
            break
        body = text[cursor:end_idx]
        pos = end_idx + len(end_tag)

        # Drop rules and unwrap multicolumn/multirow inside table cells.
        body = re.sub(r"\\(?:hline|toprule|midrule|bottomrule)(?![A-Za-z@])", "", body)
        body = re.sub(r"\\cline\{[^}]*\}", "", body)
        body = re.sub(r"\\cmidrule(?:\([^)]*\))?\{[^}]*\}", "", body)
        body = _unwrap_multicolumn(body)
        raw_rows = re.split(r"(?<!\\)\\\\(?:\[[^\]]*\])?\*?|\\tabularnewline(?![A-Za-z@])", body)
        row_lines = []
        for raw_row in raw_rows:
            cells = [re.sub(r"\s+", " ", c).strip() for c in re.split(r"(?<!\\)&", raw_row)]
            if any(cells):
                row_lines.append(" | ".join(cells))
        if row_lines:
            out.append("\n" + "\n".join(row_lines) + "\n")
    return "".join(out)


def _unwrap_multicolumn(text: str) -> str:
    cmd_re = re.compile(r"\\(multicolumn|multirow)\{")
    out = []
    pos = 0
    while True:
        m = cmd_re.search(text, pos)
        while m and not _even_backslashes(text, m.start()):
            m = cmd_re.search(text, m.start() + 1)
        if not m:
            out.append(text[pos:])
            break
        out.append(text[pos:m.start()])
        c1_end = _find_matching_brace(text, m.end() - 1)
        if c1_end < 0 or c1_end + 1 >= len(text) or text[c1_end + 1] != "{":
            out.append(text[m.start():m.end()])
            pos = m.end()
            continue
        c2_end = _find_matching_brace(text, c1_end + 1)
        if c2_end < 0 or c2_end + 1 >= len(text) or text[c2_end + 1] != "{":
            out.append(text[m.start():m.end()])
            pos = m.end()
            continue
        c3_end = _find_matching_brace(text, c2_end + 1)
        if c3_end < 0:
            out.append(text[m.start():m.end()])
            pos = m.end()
            continue
        out.append(text[c2_end + 2:c3_end])
        pos = c3_end + 1
    return "".join(out)


def _convert_list_envs(text: str) -> str:
    list_re = re.compile(
        r"\\begin\{(itemize|enumerate)\}(?:\[[^\]]*\])?"
        r"((?:(?!\\begin\{(?:itemize|enumerate)\}).)*?)"
        r"\\end\{\1\}",
        re.DOTALL,
    )
    for _ in range(12):
        changed = False

        def repl(match):
            nonlocal changed
            changed = True
            kind = match.group(1)
            body = match.group(2)
            parts = re.split(r"(?<!\\)\\item(?![A-Za-z@])(?:\[([^\]]*)\])?", body)
            # parts: [preamble, opt1, item1, opt2, item2, ...]
            lines = []
            idx = 1
            for i in range(1, len(parts), 2):
                opt = (parts[i] or "").strip()
                item_body = (parts[i + 1] if i + 1 < len(parts) else "") or ""
                item_lines = [ln.strip() for ln in item_body.strip().splitlines() if ln.strip()]
                joined_parts = []
                for ln in item_lines:
                    if ln.startswith("- ") or re.match(r"^\d+\.\s", ln):
                        joined_parts.append("\n" + ln)
                    elif joined_parts:
                        joined_parts.append(" " + ln)
                    else:
                        joined_parts.append(ln)
                item_text = "".join(joined_parts).strip()
                if opt:
                    item_text = f"{opt} {item_text}".strip()
                prefix = "- " if kind == "itemize" else f"{idx}. "
                idx += 1
                if item_text:
                    lines.append(prefix + item_text)
            return ("\n" + "\n".join(lines) + "\n") if lines else "\n"

        next_text = list_re.sub(repl, text)
        text = next_text
        if not changed:
            break
    return text


def _replace_braced_commands(text: str, ref_map: dict, *, mask_url) -> str:
    cmd_re = re.compile(r"\\([A-Za-z@]+)\*?(?=(?:\[|\{))")
    out = []
    pos = 0
    n = len(text)
    while pos < n:
        m = cmd_re.search(text, pos)
        while m and not _even_backslashes(text, m.start()):
            m = cmd_re.search(text, m.start() + 1)
        if not m:
            out.append(text[pos:])
            break
        out.append(text[pos:m.start()])
        cmd = m.group(1)
        cursor = m.end()
        if cmd == "cmidrule" and cursor < n and text[cursor] == "(":
            p_end = text.find(")", cursor)
            if p_end >= 0:
                cursor = p_end + 1
        cursor = _skip_optional_args(text, cursor)
        if cursor >= n or text[cursor] != "{":
            out.append(text[m.start():m.end()])
            pos = m.end()
            continue
        b1_end = _find_matching_brace(text, cursor)
        if b1_end < 0:
            out.append(text[m.start():m.end()])
            pos = m.end()
            continue
        arg1 = text[cursor + 1:b1_end]
        pos = b1_end + 1

        if cmd in ("begin", "end"):
            env_name = arg1.strip()
            if cmd == "begin":
                pos = _skip_optional_args(text, pos)
                if env_name == "minipage" and pos < n and text[pos] == "{":
                    w_end = _find_matching_brace(text, pos)
                    if w_end >= 0:
                        pos = w_end + 1
            continue
        if cmd in _DROP_ARG_CMDS:
            if cmd in ("setlength", "addtolength") and pos < n and text[pos] == "{":
                b2_end = _find_matching_brace(text, pos)
                if b2_end >= 0:
                    pos = b2_end + 1
            continue
        if cmd == "ref":
            lbl = arg1.strip()
            ns = lbl.split(":", 1)[0] if ":" in lbl else "other"
            if lbl not in ref_map["labels"]:
                num = ref_map["counters"].get(ns, 0) + 1
                ref_map["counters"][ns] = num
                ref_map["labels"][lbl] = str(num)
            out.append(ref_map["labels"][lbl])
            continue
        if cmd in _TWO_ARG_KEEP_SECOND:
            if pos < n and text[pos] == "{":
                b2_end = _find_matching_brace(text, pos)
                if b2_end >= 0:
                    arg2 = text[pos + 1:b2_end]
                    pos = b2_end + 1
                    out.append(_replace_braced_commands(arg2, ref_map, mask_url=mask_url))
                    continue
        if cmd == "url":
            out.append(mask_url(arg1))
            continue
        inner = _replace_braced_commands(arg1, ref_map, mask_url=mask_url)
        if cmd == "textbf":
            out.append(_wrap_markdown("**", inner))
        elif cmd in ("textit", "emph"):
            out.append(_wrap_markdown("*", inner))
        elif cmd == "caption":
            out.append("\n" + inner.strip() + "\n")
        else:
            out.append(inner)
    return "".join(out)


def latex_to_text(text: str, ref_map: dict | None = None) -> str:
    r"""Convert LaTeX section text to readable plain text with light markdown
    (**bold**, *italic*, - bullets, tabular pipe rows) while preserving
    {{run:...}} tokens, digits, and \cite{...}/[@...] citation markers."""
    if not text:
        return ""
    if ref_map is None:
        ref_map = {"labels": {}, "counters": {}}

    text = str(text).replace("\r\n", "\n")

    prefix = "SMDMASK"
    while prefix in text:
        prefix += "X"

    protected = []

    def mask(val: str) -> str:
        tok = f"{prefix}P{len(protected)}Z"
        protected.append(val)
        return tok

    # 1. Preserve {{run:...}} tokens and citation markers verbatim.
    text = re.sub(
        r"\{\{run:[^}]*\}\}|\\cite(?:\[[^\]]*\])?\{[^}]+\}|\[@[A-Za-z0-9_:-]+\]",
        lambda m: mask(m.group(0)),
        text,
    )

    # 2. Preserve escaped literal braces \{ and \} so group brace stripping
    #    leaves them intact.
    escaped_braces = []

    def mask_esc_brace(m: re.Match) -> str:
        if not _even_backslashes(text, m.start()):
            return m.group(0)
        tok = f"{prefix}B{len(escaped_braces)}Z"
        escaped_braces.append(m.group(1))
        return tok

    text = re.sub(r"\\([{}])", mask_esc_brace, text)

    # 3. Tables and list environments.
    text = _convert_tabular_envs(text)
    text = _convert_list_envs(text)

    # 4. Inline/display math delimiters and math symbols.
    text = re.sub(r"(?<!\\)\$\$(.+?)(?<!\\)\$\$", lambda m: m.group(1), text, flags=re.DOTALL)
    text = re.sub(r"(?<!\\)\\\[(.+?)(?<!\\)\\\]", lambda m: m.group(1), text, flags=re.DOTALL)
    text = re.sub(r"(?<!\\)\\\((.+?)(?<!\\)\\\)", lambda m: m.group(1), text, flags=re.DOTALL)
    text = re.sub(r"(?<!\\)\$(?!\$)((?:\\.|[^$\n\\])+?)(?<!\\)\$", lambda m: m.group(1), text)

    math_re = re.compile(
        r"\\(times|pm|leq|le|geq|ge|approx|tau|chi|alpha|beta|mu|sigma|Delta)(?![A-Za-z@])"
    )
    text = math_re.sub(
        lambda m: _MATH_SYMBOLS[m.group(1)] if _even_backslashes(text, m.start()) else m.group(0),
        text,
    )

    # 5. Strip layout/spacing commands and \par before brace wrapping so
    #    constructs like \textbf{\noindent} collapse to empty instead of ****.
    text = re.sub(
        r"[ \t]*\\par(?![A-Za-z@])[ \t]*",
        lambda m: "\n\n" if _even_backslashes(text, m.start()) else m.group(0),
        text,
    )
    text = _STRIP_NOARG_CMDS.sub(
        lambda m: "" if _even_backslashes(text, m.start()) else m.group(0),
        text,
    )

    # 6. Formatting / braced commands (preserving \url tilde from ~ -> space).
    url_masks = []

    def mask_url(raw_url: str) -> str:
        tok = f"{prefix}U{len(url_masks)}Z"
        cleaned = (raw_url.replace("\\_", "_").replace("\\%", "%")
                   .replace("\\&", "&").replace("\\#", "#"))
        url_masks.append(cleaned)
        return tok

    text = _replace_braced_commands(text, ref_map, mask_url=mask_url)
    # Also mask bare http/https URLs so "--" inside URL paths is never rewritten.
    text = re.sub(r"https?://[^\s<>\"')}\]]+", lambda m: mask_url(m.group(0)), text)

    # 7. Tilde non-breaking space -> ASCII space (outside \url and \~).
    text = re.sub(r"(?<!\\)~", " ", text)

    # 8. Remaining LaTeX linebreaks, escaped literals, accents, and bare commands.
    text = re.sub(
        r"\\\\(?:\[[^\]]*\])?\*?",
        lambda m: "\n" if _even_backslashes(text, m.start()) else m.group(0),
        text,
    )
    esc_map = {"_": "_", "%": "%", "&": "&", "#": "#", "$": "$", " ": " ",
               ",": " ", ";": " ", ":": " ", "!": "", "-": "", "/": ""}
    text = re.sub(r"\\([_%&#$ ,;:!\-/])", lambda m: esc_map[m.group(1)], text)
    text = re.sub(r"\\['\"`^~=.]", "", text)
    text = re.sub(r"\\[A-Za-z@]+\*?", "", text)

    # 9. Strip leftover TeX grouping braces (tokens/cites/escaped braces are masked).
    text = text.replace("{", "").replace("}", "")

    # 9.5 Normalize LaTeX en/em-dash ligatures (-- / ---) outside table dividers and masked tokens/URLs.
    dash_lines = []
    for ln in text.split("\n"):
        if re.match(r"^\s*\|[\s\-|:]+\|\s*$", ln):
            dash_lines.append(ln)
        else:
            ln = re.sub(r"(?<!-)---(?!-)", " - ", ln)
            ln = re.sub(r"(?<!-)--(?!-)", "-", ln)
            dash_lines.append(ln)
    text = "\n".join(dash_lines)

    # 10. Restore masked literal braces, URLs, tokens, and citations.
    for idx, ch in enumerate(escaped_braces):
        text = text.replace(f"{prefix}B{idx}Z", ch)
    for idx, val in enumerate(url_masks):
        text = text.replace(f"{prefix}U{idx}Z", val)
    for idx, val in enumerate(protected):
        text = text.replace(f"{prefix}P{idx}Z", val)

    # 10.5 Strip duplicate trailing '%' immediately after an i2/i_squared percentage token.
    text = re.sub(r"(\{\{run:[^}]*\.(?:i2|i_squared)\}\})\s*%", r"\1", text)

    # 11. Whitespace normalization.
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


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
    manuscript text keeps tokens (plan rule 6; contracts/phase-5/tokens.md).
    Unknown tokens are left as-is so the gates can still flag them."""
    try:
        from manuscript.render_tokens import format_value_for_field
    except Exception:
        format_value_for_field = None

    def sub(match):
        field = match.group(2)
        entry = token_table.get(f"{match.group(1)}.{field}")
        if not entry:
            return match.group(0)
        if entry.get("formatted") not in (None, ""):
            return str(entry["formatted"])
        val = entry.get("value")
        if format_value_for_field is not None and isinstance(val, (int, float)) and not isinstance(val, bool):
            return format_value_for_field(field, val)
        return str(val)
    out = re.sub(r"\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}",
                 sub, text)
    out = re.sub(r"(\d+(?:\.\d+)?)%{2,}", r"\1%", out)
    out = re.sub(r"\b([pP])\s*=\s*([<>]\s*\.\d+)", r"\1 \2", out)
    return out


def _order_sections(sections: list) -> list:
    groups = []
    for idx, section in enumerate(sections):
        level = section.get("level", 1)
        if level is None:
            level = 1
        if level <= 1 or not groups:
            sid = str(section.get("id", "")).lower()
            if level <= 1 and sid in IMRAD_ORDER:
                key = (0, IMRAD_ORDER.index(sid), idx)
            else:
                key = (1, 0, idx)
            groups.append((key, [section]))
        else:
            groups[-1][1].append(section)
    groups.sort(key=lambda g: g[0])
    return [sec for _, grp in groups for sec in grp]


def build_manuscript(*, title, sections, token_table, references=None,
                     citation_map=None, manifest=None, outline=None) -> dict:
    """Assemble the JSON manuscript model. sections: parsed draft sections
    (parse_latex_sections output or equivalent dicts)."""
    references = list(references or [])
    citation_map = citation_map or {}
    by_key = {r["key"]: r for r in references if r.get("key")}
    by_key.update({k: v for k, v in citation_map.items() if k not in by_key})

    ordered_raw = _order_sections(list(sections))
    ref_map = {"labels": {}, "counters": {}}
    ordered = [
        {**s, "text": latex_to_text(s.get("text", ""), ref_map=ref_map)}
        for s in ordered_raw
    ]

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
