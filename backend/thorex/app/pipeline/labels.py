# One-line clinical relevance per finding. RULE content, reviewed by R1 clinical gate.
RELEVANCE = {
    "Pneumonia": "Airspace opacity; correlate with fever, WBC, CRP/procalcitonin.",
    "Consolidation": "Dense airspace filling; infective vs haemorrhage vs infarct.",
    "Effusion": "Pleural fluid; assess size and layering.",
    "Pneumothorax": "Pleural air; urgent if large or tension physiology.",
    "Edema": "Interstitial/alveolar fluid; correlate with BNP, EF, fluid status.",
    "Atelectasis": "Volume loss; distinguish from consolidation.",
    "Cardiomegaly": "Enlarged cardiac silhouette (limited on AP/portable).",
    "Emphysema": "Hyperinflation/lucency.",
    "Fibrosis": "Reticular changes; chronicity.",
    "Nodule": "Focal <3cm; needs follow-up/prior comparison.",
    "Mass": "Focal >3cm; malignancy workup.",
    "Pleural_Thickening": "Chronic pleural change.",
    "Cavity": "Lucent lesion; TB, abscess, septic emboli, malignancy.",
    "Hernia": "Diaphragmatic/hiatal.",
    "Mediastinal_Widening": "Assess aorta/lymphadenopathy.",
    "Fracture": "Rib/clavicle if visible.",
    "Calcification": "Granuloma vs vascular vs nodal.",
}


def relevance(label: str) -> str:
    return RELEVANCE.get(label, "Correlate clinically.")
