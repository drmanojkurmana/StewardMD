/**
 * Wave 4A Surgical Lessons Part 2 (Topics 11-20)
 * Reference: Sabiston Textbook of Surgery 22nd ed
 */

export const wave4aLessonsPart2 = [
  // 11. sur-liver
  {
    module: "sur-liver",
    subject: "surgery",
    title: "Hepatic anatomy, benign liver lesions, hepatocellular carcinoma, and hepatic resection",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Blumgart's Surgery of the Liver, Biliary Tract and Pancreas"],
    steps: [
      {
        tx: "Hepatic **segmental** anatomy is defined by the Couinaud classification, which divides the liver into eight functionally independent segments. Each segment possesses an autonomous triad of portal vein, hepatic artery, and biliary drainage, bounded peripherally by the three main hepatic veins. The Cantlie line, extending from the gallbladder fossa to the inferior vena cava, divides the liver into functional right and left hemilivers, distinct from the anatomical falciform ligament.",
        say: "Couinaud segmental anatomy divides the liver into eight independent segments, each supplied by an autonomous portal triad. The Cantlie line runs from the gallbladder fossa to the inferior vena cava, marking the true functional division between right and left hemilivers.",
        vis: {
          kind: "table",
          cols: ["Couinaud segment", "Anatomical location", "Vascular territory & drainage"],
          rows: [
            ["Segment I (caudate lobe)", "Posterior liver, wraps around IVC", "Direct independent drainage into IVC"],
            ["Segments II and III", "Left lateral sector", "Left hepatic vein drainage"],
            ["Segment IV (quadrate)", "Left medial sector (IVa superior, IVb inferior)", "Middle hepatic vein drainage"],
            ["Segments V and VIII", "Right anterior sector", "Middle and right hepatic vein drainage"],
            ["Segments VI and VII", "Right posterior sector", "Right hepatic vein drainage"]
          ]
        }
      },
      {
        tx: "Benign **hepatic** neoplasms require precise cross-sectional characterization to guide surgical resection versus observation. Cavernous hemangioma is the most common benign liver tumor, demonstrating peripheral nodular puddling on arterial phase with centripetal fill-in on delayed contrast CT. Focal nodular hyperplasia (FNH) is a hyperplastic polyclonal response to vascular malformation, displaying a pathognomonic central stellate scar that enhances on delayed imaging; FNH carries zero malignant potential and requires no resection.",
        say: "Benign liver lesions are differentiated by contrast enhancement. Hemangiomas show peripheral nodular puddling with delayed fill-in. Focal nodular hyperplasia displays a central stellate scar without malignant potential, managed conservatively without resection.",
        vis: {
          kind: "table",
          cols: ["Benign tumor", "Contrast CT/MRI hallmark", "Natural history & management"],
          rows: [
            ["Cavernous hemangioma", "Peripheral nodular puddling with centripetal fill-in", "Benign; observe unless symptomatic / giant"],
            ["Focal nodular hyperplasia", "Central stellate scar with delayed enhancement", "Polyclonal, no malignant risk; observation"],
            ["Hepatic adenoma", "Early arterial enhancement, washes out to isodense", "Rupture & malignant risk; resect if > 5 cm or male"],
            ["Simple biliary cyst", "Thin-walled, water density, non-enhancing", "Benign; aspirate / fenestrate only if symptomatic"]
          ]
        }
      },
      {
        tx: "Hepatic **adenoma** is strongly associated with oral contraceptive pills and anabolic steroid usage. Unlike FNH, adenomas harbor significant risks of spontaneous catastrophic intraperitoneal rupture and malignant transformation into hepatocellular carcinoma. Surgical resection is indicated for all adenomas in males, lesions larger than 5 cm in females, beta-catenin mutated subtypes, or lesions failing to regress following contraceptive cessation. Contrast-enhanced MRI is the diagnostic imaging modality of choice.",
        say: "Hepatic adenomas are linked to estrogen and steroid exposure, carrying risks of life-threatening rupture and malignant transformation. Surgical resection is indicated for tumors in men, lesions over five centimeters, beta-catenin mutations, or persistent adenomas.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "l1", label: "Identification of solid hepatic adenoma" },
            { id: "l2", label: "Cessation of oral contraceptives or anabolic steroids" },
            { id: "l3", label: "MRI reassessment: size over 5 cm, male, or beta-catenin" },
            { id: "l4", label: "Risk of fatal hemorrhagic rupture or malignant progression" },
            { id: "l5", label: "Complete anatomical surgical resection or radiofrequency ablation" }
          ],
          edges: [
            ["l1", "l2"],
            ["l2", "l3"],
            ["l3", "l4"],
            ["l4", "l5"]
          ]
        }
      },
      {
        tx: "Hepatocellular **carcinoma** (HCC) staging determines eligibility for surgical resection versus liver transplantation using the Milan criteria. For cirrhotic patients without macroscopic vascular invasion or extrahepatic spread, orthotopic liver transplantation achieves superior disease-free survival if within Milan limits: a single lesion up to 5 cm or up to three lesions none exceeding 3 cm. Non-cirrhotic patients or Child-Pugh A cirrhotics without portal hypertension are candidates for partial hepatectomy.",
        say: "Hepatocellular carcinoma in cirrhosis is triaged by the Milan criteria for liver transplantation: one tumor up to five centimeters or up to three tumors each under three centimeters. Non-cirrhotic patients with preserved liver function are candidates for anatomical hepatectomy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "h1", label: "Diagnosis of HCC in cirrhotic liver" },
            { id: "h2", label: "Evaluate Child-Pugh class & hepatic venous pressure gradient" },
            { id: "h3", label: "Assess Milan criteria: 1 lesion <= 5 cm or <= 3 lesions <= 3 cm" },
            { id: "h4", label: "Within Milan: prioritize orthotopic liver transplantation" },
            { id: "h5", label: "Outside Milan / Child A without portal HTN: surgical resection" }
          ],
          edges: [
            ["h1", "h2"],
            ["h2", "h3"],
            ["h3", "h4"],
            ["h4", "h5"]
          ]
        }
      }
    ]
  },

  // 12. sur-portal-hypertension
  {
    module: "sur-portal-hypertension",
    subject: "surgery",
    title: "Portal hypertension, acute variceal hemorrhage, endoscopic therapies, and portosystemic shunts",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "AASLD Portal Hypertension Guidelines"],
    steps: [
      {
        tx: "Portal **hypertension** is defined hemodynamically as a hepatic venous pressure gradient (HVPG) exceeding 5 mmHg, with clinical complications emerging when HVPG reaches or surpasses 10 to 12 mmHg. Etiologies are stratified into prehepatic (portal vein thrombosis), intrahepatic presinusoidal (schistosomiasis), intrahepatic sinusoidal (cirrhosis), and posthepatic (Budd-Chiari syndrome). Gastroesophageal varices develop at portosystemic collateral anastomoses, particularly the left gastric vein draining into the azygos system.",
        say: "Portal hypertension is defined by a hepatic venous pressure gradient over 5 millimeters of mercury, with variceal bleeding occurring at gradients above 12. Causes are categorized as prehepatic, intrahepatic sinusoidal cirrhosis, or posthepatic Budd-Chiari syndrome.",
        vis: {
          kind: "table",
          cols: ["Etiological category", "Representative disease", "HVPG pattern (wedge vs free)"],
          rows: [
            ["Prehepatic", "Portal vein thrombosis, splenic vein thrombosis", "Normal wedged pressure, normal gradient"],
            ["Intrahepatic presinusoidal", "Schistosomiasis, congenital hepatic fibrosis", "Normal wedged pressure, elevated portal pressure"],
            ["Intrahepatic sinusoidal", "Cirrhosis (alcoholic, viral, NASH)", "Elevated wedged pressure, elevated HVPG"],
            ["Posthepatic", "Budd-Chiari, right heart failure, IVC web", "Elevated wedged and free hepatic venous pressures"]
          ]
        }
      },
      {
        tx: "Acute **variceal** hemorrhage constitutes a medical and surgical emergency carrying a 20 percent 6-week mortality. Resuscitation mandates restrictive blood transfusion targeting a hemoglobin of 7 to 8 g/dL; over-transfusion spikes portal pressures and triggers rebleeding. Immediate intravenous somatostatin or octreotide infusion selectively induces splanchnic vasoconstriction. Early administration of prophylactic ceftriaxone significantly reduces secondary bacterial infections and improves survival. Diagnostic and therapeutic endoscopy must occur within 12 hours.",
        say: "Acute variceal bleeding requires restrictive blood transfusion targeting hemoglobin around 7 to 8 grams per deciliter to avoid rebound portal hypertension. Octreotide induces splanchnic vasoconstriction, and prophylactic ceftriaxone reduces mortality. Endoscopy is performed within 12 hours.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "v1", label: "Acute hematemesis from bleeding esophageal varices" },
            { id: "v2", label: "Restrictive PRBC transfusion targeting hemoglobin 7-8 g/dL" },
            { id: "v3", label: "Intravenous octreotide infusion & ceftriaxone prophylaxis" },
            { id: "v4", label: "Emergency esophagogastroduodenoscopy within 12 hours" },
            { id: "v5", label: "Endoscopic variceal ligation (EVL) of active bleeding columns" }
          ],
          edges: [
            ["v1", "v2"],
            ["v2", "v3"],
            ["v3", "v4"],
            ["v4", "v5"]
          ]
        }
      },
      {
        tx: "When acute variceal bleeding is refractory to endoscopic ligation, temporary **balloon** tamponade with a Sengstaken-Blakemore or Minnesota tube provides a life-saving bridge to definitive decompression. The gastric balloon is inflated with 250 mL of air and positioned with gentle traction against the gastroesophageal junction; the esophageal balloon is inflated to 30 to 45 mmHg only if bleeding continues. Tamponade should not exceed 24 hours to avoid esophageal ulceration and transmural necrosis.",
        say: "Refractory variceal bleeding is bridged using a Sengstaken-Blakemore tube. The gastric balloon is inflated with 250 milliliters of air and seated against the cardia. The esophageal balloon is kept under 45 millimeters of mercury and deflated within 24 hours.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "b1", label: "Endoscopic failure to control torrential variceal bleeding" },
            { id: "b2", label: "Endotracheal intubation for airway protection" },
            { id: "b3", label: "Placement of Sengstaken-Blakemore tube into stomach" },
            { id: "b4", label: "Gastric balloon inflated with 250 mL air and traction applied" },
            { id: "b5", label: "Urgent bridge to transjugular intrahepatic portosystemic shunt" }
          ],
          edges: [
            ["b1", "b2"],
            ["b2", "b3"],
            ["b3", "b4"],
            ["b4", "b5"]
          ]
        }
      },
      {
        tx: "Transjugular intrahepatic **portosystemic** shunt (TIPS) is the definitive rescue intervention for refractory variceal bleeding and intractable ascites. An expandable PTFE-covered stent is deployed between an intrahepatic branch of the portal vein and a hepatic vein under fluoroscopic guidance, creating a low-resistance portosystemic fistula. TIPS reduces HVPG below 12 mmHg. The primary complication is hepatic encephalopathy due to diversion of unfiltered portal blood into systemic circulation.",
        say: "TIPS creates an expandable metal stent connecting an intrahepatic portal vein branch directly to a hepatic vein. This decompresses portal hypertension below 12 millimeters of mercury. The major adverse effect is hepatic encephalopathy due to bypassed portal detox.",
        vis: {
          kind: "table",
          cols: ["Decompression modality", "Mechanism / surgical anatomy", "Primary clinical utility"],
          rows: [
            ["TIPS", "Transjugular fluoroscopic intrahepatic stent graft", "Refractory variceal bleed; refractory ascites; bridge to OLT"],
            ["Warren shunt (selective)", "Distal splenorenal shunt; preserves portal flow", "Preserves liver perfusion; lower encephalopathy rate"],
            ["Portacaval shunt (total)", "Direct anastomosis of portal vein to IVC", "Historic emergency decompression; high encephalopathy"],
            ["Sugiura procedure", "Extensive thoracic/abdominal devascularization + transection", "Used when no shuntable veins exist (thrombosis)"]
          ]
        }
      }
    ]
  },

  // 13. sur-bile-duct
  {
    module: "sur-bile-duct",
    subject: "surgery",
    title: "Biliary tract pathology: choledocholithiasis, cholangiocarcinoma, and bile duct injury repair",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Strasberg Bile Duct Injury Classification"],
    steps: [
      {
        tx: "Choledocholithiasis refers to the presence of **calculi** within the common bile duct, arising secondarily from the gallbladder or primarily in the bile ducts during stasis. Patients present with biliary colic, fluctuating obstructive jaundice, and elevated alkaline phosphatase and conjugated bilirubin. Endoscopic retrograde cholangiopancreatography (**ERCP**) with sphincterotomy and stone extraction is the first-line therapeutic modality, followed by interval laparoscopic cholecystectomy.",
        say: "Choledocholithiasis presents with biliary colic, obstructive jaundice, and elevated conjugated bilirubin. Endoscopic retrograde cholangiopancreatography with sphincterotomy and stone clearance is first line, followed by laparoscopic cholecystectomy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "c1", label: "Gallstones migrate into common bile duct" },
            { id: "c2", label: "Biliary ductal obstruction & proximal dilation" },
            { id: "c3", label: "MRCP confirms filling defect in common bile duct" },
            { id: "c4", label: "ERCP with biliary sphincterotomy & basket stone extraction" },
            { id: "c5", label: "Elective laparoscopic cholecystectomy during same admission" }
          ],
          edges: [
            ["c1", "c2"],
            ["c2", "c3"],
            ["c3", "c4"],
            ["c4", "c5"]
          ]
        }
      },
      {
        tx: "Acute **cholangitis** is a life-threatening infection of the biliary tree resulting from bacterial superinfection proximal to biliary obstruction. Charcot triad characterizes classic cholangitis: fever, right upper quadrant pain, and jaundice. Progression to Reynolds pentad adds septic shock and altered mental status, indicating suppurative ascending infection requiring emergency biliary decompression via ERCP or percutaneous transhepatic biliary drainage (**PTBD**) within hours of admission.",
        say: "Acute cholangitis results from biliary obstruction combined with bacterial infection. Charcot triad includes fever, right upper quadrant pain, and jaundice. Reynolds pentad adds shock and confusion. Immediate emergent biliary decompression is life-saving.",
        vis: {
          kind: "table",
          cols: ["Clinical syndrome", "Diagnostic criteria components", "Emergency management"],
          rows: [
            ["Charcot triad", "RUQ pain, fever with rigors, obstructive jaundice", "IV fluids, empiric broad-spectrum antibiotics, urgent ERCP"],
            ["Reynolds pentad", "Charcot triad + septic shock + altered mental status", "Immediate ICU resuscitation & emergency emergent biliary decompression"],
            ["Mild cholangitis (Tokyo I)", "Response to IV antibiotics within 24 hours", "Elective or semi-urgent stone clearance"],
            ["Severe cholangitis (Tokyo III)", "Organ dysfunction (cardiovascular, renal, neuro)", "Immediate bedside or fluoroscopic decompression"]
          ]
        }
      },
      {
        tx: "Iatrogenic bile **duct** injury during laparoscopic cholecystectomy is categorized using the Strasberg classification. The classic major injury (Strasberg type E) results from misidentifying the common bile duct as the cystic duct, clipping and dividing it. Type E injuries are subdivided based on distance from the hepatic bifurcation (Bismuth levels E1 through E5). Definitive repair mandates tension-free, end-to-side Roux-en-Y hepaticojejunostomy performed by an experienced hepatobiliary surgeon.",
        say: "Bile duct injury during cholecystectomy is classified by the Strasberg system. Complete transection of the common bile duct represents a type E injury. Definitive repair requires an experienced hepatobiliary team performing a Roux-en-Y hepaticojejunostomy.",
        vis: {
          kind: "table",
          cols: ["Strasberg type", "Anatomical description of injury", "Correct surgical management"],
          rows: [
            ["Type A", "Cystic duct leak or small duct of Luschka leak", "Endoscopic biliary stent placement via ERCP"],
            ["Type B / C", "Occlusion or transection of aberrant right hepatic duct", "Hepaticojejunostomy or segment VI/VII resection"],
            ["Type D", "Lateral partial laceration of major bile duct", "T-tube placement or primary repair over stent"],
            ["Type E (E1-E5)", "Complete circumferential transection / occlusion of CBD", "Roux-en-Y hepaticojejunostomy to healthy mucosa"]
          ]
        }
      },
      {
        tx: "Cholangiocarcinoma is classified anatomically into intrahepatic, perihilar (**Klatskin** tumors), and distal subtypes. Perihilar tumors account for 60 percent of cases and are categorized by the Bismuth-Corlette classification. Type I tumors involve the common hepatic duct distal to bifurcation; Type II involves the bifurcation; Type III involves the bifurcation extending into the right (IIIa) or left (IIIb) hepatic duct; Type IV involves bilateral secondary hepatic ducts. Resection requires en bloc hepatectomy with biliary reconstruction.",
        say: "Perihilar cholangiocarcinoma, or Klatskin tumor, is staged by the Bismuth-Corlette classification. Type one is below the confluence, type two involves the confluence, type three extends into unilateral branches, and type four involves bilateral ducts.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "k1", label: "Obstructive jaundice with painless dilated biliary tree" },
            { id: "k2", label: "Triphasic CT & MRCP define ductal tumor extent" },
            { id: "k3", label: "Bismuth-Corlette staging determines biliary branch involvement" },
            { id: "k4", label: "Preoperative portal vein embolization for future liver remnant" },
            { id: "k5", label: "En bloc partial hepatectomy, caudatectomy, & hepaticojejunostomy" }
          ],
          edges: [
            ["k1", "k2"],
            ["k2", "k3"],
            ["k3", "k4"],
            ["k4", "k5"]
          ]
        }
      }
    ]
  },

  // 14. sur-pancreas
  {
    module: "sur-pancreas",
    subject: "surgery",
    title: "Pancreatic disease: acute pancreatitis, necrotizing step-up approach, and Whipple resection",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "IAP/APA Acute Pancreatitis Guidelines"],
    steps: [
      {
        tx: "Acute **pancreatitis** diagnosis requires at least two of three criteria: characteristic epigastric abdominal pain radiating to the back, serum lipase or amylase elevated at least three times the upper limit of normal, and characteristic cross-sectional imaging findings. Gallstones and alcohol abuse account for 80 percent of cases. The revised Atlanta classification stratifies severity into mild (no organ failure), moderately severe (transient organ failure under 48 hours), and severe (persistent organ failure exceeding 48 hours).",
        say: "Acute pancreatitis diagnosis requires two of three criteria: epigastric pain radiating to the back, threefold lipase elevation, and imaging confirmation. The revised Atlanta classification defines severe pancreatitis by persistent organ failure exceeding 48 hours.",
        vis: {
          kind: "table",
          cols: ["Atlanta severity", "Organ failure definition", "Local pancreatic complications"],
          rows: [
            ["Mild acute pancreatitis", "No organ failure", "No local complications; resolves rapidly"],
            ["Moderately severe", "Transient organ failure (resolves < 48 hours)", "Acute peripancreatic fluid collection / necrosis"],
            ["Severe acute pancreatitis", "Persistent organ failure (exceeds 48 hours)", "Infected necrosis, walled-off pancreatic necrosis (WOPN)"]
          ]
        }
      },
      {
        tx: "Necrotizing pancreatitis manifests as non-enhancing pancreatic parenchyma on contrast-enhanced CT. Sterile necrosis is managed non-operatively with enteral nutrition. When secondary bacterial infection occurs, evidenced by retroperitoneal extraluminal gas or clinical deterioration, intervention is mandatory. Modern surgical standard mandates the **step-up** approach: delaying intervention for 4 weeks until walled-off pancreatic necrosis (WOPN) encapsulates, beginning with percutaneous or endoscopic transgastric drainage, escalating only if clinical sepsis persists.",
        say: "Infected pancreatic necrosis is treated via the minimally invasive step-up approach. Intervention is delayed for four weeks to allow encapsulation into walled-off necrosis. Percutaneous or endoscopic cystogastrostomy drainage is performed first, reserving necrosectomy for failures.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Infected necrotizing pancreatitis confirmed" },
            { id: "p2", label: "Supportive ICU care until walling-off occurs (4 weeks)" },
            { id: "p3", label: "Step 1: Percutaneous retroperitoneal or endoscopic drainage" },
            { id: "p4", label: "Step 2: Video-assisted retroperitoneal debridement (VARD)" },
            { id: "p5", label: "Open necrosectomy reserved only for failure of drainage" }
          ],
          edges: [
            ["p1", "p2"],
            ["p2", "p3"],
            ["p3", "p4"],
            ["p4", "p5"]
          ]
        }
      },
      {
        tx: "Pancreatic ductal **adenocarcinoma** (PDAC) carries a dismal 5-year survival under 10 percent, arising primarily in the pancreatic head. Patients present with painless obstructive jaundice, dark urine, acholic stools, and Courvoisier sign (a palpable, non-tender gallbladder in the presence of jaundice). Diagnostic workup requires pancreatic-protocol triphasic contrast CT to determine vascular resectability by assessing contact with the celiac axis, superior mesenteric artery (SMA), and superior mesenteric vein (SMV).",
        say: "Pancreatic head adenocarcinoma presents with painless jaundice and a palpable gallbladder, known as Courvoisier sign. Resectability is evaluated on pancreatic-protocol CT by checking tumor contact with the superior mesenteric artery, vein, and celiac axis.",
        vis: {
          kind: "table",
          cols: ["Resectability category", "Arterial contact (SMA / Celiac / Hepatic)", "Venous contact (SMV / Portal vein)"],
          rows: [
            ["Resectable", "No arterial abutment (0 degrees)", "No contact or under 180 degrees without contour irregularity"],
            ["Borderline resectable", "Arterial contact under 180 degrees", "Abutment > 180 degrees or occlusion with reconstructable vein"],
            ["Locally advanced unresectable", "Arterial encasement exceeding 180 degrees", "Unreconstructable SMV or portal vein occlusion"],
            ["Metastatic", "Distant visceral or peritoneal metastases", "Systemic chemotherapy (FOLFIRINOX / Gem-Nab-paclitaxel)"]
          ]
        }
      },
      {
        tx: "Pancreaticoduodenectomy (**Whipple** procedure) constitutes the definitive oncologic resection for pancreatic head malignancies. The operation resects the pancreatic head, duodenum, proximal jejunum, gallbladder, common bile duct, and distal stomach (or preserves the pylorus in PPPD). Reconstruction requires three sequential anastomoses: end-to-side pancreaticojejunostomy (or duct-to-mucosa), hepaticojejunostomy, and gastrojejunostomy. Postoperative pancreatic fistula (POPF) is the primary driver of major morbidity.",
        say: "The Whipple procedure resects the pancreatic head, duodenum, gallbladder, bile duct, and distal stomach. Reconstruction requires pancreaticojejunostomy, hepaticojejunostomy, and gastrojejunostomy. Postoperative pancreatic fistula remains the most critical complication.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "w1", label: "Extensive en bloc resection of pancreatic head & duodenum" },
            { id: "w2", label: "Pancreaticojejunostomy (duct-to-mucosa reconstruction)" },
            { id: "w3", label: "Hepaticojejunostomy placed 10 cm downstream on jejunum" },
            { id: "w4", label: "Gastrojejunostomy placed 40 to 50 cm downstream" },
            { id: "w5", label: "Closed suction drain surveillance for amylase leak on post-op day 3" }
          ],
          edges: [
            ["w1", "w2"],
            ["w2", "w3"],
            ["w3", "w4"],
            ["w4", "w5"]
          ]
        }
      }
    ]
  },

  // 15. sur-spleen
  {
    module: "sur-spleen",
    subject: "surgery",
    title: "Splenic trauma, non-operative management, surgical splenectomy, and overwhelming post-splenectomy infection",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "AAST Spleen Injury Scale"],
    steps: [
      {
        tx: "The spleen is the most frequently injured solid organ in blunt abdominal **trauma**, usually resulting from motor vehicle collisions or direct left lower rib fractures. Kehr sign denotes referred left shoulder tip pain caused by diaphragmatic irritation from subcapsular or free intraperitoneal blood. Splenic injury is graded from I to V by the American Association for the Surgery of Trauma (AAST) classification on contrast-enhanced CT scan.",
        say: "The spleen is the solid organ most commonly injured in blunt trauma. Kehr sign denotes referred left shoulder pain from diaphragmatic irritation. Splenic trauma is graded from one to five based on capsular tear depth, hematoma size, and vascular injury.",
        vis: {
          kind: "table",
          cols: ["AAST spleen grade", "Subcapsular hematoma", "Parenchymal laceration depth"],
          rows: [
            ["Grade I", "Under 10 percent surface area", "Subcapsular tear under 1 cm depth"],
            ["Grade II", "10 to 50 percent surface area", "1 to 3 cm depth, trabecular vessels intact"],
            ["Grade III", "Greater than 50 percent surface or expanding", "Exceeding 3 cm depth or trabecular involvement"],
            ["Grade IV", "Ruptured hematoma with active bleed", "Laceration involving segmental or hilar vessels (> 25% devascularized)"],
            ["Grade V", "Completely shattered spleen", "Total hilar avulsion devascularizing entire spleen"]
          ]
        }
      },
      {
        tx: "Non-operative **management** (NOM) is the standard of care for hemodynamically stable blunt splenic injury, succeeding in over 90 percent of patients. Management entails ICU monitoring, serial hemoglobin assessments, and strict bed rest. Contrast-enhanced CT demonstrating a vascular contrast blush (pseudoaneurysm or arteriovenous fistula) represents an indication for catheter splenic artery embolization, which preserves functional splenic immune parenchyma while halting active hemorrhage.",
        say: "Non-operative management is standard for hemodynamically stable splenic trauma. Monitoring, serial hemoglobin checks, and bed rest are required. Finding a vascular contrast blush on CT mandates transcatheter arterial embolization to preserve splenic tissue.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "s1", label: "Blunt abdominal trauma with CT-proven splenic injury" },
            { id: "s2", label: "Hemodynamic stability confirmed (responder to fluids)" },
            { id: "s3", label: "Vascular contrast blush identified on arterial phase" },
            { id: "s4", label: "Urgent angioembolization of splenic artery branch" },
            { id: "s5", label: "Preservation of reticuloendothelial phagocytic immune function" }
          ],
          edges: [
            ["s1", "s2"],
            ["s2", "s3"],
            ["s3", "s4"],
            ["s4", "s5"]
          ]
        }
      },
      {
        tx: "Emergency **splenectomy** is mandated when splenic trauma induces persistent hemodynamic instability refractory to resuscitation, or when peritonitis coexists. Surgical access is achieved via midline laparotomy. Immediate mobilization requires division of the splenocolic, phrenicosplenic, and splenorenal ligaments to deliver the spleen into the wound. The short gastric vessels in the gastrosplenic ligament must be ligated with extreme caution to prevent ischemic necrosis of the gastric fundus or pancreatic tail injury.",
        say: "Immediate splenectomy is indicated for hemodynamic instability or peritonitis. The spleen is mobilized by dividing the splenocolic and splenorenal ligaments. The short gastric vessels must be carefully ligated to avoid damaging the gastric fundus or pancreatic tail.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "Persistent shock from ruptured spleen" },
            { id: "m2", label: "Midline laparotomy & manual left upper quadrant packing" },
            { id: "m3", label: "Division of splenocolic & lateral splenorenal ligaments" },
            { id: "m4", label: "Careful ligation of short gastric vessels away from stomach" },
            { id: "m5", label: "Individual ligation of splenic artery & vein at hilum" }
          ],
          edges: [
            ["m1", "m2"],
            ["m2", "m3"],
            ["m3", "m4"],
            ["m4", "m5"]
          ]
        }
      },
      {
        tx: "Overwhelming post-splenectomy **infection** (OPSI) is a catastrophic complication carrying a mortality exceeding 50 percent, driven by loss of splenic macrophage phagocytosis of encapsulated bacteria. Primary pathogens include Streptococcus pneumoniae (60%), Neisseria meningitidis, and Haemophilus influenzae type b. To prevent OPSI, mandatory immunization with 20-valent pneumococcal conjugate, quadrivalent meningococcal conjugate, and Hib vaccines should be administered at least 14 days post-splenectomy.",
        say: "Overwhelming post-splenectomy infection is a fulminant septic shock caused by encapsulated bacteria, primarily Streptococcus pneumoniae, meningococcus, and Haemophilus influenzae. Patients must receive vaccinations at least 14 days following emergency splenectomy.",
        vis: {
          kind: "table",
          cols: ["Encapsulated pathogen", "Percentage of OPSI cases", "Preventive vaccine protocol"],
          rows: [
            ["Streptococcus pneumoniae", "50 to 60 percent of infections", "PCV20 followed by PPSV23 vaccine booster"],
            ["Neisseria meningitidis", "15 to 25 percent of infections", "MenACWY conjugate vaccine plus MenB series"],
            ["Haemophilus influenzae type b", "5 to 10 percent of infections", "Single dose Hib conjugate vaccination"],
            ["Babesia microti / malaria", "Parasitic red cell infections", "Severe hemolysis; avoid tick / endemic areas"]
          ]
        }
      }
    ]
  },

  // 16. sur-obstruction
  {
    module: "sur-obstruction",
    subject: "surgery",
    title: "Intestinal obstruction: small bowel strangulation, adhesive bands, and colonic volvulus",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "World Society of Emergency Surgery Guidelines"],
    steps: [
      {
        tx: "Small bowel **obstruction** (SBO) is characterized by failure of aboral transit of luminal contents. Intra-abdominal adhesions from prior surgery account for 75 percent of cases, followed by incarcerated hernias and neoplasms. Patients present with crampy abdominal pain, obstipation, vomiting, and abdominal distension. Plain radiographs demonstrate dilated central small bowel loops exceeding 3 cm, air-fluid levels in a stepladder pattern, and absent distal colonic gas.",
        say: "Small bowel obstruction results from adhesions in 75 percent of cases, followed by hernias and malignancies. Patients present with colic, distension, vomiting, and obstipation. Plain radiographs show dilated loops over three centimeters with air-fluid levels.",
        vis: {
          kind: "table",
          cols: ["Etiological category", "Relative frequency", "Clinical characteristics & mechanism"],
          rows: [
            ["Postoperative adhesions", "65 to 75 percent", "Fibrous peritoneal bands from previous laparotomy"],
            ["Incarcerated hernias", "10 to 15 percent", "Inguinal, femoral, umbilical, or incisional defects"],
            ["Intestinal neoplasms", "5 to 10 percent", "Adenocarcinoma, carcinoid, lymphoma, metastases"],
            ["Gallstone ileus", "1 to 2 percent (25% in elderly)", "Fistula to duodenum; stone impacts at ileocecal valve"]
          ]
        }
      },
      {
        tx: "Distinguishing simple obstruction from **strangulated** obstruction is paramount, as strangulation produces bowel wall ischemia, transmural necrosis, and fatal perforation. Classic markers of strangulation include continuous severe pain, fever, tachycardia, localized peritoneal signs, leukocytosis with left shift, and metabolic lactic acidosis. A closed-loop obstruction (e.g., volvulus or bowel occluded at two points by a single band) rapidly progresses to strangulation without proximal decompression.",
        say: "Strangulation causes vascular compromise and bowel necrosis. Clinical signs include fever, tachycardia, localized peritonitis, leukocytosis, and lactic acidosis. Closed-loop obstructions progress rapidly to strangulation and mandate emergency laparotomy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "o1", label: "Loop of bowel occluded at two points (closed loop)" },
            { id: "o2", label: "Luminal pressure exceeds capillary and venous pressure" },
            { id: "o3", label: "Venous thrombosis, arterial ischemia, & bacterial translocation" },
            { id: "o4", label: "Lactic acidosis, peritoneal guarding, & pneumatosis intestinalis" },
            { id: "o5", label: "Immediate emergency exploratory laparotomy and bowel resection" }
          ],
          edges: [
            ["o1", "o2"],
            ["o2", "o3"],
            ["o3", "o4"],
            ["o4", "o5"]
          ]
        }
      },
      {
        tx: "Conservative management of non-strangulated **adhesive** small bowel obstruction succeeds in up to 80 percent of patients. Standard conservative measures comprise nasogastric tube decompression, intravenous isotonic fluid resuscitation, and electrolyte correction. Administration of water-soluble oral contrast (Gastrografin) is both diagnostic and therapeutic; appearance of contrast in the colon on abdominal radiograph within 24 hours predicts successful non-operative resolution with 95 percent accuracy.",
        say: "Conservative treatment of adhesive obstruction resolves 80 percent of uncomplicated cases using nasogastric decompression and intravenous fluids. Gastrografin water-soluble contrast is diagnostic and therapeutic: transit to the colon within 24 hours confirms resolution.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "g1", label: "Adhesive SBO without clinical signs of strangulation" },
            { id: "g2", label: "Nasogastric tube decompression & IV fluid resuscitation" },
            { id: "g3", label: "Administer 100 mL water-soluble Gastrografin contrast" },
            { id: "g4", label: "Abdominal radiograph at 8 and 24 hours post-contrast" },
            { id: "g5", label: "Contrast reaches colon: feed / Contrast fails: surgery" }
          ],
          edges: [
            ["g1", "g2"],
            ["g2", "g3"],
            ["g3", "g4"],
            ["g4", "g5"]
          ]
        }
      },
      {
        tx: "Sigmoid **volvulus** occurs when the redundant sigmoid colon twists on its narrow mesenteric axis, creating a closed-loop large bowel obstruction. It classically affects elderly, institutionalized, or neuropsychiatric patients with chronic constipation. Radiographs display the pathognomonic coffee-bean sign pointing toward the right upper quadrant. Emergent sigmoidoscopy with rectal tube placement decompresses viable bowel in 80 percent of cases, followed by elective semi-urgent sigmoid resection.",
        say: "Sigmoid volvulus results from twisting of redundant sigmoid colon on its mesentery. Radiographs reveal a coffee-bean sign pointing to the right upper quadrant. Rigid sigmoidoscopy and rectal tube insertion decompress viable bowel, followed by elective sigmoidectomy.",
        vis: {
          kind: "table",
          cols: ["Volvulus type", "Anatomical axis", "Imaging hallmark", "Primary definitive management"],
          rows: [
            ["Sigmoid volvulus", "Twisting around sigmoid mesocolon", "Coffee-bean sign pointing to RUQ", "Endoscopic decompression then elective resection"],
            ["Cecal volvulus", "Incomplete cecal retroperitoneal fixation", "Kidney-bean / comma loop in LUQ", "Immediate ileocecectomy or right hemicolectomy"],
            ["Gastric volvulus", "Organoaxial (59%) vs mesenteroaxial", "Borchardt triad (retching, pain, NG failure)", "Emergency laparotomy & gastropexy"]
          ]
        }
      }
    ]
  },

  // 17. sur-appendix
  {
    module: "sur-appendix",
    subject: "surgery",
    title: "Acute appendicitis: Alvarado scoring, appendiceal neoplasms, and laparoscopic appendectomy",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "World Society of Emergency Surgery Guidelines"],
    steps: [
      {
        tx: "Acute **appendicitis** is initiated by luminal obstruction of the vermiform appendix, primarily by a fecalith in adults or lymphoid hyperplasia in children. Ongoing mucosal secretion produces luminal distension, bacterial proliferation, venous engorgement, and ischemic gangrene. Visceral periumbilical pain mediated by T10 sympathetic fibers shifts after 12 to 24 hours to somatic right lower quadrant pain at McBurney point when the inflamed parietal peritoneum is irritated.",
        say: "Acute appendicitis begins with appendiceal luminal obstruction by a fecalith or lymphoid tissue. Luminal distension leads to ischemia and bacterial invasion. Pain shifts from visceral periumbilical discomfort to localized right lower quadrant pain at McBurney point.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "a1", label: "Appendiceal luminal obstruction by fecalith" },
            { id: "a2", label: "Intraluminal pressure exceeds capillary perfusion" },
            { id: "a3", label: "Bacterial invasion & transmural inflammation" },
            { id: "a4", label: "Parietal peritoneal irritation (McBurney tenderness)" },
            { id: "a5", label: "Ischemic perforation with abscess or generalized peritonitis" }
          ],
          edges: [
            ["a1", "a2"],
            ["a2", "a3"],
            ["a3", "a4"],
            ["a4", "a5"]
          ]
        }
      },
      {
        tx: "The **Alvarado** score stratifies suspected appendicitis using eight clinical parameters (MANTRELS: Migration of pain, Anorexia, Nausea, Tenderness in RLQ, Rebound tenderness, Elevated temperature, Leukocytosis, and Shift to the left). A score of 7 or greater indicates high probability for surgery. Contrast-enhanced CT scan exhibits a sensitivity exceeding 95 percent, demonstrating an appendiceal diameter greater than 6 mm, circumferential wall thickening, and periappendiceal fat stranding.",
        say: "The Alvarado score evaluates migration of pain, anorexia, nausea, RLQ tenderness, rebound, fever, leukocytosis, and left shift. A score of seven or higher warrants surgical intervention. CT confirms appendicitis with diameter over six millimeters and fat stranding.",
        vis: {
          kind: "table",
          cols: ["Alvarado parameter (MANTRELS)", "Clinical feature", "Assigned score value"],
          rows: [
            ["Migration of pain", "Periumbilical to right lower quadrant", "1 point"],
            ["Anorexia", "Loss of appetite", "1 point"],
            ["Nausea or vomiting", "Gastrointestinal upset", "1 point"],
            ["Tenderness in RLQ", "Maximal point tenderness at McBurney", "2 points (double weight)"],
            ["Rebound tenderness", "Peritoneal irritation in RLQ", "1 point"],
            ["Elevated temperature", "Oral temperature >= 37.3 C (99.1 F)", "1 point"],
            ["Leukocytosis", "White blood cells > 10,000 / uL", "2 points (double weight)"],
            ["Shift to the left", "Neutrophils exceeding 75 percent", "1 point"]
          ]
        }
      },
      {
        tx: "Laparoscopic **appendectomy** is the gold standard surgical intervention for acute appendicitis, offering lower surgical site infection rates, decreased postoperative pain, and faster recovery compared to open laparotomy. Three-port technique establishes pneumoperitoneum. The mesoappendix containing the appendicular artery (a branch of the ileocolic artery) is divided with bipolar energy, harmonic scalpel, or clips. The appendiceal base is securely ligated with Endoloops or an endostapler flush with the cecum.",
        say: "Laparoscopic appendectomy is the gold standard for acute appendicitis. Three ports are placed, the mesoappendix containing the appendicular artery is divided, and the base is ligated with endoloops or stapled flush with the cecal wall.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Establish umbilical pneumoperitoneum & port placement" },
            { id: "p2", label: "Retract cecum cephalad to expose retrocecal appendix" },
            { id: "p3", label: "Skeletonize and divide mesoappendix containing artery" },
            { id: "p4", label: "Ligate appendiceal base flush with cecum with Endoloop" },
            { id: "p5", label: "Extract specimen in retrieval bag to avoid wound infection" }
          ],
          edges: [
            ["p1", "p2"],
            ["p2", "p3"],
            ["p3", "p4"],
            ["p4", "p5"]
          ]
        }
      },
      {
        tx: "Appendiceal **neoplasms** are discovered in approximately 1 percent of appendectomy specimens. Neuroendocrine tumors (carcinoids) are the most common, classically located at the appendiceal tip. Simple appendectomy is curative for carcinoids under 1 cm. Right hemicolectomy is mandatory for carcinoids exceeding 2 cm, tumors involving the appendiceal base, or high-grade neuroendocrine carcinomas. Low-grade appendiceal mucinous neoplasms (LAMN) require meticulous atraumatic excision to prevent pseudomyxoma peritonei.",
        say: "Appendiceal neuroendocrine carcinoids under one centimeter are cured by simple appendectomy. Tumors larger than two centimeters or those involving the base mandate oncologic right hemicolectomy. Mucinous neoplasms require gentle handling to prevent pseudomyxoma peritonei.",
        vis: {
          kind: "table",
          cols: ["Appendiceal tumor", "Size and location criteria", "Definitive surgical therapy"],
          rows: [
            ["Neuroendocrine (carcinoid)", "Under 1.0 cm at the tip or body", "Appendectomy alone is curative"],
            ["Neuroendocrine (carcinoid)", "Greater than 2.0 cm or base involvement", "Oncologic right hemicolectomy"],
            ["Adenocarcinoma", "Any invasive appendiceal adenocarcinoma", "Formal oncologic right hemicolectomy"],
            ["Mucinous neoplasm (LAMN)", "Mucocele without peritoneal rupture", "Appendectomy with clear margin; avoid rupture"]
          ]
        }
      }
    ]
  },

  // 18. sur-colorectal-cancer
  {
    module: "sur-colorectal-cancer",
    subject: "surgery",
    title: "Colorectal cancer: staging, total mesorectal excision, genetic syndromes, and multimodality therapy",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "NCCN Colorectal Cancer Guidelines"],
    steps: [
      {
        tx: "Colorectal cancer (CRC) evolves primarily through the adenoma-carcinoma **sequence** driven by sequential genomic mutations: APC loss of function (chromosome 5q), activating KRAS mutations, DCC loss (18q), and p53 tumor suppressor inactivation (17p). Hereditary non-polyposis colorectal cancer (Lynch syndrome) arises from germline DNA mismatch repair gene defects (MLH1, MSH2, MSH6, PMS2) leading to microsatellite instability (MSI-high) and predominantly right-sided colon cancers.",
        say: "Colorectal carcinoma arises through the adenoma-carcinoma sequence involving APC, KRAS, and p53 mutations. Lynch syndrome results from DNA mismatch repair defects with microsatellite instability, producing predominantly right-sided colon cancers.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "c1", label: "Normal colonic mucosa with germline APC loss" },
            { id: "c2", label: "Hyperproliferative epithelium & early adenoma (K-ras)" },
            { id: "c3", label: "Intermediate adenoma with loss of 18q DCC" },
            { id: "c4", label: "Invasive carcinoma through p53 mutation & 17p loss" },
            { id: "c5", label: "Metastatic dissemination to regional nodes & liver" }
          ],
          edges: [
            ["c1", "c2"],
            ["c2", "c3"],
            ["c3", "c4"],
            ["c4", "c5"]
          ]
        }
      },
      {
        tx: "Surgical resection of colon cancer demands anatomical en bloc **hemicolectomy** with high vascular ligation of the feeding mesenteric vessels to ensure comprehensive lymphadenectomy. The American College of Surgeons mandates harvesting a minimum of 12 regional lymph nodes for accurate pathological nodal staging. Right hemicolectomy ligates the ileocolic and right colic vessels; left hemicolectomy ligates the left colic branch; sigmoid colectomy ligates the inferior mesenteric artery.",
        say: "Oncologic colon resection requires anatomical colectomy with high vascular ligation of feeding vessels. A minimum of 12 lymph nodes must be retrieved for accurate staging. Right hemicolectomy ligates the ileocolic vessels; left colectomy ligates the inferior mesenteric branches.",
        vis: {
          kind: "table",
          cols: ["Tumor anatomical site", "Standard surgical procedure", "Vascular pedicles divided"],
          rows: [
            ["Cecum & ascending colon", "Right hemicolectomy", "Ileocolic, right colic, right branch of middle colic"],
            ["Hepatic flexure & transverse", "Extended right hemicolectomy", "Ileocolic, right colic, middle colic at origin"],
            ["Descending colon", "Left hemicolectomy", "Left colic artery, first sigmoid branches"],
            ["Sigmoid colon", "Sigmoid colectomy", "Inferior mesenteric artery or sigmoid branches"]
          ]
        }
      },
      {
        tx: "Rectal cancer surgical management is dictated by the principle of total **mesorectal** excision (TME). TME involves sharp dissection along the embryological holy plane between the visceral mesorectal fascia and the parietal presacral fascia, preserving pelvic autonomic nerves (hypogastric and splanchnic). Achieving an intact mesorectal envelope with negative circumferential resection margins (CRM > 1 mm) reduces local recurrence from 30 percent down to under 5 percent.",
        say: "Total mesorectal excision is the gold standard for rectal cancer surgery. Sharp dissection in the holy plane between visceral and parietal fascia yields an intact mesorectal envelope while sparing autonomic pelvic nerves and keeping circumferential margins clear.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Identification of the avascular holy plane" },
            { id: "t2", label: "Sharp dissection between visceral & parietal presacral fascia" },
            { id: "t3", label: "Preservation of superior hypogastric & pelvic splanchnic nerves" },
            { id: "t4", label: "Complete excision of mesorectum 5 cm distal to tumor" },
            { id: "t5", label: "Confirm intact mesorectal fascia with CRM > 1 mm" }
          ],
          edges: [
            ["t1", "t2"],
            ["t2", "t3"],
            ["t3", "t4"],
            ["t4", "t5"]
          ]
        }
      },
      {
        tx: "Locally advanced rectal cancer (cT3-T4 or node-positive) receives neoadjuvant **chemoradiation** or total neoadjuvant therapy (TNT) prior to surgical resection. Tumors located in the upper and middle rectum are treated with low anterior resection (LAR) with colorectal or coloanal anastomosis. For distal tumors directly invading the levator ani or anal sphincter complex, abdominoperineal resection (APR) is mandatory, removing the entire rectum, mesorectum, anal sphincter, and perineal skin with permanent colostomy.",
        say: "Locally advanced rectal cancer receives neoadjuvant chemoradiation before surgery. Middle and upper tumors undergo low anterior resection. Tumors invading the external anal sphincter require abdominoperineal resection with permanent end colostomy.",
        vis: {
          kind: "table",
          cols: ["Rectal procedure", "Distal margin from dentate line", "Sphincter preservation status"],
          rows: [
            ["Low anterior resection (LAR)", "Greater than 1 to 2 cm above sphincters", "Sphincter-preserving; coloanal anastomosis"],
            ["Abdominoperineal resection (APR)", "Invades levator ani / external sphincter", "Non-sphincter preserving; permanent end colostomy"],
            ["Hartmann procedure", "Emergency setting / peritonitis / frail patient", "Rectal stump closed, proximal end colostomy"],
            ["Transanal local excision (TEM)", "pT1 low-risk tumors < 3 cm without nodal disease", "Sphincter-preserving; organ-sparing approach"]
          ]
        }
      }
    ]
  },

  // 19. sur-anorectal
  {
    module: "sur-anorectal",
    subject: "surgery",
    title: "Anorectal disorders: hemorrhoids, anal fissure, fistula-in-ano, and Goodsall rule",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "ASCRS Anorectal Disease Guidelines"],
    steps: [
      {
        tx: "Internal **hemorrhoids** represent symptomatic downward displacement and engorgement of the normal vascular anal cushions located in the left lateral, right anterior, and right posterior positions. They are classified into four Goligher grades. Grade I bleeds without prolapse; Grade II prolapses with spontaneous reduction; Grade III requires manual digital reduction; Grade IV is permanently prolapsed and irreducible. External hemorrhoids arise distal to the dentate line covered by sensitive anoderm.",
        say: "Internal hemorrhoids involve downward displacement of anal vascular cushions at 3, 7, and 11 o'clock positions. Goligher grades range from grade one with bleeding alone to grade four with permanent irreducible prolapse.",
        vis: {
          kind: "table",
          cols: ["Goligher grade", "Clinical prolapse characteristics", "First-line management"],
          rows: [
            ["Grade I", "Bleeding without prolapse", "Dietary fiber, fluid optimization"],
            ["Grade II", "Prolapses during defecation; spontaneous reduction", "Rubber band ligation / sclerotherapy"],
            ["Grade III", "Prolapses; requires manual digital reduction", "Rubber band ligation or excisional hemorrhoidectomy"],
            ["Grade IV", "Permanently prolapsed; irreducible / strangulated", "Formal excisional hemorrhoidectomy (Milligan-Morgan)"]
          ]
        }
      },
      {
        tx: "Anal **fissure** is a painful longitudinal tear in the distal squamous anoderm extending from the dentate line to the anal verge, over 90 percent located in the posterior midline where tissue ischemia is maximal. Chronic fissures exhibit a classic triad: an indurated ulcer with exposed internal sphincter fibers, a hypertrophied anal papilla proximally, and an external sentinel skin tag. First-line therapy utilizes topical calcium channel blockers or nitrates; refractory fissures require lateral internal sphincterotomy.",
        say: "Anal fissures are tears in the distal anoderm, most commonly in the ischemic posterior midline. Chronic fissures feature an ulcer with exposed muscle, hypertrophied papilla, and sentinel tag. Refractory fissures undergo lateral internal sphincterotomy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "f1", label: "Passage of hard stool tears posterior anoderm" },
            { id: "f2", label: "Severe tearing pain triggers internal sphincter spasm" },
            { id: "f3", label: "Hypertonicity compromises microvascular posterior perfusion" },
            { id: "f4", label: "Chronic non-healing ulcer with sentinel tag formation" },
            { id: "f5", label: "Topical diltiazem or partial lateral internal sphincterotomy" }
          ],
          edges: [
            ["f1", "f2"],
            ["f2", "f3"],
            ["f3", "f4"],
            ["f4", "f5"]
          ]
        }
      },
      {
        tx: "Anorectal **abscess** originates from bacterial infection of the cryptoglandular anal glands situated at the dentate line within the intersphincteric space. Perianal abscess is the most common subtype, presenting with acute throbbing rectal pain and fluctuance. All anorectal abscesses mandate prompt surgical incision and drainage without awaiting antibiotic trial. Up to 50 percent of patients subsequently develop a chronic fistula-in-ano connecting the infected crypt to external perineal skin.",
        say: "Anorectal abscesses arise from infected anal crypt glands in the intersphincteric space. Prompt surgical drainage is mandatory. Approximately half of drained abscesses progress to a persistent fistula-in-ano.",
        vis: {
          kind: "table",
          cols: ["Abscess space", "Anatomical boundaries", "Surgical drainage approach"],
          rows: [
            ["Perianal", "Subcutaneous tissues adjacent to anal verge", "Cruciate skin incision close to anal verge"],
            ["Ischiorectal", "Ischioanal fossa beneath levator ani", "Wide drainage through ischiorectal fossa skin"],
            ["Intersphincteric", "Between internal and external sphincters", "Internal transanal sphincterotomy drainage"],
            ["Supralevator", "Above levator ani, below pelvic peritoneum", "Transrectal or transischiorectal drainage"]
          ]
        }
      },
      {
        tx: "Fistula-in-ano management is governed by the **Goodsall** rule, which predicts the course of the primary internal opening based on external opening location. An external opening anterior to a transverse anal line tracks radially in a direct line into the anal canal. An external opening posterior to the transverse line follows a curved tract entering the posterior midline crypt. Park classification stratifies fistulas into intersphincteric, transsphincteric, suprasphincteric, and extrasphincteric.",
        say: "Goodsall rule predicts fistula tracts: anterior external openings track radially, while posterior openings follow a curved path to the posterior midline. Park classification categorizes fistulas by sphincter relation: intersphincteric, transsphincteric, suprasphincteric, and extrasphincteric.",
        vis: {
          kind: "table",
          cols: ["External opening location", "Predicted internal tract course (Goodsall rule)", "Surgical modality"],
          rows: [
            ["Anterior (< 3 cm from verge)", "Direct radial tract to adjacent crypt", "Fistulotomy (if low sphincter involvement)"],
            ["Posterior (any distance)", "Curved tract to posterior midline crypt at 6 o'clock", "Seton placement / LIFT procedure"],
            ["Anterior (> 3 cm from verge)", "Exception: curves to posterior midline crypt", "Non-cutting draining seton or LIFT"],
            ["High transsphincteric (> 30% muscle)", "Traverses significant external sphincter", "Ligation of intersphincteric fistula tract (LIFT)"]
          ]
        }
      }
    ]
  },

  // 20. sur-peritoneum
  {
    module: "sur-peritoneum",
    subject: "surgery",
    title: "Acute peritonitis, damage control laparotomy, temporary abdominal closure, and abdominal compartment syndrome",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "World Society of the Abdominal Compartment Syndrome"],
    steps: [
      {
        tx: "Acute **peritonitis** is classified into primary, secondary, and tertiary forms. Primary peritonitis (spontaneous bacterial peritonitis, SBP) occurs in cirrhotic ascites without an intra-abdominal source, characterized by monomicrobial infection (E. coli, Klebsiella) and managed with intravenous antibiotics. Secondary peritonitis arises from visceral perforation, ischemia, or anastomotic disruption, featuring polymicrobial enteric flora with purulent or feculent exudate that demands emergency operative source control.",
        say: "Primary peritonitis is monomicrobial infection of cirrhotic ascites treated medically with antibiotics. Secondary peritonitis results from visceral perforation or anastomotic breakdown, featuring polymicrobial contamination requiring emergency operative source control.",
        vis: {
          kind: "table",
          cols: ["Peritonitis type", "Underlying pathophysiology", "Microbiology & primary therapy"],
          rows: [
            ["Primary (SBP)", "Translocation into cirrhotic ascites without hole", "Monomicrobial (E. coli); cephalosporin therapy"],
            ["Secondary peritonitis", "Direct visceral perforation (perforated ulcer, colon)", "Polymicrobial (aerobes + anaerobes); emergency surgery"],
            ["Tertiary peritonitis", "Persistent or recurrent peritonitis post-op", "Resistant hospital flora (Enterococcus, Candida)"],
            ["Chemical peritonitis", "Sterile gastric acid or bile leakage", "Non-bacterial initially; rapidly superinfected"]
          ]
        }
      },
      {
        tx: "Damage control **surgery** (DCS) prioritizes rapid abbreviation of initial laparotomy in severely injured patients manifesting the lethal trauma triad: hypothermia (under 35 C), severe metabolic acidosis (pH under 7.2, base deficit > 8), and coagulopathy. Phase 1 focuses exclusively on rapid hemorrhage arrest via packing or shunting and contamination control via staple closure without anastomosis. The abdomen is left open with temporary vacuum closure for ICU physiologic restoration.",
        say: "Damage control laparotomy stops operations early in patients exhibiting the lethal triad of hypothermia, acidosis, and coagulopathy. Phase one arrests hemorrhage and controls contamination. The abdomen is packed and left open for ICU resuscitation.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "d1", label: "Severe trauma with lethal triad (hypothermia, acidosis, coagulopathy)" },
            { id: "d2", label: "Phase 1: Rapid laparotomy for packing & contamination control" },
            { id: "d3", label: "Temporary negative-pressure abdominal dressing (ABThera)" },
            { id: "d4", label: "Phase 2: ICU resuscitation, warming, & correction of coagulopathy" },
            { id: "d5", label: "Phase 3: Planned re-exploration, pack removal, & reconstruction" }
          ],
          edges: [
            ["d1", "d2"],
            ["d2", "d3"],
            ["d3", "d4"],
            ["d4", "d5"]
          ]
        }
      },
      {
        tx: "Intra-abdominal **hypertension** (IAH) is defined as sustained intra-abdominal pressure (IAP) of 12 mmHg or greater, monitored via transvesical urinary bladder catheter manometry. Abdominal compartment syndrome (ACS) occurs when sustained IAP exceeds 20 mmHg associated with new-onset organ dysfunction (oliguria, decreased cardiac output, elevated peak airway pressures). Medical decompression utilizes sedation, paralysis, and fluid evacuation; refractory ACS mandates immediate surgical decompression.",
        say: "Intra-abdominal hypertension is an intra-abdominal pressure of 12 millimeters of mercury or higher, measured via bladder catheter. Abdominal compartment syndrome occurs when pressure exceeds 20 with new organ failure. Refractory compartment syndrome requires surgical decompression.",
        vis: {
          kind: "table",
          cols: ["IAP grade", "Bladder pressure (mmHg)", "Clinical intervention"],
          rows: [
            ["Normal resting IAP", "0 to 5 mmHg (up to 7 in ICU)", "Standard monitoring"],
            ["Grade I IAH", "12 to 15 mmHg", "Optimize fluid resuscitation, NG decompression"],
            ["Grade II IAH", "16 to 20 mmHg", "Sedation, neuromuscular blockade, evac intra-abd fluid"],
            ["Grade III/IV (ACS)", "Greater than 20 mmHg with organ failure", "Immediate surgical decompressive laparotomy"]
          ]
        }
      },
      {
        tx: "Temporary **abdominal** closure (TAC) techniques protect visceral contents, remove peritoneal third-space fluid, and preserve fascial integrity to facilitate delayed primary fascial closure. Negative pressure wound therapy (NPWT) using dedicated commercial vacuum packs prevents lateral fascial retraction. Planned re-exploration is conducted at 48 to 72 hours following hemodynamic and metabolic stabilization, aiming for tension-free primary closure or component separation.",
        say: "Temporary abdominal closure protects viscera and collects peritoneal fluid following damage control surgery. Negative-pressure dressings prevent fascial retraction. Re-exploration occurs at 48 hours for definitive abdominal wall closure.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Open abdomen following damage control laparotomy" },
            { id: "t2", label: "Application of visceral non-adherent fenestrated silicone drape" },
            { id: "t3", label: "Continuous negative pressure (125 mmHg) fluid aspiration" },
            { id: "t4", label: "ICU fluid normalization & reduction of visceral bowel edema" },
            { id: "t5", label: "Sequential fascial re-approximation & delayed primary closure" }
          ],
          edges: [
            ["t1", "t2"],
            ["t2", "t3"],
            ["t3", "t4"],
            ["t4", "t5"]
          ]
        }
      }
    ]
  }
];
