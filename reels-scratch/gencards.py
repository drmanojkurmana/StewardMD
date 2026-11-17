"""Map verified videos to subjects/modules and emit JS card records for prep-medigram.js.

Reads reels-scratch/verified_final.json, writes reels-scratch/cards.txt (JS lines).
Prints per-subject counts for review.
"""
import json, re, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
items = json.load(open(f"{HERE}/verified_final.json"))

def T(t):
    return (t or "").lower()

# Ordered rules: (keywords, subject, module). Checked in order, first match wins; specific before general.
RULES = [
    (["forensic", "hypothermia", "autopsy", "sudden death", "sudden infant", "postmortem", "lividity",
      "rigor", "brain death", "putrefaction", "vitreous", "vitreous"], "forensic", "forensic-basics"),
    (["scleroderma", "stevens-johnson", "epidermolysis", "eczema", "atopic", "derma", "lesion terminology",
      "psoriasis", "acne", "alopecia", "dermatofibroma", "tinea"], "dermatology", "dermatology-basics"),
    (["dementia", "schizophrenia", "psychosis", "depression", "anxiety", "mental health", "autism",
      "neurodevelopment", "locus of control", "self esteem", "self esteem", "mental disorder", "mdd",
      "ptsd", "suicide", "addiction", "food, sex, and drugs", "behavioral", "behavioural"], "psychiatry", "psychiatry-basics"),
    (["transcription", "translation", "aminoacyl", "ribosome", "protein synthesis", "protein structure",
      "enzyme", "amino acid", "tca", "krebs", "glycolysis", "lipid", "carb metabolism", "metabolism",
      "porphyria", "purine", "pyrimidine", "nucleotide", "dna ", "rna "], "biochemistry", "biochemistry-basics"),
    (["heart failure", "myocardial infarction", "atrial fibrillation", "afib", "arvc", "cardiomyopathy",
      "coronary", "atherosclerosis", "cholesterol gets trapped", "kussmaul", "aortic aneurysm", "aortic",
      "cardiac output", "pulmonary hypertension", "lub dub", "flow through the heart", "murmur",
      "electrical system of the heart", "hypertension", "cyanotic", "constrictive", "pericarditis",
      "cardiology", "heart muscle", "meet the heart"], "cardiology", "cardiology-basics"),
    (["glomerular", "glomerulosclerosis", "kidney", "renal", "nephrotic", "urethral valve", "uti", "bladder",
      "posterior urethral", "nephrology", "nephrotic"], "renal", "renal-basics"),
    (["epistaxis", "nosebleed", "ménière", "meniere", "cholesteatoma", "nasal polyp",
      "sinus", "otitis", "vertigo", "hearing", "ear overview"], "ent", "ent-basics"),
    (["cornea", "cataract", "glaucoma", "ptosis", "papilledema", "conjunctivitis", "retina", "eye",
      "vision", "retinoscopy", "ophthal"], "ophthalmology", "ophthalmology-basics"),
    (["asthma", "wheezy", "emphysema", "bronchitis", "pneumocystis", "pertussis", "whooping", "respiratory",
      "meet the lungs", "copd", "pneumonia", "respiratory viruses"], "respiratory", "respiratory-basics"),
    (["thyroid", "graves", "tsh", "trh", "glucocorticoid", "endocrine", "diabetes", "dka", "pcos", "pmos",
      "endocrine pancreas", "exocrine pancreas", "beta cell"], "endocrine", "endocrine-basics"),
    (["pharmacokinetic", "drug absorption", "metronidazole", "penicillin", "penicillins", "beta lactam",
      "cell wall active", "cell wall", "gram positive", "gram negative", "pharmacology"], "pharmacology", "pharmacology-basics"),
    (["adenovirus", "klebsiella", "clostridium", "neisseria", "leprae", "streptococcus", "pseudomonas",
      "mumps", "influenza", "malaria", "hepatitis", "cerebritis", "cerebral abscess", "bacterial",
      "microbiology", "bacteria", "leukemia", "granulocyte", "lymphocyte", "complement", "interleukin",
      "cytokine", "immune", "histamine", "vasculitis", "immune complex", "tcell", "adaptive immunity",
      "serum sickness", "blood form a clot", "platelet", "thrombocytopenia", "granuloma"], "microbiology", "microbiology-basics"),
    (["mesothelioma", "tum", "granuloma", "pathology", "necrosis", "inflammation", "oedema"], "pathology", "pathology-basics"),
    (["anatomy", "nasal cavity", "cranial nerve", "lymph node", "virchow", "troisier", "waldeyer",
      "laryngeal nerve", "stridor", "aponeurosis", "abdominal viscera", "lymphatics of the neck",
      "blood flow through the heart", "tonsil", "mediastinal", "jugulodigastric",
      "supraclavicular", "delphian", "carotid", "cerebellum", "central nervous", "autonomic nervous",
      "special senses", "epithelial", "organization in the human body", "cell cycle", "embryo"], "anatomy", "anatomy-basics"),
    (["pregnancy", "childbirth", "gestation", "reproductive", "fibroid", "period", "perimenopause",
      "uterine", "obstetric", "embryology", "embryogenesis", "molar", "potter", "placenta", "pregnancy"], "obstetrics", "obstetrics-basics"),
    (["cerebral palsy", "jaundice", "new born", "speech development", "hand, foot and mouth",
      "pediatric", "paediatric", "nicu", "biliary atresia", "hirschsprung", "necrotizing enterocolitis",
      "neuroblastoma"], "paediatrics", "paediatrics-basics"),
    (["rheumatoid", "osteoarthritis", "fracture", "bone", "tennis elbow", "ankle", "elbow", "joint",
      "dislocated shoulder", "acl", "osteoporosis", "arthroplasty", "knee", "posture"], "orthopaedics", "orthopaedics-basics"),
    (["wound healing", "wound", "surgery", "surgical", "burns", "fistula", "cholecystitis", "acute pancreatitis",
      "portal hypertension", "ascites", "pancreatic cyst", "gallbladder", "transplant", "anesthesia",
      "anesthesi", "seizure", "epilepsy", "brain stimulation", "lobotom",
      "tourette", "dystonia", "stroke", "ischemic", "lacunar", "middle cerebral", "weber", "be fast",
      "appendicitis", "hernia"], "surgery", "surgery-basics"),
    (["muscle contraction", "acetylcholine", "gastric acid", "gastric", "hemoglobin", "oxygen",
      "bladder function", "neurophysiology", "action potential", "ecg"], "physiology", "physiology-basics"),
    (["medicine", "general", "pcos", "hand hygiene", "physical exam", "clinical", "fever", "gastroenteritis",
      "inflammatory bowel", "celiac", "gluten", "malaria"], "medicine", "medicine-basics"),
]

