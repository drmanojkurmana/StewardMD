// scripts/build-gastroenterology-blueprint.mjs
// Compiles the high-yield Gastroenterology Stage 1 blueprint adhering to:
// - Sleisenger and Fordtran's Gastrointestinal and Liver Disease 11th Edition
// - Harrison's Principles of Internal Medicine 22nd Edition
// - ACG, AGA, BSG, and Maastricht VI clinical practice guidelines
// - 27 modules across 8 sections, 8 mustKnow facts per module (216 facts total)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const blueprint = {
  subject: "ss-gastroenterology",
  title: "Gastroenterology",
  branch: "ss-medicine",
  curriculum: "NMC Competency-Based DM Gastroenterology Curriculum / NBEMS NEET-SS Medical Group",
  examPattern: "NEET-SS Medical Group (100% General Medicine feeder and Gastroenterology subspecialty: luminal gastroenterology, acid peptic diseases, GI bleeding, malabsorption, inflammatory bowel disease, GI motility, neurogastroenterology, pancreaticobiliary disorders, GI oncology and therapeutic endoscopy).",
  book: "Sleisenger and Fordtran's Gastrointestinal and Liver Disease 11th Edition; Harrison's Principles of Internal Medicine 22nd Edition; Gastroenterology Final by Dr VG",
  sections: [
    {
      id: "sgi-oesophagus",
      name: "Oesophagus",
      modules: [
        {
          id: "sgi-gerd-barrett",
          name: "Gastroesophageal reflux disease and Barrett oesophagus",
          size: "l",
          topics: [
            {
              id: "sgi-gerd-barrett",
              title: "Gastroesophageal reflux disease and Barrett oesophagus",
              book: "Sleisenger & Fordtran 11e Ch. 44, 45",
              mustKnow: [
                {
                  fact: "Lyon Consensus 2.0 defines conclusive GERD as Los Angeles grade C or D esophagitis, biopsy-proven Barrett esophagus >= 1 cm, peptic stricture, or acid exposure time (AET) > 6.0% on wireless or catheter ambulatory pH monitoring.",
                  terms: ["Lyon Consensus", "acid exposure time"],
                  numbers: ["2.0", "1", "6.0%"],
                  source: "Sleisenger 11e Ch. 44 / Lyon Consensus"
                },
                {
                  fact: "Prague C & M criteria quantify Barrett esophagus extent by measuring circumferential extent (C) and maximum extent (M) in centimetres from the gastroesophageal junction.",
                  terms: ["Prague C & M", "circumferential extent"],
                  source: "Sleisenger 11e Ch. 45"
                },
                {
                  fact: "Seattle biopsy protocol mandates 4-quadrant jumbo forceps biopsies every 1 to 2 cm throughout the Barrett segment, with target biopsies of any visible mucosal irregularities.",
                  terms: ["Seattle biopsy protocol", "Barrett segment"],
                  numbers: ["4", "1", "2"],
                  source: "Sleisenger 11e Ch. 45"
                },
                {
                  fact: "Endoscopic eradication therapy (EET) combining endoscopic mucosal resection (EMR) for visible mucosal lesions followed by radiofrequency ablation (RFA) is the standard of care for Barrett esophagus with high-grade dysplasia or intramucosal adenocarcinoma.",
                  terms: ["radiofrequency ablation", "high-grade dysplasia"],
                  source: "Sleisenger 11e Ch. 45"
                },
                {
                  fact: "Vonoprazan is an oral potassium-competitive acid blocker (P-CAB) that inhibits H+/K+-ATPase without requiring acid activation, achieving faster and more durable gastric acid suppression than conventional PPIs.",
                  terms: ["Vonoprazan", "potassium-competitive acid blocker"],
                  source: "Sleisenger 11e Ch. 44"
                },
                {
                  fact: "Magnetic sphincter augmentation (LINX device) and laparoscopic Nissen fundoplication provide durable mechanical anti-reflux barriers in patients with documented abnormal AET and good esophageal peristalsis.",
                  terms: ["Nissen fundoplication", "LINX device"],
                  source: "Sleisenger 11e Ch. 44"
                },
                {
                  fact: "Reflux hypersensitivity is diagnosed in Rome IV when typical heartburn occurs with normal acid exposure time (AET < 4.0%) but positive symptom-reflux correlation (symptom index > 50% or symptom association probability > 95%).",
                  terms: ["Reflux hypersensitivity", "symptom association probability"],
                  numbers: ["4", "4.0%", "50%", "95%"],
                  source: "Sleisenger 11e Ch. 44"
                },
                {
                  fact: "Functional heartburn represents persistent burning retrosternal discomfort refractory to PPI therapy with normal endoscopy, normal AET (< 4.0%), and negative symptom-reflux association, treated with neuromodulators.",
                  terms: ["Functional heartburn", "neuromodulators"],
                  numbers: ["4.0%"],
                  source: "Sleisenger 11e Ch. 44"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-oesophageal-motility",
          name: "Oesophageal motility disorders",
          size: "m",
          topics: [
            {
              id: "sgi-oesophageal-motility",
              title: "Oesophageal motility disorders",
              book: "Sleisenger & Fordtran 11e Ch. 43",
              mustKnow: [
                {
                  fact: "Chicago Classification v4.0 defines achalasia by an elevated median integrated relaxation pressure (IRP > 15 mmHg with Sierra/Medtronic or > 28 mmHg with Diversatek) alongside 100% failed peristalsis.",
                  terms: ["Chicago Classification", "integrated relaxation pressure"],
                  numbers: ["4.0", "15", "28", "100%"],
                  source: "Sleisenger 11e Ch. 43 / CCv4.0"
                },
                {
                  fact: "Type I achalasia (classic) features 100% failed peristalsis with no pan-esophageal pressurization; Type II achalasia features panesophageal pressurization in >= 20% of swallows; Type III (spastic) features premature spastic contractions in >= 20% of swallows.",
                  terms: ["Type I achalasia", "panesophageal pressurization"],
                  numbers: ["1", "2", "3", "100%", "20%"],
                  source: "Sleisenger 11e Ch. 43"
                },
                {
                  fact: "Peroral endoscopic myotomy (POEM) provides durable dysphagia relief across all achalasia subtypes, uniquely offering extended proximal esophageal myotomy essential for Type III (spastic) achalasia.",
                  terms: ["Peroral endoscopic myotomy", "achalasia subtypes"],
                  numbers: ["3"],
                  source: "Sleisenger 11e Ch. 43"
                },
                {
                  fact: "Pneumatic balloon dilatation uses graded low-compliance balloons (30 mm, 35 mm, 40 mm) to disrupt the lower esophageal sphincter circular muscle fibres, carrying a 2% to 3% perforation risk.",
                  terms: ["Pneumatic balloon dilatation", "lower esophageal sphincter"],
                  numbers: ["30", "35", "40", "2%", "3%"],
                  source: "Sleisenger 11e Ch. 43"
                },
                {
                  fact: "Distal esophageal spasm (DES) is diagnosed by normal IRP alongside >= 20% premature contractions with a distal latency < 4.5 seconds in high-resolution manometry.",
                  terms: ["Distal esophageal spasm", "distal latency"],
                  numbers: ["20%", "4.5"],
                  source: "Sleisenger 11e Ch. 43"
                },
                {
                  fact: "Jackhammer esophagus (hypercontractile esophagus) is defined by >= 20% hypercontractile swallows with a distal contractile integral (DCI) > 8,000 mmHg-s-cm and normal LES relaxation.",
                  terms: ["Jackhammer esophagus", "distal contractile integral"],
                  numbers: ["20%", "8000"],
                  source: "Sleisenger 11e Ch. 43"
                },
                {
                  fact: "Esophagogastric junction outflow obstruction (EGJ-OO) requires elevated IRP, preserved peristalsis that does not meet criteria for achalasia, and clinically relevant intragastric pressure gradients.",
                  terms: ["Esophagogastric junction outflow obstruction", "preserved peristalsis"],
                  source: "Sleisenger 11e Ch. 43"
                },
                {
                  fact: "Chagas disease causes secondary achalasia (megaesophagus) and megacolon through autoimmune destruction of intramural Auerbach myenteric plexus neurons by Trypanosoma cruzi.",
                  terms: ["Chagas disease", "Auerbach myenteric plexus"],
                  source: "Sleisenger 11e Ch. 43"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-eosinophilic-infectious-oesophagitis",
          name: "Eosinophilic, infectious and corrosive oesophageal disease",
          size: "s",
          topics: [
            {
              id: "sgi-eosinophilic-infectious-oesophagitis",
              title: "Eosinophilic, infectious and corrosive oesophageal disease",
              book: "Sleisenger & Fordtran 11e Ch. 42, 46",
              mustKnow: [
                {
                  fact: "Eosinophilic esophagitis (EoE) is diagnosed by symptoms of esophageal dysfunction and mucosal biopsies demonstrating >= 15 eosinophils per high-power field (HPF) after excluding non-EoE causes.",
                  terms: ["Eosinophilic esophagitis", "eosinophils per high-power field"],
                  numbers: ["15"],
                  source: "Sleisenger 11e Ch. 46"
                },
                {
                  fact: "Endoscopic Reference Score (EREFS) grades EoE severity across 5 cardinal features: Edema (loss of vascular markings), Rings (concentric trachealization), Exudates (white plaques), Furrows (vertical lines), and Strictures.",
                  terms: ["EREFS", "trachealization"],
                  numbers: ["5"],
                  source: "Sleisenger 11e Ch. 46"
                },
                {
                  fact: "Dupilumab is a fully human monoclonal antibody targeting interleukin-4 receptor alpha (IL-4R-alpha) that blocks IL-4 and IL-13 signaling, approved for refractory eosinophilic esophagitis.",
                  terms: ["Dupilumab", "interleukin-4 receptor alpha"],
                  numbers: ["4", "13"],
                  source: "Sleisenger 11e Ch. 46"
                },
                {
                  fact: "Swallowed topical corticosteroids (fluticasone propionate or budesonide suspension) induce histologic remission in over 70% of EoE patients.",
                  terms: ["fluticasone propionate", "budesonide"],
                  numbers: ["70%"],
                  source: "Sleisenger 11e Ch. 46"
                },
                {
                  fact: "Candida esophagitis presents with diffuse white plaques adherent to friable mucosa, typically seen in immunosuppressed hosts and treated with oral fluconazole for 14 to 21 days.",
                  terms: ["Candida esophagitis", "fluconazole"],
                  numbers: ["14", "21"],
                  source: "Sleisenger 11e Ch. 42"
                },
                {
                  fact: "Cytomegalovirus (CMV) esophagitis produces large, shallow, linear ulcers in the middle-to-distal esophagus displaying nuclear and cytoplasmic viral inclusion bodies on endothelial biopsy, treated with IV ganciclovir.",
                  terms: ["Cytomegalovirus esophagitis", "ganciclovir"],
                  source: "Sleisenger 11e Ch. 42"
                },
                {
                  fact: "Herpes simplex virus (HSV) esophagitis features multiple small 'punched-out' or volcaniform ulcers with multinucleated giant cells and Cowdry A inclusion bodies on squamous epithelial biopsy, responsive to acyclovir.",
                  terms: ["Herpes simplex virus", "Cowdry A"],
                  source: "Sleisenger 11e Ch. 42"
                },
                {
                  fact: "Zargar classification stratifies acute corrosive ingestion injury from Grade 0 (normal) to Grade 3b (extensive transmural necrosis), where Grade 3 lesions carry high stricture risk and contraindicate blind nasogastric tubes.",
                  terms: ["Zargar classification", "corrosive ingestion"],
                  numbers: ["0", "3"],
                  source: "Sleisenger 11e Ch. 42"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-oesophageal-cancer",
          name: "Oesophageal cancer",
          size: "m",
          topics: [
            {
              id: "sgi-oesophageal-cancer",
              title: "Oesophageal cancer",
              book: "Sleisenger & Fordtran 11e Ch. 47",
              mustKnow: [
                {
                  fact: "Squamous cell carcinoma dominates the proximal and mid-thoracic esophagus associated with tobacco, alcohol, hot beverages, and nutritional deficiencies, whereas adenocarcinoma predominates in the distal esophagus arising from Barrett metaplasia.",
                  terms: ["Squamous cell carcinoma", "adenocarcinoma"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "CROSS trial established neoadjuvant chemoradiotherapy (carboplatin, paclitaxel, and 41.4 Gy radiation) followed by surgery as standard of care for locally advanced resectable esophageal and GEJ cancers.",
                  terms: ["CROSS trial", "neoadjuvant chemoradiotherapy"],
                  numbers: ["41.4"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "CheckMate 577 trial demonstrated that adjuvant nivolumab (anti-PD-1) significantly doubles disease-free survival in patients with residual pathological disease (non-pCR) following neoadjuvant chemoradiation and resection.",
                  terms: ["CheckMate 577", "nivolumab"],
                  numbers: ["577", "1"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "Endoscopic submucosal dissection (ESD) is indicated for early esophageal superficial neoplastic lesions confined to mucosa (T1a) without lymphovascular invasion, achieving en bloc resection rates > 90%.",
                  terms: ["Endoscopic submucosal dissection", "lymphovascular invasion"],
                  numbers: ["1", "90%"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "Endoscopic ultrasound (EUS) is the most accurate imaging modality for T-staging (90% accuracy) and regional N-staging of esophageal cancer, allowing fine-needle aspiration of suspicious peri-esophageal lymph nodes.",
                  terms: ["Endoscopic ultrasound", "T-staging"],
                  numbers: ["90%"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "Self-expanding metal stents (SEMS), particularly covered or partially covered designs, provide rapid and effective palliation of dysphagia in unresectable or metastatic obstructing esophageal carcinoma.",
                  terms: ["Self-expanding metal stents", "palliation of dysphagia"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "Tylosis with esophageal cancer (Howel-Evans syndrome) is an autosomal dominant syndrome caused by RHBDF2 mutations, characterized by focal palmoplantar keratoderma and up to 95% lifetime risk of esophageal squamous cell carcinoma.",
                  terms: ["Howel-Evans syndrome", "RHBDF2 mutations"],
                  numbers: ["95%"],
                  source: "Sleisenger 11e Ch. 47"
                },
                {
                  fact: "Plummer-Vinson syndrome (Paterson-Kelly syndrome) features cervical esophageal webs, microcytic iron deficiency anemia, and koilonychia, carrying an increased risk of postcricoid and upper esophageal squamous cancer.",
                  terms: ["Plummer-Vinson syndrome", "esophageal webs"],
                  source: "Sleisenger 11e Ch. 47"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-stomach",
      name: "Stomach and duodenum",
      modules: [
        {
          id: "sgi-hpylori-peptic-ulcer",
          name: "Helicobacter pylori and peptic ulcer disease",
          size: "l",
          topics: [
            {
              id: "sgi-hpylori-peptic-ulcer",
              title: "Helicobacter pylori and peptic ulcer disease",
              book: "Sleisenger & Fordtran 11e Ch. 52, 53",
              mustKnow: [
                {
                  fact: "Maastricht VI consensus recommends 14-day bismuth quadruple therapy (PPI, bismuth subcitrate, tetracycline, metronidazole) or vonoprazan-based dual/triple therapy as first-line empiric eradication in areas with high clarithromycin resistance (> 15%).",
                  terms: ["Maastricht VI", "bismuth quadruple therapy"],
                  numbers: ["6", "14", "15%"],
                  source: "Sleisenger 11e Ch. 52 / Maastricht VI"
                },
                {
                  fact: "Urea breath test (13C or 14C) and stool antigen test are non-invasive tests of active H. pylori infection, requiring discontinuation of PPIs for at least 14 days and antibiotics/bismuth for at least 28 days to prevent false negatives.",
                  terms: ["Urea breath test", "stool antigen test"],
                  numbers: ["13", "14", "28"],
                  source: "Sleisenger 11e Ch. 52"
                },
                {
                  fact: "Correa cascade details the multistep progression from chronic active gastritis to multifocal atrophic gastritis, intestinal metaplasia, dysplasia, and intestinal-type gastric adenocarcinoma driven by persistent H. pylori infection.",
                  terms: ["Correa cascade", "intestinal metaplasia"],
                  source: "Sleisenger 11e Ch. 52"
                },
                {
                  fact: "Gastric ulcers require mandatory follow-up surveillance endoscopy with repeat biopsy after 6 to 8 weeks of medical acid suppression to confirm complete healing and exclude ulcerated gastric malignancy.",
                  terms: ["Gastric ulcers", "surveillance endoscopy"],
                  numbers: ["6", "8"],
                  source: "Sleisenger 11e Ch. 53"
                },
                {
                  fact: "NSAID-induced ulcers occur through systemic inhibition of cyclooxygenase-1 (COX-1) which depletes cytoprotective mucosal prostaglandins (PGE2, PGI2) and causes direct topical acidic mucosal epithelial damage.",
                  terms: ["NSAID-induced ulcers", "cyclooxygenase-1"],
                  numbers: ["1", "2"],
                  source: "Sleisenger 11e Ch. 53"
                },
                {
                  fact: "Zollinger-Ellison syndrome (ZES) is caused by a neuroendocrine gastrinoma, diagnosed by fasting serum gastrin > 1,000 pg/mL with gastric pH < 2, or a paradoxical rise in serum gastrin > 120 pg/mL upon secretin stimulation test.",
                  terms: ["Zollinger-Ellison syndrome", "secretin stimulation test"],
                  numbers: ["1000", "2", "120"],
                  source: "Sleisenger 11e Ch. 53"
                },
                {
                  fact: "Gastric MALT lymphoma (extranodal marginal zone B-cell lymphoma) is driven by chronic H. pylori antigen stimulation, achieving complete remission in up to 75% to 80% of localized stage I cases solely after successful bacterial eradication.",
                  terms: ["MALT lymphoma", "bacterial eradication"],
                  numbers: ["1", "75%", "80%"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "CagA (cytotoxin-associated gene A) and VacA (vacuolating cytotoxin A) are major virulence factors of H. pylori strains associated with elevated risk of peptic ulceration and distal gastric adenocarcinoma.",
                  terms: ["CagA", "VacA"],
                  source: "Sleisenger 11e Ch. 52"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-gastric-neoplasms",
          name: "Gastric neoplasms",
          size: "m",
          topics: [
            {
              id: "sgi-gastric-neoplasms",
              title: "Gastric neoplasms",
              book: "Sleisenger & Fordtran 11e Ch. 54",
              mustKnow: [
                {
                  fact: "Lauren classification divides gastric adenocarcinoma into intestinal type (cohesive glandular elements, associated with H. pylori and environmental metaplasia) and diffuse type (infiltrative discohesive signet-ring cells, associated with CDH1 mutations).",
                  terms: ["Lauren classification", "signet-ring cells"],
                  numbers: ["1"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "Hereditary diffuse gastric cancer (HDGC) is an autosomal dominant cancer predisposition syndrome caused by germline inactivating mutations in CDH1 (encoding E-cadherin), managed by prophylactic total gastrectomy.",
                  terms: ["Hereditary diffuse gastric cancer", "CDH1 mutations"],
                  numbers: ["1"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "Gastrointestinal stromal tumours (GISTs) are mesenchymal neoplasms arising from interstitial cells of Cajal, characterized by expression of CD117 (KIT) in > 95% and DOG1, driven by activating mutations in KIT or PDGFRA.",
                  terms: ["Gastrointestinal stromal tumours", "interstitial cells of Cajal"],
                  numbers: ["117", "95%"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "Imatinib mesylate is a selective tyrosine kinase inhibitor that revolutionised GIST therapy, serving as standard frontline treatment for unresectable, metastatic, or high-recurrence-risk resected disease.",
                  terms: ["Imatinib mesylate", "tyrosine kinase inhibitor"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "Gastric neuroendocrine tumours (NETs) are categorized into Type 1 (associated with chronic autoimmune atrophic gastritis and hypergastrinemia, benign), Type 2 (associated with ZES and MEN1), and Type 3 (sporadic, aggressive solitary lesions with normal gastrin).",
                  terms: ["Gastric neuroendocrine tumours", "Type 1 gastric NET"],
                  numbers: ["1", "2", "3"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "Linitis plastica represents a diffuse infiltrative scirrhous carcinoma of the stomach with extensive fibrous desmoplasia of the submucosa and muscularis propria, resulting in a rigid 'leather bottle' stomach and poor distensibility.",
                  terms: ["Linitis plastica", "leather bottle"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "Endoscopic resection (ESD) for early gastric cancer is indicated for mucosal differentiated adenocarcinomas without ulceration, regardless of size, or ulcerated differentiated tumors <= 3 cm without lymphovascular invasion.",
                  terms: ["early gastric cancer", "mucosal differentiated"],
                  numbers: ["3"],
                  source: "Sleisenger 11e Ch. 54"
                },
                {
                  fact: "FLOT chemotherapy regimen (fluorouracil, leucovorin, oxaliplatin, docetaxel) is the standard perioperative treatment for locally advanced resectable gastric and gastroesophageal junction adenocarcinomas.",
                  terms: ["FLOT chemotherapy", "docetaxel"],
                  source: "Sleisenger 11e Ch. 54"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-gastroparesis-dyspepsia",
          name: "Functional dyspepsia and gastroparesis",
          size: "s",
          topics: [
            {
              id: "sgi-gastroparesis-dyspepsia",
              title: "Functional dyspepsia and gastroparesis",
              book: "Sleisenger & Fordtran 11e Ch. 50, 51",
              mustKnow: [
                {
                  fact: "Rome IV criteria categorize functional dyspepsia into postprandial distress syndrome (bothersome postprandial fullness or early satiation) and epigastric pain syndrome (bothersome epigastric pain or burning unrelated to meals).",
                  terms: ["Rome IV criteria", "postprandial distress syndrome"],
                  numbers: ["4"],
                  source: "Sleisenger 11e Ch. 50"
                },
                {
                  fact: "Gastric emptying scintigraphy using a standardized radiolabeled 99mTc solid meal is the gold standard for diagnosing gastroparesis, with retention > 10% at 4 hours or > 60% at 2 hours diagnostic of delayed emptying.",
                  terms: ["Gastric emptying scintigraphy", "delayed emptying"],
                  numbers: ["99", "10%", "4", "60%", "2"],
                  source: "Sleisenger 11e Ch. 51"
                },
                {
                  fact: "Diabetic gastroparesis arises from autonomic diabetic neuropathy, loss of interstitial cells of Cajal, and neuronal nitric oxide synthase downregulation, leading to postprandial nausea, vomiting, and erratic glycemic control.",
                  terms: ["Diabetic gastroparesis", "neuronal nitric oxide synthase"],
                  source: "Sleisenger 11e Ch. 51"
                },
                {
                  fact: "Metoclopramide is the only FDA-approved dopamine D2 antagonist for diabetic gastroparesis but carries a black box warning for irreversible tardive dyskinesia with usage exceeding 12 weeks.",
                  terms: ["Metoclopramide", "tardive dyskinesia"],
                  numbers: ["2", "12"],
                  source: "Sleisenger 11e Ch. 51"
                },
                {
                  fact: "Gastric peroral endoscopic myotomy (G-POEM) selectively divides the hypertrophied pyloric circular muscle layer, providing substantial symptomatic and physiological improvement in refractory gastroparesis.",
                  terms: ["G-POEM", "pyloric circular muscle"],
                  source: "Sleisenger 11e Ch. 51"
                },
                {
                  fact: "Cyclic vomiting syndrome (CVS) features stereotypic recurrent episodes of acute intractable vomiting separated by symptom-free intervals, strongly associated with migraine headaches and responsive to tricyclic antidepressants.",
                  terms: ["Cyclic vomiting syndrome", "migraine headaches"],
                  source: "Sleisenger 11e Ch. 51"
                },
                {
                  fact: "Cannabinoid hyperemesis syndrome (CHS) occurs in chronic daily cannabis users, characterized by severe episodic cyclical nausea and vomiting with compulsive hot-water bathing behavior that temporarily alleviates symptoms.",
                  terms: ["Cannabinoid hyperemesis syndrome", "hot-water bathing"],
                  source: "Sleisenger 11e Ch. 51"
                },
                {
                  fact: "Rumination syndrome is an involuntary functional behavioural disorder characterized by effortless repetitive postprandial regurgitation of recently ingested food into the mouth, treated with diaphragmatic breathing exercises.",
                  terms: ["Rumination syndrome", "diaphragmatic breathing"],
                  source: "Sleisenger 11e Ch. 51"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-bleeding",
      name: "Gastrointestinal bleeding",
      modules: [
        {
          id: "sgi-upper-gi-bleeding",
          name: "Upper gastrointestinal bleeding",
          size: "l",
          topics: [
            {
              id: "sgi-upper-gi-bleeding",
              title: "Upper gastrointestinal bleeding",
              book: "Sleisenger & Fordtran 11e Ch. 20, 21",
              mustKnow: [
                {
                  fact: "Glasgow-Blatchford score (GBS) calculates pre-endoscopy risk in acute upper GI bleeding; a score of 0 or 1 identifies very low-risk patients who can be safely managed as outpatients without urgent hospital admission.",
                  terms: ["Glasgow-Blatchford score", "upper GI bleeding"],
                  numbers: ["0", "1"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "Restrictive red blood cell transfusion strategy targeting a haemoglobin of 7 to 9 g/dL reduces overall mortality and recurrent bleeding compared to a liberal strategy (threshold 9 g/dL) in acute upper GI haemorrhage.",
                  terms: ["Restrictive transfusion", "haemoglobin target"],
                  numbers: ["7", "9"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "Forrest classification grades peptic ulcer bleeding: Forrest Ia (spurting hemorrhage) and Ib (oozing hemorrhage) represent active bleeding; IIa (non-bleeding visible vessel) and IIb (adherent clot) carry high rebleeding risk; IIc (flat pigmented spot) and III (clean base) have low risk.",
                  terms: ["Forrest classification", "peptic ulcer bleeding"],
                  numbers: ["1", "2", "3"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "High-dose intravenous PPI (80 mg bolus followed by 8 mg/hour infusion for 72 hours) or intermittent twice-daily high-dose oral/IV PPI stabilizes fibrin clots by maintaining intragastric pH > 6.0 following endoscopic haemostasis.",
                  terms: ["intravenous PPI", "intragastric pH"],
                  numbers: ["80", "8", "72", "6.0"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "Dual endoscopic haemostasis combining epinephrine injection with mechanical hemoclips or thermal coagulation is superior to epinephrine monotherapy for high-risk Forrest Ia, Ib, and IIa bleeding ulcers.",
                  terms: ["Dual endoscopic haemostasis", "hemoclips"],
                  numbers: ["1", "2"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "Over-the-scope clips (OTSC) achieve superior initial and definitive haemostasis compared to standard through-the-scope clips for recurrent peptic ulcer bleeding, large fibrotic ulcers (> 1.5 cm), and Dieulafoy lesions.",
                  terms: ["Over-the-scope clips", "recurrent bleeding"],
                  numbers: ["1.5"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "Dieulafoy lesion is a developmental vascular anomaly consisting of a large, tortuous caliber-persistent submucosal artery that erodes through overlying gastric mucosa without surrounding ulceration, typically on the proximal lesser curvature.",
                  terms: ["Dieulafoy lesion", "caliber-persistent submucosal artery"],
                  source: "Sleisenger 11e Ch. 20"
                },
                {
                  fact: "HALT-IT randomised trial showed that tranexamic acid does not reduce death from gastrointestinal bleeding and is associated with an increased risk of venous thromboembolism and seizure events.",
                  terms: ["HALT-IT trial", "tranexamic acid"],
                  source: "Sleisenger 11e Ch. 20 / HALT-IT"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-lower-small-bowel-bleeding",
          name: "Lower and small bowel bleeding",
          size: "m",
          topics: [
            {
              id: "sgi-lower-small-bowel-bleeding",
              title: "Lower and small bowel bleeding",
              book: "Sleisenger & Fordtran 11e Ch. 22",
              mustKnow: [
                {
                  fact: "Oakland score is the validated clinical decision tool for acute lower GI bleeding, where an Oakland score <= 8 safely identifies low-risk patients suitable for outpatient investigation and discharge.",
                  terms: ["Oakland score", "lower GI bleeding"],
                  numbers: ["8"],
                  source: "Sleisenger 11e Ch. 22 / BSG Guidelines"
                },
                {
                  fact: "Diverticular bleeding is the most common cause of acute massive lower GI hemorrhage (30% to 50% of cases), originating from arterial rupture at the neck or dome of a diverticulum, stopping spontaneously in 75% to 80%.",
                  terms: ["Diverticular bleeding", "arterial rupture"],
                  numbers: ["30%", "50%", "75%", "80%"],
                  source: "Sleisenger 11e Ch. 22"
                },
                {
                  fact: "CT angiography (CTA) is the preferred first-line diagnostic investigation in hemodynamically unstable lower GI bleeding, capable of detecting active arterial extravasation at rates as low as 0.3 mL/min.",
                  terms: ["CT angiography", "active arterial extravasation"],
                  numbers: ["0.3"],
                  source: "Sleisenger 11e Ch. 22"
                },
                {
                  fact: "Catheter-directed superselective transcatheter arterial embolisation (TAE) using microcoils or liquid embolic agents provides effective haemostasis for CTA-positive lower GI bleeding with low bowel infarction risk (< 5%).",
                  terms: ["arterial embolisation", "microcoils"],
                  numbers: ["5%"],
                  source: "Sleisenger 11e Ch. 22"
                },
                {
                  fact: "Small bowel bleeding (obscure GI bleeding) accounts for 5% to 10% of GI hemorrhage, with vascular angioectasias dominating in patients over 40 and Crohn disease or Meckel diverticulum dominating in patients under 40.",
                  terms: ["Small bowel bleeding", "angioectasias"],
                  numbers: ["5%", "10%", "40"],
                  source: "Sleisenger 11e Ch. 22"
                },
                {
                  fact: "Video capsule endoscopy (VCE) is the premier first-line non-invasive examination for suspected small bowel bleeding following negative upper endoscopy and colonoscopy, with diagnostic yield reaching 60% in active bleeding.",
                  terms: ["Video capsule endoscopy", "small bowel bleeding"],
                  numbers: ["60%"],
                  source: "Sleisenger 11e Ch. 22"
                },
                {
                  fact: "Device-assisted enteroscopy (single-balloon, double-balloon, or motorized spiral enteroscopy) enables deep therapeutic intervention, allowing argon plasma coagulation (APC) and clip application within the jejunum and ileum.",
                  terms: ["Device-assisted enteroscopy", "argon plasma coagulation"],
                  source: "Sleisenger 11e Ch. 22"
                },
                {
                  fact: "Heyde syndrome is the triad of severe calcific aortic stenosis, acquired von Willebrand syndrome (deficiency of high-molecular-weight vWF multimers due to shear-induced ADAMTS13 cleavage), and bleeding intestinal angiodysplasias.",
                  terms: ["Heyde syndrome", "acquired von Willebrand syndrome"],
                  numbers: ["13"],
                  source: "Sleisenger 11e Ch. 22"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-small-bowel",
      name: "Small intestine",
      modules: [
        {
          id: "sgi-malabsorption-coeliac",
          name: "Malabsorption and coeliac disease",
          size: "l",
          topics: [
            {
              id: "sgi-malabsorption-coeliac",
              title: "Malabsorption and coeliac disease",
              book: "Sleisenger & Fordtran 11e Ch. 107",
              mustKnow: [
                {
                  fact: "Coeliac disease serologic diagnosis requires initial IgA anti-tissue transglutaminase (anti-tTG IgA) paired with total serum IgA to rule out selective IgA deficiency, with IgG-deamidated gliadin peptide (DGP IgG) used in IgA deficiency.",
                  terms: ["anti-tissue transglutaminase", "selective IgA deficiency"],
                  source: "Sleisenger 11e Ch. 107"
                },
                {
                  fact: "Human leukocyte antigen testing reveals that > 99% of coeliac disease patients carry either HLA-DQ2 (specifically DQ2.5 or DQ2.2) or HLA-DQ8; the absence of both alleles possesses an exceptionally high negative predictive value (> 99%).",
                  terms: ["HLA-DQ2", "negative predictive value"],
                  numbers: ["99%", "2", "8"],
                  source: "Sleisenger 11e Ch. 107"
                },
                {
                  fact: "Modified Marsh-Oberhuber classification grades duodenal enteropathy: Marsh 1 (intraepithelial lymphocytosis > 25 per 100 enterocytes), Marsh 2 (crypt hyperplasia), Marsh 3a-c (partial, subtotal, and total villous atrophy).",
                  terms: ["Marsh-Oberhuber", "villous atrophy"],
                  numbers: ["1", "25", "100", "2", "3"],
                  source: "Sleisenger 11e Ch. 107"
                },
                {
                  fact: "Dermatitis herpetiformis is a pathognomonic cutaneous manifestation of coeliac disease featuring intensely pruritic grouped papulovesicular eruptions on extensor surfaces with granular IgA deposition in dermal papillae.",
                  terms: ["Dermatitis herpetiformis", "granular IgA"],
                  source: "Sleisenger 11e Ch. 107"
                },
                {
                  fact: "Refractory coeliac disease (RCD) is defined by persistent malabsorptive symptoms and villous atrophy despite 12 months on a strict gluten-free diet; Type 2 RCD is characterised by clonal aberrant intraepithelial T cells (loss of surface CD3/CD8).",
                  terms: ["Refractory coeliac disease", "aberrant intraepithelial T cells"],
                  numbers: ["12", "2", "3", "8"],
                  source: "Sleisenger 11e Ch. 107"
                },
                {
                  fact: "Enteropathy-associated T-cell lymphoma (EATL) is an aggressive intestinal non-Hodgkin lymphoma arising directly from Type 2 refractory coeliac disease, carrying high perforation and mortality rates.",
                  terms: ["Enteropathy-associated T-cell lymphoma", "EATL"],
                  numbers: ["2"],
                  source: "Sleisenger 11e Ch. 107"
                },
                {
                  fact: "D-xylose absorption test evaluates small intestinal mucosal absorptive integrity: normal 5-hour urinary excretion of >= 4 g following a 25 g oral dose indicates intact mucosal transport, differentiating mucosal malabsorption from pancreatic insufficiency.",
                  terms: ["D-xylose absorption test", "pancreatic insufficiency"],
                  numbers: ["5", "4", "25"],
                  source: "Sleisenger 11e Ch. 106"
                },
                {
                  fact: "Bile acid diarrhoea (type 1 ileal dysfunction, type 2 idiopathic, type 3 post-cholecystectomy) is diagnosed by 7-day 75SeHCAT retention < 10% (severe < 5%) or serum 7-alpha-hydroxy-4-cholesten-3-one (C4), treated with colestyramine.",
                  terms: ["Bile acid diarrhoea", "SeHCAT retention"],
                  numbers: ["1", "2", "3", "7", "75", "10%", "5%", "4"],
                  source: "Sleisenger 11e Ch. 106"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-sibo-tropical-sprue",
          name: "Small intestinal bacterial overgrowth and tropical sprue",
          size: "m",
          topics: [
            {
              id: "sgi-sibo-tropical-sprue",
              title: "Small intestinal bacterial overgrowth and tropical sprue",
              book: "Sleisenger & Fordtran 11e Ch. 108",
              mustKnow: [
                {
                  fact: "Small intestinal bacterial overgrowth (SIBO) gold standard diagnosis is quantitative duodenal/jejunal aspirate culture showing >= 10^3 colony-forming units (CFU)/mL of colonic-type bacterial species.",
                  terms: ["Small intestinal bacterial overgrowth", "colony-forming units"],
                  numbers: ["3"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Glucose and lactulose hydrogen breath tests diagnose SIBO when a rise of >= 20 parts per million (ppm) in exhaled hydrogen occurs within 90 minutes from baseline on gas chromatography.",
                  terms: ["hydrogen breath tests", "parts per million"],
                  numbers: ["20", "90"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Intestinal methanogen overgrowth (IMO) is mediated by Methanobrevibacter smithii converting hydrogen into methane, diagnosed by breath methane concentrations >= 10 ppm at any point, correlating strongly with constipation.",
                  terms: ["Intestinal methanogen overgrowth", "Methanobrevibacter smithii"],
                  numbers: ["10"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Rifaximin is a non-absorbed rifamycin-derived antibiotic that serves as first-line therapy for hydrogen-positive SIBO (550 mg three times daily for 14 days), with neomycin added for methane-positive IMO.",
                  terms: ["Rifaximin", "non-absorbed antibiotic"],
                  numbers: ["550", "3", "14"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Tropical sprue presents as an acquired malabsorptive illness in residents of or travellers to tropical regions, characterized by megaloblastic anaemia from concurrent folate and vitamin B12 deficiencies alongside blunted duodenal villi.",
                  terms: ["Tropical sprue", "megaloblastic anaemia"],
                  numbers: ["12"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Definitive management of tropical sprue requires a prolonged course of oral tetracycline (250 mg four times daily) or doxycycline for 3 to 6 months combined with high-dose oral folic acid (5 mg daily).",
                  terms: ["tetracycline", "folic acid"],
                  numbers: ["250", "4", "3", "6", "5"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Bacterial overgrowth provokes fat malabsorption through bacterial deconjugation of bile salts, rendering free bile acids insoluble at luminal pH and preventing micellar incorporation of dietary fatty acids.",
                  terms: ["deconjugation of bile salts", "fat malabsorption"],
                  source: "Sleisenger 11e Ch. 108"
                },
                {
                  fact: "Whipple disease is an uncommon systemic infection caused by Tropheryma whipplei, diagnosed by PAS-positive, diastase-resistant macrophage inclusions in small intestinal lamina propria and confirmed by PCR.",
                  terms: ["Whipple disease", "Tropheryma whipplei"],
                  source: "Sleisenger 11e Ch. 108"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-small-bowel-ischaemia-tumours",
          name: "Mesenteric ischaemia and small bowel neoplasms",
          size: "m",
          topics: [
            {
              id: "sgi-small-bowel-ischaemia-tumours",
              title: "Mesenteric ischaemia and small bowel neoplasms",
              book: "Sleisenger & Fordtran 11e Ch. 116, 117",
              mustKnow: [
                {
                  fact: "Acute mesenteric ischaemia (AMI) is most commonly caused by superior mesenteric artery (SMA) embolism (50%), presenting with severe periumbilical abdominal pain out of proportion to benign physical findings.",
                  terms: ["Acute mesenteric ischaemia", "pain out of proportion"],
                  numbers: ["50%"],
                  source: "Sleisenger 11e Ch. 116"
                },
                {
                  fact: "Contrast-enhanced biphasic CT angiography is the diagnostic modality of choice for acute mesenteric ischaemia, revealing SMA filling defects, bowel wall thinning, mesenteric stranding, and pneumatosis intestinalis.",
                  terms: ["CT angiography", "pneumatosis intestinalis"],
                  source: "Sleisenger 11e Ch. 116"
                },
                {
                  fact: "Non-occlusive mesenteric ischaemia (NOMI) results from profound splanchnic vasoconstriction in critical illness or cardiogenic shock, managed by restoring cardiac output, stopping vasopressors, and intra-arterial papaverine infusion.",
                  terms: ["Non-occlusive mesenteric ischaemia", "papaverine infusion"],
                  source: "Sleisenger 11e Ch. 116"
                },
                {
                  fact: "Chronic mesenteric ischaemia ('intestinal angina') features severe postprandial epigastric pain developing 30 minutes after meals ('food fear') and progressive weight loss due to atherosclerotic stenosis of at least 2 of the 3 major mesenteric vessels.",
                  terms: ["Chronic mesenteric ischaemia", "intestinal angina"],
                  numbers: ["30", "2", "3"],
                  source: "Sleisenger 11e Ch. 116"
                },
                {
                  fact: "Small bowel neuroendocrine tumours (NETs, formerly carcinoids) arise predominantly in the terminal ileum from enterochromaffin cells, frequently causing desmoplastic mesenteric retraction, bowel obstruction, and ischaemia.",
                  terms: ["neuroendocrine tumours", "desmoplastic mesenteric retraction"],
                  source: "Sleisenger 11e Ch. 117"
                },
                {
                  fact: "Carcinoid syndrome (flushing, watery secretory diarrhoea, bronchospasm, and tricuspid regurgitation) occurs exclusively when ileal NET metastases bypass hepatic first-pass metabolism via liver metastases or retroperitoneal shunting.",
                  terms: ["Carcinoid syndrome", "hepatic first-pass metabolism"],
                  source: "Sleisenger 11e Ch. 117"
                },
                {
                  fact: "Small bowel adenocarcinoma occurs predominantly in the duodenum (50%) and proximal jejunum, strongly associated with hereditary syndromes (Lynch, FAP, Peutz-Jeghers) and long-standing coeliac disease.",
                  terms: ["Small bowel adenocarcinoma", "Peutz-Jeghers"],
                  numbers: ["50%"],
                  source: "Sleisenger 11e Ch. 117"
                },
                {
                  fact: "Somatostatin receptor imaging using 68Ga-DOTATATE PET-CT exhibits sensitivity > 90% for detecting primary and metastatic well-differentiated neuroendocrine tumours expressing somatostatin receptor subtype 2 (SSTR2).",
                  terms: ["DOTATATE PET-CT", "somatostatin receptor"],
                  numbers: ["68", "90%", "2"],
                  source: "Sleisenger 11e Ch. 117"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-ibd",
      name: "Inflammatory bowel disease",
      modules: [
        {
          id: "sgi-ulcerative-colitis",
          name: "Ulcerative colitis",
          size: "l",
          topics: [
            {
              id: "sgi-ulcerative-colitis",
              title: "Ulcerative colitis",
              book: "Sleisenger & Fordtran 11e Ch. 115",
              mustKnow: [
                {
                  fact: "Ulcerative colitis is characterized by continuous, confluent mucosal inflammation starting in the rectum (proctitis) and extending proximally to involve varying lengths of the colon without skip lesions or transmural involvement.",
                  terms: ["Ulcerative colitis", "confluent mucosal inflammation"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Montreal classification categorizes UC disease extent into E1 (proctitis, limited to rectum), E2 (left-sided colitis, distal to splenic flexure), and E3 (extensive colitis, proximal to splenic flexure).",
                  terms: ["Montreal classification", "disease extent"],
                  numbers: ["1", "2", "3"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Truelove and Witts criteria define acute severe ulcerative colitis (ASUC) by >= 6 bloody stools daily plus at least one systemic sign: pulse > 90 bpm, temperature > 37.8 C, haemoglobin < 10.5 g/dL, or ESR > 30 mm/h.",
                  terms: ["Truelove and Witts", "acute severe ulcerative colitis"],
                  numbers: ["6", "90", "37.8", "10.5", "30"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Oxford criteria on day 3 of IV corticosteroid therapy predict 85% colectomy risk in ASUC if stool frequency > 8 per day, or stool frequency 3 to 8 per day accompanied by CRP > 45 mg/L.",
                  terms: ["Oxford criteria", "colectomy risk"],
                  numbers: ["3", "85%", "8", "45"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Rescue medical therapy for steroid-refractory ASUC comprises either infliximab (5 to 10 mg/kg) or intravenous ciclosporin (target trough level 150 to 250 ng/mL), demonstrating equivalent 90-day colectomy-free survival in the CYCLO trial.",
                  terms: ["infliximab", "ciclosporin"],
                  numbers: ["5", "10", "150", "250", "90"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Toxic megacolon is defined by total or segmental non-obstructive colonic dilatation > 6 cm on abdominal radiography alongside systemic toxicity, requiring emergent surgical consultation and decompressive therapy.",
                  terms: ["Toxic megacolon", "colonic dilatation"],
                  numbers: ["6"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Histopathologic hallmarks of ulcerative colitis include diffuse crypt architectural distortion, basal plasmacytosis, mucin depletion, and crypt abscesses confined to the mucosal and submucosal layers.",
                  terms: ["crypt architectural distortion", "basal plasmacytosis"],
                  source: "Sleisenger 11e Ch. 115"
                },
                {
                  fact: "Surveillance colonoscopy for colorectal cancer detection is initiated 8 years after symptom onset in extensive (E3) or left-sided (E2) colitis, but immediately upon diagnosis in patients with concomitant primary sclerosing cholangitis (PSC).",
                  terms: ["Surveillance colonoscopy", "primary sclerosing cholangitis"],
                  numbers: ["8", "3", "2"],
                  source: "Sleisenger 11e Ch. 115"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-crohn-disease",
          name: "Crohn disease",
          size: "l",
          topics: [
            {
              id: "sgi-crohn-disease",
              title: "Crohn disease",
              book: "Sleisenger & Fordtran 11e Ch. 114",
              mustKnow: [
                {
                  fact: "Crohn disease is characterized by transmural granulomatous inflammation capable of affecting any segment of the gastrointestinal tract from mouth to anus, typically featuring discontinuous 'skip lesions' and terminal ileal involvement (40% to 50%).",
                  terms: ["Crohn disease", "skip lesions"],
                  numbers: ["40%", "50%"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Montreal classification for Crohn disease classifies age at diagnosis (A1 < 17, A2 17-40, A3 > 40), location (L1 ileal, L2 colonic, L3 ileocolonic, L4 isolated upper disease), and behavior (B1 non-stricturing non-penetrating, B2 stricturing, B3 penetrating, p perianal modifier).",
                  terms: ["Montreal classification", "perianal modifier"],
                  numbers: ["1", "17", "2", "40", "3", "4"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Pathognomonic histopathological features of Crohn disease include non-caseating sarcoid-like granulomas (present in 40% to 60% of resected specimens), transmural lymphoid aggregates, fissuring ulcers, and submucosal architectural thickening.",
                  terms: ["non-caseating granulomas", "fissuring ulcers"],
                  numbers: ["40%", "60%"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Perianal Crohn disease encompasses fistulae, perianal abscesses, and complex tracts; pelvic MRI is the gold standard imaging modality, requiring non-cutting seton placement and combined biologic therapy with anti-TNF agents.",
                  terms: ["Perianal Crohn disease", "pelvic MRI"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Stricturing Crohn disease (B2 phenotype) presents with subacute intestinal obstruction, where non-inflamed fibrotic strictures <= 5 cm without acute angulation can be successfully managed by endoscopic balloon dilatation.",
                  terms: ["Stricturing Crohn disease", "endoscopic balloon dilatation"],
                  numbers: ["2", "5"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Creeping fat ('fat wrapping') is a hallmark macroscopic surgical finding in Crohn disease, characterized by hypertrophy and translocation of mesenteric adipose tissue encircling more than 50% of the intestinal circumference.",
                  terms: ["Creeping fat", "fat wrapping"],
                  numbers: ["50%"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Postoperative recurrence of Crohn disease is evaluated at 6 months after ileocolonic resection using the Rutgeerts endoscopic score; a score >= i2 (more than 5 aphthous lesions or larger confluent ulcers) mandates step-up biologic therapy.",
                  terms: ["Rutgeerts score", "Postoperative recurrence"],
                  numbers: ["6", "2", "5"],
                  source: "Sleisenger 11e Ch. 114"
                },
                {
                  fact: "Extraintestinal manifestations of IBD that parallel intestinal disease activity include peripheral arthritis (type 1 pauciarticular), erythema nodosum, episcleritis, and aphthous stomatitis.",
                  terms: ["Extraintestinal manifestations", "erythema nodosum"],
                  numbers: ["1"],
                  source: "Sleisenger 11e Ch. 114"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-ibd-therapeutics",
          name: "Therapeutics and monitoring in inflammatory bowel disease",
          size: "m",
          topics: [
            {
              id: "sgi-ibd-therapeutics",
              title: "Therapeutics and monitoring in inflammatory bowel disease",
              book: "Sleisenger & Fordtran 11e Ch. 113, 114, 115",
              mustKnow: [
                {
                  fact: "Anti-TNF monoclonal antibodies (infliximab, adalimumab) represent cornerstone biologic therapies for moderate-to-severe IBD; combination therapy with thiopurines (azathioprine) significantly cuts anti-drug antibody formation and improves mucosal healing.",
                  terms: ["Anti-TNF antibodies", "azathioprine"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "Vedolizumab is a gut-selective anti-integrin monoclonal antibody that selectively binds alpha-4-beta-7 integrin on circulating memory T lymphocytes, preventing adhesion to mucosal addressin cellular adhesion molecule-1 (MAdCAM-1).",
                  terms: ["Vedolizumab", "alpha-4-beta-7 integrin"],
                  numbers: ["4", "7", "1"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "Ustekinumab is a fully human IgG1-kappa monoclonal antibody that binds the shared p40 subunit of interleukin-12 (IL-12) and interleukin-23 (IL-23), preventing interaction with the IL-12R-beta-1 receptor chain.",
                  terms: ["Ustekinumab", "p40 subunit"],
                  numbers: ["1", "40", "12", "23"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "Selective IL-23 p19 inhibitors (risankizumab for Crohn disease, mirikizumab and guselkumab for ulcerative colitis) provide high rates of clinical and endoscopic remission with favorable infection profiles.",
                  terms: ["risankizumab", "mirikizumab"],
                  numbers: ["23", "19"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "Janus kinase (JAK) inhibitors (tofacitinib pan-JAK, upadacitinib selective JAK1) are oral small molecules approved for moderate-to-severe active ulcerative colitis, providing rapid symptom control within 1 to 3 days.",
                  terms: ["tofacitinib", "upadacitinib"],
                  numbers: ["1", "3"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "Thiopurine methyltransferase (TPMT) and NUDT15 genotype testing prior to initiating azathioprine or 6-mercaptopurine prevents life-threatening severe myelosuppression from toxic 6-thioguanine nucleotide (6-TGN) accumulation.",
                  terms: ["TPMT genotype", "NUDT15"],
                  numbers: ["15", "6"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "Therapeutic drug monitoring (TDM) measures biologic trough levels and anti-drug antibodies, guiding dose escalation in secondary loss of response when trough concentrations are subtherapeutic (infliximab target > 5 ug/mL, adalimumab > 7.5 ug/mL).",
                  terms: ["Therapeutic drug monitoring", "anti-drug antibodies"],
                  numbers: ["5", "7.5"],
                  source: "Sleisenger 11e Ch. 113"
                },
                {
                  fact: "STRIDE-II consensus establishes 'treat-to-target' endpoints in IBD: immediate clinical symptom relief, intermediate normalization of biomarkers (fecal calprotectin < 150 to 250 ug/g and CRP < 5 mg/L), and long-term endoscopic mucosal healing.",
                  terms: ["STRIDE-II", "fecal calprotectin"],
                  numbers: ["2", "150", "250", "5"],
                  source: "Sleisenger 11e Ch. 113 / STRIDE-II"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-intestinal-tuberculosis",
          name: "Intestinal tuberculosis and differentiation from Crohn disease",
          size: "s",
          topics: [
            {
              id: "sgi-intestinal-tuberculosis",
              title: "Intestinal tuberculosis and differentiation from Crohn disease",
              book: "Sleisenger & Fordtran 11e Ch. 110",
              mustKnow: [
                {
                  fact: "Intestinal tuberculosis (ITB) affects the ileocecal region in > 70% of cases, presenting with mucosal ulcerations, strictures, or inflammatory pseudotumours resulting from Mycobacterium tuberculosis ingestion or hematogenous dissemination.",
                  terms: ["Intestinal tuberculosis", "ileocecal region"],
                  numbers: ["70%"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "Endoscopic differentiation reveals that intestinal TB characteristically features transverse circular ulcers oriented perpendicular to the long bowel axis with patulous ileocecal valve, whereas Crohn disease features longitudinal linear ulcers and cobblestoning.",
                  terms: ["transverse circular ulcers", "patulous ileocecal valve"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "Histopathologic hallmarks distinguishing intestinal TB from Crohn disease are large confluent (> 400 micrometres) caseating granulomas, multiple granulomas per biopsy (> 5), and granulomas located in the lamina propria or submucosa.",
                  terms: ["caseating granulomas", "large confluent"],
                  numbers: ["400", "5"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "Acid-fast bacilli (AFB) on Ziehl-Neelsen staining or positive GeneXpert MTB/RIF assay on mucosal biopsies provides rapid microbiological confirmation of intestinal tuberculosis.",
                  terms: ["GeneXpert MTB/RIF", "Ziehl-Neelsen staining"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "CT enterography in intestinal TB typically demonstrates necrotic mesenteric lymph nodes with peripheral rim enhancement and central hypoattenuation, a radiological finding rarely seen in Crohn disease.",
                  terms: ["necrotic mesenteric lymph nodes", "peripheral rim enhancement"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "A therapeutic trial of antitubercular therapy (ATT) is indicated in diagnostic ambiguity; mucosal healing on repeat colonoscopy at 8 to 12 weeks confirms the diagnosis of intestinal tuberculosis and excludes Crohn disease.",
                  terms: ["antitubercular therapy", "therapeutic trial"],
                  numbers: ["8", "12"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "Standard curative medical management of intestinal tuberculosis requires a 6-month regimen of antitubercular therapy comprising 2 months of HRZE followed by 4 months of HR.",
                  terms: ["antitubercular therapy regimen", "HRZE"],
                  numbers: ["6", "2", "4"],
                  source: "Sleisenger 11e Ch. 110"
                },
                {
                  fact: "Misdiagnosing intestinal tuberculosis as Crohn disease and inadvertently administering anti-TNF or immunosuppressive therapy can provoke catastrophic disseminated tuberculosis, bowel perforation, and septic death.",
                  terms: ["disseminated tuberculosis", "immunosuppressive therapy"],
                  source: "Sleisenger 11e Ch. 110"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-colon-rectum",
      name: "Colon and rectum",
      modules: [
        {
          id: "sgi-colorectal-neoplasia",
          name: "Colorectal polyps, hereditary syndromes and screening",
          size: "l",
          topics: [
            {
              id: "sgi-colorectal-neoplasia",
              title: "Colorectal polyps, hereditary syndromes and screening",
              book: "Sleisenger & Fordtran 11e Ch. 126, 127",
              mustKnow: [
                {
                  fact: "Adenoma detection rate (ADR) is the primary quality benchmark in screening colonoscopy, with minimum established targets of >= 25% overall (>= 30% in men, >= 20% in women), where every 1% increase in ADR cuts interval colorectal cancer risk by 3%.",
                  terms: ["Adenoma detection rate", "quality benchmark"],
                  numbers: ["25%", "30%", "20%", "1%", "3%"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Sessile serrated lesions (SSLs) arise via the serrated pathway characterized by BRAF V600E mutations and CpG island methylator phenotype (CIMP-high), displaying dilated 'boot-shaped' crypt bases on histology.",
                  terms: ["Sessile serrated lesions", "BRAF V600E"],
                  numbers: ["600"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Familial adenomatous polyposis (FAP) is an autosomal dominant condition caused by germline mutations in the APC tumor suppressor gene, resulting in hundreds to thousands of adenomatous polyps and 100% colorectal cancer penetrance by age 40.",
                  terms: ["Familial adenomatous polyposis", "APC gene"],
                  numbers: ["100%", "40"],
                  source: "Sleisenger 11e Ch. 127"
                },
                {
                  fact: "Lynch syndrome (hereditary non-polyposis colorectal cancer) is caused by germline mutations in DNA mismatch repair (MMR) genes (MLH1, MSH2, MSH6, PMS2) or EPCAM deletion, displaying microsatellite instability-high (MSI-H).",
                  terms: ["Lynch syndrome", "mismatch repair"],
                  numbers: ["1", "2", "6"],
                  source: "Sleisenger 11e Ch. 127"
                },
                {
                  fact: "Amsterdam II criteria for Lynch syndrome require at least 3 relatives with Lynch-associated cancers, one being a first-degree relative of the other two, spanning at least 2 successive generations, with at least 1 diagnosed before age 50.",
                  terms: ["Amsterdam II criteria", "Lynch syndrome"],
                  numbers: ["2", "3", "1", "50"],
                  source: "Sleisenger 11e Ch. 127"
                },
                {
                  fact: "Peutz-Jeghers syndrome is an autosomal dominant hamartomatous polyposis caused by STK11/LKB1 mutations, featuring mucocutaneous melanin pigmentation of lips/buccal mucosa and hamartomatous polyps with branching smooth muscle tree.",
                  terms: ["Peutz-Jeghers syndrome", "STK11 mutations"],
                  numbers: ["11", "1"],
                  source: "Sleisenger 11e Ch. 127"
                },
                {
                  fact: "Post-polypectomy surveillance guidelines mandate repeat colonoscopy in 3 years for patients with >= 3 non-advanced adenomas, adenomas >= 10 mm, adenomas with tubulovillous/villous histology, or high-grade dysplasia.",
                  terms: ["Post-polypectomy surveillance", "tubulovillous histology"],
                  numbers: ["3", "10"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Immune checkpoint inhibitors (pembrolizumab, dostarlimab) produce durable objective tumor responses in MSI-H / deficient MMR metastatic colorectal cancer, achieving FDA approval as first-line therapy.",
                  terms: ["dostarlimab", "pembrolizumab"],
                  source: "Sleisenger 11e Ch. 127"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-ibs-constipation",
          name: "Irritable bowel syndrome and chronic constipation",
          size: "m",
          topics: [
            {
              id: "sgi-ibs-constipation",
              title: "Irritable bowel syndrome and chronic constipation",
              book: "Sleisenger & Fordtran 11e Ch. 119, 120",
              mustKnow: [
                {
                  fact: "Rome IV criteria define irritable bowel syndrome (IBS) as recurrent abdominal pain on average at least 1 day per week in the last 3 months, associated with >= 2 features: related to defecation, change in stool frequency, or change in stool form.",
                  terms: ["Rome IV criteria", "recurrent abdominal pain"],
                  numbers: ["4", "1", "3", "2"],
                  source: "Sleisenger 11e Ch. 119"
                },
                {
                  fact: "Bristol Stool Form Scale categorizes stool consistency from Type 1 (separate hard lumps, severe constipation) to Type 7 (watery without solid pieces, severe diarrhoea), dictating subtype classification into IBS-C, IBS-D, IBS-M, or IBS-U.",
                  terms: ["Bristol Stool Form Scale", "IBS subtypes"],
                  numbers: ["1", "7"],
                  source: "Sleisenger 11e Ch. 119"
                },
                {
                  fact: "Linaclotide and plecanatide are guanylate cyclase-C (GC-C) agonists that stimulate intracellular cyclic GMP, activating the CFTR channel to increase intestinal fluid secretion and accelerate colonic transit in IBS-C.",
                  terms: ["Linaclotide", "guanylate cyclase-C agonists"],
                  source: "Sleisenger 11e Ch. 120"
                },
                {
                  fact: "Lubiprostone is an oral bicyclic fatty acid that selectively activates type-2 chloride channels (ClC-2) on intestinal apical enterocytes, increasing intraluminal chloride and fluid secretion without altering electrolyte balance.",
                  terms: ["Lubiprostone", "chloride channels"],
                  numbers: ["2"],
                  source: "Sleisenger 11e Ch. 120"
                },
                {
                  fact: "Prucalopride is a high-affinity, highly selective 5-HT4 receptor agonist that stimulates colonic high-amplitude propagating contractions (HAPCs), providing effective prokinetic therapy in chronic idiopathic constipation.",
                  terms: ["Prucalopride", "5-HT4 receptor agonist"],
                  numbers: ["5", "4"],
                  source: "Sleisenger 11e Ch. 120"
                },
                {
                  fact: "Eluxadoline is a locally acting mixed mu- and kappa-opioid receptor agonist and delta-opioid receptor antagonist approved for IBS-D, but strictly contraindicated in patients without a gallbladder due to risk of sphincter of Oddi spasm.",
                  terms: ["Eluxadoline", "sphincter of Oddi spasm"],
                  source: "Sleisenger 11e Ch. 119"
                },
                {
                  fact: "Dyssynergic defecation (pelvic floor dyssynergia) is diagnosed by high-resolution anorectal manometry and failed balloon expulsion test (inability to expel a 50 mL water-filled balloon within 1 minute), treated with pelvic floor biofeedback therapy.",
                  terms: ["Dyssynergic defecation", "balloon expulsion test"],
                  numbers: ["50", "1"],
                  source: "Sleisenger 11e Ch. 120"
                },
                {
                  fact: "Low-FODMAP diet restricts fermentable oligosaccharides, disaccharides, monosaccharides, and polyols, reducing gas production and luminal distension to provide symptom relief in up to 70% of IBS patients.",
                  terms: ["Low-FODMAP diet", "fermentable oligosaccharides"],
                  numbers: ["70%"],
                  source: "Sleisenger 11e Ch. 119"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-infectious-diarrhoea-cdi",
          name: "Infectious diarrhoea and Clostridioides difficile",
          size: "m",
          topics: [
            {
              id: "sgi-infectious-diarrhoea-cdi",
              title: "Infectious diarrhoea and Clostridioides difficile",
              book: "Sleisenger & Fordtran 11e Ch. 109, 111",
              mustKnow: [
                {
                  fact: "Clostridioides difficile infection (CDI) is diagnosed by diarrhoea (>= 3 unformed stools in 24 hours) accompanied by positive stool toxin testing (EIA for toxins A/B or two-step algorithm combining GDH with toxin EIA/NAAT).",
                  terms: ["Clostridioides difficile", "toxin testing"],
                  numbers: ["3", "24"],
                  source: "Sleisenger 11e Ch. 111 / IDSA Guidelines"
                },
                {
                  fact: "Oral fidaxomicin (200 mg twice daily for 10 days) is the preferred first-line bactericidal treatment for initial and recurrent CDI, associated with significantly lower recurrence rates compared to oral vancomycin.",
                  terms: ["fidaxomicin", "oral vancomycin"],
                  numbers: ["200", "2", "10"],
                  source: "Sleisenger 11e Ch. 111"
                },
                {
                  fact: "Fulminant CDI is defined by hypotension, shock, ileus, or toxic megacolon, treated urgently with high-dose oral vancomycin (500 mg four times daily) via NG tube, rectal vancomycin enemas, and intravenous metronidazole.",
                  terms: ["Fulminant CDI", "toxic megacolon"],
                  numbers: ["500", "4"],
                  source: "Sleisenger 11e Ch. 111"
                },
                {
                  fact: "Fecal microbiota transplantation (FMT) or oral fecal microbiota products (fecal microbiota spores) achieve > 80% cure rates in patients with multiply recurrent C. difficile infection refractory to pulsed antibiotic regimens.",
                  terms: ["Fecal microbiota transplantation", "recurrent CDI"],
                  numbers: ["80%"],
                  source: "Sleisenger 11e Ch. 111"
                },
                {
                  fact: "Bezlotoxumab is a fully human IgG1 monoclonal antibody that binds and neutralizes C. difficile toxin B, approved as adjunctive therapy to prevent recurrent CDI in high-risk patients.",
                  terms: ["Bezlotoxumab", "toxin B"],
                  numbers: ["1"],
                  source: "Sleisenger 11e Ch. 111"
                },
                {
                  fact: "Amoebic colitis caused by Entamoeba histolytica characteristically produces discrete 'flask-shaped' mucosal ulcerations with intervening normal mucosa, diagnosed by stool antigen or multiplex PCR, treated with metronidazole followed by paromomycin.",
                  terms: ["Amoebic colitis", "flask-shaped ulcerations"],
                  source: "Sleisenger 11e Ch. 109"
                },
                {
                  fact: "Cholera caused by Vibrio cholerae produces massive secretory 'rice-water' diarrhoea driven by cholera toxin ADP-ribosylation of G-alpha-s, managed with aggressive isotonic rehydration and single-dose azithromycin or doxycycline.",
                  terms: ["Cholera", "rice-water diarrhoea"],
                  source: "Sleisenger 11e Ch. 109"
                },
                {
                  fact: "Shiga toxin-producing E. coli (STEC/EHEC O157:H7) causes bloody diarrhoea where antibiotic therapy is strictly avoided due to increased release of Shiga toxins provoking hemolytic uremic syndrome (HUS).",
                  terms: ["Shiga toxin-producing E. coli", "hemolytic uremic syndrome"],
                  numbers: ["157", "7"],
                  source: "Sleisenger 11e Ch. 109"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-microscopic-colitis-anorectal",
          name: "Microscopic colitis and anorectal disorders",
          size: "s",
          topics: [
            {
              id: "sgi-microscopic-colitis-anorectal",
              title: "Microscopic colitis and anorectal disorders",
              book: "Sleisenger & Fordtran 11e Ch. 112, 128",
              mustKnow: [
                {
                  fact: "Microscopic colitis presents with chronic watery non-bloody diarrhoea with normal endoscopic appearance, subclassified into collagenous colitis (thickened subepithelial collagen band >= 10 micrometres) and lymphocytic colitis (>= 20 intraepithelial lymphocytes per 100 enterocytes).",
                  terms: ["Microscopic colitis", "collagen band"],
                  numbers: ["10", "20", "100"],
                  source: "Sleisenger 11e Ch. 112"
                },
                {
                  fact: "Oral budesonide (9 mg daily for 8 weeks) is the definitive first-line medical therapy for active microscopic colitis, providing rapid clinical remission in > 80% of patients with low systemic glucocorticoid bioavailability.",
                  terms: ["Oral budesonide", "clinical remission"],
                  numbers: ["9", "8", "80%"],
                  source: "Sleisenger 11e Ch. 112"
                },
                {
                  fact: "Acute colonic pseudo-obstruction (Ogilvie syndrome) is characterized by massive non-obstructive cecal dilatation; intravenous neostigmine (2 mg over 5 minutes with cardiac monitoring) is indicated when cecal diameter exceeds 12 cm.",
                  terms: ["Ogilvie syndrome", "neostigmine"],
                  numbers: ["2", "5", "12"],
                  source: "Sleisenger 11e Ch. 121"
                },
                {
                  fact: "Solitary rectal ulcer syndrome (SRUS) is a disorder of defecation associated with pelvic floor dyssynergia, diagnosed histologically by dense fibromuscular obliteration of the lamina propria with splayed smooth muscle fibres.",
                  terms: ["Solitary rectal ulcer syndrome", "fibromuscular obliteration"],
                  source: "Sleisenger 11e Ch. 128"
                },
                {
                  fact: "Internal hemorrhoids are graded by prolapse severity: Grade I (no prolapse), Grade II (prolapse with spontaneous reduction), Grade III (prolapse requiring manual reduction), and Grade IV (irreducible permanently prolapsed tissue).",
                  terms: ["Internal hemorrhoids", "prolapse severity"],
                  numbers: ["1", "2", "3", "4"],
                  source: "Sleisenger 11e Ch. 128"
                },
                {
                  fact: "Chronic anal fissures occur predominantly in the posterior midline (90%); lateral fissures should raise clinical suspicion for secondary etiologies including Crohn disease, tuberculosis, syphilis, or anal carcinoma.",
                  terms: ["Chronic anal fissures", "posterior midline"],
                  numbers: ["90%"],
                  source: "Sleisenger 11e Ch. 128"
                },
                {
                  fact: "Radiation proctopathy presents with painless rectal bleeding following pelvic radiotherapy, displaying telangiectatic neovascularization on endoscopy, managed with argon plasma coagulation (APC) or topical formalin application.",
                  terms: ["Radiation proctopathy", "argon plasma coagulation"],
                  source: "Sleisenger 11e Ch. 128"
                },
                {
                  fact: "Goodsall rule predicts anal fistula tract trajectories: fistulae with an external opening anterior to a transverse anal line track radially straight into the canal, whereas openings posterior to the line follow a curved path to the posterior midline.",
                  terms: ["Goodsall rule", "anal fistula"],
                  source: "Sleisenger 11e Ch. 128"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-pancreas-biliary",
      name: "Pancreas and biliary tract",
      modules: [
        {
          id: "sgi-acute-pancreatitis",
          name: "Acute pancreatitis",
          size: "l",
          topics: [
            {
              id: "sgi-acute-pancreatitis",
              title: "Acute pancreatitis",
              book: "Sleisenger & Fordtran 11e Ch. 58",
              mustKnow: [
                {
                  fact: "Revised Atlanta classification defines acute pancreatitis by >= 2 of 3 criteria: characteristic epigastric abdominal pain, serum amylase or lipase >= 3 times upper limit of normal, and characteristic cross-sectional imaging findings.",
                  terms: ["Revised Atlanta classification", "serum lipase"],
                  numbers: ["2", "3"],
                  source: "Sleisenger 11e Ch. 58"
                },
                {
                  fact: "Severity is stratified by revised Atlanta into Mild (no organ failure or local/systemic complications), Moderately severe (transient organ failure resolving within 48 hours or local complications), and Severe (persistent organ failure > 48 hours).",
                  terms: ["persistent organ failure", "Moderately severe"],
                  numbers: ["48"],
                  source: "Sleisenger 11e Ch. 58"
                },
                {
                  fact: "Modified Marshall scoring system evaluates organ failure in acute pancreatitis across 3 organ systems: respiratory (PaO2/FiO2 ratio), renal (serum creatinine), and cardiovascular (systolic blood pressure and inotropic requirement).",
                  terms: ["Modified Marshall scoring", "organ failure"],
                  numbers: ["3"],
                  source: "Sleisenger 11e Ch. 58"
                },
                {
                  fact: "WATERFALL randomised controlled trial demonstrated that aggressive fluid resuscitation in acute pancreatitis increases fluid overload and heart failure without improving clinical recovery, supporting moderate goal-directed fluid therapy.",
                  terms: ["WATERFALL trial", "fluid overload"],
                  source: "Sleisenger 11e Ch. 58 / WATERFALL"
                },
                {
                  fact: "Early oral refeeding with a low-fat solid diet or enteral tube feeding is superior to parenteral nutrition and fasting, preserving gut mucosal barrier integrity and significantly reducing infectious complications.",
                  terms: ["Early oral refeeding", "enteral nutrition"],
                  source: "Sleisenger 11e Ch. 58"
                },
                {
                  fact: "The step-up approach (PANTER trial) for infected pancreatic necrosis begins with percutaneous or endoscopic catheter drainage, escalating to minimally invasive retroperitoneal necrosectomy only if clinical improvement fails to occur.",
                  terms: ["step-up approach", "infected pancreatic necrosis"],
                  source: "Sleisenger 11e Ch. 58 / PANTER"
                },
                {
                  fact: "Walled-off necrosis (WON) consists of a mature, encapsulated collection of pancreatic and peripancreatic necrosis with a well-defined inflammatory wall, developing >= 4 weeks after the onset of necrotizing pancreatitis.",
                  terms: ["Walled-off necrosis", "inflammatory wall"],
                  numbers: ["4"],
                  source: "Sleisenger 11e Ch. 58"
                },
                {
                  fact: "Prophylactic rectal indomethacin or diclofenac suppositories (100 mg administered immediately before or after the procedure) cut the incidence of post-ERCP pancreatitis by over 50%.",
                  terms: ["rectal indomethacin", "post-ERCP pancreatitis"],
                  numbers: ["100", "50%"],
                  source: "Sleisenger 11e Ch. 58"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-chronic-pancreatitis",
          name: "Chronic pancreatitis",
          size: "m",
          topics: [
            {
              id: "sgi-chronic-pancreatitis",
              title: "Chronic pancreatitis",
              book: "Sleisenger & Fordtran 11e Ch. 59",
              mustKnow: [
                {
                  fact: "Chronic pancreatitis is characterized by progressive irreversible inflammatory fibro-inflammatory injury of the pancreatic parenchyma, ductal stricturing, stone formation, and eventual loss of exocrine and endocrine functions.",
                  terms: ["Chronic pancreatitis", "fibro-inflammatory injury"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Genetic mutations in PRSS1 (cationic trypsinogen, gain of function causing hereditary pancreatitis), SPINK1 (pancreatic secretory trypsin inhibitor), and CFTR (cystic fibrosis transmembrane conductance regulator) drive genetic susceptibility.",
                  terms: ["PRSS1", "SPINK1 mutations"],
                  numbers: ["1"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Fecal elastase-1 testing is the premier non-invasive test of pancreatic exocrine insufficiency, where a fecal elastase concentration < 200 ug/g indicates exocrine deficiency (< 100 ug/g indicates severe insufficiency).",
                  terms: ["Fecal elastase-1", "pancreatic exocrine insufficiency"],
                  numbers: ["1", "200", "100"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Pancreatic enzyme replacement therapy (PERT) delivers enteric-coated pancrelipase containing >= 40,000 to 50,000 USP units of lipase per meal taken with food, abolishing steatorrhoea and restoring fat-soluble vitamin absorption.",
                  terms: ["Pancreatic enzyme replacement", "lipase per meal"],
                  numbers: ["40000", "50000"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Type 3c diabetes mellitus (pancreatogenic diabetes) results from destruction of both beta cells (insulin) and alpha cells (glucagon), creating brittle glycemic control with high susceptibility to severe hypoglycaemia.",
                  terms: ["Type 3c diabetes", "pancreatogenic diabetes"],
                  numbers: ["3"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Extracorporeal shock wave lithotripsy (ESWL) fragments large radio-opaque pancreatic duct stones (> 5 mm) in the main pancreatic duct prior to ERCP basket extraction and ductal stent placement.",
                  terms: ["Extracorporeal shock wave lithotripsy", "pancreatic duct stones"],
                  numbers: ["5"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Surgical drainage and resection procedures for chronic pancreatitis include the Frey procedure (local resection of the pancreatic head with longitudinal pancreaticojejunostomy) and the Beger procedure (duodenum-preserving pancreatic head resection).",
                  terms: ["Frey procedure", "pancreaticojejunostomy"],
                  source: "Sleisenger 11e Ch. 59"
                },
                {
                  fact: "Type 1 autoimmune pancreatitis (AIP) is a systemic IgG4-related fibro-inflammatory disease featuring diffuse 'sausage-like' pancreatic enlargement, elevated serum IgG4, and dramatic response to corticosteroid therapy.",
                  terms: ["autoimmune pancreatitis", "sausage-like enlargement"],
                  numbers: ["1", "4"],
                  source: "Sleisenger 11e Ch. 60"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-pancreatic-neoplasms",
          name: "Pancreatic cancer and cystic neoplasms",
          size: "m",
          topics: [
            {
              id: "sgi-pancreatic-neoplasms",
              title: "Pancreatic cancer and cystic neoplasms",
              book: "Sleisenger & Fordtran 11e Ch. 61, 62",
              mustKnow: [
                {
                  fact: "Pancreatic ductal adenocarcinoma (PDAC) accounts for > 90% of pancreatic malignancies, driven by activating KRAS mutations (> 90%) alongside inactivating mutations in CDKN2A/p16, TP53, and SMAD4/DPC4.",
                  terms: ["Pancreatic ductal adenocarcinoma", "KRAS mutations"],
                  numbers: ["90%", "16", "53", "4"],
                  source: "Sleisenger 11e Ch. 61"
                },
                {
                  fact: "CA 19-9 is the primary serum biomarker for PDAC diagnosis and post-resection monitoring, but is falsely negative in individuals lacking the Lewis blood group antigen enzyme (fucosyltransferase FUT3, 5% to 10% of population).",
                  terms: ["CA 19-9", "Lewis blood group"],
                  numbers: ["19", "9", "3", "5%", "10%"],
                  source: "Sleisenger 11e Ch. 61"
                },
                {
                  fact: "Intraductal papillary mucinous neoplasms (IPMN) communicate directly with the pancreatic ductal system; Fukuoka guidelines classify 'high-risk stigmata' mandating surgery as obstructive jaundice, enhancing mural nodule >= 5 mm, or MPD diameter >= 10 mm.",
                  terms: ["IPMN", "Fukuoka guidelines"],
                  numbers: ["5", "10"],
                  source: "Sleisenger 11e Ch. 62"
                },
                {
                  fact: "Mucinous cystic neoplasms (MCN) occur almost exclusively in perimenopausal women in the pancreatic body or tail, characterized by thick mucinous fluid with high CEA (> 192 ng/mL) and pathognomonic ovarian-type stroma on histology.",
                  terms: ["Mucinous cystic neoplasms", "ovarian-type stroma"],
                  numbers: ["192"],
                  source: "Sleisenger 11e Ch. 62"
                },
                {
                  fact: "Serous cystadenomas (SCA) are benign neoplasms with microcystic 'honeycomb' morphology and central stellate scar containing clear, thin fluid with low CEA (< 5 ng/mL) and glycogen-rich cuboidal epithelium.",
                  terms: ["Serous cystadenomas", "honeycomb morphology"],
                  numbers: ["5"],
                  source: "Sleisenger 11e Ch. 62"
                },
                {
                  fact: "Solid pseudopapillary neoplasm (SPN) is an indolent, well-circumscribed mixed solid and cystic tumor occurring in young females, driven by CTNNB1 (beta-catenin) mutations and curable with complete surgical resection.",
                  terms: ["Solid pseudopapillary neoplasm", "beta-catenin"],
                  numbers: ["1"],
                  source: "Sleisenger 11e Ch. 62"
                },
                {
                  fact: "Pancreatic neuroendocrine tumours (pNETs) with germline or somatic BRCA1/2 mutations exhibit synthetic lethality and clinical responsiveness to maintenance PARP inhibitor olaparib (POLO trial).",
                  terms: ["olaparib", "POLO trial"],
                  numbers: ["1", "2"],
                  source: "Sleisenger 11e Ch. 61"
                },
                {
                  fact: "Insulinoma is the most common functioning pNET, presenting with Whipple triad (hypoglycaemic symptoms, documented plasma glucose < 55 mg/dL, and symptom relief upon glucose administration), diagnosed via 72-hour fast.",
                  terms: ["Insulinoma", "Whipple triad"],
                  numbers: ["55", "72"],
                  source: "Sleisenger 11e Ch. 63"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-biliary-disease",
          name: "Gallstones and biliary disorders",
          size: "m",
          topics: [
            {
              id: "sgi-biliary-disease",
              title: "Gallstones and biliary disorders",
              book: "Sleisenger & Fordtran 11e Ch. 67, 68",
              mustKnow: [
                {
                  fact: "Tokyo Guidelines (TG18) diagnose acute cholangitis by systemic inflammation (fever/leukocytosis), cholestasis (jaundice/abnormal LFTs), and imaging proof of biliary dilatation or obstruction.",
                  terms: ["Tokyo Guidelines", "acute cholangitis"],
                  numbers: ["18"],
                  source: "Sleisenger 11e Ch. 68 / TG18"
                },
                {
                  fact: "Charcot triad (fever, jaundice, right upper quadrant pain) and Reynolds pentad (addition of hypotension and altered mental status) define acute suppurative ascending cholangitis requiring emergency biliary decompression.",
                  terms: ["Charcot triad", "Reynolds pentad"],
                  source: "Sleisenger 11e Ch. 68"
                },
                {
                  fact: "ASGE guidelines stratify choledocholithiasis risk: 'very high risk' criteria (CBD stone on US, ascending cholangitis, or bilirubin > 4 mg/dL with dilated CBD) mandate direct therapeutic ERCP without intermediate imaging.",
                  terms: ["ASGE guidelines", "choledocholithiasis risk"],
                  numbers: ["4"],
                  source: "Sleisenger 11e Ch. 67"
                },
                {
                  fact: "Endoscopic ultrasound (EUS) and magnetic resonance cholangiopancreatography (MRCP) possess equivalent high sensitivities (> 95%) for detecting choledocholithiasis in intermediate-risk patients.",
                  terms: ["Endoscopic ultrasound", "MRCP"],
                  numbers: ["95%"],
                  source: "Sleisenger 11e Ch. 67"
                },
                {
                  fact: "Mirizzi syndrome represents extrinsic compression of the common hepatic duct caused by a gallstone impacted in the cystic duct or gallbladder neck, predisposing to cholecystobiliary fistula formation.",
                  terms: ["Mirizzi syndrome", "cholecystobiliary fistula"],
                  source: "Sleisenger 11e Ch. 67"
                },
                {
                  fact: "Gallstone pancreatitis warrants index admission cholecystectomy prior to hospital discharge once mild pancreatitis has resolved, preventing recurrent pancreatitis and biliary complications.",
                  terms: ["Gallstone pancreatitis", "index admission cholecystectomy"],
                  source: "Sleisenger 11e Ch. 67"
                },
                {
                  fact: "Porcelain gallbladder (extensive intramural calcification of the gallbladder wall) carries an elevated risk of gallbladder adenocarcinoma, serving as an indication for prophylactic cholecystectomy.",
                  terms: ["Porcelain gallbladder", "gallbladder adenocarcinoma"],
                  source: "Sleisenger 11e Ch. 67"
                },
                {
                  fact: "Primary sclerosing cholangitis (PSC) is a chronic cholestatic biliary disorder characterised by multifocal fibrosing strictures and beaded intra- and extrahepatic bile ducts on MRCP, associated with IBD in over 70% of cases.",
                  terms: ["Primary sclerosing cholangitis", "beaded bile ducts"],
                  numbers: ["70%"],
                  source: "Sleisenger 11e Ch. 69"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sgi-procedures-nutrition",
      name: "Endoscopy, nutrition and GI physiology",
      modules: [
        {
          id: "sgi-endoscopy-procedures",
          name: "Diagnostic and therapeutic endoscopy",
          size: "m",
          topics: [
            {
              id: "sgi-endoscopy-procedures",
              title: "Diagnostic and therapeutic endoscopy",
              book: "Sleisenger & Fordtran 11e Ch. 41, 47, 126",
              mustKnow: [
                {
                  fact: "Boston Bowel Preparation Scale (BBPS) assesses mucosal visualization across 3 colon segments (right, transverse, left) on a scale of 0 to 3 each, where a total score >= 6 with no individual segment < 2 indicates adequate preparation.",
                  terms: ["Boston Bowel Preparation Scale", "adequate preparation"],
                  numbers: ["3", "0", "6", "2"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Endoscopic mucosal resection (EMR) utilizes submucosal injection to lift mucosal lesions above the muscularis propria, allowing snare excision of non-invasive polyps while minimizing perforation risks.",
                  terms: ["Endoscopic mucosal resection", "submucosal injection"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Endoscopic submucosal dissection (ESD) employs specialized electrosurgical knives to dissect through the submucosal plane, enabling en bloc curative resection of large (> 20 mm) or fibrotic neoplastic lesions regardless of size.",
                  terms: ["Endoscopic submucosal dissection", "en bloc resection"],
                  numbers: ["20"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Major ERCP procedural complications comprise acute pancreatitis (3% to 10%), hemorrhage, duodenal perforation (Stapfer classification Types I to IV), and ascending bacterial cholangitis.",
                  terms: ["ERCP complications", "Stapfer classification"],
                  numbers: ["3%", "10%", "1", "4"],
                  source: "Sleisenger 11e Ch. 41"
                },
                {
                  fact: "Endoscopic ultrasound-guided fine-needle biopsy (EUS-FNB) using Franseen or fork-tip needle geometries acquires preserved core tissue architecture, achieving superior diagnostic adequacy over standard cytology needles.",
                  terms: ["fine-needle biopsy", "Franseen needle"],
                  source: "Sleisenger 11e Ch. 41"
                },
                {
                  fact: "Kudo pit pattern classification assesses colorectal polyp crypt orifice microarchitecture under magnification chromoendoscopy, where Types III and IV indicate non-invasive adenomas and Type V indicates deep submucosal invasive cancer.",
                  terms: ["Kudo pit pattern", "magnification chromoendoscopy"],
                  numbers: ["3", "4", "5"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "NICE (NBI International Colorectal Endoscopic) classification utilizes narrow-band imaging without optical magnification to differentiate hyperplastic polyps (Type 1), adenomas (Type 2), and deep submucosal invasive carcinomas (Type 3).",
                  terms: ["NICE classification", "narrow-band imaging"],
                  numbers: ["1", "2", "3"],
                  source: "Sleisenger 11e Ch. 126"
                },
                {
                  fact: "Percutaneous endoscopic gastrostomy (PEG) provides long-term enteral nutrition access in patients with functional GI tracts but impaired swallowing, placed under direct transillumination and finger-indentation guidance.",
                  terms: ["Percutaneous endoscopic gastrostomy", "enteral nutrition access"],
                  source: "Sleisenger 11e Ch. 41"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-gi-physiology-nutrition",
          name: "Gastrointestinal physiology and clinical nutrition",
          size: "m",
          topics: [
            {
              id: "sgi-gi-physiology-nutrition",
              title: "Gastrointestinal physiology and clinical nutrition",
              book: "Sleisenger & Fordtran 11e Ch. 2, 4, 106",
              mustKnow: [
                {
                  fact: "Gastrin is secreted by antral G cells in response to luminal peptides, stimulating parietal cell gastric acid secretion directly and indirectly via histamine release from enterochromaffin-like (ECL) cells.",
                  terms: ["Gastrin", "enterochromaffin-like cells"],
                  source: "Sleisenger 11e Ch. 2"
                },
                {
                  fact: "Secretin is released by duodenal S cells in response to intraluminal acid (pH < 4.5), stimulating abundant pancreatic ductal bicarbonate and water secretion while inhibiting gastric acid production.",
                  terms: ["Secretin", "bicarbonate secretion"],
                  numbers: ["4.5"],
                  source: "Sleisenger 11e Ch. 2"
                },
                {
                  fact: "Cholecystokinin (CCK) is secreted by duodenal and jejunal I cells in response to dietary fat and amino acids, stimulating gallbladder contraction, relaxing the sphincter of Oddi, and inducing pancreatic acinar enzyme secretion.",
                  terms: ["Cholecystokinin", "gallbladder contraction"],
                  source: "Sleisenger 11e Ch. 2"
                },
                {
                  fact: "The migrating motor complex (MMC) is a cyclic pattern of gastrointestinal electromechanical motility occurring in the interdigestive fasting state, driven by motilin, with Phase III producing propulsive 'housekeeper' sweeping contractions.",
                  terms: ["migrating motor complex", "motilin"],
                  numbers: ["3"],
                  source: "Sleisenger 11e Ch. 4"
                },
                {
                  fact: "Refeeding syndrome is a potentially fatal metabolic disturbance occurring upon reintroducing carbohydrates in severely malnourished individuals, characterized by acute hypophosphataemia, hypokalaemia, hypomagnesaemia, and thiamine deficiency.",
                  terms: ["Refeeding syndrome", "hypophosphataemia"],
                  source: "Sleisenger 11e Ch. 4"
                },
                {
                  fact: "Intestinal failure is defined by the reduction of gut function below the minimum necessary for the absorption of macronutrients and/or water and electrolytes, categorized by ESPEN into acute (Type 1), prolonged acute (Type 2), and chronic (Type 3).",
                  terms: ["Intestinal failure", "ESPEN"],
                  numbers: ["1", "2", "3"],
                  source: "Sleisenger 11e Ch. 106"
                },
                {
                  fact: "Glucagon-like peptide-2 (GLP-2) analogue teduglutide enhances intestinal mucosal crypt cell proliferation and villous height, significantly reducing parenteral nutrition volume requirements in short bowel syndrome.",
                  terms: ["teduglutide", "GLP-2"],
                  numbers: ["2"],
                  source: "Sleisenger 11e Ch. 106"
                },
                {
                  fact: "Severe zinc deficiency in malabsorption manifests as acrodermatitis enteropathica, featuring periorificial and acral vesiculobullous dermatitis, chronic diarrhoea, alopecia, and impaired wound healing.",
                  terms: ["zinc deficiency", "acrodermatitis enteropathica"],
                  source: "Sleisenger 11e Ch. 4"
                }
              ]
            }
          ]
        },
        {
          id: "sgi-gi-neuroendocrine-systemic",
          name: "GI neuroendocrine tumours and gut in systemic disease",
          size: "s",
          topics: [
            {
              id: "sgi-gi-neuroendocrine-systemic",
              title: "GI neuroendocrine tumours and gut in systemic disease",
              book: "Sleisenger & Fordtran 11e Ch. 34, 35, 36",
              mustKnow: [
                {
                  fact: "24-hour urinary 5-hydroxyindoleacetic acid (5-HIAA) is the primary biochemical diagnostic marker for carcinoid syndrome, requiring dietary exclusion of tryptophan-rich foods (bananas, avocados, walnuts) during collection.",
                  terms: ["5-hydroxyindoleacetic acid", "5-HIAA"],
                  numbers: ["24", "5"],
                  source: "Sleisenger 11e Ch. 34"
                },
                {
                  fact: "Peptide receptor radionuclide therapy (PRRT) with 177Lu-dotatate delivers targeted beta-radiation to somatostatin receptor-positive well-differentiated midgut neuroendocrine tumours, significantly prolonging progression-free survival in NETTER-1.",
                  terms: ["177Lu-dotatate", "NETTER-1 trial"],
                  numbers: ["177", "1"],
                  source: "Sleisenger 11e Ch. 34 / NETTER-1"
                },
                {
                  fact: "VIPoma (Verner-Morrison syndrome) is characterized by WDHA syndrome (watery diarrhoea, hypokalaemia, achlorhydria) caused by autonomous pancreatic secretion of vasoactive intestinal peptide.",
                  terms: ["VIPoma", "WDHA syndrome"],
                  source: "Sleisenger 11e Ch. 34"
                },
                {
                  fact: "Glucagonoma is an uncommon pancreatic alpha-cell neuroendocrine neoplasm presenting with necrolytic migratory erythema (NME), mild diabetes mellitus, normocytic anaemia, and deep venous thrombosis.",
                  terms: ["Glucagonoma", "necrolytic migratory erythema"],
                  source: "Sleisenger 11e Ch. 34"
                },
                {
                  fact: "Systemic sclerosis (scleroderma) gastrointestinal involvement is driven by neural dysfunction followed by smooth muscle atrophy and fibrosis, causing severe esophageal aperistalsis, wide-mouthed colonic diverticula, and intestinal pseudo-obstruction.",
                  terms: ["Systemic sclerosis", "wide-mouthed diverticula"],
                  source: "Sleisenger 11e Ch. 36"
                },
                {
                  fact: "Gastrointestinal amyloidosis produces intestinal dysmotility, malabsorption, and macroglossia, characterized histologically by extracellular amorphous amyloid deposits displaying pathognomonic apple-green birefringence under polarized light after Congo red staining.",
                  terms: ["Gastrointestinal amyloidosis", "apple-green birefringence"],
                  source: "Sleisenger 11e Ch. 36"
                },
                {
                  fact: "Acute intestinal graft-versus-host disease (GVHD) manifests with voluminous green watery diarrhoea, abdominal cramping, and mucosal denudation, graded by daily stool volume from Grade 1 (> 500 mL/day) to Grade 4 (> 1,500 mL/day).",
                  terms: ["graft-versus-host disease", "stool volume"],
                  numbers: ["1", "500", "4", "1500"],
                  source: "Sleisenger 11e Ch. 36"
                },
                {
                  fact: "Immune checkpoint inhibitor-induced enterocolitis (anti-CTLA-4 ipilimumab, anti-PD-1) presents with severe watery diarrhoea and extensive mucosal ulceration, managed with high-dose corticosteroids and early infliximab or vedolizumab for steroid resistance.",
                  terms: ["checkpoint inhibitor enterocolitis", "ipilimumab"],
                  numbers: ["4", "1"],
                  source: "Sleisenger 11e Ch. 36"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

const OUT_PATH = path.join(ROOT, "prep/blueprints/ss/ss-gastroenterology.json");
fs.writeFileSync(OUT_PATH, JSON.stringify(blueprint, null, 2) + "\n");
console.log("Successfully wrote Gastroenterology blueprint to", OUT_PATH);
console.log("Sections count:", blueprint.sections.length);
const totalMods = blueprint.sections.flatMap(s => s.modules);
console.log("Total modules:", totalMods.length);
console.log("Total facts:", totalMods.reduce((acc, m) => acc + m.topics[0].mustKnow.length, 0));
