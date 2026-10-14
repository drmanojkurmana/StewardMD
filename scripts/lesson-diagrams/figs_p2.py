from reg import fig, reuse
from lib import *

ST_A = {"fill": "#FFF1CC", "stroke": AMBER}
ST_R = {"fill": "#FBE3E0", "stroke": RED}
ST_B = {"fill": "#DCEAF7", "stroke": "#3E6FA5"}

# ---------------- endocrine ----------------
@fig("phy-adrenal", 0, "Layers of the adrenal gland from outside in: capsule, zona glomerulosa making aldosterone, zona fasciculata making cortisol, zona reticularis making androgens, and the medulla making adrenaline and noradrenaline.",
     "Salt, sugar, sex from outside in: glomerulosa aldosterone, fasciculata cortisol, reticularis androgens, medulla catecholamines.")
def adrenal_layers():
    f = F("x", "Adrenal gland: layers and hormones", "d", 800, 480, "Outer cortex, inner medulla")
    L = [("Capsule", "#F4FAF8", 26, "", ""), ("Zona glomerulosa", "#BFE3D6", 50, "Aldosterone (mineralocorticoid)", "Controlled by angiotensin II and K+"), ("Zona fasciculata", "#F5DDA6", 100, "Cortisol (glucocorticoid)", "Controlled by ACTH; widest layer"), ("Zona reticularis", "#F1C6C0", 60, "DHEA, androstenedione (androgens)", "Controlled by ACTH"), ("Medulla", "#C9D8EC", 80, "Adrenaline and noradrenaline", "Chromaffin cells, sympathetic preganglionic ACh")]
    y = 90
    for name, c, h, hor, ctl in L:
        f.rect(60, y, 280, h, c, INK, 1.6, 0); f.text(200, y + h / 2 + 5, name, 13.5, 700, INK, "middle")
        if hor: f.text(370, y + h / 2 - 2, hor, 13, 700, TEAL); f.text(370, y + h / 2 + 16, ctl, 11.5, 400, GREY)
        y += h
    f.text(400, 440, "Mnemonic from outside in: Salt, Sugar, Sex (GFR). The deeper, the sweeter.", 12.5, 600, INK, "middle")
    return f

@fig("phy-adrenal", 1, "Flow diagram of the renin angiotensin aldosterone system: low renal perfusion or low sodium at the macula densa or sympathetic activity releases renin, which converts angiotensinogen to angiotensin I, ACE converts it to angiotensin II, which constricts vessels and drives aldosterone, retaining sodium and water.",
     "Renin, ACE, AT1: angiotensin II constricts vessels and releases aldosterone, which keeps sodium and water and wastes potassium.")
