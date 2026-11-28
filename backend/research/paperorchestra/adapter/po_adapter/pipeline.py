"""Adapter pipeline: drives upstream agents through the installed seams.

run_outline proves the outline seam end to end (3.7 spike test). run_manuscript
chains outline -> literature suggester -> section writing -> gated refinement
-> JSON manuscript. Ceilings clamp the refinement loop at construction AND the
gateway client counts rounds/calls, so a runaway loop dies twice over.
"""
from __future__ import annotations

import datetime
import json
import re
import shutil
from pathlib import Path

from . import gates, repair, seams, writer
from .loader import build_inputs
from .llm import GatewayError, GatewayLLMClient, sanitize_step_id


def _cutoff(cutoff_date):
    return cutoff_date or datetime.datetime.now().strftime("%Y-%m")


def build_section_order(outline: dict | None) -> list[dict]:
    """Mirror research-ondevice-draft.js buildSectionOrder so cloud resumes hit JS stepIds."""
    plan = outline.get("section_plan") if isinstance(outline, dict) else None
    if isinstance(plan, list) and len(plan) > 0:
        used: set[str] = set()
        out = []
        for idx, item in enumerate(plan):
            raw = None
            if isinstance(item, dict):
                for key in ("section_title", "section_name", "name", "section"):
                    val = item.get(key)
                    if isinstance(val, str) and val.strip():
                        raw = val.strip()
                        break
            title = raw or f"Section {idx + 1}"
            base_id = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or f"section-{idx + 1}"
            sec_id = base_id
            suffix = 2
            while sec_id in used:
                sec_id = f"{base_id}-{suffix}"
                suffix += 1
            used.add(sec_id)
            out.append({
                "id": sec_id,
                "title": title,
                "stepId": sanitize_step_id(f"section:{sec_id}") or f"section:s{idx + 1}",
                "plan": item,
            })
        return out
    return [
        {"id": "abstract", "title": "Abstract", "stepId": "section:abstract", "plan": None},
        {"id": "introduction", "title": "Introduction", "stepId": "section:introduction", "plan": None},
        {"id": "methods", "title": "Methods", "stepId": "section:methods", "plan": None},
        {"id": "results", "title": "Results", "stepId": "section:results", "plan": None},
        {"id": "discussion", "title": "Discussion", "stepId": "section:discussion", "plan": None},
    ]


def run_outline(manifest, workdir, client: GatewayLLMClient, search=None,
                cutoff_date=None):
    """Upstream OutlineAgent, unedited, on ResearchMD inputs. Returns the
    outline dict (also written to workdir/outline.json by upstream)."""
    from methods.agents.outline_agent import OutlineAgent

    with client.step("validate"):
        inputs = build_inputs(manifest, workdir)
    uninstall = seams.install(client, search)
    try:
        agent = OutlineAgent(model_name="researchmd-writer", cutoff_date=_cutoff(cutoff_date))
        max_retries = max(0, int(client.ceilings.get("max_retries", 2)))
        with client.step_prefix("outline", track_retries=True):
            for attempt in range(max_retries + 1):
                try:
                    return agent.run(
                        idea_file=str(inputs.idea_file),
                        experimental_log_file=str(inputs.experimental_log_file),
                        latex_template_file=str(inputs.latex_template_file),
                        conference_guidelines_file=str(inputs.conference_guidelines_file),
                        output_filepath=str(Path(workdir) / "outline.json"),
                    )
                except GatewayError as exc:
                    if str(exc).startswith("unparseable_response") and attempt < max_retries:
                        continue
                    raise
    finally:
        uninstall()


