"""Adapter pipeline: drives upstream agents through the installed seams.

run_outline proves the outline seam end to end (3.7 spike test). run_manuscript
chains outline -> literature suggester -> section writing -> gated refinement
-> JSON manuscript. Ceilings clamp the refinement loop at construction AND the
gateway client counts rounds/calls, so a runaway loop dies twice over.
"""
from __future__ import annotations

import datetime
import json
import shutil
from pathlib import Path

from . import gates, repair, seams, writer
from .loader import build_inputs
from .llm import GatewayLLMClient


def _cutoff(cutoff_date):
    return cutoff_date or datetime.datetime.now().strftime("%Y-%m")


def run_outline(manifest, workdir, client: GatewayLLMClient, search=None,
                cutoff_date=None):
    """Upstream OutlineAgent, unedited, on ResearchMD inputs. Returns the
    outline dict (also written to workdir/outline.json by upstream)."""
    from methods.agents.outline_agent import OutlineAgent

    inputs = build_inputs(manifest, workdir)
    uninstall = seams.install(client, search)
    try:
        agent = OutlineAgent(model_name="researchmd-writer", cutoff_date=_cutoff(cutoff_date))
        return agent.run(
            idea_file=str(inputs.idea_file),
            experimental_log_file=str(inputs.experimental_log_file),
            latex_template_file=str(inputs.latex_template_file),
            conference_guidelines_file=str(inputs.conference_guidelines_file),
            output_filepath=str(Path(workdir) / "outline.json"),
        )
    finally:
        uninstall()


def run_section_draft(manifest, workdir, client, outline, citation_map=None,
                      search=None, cutoff_date=None, with_literature=False):
    """Optional literature suggester (upstream HybridLiteratureAgent, our
    connectors for enrichment) then upstream SectionWritingAgent. Returns
    (draft_tex, citation_map, literature_dir)."""
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
            agent.run(outline_path=str(outline_path), cutoff_date=_cutoff(cutoff_date))
            shutil.copy(literature_dir / "outline_v1.json", outline_path)
            template_path = literature_dir / "updated_template.tex"
            lit_map = json.loads((literature_dir / "citation_map.json").read_text())
            citation_map.update(lit_map)
        citation_map_path = workdir / "citation_map.json"
        citation_map_path.write_text(json.dumps(citation_map, indent=2), encoding="utf-8")
        section_agent = SectionWritingAgent(
            outline_path=str(outline_path),
            template_path=str(template_path),
            idea_path=str(inputs.idea_file),
            experimental_log_path=str(inputs.experimental_log_file),
            citation_map_path=str(citation_map_path),
            figures_info_path=str(inputs.figures_info_path),
            guidelines_path=str(inputs.conference_guidelines_file),
            model_name="researchmd-writer")
        draft_path = workdir / "raw_draft_paper.tex"
        draft = section_agent.run(output_path=str(draft_path))
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
    inputs = build_inputs(manifest, workdir)
    outline = run_outline(manifest, workdir, client, search, cutoff_date)
    draft, citation_map, _ = run_section_draft(
        manifest, workdir, client, outline, citation_map=None, search=search,
        cutoff_date=cutoff_date, with_literature=with_literature)
    final_tex, gate_context = run_refinement(
        manifest, workdir, client, draft, citation_map, inputs.token_table,
        search=search, max_reflections=max_reflections)
    manuscript = assemble_manuscript(manifest, final_tex, inputs.token_table,
                                     citation_map, outline,
                                     client=client, gate_context=gate_context)
    manuscript["provenance"]["usage"] = client.total_usage()
    return manuscript
