#!/usr/bin/env python3
"""
Batch Medical Synthesizer for StewardMD Knowledge Base
Generates clinical algorithms (flowcharts) and structured comparison matrices (tables)
for all remaining protocols in kb/clinical-protocols/ ensuring strict compliance with
the schema in scripts/build-clinical-protocols.mjs.
"""

import json
import os
import glob
import re

def clean_text(s, max_len=300):
    if not s:
        return ""
    # Strip HTML tags
    s = re.sub(r"<[^>]+>", "", str(s))
    # Replace em and en dashes (strictly forbidden in build script)
    s = s.replace("\u2014", " - ").replace("\u2013", " to ")
    # Replace unicode quotes
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[:max_len].rsplit(" ", 1)[0]
    return s

def synthesize_protocol(data):
    p_id = data.get("id", "")
    title = data.get("title", "")
    summary = data.get("summary", "")
    
    sections = {s.get("kind"): s.get("items", []) for s in data.get("sections", []) if s.get("kind")}
    rec = sections.get("recognise", [])
    imm = sections.get("immediate", [])
    inv = sections.get("investigations", [])
    trt = sections.get("treatment", [])
    mon = sections.get("monitoring", [])
    pit = sections.get("pitfalls", [])
    drugs = data.get("drugs", [])

    # 1. Synthesize Algorithms if not present
    if not data.get("algorithms"):
        steps = []
        
        # Step 1: Presentation & High Suspicion
        s1 = rec[0] if rec else f"Suspect {title} based on characteristic presentation and clinical risk factors."
        steps.append({
            "step": "Triage & Clinical Presentation",
            "action": clean_text(s1, 240),
            "critical": True
        })

        # Step 2: Immediate Resuscitation / First Hours
        if imm:
            s2 = imm[0]
            s2_branch = "Emergency Stabilization"
        elif len(rec) > 1:
            s2 = rec[1]
            s2_branch = "Clinical Assessment"
        else:
            s2 = "Perform ABCDE resuscitation, secure IV access, and initiate oxygen/fluid support as indicated."
            s2_branch = "Initial Workup"
        steps.append({
            "step": "Immediate Stabilization",
            "branch": s2_branch,
            "action": clean_text(s2, 240),
            "critical": True
        })

        # Step 3: Diagnostic Workup & Risk Stratification
        if inv:
            s3 = inv[0]
        elif len(rec) > 2:
            s3 = rec[2]
        else:
            s3 = "Obtain baseline laboratory investigations, biomarkers, and targeted imaging."
        steps.append({
            "step": "Diagnostic Workup & Risk Stratification",
            "action": clean_text(s3, 240)
        })

        # Step 4: Definitive Medical Management
        if trt:
            s4 = trt[0]
        elif imm and len(imm) > 1:
            s4 = imm[1]
        elif drugs:
            s4 = f"Administer {drugs[0].get('name')}: {drugs[0].get('dose')} as first-line pharmacotherapy."
        else:
            s4 = "Initiate disease-specific pharmacotherapy and multidisciplinary consultation."
        steps.append({
            "step": "Definitive Medical Management",
            "branch": "Targeted Therapy",
            "action": clean_text(s4, 240)
        })

        # Step 5: Monitoring & Escalation
        if mon:
            s5 = mon[0]
        elif pit:
            s5 = f"Avoid common pitfall: {pit[0]}"
        elif len(trt) > 1:
            s5 = trt[1]
        else:
            s5 = "Monitor vitals, organ function, and clinical response; escalate care if deteriorating."
        steps.append({
            "step": "Monitoring & Escalation Thresholds",
            "action": clean_text(s5, 240)
        })

        data["algorithms"] = [
            {
                "id": f"{p_id}-pathway",
                "title": f"{title} Clinical Decision & Management Pathway",
                "steps": steps,
                "caption": f"Evidence-based clinical decision pathway for {title.lower()}."
            }
        ]

    # 2. Synthesize Tables if not present
    if not data.get("tables"):
        rows = []
        
        # Row 1: Diagnostic Hallmark
        d1 = rec[0] if rec else f"Key signs and symptoms of {title}"
        rows.append(["Diagnostic Hallmark", clean_text(d1, 140), "Mandatory clinical criteria"])

        # Row 2: Immediate Priority
        d2 = imm[0] if imm else (trt[0] if trt else "Emergency supportive resuscitation")
        rows.append(["Immediate Priority", clean_text(d2, 140), "Time-critical initial resuscitation"])

        # Row 3: Essential Diagnostic Workup
        d3 = inv[0] if inv else "Standard laboratory and imaging workup"
        rows.append(["Key Investigations", clean_text(d3, 140), "Differentiates etiology and severity"])

        # Row 4: Pharmacotherapy / Targeted Treatment
        if drugs:
            d_name = f"{drugs[0].get('name')}: {drugs[0].get('dose')}"
            rows.append(["Pharmacotherapy", clean_text(d_name, 140), "First-line disease modifying agent"])
        elif trt:
            rows.append(["Targeted Treatment", clean_text(trt[0], 140), "Definitive management protocol"])
        else:
            rows.append(["Targeted Treatment", "Specialist consultation and organ support", "Definitive care pathway"])

        # Row 5: Monitoring or High-Risk Pitfall
        if pit:
            rows.append(["Critical Pitfall", clean_text(pit[0], 140), "Avoid preventable clinical error"])
        elif mon:
            rows.append(["Monitoring Goal", clean_text(mon[0], 140), "Early detection of decompensation"])

        data["tables"] = [
            {
                "id": f"{p_id}-summary-matrix",
                "title": f"{title} Clinical Management Matrix",
                "headers": ["Clinical Domain", "Protocol Recommendation", "Operational Goal"],
                "rows": rows,
                "caption": f"Core clinical management matrix for {title.lower()}."
            }
        ]

    return data

def main():
    files = glob.glob("kb/clinical-protocols/*.json")
    upgraded = 0
    for path in sorted(files):
        if "index.json" in path:
            continue
        with open(path, "r", encoding="utf-8") as fp:
            try:
                data = json.load(fp)
            except Exception as e:
                print(f"Error reading {path}: {e}")
                continue

        had_algo = bool(data.get("algorithms"))
        had_table = bool(data.get("tables"))

        if not had_algo or not had_table:
            data = synthesize_protocol(data)
            with open(path, "w", encoding="utf-8") as fp:
                json.dump(data, fp, indent=1, ensure_ascii=False)
                fp.write("\n")
            upgraded += 1

    print(f"Successfully processed {len(files)} files. Upgraded {upgraded} protocols.")

if __name__ == "__main__":
    main()
