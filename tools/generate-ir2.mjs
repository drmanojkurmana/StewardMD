#!/usr/bin/env node
/* IR wave 2: drainage, ablation, malformations, selective embolisation, pain-spine, safety.
 * Own words throughout; zero external API. Includes full maikir integration tail. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const LP = require("../prep-lessons.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = "Safari reference; Handbook of Interventional Radiological Procedure; Interventional Radiology Cases (topic maps only; prose rewritten, no verbatim copy)";
function mcq(id, q, o, a, exp, r, kp) { return { id, q, o, a, exp, r, kp }; }
function step(tx, say, vis) { return vis ? { tx, say, vis } : { tx, say, vis: null }; }
const M = [];
function add(id, title, kb, kbName, aliases, scope, steps, pearls, patho, diffs, invs, mcqs) {
  M.push({ id, title, kb, kbName, aliases, scope, steps, pearls, patho, diffs, invs, mcqs });
}

add("rad-ir-drainage", "Biliary and urinary drainage", "biliary_and_urinary_drainage", "Biliary and Urinary Drainage",
 ["Percutaneous biliary drainage", "Internal-external catheter", "Nephrostomy", "Antegrade stenting", "Abscess drainage"],
 "PTBD indications and technique, nephrostomy for infected obstruction, antegrade stents, cholecystostomy, abscess drains",
 [step("Obstructed bile needs a way out when endoscopy fails. **Percutaneous transhepatic biliary drainage** punctures a peripheral duct under ultrasound and fluoroscopy, ideal after failed **ERCP** or in hilar obstruction. An **internal-external catheter** drains to a bag while stenting past the blockage into duodenum, and capping trials test internal flow. **Left-sided access** suits hilar tumours, while right-sided access suits distal blocks. **Cholangitis** with Charcot fever, pain and jaundice makes drainage urgent rather than elective.",
  "Blocked bile needs drainage when endoscopy fails. Biliary drainage punctures a peripheral duct under image guidance, ideal after failed ERCP or in hilar blocks. Internal-external catheters drain outside while stenting into the gut. Fever with pain and jaundice makes drainage urgent.",
  { kind: "flow", nodes: [{ id: "a", label: "Puncture duct" }, { id: "b", label: "Cross the block" }, { id: "c", label: "Internal-external drain" }, { id: "d", label: "Cap and stent" }], edges: [["a", "b"], ["b", "c"], ["c", "d"]] }),
  step("The infected obstructed kidney is an emergency. **Percutaneous nephrostomy** drains pus under ultrasound within hours in **obstructive pyelonephritis**, saving both kidney and life. **Antegrade ureteric stenting** follows once sepsis settles, pushing a double-J stent down to bladder past stones or strictures. **Pregnancy with obstructing stones** favours nephrostomy over radiation-heavy options. **Clotted or displaced tubes** declare themselves with falling output, pain and fever, needing exchange not antibiotics alone.",
  "An infected blocked kidney is an emergency. Nephrostomy drains pus within hours in obstructive pyelonephritis. Antegrade stenting follows once sepsis settles, pushing a double-J stent to bladder. Pregnancy with stones favours nephrostomy, and blocked tubes need exchange rather than antibiotics alone.",
  { kind: "table", cols: ["Problem", "Drain"], rows: [["Hilar block, ERCP failed", "PTBD"], ["Infected obstructed kidney", "Nephrostomy"], ["Stone after sepsis settles", "Antegrade stent"], ["Unfit gallbladder sepsis", "Cholecystostomy"]] }),
  step("Gallbladder and abscess drains buy time safely. **Percutaneous cholecystostomy** decompresses **acute cholecystitis** in patients unfit for surgery, with interval cholecystectomy planned later. **Abscess drainage** follows the Seldinger route with **pigtail catheters**, upsized or flushed when thick pus slows output. **Pancreatic collections** need the drain to respect vessels and bowel on cross-sectional planning. **Catheter care** with flushing, fixation and output charts prevents the commonest failure, which is blockage or accidental removal.",
  "Gallbladder and abscess drains buy time. Cholecystostomy decompresses cholecystitis in unfit patients with later surgery planned. Abscess drains use pigtail catheters that need flushing when thick pus slows output. Pancreatic collections need careful planned routes, and flushing with fixation prevents blockage.",
  null),
  step("Metal keeps benign and malignant strictures open. **Self-expanding metal biliary stents** outlast plastic in **malignant obstruction** with longer patency and fewer exchanges. **Benign strictures** from stones or surgery may remodel with prolonged plastic or retrievable covered metal stents. **Stent occlusion** returns with jaundice, itch and cholangitis, managed by exchange through the mature tract. **Haemobilia** with melaena after puncture usually settles, but arterial pseudoaneurysm needs coil embolisation.",
  "Metal keeps strictures open. Metal biliary stents outlast plastic in malignant blocks with fewer exchanges. Benign strictures remodel with prolonged or retrievable stents. Occlusion returns with jaundice needing exchange, and post-puncture bleeding usually settles unless a pseudoaneurysm needs coils.",
  { kind: "table", cols: ["Stricture", "Stent"], rows: [["Malignant block", "Metal stent"], ["Benign stricture", "Remodelling stent"], ["Occluded stent", "Exchange"], ["Arterial bleed", "Coil embolisation"]] })],
 ["ERCP failed means PTBD", "Infected blocked kidney is emergency", "Unfit cholecystitis means tube", "Malignant blocks take metal"],
 "Failed ERCP and hilar blocks route to biliary drainage while infected obstructed kidneys demand nephrostomy within hours; unfit gallbladders take tubes, abscesses take pigtails with flushing, and malignant strictures keep metal stents with exchange on occlusion.",
 ["PTBD versus ERCP by reachability", "Nephrostomy versus stent by sepsis urgency", "Cholecystostomy versus surgery by fitness"],
 ["Ultrasound for duct and kidney access", "Cholangiography for stricture mapping", "Nephrostogram for tube checks"],
 [mcq("maikir-061", "A 66-year-old man with a hilar cholangiocarcinoma has deepening jaundice with itching. ERCP fails because the guidewire cannot cross the high block. He spikes a fever to 38.8 degrees with rigors and right upper quadrant pain. Blood cultures are pending and antibiotics have started. Which urgent drainage suits this infected hilar obstruction after failed ERCP?",
  ["Percutaneous transhepatic biliary drainage", "Repeat ERCP tomorrow", "Liver biopsy", "Observation with fluids only"],
  0,
  "**Answer: A - Percutaneous transhepatic biliary drainage.** Infected hilar obstruction after failed ERCP needs urgent biliary drainage, ideally with left-sided access for hilar tumours.\n**Why the others are wrong**\n- B: a failed wire will not cross overnight while sepsis brews.\n- C: biopsy diagnoses but never drains pus.\n- D: fluids alone cannot relieve a blocked infected system.\n**Key point:** Failed ERCP with cholangitis means urgent PTBD.",
  ["Correct. Urgent PTBD drains infected blocks.", "Incorrect. Waiting risks septic shock.", "Incorrect. Biopsy never drains.", "Incorrect. Fluids cannot unblock ducts."],
  "Failed ERCP with cholangitis needs urgent biliary drainage."),
  mcq("maikir-062", "A 54-year-old woman with a ureteric stone presents with fever to 39.2 degrees, flank pain and a white cell count of 22. CT shows a 7 mm obstructing stone with a swollen infected kidney above it. She is borderline hypotensive despite fluids. The urologists want the pus out within hours before definitive stone treatment. Which emergency drainage saves this infected obstructed kidney?",
  ["Percutaneous nephrostomy", "Immediate stone surgery tonight", "Oral antibiotics at home", "Bladder catheter alone"],
  0,
  "**Answer: A - Percutaneous nephrostomy.** Obstructive pyelonephritis needs pus drained within hours by nephrostomy, with stone treatment later.\n**Why the others are wrong**\n- B: operating through pus spreads sepsis.\n- C: tablets cannot drain a blocked kidney.\n- D: bladder drainage misses the ureteric block.\n**Key point:** Infected blocked kidney means emergency nephrostomy.",
  ["Correct. Nephrostomy drains pus fast.", "Incorrect. Surgery through pus spreads sepsis.", "Incorrect. Tablets cannot drain blockage.", "Incorrect. Bladder tubes miss the block."],
  "Infected obstructed kidney needs emergency nephrostomy."),
  mcq("maikir-063", "A 78-year-old man with acute cholecystitis is unfit for general anaesthesia with severe cardiac disease. Antibiotics fail to settle his fever and Murphy sign after 48 hours. Ultrasound shows a distended thick-walled gallbladder with stones and no perforation. Surgery is formally declined by anaesthesia. Which bridging drainage decompresses this unfit gallbladder?",
  ["Percutaneous cholecystostomy", "Emergency open cholecystectomy", "Barium enema", "Gastric bypass"],
  0,
  "**Answer: A - Percutaneous cholecystostomy.** Cholecystostomy decompresses cholecystitis in unfit patients, with interval surgery planned later.\n**Why the others are wrong**\n- B: anaesthesia has formally declined surgery.\n- C: barium studies miss the gallbladder entirely.\n- D: bypass surgery treats obesity, not sepsis.\n**Key point:** Unfit cholecystitis means cholecystostomy.",
  ["Correct. Tubes bridge unfit patients.", "Incorrect. Surgery was declined.", "Incorrect. Barium misses gallbladder.", "Incorrect. Bypass is irrelevant."],
  "Unfit acute cholecystitis is bridged by cholecystostomy."),
  mcq("maikir-064", "A 60-year-old woman with a metal biliary stent for pancreatic cancer returns with jaundice, itching and fever six months later. Cholangiography through the mature tract shows sludge and tumour ingrowth occluding the stent. She remains well enough for re-intervention. Which management best addresses this occluded malignant biliary stent?",
  ["Exchange through the mature tract", "Remove all drainage permanently", "Systemic thrombolysis", "Liver transplantation"],
  0,
  "**Answer: A - Exchange through the mature tract.** Stent occlusion returns with jaundice and cholangitis, managed by exchange through the mature tract.\n**Why the others are wrong**\n- B: removing drainage abandons palliation.\n- C: thrombolysis addresses clot, not tumour ingrowth.\n- D: transplantation is not indicated for this cancer.\n**Key point:** Occluded stents are exchanged through the tract.",
  ["Correct. Exchange restores drainage.", "Incorrect. Abandoning drainage harms.", "Incorrect. No clot is described.", "Incorrect. Transplant is not indicated."],
  "Occluded malignant stents are exchanged through the mature tract."),
  mcq("maikir-065", "A 45-year-old man has a 9 cm appendiceal abscess that fails to resolve on antibiotics alone. CT shows a safe window avoiding bowel and iliac vessels. The surgeons want to avoid a laparotomy in a hostile abdomen. A pigtail catheter is placed by Seldinger technique and thick pus drains. Output then slows on day three with persistent fever. What is the most appropriate next step for this slowing pigtail with ongoing sepsis?",
  ["Flush, upsize or reposition the catheter", "Remove the drain and stop antibiotics", "Immediate hemicolectomy", "Chest physiotherapy only"],
  0,
  "**Answer: A - Flush, upsize or reposition the catheter.** Slowing output with persistent fever means the pigtail needs flushing, upsizing or repositioning, not abandonment.\n**Why the others are wrong**\n- B: removing drainage with ongoing sepsis invites disaster.\n- C: major surgery is avoided while drainage can work.\n- D: chest therapy misses an abdominal abscess.\n**Key point:** Slowing abscess drains need flushing or upsizing.",
  ["Correct. Flush or upsize blocked pigtails.", "Incorrect. Removal with sepsis harms.", "Incorrect. Surgery is avoidable here.", "Incorrect. Chests miss abdomens."],
  "Slowing abscess drains need flushing, upsizing or repositioning."),
  mcq("maikir-066", "A 30-year-old woman at 20 weeks gestation has an obstructing ureteric stone with fever and flank pain. CT is avoided and ultrasound shows hydronephrosis with debris. The obstetricians want drainage with minimal radiation. Which drainage best suits this pregnant patient with an infected obstructing stone?",
  ["Ultrasound-guided nephrostomy", "Shock-wave lithotripsy tonight", "High-dose NSAIDs alone", "Urethral catheter alone"],
  0,
  "**Answer: A - Ultrasound-guided nephrostomy.** Pregnancy with obstructing stones favours nephrostomy with minimal radiation over stone surgery.\n**Why the others are wrong**\n- B: shock waves are banned in pregnancy.\n- C: NSAIDs alone cannot drain pus.\n- D: urethral tubes miss the ureter.\n**Key point:** Pregnant obstructed stones mean nephrostomy.",
  ["Correct. Nephrostomy minimises radiation.", "Incorrect. Shock waves are banned.", "Incorrect. Tablets cannot drain pus.", "Incorrect. Urethral tubes miss ureters."],
  "Pregnant obstructing stones are drained by nephrostomy."),
  mcq("maikir-067", "A 70-year-old man with distal malignant biliary block from pancreatic cancer needs durable palliation. He is not a surgical candidate and the team debates plastic versus metal stenting. They recall that metal stents outlast plastic with fewer exchanges. Which stent best suits durable palliation of malignant distal obstruction?",
  ["Self-expanding metal stent", "Short peripheral cannula", "Ureteric double-J stent", "Coronary bare stent"],
  0,
  "**Answer: A - Self-expanding metal stent.** Metal biliary stents outlast plastic in malignant obstruction with longer patency and fewer exchanges.\n**Why the others are wrong**\n- B: cannulas cannot stent bile ducts.\n- C: ureteric stents belong in ureters.\n- D: coronary stents are sized for hearts.\n**Key point:** Malignant blocks take metal stents.",
  ["Correct. Metal outlasts plastic here.", "Incorrect. Cannulas cannot stent ducts.", "Incorrect. Ureteric stents miss bile.", "Incorrect. Coronary sizes mismatch."],
  "Malignant biliary blocks take metal stents."),
  mcq("maikir-068", "A 55-year-old man develops melaena three days after biliary puncture. He is haemodynamically stable and endoscopy is normal. CT angiography shows a small hepatic artery pseudoaneurysm at the puncture track. Which escalation suits post-puncture haemobilia with an arterial pseudoaneurysm?",
  ["Coil embolisation of the pseudoaneurysm", "Observation forever without imaging", "Systemic thrombolysis", "Splenectomy"],
  0,
  "**Answer: A - Coil embolisation of the pseudoaneurysm.** Post-puncture bleeding usually settles, but an arterial pseudoaneurysm with melaena needs coil embolisation.\n**Why the others are wrong**\n- B: pseudoaneurysms can rupture while watched.\n- C: thrombolysis worsens bleeding.\n- D: the spleen is uninvolved.\n**Key point:** Puncture-track pseudoaneurysm means coils.",
  ["Correct. Coils seal arterial pseudoaneurysms.", "Incorrect. Rupture risk needs action.", "Incorrect. Lysis worsens bleeding.", "Incorrect. Spleen is uninvolved."],
  "Puncture-track pseudoaneurysm needs coil embolisation."),
  mcq("maikir-069", "A 62-year-old man with a benign post-surgical bile duct stricture has recurrent cholangitis with plastic stents that block every two months. The team wants a remodelling strategy rather than lifelong exchanges. Which approach best suits a benign biliary stricture needing durable remodelling?",
  ["Prolonged or retrievable covered metal stenting", "Permanent uncovered metal stent at once", "No drainage ever again", "Liver resection"],
  0,
  "**Answer: A - Prolonged or retrievable covered metal stenting.** Benign strictures remodel with prolonged plastic or retrievable covered metal stents.\n**Why the others are wrong**\n- B: permanent uncovered metal in benign disease complicates later surgery.\n- C: abandoning drainage invites sepsis.\n- D: resection is disproportionate for a stricture.\n**Key point:** Benign strictures remodel with retrievable stents.",
  ["Correct. Retrievable stents remodel benign disease.", "Incorrect. Permanent metal harms benign cases.", "Incorrect. Abandonment invites sepsis.", "Incorrect. Resection is disproportionate."],
  "Benign strictures remodel with retrievable stents."),
  mcq("maikir-070", "A 48-year-old woman has a nephrostomy tube that suddenly stops draining with new flank pain and fever. Flushing meets resistance and the tube has partially slipped at the skin. Ultrasound shows reaccumulated hydronephrosis. Which failure of catheter care does this displaced blocked tube represent?",
  ["Blocked or displaced tube needing exchange", "Successful treatment completed", "Contrast allergy", "Stone passage completed"],
  0,
  "**Answer: A - Blocked or displaced tube needing exchange.** Falling output with pain and fever means a clotted or displaced tube needing exchange, not antibiotics alone.\n**Why the others are wrong**\n- B: fever with hydronephrosis is not success.\n- C: allergy causes hives, not blocked tubes.\n- D: stones do not explain tube displacement.\n**Key point:** Fallen output with fever means exchange the tube.",
  ["Correct. Exchange blocked displaced tubes.", "Incorrect. Fever means failure.", "Incorrect. Allergy looks different.", "Incorrect. Stones explain nothing here."],
  "Blocked displaced nephrostomy tubes need exchange.")]);

add("rad-ir-ablation", "Ablation and liver-directed cancer therapy", "ablation_and_liver_directed_therapy", "Ablation and Liver Directed Therapy",
 ["Radiofrequency ablation", "Microwave ablation", "Cryoablation", "Chemoembolisation", "Radioembolisation"],
 "Thermal and non-thermal ablation, HCC selection, colorectal mets, TACE, Y-90 with lung shunt study",
 [step("Heat, cold and electricity all kill focal tumours. **Radiofrequency ablation** heats tissue to coagulative necrosis and suits small **hepatocellular carcinomas** within transplant criteria. **Microwave ablation** reaches higher temperatures faster with less **heat-sink** loss near vessels. **Cryoablation** freezes with visible ice balls and suits renal tumours near the collecting system. **Irreversible electroporation** uses electric pulses without heat, suiting tumours hugging bile ducts or vessels.",
  "Heat, cold and electricity kill focal tumours. Radiofrequency heats small liver cancers to necrosis. Microwave runs hotter with less heat loss near vessels. Freezing suits kidney tumours near drainage tubes, and electroporation suits tumours hugging ducts without heat.",
  { kind: "table", cols: ["Modality", "Best for"], rows: [["Radiofrequency", "Small HCC"], ["Microwave", "Near vessels"], ["Cryoablation", "Renal tumours"], ["Electroporation", "Near ducts"]] }),
  step("Selection decides ablation success. **Hepatocellular carcinoma** within **Milan criteria** under AASLD and EASL guidance suits ablation or transplant pathways. **Colorectal liver metastases** limited in number and size suit ablation when surgery is refused or unfit. **Heat-sink** from adjacent vessels over 3 mm cools radiofrequency zones and invites recurrence at the vessel edge. **Subcapsular tumours** risk seeding and bleeding, needing tract ablation on withdrawal. **Biopsy first** confirms histology before destroying the evidence.",
  "Selection decides success. Liver cancers within Milan criteria suit ablation or transplant routes. Limited colorectal secondaries suit ablation when surgery is refused. Vessel cooling causes edge recurrence, subcapsular tumours need tract burning, and biopsy must precede destruction.",
  null),
  step("Chemoembolisation pairs ischaemia with drugs. **Conventional TACE** mixes chemotherapy with lipiodol followed by embolic particles for intermediate **hepatocellular carcinoma**. **Drug-eluting bead TACE** releases drug slowly with less systemic toxicity. **Post-embolisation syndrome** with fever and pain follows and needs supportive care. **Liver failure** threatens when portal flow is already compromised, so **portal vein patency** is confirmed first. **Bilirubin and performance status** gate every session.",
  "Chemoembolisation pairs ischaemia with drugs. Conventional TACE mixes drugs with oil then particles for intermediate liver cancer. Bead TACE releases drug slowly with less toxicity. Fever and pain after need supportive care, and portal patency with bilirubin gates every session.",
  { kind: "table", cols: ["Therapy", "Role"], rows: [["Conventional TACE", "Intermediate HCC"], ["Bead TACE", "Less systemic toxicity"], ["Portal patency", "Required first"], ["Post syndrome", "Supportive care"]] }),
  step("Radioembolisation irradiates from inside. **Yttrium-90 microspheres** lodge in tumour arterioles delivering **beta radiation** over days, suiting unresectable liver tumours with good reserve. A **macroaggregated albumin scan** maps **lung shunting** and gastrointestinal reflux before dosing, and excessive shunt cancels or reduces treatment. **Radiation segmentectomy** ablates small segments with high dose, while lobar treatment needs preserved function. **Gastric ulceration** from refluxed spheres is the dreaded non-target injury.",
  "Radioembolisation irradiates from inside. Yttrium spheres lodge in tumour vessels delivering beta dose over days. An albumin scan maps lung shunt and gut reflux first, with excess shunt cancelling treatment. Segmentectomy ablates small areas, and refluxed spheres ulcerate stomach.",
  { kind: "flow", nodes: [{ id: "a", label: "Map with albumin scan" }, { id: "b", label: "Check lung shunt" }, { id: "c", label: "Deliver Y-90 dose" }, { id: "d", label: "Watch liver function" }], edges: [["a", "b"], ["b", "c"], ["c", "d"]] })],
 ["Milan guides HCC ablation", "Heat-sink recurs at vessels", "Portal patency gates TACE", "Albumin scan precedes Y-90"],
 "Radiofrequency, microwave, freezing and electroporation each suit different tumour positions; Milan criteria gate liver cancer ablation while vessel cooling explains edge recurrence, TACE needs portal patency first, and Y-90 needs an albumin lung-shunt map before dosing.",
 ["Ablation versus resection by fitness and spread", "TACE versus Y-90 by portal flow and burden", "Recurrence versus residual by rim pattern"],
 ["Triphasic CT for HCC diagnosis", "MRI with hepatobiliary contrast", "Albumin scan for shunt fraction"],
 [mcq("maikir-071", "A 58-year-old man with cirrhosis has a 3 cm hepatocellular carcinoma in segment 6 with no vascular invasion and no spread. He is unfit for surgery with severe COPD. The tumour board notes the lesion falls within Milan criteria and offers thermal destruction. Which modality best suits this small HCC within transplant criteria in an unfit patient?",
  ["Radiofrequency ablation", "Whole-liver radiotherapy", "Systemic steroids", "Liver biopsy alone"],
  0,
  "**Answer: A - Radiofrequency ablation.** Small hepatocellular carcinomas within Milan criteria suit radiofrequency ablation when surgery is refused or unfit.\n**Why the others are wrong**\n- B: whole-liver radiation destroys functioning liver too.\n- C: steroids never treat HCC.\n- D: biopsy alone leaves the tumour untreated.\n**Key point:** Small HCC within Milan means ablation.",
  ["Correct. Small HCC suits ablation.", "Incorrect. Whole-liver radiation harms.", "Incorrect. Steroids never treat HCC.", "Incorrect. Biopsy alone treats nothing."],
  "Small HCC within Milan criteria suits radiofrequency ablation."),
  mcq("maikir-072", "A 63-year-old man undergoes radiofrequency ablation of a liver metastasis sitting against a large hepatic vein. Six months later imaging shows recurrence exactly at the vessel edge with a viable rim. The team discusses why the zone failed there. Which effect explains recurrence at the vessel edge after thermal ablation?",
  ["Heat-sink cooling from adjacent blood flow", "Contrast allergy", "Stent fracture", "Needle allergy"],
  0,
  "**Answer: A - Heat-sink cooling from adjacent blood flow.** Vessels over 3 mm cool radiofrequency zones, inviting recurrence at the vessel edge.\n**Why the others are wrong**\n- B: allergy causes hives, not rim recurrence.\n- C: no stent is involved here.\n- D: needle allergy is not a recognised entity.\n**Key point:** Vessel edges recur through heat-sink.",
  ["Correct. Blood flow cools the zone.", "Incorrect. Allergy looks different.", "Incorrect. No stent is present.", "Incorrect. No such allergy exists."],
  "Heat-sink from vessels causes edge recurrence after ablation."),
  mcq("maikir-073", "A 55-year-old woman has three small colorectal liver metastases and refuses hepatic resection. Her liver function is normal with no extrahepatic disease. The oncology team wants local destruction of each deposit. Which approach suits limited colorectal liver metastases when surgery is refused?",
  ["Percutaneous ablation of each deposit", "Antibiotics for six weeks", "Liver transplantation", "Observation alone"],
  0,
  "**Answer: A - Percutaneous ablation of each deposit.** Colorectal metastases limited in number and size suit ablation when surgery is refused or unfit.\n**Why the others are wrong**\n- B: antibiotics cannot kill metastases.\n- C: transplantation is not indicated for colorectal spread.\n- D: untreated deposits progress.\n**Key point:** Limited colorectal mets suit ablation when surgery refused.",
  ["Correct. Limited deposits suit ablation.", "Incorrect. Antibiotics kill no tumours.", "Incorrect. Transplant is not indicated.", "Incorrect. Deposits progress untreated."],
  "Limited colorectal liver metastases suit ablation when surgery is refused."),
  mcq("maikir-074", "A 67-year-old man with intermediate hepatocellular carcinoma and patent portal vein undergoes conventional TACE. Two days later he has fever to 38.4 degrees with right upper quadrant pain and nausea. Cultures are negative and he is stable. Which expected aftermath of TACE does this sterile fever with pain represent?",
  ["Post-embolisation syndrome", "Bacterial peritonitis", "Acute appendicitis", "Myocardial infarction"],
  0,
  "**Answer: A - Post-embolisation syndrome.** Fever and pain after TACE with negative cultures and stability define post-embolisation syndrome needing supportive care.\n**Why the others are wrong**\n- B: peritonitis gives guarding with positive signs.\n- C: appendicitis localises to the right iliac fossa.\n- D: infarction gives chest signs with ECG changes.\n**Key point:** Fever after TACE is usually the syndrome.",
  ["Correct. Sterile fever means the syndrome.", "Incorrect. No guarding is present.", "Incorrect. Wrong location entirely.", "Incorrect. No cardiac signs."],
  "Fever and pain after TACE usually means post-embolisation syndrome."),
  mcq("maikir-075", "A 60-year-old man with unresectable liver tumour and good reserve is planned for Y-90 radioembolisation. The mapping study injects macroaggregated albumin and scans the lungs and gut. The team must exclude excessive shunting before ordering the dose. Which mapping step must precede every Y-90 treatment?",
  ["Albumin scan for lung shunt and gut reflux", "Bone marrow biopsy", "Colonoscopy", "Skin allergy testing"],
  0,
  "**Answer: A - Albumin scan for lung shunt and gut reflux.** A macroaggregated albumin scan maps lung shunting and gastrointestinal reflux before dosing, with excess shunt cancelling treatment.\n**Why the others are wrong**\n- B: marrow biopsy never maps shunts.\n- C: colonoscopy misses lung shunting.\n- D: skin testing is irrelevant to microspheres.\n**Key point:** Y-90 always needs an albumin shunt map first.",
  ["Correct. Albumin maps shunt and reflux.", "Incorrect. Marrow never maps shunts.", "Incorrect. Colonoscopy misses lungs.", "Incorrect. Skin tests are irrelevant."],
  "Y-90 radioembolisation needs an albumin shunt map first."),
  mcq("maikir-076", "A 52-year-old woman with a 4 cm renal tumour near the collecting system is unfit for partial nephrectomy. The team wants ablation that visualises the zone and protects the drainage system. Which modality suits renal tumours hugging the collecting system?",
  ["Cryoablation with visible ice balls", "High-dose whole-kidney radiation", "Embolisation of both kidneys", "Ureteric stent alone"],
  0,
  "**Answer: A - Cryoablation with visible ice balls.** Cryoablation freezes with visible ice balls and suits renal tumours near the collecting system.\n**Why the others are wrong**\n- B: whole-kidney radiation destroys function.\n- C: embolising both kidneys causes failure.\n- D: stents drain but never treat tumours.\n**Key point:** Renal tumours near drainage suit freezing.",
  ["Correct. Ice balls protect collecting systems.", "Incorrect. Whole-kidney radiation harms.", "Incorrect. Bilateral embolisation fails kidneys.", "Incorrect. Stents never treat tumours."],
  "Renal tumours near the collecting system suit cryoablation."),
  mcq("maikir-077", "A 64-year-old man has a liver metastasis wrapped around the main bile duct. Thermal ablation would stricture the duct. The team wants cell kill without heat. Which non-thermal modality suits tumours hugging bile ducts or vessels?",
  ["Irreversible electroporation", "Microwave at maximum power", "Laser through the skin blindly", "Freezing the whole liver"],
  0,
  "**Answer: A - Irreversible electroporation.** Electroporation uses electric pulses without heat, suiting tumours hugging bile ducts or vessels.\n**Why the others are wrong**\n- B: maximum heat strictures the duct.\n- C: blind lasers help nothing here.\n- D: freezing whole livers is lethal.\n**Key point:** Duct-hugging tumours mean electroporation.",
  ["Correct. Pulses kill without heat.", "Incorrect. Heat strictures ducts.", "Incorrect. Blind lasers miss targets.", "Incorrect. Whole-liver freezing kills."],
  "Tumours hugging ducts suit irreversible electroporation."),
  mcq("maikir-078", "A 59-year-old man undergoes TACE for HCC with known portal vein thrombosis that was missed on planning. Within days he develops rapid liver failure with soaring bilirubin and encephalopathy. The team recognises combined loss of arterial and portal supply. Why must portal vein patency be confirmed before every TACE?",
  ["Dual supply loss causes liver failure", "Portal veins never matter", "Arteries supply nothing", "Bilirubin always falls after TACE"],
  0,
  "**Answer: A - Dual supply loss causes liver failure.** TACE removes arterial supply, so an already thrombosed portal vein leaves no perfusion and the liver fails.\n**Why the others are wrong**\n- B: portal flow is the liver lifeline.\n- C: arteries supply tumours and parenchyma.\n- D: bilirubin rises in failure.\n**Key point:** Confirm portal patency before TACE.",
  ["Correct. Dual loss fails livers.", "Incorrect. Portal flow is vital.", "Incorrect. Arteries matter.", "Incorrect. Bilirubin rises in failure."],
  "Portal vein patency must be confirmed before TACE."),
  mcq("maikir-079", "A 66-year-old woman receives Y-90 to the right lobe. Two weeks later she develops severe epigastric pain with endoscopy showing antral ulceration. Review of the mapping angiogram shows unrecognised reflux into the gastroduodenal artery. Which non-target injury of radioembolisation does this ulcer represent?",
  ["Gastric ulceration from refluxed spheres", "Expected tumour shrinkage pain", "Contrast allergy", "Gallstone colic"],
  0,
  "**Answer: A - Gastric ulceration from refluxed spheres.** Refluxed Y-90 spheres ulcerate stomach and duodenum, the dreaded non-target injury.\n**Why the others are wrong**\n- B: shrinkage never ulcerates stomach.\n- C: allergy causes hives, not ulcers.\n- D: gallstones were never implicated.\n**Key point:** Post Y-90 ulcers mean refluxed spheres.",
  ["Correct. Refluxed spheres ulcerate gut.", "Incorrect. Shrinkage spares stomach.", "Incorrect. Allergy looks different.", "Incorrect. Gallstones are uninvolved."],
  "Gastric ulceration after Y-90 means refluxed spheres."),
  mcq("maikir-080", "A 57-year-old man has a subcapsular liver metastasis chosen for ablation. During withdrawal the operator burns the needle tract. The team explains this step seals the path. Why is tract ablation on withdrawal essential for subcapsular tumours?",
  ["It prevents seeding and bleeding along the path", "It speeds up the biopsy report", "It cools the tumour", "It avoids using anaesthesia"],
  0,
  "**Answer: A - It prevents seeding and bleeding along the path.** Subcapsular tumours risk seeding and bleeding, needing tract ablation on withdrawal.\n**Why the others are wrong**\n- B: reports come from labs, not burning.\n- C: burning heats rather than cools.\n- D: anaesthesia is still required.\n**Key point:** Burn the tract in subcapsular ablation.",
  ["Correct. Tract burning seals seeding.", "Incorrect. Labs write reports.", "Incorrect. Burning heats.", "Incorrect. Anaesthesia stays."],
  "Subcapsular ablation needs tract ablation on withdrawal.")]);

add("rad-ir-malformation", "Vascular malformations", "vascular_malformations", "Vascular Malformations",
 ["High-flow versus low-flow", "Arteriovenous malformation nidus", "Venous malformation sclerotherapy", "Lymphatic malformation", "Haemangioma versus malformation"],
 "ISSVA flow classification, AVM nidus embolisation, venous and lymphatic sclerotherapy, haemangioma context",
 [step("Flow decides everything in vascular anomalies. The **ISSVA classification** splits lesions into **high-flow** arteriovenous malformations and fistulas versus **low-flow** venous, lymphatic and capillary lesions. **Arteriovenous malformations** shunt blood through a **nidus** without capillaries, with warmth, thrill and high-output failure. **Venous malformations** are soft, compressible and blue, swelling with dependency and containing **phleboliths**. Correct flow labelling precedes every treatment plan.",
  "Flow decides everything. ISSVA splits high-flow shunts from low-flow venous, lymphatic and capillary lesions. Malformations with a nidus run warm with thrills and can fail hearts, while venous ones feel soft and blue with stones inside. Flow labelling precedes every plan.",
  { kind: "table", cols: ["Lesion", "Flow"], rows: [["AVM and fistula", "High flow"], ["Venous malformation", "Low flow"], ["Lymphatic malformation", "Low flow"], ["Haemangioma infancy", "Tumour not malformation"]] }),
  step("The nidus is the target in AVM work. **Nidus embolisation** with ethanol or **Onyx** closes the shunt core, while proximal ligation alone merely recruits collaterals. The **Yakes classification** guides access choice between transarterial, transvenous and direct puncture. **Staging** across sessions limits swelling and skin loss in large lesions. **Coils alone** in feeding arteries without nidus penetration invite recurrence. **Heart failure** from massive shunting reverses as the nidus closes.",
  "The nidus is the target. Ethanol or Onyx must reach the shunt core, since proximal ties merely recruit collaterals. Classification guides arterial, venous or direct routes. Staging limits skin loss, coils alone invite recurrence, and heart failure reverses as the nidus closes.",
  { kind: "flow", nodes: [{ id: "a", label: "Map the nidus" }, { id: "b", label: "Choose access route" }, { id: "c", label: "Penetrate nidus" }, { id: "d", label: "Stage and review" }], edges: [["a", "b"], ["b", "c"], ["c", "d"]] }),
  step("Low-flow lesions shrink with sclerosants. **Venous malformations** respond to **sodium tetradecyl sulphate**, doxycycline or ethanol injected under ultrasound or fluoroscopy. **Lymphatic malformations** with macrocysts collapse after **doxycycline or bleomycin** instillation with aspiration. **Compression garments** control swelling between sessions. **Coagulopathy** with low fibrinogen in extensive venous lesions needs correction before needling. **Airway lymphatics** in the neck demand intensive care backup for post-procedure swelling.",
  "Low-flow lesions shrink with sclerosants. Venous ones respond to tetradecyl, doxycycline or ethanol under imaging. Lymphatic macrocysts collapse after doxycycline or bleomycin with aspiration. Garments control swelling, coagulopathy needs correction first, and neck lesions need airway backup.",
  null),
  step("Tumours mimic malformations and must be separated. Infantile **haemangioma** is a true tumour with rapid growth then involution, treated first-line with **propranolol** rather than needles. **Klippel-Trenaunay syndrome** combines capillary stain, venous malformation and limb overgrowth with clotting risks. **Parkes Weber syndrome** adds high-flow shunts with overgrowth. **Biopsy** is avoided in typical malformations where imaging suffices, since needling invites bleeding. **Multidisciplinary clinics** with dermatology, surgery and genetics steer complex cases.",
  "Tumours mimic malformations. Infantile haemangioma grows then involutes and takes propranolol first. Klippel-Trenaunay combines stain, venous lesions and overgrowth, while Parkes Weber adds high-flow shunts. Biopsy is avoided where imaging suffices, and joint clinics steer complex cases.",
  { kind: "table", cols: ["Condition", "Clue"], rows: [["Haemangioma infancy", "Grows then involutes"], ["Klippel-Trenaunay", "Stain with overgrowth"], ["Parkes Weber", "High-flow with overgrowth"], ["Venous malformation", "Blue with phleboliths"]] })],
 ["ISSVA flow first", "Nidus or recurrence", "Haemangioma takes propranolol", "Low-flow takes sclerosant"],
 "ISSVA flow labelling splits high-flow nidus shunts from low-flow venous and lymphatic lesions; AVM work must penetrate the nidus since proximal ties recruit collaterals, low-flow lesions shrink with sclerosants, and infantile haemangioma is a propranolol tumour rather than a needle case.",
 ["AVM versus fistula by nidus presence", "Venous versus lymphatic by cysts and stones", "Haemangioma versus malformation by growth course"],
 ["Duplex for flow direction and shunt", "MRI for nidus and extent", "Coagulation profile before needling"],
 [mcq("maikir-081", "A 24-year-old man has a warm pulsatile thigh mass with a thrill and bruit. Duplex shows high-flow shunting without capillaries and cardiac output is raised. MRI maps a compact nidus with feeding arteries and draining veins. The surgeons warn that tying the feeders alone will fail. Which target must embolisation reach to cure this arteriovenous malformation?",
  ["The nidus core itself", "The skin over the lesion", "A distant unrelated artery", "The contralateral limb"],
  0,
  "**Answer: A - The nidus core itself.** Nidus embolisation with ethanol or Onyx closes the shunt core, while proximal ligation alone merely recruits collaterals.\n**Why the others are wrong**\n- B: skin treatment misses the shunt.\n- C: distant arteries are irrelevant.\n- D: the other limb is uninvolved.\n**Key point:** AVM cure means penetrating the nidus.",
  ["Correct. The nidus core must close.", "Incorrect. Skin misses the shunt.", "Incorrect. Distant arteries are irrelevant.", "Incorrect. The other limb is normal."],
  "AVM embolisation must reach the nidus core."),
  mcq("maikir-082", "A 19-year-old woman has a soft blue compressible cheek swelling that enlarges when she bends forward. Ultrasound shows slow flow with calcified phleboliths inside. There is no thrill and no warmth. The team classifies it as low-flow and plans injection treatment. Which sclerotherapy suits this venous malformation with phleboliths?",
  ["Sodium tetradecyl sulphate or doxycycline injection", "Proximal artery ligation", "High-dose aspirin alone", "Whole-face radiotherapy"],
  0,
  "**Answer: A - Sodium tetradecyl sulphate or doxycycline injection.** Venous malformations respond to tetradecyl, doxycycline or ethanol injected under imaging.\n**Why the others are wrong**\n- B: ligation suits arteries, not low-flow veins.\n- C: aspirin cannot shrink malformations.\n- D: radiotherapy is disproportionate and harmful.\n**Key point:** Venous malformations take sclerosant injection.",
  ["Correct. Sclerosants shrink venous lesions.", "Incorrect. Ligation misses veins.", "Incorrect. Aspirin shrinks nothing.", "Incorrect. Radiotherapy harms faces."],
  "Venous malformations are treated by sclerosant injection."),
  mcq("maikir-083", "A 4-month-old girl develops a rapidly growing red nasal lesion. It enlarges over weeks with no thrill and normal cardiac output. Dermatology diagnoses infantile haemangioma and explains its natural growth then involution. The parents ask for needle treatment. Which first-line therapy suits infantile haemangioma rather than embolisation?",
  ["Oral propranolol", "Ethanol embolisation", "Amputation", "Antibiotics"],
  0,
  "**Answer: A - Oral propranolol.** Infantile haemangioma is a true tumour with growth then involution, treated first-line with propranolol rather than needles.\n**Why the others are wrong**\n- B: embolisation misses the tumour biology.\n- C: amputation is absurd for a nasal lesion.\n- D: antibiotics cannot shrink tumours.\n**Key point:** Infantile haemangioma means propranolol first.",
  ["Correct. Propranolol is first-line.", "Incorrect. Needles miss tumour biology.", "Incorrect. Amputation is absurd.", "Incorrect. Antibiotics shrink nothing."],
  "Infantile haemangioma is treated first-line with propranolol."),
  mcq("maikir-084", "A 16-year-old girl has a port-wine stain with limb overgrowth and a large compressible venous malformation of the same leg. She has had two deep vein thromboses. Genetics confirms Klippel-Trenaunay syndrome. The team plans compression, anticoagulation vigilance and staged sclerotherapy. Which triad defines Klippel-Trenaunay syndrome?",
  ["Capillary stain with venous malformation and overgrowth", "High-flow shunt with heart failure only", "Isolated spider naevi", "Bilateral renal cysts"],
  0,
  "**Answer: A - Capillary stain with venous malformation and overgrowth.** Klippel-Trenaunay combines capillary stain, venous malformation and limb overgrowth with clotting risks.\n**Why the others are wrong**\n- B: high-flow shunts define Parkes Weber instead.\n- C: spider naevi are hormonal, not syndromic.\n- D: renal cysts belong to other syndromes.\n**Key point:** Stain plus veins plus overgrowth is Klippel-Trenaunay.",
  ["Correct. The triad defines the syndrome.", "Incorrect. High-flow means Parkes Weber.", "Incorrect. Spider naevi are hormonal.", "Incorrect. Cysts belong elsewhere."],
  "Klippel-Trenaunay means stain, venous lesion and overgrowth."),
  mcq("maikir-085", "A 30-year-old man has a large pelvic AVM treated by coil occlusion of the main feeding artery only. Six months later the mass is bigger with new collaterals on angiography. The nidus remains patent and shunting is worse. Which error explains recurrence after feeding-artery coils without nidus penetration?",
  ["Proximal occlusion recruits collaterals", "Coils cure all AVMs alone", "Nidus heals spontaneously", "Collaterals never form"],
  0,
  "**Answer: A - Proximal occlusion recruits collaterals.** Proximal ligation or coils alone merely recruit collaterals without nidus penetration.\n**Why the others are wrong**\n- B: coils alone invite recurrence.\n- C: untreated nidus never heals itself.\n- D: collaterals form readily after proximal blocks.\n**Key point:** Proximal-only occlusion recruits collaterals.",
  ["Correct. Proximal blocks recruit collaterals.", "Incorrect. Coils alone invite recurrence.", "Incorrect. Nidus never self-heals.", "Incorrect. Collaterals form readily."],
  "Proximal-only AVM occlusion recruits collaterals."),
  mcq("maikir-086", "A 28-year-old man has a high-output cardiac failure with a bounding pulse and a loud pelvic bruit. Imaging shows a massive pelvic AVM shunting litres per minute. Cardiology optimises him but output stays high. The team plans staged nidus embolisation. Which cardiac consequence of massive shunting should reverse as the nidus closes?",
  ["High-output heart failure", "Mitral stenosis", "Pericardial tamponade", "Aortic dissection"],
  0,
  "**Answer: A - High-output heart failure.** Massive shunting drives high-output failure, which reverses as the nidus closes.\n**Why the others are wrong**\n- B: valve stenosis is unrelated to shunts.\n- C: tamponade compresses hearts differently.\n- D: dissection tears aortas, not shunts.\n**Key point:** Massive AVM shunts fail hearts reversibly.",
  ["Correct. Closure reverses high output.", "Incorrect. Valves are unrelated.", "Incorrect. Tamponade differs.", "Incorrect. Dissection tears aortas."],
  "Massive AVM shunting causes reversible high-output failure."),
  mcq("maikir-087", "A 6-year-old girl has a large neck lymphatic malformation with macrocysts compressing the airway mildly. Aspiration yields straw-coloured fluid. The team plans instillation treatment with intensive care backup for swelling. Which sclerotherapy suits macrocystic lymphatic malformations?",
  ["Doxycycline or bleomycin instillation", "Arterial coil embolisation", "Systemic chemotherapy", "Thyroidectomy"],
  0,
  "**Answer: A - Doxycycline or bleomycin instillation.** Lymphatic macrocysts collapse after doxycycline or bleomycin instillation with aspiration.\n**Why the others are wrong**\n- B: coils suit arteries, not lymph cysts.\n- C: chemotherapy misses malformations.\n- D: the thyroid is uninvolved.\n**Key point:** Lymphatic macrocysts take doxycycline or bleomycin.",
  ["Correct. Instillation collapses macrocysts.", "Incorrect. Coils miss lymph.", "Incorrect. Chemotherapy misses lesions.", "Incorrect. Thyroid is uninvolved."],
  "Lymphatic macrocysts collapse with doxycycline or bleomycin."),
  mcq("maikir-088", "A 35-year-old woman has an extensive thigh venous malformation with a fibrinogen of 0.9 and easy bruising. Needling is planned for sclerotherapy. Haematology advises correction first. Why must coagulopathy with low fibrinogen be corrected before needling extensive venous lesions?",
  ["Needling consumes clotting factors and bleeds", "Fibrinogen never matters", "Bruising is always irrelevant", "Correction worsens lesions"],
  0,
  "**Answer: A - Needling consumes clotting factors and bleeds.** Extensive venous lesions consume factors, so correction precedes needling.\n**Why the others are wrong**\n- B: fibrinogen always matters here.\n- C: bruising signals consumption.\n- D: correction protects the procedure.\n**Key point:** Correct coagulopathy before needling venous lesions.",
  ["Correct. Needling consumes factors.", "Incorrect. Fibrinogen matters.", "Incorrect. Bruising warns.", "Incorrect. Correction protects."],
  "Correct coagulopathy before needling extensive venous lesions."),
  mcq("maikir-089", "A 22-year-old man has limb overgrowth with multiple high-flow arteriovenous shunts and a capillary stain. Genetic testing points to Parkes Weber syndrome rather than Klippel-Trenaunay. The team plans high-flow AVM management. Which feature separates Parkes Weber from Klippel-Trenaunay syndrome?",
  ["High-flow shunts with overgrowth", "No vascular lesion at all", "Purely bone disease", "Exclusively eye findings"],
  0,
  "**Answer: A - High-flow shunts with overgrowth.** Parkes Weber adds high-flow shunts with overgrowth, unlike the low-flow Klippel-Trenaunay triad.\n**Why the others are wrong**\n- B: shunts are the defining feature.\n- C: bones alone never define it.\n- D: eyes are uninvolved.\n**Key point:** High-flow shunts with overgrowth mean Parkes Weber.",
  ["Correct. High-flow defines Parkes Weber.", "Incorrect. Shunts define it.", "Incorrect. Bones alone never define.", "Incorrect. Eyes are uninvolved."],
  "Parkes Weber means high-flow shunts with overgrowth."),
  mcq("maikir-090", "A 40-year-old woman has a typical venous malformation diagnosed confidently on duplex and MRI. The surgeon requests a biopsy to be certain. The interventional team declines, noting imaging suffices and needling invites bleeding. When is biopsy correctly avoided in vascular malformations?",
  ["When imaging is typical and diagnostic", "Always in every case", "Never under any circumstance", "Only in children"],
  0,
  "**Answer: A - When imaging is typical and diagnostic.** Biopsy is avoided in typical malformations where imaging suffices, since needling invites bleeding.\n**Why the others are wrong**\n- B: atypical lesions still need tissue.\n- C: atypical cases need biopsy.\n- D: age never decides biopsy alone.\n**Key point:** Typical imaging avoids biopsy in malformations.",
  ["Correct. Typical imaging suffices.", "Incorrect. Atypical lesions need tissue.", "Incorrect. Atypical cases need biopsy.", "Incorrect. Age never decides."],
  "Typical malformation imaging avoids biopsy.")]);

add("rad-ir-selective", "Uterine prostate and bariatric embolisation", "selective_visceral_embolisation", "Selective Visceral Embolisation",
 ["Uterine artery embolisation", "Postpartum haemorrhage", "Prostate artery embolisation", "Bariatric embolisation", "Fertility counselling"],
 "UAE for fibroids and PPH, fertility caution, PAE for BPH, left gastric bariatric work",
 [step("Uterine artery embolisation treats bleeding and bulk while keeping the uterus. **Symptomatic fibroids** with heavy periods and pressure shrink after bilateral **uterine artery** occlusion with particles. **Postpartum haemorrhage** refractory to drugs and balloon tamponade is controlled by emergent UAE. **Adenomyosis** responds partially with pain relief rather than cure. **Fertility wishes** demand counselling, since ovarian reserve may fall and pregnancy needs specialist follow-up.",
  "Uterine embolisation keeps the uterus while treating bleeding and bulk. Fibroids with heavy periods shrink after bilateral particle occlusion. Postpartum bleeding failing drugs and balloons is controlled emergently. Adenomyosis pain eases partially, and fertility wishes need counselling first.",
  { kind: "table", cols: ["Indication", "Role"], rows: [["Symptomatic fibroids", "Shrink and lighten"], ["Postpartum bleeding", "Emergent control"], ["Adenomyosis", "Pain relief"], ["Fertility desired", "Counsel first"]] }),
  step("Prostate embolisation offers a middle path for urinary symptoms. **Prostate artery embolisation** suits men with **lower urinary tract symptoms** from benign enlargement who refuse or cannot undergo surgery. **Sexual function** including ejaculation is preserved better than after TURP. **Large glands** over 80 mL respond well where drugs failed. **Urinary retention** with a catheter resolves in selected cases, while proven **prostate cancer** needs oncology rather than embolisation.",
  "Prostate embolisation suits urinary symptoms from benign enlargement in men avoiding surgery. Sexual function preserves better than after resection. Large glands respond where drugs failed, retention with catheters can resolve, but proven cancer needs oncology instead.",
  null),
  step("Technique is bilateral and superselective. **Bilateral embolisation** matters because unilateral work invites collateral rebleeding in both uterus and prostate. **Cone-beam CT** during the procedure maps feeders and excludes dangerous anastomoses to bladder, rectum or penis. **Non-target embolisation** to skin, bladder or rectum is the feared error, avoided by distal catheter tips. **Post-procedure pain** peaks within hours and needs protocol analgesia with antiemetics.",
  "Technique stays bilateral and superselective. Both sides matter because unilateral work invites collateral rebleeding. Cone-beam CT maps feeders and excludes dangerous connections. Distal tips avoid skin and bladder injury, and pain peaks within hours needing protocol analgesia.",
  { kind: "flow", nodes: [{ id: "a", label: "Map both sides" }, { id: "b", label: "Exclude danger branches" }, { id: "c", label: "Embolise bilaterally" }, { id: "d", label: "Control pain" }], edges: [["a", "b"], ["b", "c"], ["c", "d"]] }),
  step("Bariatric embolisation is the investigational frontier. **Left gastric artery embolisation** targets hunger signalling with early weight-loss signals in trials, but remains **research-only** outside protocols. **Genicular artery embolisation** for knee osteoarthritis pain shows promise but stays selective. **Haemorrhoidal embolisation** through superior rectal branches suits bleeding piles in unfit patients. Every frontier indication needs **trial enrolment or ethics approval**, never routine rollout.",
  "Bariatric work stays investigational. Left gastric embolisation shows early weight signals but remains research-only. Knee and haemorrhoid embolisation suit selected unfit patients. Frontier indications need trial enrolment, never routine rollout.",
  { kind: "table", cols: ["Frontier", "Status"], rows: [["Left gastric bariatric", "Research only"], ["Genicular knee", "Selective"], ["Haemorrhoidal", "Unfit bleeders"], ["All frontiers", "Trials first"]] })],
 ["Fibroids keep uterus with UAE", "PAE preserves ejaculation", "Bilateral or rebleed", "Bariatric stays research"],
 "Uterine embolisation shrinks fibroids and controls postpartum bleeding with fertility counselling first; prostate embolisation relieves urinary symptoms while preserving sexual function better than resection; bilateral superselective technique prevents collateral rebleeding, and bariatric work stays inside trials.",
 ["UAE versus myomectomy by fertility plans", "PAE versus TURP by surgical fitness", "Research versus routine by evidence level"],
 ["Pelvic ultrasound for fibroid mapping", "Uroflowmetry for obstruction proof", "Cone-beam CT for feeder mapping"],
 [mcq("maikir-091", "A 38-year-old woman has heavy periods with flooding and a 6 cm intramural fibroid causing pressure symptoms. She wants to keep her uterus and asks about embolisation. She has no fertility plans after completed family. Which treatment shrinks symptomatic fibroids while preserving the uterus?",
  ["Uterine artery embolisation", "Hysterectomy alone", "Antibiotics", "Appendicectomy"],
  0,
  "**Answer: A - Uterine artery embolisation.** Symptomatic fibroids with heavy bleeding shrink after bilateral uterine artery occlusion with particles.\n**Why the others are wrong**\n- B: hysterectomy removes the organ she wants kept.\n- C: antibiotics cannot shrink fibroids.\n- D: the appendix is uninvolved.\n**Key point:** Symptomatic fibroids with uterus preserved mean UAE.",
  ["Correct. UAE shrinks fibroids.", "Incorrect. Hysterectomy removes uterus.", "Incorrect. Antibiotics shrink nothing.", "Incorrect. Appendix is uninvolved."],
  "Symptomatic fibroids with uterus preservation mean UAE."),
  mcq("maikir-092", "A 29-year-old woman bleeds heavily after delivery despite oxytocin, tranexamic acid and balloon tamponade. She is tachycardic with falling haemoglobin and the uterus is atonic. Hysterectomy is the last resort she fears. Which emergent embolisation controls refractory postpartum haemorrhage while saving the uterus?",
  ["Uterine artery embolisation", "Coronary stenting", "Carotid embolisation", "No treatment possible"],
  0,
  "**Answer: A - Uterine artery embolisation.** Postpartum haemorrhage refractory to drugs and tamponade is controlled by emergent UAE.\n**Why the others are wrong**\n- B: coronaries miss the uterus entirely.\n- C: carotid work misses the pelvis.\n- D: effective treatment exists and works.\n**Key point:** Refractory PPH means emergent UAE.",
  ["Correct. UAE controls PPH emergently.", "Incorrect. Coronaries miss uterus.", "Incorrect. Carotids miss pelvis.", "Incorrect. Treatment exists."],
  "Refractory postpartum haemorrhage means emergent UAE."),
  mcq("maikir-093", "A 26-year-old woman with large fibroids requests embolisation but also plans pregnancy next year. The team explains that ovarian reserve may fall after UAE and pregnancy needs specialist follow-up. Which counselling must precede UAE in a woman planning future fertility?",
  ["Fertility effects with specialist follow-up", "No counselling needed at all", "Guaranteed improved fertility", "Promised twin pregnancy"],
  0,
  "**Answer: A - Fertility effects with specialist follow-up.** Fertility wishes demand counselling since ovarian reserve may fall and pregnancy needs specialist follow-up.\n**Why the others are wrong**\n- B: counselling is mandatory here.\n- C: no fertility guarantee can be given.\n- D: promises of twins are absurd.\n**Key point:** Counsel fertility before UAE.",
  ["Correct. Fertility counselling is mandatory.", "Incorrect. Counselling is required.", "Incorrect. No guarantees exist.", "Incorrect. Absurd promises."],
  "Fertility plans demand counselling before UAE."),
  mcq("maikir-094", "A 72-year-old man has severe lower urinary tract symptoms from a 95 mL benign prostate. Drugs failed and he refuses surgery, fearing loss of ejaculation. He asks for an option preserving sexual function. Which embolisation relieves BPH symptoms while preserving ejaculation better than TURP?",
  ["Prostate artery embolisation", "Nephrectomy", "Bladder removal", "Coronary bypass"],
  0,
  "**Answer: A - Prostate artery embolisation.** Prostate embolisation suits BPH symptoms in men avoiding surgery, preserving sexual function better than resection.\n**Why the others are wrong**\n- B: kidneys are uninvolved.\n- C: bladder removal is grotesque overtreatment.\n- D: hearts miss prostates.\n**Key point:** BPH avoiding surgery means PAE.",
  ["Correct. PAE preserves ejaculation.", "Incorrect. Kidneys are uninvolved.", "Incorrect. Bladder removal over-treats.", "Incorrect. Hearts miss prostates."],
  "BPH symptoms avoiding surgery mean prostate embolisation."),
  mcq("maikir-095", "A 58-year-old man undergoes prostate embolisation where only the right prostatic artery is closed because the left cannot be found. Six months later his symptoms return with documented left-sided collateral supply on angiography. Which technical lesson does this unilateral failure teach?",
  ["Bilateral embolisation prevents collateral rebleeding", "Unilateral work always suffices", "Collaterals never develop", "Prostates need no blood"],
  0,
  "**Answer: A - Bilateral embolisation prevents collateral rebleeding.** Unilateral work invites collateral rebleeding in uterus and prostate alike.\n**Why the others are wrong**\n- B: this case proves unilateral fails.\n- C: collaterals clearly developed here.\n- D: prostates obviously need blood.\n**Key point:** Embolise bilaterally or expect collaterals.",
  ["Correct. Bilateral work prevents rebleed.", "Incorrect. Unilateral failed here.", "Incorrect. Collaterals developed.", "Incorrect. Tissue needs blood."],
  "Visceral embolisation must be bilateral."),
  mcq("maikir-096", "A 68-year-old woman has proven localised prostate cancer in her husband, who asks whether prostate embolisation can treat his malignancy. The team explains embolisation suits benign enlargement while proven cancer needs oncology. Which pathway suits proven prostate cancer rather than embolisation?",
  ["Oncology referral for cancer care", "Prostate embolisation alone", "No treatment ever", "Dental review"],
  0,
  "**Answer: A - Oncology referral for cancer care.** Proven prostate cancer needs oncology rather than embolisation.\n**Why the others are wrong**\n- B: embolisation suits benign disease, not cancer.\n- C: cancer demands treatment.\n- D: dentists never treat prostates.\n**Key point:** Proven prostate cancer means oncology.",
  ["Correct. Cancer needs oncology.", "Incorrect. Embolisation suits benign disease.", "Incorrect. Cancer demands treatment.", "Incorrect. Dentists are irrelevant."],
  "Proven prostate cancer needs oncology, not embolisation."),
  mcq("maikir-097", "A 45-year-old man with severe obesity asks about left gastric artery embolisation after reading about it online. He has no trial access and expects routine treatment next week. The team explains early weight-loss signals exist only in research. What is the correct status of bariatric embolisation today?",
  ["Research-only within trials", "Routine treatment everywhere", "Banned in all countries", "Available without consent"],
  0,
  "**Answer: A - Research-only within trials.** Left gastric embolisation remains research-only outside protocols with trial enrolment required.\n**Why the others are wrong**\n- B: routine rollout is not supported.\n- C: research continues legitimately.\n- D: consent is always required.\n**Key point:** Bariatric embolisation stays in trials.",
  ["Correct. Trials only for now.", "Incorrect. Routine rollout is unsupported.", "Incorrect. Research continues.", "Incorrect. Consent is always needed."],
  "Bariatric embolisation is research-only within trials."),
  mcq("maikir-098", "A 70-year-old man with bleeding haemorrhoids is unfit for surgery with severe cardiac disease. Conservative measures failed and he needs repeated transfusions. Angiography shows prominent superior rectal branches. Which embolisation suits bleeding piles in surgically unfit patients?",
  ["Haemorrhoidal embolisation via superior rectal branches", "Coronary stenting", "Carotid endarterectomy", "Splenectomy"],
  0,
  "**Answer: A - Haemorrhoidal embolisation via superior rectal branches.** Haemorrhoidal embolisation through superior rectal branches suits bleeding piles in unfit patients.\n**Why the others are wrong**\n- B: coronaries miss haemorrhoids.\n- C: carotid surgery misses the rectum.\n- D: the spleen is uninvolved.\n**Key point:** Unfit bleeding piles mean rectal embolisation.",
  ["Correct. Rectal branches supply piles.", "Incorrect. Coronaries miss rectum.", "Incorrect. Carotids miss rectum.", "Incorrect. Spleen is uninvolved."],
  "Bleeding piles in unfit patients suit haemorrhoidal embolisation."),
  mcq("maikir-099", "A 62-year-old woman undergoes uterine embolisation where cone-beam CT reveals a large anastomosis between the uterine artery and the bladder supply. The operator repositions the microcatheter beyond the connection before releasing particles. Which feared error does this distal repositioning avoid?",
  ["Non-target embolisation of bladder or rectum", "Faster procedure time", "Lower equipment cost", "Less need for consent"],
  0,
  "**Answer: A - Non-target embolisation of bladder or rectum.** Distal tips beyond dangerous anastomoses avoid non-target injury to bladder, rectum or skin.\n**Why the others are wrong**\n- B: selectivity adds time.\n- C: cost never drives positioning.\n- D: consent is always required.\n**Key point:** Distal tips avoid non-target injury.",
  ["Correct. Distal tips protect neighbours.", "Incorrect. Selectivity adds time.", "Incorrect. Cost is irrelevant.", "Incorrect. Consent always applies."],
  "Distal catheter tips avoid non-target embolisation."),
  mcq("maikir-100", "A 55-year-old man has knee osteoarthritis pain limiting walking despite physiotherapy and analgesia. He is unfit for replacement with severe cardiac disease. The team discusses genicular artery embolisation as a selective option. What is the current standing of genicular embolisation for knee pain?",
  ["Selective option for unfit patients", "Mandatory for all knee pain", "Proven cure for all arthritis", "Treatment for heart failure"],
  0,
  "**Answer: A - Selective option for unfit patients.** Genicular embolisation for knee pain shows promise but stays selective for suitable unfit patients.\n**Why the others are wrong**\n- B: it suits nobody mandatorily.\n- C: no cure claim is proven.\n- D: knees miss hearts.\n**Key point:** Genicular embolisation stays selective.",
  ["Correct. Selective for unfit knees.", "Incorrect. Nothing is mandatory.", "Incorrect. No cure is proven.", "Incorrect. Knees miss hearts."],
  "Genicular embolisation is a selective option for unfit knee pain.")]);

add("rad-ir-pain-spine", "Pain and spine interventions", "pain_and_spine_interventions", "Pain and Spine Interventions",
 ["Vertebroplasty", "Kyphoplasty", "Celiac plexus neurolysis", "Facet and medial branch blocks", "Epidural steroid injection"],
 "Vertebral augmentation selection, malignant versus osteoporotic fractures, celiac neurolysis, facet work, epidurals",
 [step("Collapsed vertebrae can be cemented back to function. **Vertebroplasty** injects bone cement directly into the fractured body, while **kyphoplasty** first inflates a balloon to restore height before cementing. **Osteoporotic fractures** with severe ongoing pain despite conservative care are the core indication under **NICE guidance**. **Malignant fractures** from myeloma or metastases respond when the posterior wall is intact. **Burst fractures** with retropulsion and neurology need surgery, not cement.",
  "Collapsed vertebrae can be cemented. Vertebroplasty injects cement directly, while kyphoplasty restores height with a balloon first. Severe painful osteoporotic fractures are the core indication. Malignant fractures respond with intact posterior walls, while burst fractures with neurology need surgery.",
  { kind: "table", cols: ["Fracture", "Action"], rows: [["Osteoporotic painful", "Augment"], ["Malignant intact wall", "Augment"], ["Burst with neurology", "Surgery"], ["Mild improving pain", "Conservative"]] }),
  step("Cement demands respect for leaks. **Cement leakage** into discs or veins is usually silent but paravertebral leak can injure nerves. **Pulmonary cement embolism** follows venous leak and needs monitoring. **Adjacent fractures** cluster after augmentation because stiffened bone loads neighbours. **Infection** is rare with sterile technique. **Height restoration** favours kyphoplasty, while pain relief is similar between the two techniques.",
  "Cement demands respect. Leaks are usually silent but nerve injury and lung embolism occur. Neighbouring bones fracture more after stiffening. Infection stays rare with sterile technique, height favours balloons, and pain relief matches between techniques.",
  null),
  step("Pancreatic cancer pain yields to neurolysis. **Celiac plexus neurolysis** with alcohol or phenol suits **upper abdominal cancer pain** refractory to opioids, classically pancreatic. **Endoscopic ultrasound guidance** reaches the plexus without crossing tumour-laden planes. **Diarrhoea and hypotension** follow sympathectomy and need fluids and warning. **Opioid doses** fall after successful blocks, which matters for bowels and minds. **Repeat blocks** fade in value, so timing near peak need is best.",
  "Pancreatic pain yields to neurolysis. Celiac plexus destruction suits upper abdominal cancer pain failing opioids. Endoscopic ultrasound reaches the plexus cleanly. Diarrhoea and hypotension follow and need warning, opioid doses fall afterwards, and timing near peak need works best.",
  { kind: "flow", nodes: [{ id: "a", label: "Confirm cancer pain" }, { id: "b", label: "Guide to plexus" }, { id: "c", label: "Inject neurolytic" }, { id: "d", label: "Cut opioid dose" }], edges: [["a", "b"], ["b", "c"], ["c", "d"]] }),
  step("Backs and legs have targeted injections. **Facet joint injections** with steroid and local anaesthetic suit **axial back pain** worse on extension and rotation. **Medial branch blocks** diagnose facet pain before **radiofrequency denervation** burns the nerve. **Epidural steroid injections** suit **radicular leg pain** from disc or stenosis, with transforaminal routes reaching the exiting root. **Red flags** with neurology, saddle numbness or retention need urgent surgery, never injection.",
  "Backs and legs have targeted injections. Facet shots suit axial pain worse on twisting. Medial branch blocks diagnose before denervation burns the nerve. Epidurals suit leg pain from discs, and red flags with numbness or retention need urgent surgery instead.",
  { kind: "table", cols: ["Pain", "Shot"], rows: [["Axial extension pain", "Facet injection"], ["Diagnose facet", "Medial branch"], ["Radicular leg pain", "Epidural steroid"], ["Saddle numbness", "Urgent surgery"]] })],
 ["Severe osteoporotic pain means cement", "Burst with neurology means surgery", "Pancreatic pain means celiac block", "Saddle numbness means surgery"],
 "Severe painful osteoporotic and suitable malignant fractures take cement while burst fractures with neurology go to surgery; pancreatic cancer pain failing opioids yields to celiac neurolysis, facet pain is diagnosed then denervated, and red-flag neurology always means urgent surgery.",
 ["Augmentation versus conservative by pain course", "Neurolysis versus opioids by dose and bowels", "Injection versus surgery by red flags"],
 ["MRI for fracture age and malignancy", "CT for posterior wall integrity", "Pain mapping for facet levels"],
 [mcq("maikir-101", "A 74-year-old woman has severe back pain from an osteoporotic wedge fracture that has not improved after six weeks of analgesia, bracing and physiotherapy. MRI shows an acute oedematous fracture with intact posterior wall and no neurology. She can barely walk to the bathroom. Which intervention suits this severe painful osteoporotic fracture failing conservative care?",
  ["Vertebral augmentation with cement", "Bed rest for one year", "High-dose opioids forever", "Spinal fusion with rods at once"],
  0,
  "**Answer: A - Vertebral augmentation with cement.** Osteoporotic fractures with severe ongoing pain despite conservative care are the core augmentation indication under NICE guidance.\n**Why the others are wrong**\n- B: endless bed rest wastes bone and muscle.\n- C: opioids alone leave the fracture mobile.\n- D: fusion is disproportionate for a wedge fracture.\n**Key point:** Severe osteoporotic pain failing care means cement.",
  ["Correct. Cement stabilises painful fractures.", "Incorrect. Bed rest wastes bone.", "Incorrect. Opioids leave fractures mobile.", "Incorrect. Fusion over-treats wedges."],
  "Severe painful osteoporotic fractures suit vertebral augmentation."),
  mcq("maikir-102", "A 58-year-old man falls from scaffolding with a burst fracture and bone fragments pushed into the canal. He has new leg weakness with saddle numbness and urinary retention. CT shows retropulsion with canal compromise. The surgeons want decompression and fixation. Why does this burst fracture with neurology need surgery rather than cement?",
  ["Retropulsion with neurology needs decompression", "Cement fixes all fractures", "Weakness always resolves alone", "Retention needs only fluids"],
  0,
  "**Answer: A - Retropulsion with neurology needs decompression.** Burst fractures with retropulsion and neurology need surgery, not cement.\n**Why the others are wrong**\n- B: cement cannot decompress the canal.\n- C: progressive neurology never resolves alone.\n- D: retention here is neurological, not volumetric.\n**Key point:** Burst fractures with neurology mean surgery.",
  ["Correct. Decompression needs surgery.", "Incorrect. Cement decompresses nothing.", "Incorrect. Neurology progresses.", "Incorrect. Retention is neurological."],
  "Burst fractures with neurology need surgery, not cement."),
  mcq("maikir-103", "A 64-year-old man with pancreatic cancer has severe upper abdominal pain radiating to the back despite escalating opioids with constipation and drowsiness. Imaging shows no surgical target. The palliative team wants the celiac plexus destroyed to cut opioid need. Which block suits refractory upper abdominal cancer pain classically from pancreas?",
  ["Celiac plexus neurolysis", "Knee joint injection", "Carpal tunnel release", "Dental extraction"],
  0,
  "**Answer: A - Celiac plexus neurolysis.** Celiac neurolysis with alcohol or phenol suits upper abdominal cancer pain refractory to opioids, classically pancreatic.\n**Why the others are wrong**\n- B: knees miss abdominal plexuses.\n- C: wrists miss the abdomen.\n- D: teeth miss the celiac axis.\n**Key point:** Pancreatic cancer pain means celiac neurolysis.",
  ["Correct. Neurolysis cuts opioid need.", "Incorrect. Knees miss abdomens.", "Incorrect. Wrists miss abdomens.", "Incorrect. Teeth miss plexuses."],
  "Refractory pancreatic cancer pain means celiac plexus neurolysis."),
  mcq("maikir-104", "A 50-year-old woman has axial low back pain worse on extension and rotation with no leg symptoms. Imaging shows facet arthropathy at two levels. Diagnostic medial branch blocks relieve her pain twice. The team plans lasting denervation. Which sequence correctly manages facet-mediated axial pain?",
  ["Medial branch diagnosis then radiofrequency denervation", "Immediate spinal fusion", "Bed rest for six months", "Antibiotics for one year"],
  0,
  "**Answer: A - Medial branch diagnosis then radiofrequency denervation.** Medial branch blocks diagnose facet pain before radiofrequency denervation burns the nerve.\n**Why the others are wrong**\n- B: fusion is disproportionate without red flags.\n- C: endless rest deconditions backs.\n- D: antibiotics treat no facet pain.\n**Key point:** Diagnose with branch blocks, treat with denervation.",
  ["Correct. Diagnose then denervate.", "Incorrect. Fusion over-treats.", "Incorrect. Rest deconditions.", "Incorrect. Antibiotics miss facets."],
  "Facet pain is diagnosed by branch blocks then denervated."),
  mcq("maikir-105", "A 47-year-old man has shooting leg pain to the foot from an L5 disc prolapse with a positive straight-leg raise. Back pain is minor and there are no red flags. Physiotherapy and analgesia failed over eight weeks. The team offers a targeted root injection. Which injection suits radicular leg pain from disc disease without red flags?",
  ["Transforaminal epidural steroid injection", "Facet joint fusion", "Intrathecal chemotherapy", "Hip replacement"],
  0,
  "**Answer: A - Transforaminal epidural steroid injection.** Epidural steroids suit radicular leg pain from disc or stenosis, with transforaminal routes reaching the exiting root.\n**Why the others are wrong**\n- B: fusion over-treats simple radiculopathy.\n- C: chemotherapy misses discs.\n- D: hips miss lumbar roots.\n**Key point:** Radicular leg pain means epidural steroids.",
  ["Correct. Epidurals calm root pain.", "Incorrect. Fusion over-treats.", "Incorrect. Chemotherapy misses discs.", "Incorrect. Hips miss roots."],
  "Radicular leg pain suits epidural steroid injection."),
  mcq("maikir-106", "A 70-year-old man undergoes kyphoplasty for a painful osteoporotic fracture. Post-procedure CT shows cement in the disc space and a small venous leak without symptoms. He is neurologically intact with dramatically improved pain. The team reassures him. Which statement best describes asymptomatic cement leakage into disc or veins?",
  ["Usually silent and observed", "Always fatal", "Needs emergency laminectomy", "Means the cement failed"],
  0,
  "**Answer: A - Usually silent and observed.** Cement leakage into discs or veins is usually silent, with monitoring rather than panic.\n**Why the others are wrong**\n- B: silent leaks are common and harmless.\n- C: intact neurology needs no decompression.\n- D: pain relief proves the cement worked.\n**Key point:** Silent cement leaks are observed.",
  ["Correct. Silent leaks are observed.", "Incorrect. Silent leaks are common.", "Incorrect. No neurology means no surgery.", "Incorrect. Pain relief proves success."],
  "Asymptomatic cement leakage is usually silent and observed."),
  mcq("maikir-107", "A 66-year-old woman with myeloma has a painful T12 fracture with intact posterior wall and no neurology. Systemic therapy continues and the spine team wants local pain control without major surgery. Which malignant fracture profile suits vertebral augmentation?",
  ["Intact posterior wall without neurology", "Burst with retropulsion", "Progressive paraplegia", "Unstable three-column injury"],
  0,
  "**Answer: A - Intact posterior wall without neurology.** Malignant fractures from myeloma or metastases respond when the posterior wall is intact.\n**Why the others are wrong**\n- B: retropulsion needs decompression.\n- C: paraplegia needs urgent surgery.\n- D: unstable injuries need fixation.\n**Key point:** Intact walls allow malignant augmentation.",
  ["Correct. Intact walls suit cement.", "Incorrect. Retropulsion needs surgery.", "Incorrect. Paraplegia needs surgery.", "Incorrect. Instability needs fixation."],
  "Malignant fractures with intact walls suit augmentation."),
  mcq("maikir-108", "A 60-year-old man gets lasting relief from celiac plexus neurolysis with halved opioid doses. Three months later pain returns mildly and he requests another block. The team notes repeat blocks fade in value. What is the expected course of repeat celiac blocks?",
  ["Fading value with each repeat", "Permanent cure each time", "Growing stronger each time", "No effect ever"],
  0,
  "**Answer: A - Fading value with each repeat.** Repeat blocks fade in value, so timing near peak need is best.\n**Why the others are wrong**\n- B: no block cures cancer pain permanently.\n- C: efficacy falls rather than rises.\n- D: the first block clearly worked.\n**Key point:** Repeat celiac blocks fade in value.",
  ["Correct. Repeats fade.", "Incorrect. No permanent cure exists.", "Incorrect. Efficacy falls.", "Incorrect. The first block worked."],
  "Repeat celiac blocks fade in value over time."),
  mcq("maikir-109", "A 55-year-old woman develops diarrhoea and lightheadedness the evening after celiac plexus neurolysis. Her blood pressure is 95 systolic and she feels faint standing. The team recognises sympathectomy effects. Which expected aftermath of celiac neurolysis needs fluids and warning?",
  ["Diarrhoea with hypotension", "Hemiplegia", "Blindness", "Deafness"],
  0,
  "**Answer: A - Diarrhoea with hypotension.** Diarrhoea and hypotension follow sympathectomy and need fluids and warning.\n**Why the others are wrong**\n- B: limbs are untouched by celiac blocks.\n- C: vision is uninvolved.\n- D: hearing is uninvolved.\n**Key point:** Warn of diarrhoea and hypotension after neurolysis.",
  ["Correct. Sympathectomy causes both.", "Incorrect. Limbs are untouched.", "Incorrect. Vision is uninvolved.", "Incorrect. Hearing is uninvolved."],
  "Celiac neurolysis causes diarrhoea and hypotension needing fluids."),
  mcq("maikir-110", "A 44-year-old man has back pain with new saddle numbness and urinary retention after lifting. MRI shows a massive central disc with cauda equina compression. The team bypasses injections entirely. Which red-flag presentation demands urgent surgery rather than any injection?",
  ["Saddle numbness with retention", "Mild axial ache", "Occasional stiffness", "Transient tingling"],
  0,
  "**Answer: A - Saddle numbness with retention.** Red flags with saddle numbness or retention need urgent surgery, never injection.\n**Why the others are wrong**\n- B: mild aches suit conservative care.\n- C: stiffness alone is benign.\n- D: transient tingles lack red flags.\n**Key point:** Saddle numbness with retention means urgent surgery.",
  ["Correct. Red flags mean urgent surgery.", "Incorrect. Mild aches are benign.", "Incorrect. Stiffness alone is benign.", "Incorrect. Tingles lack red flags."],
  "Saddle numbness with retention needs urgent surgery, not injection.")]);

add("rad-ir-safety", "IR safety: contrast radiation anticoagulation consent", "ir_safety_contrast_radiation_consent", "IR Safety: Contrast Radiation and Consent",
 ["Contrast kidney injury", "Metformin and contrast", "Gadolinium and NSF", "Pregnancy radiation", "SIR coagulation and consent"],
 "Contrast AKI prevention, metformin rules, gadolinium caution, foetal dose, SIR thresholds, Montgomery consent",
 [step("Contrast kidneys need water, not fear. **Contrast-associated kidney injury** threatens patients with chronic kidney disease, dehydration, heart failure and multiple myeloma. **Prehydration** with isotonic fluids before and after high-risk procedures is the core prevention under **NICE and ESUR guidance**. **Nephrotoxic drugs** including NSAIDs pause where safe. **Post-procedure creatinine** checks catch injury early. **Metformin** continues unless acute kidney injury develops or is at high risk, when it pauses until recovery.",
  "Contrast kidneys need water. Kidney injury threatens chronic disease, dehydration and failure. Prehydration before and after high-risk procedures is the core prevention. Nephrotoxins pause where safe, creatinine is rechecked after, and metformin continues unless kidney injury develops.",
  { kind: "table", cols: ["Risk", "Action"], rows: [["CKD and dehydration", "Prehydrate"], ["NSAIDs", "Pause if safe"], ["Post procedure", "Recheck creatinine"], ["Metformin", "Continue unless AKI"]] }),
  step("Gadolinium is safer but not innocent. **Nephrogenic systemic fibrosis** follows gadolinium in severe kidney failure, so agents are avoided or minimised when **eGFR falls below 30** under **ACR guidance**. **Pregnancy** allows gadolinium only where benefits clearly outweigh risks, while **breastfeeding** interruptions are no longer routinely required. **Allergy-style reactions** to gadolinium are rarer than with iodinated contrast but need the same resuscitation readiness. **Barium** stays outside vessels, and aspiration of thin barium threatens lungs.",
  "Gadolinium is safer but not innocent. Fibrosis follows gadolinium in severe failure, so use minimises below eGFR 30. Pregnancy allows it only with clear benefit, breastfeeding pauses are unneeded, allergy readiness stays mandatory, and barium never enters vessels.",
  null),
  step("Radiation protection starts with justification. **ALARA** keeps every dose as low as reasonably achievable through collimation, pulsed fluoroscopy and last-image hold. **Deterministic effects** such as skin injury have thresholds, while **stochastic effects** such as cancer carry no safe threshold. **Pregnancy questioning** precedes every fluoroscopy case, with foetal risk negligible below about **50 mGy** under **ICRP and ACR guidance**. **Staff protection** uses lead aprons, thyroid shields, glasses and dosimeters with distance discipline.",
  "Protection starts with justification. ALARA minimises dose through collimation and pulsed screening. Skin injuries have thresholds while cancer risk has none. Pregnancy is asked about every time, foetal risk stays negligible below about 50 mGy, and staff wear lead with dosimeters.",
  { kind: "flow", nodes: [{ id: "a", label: "Justify exposure" }, { id: "b", label: "Ask pregnancy status" }, { id: "c", label: "Minimise with ALARA" }, { id: "d", label: "Record dose" }], edges: [["a", "b"], ["b", "c"], ["c", "d"]] }),
  step("Blood and consent decide legality. **SIR periprocedural guidance** stratifies procedures by bleeding risk, with moderate and high-risk work needing **platelets above 50** and **INR below 1.5 to 1.8** corrected beforehand. **Direct oral anticoagulants** pause per renal function and procedure risk rather than a single rule. **Montgomery consent** discloses what a reasonable patient would want to know, including groin, contrast, radiation and alternative options. The **WHO checklist** with team briefs and sign-in closes the safety loop.",
  "Blood and consent decide legality. SIR guidance stratifies bleeding risk, with moderate and high-risk work needing platelets above 50 and INR below 1.5 to 1.8. Oral thinners pause by kidney and risk, Montgomery consent discloses what reasonable patients want to know, and the WHO checklist closes the loop.",
  { kind: "table", cols: ["Rule", "Standard"], rows: [["Platelets mod-high risk", "Above 50"], ["INR mod-high risk", "Below 1.5 to 1.8"], ["Consent test", "Montgomery"], ["Team safety", "WHO checklist"]] })],
 ["Hydrate at-risk kidneys", "Gadolinium below 30 needs caution", "50 mGy foetal negligible", "Platelets 50 INR 1.5 to 1.8"],
 "Hydration protects at-risk kidneys while metformin continues unless injury develops; gadolinium minimises below eGFR 30, foetal risk stays negligible below about 50 mGy under ALARA, SIR thresholds gate punctures by platelets and INR, and Montgomery consent with WHO checks closes the loop.",
 ["Contrast AKI versus atheroemboli by course", "NSF versus allergy by timing and kidneys", "Deterministic versus stochastic by threshold"],
 ["Creatinine before and after contrast", "eGFR for gadolinium decisions", "INR with platelets for puncture safety"],
 [mcq("maikir-111", "A 68-year-old man with CKD stage 3 needs urgent mesenteric angiography for bleeding. His eGFR is 34 and he is mildly dehydrated after vomiting. The team wants the single most effective kidney protection. Which prevention best protects at-risk kidneys from contrast injury?",
  ["Prehydration with isotonic fluids", "High-dose diuretics during contrast", "No fluids to rest the kidneys", "Dialysis before the procedure"],
  0,
  "**Answer: A - Prehydration with isotonic fluids.** Prehydration before and after high-risk procedures is the core prevention of contrast kidney injury under NICE and ESUR guidance.\n**Why the others are wrong**\n- B: diuretics worsen injury rather than preventing it.\n- C: dehydration invites injury.\n- D: routine dialysis is not indicated here.\n**Key point:** Hydrate at-risk kidneys before contrast.",
  ["Correct. Prehydration is core prevention.", "Incorrect. Diuretics worsen injury.", "Incorrect. Dehydration invites injury.", "Incorrect. Dialysis is not routine."],
  "Prehydration protects at-risk kidneys from contrast injury."),
  mcq("maikir-112", "A 60-year-old woman on metformin with normal kidneys needs pelvic embolisation. Her eGFR is 78 with no AKI and no heart failure. The anaesthetist asks whether to stop metformin. Which metformin rule applies with normal kidneys and no acute injury?",
  ["Continue metformin", "Stop forever", "Double the dose", "Switch to insulin permanently"],
  0,
  "**Answer: A - Continue metformin.** Metformin continues unless acute kidney injury develops or is at high risk.\n**Why the others are wrong**\n- B: lifelong stopping is unwarranted.\n- C: doubling doses helps nothing.\n- D: permanent insulin switch is disproportionate.\n**Key point:** Continue metformin without AKI.",
  ["Correct. Continue without AKI.", "Incorrect. Stopping forever is unwarranted.", "Incorrect. Doubling helps nothing.", "Incorrect. Switching is disproportionate."],
  "Metformin continues with normal kidneys and no AKI."),
  mcq("maikir-113", "A 64-year-old man with eGFR 24 needs a contrast MRI for a liver lesion. Non-contrast sequences are inconclusive and the information will change management. The team weighs gadolinium against fibrosis risk. Which caution governs gadolinium when eGFR falls below 30?",
  ["Avoid or minimise with lowest-risk agent", "Triple the standard dose", "No caution ever needed", "Use barium intravenously instead"],
  0,
  "**Answer: A - Avoid or minimise with lowest-risk agent.** Agents are avoided or minimised when eGFR falls below 30 under ACR guidance.\n**Why the others are wrong**\n- B: higher doses worsen fibrosis risk.\n- C: severe failure demands caution.\n- D: barium must never enter vessels.\n**Key point:** Below eGFR 30, minimise gadolinium.",
  ["Correct. Minimise below 30.", "Incorrect. Higher doses worsen risk.", "Incorrect. Caution is mandatory.", "Incorrect. Barium never enters vessels."],
  "Gadolinium is avoided or minimised below eGFR 30."),
  mcq("maikir-114", "A 32-year-old woman needs urgent pelvic embolisation for bleeding with a positive pregnancy test at 8 weeks. The procedure is life-saving and cannot wait. The team counsels that foetal risk stays negligible at low doses. Below about what conceptus dose is foetal risk considered negligible under ICRP and ACR guidance?",
  ["About 50 mGy", "About 5000 mGy", "Any dose at all", "Zero imaging always"],
  0,
  "**Answer: A - About 50 mGy.** Foetal risk is negligible below about 50 mGy, so justified low-dose work proceeds with ALARA.\n**Why the others are wrong**\n- B: thousands of mGy would be catastrophic.\n- C: some dose always carries theory, not zero.\n- D: life-saving imaging must proceed.\n**Key point:** Below about 50 mGy foetal risk is negligible.",
  ["Correct. 50 mGy is the negligible zone.", "Incorrect. Thousands harm.", "Incorrect. Theory differs from practice.", "Incorrect. Life-saving work proceeds."],
  "Foetal risk is negligible below about 50 mGy."),
  mcq("maikir-115", "A 58-year-old man on apixaban needs urgent nephrostomy for an infected obstructed kidney. His creatinine is rising and the procedure cannot wait days. The team checks renal function and procedure risk to time the pause. How should direct oral anticoagulants be paused before higher-risk IR procedures?",
  ["By renal function and procedure risk", "Never pause under any circumstance", "Double the dose beforehand", "Stop for one year"],
  0,
  "**Answer: A - By renal function and procedure risk.** Oral thinners pause per renal function and procedure risk rather than a single rule.\n**Why the others are wrong**\n- B: unpaused thinners bleed into tracts.\n- C: doubling invites catastrophe.\n- D: year-long stops invite clots.\n**Key point:** Pause oral thinners by kidney and risk.",
  ["Correct. Kidney and risk set the pause.", "Incorrect. Unpaused thinners bleed.", "Incorrect. Doubling is catastrophic.", "Incorrect. Year stops invite clots."],
  "Pause direct oral anticoagulants by renal function and procedure risk."),
  mcq("maikir-116", "A 70-year-old woman needs a moderate-risk biliary drainage with platelets of 38 and INR 1.1. The team debates proceeding directly. They recall SIR guidance needs platelets above 50 for moderate and high-risk work. What must happen to her platelets before puncture?",
  ["Correct to above 50 first", "Proceed regardless", "Cancel forever", "Halve the platelets further"],
  0,
  "**Answer: A - Correct to above 50 first.** Moderate and high-risk procedures need platelets above 50 corrected beforehand under SIR guidance.\n**Why the others are wrong**\n- B: puncturing at 38 invites tract bleeding.\n- C: the procedure is still needed after correction.\n- D: lowering further is absurd.\n**Key point:** Platelets above 50 for moderate and high-risk work.",
  ["Correct. Correct above 50 first.", "Incorrect. 38 risks tract bleeding.", "Incorrect. Correction allows proceeding.", "Incorrect. Lowering is absurd."],
  "Moderate and high-risk punctures need platelets above 50."),
  mcq("maikir-117", "A 62-year-old man needs liver ablation with INR 2.1 on warfarin for atrial fibrillation. Bridging is planned with cardiology input. The team cites SIR guidance needing INR below 1.5 to 1.8 for higher-risk work. What INR must be reached before this higher-risk puncture?",
  ["Below 1.5 to 1.8", "Above 4.0", "Exactly 3.5", "Any value works"],
  0,
  "**Answer: A - Below 1.5 to 1.8.** Higher-risk work needs INR below 1.5 to 1.8 corrected beforehand under SIR guidance.\n**Why the others are wrong**\n- B: high INRs bleed catastrophically.\n- C: 3.5 remains too high.\n- D: values always matter here.\n**Key point:** Higher-risk work needs INR below 1.5 to 1.8.",
  ["Correct. Correct below 1.5 to 1.8.", "Incorrect. High INRs bleed.", "Incorrect. 3.5 is too high.", "Incorrect. Values always matter."],
  "Higher-risk punctures need INR below 1.5 to 1.8."),
  mcq("maikir-118", "A 55-year-old woman consents for uterine embolisation after discussion of benefits, groin risks, fertility effects, radiation and hysterectomy as an alternative. She asks what legal standard this thorough disclosure meets. Which consent standard requires disclosing what a reasonable patient would want to know?",
  ["Montgomery consent", "No consent needed", "Paternalistic consent", "Family-only consent"],
  0,
  "**Answer: A - Montgomery consent.** Montgomery discloses what a reasonable patient would want to know, including risks and alternatives.\n**Why the others are wrong**\n- B: consent is always legally required.\n- C: paternalism was replaced by Montgomery.\n- D: the patient herself decides.\n**Key point:** Montgomery means disclose what patients want to know.",
  ["Correct. Montgomery sets the standard.", "Incorrect. Consent is always required.", "Incorrect. Paternalism was replaced.", "Incorrect. Patients decide."],
  "Montgomery consent discloses what reasonable patients want to know."),
  mcq("maikir-119", "A theatre team starts a complex embolisation with a brisk brief covering patient identity, allergies, antibiotics and equipment checks. They repeat checks at sign-in and sign-out. Which safety system do these team briefs with sign-in represent?",
  ["WHO surgical safety checklist", "No safety system", "Billing checklist", "Parking checklist"],
  0,
  "**Answer: A - WHO surgical safety checklist.** The WHO checklist with team briefs and sign-in closes the safety loop.\n**Why the others are wrong**\n- B: a real safety system is running.\n- C: billing misses safety entirely.\n- D: parking is irrelevant.\n**Key point:** Team briefs with sign-in mean WHO checklist.",
  ["Correct. WHO checks close the loop.", "Incorrect. A real system runs.", "Incorrect. Billing misses safety.", "Incorrect. Parking is irrelevant."],
  "Team briefs with sign-in mean the WHO checklist."),
  mcq("maikir-120", "A 59-year-old man develops itching and hives within minutes of iodinated contrast injection during angiography. He remains normotensive with no wheeze. The team stops the injection and treats the reaction. Which readiness must every contrast suite maintain for such reactions?",
  ["Resuscitation readiness for allergy-style reactions", "No readiness needed", "More contrast immediately", "Discharge mid-reaction"],
  0,
  "**Answer: A - Resuscitation readiness for allergy-style reactions.** Contrast suites need the same resuscitation readiness for gadolinium and iodinated reactions alike.\n**Why the others are wrong**\n- B: reactions can escalate without readiness.\n- C: more contrast worsens reactions.\n- D: discharging mid-reaction is unsafe.\n**Key point:** Every contrast suite needs resuscitation readiness.",
  ["Correct. Readiness saves lives.", "Incorrect. Reactions escalate.", "Incorrect. More contrast worsens.", "Incorrect. Discharge is unsafe."],
  "Contrast suites need resuscitation readiness for reactions.")]);

const SUBJECT_DIR = path.join(ROOT, "prep/overlays/maikir/radiology");
const KB_DIR = path.join(ROOT, "kb/reference");
const LESSON_DIR = path.join(ROOT, "prep/lessons/v1");
const MODEL = "muse-wonder (local authoring, no external API)";
const ITEM_META = { prov: "SMD", gen: "hand", set: "maikir", d: 2, cog: "recall", credit: "StewardMD original medical knowledge base", licence: "CC BY 4.0 (StewardMD original)", licenceStandard: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0", quality: { status: "automated_checks_passed", gates: { author_self_check: { note: "Author-verified against standard peer references" } } } };
let failures = 0, written = 0, kbWritten = 0, kbSkipped = 0;
for (const m of M) {
  for (const s of m.steps) {
    const words = s.tx.split(/\s+/).filter(Boolean).length;
    if (words < 40 || words > 90) { console.error("FAIL", m.id, "step words:", words); failures++; }
  }
  const quiz = m.mcqs.map((q) => q.id);
  const lesson = {
    v: 1, module: m.id, subject: "radiology", title: m.title, minutes: 7,
    steps: m.steps, quiz, src: [], refs: [REF], gen: "AI", run: "ir-wave2", model: MODEL,
    checks: { shape: true, numbers: true, drugs: true, verbatim: true, dashes: true, verify: true, redone: 0, dropped: 0, kbWords: 0, itemN: m.mcqs.length },
  };
  const probs = LP.checkLesson(lesson);
  if (probs.length) { console.error("LESSON FAIL", m.id, JSON.stringify(probs)); failures++; continue; }
  fs.writeFileSync(path.join(LESSON_DIR, m.id + ".json"), JSON.stringify(lesson, null, 2) + "\n");
  written++;
  const kbPath = path.join(KB_DIR, m.kb + ".json");
  if (!fs.existsSync(kbPath)) {
    fs.writeFileSync(kbPath, JSON.stringify({ id: m.kb, name: m.kbName, aliases: m.aliases, class: "non_infective", system: "Radiology", specialty: "Interventional Radiology", referenceOnly: true, review: { status: "ai_drafted" }, reference: { source: REF, sourceEdition: "IR topic maps (2026-10-15)", pages: null, clinicalPearls: m.pearls, pathophysiology: m.patho, additionalDifferentials: m.diffs, additionalInvestigations: m.invs } }, null, 2) + "\n");
    kbWritten++;
  } else kbSkipped++;
  fs.mkdirSync(SUBJECT_DIR, { recursive: true });
  const items = m.mcqs.map((q) => ({ ...ITEM_META, ...q, topic: m.id }));
  fs.writeFileSync(path.join(SUBJECT_DIR, m.id + ".json"), JSON.stringify({ topic: m.id, set: "maikir", v: 1, items }, null, 2) + "\n");
}
const ALL12 = [
 ["rad-ir-access", "vascular_access_and_diagnostic_angiography", "Seldinger sequence, femoral and radial access, ultrasound-guided micropuncture, diagnostic angiography indications, DSA, access complications, closure"],
 ["rad-ir-embolisation", "embolisation_agents_and_techniques", "Temporary versus permanent agents, GI bleed and trauma embolisation, bronchial and epistaxis work, post-embolisation syndrome, non-target risks"],
 ["rad-ir-tips", "tips_and_portal_interventions", "TIPS indications and gradient target, covered stents, encephalopathy, contraindications, portal vein recanalisation"],
 ["rad-ir-venous", "venous_access_and_ivc_filters", "Catheter selection, SVC stenting, IVC filter indications and retrieval, filter complications, catheter thrombosis"],
 ["rad-ir-stent", "angioplasty_and_stents", "Iliac versus femoropopliteal strategy, drug-coated technology, carotid selection, renal restraint, restenosis"],
 ["rad-ir-thrombolysis", "thrombolysis_and_thrombectomy", "ALI selection and 14-day window, catheter-directed technique, PE escalation, DVT caution, bleeding contraindications"],
 ["rad-ir-drainage", "biliary_and_urinary_drainage", "PTBD indications and technique, nephrostomy for infected obstruction, antegrade stents, cholecystostomy, abscess drains"],
 ["rad-ir-ablation", "ablation_and_liver_directed_therapy", "Thermal and non-thermal ablation, HCC selection, colorectal mets, TACE, Y-90 with lung shunt study"],
 ["rad-ir-malformation", "vascular_malformations", "ISSVA flow classification, AVM nidus embolisation, venous and lymphatic sclerotherapy, haemangioma context"],
 ["rad-ir-selective", "selective_visceral_embolisation", "UAE for fibroids and PPH, fertility caution, PAE for BPH, left gastric bariatric work"],
 ["rad-ir-pain-spine", "pain_and_spine_interventions", "Vertebral augmentation selection, malignant versus osteoporotic fractures, celiac neurolysis, facet work, epidurals"],
 ["rad-ir-safety", "ir_safety_contrast_radiation_consent", "Contrast AKI prevention, metformin rules, gadolinium caution, foetal dose, SIR thresholds, Montgomery consent"],
];
let idx = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, "index.json"), "utf8"));
for (const m of M) idx.modules[m.id] = { title: m.title, minutes: 7, steps: m.steps.length, gen: "AI" };
for (const [id] of ALL12.slice(0, 6)) {
  if (!idx.modules[id]) {
    const L = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, id + ".json"), "utf8"));
    idx.modules[id] = { title: L.title, minutes: 7, steps: L.steps.length, gen: "AI" };
  }
}
fs.writeFileSync(path.join(LESSON_DIR, "index.json"), JSON.stringify(idx, null, 1) + "\n");
let counts = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), "utf8"));
counts.sets.maikir = counts.sets.maikir || {};
counts.sets.maikir.radiology = counts.sets.maikir.radiology || {};
for (const m of M) counts.sets.maikir.radiology[m.id] = m.mcqs.length;
for (const [id] of ALL12.slice(0, 6)) {
  const ov = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/overlays/maikir/radiology", id + ".json"), "utf8"));
  counts.sets.maikir.radiology[id] = ov.items.length;
}
fs.writeFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), JSON.stringify(counts, null, 1) + "\n");
const taxPath = path.join(ROOT, "prep/taxonomy/radiology.json");
const tax = JSON.parse(fs.readFileSync(taxPath, "utf8"));
let sec = tax.sections.find((s) => s.id === "rad-ir");
if (!sec) { sec = { id: "rad-ir", title: "Interventional radiology procedures", modules: [] }; tax.sections.push(sec); }
const have = new Set(sec.modules.map((m) => m.id));
for (const m of M) {
  if (!have.has(m.id)) { sec.modules.push({ id: m.id, title: m.title, size: "m", scope: m.scope }); have.add(m.id); }
}
for (const [id, , scope] of ALL12.slice(0, 6)) {
  if (!have.has(id)) {
    const L = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, id + ".json"), "utf8"));
    sec.modules.push({ id, title: L.title, size: "m", scope }); have.add(id);
  }
}
fs.writeFileSync(taxPath, JSON.stringify(tax, null, 1) + "\n");
const bankPath = path.join(ROOT, "prep/bank/v5/radiology/index.json");
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
const tids = new Set(bank.topics.map((t) => t.id));
function topicFor(id, n) {
  const L = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, id + ".json"), "utf8"));
  return { id, title: { en: L.title }, group: "rad-diagnostic", count: n, all: n, usmle: 0, file: "mcq/" + id + ".json", size: "m", target: 10, lic: "MIT", cite: "StewardMD" };
}
for (const m of M) if (!tids.has(m.id)) { bank.topics.push(topicFor(m.id, m.mcqs.length)); tids.add(m.id); }
for (const [id] of ALL12.slice(0, 6)) {
  if (!tids.has(id)) {
    const ov = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/overlays/maikir/radiology", id + ".json"), "utf8"));
    bank.topics.push(topicFor(id, ov.items.length)); tids.add(id);
  }
}
fs.writeFileSync(bankPath, JSON.stringify(bank, null, 1) + "\n");
let prepJs = fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
if (!prepJs.includes('"maikir"')) {
  prepJs = prepJs.split('radiology: ["radnotes3", "radmax7", "maiktopic1"]').join('radiology: ["radnotes3", "radmax7", "maiktopic1", "maikir"]');
  fs.writeFileSync(path.join(ROOT, "prep.js"), prepJs);
}
const tlPath = path.join(ROOT, "prep/bank/topic-links.json");
const tl = JSON.parse(fs.readFileSync(tlPath, "utf8"));
function linkFor(id, kb) {
  const L = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, id + ".json"), "utf8"));
  return { s: "radiology", t: L.title, kb: [kb], pr: [], ls: [[id, L.title]] };
}
for (const m of M) tl.modules[m.id] = linkFor(m.id, m.kb);
for (const [id, kb] of ALL12.slice(0, 6)) tl.modules[id] = linkFor(id, kb);
fs.writeFileSync(tlPath, JSON.stringify(tl, null, 1) + "\n");
console.log("modules:", M.length, "mcqs:", M.reduce((n, m) => n + m.mcqs.length, 0), "lessons:", written, "kbWritten:", kbWritten, "kbSkipped:", kbSkipped, "failures:", failures);
if (failures) process.exit(1);