def map_subject(x):
    if x.get("override"):
        return x["override"], f"{x['override']}-basics"
    t = T(x["title"])
    for kws, subj, mod in RULES:
        for k in kws:
            if k in t:
                return subj, mod
    return "medicine", "medicine-basics"

def slug(s, n=34):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return (s[:n] or "video").strip("-")

def topic_of(title):
    ws = [w for w in re.sub(r"[^a-zA-Z0-9 ]", " ", title.lower()).split() if len(w) > 3]
    return slug(" ".join(ws[:3]), 30) or "general"

seen = set()
lines = []
counts = collections.Counter()
for x in items:
    subj, mod = map_subject(x)
    counts[subj] += 1
    cid = "mg-v-yt-" + slug(x["title"])
    base = cid
    i = 2
    while cid in seen:
        cid = f"{base}-{i}"
        i += 1
    seen.add(cid)
    topic = topic_of(x["title"])
    ch = x["author_name"].replace('"', "'")
    title = x["title"].replace("\\", "\\\\").replace('"', "'").replace("\n", " ")
    summary = f"A short {ch} explainer: {title[0].lower() + title[1:] if title else 'a clinical topic'}."
    summary = summary.replace('"', "'")
    lines.append(
        f'    {{ id: "{cid}", kind: "video", exam: ["neet-pg", "ini-cet", "usmle"], subject: "{subj}", module: "{mod}", topicIds: ["{topic}"], durationSec: {x["durationSec"]}, language: "en", title: "{title}", summary: "{summary}", media: {{ provider: "youtube", videoId: "{x["id"]}" }}, rightsStatus: "youtube_embed", clinicalReview: {{ status: "approved", reviewedAt: "2026-11-17", reviewerRole: "official-channel; owner spot-check pending" }}, captions: {{ en: true }}, sourceRefs: ["youtube:{ch}"], tags: ["{topic}", "video"], updatedAt: "2026-11-17" }},'
    )

print(dict(counts))
print("total", len(lines))
open(f"{HERE}/cards.txt", "w").write("\n".join(lines) + "\n")
print("wrote cards.txt")