def raas():
    return graph("x", "Renin-angiotensin-aldosterone system", "d", [[("a", "Low renal perfusion, low Na+ at macula densa,\nsympathetic beta-1 drive")], [("b", "Renin from juxtaglomerular cells")], [("c", "Angiotensinogen (liver) to angiotensin I")], [("d", "ACE (lung endothelium) to angiotensin II")], [("e", "Vasoconstriction (AT1), ADH, thirst"), ("f", "Aldosterone (zona glomerulosa)")], [None, ("g", "Principal cells: Na+ and water retained,\nK+ and H+ excreted")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("d", "f"), ("f", "g")], "Result: blood volume and blood pressure rise", cw=370, rh=48, gap=18, top=90, nodestyle={"b": ST_A, "f": ST_A},
                 notes=["ACE inhibitors and ARBs block this pathway; spironolactone blocks the aldosterone receptor."])
reuse("phy-bp-regulation", 3, "phy-raas", "Flow diagram of the renin angiotensin aldosterone system: low renal perfusion or low sodium at the macula densa or sympathetic activity releases renin, which converts angiotensinogen to angiotensin I, ACE converts it to angiotensin II, which constricts vessels and drives aldosterone, retaining sodium and water.",
      "Renin, ACE, AT1: angiotensin II constricts vessels and releases aldosterone, which keeps sodium and water.")

@fig("phy-adrenal", 2, "Hypothalamic pituitary adrenal axis: stress releases CRH from the hypothalamus, which releases ACTH from the anterior pituitary, which stimulates cortisol from the zona fasciculata; cortisol feeds back negatively on both CRH and ACTH.",
     "Stress to CRH to ACTH to cortisol, with cortisol shutting off its own drive; steroid therapy suppresses the axis.")
def hpa_axis():
    return graph("x", "Hypothalamic-pituitary-adrenal axis", "d", [[("s", "Stress, circadian rhythm (peak early morning)")], [("a", "Hypothalamus: CRH")], [("b", "Anterior pituitary: ACTH")], [("c", "Adrenal zona fasciculata: cortisol")], [("d", "Glucose up, immune response down, protein breakdown")]],
                 [("s", "a"), ("a", "b"), ("b", "c"), ("c", "d")], "Cortisol feeds back negatively on the hypothalamus and the pituitary", cw=400, rh=48, gap=26, top=90, nodestyle={"c": ST_A},
                 notes=["Long steroid courses suppress the axis: withdraw slowly to avoid adrenal crisis."])

@fig("phy-adrenal", 3, "Catecholamine synthesis in order: tyrosine to L-DOPA by tyrosine hydroxylase, the rate limiting step, then to dopamine, noradrenaline, and adrenaline by PNMT, which is induced by cortisol.",
     "Tyrosine hydroxylase is rate limiting; PNMT needs cortisol, so adrenaline is made mainly in the adrenal medulla.")
def catecholamine_synthesis():
    return pathways("x", "Catecholamine synthesis", "d", ["Substrate", "Enzyme", "Product"],
        [("Tyrosine", "Tyrosine hydroxylase (rate limiting)", "L-DOPA"), ("L-DOPA", "DOPA decarboxylase", "Dopamine"), ("Dopamine", "Dopamine beta-hydroxylase", "Noradrenaline"), ("Noradrenaline", "PNMT (induced by cortisol)", "Adrenaline")],
        "Phaeochromocytoma releases these in bursts: headache, sweating, palpitations", widths=[170, 290, 170], rh=48, gap=12, top=100)

@fig("phy-calcium", 0, "Feedback loop of calcium control: low plasma calcium raises PTH, which increases bone resorption, renal calcium reabsorption, phosphate excretion and activation of vitamin D to calcitriol, which increases gut calcium absorption; high calcium switches PTH off and calcitonin opposes.",
     "PTH and calcitriol raise calcium; calcitonin lowers it weakly. PTH wastes phosphate.")
def calcium_loop():
    return graph("x", "Plasma calcium control", "d", [[("a", "Low ionised calcium")], [("b", "Parathyroid chief cells: PTH released")], [("c", "Bone: resorption"), ("d", "Kidney: Ca2+ reabsorbed,\nphosphate lost, 1-alpha-hydroxylase"), ("e", "Gut (via calcitriol):\nCa2+ absorbed")], [("f", "Plasma calcium rises")]],
                 [("a", "b"), ("b", "c"), ("b", "d"), ("b", "e", "", "dash"), ("c", "f"), ("d", "f"), ("e", "f")], "High calcium switches PTH off (calcium-sensing receptor); calcitonin from C cells lowers calcium", cw=240, rh=60, gap=36, top=96, nodestyle={"b": ST_A},
                 notes=["PTH raises calcium and lowers phosphate; vitamin D raises both."])

@fig("phy-calcium", 1, "RANKL pathway of bone remodelling: osteoblasts express RANKL that binds RANK on osteoclast precursors, driving osteoclast formation and resorption; osteoprotegerin is a decoy receptor that blocks RANKL; osteoblasts then lay down new bone.",
     "Osteoblasts control osteoclasts through RANKL; OPG blocks it; denosumab is an antibody against RANKL.")
def rankl():
    return graph("x", "Coupling of bone formation and resorption", "d", [[("a", "Osteoblast: RANKL"), ("o", "Osteoprotegerin (OPG)\ndecoy receptor")], [("b", "RANK on osteoclast precursor")], [("c", "Mature osteoclast: resorbs bone")], [("d", "Osteoblasts fill the pit with new bone")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Parathyroid hormone and oestrogen deficiency raise RANKL relative to OPG", cw=250, rh=52, gap=30, top=96, nodestyle={"o": ST_B},
                 notes=["Denosumab blocks RANKL; oestrogen deficiency drives postmenopausal bone loss."])

@fig("phy-growth", 0, "Growth hormone axis: GHRH raises and somatostatin lowers growth hormone from the anterior pituitary; growth hormone stimulates IGF-1 from the liver, which acts on bone and tissues and feeds back to suppress growth hormone.",
     "GH acts mostly through IGF-1; IGF-1 is the stable screening test for excess or deficiency.")
def gh_axis():
    return graph("x", "Growth hormone axis", "d", [[("a", "Hypothalamus: GHRH (+), somatostatin (-)")], [("b", "Anterior pituitary: growth hormone (pulsatile)")], [("c", "Liver: IGF-1"), ("d", "Direct: fat breakdown,\nglucose up")], [("e", "Bone growth plates, muscle")]],
                 [("a", "b"), ("b", "c"), ("b", "d"), ("c", "e")], "IGF-1 feeds back to inhibit GH release", cw=300, rh=52, gap=34, top=96, nodestyle={"c": ST_A},
                 notes=["Excess: gigantism in children, acromegaly in adults. Deficiency: short stature."])

@fig("phy-growth", 1, "Hypothalamic pituitary gonadal axis at puberty: pulsatile GnRH from the hypothalamus drives LH and FSH, which act on the gonads to make sex steroids and gametes, which cause secondary sexual characteristics; feedback is negative before puberty and set to allow cyclic surges in females.",
     "Puberty starts when GnRH pulses wake up; the first sign is breast budding in girls and testicular enlargement in boys.")
def puberty_axis():
    return graph("x", "Puberty: the gonadal axis wakes up", "d", [[("a", "Hypothalamus: GnRH, released in pulses")], [("b", "Anterior pituitary: LH and FSH")], [("c", "Gonads: oestradiol or testosterone, gametes")], [("d", "Secondary sexual characteristics, growth spurt")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Sex steroids feed back on the hypothalamus and pituitary", cw=400, rh=48, gap=28, top=96, nodestyle={"a": ST_A},
                 notes=["First sign: breast budding (thelarche) in girls, testicular enlargement in boys.", "Precocious puberty: central (early GnRH) treated with GnRH analogues."])

@fig("phy-hormone-pituitary", 2, "Table of hormone receptor classes: peptide hormones bind surface G protein receptors using cAMP or IP3 and calcium, insulin and IGF-1 use tyrosine kinase, growth hormone and prolactin use JAK STAT, steroid and thyroid hormones use nuclear receptors that change gene transcription.",
     "Peptides use surface receptors and second messengers; steroids and thyroid hormone enter the cell and act on DNA.")
def receptor_classes():
    return pathways("x", "How hormones signal", "d", ["Receptor type", "Signal", "Examples"],
        [("G protein, Gs", "cAMP", "ACTH, TSH, LH, FSH, glucagon, PTH, ADH (V2)"), ("G protein, Gq", "IP3, DAG, calcium", "GnRH, TRH, oxytocin, ADH (V1), angiotensin II"), ("Tyrosine kinase", "Phosphorylation cascade", "Insulin, IGF-1"),
         ("JAK-STAT", "Cytokine-type receptor", "Growth hormone, prolactin"), ("Nuclear receptor (intracellular)", "Gene transcription", "Cortisol, thyroid hormone, sex steroids, vitamin D")],
        widths=[200, 180, 300], rh=48, gap=10, top=100)

@fig("phy-hormone-pituitary", 4, "Control of prolactin: hypothalamic dopamine tonically inhibits lactotrophs through D2 receptors; TRH, oestrogen and the suckling reflex stimulate release; prolactin drives milk synthesis and suppresses GnRH.",
     "Prolactin is the only anterior pituitary hormone under dominant inhibition; cutting the stalk raises it.")
def prolactin_control():
    return graph("x", "Control of prolactin", "d", [[("a", "Hypothalamus: dopamine (inhibits, tonic)"), ("b", "TRH, oestrogen, suckling\n(stimulate)")], [("c", "Anterior pituitary lactotrophs: prolactin")], [("d", "Breast: milk synthesis"), ("e", "Hypothalamus: GnRH suppressed")]],
                 [("a", "c"), ("b", "c"), ("c", "d"), ("c", "e")], "Dopamine agonists (cabergoline) lower prolactin", cw=300, rh=56, gap=40, top=96, nodestyle={"a": ST_R},
                 notes=["Stalk damage or dopamine antagonists raise prolactin: galactorrhoea, hypogonadism."])

@fig("phy-hormone-pituitary", 5, "Table of hypothalamic pituitary axes: GHRH to growth hormone to IGF-1, TRH to TSH to thyroid hormones, CRH to ACTH to cortisol, GnRH to LH and FSH to sex steroids, dopamine inhibiting prolactin.",
     "Each axis is hypothalamic releasing hormone, pituitary hormone, then a target gland hormone with negative feedback.")
def pituitary_axes():
    return pathways("x", "Hypothalamic-pituitary axes", "d", ["Hypothalamus", "Anterior pituitary", "Target and product"],
        [("GHRH (+), somatostatin (-)", "Growth hormone", "Liver: IGF-1"), ("TRH", "TSH", "Thyroid: T4, T3"), ("CRH", "ACTH", "Adrenal cortex: cortisol"), ("GnRH", "LH and FSH", "Gonads: sex steroids, gametes"), ("Dopamine (-)", "Prolactin", "Breast: milk")],
        "Posterior pituitary stores ADH and oxytocin made in the supraoptic and paraventricular nuclei", widths=[220, 190, 250], rh=44, gap=10, top=100)

@fig("phy-thyroid", 0, "Steps of thyroid hormone synthesis: iodide trapping by the sodium iodide symporter, oxidation and organification by thyroid peroxidase onto thyroglobulin, coupling of MIT and DIT into T3 and T4 in colloid, then endocytosis and proteolysis releasing T4 and T3.",
     "Trap, oxidise, organify, couple, store, then endocytose and release; thyroid peroxidase is the target of carbimazole.")
def thyroid_synthesis():
    return graph("x", "Thyroid hormone synthesis in the follicle", "d", [[("a", "Iodide trapped by NIS (Na+/I- symporter)")], [("b", "Thyroid peroxidase (TPO): oxidises iodide,\niodinates tyrosines on thyroglobulin (MIT, DIT)")], [("c", "Coupling: MIT + DIT = T3; DIT + DIT = T4;\nstored in colloid")], [("d", "TSH: endocytosis, proteolysis of thyroglobulin")], [("e", "T4 (prohormone) and T3 (active) released")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")], "Carbimazole and propylthiouracil block TPO; excess iodide transiently blocks release (Wolff-Chaikoff)", cw=440, rh=56, gap=22, top=92, nodestyle={"b": ST_A})

@fig("phy-thyroid", 3, "Table of thyroid function test patterns: primary hypothyroidism high TSH low free T4, subclinical high TSH normal T4, secondary hypothyroidism low or normal TSH low T4, Graves disease low TSH high T4, rare TSH producing adenoma high TSH high T4.",
     "Read TSH first: high TSH with low T4 is primary hypothyroidism; low TSH with high T4 is primary hyperthyroidism.")
def tft_patterns():
    return pathways("x", "Reading thyroid function tests", "d", ["Condition", "TSH", "Free T4"],
        [("Primary hypothyroidism (Hashimoto)", "High", "Low"), ("Subclinical hypothyroidism", "High", "Normal"), ("Secondary (pituitary) hypothyroidism", "Low or normal", "Low"), ("Graves disease, toxic nodule", "Low", "High"), ("TSH-secreting adenoma (rare)", "High", "High")],
        "TSH is the best first test because the pituitary amplifies small changes in T4", widths=[320, 150, 150], rh=44, gap=10, top=100)

# ---------------- autonomic and neuro ----------------
@fig("phy-autonomic-nervous-system", 2, "Three neuron sympathetic pathway to the eye: first order from posterior hypothalamus to the ciliospinal centre at C8 to T2, second order through the sympathetic chain over the lung apex to the superior cervical ganglion, third order along the carotid to the pupil dilator and tarsal muscle; interruption gives Horner syndrome.",
     "Horner syndrome: ptosis, miosis, anhidrosis. Location of the lesion decides whether the face sweats.")
def horner():
    return graph("x", "Sympathetic pathway to the eye and Horner syndrome", "d", [[("a", "1st order: hypothalamus down the brainstem\nto the ciliospinal centre (C8 to T2)")], [("b", "2nd order: sympathetic chain over the lung apex\nto the superior cervical ganglion")], [("c", "3rd order: along the internal carotid\nto dilator pupillae, tarsal muscle, sweat glands")], [("d", "Horner syndrome: ptosis, miosis, anhidrosis")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Causes by site: lateral medullary stroke (1st), Pancoast tumour (2nd), carotid dissection (3rd)", cw=440, rh=56, gap=30, top=92, nodestyle={"d": ST_R})

@fig("phy-autonomic", 0, "Two column comparison of sympathetic and parasympathetic outflow: sympathetic from T1 to L2 with short preganglionic fibres and long noradrenergic postganglionic fibres, parasympathetic from cranial nerves III VII IX X and S2 to S4 with long preganglionic fibres and short cholinergic postganglionic fibres.",
     "Sympathetic: thoracolumbar, short pre, long post, noradrenaline. Parasympathetic: craniosacral, long pre, short post, acetylcholine.")
def autonomic_outflow():
    return graph("x", "Autonomic outflow", "d", [[("a", "Sympathetic: T1 to L2 (thoracolumbar)"), ("b", "Parasympathetic: CN III, VII, IX, X and S2 to S4")], [("c", "Short preganglionic (ACh, nicotinic)"), ("d", "Long preganglionic (ACh, nicotinic)")], [("e", "Ganglion near the spinal cord"), ("f", "Ganglion near or in the organ")], [("g", "Long postganglionic: noradrenaline\n(ACh for sweat glands)"), ("h", "Short postganglionic:\nACh (muscarinic)")]],
                 [("a", "c"), ("c", "e"), ("e", "g"), ("b", "d"), ("d", "f"), ("f", "h")], "Adrenal medulla is a modified ganglion: preganglionic fibres release ACh directly onto chromaffin cells", cw=350, rh=52, gap=30, top=96, nodestyle={"a": ST_A, "b": ST_B})

@fig("phy-autonomic", 1, "Table of autonomic receptors with G protein pathway and effects: alpha-1 Gq vasoconstriction, alpha-2 Gi, beta-1 Gs raising heart rate, beta-2 Gs relaxing bronchi, M2 Gi slowing the heart, M3 Gq contracting gut and glands, nicotinic ganglionic and muscle channels.",
     "Gq: alpha-1 and M3 (constrict, secrete). Gs: beta-1 and beta-2 (heart, relax). Gi: M2 and alpha-2.")
def autonomic_receptors():
    return pathways("x", "Autonomic receptors", "d", ["Receptor", "G protein", "Main effects"],
        [("Alpha-1", "Gq", "Vasoconstriction, mydriasis, sphincter contraction"), ("Alpha-2", "Gi", "Less noradrenaline release, less insulin"), ("Beta-1", "Gs", "Heart rate, contractility, renin release"), ("Beta-2", "Gs", "Bronchodilation, vasodilation in muscle, uterine relaxation"),
         ("M2 (muscarinic)", "Gi", "Slows the heart"), ("M3 (muscarinic)", "Gq", "Gut and glands, bronchoconstriction, miosis"), ("Nicotinic Nn / Nm", "Ion channel", "Autonomic ganglia / neuromuscular junction")],
        widths=[180, 110, 360], rh=40, gap=8, top=100)

@fig("phy-autonomic", 2, "Baroreceptor reflex loop: raised blood pressure stretches carotid sinus and aortic arch receptors, afferents via IX and X reach the nucleus tractus solitarius, which increases vagal tone and reduces sympathetic outflow, lowering heart rate and vessel tone and so pressure.",
     "Rising pressure fires baroreceptors, which brake the heart through the vagus and relax vessels; standing does the opposite.")
def baroreflex():
    return graph("x", "Baroreceptor reflex", "d", [[("a", "Blood pressure rises")], [("b", "Carotid sinus and aortic arch stretch")], [("c", "Afferents CN IX and X to nucleus tractus solitarius")], [("d", "Vagal tone up, sympathetic outflow down")], [("e", "Heart rate and vessel tone fall")], [("f", "Blood pressure returns toward normal")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f")], "Negative feedback; fires within seconds", cw=420, rh=44, gap=20, top=90, nodestyle={"c": ST_A},
                 notes=["Carotid sinus massage activates it and can slow or break supraventricular tachycardia."])

@fig("phy-autonomic", 3, "Autonomic dysreflexia in spinal injury above T6: a stimulus below the lesion, usually a full bladder or bowel, causes a sympathetic surge with severe hypertension; baroreflex slows the heart but cannot relax vessels below the lesion; treat by sitting up, removing the stimulus and lowering the pressure.",
     "Spinal cord injury at or above T6: noxious stimulus below the lesion leads to severe hypertension; sit up and remove the trigger.")
def dysreflexia():
    return graph("x", "Autonomic dysreflexia", "d", [[("a", "Stimulus below the lesion\n(full bladder, faecal loading, ulcer)")], [("b", "Spinal sympathetic surge below T6:\nvasoconstriction, severe hypertension")], [("c", "Baroreflex: vagal slowing and vasodilation\nabove the lesion only"), ("d", "Headache, flushing above the lesion,\npounding, bradycardia")], [("e", "Treat: sit up, remove trigger (catheter),\nthen rapid-acting antihypertensive")]],
                 [("a", "b"), ("b", "c"), ("b", "d"), ("c", "e"), ("d", "e")], "Lesion at or above T6 only", cw=320, rh=60, gap=32, top=96, nodestyle={"b": ST_R, "e": ST_A})

@fig("phy-blood-groups", 0, "Table of ABO groups with red cell antigen, plasma antibody and which red cells each can receive: A gets A and O, B gets B and O, AB gets all, O gets only O.",
     "O has no antigens (universal red cell donor); AB has no antibodies (universal recipient).")
def abo_table():
    return pathways("x", "ABO blood groups", "d", ["Group", "Red cell antigen", "Plasma antibody", "Can receive red cells from"],
        [("A", "A", "Anti-B", "A, O"), ("B", "B", "Anti-A", "B, O"), ("AB", "A and B", "None", "A, B, AB, O (universal recipient)"), ("O", "None", "Anti-A and anti-B (IgM)", "O only (universal red cell donor)")],
        "Antibodies are natural, formed in infancy; Rh status is matched separately", widths=[90, 150, 190, 230], rh=48, gap=12, top=100)

@fig("phy-blood-groups", 1, "Sequence of haemolytic disease of the newborn: an RhD negative mother is sensitised by fetomaternal bleeding at delivery or a sensitising event, makes anti-D IgG, and in a later RhD positive pregnancy the antibody crosses the placenta causing haemolysis; anti-D immunoglobulin prevents sensitisation.",
     "Anti-D given at 28 weeks and within 72 hours of a sensitising event prevents the mother making her own antibody.")
def hdn():
    return graph("x", "Rhesus haemolytic disease of the newborn", "d", [[("a", "RhD-negative mother, RhD-positive fetus")], [("b", "Fetomaternal bleed (delivery, abortion, trauma):\nmother makes anti-D")], [("c", "Next RhD-positive pregnancy:\nIgG anti-D crosses the placenta")], [("d", "Fetal haemolysis: anaemia, hydrops,\nneonatal jaundice")], [("e", "Prevention: anti-D immunoglobulin at 28 weeks\nand within 72 h of any sensitising event")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Kleihauer test quantifies the fetal cells; MCA Doppler screens for fetal anaemia", cw=440, rh=52, gap=22, top=92, nodestyle={"e": ST_A, "d": ST_R})

@fig("phy-cerebellum-basal-ganglia", 0, "Circuit of the cerebellar cortex: cortex through pontine nuclei sends mossy fibres to granule cells, parallel fibres excite Purkinje cells; climbing fibres from the inferior olive also excite Purkinje cells; Purkinje cells inhibit deep cerebellar nuclei, the only output.",
     "Purkinje cells are the sole cortical output and are inhibitory; mossy fibres carry context, climbing fibres carry errors.")
def cerebellar_circuit():
    return graph("x", "Cerebellar cortex circuit", "d", [[("a", "Mossy fibres (pontine nuclei, spinal cord)"), ("b", "Climbing fibres\n(inferior olive)")], [("c", "Granule cells, then parallel fibres")], [("d", "Purkinje cell: sole cortical output, GABA")], [("e", "Deep cerebellar nuclei (dentate, interposed, fastigial)")], [("f", "Thalamus and red nucleus, then cortex and spinal cord")]],
                 [("a", "c"), ("c", "d"), ("b", "d"), ("d", "e", "inhibits"), ("e", "f")], "Mossy fibres supply context; climbing fibres teach by signalling errors", cw=330, rh=46, gap=26, top=92, nodestyle={"d": ST_A})

reuse("phy-cerebellum-basal-ganglia", 1, "ana-bg-pathways", "Wiring diagram of the basal ganglia. Cortex excites striatum. Direct pathway: striatum D1 inhibits GPi, which frees the thalamus to excite cortex. Indirect pathway: striatum D2 inhibits GPe, which frees the subthalamic nucleus to excite GPi, which inhibits thalamus. Substantia nigra pars compacta dopamine excites D1 cells and inhibits D2 cells.",
      "Direct pathway releases movement; indirect pathway brakes it; dopamine pushes toward movement.")

@fig("phy-cerebellum-basal-ganglia", 2, "Parkinson disease circuit: loss of substantia nigra dopamine weakens the direct pathway and releases the indirect pathway, so globus pallidus internus over-inhibits the thalamus, causing bradykinesia, rigidity and rest tremor.",
     "TRAP: Tremor at rest, Rigidity, Akinesia, Postural instability; the cause is nigral dopamine loss.")
def parkinson_circuit():
    return graph("x", "Parkinson disease: what goes wrong", "d", [[("a", "Substantia nigra pars compacta cells die (Lewy bodies)")], [("b", "Direct pathway weak (less D1 drive)"), ("c", "Indirect pathway strong (D2 not inhibited)")], [("d", "GPi/SNr over-active: thalamus over-inhibited")], [("e", "Less cortical drive: TRAP\nTremor, Rigidity, Akinesia, Postural instability")]],
                 [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d"), ("d", "e")], "Levodopa restores dopamine; long term it causes peak-dose dyskinesia and wearing off", cw=330, rh=56, gap=30, top=96, nodestyle={"a": ST_R, "e": ST_A})

@fig("phy-cerebellum-basal-ganglia", 3, "Table of hyperkinetic movement disorders by lesion: Huntington caudate and putamen with CAG repeat, hemiballismus contralateral subthalamic nucleus, Sydenham chorea after streptococcal infection, Wilson disease copper in basal ganglia, tardive dyskinesia from dopamine blockers.",
     "Hemiballismus: subthalamic nucleus stroke. Huntington: caudate loss and CAG expansion.")
def chorea_causes():
    return pathways("x", "Hyperkinetic movement disorders", "d", ["Condition", "Site or cause", "Feature"],
        [("Huntington disease", "Caudate and putamen; CAG repeat on chromosome 4", "Chorea, dementia, psychiatric change; anticipation"), ("Hemiballismus", "Contralateral subthalamic nucleus (stroke)", "Flinging of the opposite limbs"), ("Sydenham chorea", "Post-streptococcal (rheumatic fever)", "Chorea in a child; self-limiting"),
         ("Wilson disease", "Copper in basal ganglia and liver", "Tremor, Kayser-Fleischer rings; chelation"), ("Tardive dyskinesia", "Long-term dopamine blockers", "Orofacial chewing movements")],
        widths=[170, 270, 250], rh=50, gap=10, top=100)

@fig("phy-digestion-absorption", 0, "Table of digestive secretions by site with enzymes and substrates: salivary amylase and lingual lipase in the mouth, acid pepsin and intrinsic factor in the stomach, pancreatic trypsin amylase and lipase in the duodenum, brush border disaccharidases and peptidases.",
     "Each site digests a different macronutrient; the brush border completes it.")
def digestive_enzymes():
    return pathways("x", "Digestive enzymes by site", "d", ["Site", "Secretion", "Action"],
        [("Mouth", "Salivary amylase, lingual lipase", "Starch to maltose; some fat"), ("Stomach", "HCl, pepsin, intrinsic factor, mucus", "Protein to peptides; B12 binding"), ("Pancreas", "Trypsinogen, chymotrypsinogen, amylase, lipase, colipase", "Protein, starch, fat to small units"),
         ("Brush border", "Lactase, sucrase, maltase, peptidases", "Disaccharides and peptides to absorbable units")],
        widths=[130, 290, 270], rh=52, gap=12, top=100)

@fig("phy-digestion-absorption", 1, "Enterohepatic circulation of bile acids: liver makes bile, gallbladder stores it, cholecystokinin contracts the gallbladder to release it into the duodenum, bile acids form micelles with fat, and about 95 percent is reabsorbed in the terminal ileum and returned to the liver by the portal vein.",
     "Bile acids are recycled: ileal reabsorption returns most of the pool to the liver. Ileal disease causes bile acid malabsorption.")
def enterohepatic():
    return graph("x", "Enterohepatic circulation of bile acids", "d", [[("a", "Liver: bile acids made from cholesterol")], [("b", "Gallbladder: stored, concentrated")], [("c", "CCK contracts it: bile enters duodenum, micelles solubilise fat")], [("d", "Terminal ileum: about 95 percent reabsorbed")], [("e", "Portal vein back to the liver")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "a", "", "dash")], "About 5 percent lost in faeces and replaced by new synthesis", cw=420, rh=44, gap=20, top=90, nodestyle={"d": ST_A})

@fig("phy-female", 0, "Stages of follicle development: primordial, primary, secondary, antral, Graafian follicle, ovulation under the LH surge, corpus luteum making progesterone, and corpus albicans if no pregnancy.",
     "FSH recruits and selects the dominant follicle; the LH surge ovulates; the corpus luteum sustains progesterone for about two weeks.")
def follicle_stages():
    return graph("x", "Follicle to corpus luteum", "d", [[("a", "Primordial"), ("b", "Primary"), ("c", "Secondary")], [("d", "Antral (FSH selects)"), ("e", "Graafian (pre-ovulatory)"), ("f", "Ovulation (LH surge)")], [("g", "Corpus luteum: progesterone"), ("h", "Corpus albicans (if no pregnancy)"), None]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f"), ("f", "g"), ("g", "h")], "Oocytes are arrested in prophase I from birth; meiosis II completes only if fertilised", cw=230, rh=52, gap=40, top=96, nodestyle={"f": ST_A},
                 notes=["If hCG arrives (pregnancy), the corpus luteum persists until the placenta takes over."])

@fig("phy-gas-exchange", 1, "Worked alveolar gas equation at sea level: inspired PO2 150 mmHg minus PaCO2 40 divided by respiratory quotient 0.8 gives alveolar PO2 100, minus arterial PO2 about 90 gives an A-a gradient of about 10 mmHg; widening points to V/Q mismatch, shunt or diffusion defect.",
     "Normal A-a gradient is under about 15 mmHg; hypoventilation lowers PaO2 with a normal gradient.")
def aa_gradient():
    return graph("x", "Alveolar gas equation and the A-a gradient", "d", [[("a", "Inspired PO2 = 0.21 x (760 - 47) = about 150 mmHg")], [("b", "Minus PaCO2 / R = 40 / 0.8 = 50 mmHg")], [("c", "Alveolar PO2 (PAO2) = about 100 mmHg")], [("d", "Minus arterial PO2 (PaO2) about 90 mmHg")], [("e", "A-a gradient about 10 mmHg (normal below about 15, rises with age)")], [("f", "Wide gradient: V/Q mismatch, shunt, diffusion defect.\nNormal gradient, low PaO2: hypoventilation, low FiO2")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f")], "FiO2 0.21, barometric pressure 760, water vapour 47, respiratory quotient 0.8", cw=520, rh=50, gap=16, top=90, nodestyle={"c": ST_A, "f": ST_R})

@fig("phy-haemostasis", 0, "Primary haemostasis: vascular spasm, platelet adhesion by von Willebrand factor binding GPIb to collagen, activation releasing ADP and thromboxane A2, aggregation through GPIIb IIIa and fibrinogen; aspirin blocks thromboxane, clopidogrel blocks the ADP receptor, abciximab blocks GPIIb IIIa.",
     "Adhesion (vWF, GPIb), activation (ADP, TXA2), aggregation (GPIIb/IIIa, fibrinogen); each step has a drug.")
def primary_haemostasis():
    return pathways("x", "Primary haemostasis: the platelet plug", "d", ["Step", "Key molecules", "Drug that blocks"],
        [("Vascular spasm", "Endothelin, thromboxane A2", "None"), ("Adhesion", "vWF bridges collagen to platelet GPIb", "None"), ("Activation", "ADP, thromboxane A2 (from COX)", "Aspirin (COX), clopidogrel (P2Y12)"), ("Aggregation", "Fibrinogen links GPIIb/IIIa", "Abciximab (GPIIb/IIIa)")],
        "Tests: platelet count, bleeding time, platelet function; defects bleed from skin and mucosa", widths=[180, 270, 240], rh=50, gap=12, top=104)

@fig("phy-haemostasis", 1, "Coagulation cascade: intrinsic pathway XII XI IX with VIII and extrinsic pathway tissue factor with VIIa both activate X, which with V converts prothrombin to thrombin, converting fibrinogen to fibrin, cross linked by XIII; PT tests the extrinsic route, APTT the intrinsic, and warfarin lowers II VII IX and X.",
     "PT follows the extrinsic pathway (VII) and warfarin; APTT follows the intrinsic pathway and heparin.")
def coag_cascade():
    return graph("x", "Coagulation cascade", "d", [[("a", "Intrinsic: XII, XI, IX\n(+ VIIIa)  APTT"), ("b", "Extrinsic: tissue factor\n+ VIIa  PT")], [("c", "Factor X activated")], [("d", "Xa + Va: prothrombin (II) to thrombin (IIa)")], [("e", "Fibrinogen to fibrin, cross-linked by XIII")]],
                 [("a", "c"), ("b", "c"), ("c", "d"), ("d", "e")], "Common pathway: X, V, II, I", cw=300, rh=60, gap=34, top=96, nodestyle={"c": ST_A},
                 notes=["Vitamin K-dependent: II, VII, IX, X, protein C and S. Warfarin lowers them; heparin acts via antithrombin."])

@fig("phy-haemostasis", 2, "Fibrinolysis: tissue plasminogen activator converts plasminogen to plasmin, which digests fibrin into fibrin degradation products including D-dimer; PAI-1 and alpha-2 antiplasmin inhibit it, and tranexamic acid blocks plasminogen binding.",
     "D-dimer rises when cross-linked fibrin has been broken down: it flags clot formation and lysis.")
def fibrinolysis():
    return graph("x", "Fibrinolysis", "d", [[("a", "tPA (endothelium) or streptokinase")], [("b", "Plasminogen to plasmin")], [("c", "Cross-linked fibrin digested")], [("d", "Fibrin degradation products, D-dimer")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Inhibitors: PAI-1, alpha-2 antiplasmin; tranexamic acid blocks plasminogen binding to fibrin", cw=360, rh=48, gap=28, top=96, nodestyle={"b": ST_A},
                 notes=["DIC: widespread clotting consumes factors and platelets, so bleeding with a high D-dimer."])

@fig("phy-hearing-vestibular", 3, "Impedance matching of the middle ear: the large tympanic membrane area focuses force on the small oval window, about a 17 fold area gain, the ossicular lever adds about 1.3, giving roughly 22 fold pressure gain that overcomes air to fluid reflection of sound.",
     "Area ratio times lever ratio gives about 22 times pressure gain; without it most sound would reflect from the cochlear fluid.")
def middle_ear_gain():
    return graph("x", "Middle ear: matching air to fluid", "d", [[("a", "Tympanic membrane\n(about 55 mm2)"), ("b", "Ossicular lever\n(malleus longer than incus)"), ("c", "Oval window\n(about 3.2 mm2)")], [("d", "Area ratio about 17"), ("e", "Lever ratio about 1.3"), ("f", "Pressure gain about 22 times")]],
                 [("a", "b"), ("b", "c"), ("a", "d", "", "dash"), ("b", "e", "", "dash"), ("c", "f", "", "dash")], "Conductive hearing loss (wax, otosclerosis) loses this gain, typically about 20 to 30 dB", cw=230, rh=60, gap=40, top=96, nodestyle={"f": ST_A},
                 notes=["Attenuation reflex: stapedius and tensor tympani contract in loud sound."])

@fig("phy-higher-functions", 4, "Table of hemisphere syndromes: dominant left hemisphere aphasia and Gerstmann syndrome with agraphia, acalculia, finger agnosia and left right confusion; non-dominant right hemisphere neglect, anosognosia, prosopagnosia and constructional apraxia.",
     "Left: language and Gerstmann tetrad. Right: spatial neglect, face recognition, awareness of illness.")
def hemisphere_syndromes():
    return pathways("x", "Hemispheric lesions", "d", ["Side", "Syndrome features"],
        [("Dominant (usually left)", "Aphasias, Gerstmann: agraphia, acalculia, finger agnosia, left-right confusion"), ("Non-dominant (usually right)", "Contralateral neglect, anosognosia, prosopagnosia, constructional apraxia, dressing apraxia")],
        widths=[220, 470], rh=60, gap=14, top=100)

@fig("phy-hypoxia-environment", 0, "Table of four hypoxia types: hypoxic with low PaO2 such as altitude, anaemic with normal PaO2 but low oxygen content, stagnant with normal PaO2 and low flow as in shock, histotoxic with normal PaO2 where cells cannot use oxygen as in cyanide poisoning.",
     "Only hypoxic hypoxia has a low PaO2; the other three have normal PaO2, so pulse oximetry can mislead.")
def hypoxia_types():
    return pathways("x", "Four types of hypoxia", "d", ["Type", "PaO2", "Cause"],
        [("Hypoxic", "Low", "Altitude, lung disease, hypoventilation"), ("Anaemic", "Normal", "Low haemoglobin or carbon monoxide: content falls"), ("Stagnant", "Normal", "Low flow: shock, heart failure, local ischaemia"), ("Histotoxic", "Normal", "Cyanide blocks cytochrome oxidase; tissues cannot use O2")],
        "Chemoreceptors sense PaO2, so only hypoxic hypoxia drives breathing", widths=[150, 100, 440], rh=48, gap=12, top=104)

@fig("phy-hypoxia-environment", 1, "Table of high altitude illness: acute mountain sickness with headache and nausea treated by rest and acetazolamide, high altitude cerebral oedema with ataxia and confusion treated by descent and dexamethasone, high altitude pulmonary oedema with dyspnoea and crackles treated by descent and nifedipine.",
     "Descent is definitive for all three; acetazolamide prevents AMS, dexamethasone treats HACE, nifedipine treats HAPE.")
def altitude_illness():
    return pathways("x", "Altitude illness", "d", ["Syndrome", "Features", "Treatment"],
        [("Acute mountain sickness", "Headache, nausea, fatigue above about 2500 m", "Rest, acetazolamide prophylaxis, stop ascent"), ("HACE", "Ataxia, confusion, drowsiness", "Descent, dexamethasone, oxygen"), ("HAPE", "Breathlessness at rest, cough, crackles", "Descent, nifedipine, oxygen")],
        "Staged ascent prevents all three", widths=[170, 260, 260], rh=56, gap=12, top=100)

@fig("phy-male", 0, "Male hypothalamic pituitary gonadal axis: GnRH drives LH and FSH; LH stimulates Leydig cells to make testosterone, FSH acts on Sertoli cells to support spermatogenesis and inhibin B; testosterone feeds back on the hypothalamus and pituitary and inhibin B on FSH.",
     "LH to Leydig to testosterone; FSH to Sertoli to sperm and inhibin B.")
def male_axis():
    return graph("x", "Male reproductive axis", "d", [[("a", "Hypothalamus: GnRH (pulsatile)")], [("b", "Anterior pituitary: LH"), ("c", "Anterior pituitary: FSH")], [("d", "Leydig cells: testosterone"), ("e", "Sertoli cells: spermatogenesis, inhibin B, AMH")]],
                 [("a", "b"), ("a", "c"), ("b", "d"), ("c", "e")], "Testosterone feeds back on GnRH and LH; inhibin B feeds back on FSH", cw=330, rh=56, gap=44, top=96, nodestyle={"d": ST_A, "e": ST_B},
                 notes=["Spermatogenesis takes about 74 days and needs a temperature below core body temperature."])

@fig("phy-male", 2, "Neural control of erection and ejaculation: parasympathetic S2 to S4 nerves release nitric oxide raising cGMP and relaxing corporal smooth muscle for erection; PDE5 inhibitors prolong cGMP; sympathetic T11 to L2 drives emission and somatic pudendal fibres drive ejaculation.",
     "Parasympathetic: point (erection). Sympathetic: shoot (emission). PDE5 inhibitors need nitric oxide, so nitrates are forbidden.")
def erection():
    return graph("x", "Erection and ejaculation", "d", [[("a", "Parasympathetic S2 to S4"), ("b", "Sympathetic T11 to L2, pudendal nerve")], [("c", "Nitric oxide, cGMP up:\ncorporal smooth muscle relaxes"), ("d", "Emission (vas, seminal vesicles, prostate),\nthen expulsion")], [("e", "Erection (PDE5 inhibitors prolong cGMP)"), ("f", "Ejaculation")]],
                 [("a", "c"), ("c", "e"), ("b", "d"), ("d", "f")], "Nitrates with PDE5 inhibitors cause profound hypotension", cw=340, rh=56, gap=38, top=96, nodestyle={"a": ST_B, "b": ST_A},
                 notes=["Diabetic neuropathy and vascular disease are common organic causes of erectile failure."])

@fig("phy-male", 3, "Table of normal semen parameters from World Health Organization lower reference limits: volume 1.5 mL, concentration 15 million per mL, total motility 40 percent, progressive motility 32 percent, normal forms 4 percent by strict criteria.",
     "Azoospermia means no sperm: obstructive (normal FSH, normal testes) or non-obstructive (high FSH, small testes).")
def semen_parameters():
    return pathways("x", "Semen analysis: lower reference limits", "d", ["Parameter", "Lower limit"],
        [("Volume", "1.5 mL"), ("Sperm concentration", "15 million per mL"), ("Total motility", "40 percent"), ("Progressive motility", "32 percent"), ("Normal forms (strict Kruger)", "4 percent")],
        "WHO fifth edition; a single abnormal result needs repeating", widths=[320, 250], rh=44, gap=10, top=100)

@fig("phy-membrane-transport", 0, "Table of membrane transport mechanisms: simple diffusion, facilitated diffusion via channels or carriers, primary active transport using ATP such as the sodium potassium pump, and secondary active transport driven by the sodium gradient such as SGLT.",
     "Passive goes downhill without ATP; primary active uses ATP directly; secondary active borrows energy from the sodium gradient.")
def transport_types():
    return pathways("x", "Ways across the membrane", "d", ["Mechanism", "Energy", "Example"],
        [("Simple diffusion", "None, down gradient", "O2, CO2, steroids, lipid-soluble drugs"), ("Facilitated diffusion", "None, carrier or channel, saturable", "GLUT glucose carriers, ion channels"), ("Primary active", "ATP used directly, against gradient", "Na+/K+ ATPase, H+/K+ ATPase, Ca2+ ATPase"), ("Secondary active", "Uses the Na+ gradient", "SGLT glucose, Na+/Ca2+ exchanger, NKCC")],
        widths=[170, 230, 290], rh=50, gap=12, top=100)

@fig("phy-mixed", 3, "Nitric oxide signalling: endothelial nitric oxide synthase makes nitric oxide from arginine, which diffuses into smooth muscle, activates guanylyl cyclase to raise cGMP and relaxes the muscle; nitrates donate nitric oxide and PDE5 inhibitors prolong cGMP.",
     "Endothelium makes NO, smooth muscle responds with cGMP: nitrates, sildenafil and endothelium-dependent relaxation all share this pathway.")
def no_pathway():
    return graph("x", "Endothelium-derived nitric oxide", "d", [[("a", "Endothelium: eNOS makes NO from L-arginine")], [("b", "NO diffuses into vascular smooth muscle")], [("c", "Guanylyl cyclase: GTP to cGMP up")], [("d", "Relaxation: vasodilation")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Nitrates donate NO; PDE5 inhibitors slow cGMP breakdown", cw=420, rh=48, gap=26, top=96, nodestyle={"c": ST_A})

@fig("phy-mixed", 5, "Why the ductus arteriosus is open before birth: prostaglandin E2 and E1 acting on EP4 receptors and low fetal oxygen keep it dilated; after birth oxygen rises and prostaglandins fall so it constricts; indomethacin closes a patent duct and alprostadil keeps it open when needed.",
     "Indomethacin closes a PDA; prostaglandin E1 keeps the duct open in duct-dependent heart disease.")
def ductus_pge():
    return graph("x", "The ductus arteriosus", "d", [[("a", "Fetus: placental PGE2, low PO2,\nEP4 receptors keep the duct open")], [("b", "Birth: lungs expand, PO2 rises,\nprostaglandins fall")], [("c", "Duct constricts, then becomes\nligamentum arteriosum")], [("d", "Patent duct: indomethacin closes it"), ("e", "Duct-dependent lesion:\nprostaglandin E1 keeps it open")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("c", "e")], "Prostaglandin synthesis inhibitors (NSAIDs) in late pregnancy can close the duct early", cw=300, rh=56, gap=30, top=96, nodestyle={"d": ST_B, "e": ST_A})

@fig("phy-nerve-fibres", 2, "Table of Erlanger Gasser nerve fibre types with diameter, conduction velocity and function: A alpha proprioception and motor, A beta touch, A gamma muscle spindle motor, A delta fast pain and cold, B preganglionic autonomic, C slow pain and postganglionic sympathetic.",
     "Larger and myelinated means faster. A delta is fast sharp pain; C is slow dull pain.")
def fibre_types():
    return pathways("x", "Nerve fibre types", "d", ["Type", "Diameter (um)", "Velocity (m/s)", "Function"],
        [("A alpha", "13 to 20", "80 to 120", "Proprioception, motor to muscle"), ("A beta", "6 to 12", "35 to 75", "Touch, pressure"), ("A gamma", "3 to 6", "15 to 30", "Motor to muscle spindles"), ("A delta", "1 to 5", "5 to 30", "Fast pain, cold, touch"),
         ("B", "Under 3", "3 to 15", "Preganglionic autonomic"), ("C", "0.2 to 1.5", "0.5 to 2", "Slow pain, postganglionic sympathetic; unmyelinated")],
        widths=[100, 130, 130, 330], rh=40, gap=8, top=100)

@fig("phy-nmj", 0, "Steps at the neuromuscular junction: motor nerve action potential opens calcium channels, vesicles release acetylcholine, it binds nicotinic receptors producing an end plate potential, sodium entry fires a muscle action potential, and acetylcholinesterase removes the transmitter.",
     "Ca2+ in, ACh out, nicotinic receptors open, end plate potential, muscle action potential, acetylcholinesterase ends the signal.")
def nmj_steps():
    return graph("x", "Neuromuscular transmission", "d", [[("a", "Motor nerve action potential reaches the terminal")], [("b", "Voltage-gated Ca2+ channels open")], [("c", "Vesicles release acetylcholine (quanta)")], [("d", "ACh binds nicotinic receptors: Na+ in, end plate potential")], [("e", "Muscle action potential and contraction")], [("f", "Acetylcholinesterase breaks down ACh in the cleft")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f")], "The safety factor is about three: the end plate potential far exceeds threshold", cw=440, rh=42, gap=20, top=90, nodestyle={"d": ST_A})

@fig("phy-nmj", 1, "Pathology of myasthenia gravis: autoantibodies against the acetylcholine receptor, MuSK or LRP4 reduce functional receptors, so repeated use causes fatigable weakness with ptosis and diplopia; edrophonium or pyridostigmine improve it; thymoma should be looked for.",
     "Weakness worsens with use and improves with rest; acetylcholinesterase inhibitors help, and the thymus must be checked.")
def myasthenia():
    return graph("x", "Myasthenia gravis", "d", [[("a", "Autoantibodies: AChR (most), MuSK, LRP4")], [("b", "Fewer functional receptors,\nend plate potential falls below threshold")], [("c", "Fatigable weakness: ptosis, diplopia, bulbar, limb"), ("d", "Thymoma or thymic hyperplasia:\nCT chest")], [("e", "Treat: pyridostigmine, immunosuppression, thymectomy")]],
                 [("a", "b"), ("b", "c"), ("b", "d"), ("c", "e"), ("d", "e")], "Crisis: too little (myasthenic) or too much (cholinergic) acetylcholinesterase inhibitor", cw=330, rh=56, gap=30, top=96, nodestyle={"a": ST_R})

@fig("phy-nmj", 2, "Table comparing depolarising and non-depolarising neuromuscular blockers: suxamethonium acts as an agonist causing fasciculation and hyperkalaemia and triggers malignant hyperthermia, whereas rocuronium and atracurium compete at the receptor and are reversed by neostigmine or sugammadex.",
     "Suxamethonium: fasciculations, hyperkalaemia, malignant hyperthermia trigger. Rocuronium: reversed by sugammadex.")
def nm_blockers():
    return pathways("x", "Neuromuscular blockers", "d", ["", "Depolarising", "Non-depolarising"],
        [("Drug", "Suxamethonium", "Rocuronium, vecuronium, atracurium"), ("Action", "Receptor agonist, then block (phase II)", "Competitive antagonist at nicotinic receptors"), ("Onset", "Fast, short (cholinesterase)", "Slower, longer; atracurium by Hofmann"),
         ("Hazards", "Fasciculations, hyperkalaemia, malignant hyperthermia", "Anaphylaxis (rare), prolonged block"), ("Reversal", "None; wait", "Neostigmine; sugammadex for rocuronium")],
        widths=[100, 280, 300], rh=48, gap=8, top=100)

@fig("phy-pain", 1, "Pain pathway: nociceptors with A delta and C fibres enter the dorsal horn, synapse in laminae I and II, cross in the anterior white commissure, ascend in the contralateral spinothalamic tract to the VPL thalamus and then to the somatosensory cortex; collaterals reach the periaqueductal grey and limbic system.",
     "Pain and temperature cross at the spinal level within a segment or two; dorsal column modalities cross in the medulla.")
def pain_pathway():
    return graph("x", "Nociceptive pathway", "d", [[("a", "Nociceptor: A delta (fast) and C (slow) fibres")], [("b", "Dorsal horn, laminae I and II (substantia gelatinosa)")], [("c", "Crosses in the anterior white commissure")], [("d", "Contralateral spinothalamic tract")], [("e", "VPL thalamus")], [("f", "Somatosensory cortex (location), cingulate and insula (affect)")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f")], "Gate control: A beta input and descending periaqueductal grey pathways dampen the dorsal horn relay", cw=460, rh=42, gap=20, top=90, nodestyle={"c": ST_A})

@fig("phy-pregnancy-lactation", 1, "Table of hormones driving breast development and lactation: oestrogen grows the ducts, progesterone grows alveoli, human placental lactogen and prolactin prepare the gland, oxytocin releases milk, and high oestrogen and progesterone block milk secretion until delivery.",
     "Oestrogen: ducts. Progesterone: alveoli. Prolactin: milk synthesis. Oxytocin: let-down.")
def breast_hormones():
    return pathways("x", "Hormones of breast development and lactation", "d", ["Hormone", "Source", "Effect"],
        [("Oestrogen", "Ovary, placenta", "Ductal growth and branching"), ("Progesterone", "Corpus luteum, placenta", "Lobule and alveolar growth"), ("Human placental lactogen, prolactin", "Placenta, pituitary", "Prepare the gland; prolactin drives milk synthesis"), ("Oxytocin", "Posterior pituitary", "Milk ejection (let-down) on suckling")],
        "Milk comes in after delivery because placental steroids fall away", widths=[230, 190, 270], rh=48, gap=12, top=100)

@fig("phy-pregnancy-lactation", 4, "Positive feedback loop of labour: fetal head stretches the cervix, afferent signals reach hypothalamic paraventricular and supraoptic nuclei, the posterior pituitary releases oxytocin, uterine contractions push the head harder against the cervix, until delivery ends the loop.",
     "Labour is a positive feedback loop, ended only by delivery; oestrogen sensitises the uterus to oxytocin.")
def oxytocin_loop():
    return graph("x", "Oxytocin positive feedback in labour", "d", [[("a", "Fetal head stretches the cervix")], [("b", "Afferent signal to hypothalamus (paraventricular nucleus)")], [("c", "Posterior pituitary releases oxytocin")], [("d", "Stronger uterine contractions")], [("e", "Delivery ends the loop")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "a", "pushes harder", "dash"), ("d", "e")], "Oestrogen raises uterine oxytocin receptors; prostaglandins add to contraction", cw=420, rh=44, gap=22, top=92, nodestyle={"c": ST_A})

@fig("phy-regional-circulation", 1, "Balance of myocardial oxygen: demand rises with heart rate, contractility, wall tension from preload and afterload; supply depends on diastolic aortic pressure, coronary vascular resistance, diastolic time and oxygen content; extraction is already about 70 percent so extra demand must be met by flow.",
     "Tachycardia hurts twice: demand rises and diastole, when the left ventricle is perfused, shortens.")
def myocardial_o2():
    f = F("x", "Myocardial oxygen: demand and supply", "d", 800, 440, "Extraction at rest is already about 70 percent, so more demand needs more flow")
    f.box(60, 100, 300, 190, "DEMAND\n\nHeart rate\nContractility\nWall tension: preload and afterload", "#FBE3E0", RED, 13.5, 600)
    f.box(440, 100, 300, 190, "SUPPLY\n\nDiastolic aortic pressure\nLow coronary resistance\nLong diastolic time\nOxygen content (haemoglobin)", "#E3F3EF", TEAL, 13.5, 600)
    f.text(400, 205, "vs", 18, 700, GREY, "middle")
    f.text(400, 340, "Left ventricular coronary flow occurs mainly in diastole.", 12.5, 600, INK, "middle"); f.text(400, 362, "Tachycardia raises demand and shortens diastole: angina.", 12.5, 400, GREY, "middle")
    return f

@fig("phy-regional-circulation", 4, "Response to standing: 300 to 500 mL of blood pools in the leg veins, venous return and cardiac output fall, baroreceptor unloading raises sympathetic tone and lowers vagal tone, heart rate and vasoconstriction restore pressure; failure causes orthostatic hypotension.",
     "Standing pools blood in the legs; the baroreflex restores pressure within seconds.")
def orthostasis():
    return graph("x", "Standing up", "d", [[("a", "Stand: 300 to 500 mL pools in leg veins")], [("b", "Venous return, stroke volume and BP fall")], [("c", "Baroreceptor unloading")], [("d", "Sympathetic up, vagal down")], [("e", "Heart rate and vasoconstriction restore BP"), ("f", "Failure: orthostatic hypotension,\nautonomic neuropathy, low volume, drugs")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("d", "f", "", "dash")], "Muscle pump and valves in leg veins also help return", cw=300, rh=48, gap=22, top=92, nodestyle={"f": ST_R})

@fig("phy-sensory", 4, "Two ascending sensory pathways: dorsal column medial lemniscus carrying fine touch and proprioception, ipsilateral in the cord, crossing in the medulla; spinothalamic carrying pain and temperature, crossing within the cord; both reach VPL thalamus and the postcentral gyrus.",
     "Dorsal column: ipsilateral until the medulla. Spinothalamic: crosses at once. A cord hemisection gives mixed sides.")
def sensory_pathways():
    return graph("x", "Two somatosensory pathways", "d", [[("a", "Dorsal column pathway:\nfine touch, vibration, proprioception"), ("b", "Spinothalamic pathway:\npain, temperature, crude touch")], [("c", "Ascend ipsilaterally in gracile and cuneate tracts"), ("d", "Cross at the spinal level, ascend contralaterally")], [("e", "Nuclei gracilis and cuneatus: cross in the medulla"), ("f", "Spinothalamic tract through the brainstem")], [("g", "Medial lemniscus"), ("h", "Spinal lemniscus")], [("i", "VPL thalamus, then postcentral gyrus (areas 3, 1, 2)"), None]],
                 [("a", "c"), ("c", "e"), ("e", "g"), ("g", "i"), ("b", "d"), ("d", "f"), ("f", "h"), ("h", "i")], "Cord hemisection (Brown-Sequard): ipsilateral touch and motor loss, contralateral pain loss", cw=340, rh=56, gap=24, top=96, nodestyle={"a": ST_B, "b": ST_A})

@fig("phy-smooth-cardiac-muscle", 4, "Phospholamban regulation of the cardiac sarcoplasmic reticulum: beta-1 stimulation raises cAMP and protein kinase A, which phosphorylates phospholamban, relieving its inhibition of the SERCA calcium pump, so calcium is taken up faster for quicker relaxation and larger stores for stronger contraction.",
     "Beta-1 stimulation speeds relaxation (lusitropy) and strengthens contraction through phospholamban and SERCA.")
def phospholamban():
    return graph("x", "Beta-1 stimulation and phospholamban", "d", [[("a", "Beta-1 receptor activated (noradrenaline)")], [("b", "Gs: cAMP up, protein kinase A active")], [("c", "Phospholamban phosphorylated:\nSERCA inhibition lifted")], [("d", "Faster Ca2+ uptake into the sarcoplasmic reticulum"), ("e", "L-type Ca2+ channels\nphosphorylated: more entry")], [("f", "Faster relaxation (lusitropy) and stronger contraction")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("b", "e"), ("d", "f"), ("e", "f")], "Unphosphorylated phospholamban inhibits SERCA", cw=300, rh=52, gap=24, top=92, nodestyle={"c": ST_A})

@fig("phy-taste-smell", 0, "Table comparing taste and smell pathways: taste buds via facial, glossopharyngeal and vagus nerves to the nucleus of the solitary tract, VPM thalamus and insula; olfactory neurons to the olfactory bulb glomeruli, mitral cells, olfactory tract to piriform cortex and amygdala without a thalamic relay first.",
     "Smell reaches cortex without passing the thalamus first; taste goes via the solitary nucleus and VPM.")
def taste_smell_paths():
    return pathways("x", "Chemical senses: taste and smell pathways", "d", ["Sense", "Peripheral", "Central pathway"],
        [("Taste", "Taste buds; CN VII (anterior two thirds), IX (posterior third), X", "Solitary nucleus, VPM thalamus, insula and frontal operculum"), ("Smell", "Bipolar olfactory neurons through the cribriform plate; CN I", "Olfactory bulb (glomeruli, mitral cells), tract, piriform cortex, amygdala; no thalamic relay first")],
        "Smell is the only sense that reaches cortex before the thalamus", widths=[110, 270, 310], rh=60, gap=14, top=100)

@fig("phy-wbc-immunity", 0, "Table of white cell types with typical share and role: neutrophils about 60 percent for first response, lymphocytes about 30 percent adaptive immunity, monocytes becoming macrophages, eosinophils for parasites and allergy, basophils with histamine and heparin.",
     "Never Let Monkeys Eat Bananas: neutrophil, lymphocyte, monocyte, eosinophil, basophil in descending order of abundance.")
def wbc_types():
    return pathways("x", "White cell differential", "d", ["Cell", "Typical share", "Role"],
        [("Neutrophil", "40 to 70 percent", "First responder to bacteria; phagocytosis; pus"), ("Lymphocyte", "20 to 40 percent", "Adaptive immunity: B, T and NK cells"), ("Monocyte", "2 to 8 percent", "Becomes tissue macrophage"), ("Eosinophil", "1 to 4 percent", "Parasites, allergy"), ("Basophil", "Under 1 percent", "Histamine and heparin; allergy")],
        "Never Let Monkeys Eat Bananas", widths=[150, 170, 370], rh=44, gap=10, top=100)

@fig("phy-wbc-immunity", 1, "Steps of phagocytosis: chemotaxis and margination, opsonisation by C3b and IgG, engulfment into a phagosome, fusion with lysosome, oxidative burst by NADPH oxidase with myeloperoxidase making hypochlorous acid; chronic granulomatous disease lacks NADPH oxidase.",
     "NADPH oxidase makes superoxide; myeloperoxidase makes bleach. CGD lacks the first enzyme and fails the NBT or DHR test.")
def phagocytosis():
    return graph("x", "Phagocytosis and the oxidative burst", "d", [[("a", "Margination, chemotaxis (C5a, IL-8)")], [("b", "Opsonisation: C3b and IgG coat the microbe")], [("c", "Engulfed into a phagosome")], [("d", "Fuses with lysosome: phagolysosome")], [("e", "NADPH oxidase: superoxide, then H2O2, then HOCl (myeloperoxidase)")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")], "Chronic granulomatous disease: NADPH oxidase defect, recurrent catalase-positive infections", cw=470, rh=44, gap=20, top=90, nodestyle={"e": ST_A})

@fig("phy-wbc-immunity", 2, "Complement activation: classical pathway by C1 on antibody, alternative pathway by spontaneous C3b on microbes, lectin pathway by mannose binding lectin, all forming C3 convertase and then C5 convertase; C3b opsonises, C3a and C5a recruit cells, C5b to C9 form the membrane attack complex.",
     "Three entry pathways, one common result: opsonisation (C3b), inflammation (C3a, C5a), lysis (MAC C5b-9).")
def complement():
    return graph("x", "Complement cascade", "d", [[("a", "Classical: C1 on antibody-antigen"), ("b", "Alternative: spontaneous C3b on microbe"), ("c", "Lectin: mannose-binding lectin")], [("d", "C3 convertase, then C5 convertase")], [("e", "C3b: opsonisation"), ("f", "C3a, C5a: inflammation,\nchemotaxis"), ("g", "C5b to C9: membrane attack\ncomplex (lysis)")]],
                 [("a", "d"), ("b", "d"), ("c", "d"), ("d", "e"), ("d", "f"), ("d", "g")], "Deficiencies: C1 esterase inhibitor (angioedema), C5 to C9 (Neisseria), early components (SLE)", cw=240, rh=56, gap=40, top=96, nodestyle={"d": ST_A})