def run_section_draft(manifest, workdir, client, outline, citation_map=None,
                      search=None, cutoff_date=None, with_literature=False):
    """Optional literature suggester (upstream HybridLiteratureAgent, our
    connectors for enrichment) then section drafting with JS-matching stepIds.
    Returns (draft_tex, citation_map, literature_dir)."""
    from methods.agents.literature_review_agent import HybridLiteratureAgent
    from methods.agents.section_writing_agent import SectionWritingAgent

    workdir = Path(workdir)
    inputs = build_inputs(manifest, workdir)
    citation_map = dict(citation_map or {})
    for ref in inputs.references:
        citation_map.setdefault(ref["key"], ref)
    literature_dir = workdir / "literature_agent_output"
    uninstall = seams.install(client, search)
    try:
        outline_path = workdir / "outline.json"
        outline_path.write_text(json.dumps(outline, indent=2), encoding="utf-8")
        template_path = inputs.latex_template_file
        if with_literature:
            agent = HybridLiteratureAgent(
                idea_path=str(inputs.idea_file),
                experimental_log_path=str(inputs.experimental_log_file),
                latex_template_path=str(inputs.latex_template_file),
                conference_guidelines_path=str(inputs.conference_guidelines_file),
                output_dir=str(literature_dir),
                model_name="researchmd-writer", max_workers=3)
            with client.step_prefix("lit", track_retries=True):
                agent.run(outline_path=str(outline_path), cutoff_date=_cutoff(cutoff_date))
            shutil.copy(literature_dir / "outline_v1.json", outline_path)
            template_path = literature_dir / "updated_template.tex"
            lit_map = json.loads((literature_dir / "citation_map.json").read_text())
            citation_map.update(lit_map)
        citation_map_path = workdir / "citation_map.json"
        citation_map_path.write_text(json.dumps(citation_map, indent=2), encoding="utf-8")
        draft_path = workdir / "raw_draft_paper.tex"
        order = build_section_order(outline)
        if with_literature or len(order) <= 1:
            section_agent = SectionWritingAgent(
                outline_path=str(outline_path),
                template_path=str(template_path),
                idea_path=str(inputs.idea_file),
                experimental_log_path=str(inputs.experimental_log_file),
                citation_map_path=str(citation_map_path),
                figures_info_path=str(inputs.figures_info_path),
                guidelines_path=str(inputs.conference_guidelines_file),
                model_name="researchmd-writer")
            first_sid = order[0]["stepId"] if order else "section:body"
            with client.step_prefix(first_sid, track_retries=True):
                draft = section_agent.run(output_path=str(draft_path))
            return draft, citation_map, literature_dir

        idea_text = Path(inputs.idea_file).read_text(encoding="utf-8")
        exp_text = Path(inputs.experimental_log_file).read_text(encoding="utf-8")
        outline_str = json.dumps(outline, indent=2)
        cites_str = ", ".join(citation_map.keys()) if citation_map else "none"
        pieces = []
        max_retries = max(0, int(client.ceilings.get("max_retries", 2)))
        for sec in order:
            if re.match(r"^(?:\d+\.\s*)?references$", str(sec.get("title") or "").strip(), re.I):
                pieces.append("\\section*{References}\n")
                continue
            sec_text = ""
            for attempt in range(max_retries + 1):
                sid = sec["stepId"] if attempt == 0 else sanitize_step_id(f"{sec['stepId']}:r{attempt}")
                prompt = (
                    f"Write only the LaTeX \\section{{{sec['title']}}} for this medical research manuscript.\n"
                    f"Citation keys allowed: {cites_str}.\n\n"
                    f"Research Idea:\n{idea_text}\n\nData & Results:\n{exp_text}\n\n"
                    f"Outline:\n{outline_str}\n\nSection plan:\n{json.dumps(sec['plan'] or {}, indent=2)}"
                )
                resp = client.call_text(
                    prompt, "researchmd-writer",
                    result_parsing_func=lambda raw: raw,
                    check_parsed_response_not_none=False,
                    purpose="write",
                    step_id=sid,
                )
                cand = str((resp or {}).get("raw_response") or "").strip()
                if cand:
                    if not re.search(r"\\section\*?\{", cand):
                        cand = f"\\section{{{sec['title']}}}\n{cand}"
                    sec_text = cand
                    break
            pieces.append(sec_text)
        draft = "\n\n".join(p for p in pieces if p)
        draft_path.write_text(draft, encoding="utf-8")
        return draft, citation_map, literature_dir
    finally:
        uninstall()


def run_refinement(manifest, workdir, client, draft_tex, citation_map,
                   token_table, search=None, max_reflections=99):
    """Upstream ContentRefinementAgent with text stand-ins for LaTeX/PDF.
    Rounds are clamped to the tier ceiling here and counted in the client.
    Hard gates run before every autorater score (seams.gated_review).
    Returns (final_tex, gate_context)."""
    from methods.agents.content_refinement_agent import ContentRefinementAgent

    workdir = Path(workdir)
    inputs = build_inputs(manifest, workdir)
    refinement_dir = workdir / "content_refinement_workdir"
    refinement_dir.mkdir(parents=True, exist_ok=True)
    draft_path = refinement_dir / "raw_draft_paper.tex"
    draft_path.write_text(draft_tex, encoding="utf-8")
    citation_map_path = workdir / "citation_map.json"
    citation_map_path.write_text(json.dumps(citation_map, indent=2), encoding="utf-8")

    gate_context = {"token_table": token_table, "citation_map": citation_map,
                    "manifest": manifest, "gate_hits": [], "repairs": []}
    # Keep the candidate gate-clean before the refinement agent reads it; a
    # job must not die because of one stray sentence in the initial draft.
    draft_tex, _remaining = repair.apply_repair(
        client, draft_tex, token_table, citation_map, manifest, gate_context)
    draft_path.write_text(draft_tex, encoding="utf-8")
    rounds = min(max_reflections, client.ceilings["max_refinement_rounds"])
    uninstall = seams.install(client, search, gate_context)
    try:
        agent = ContentRefinementAgent(
            experimental_log_path=str(inputs.experimental_log_file),
            citation_map_path=str(citation_map_path),
            guidelines_path=str(inputs.conference_guidelines_file),
            model_name="researchmd-reflection",
            max_reflections=rounds,
            work_dir=str(refinement_dir))
        agent.run(texfile_path=str(draft_path))
        # Upstream swallows exceptions from review/parse callbacks; a ceiling
        # hit during repair is re-raised here so it reaches the job unchanged.
        ceiling_error = gate_context.pop("ceiling_error", None)
        if ceiling_error is not None:
            raise ceiling_error
        final_tex = (refinement_dir / "final_refined_paper.tex").read_text(encoding="utf-8")
        return final_tex, gate_context
    finally:
        uninstall()


def assemble_manuscript(manifest, final_tex, token_table, citation_map, outline=None,
                        client=None, gate_context=None):
    """Repair (bounded), then final hard gates, then the JSON manuscript model
    (writer seam). Without a client this is the old enforce-only path."""
    if client is not None:
        final_tex, _remaining = repair.apply_repair(
            client, final_tex, token_table, citation_map, manifest, gate_context)
    sections = writer.parse_latex_sections(final_tex)
    gates.enforce(sections, token_table, citation_map, manifest)
    manuscript = writer.build_manuscript(
        title=(manifest.get("protocol") or {}).get("title", ""),
        sections=sections, token_table=token_table,
        references=manifest.get("references") or [],
        citation_map=citation_map, manifest=manifest, outline=outline)
    if gate_context is not None:
        manuscript["provenance"]["gateHits"] = list(gate_context.get("gate_hits") or [])
        manuscript["provenance"]["repairs"] = list(gate_context.get("repairs") or [])
    return manuscript


def run_manuscript(manifest, workdir, client, search=None, cutoff_date=None,
                   with_literature=False, max_reflections=99):
    """Full chain. Raises GateError/CeilingError/PhiBlockedError on failure;
    partial work is never returned as a result (ceilings.md)."""
    with client.step("validate"):
        inputs = build_inputs(manifest, workdir)
    outline = run_outline(manifest, workdir, client, search, cutoff_date)
    draft, citation_map, _ = run_section_draft(
        manifest, workdir, client, outline, citation_map=None, search=search,
        cutoff_date=cutoff_date, with_literature=with_literature)
    final_tex, gate_context = run_refinement(
        manifest, workdir, client, draft, citation_map, inputs.token_table,
        search=search, max_reflections=max_reflections)
    with client.step("final"):
        manuscript = assemble_manuscript(manifest, final_tex, inputs.token_table,
                                         citation_map, outline,
                                         client=client, gate_context=gate_context)
    manuscript["provenance"]["usage"] = client.total_usage()
    return manuscript
