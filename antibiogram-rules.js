/* StewardMD - Antibiogram rules (shared by the browser, the build script and the tests).
 * ===========================================================================================
 * One place for everything that decides whether an antibiogram number may be shown:
 *   - canonical drug, organism, specimen and setting dictionaries (with the abbreviations
 *     Indian laboratories print, e.g. AMK, TZP, CFS, HLG);
 *   - expected (intrinsic) resistance: CLSI M100 Appendix B and EUCAST Expected Resistant
 *     Phenotypes. A susceptibility figure for an organism-drug pair that is intrinsically
 *     resistant is never shown as a number;
 *   - agents that CLSI says must not be reported as susceptible (aminoglycosides, 1st/2nd
 *     generation cephalosporins and cephamycins for Salmonella and Shigella);
 *   - specimen appropriateness (nitrofurantoin and norfloxacin are urine-only; daptomycin is
 *     inactivated by lung surfactant);
 *   - staphylococcal phenotype consistency (an MRSA row cannot be beta-lactam susceptible; a
 *     mixed S. aureus row cannot be more beta-lactam susceptible than it is cefoxitin
 *     susceptible);
 *   - arithmetic (a % that no whole number of isolates can produce is flagged);
 *   - CLSI M39: rows with fewer than 30 isolates are shown but never pooled.
 * Also: n-weighted pooling across institutions, phenotype rates, a weighted-incidence
 * syndromic coverage estimate (WISCA from cumulative data), CSV parsing, and the M39
 * first-isolate aggregation used when a hospital imports its own isolate list.
 *
 * ES5, no dependencies. Browser: window.ABG_RULES. Node: module.exports.
 * Decision support only. Figures are only as good as their source; every number carries one.
 * ======================================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ABG_RULES = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ----------------------------------------------------------------------------------
   * Drugs. aware: WHO AWaRe 2023 group (A = Access, W = Watch, R = Reserve, null = not
   * classified, e.g. antifungals). codes: abbreviations and spellings seen in reports.
   * ---------------------------------------------------------------------------------- */
  var DRUGS = {
    penicillin: { label: "Penicillin", cls: "Penicillin", aware: "A", codes: ["PEN", "P", "PENICILLIN G", "BENZYLPENICILLIN", "PENICILLIN-G", "PG"] },
    ampicillin: { label: "Ampicillin", cls: "Aminopenicillin", aware: "A", codes: ["AMP", "AM", "AMPI"] },
    amoxicillin: { label: "Amoxicillin", cls: "Aminopenicillin", aware: "A", codes: ["AMX", "AMOXYCILLIN", "AMOX"] },
    amoxiclav: { label: "Amoxicillin-clavulanate", cls: "Penicillin + inhibitor", aware: "A", codes: ["AMC", "AUG", "AMOXICLAV", "CO-AMOXICLAV", "COAMOXICLAV", "AMOXICILLIN CLAVULANATE", "AMOXICILLIN-CLAVULANATE", "AMOXICILLIN-CLAVULANIC ACID", "AMOXICILLIN CLAVULANIC ACID", "AMOXYCLAV", "AMOXYCILLIN-CLAVULANIC ACID", "AMOXYCILLIN CLAVULANIC ACID", "AMOXICILLIN/CLAVULANIC ACID", "AMOXICILLIN + CLAVULANATE", "AMOXYCILLIN-CLAVULANATE"] },
    ampsulbactam: { label: "Ampicillin-sulbactam", cls: "Penicillin + inhibitor", aware: "A", codes: ["SAM", "AMS", "A/S", "AMPICILLIN SULBACTAM", "AMPICILLIN-SULBACTAM", "AMPICILLIN/SULBACTAM", "AMPICILLIN + SULBACTAM", "AMPSULBACTAM"] },
    oxacillin: { label: "Oxacillin", cls: "Anti-staphylococcal penicillin", aware: "A", codes: ["OXA", "OX", "OXACILLIN"] },
    cloxacillin: { label: "Cloxacillin", cls: "Anti-staphylococcal penicillin", aware: "A", codes: ["CLOX", "COX", "CLOXACILLIN", "FLUCLOXACILLIN"] },
    piperacillin: { label: "Piperacillin", cls: "Antipseudomonal penicillin", aware: "W", codes: ["PI", "PRL", "PIP", "PIPERACILLIN"] },
    piptazo: { label: "Piperacillin-tazobactam", cls: "Penicillin + inhibitor", aware: "W", codes: ["TZP", "PIT", "PTZ", "PT", "PIP-TAZ", "PIPTAZ", "PIPTAZO", "PIPERACILLIN TAZOBACTAM", "PIPERACILLIN-TAZOBACTAM", "PIPERACILLIN/TAZOBACTAM", "PIPERACILLIN + TAZOBACTAM"] },
    cefazolin: { label: "Cefazolin", cls: "1st-gen cephalosporin", aware: "A", codes: ["CZ", "CZO", "KZ", "CFZ", "CEFAZOLIN"] },
    cephalexin: { label: "Cephalexin", cls: "1st-gen cephalosporin", aware: "A", codes: ["LEX", "CEPHALEXIN", "CEFALEXIN", "CEPHALOTHIN", "CEFALOTIN", "KF"] },
    cefuroxime: { label: "Cefuroxime", cls: "2nd-gen cephalosporin", aware: "W", codes: ["CXM", "CXM-AX", "CEFUROXIME", "CEFUROXIME-AXETIL", "CEFUROXIME AXETIL"] },
    cefoxitin: { label: "Cefoxitin", cls: "Cephamycin (MRSA marker)", aware: "W", codes: ["FOX", "CX", "CFO", "CEFOXITIN"] },
    cefotaxime: { label: "Cefotaxime", cls: "3rd-gen cephalosporin", aware: "W", codes: ["CTX", "CEFOTAXIME"] },
    ceftriaxone: { label: "Ceftriaxone", cls: "3rd-gen cephalosporin", aware: "W", codes: ["CRO", "CTR", "CEFTRIAXONE"] },
    ceftazidime: { label: "Ceftazidime", cls: "3rd-gen cephalosporin", aware: "W", codes: ["CAZ", "CEFTAZIDIME"] },
    cefepime: { label: "Cefepime", cls: "4th-gen cephalosporin", aware: "W", codes: ["FEP", "CPM", "CEFEPIME"] },
    cefixime: { label: "Cefixime", cls: "Oral 3rd-gen cephalosporin", aware: "W", codes: ["CFM", "CFX", "CEFIXIME"] },
    cefpodoxime: { label: "Cefpodoxime", cls: "Oral 3rd-gen cephalosporin", aware: "W", codes: ["CPD", "CEP", "CEFPODOXIME"] },
    cefoperazone: { label: "Cefoperazone", cls: "3rd-gen cephalosporin", aware: "W", codes: ["CPZ", "CFP", "CEFOPERAZONE"] },
    cefoperazone_sulbactam: { label: "Cefoperazone-sulbactam", cls: "Cephalosporin + inhibitor", aware: "W", codes: ["CFS", "SCF", "CFP-SUL", "CEFOPERAZONE SULBACTAM", "CEFOPERAZONE-SULBACTAM", "CEFOPERAZONE/SULBACTAM", "CEFOPERAZONE + SULBACTAM", "CEFOPERAZONESULBACTAM"] },
    ceftazidime_avibactam: { label: "Ceftazidime-avibactam", cls: "Cephalosporin + new inhibitor", aware: "R", codes: ["CZA", "CAZ-AVI", "CAZAVI", "CEFTAZIDIME AVIBACTAM", "CEFTAZIDIME-AVIBACTAM", "CEFTAZIDIME/AVIBACTAM"] },
    ceftolozane_tazobactam: { label: "Ceftolozane-tazobactam", cls: "Cephalosporin + inhibitor", aware: "R", codes: ["C/T", "CZT", "CEFTOLOZANE TAZOBACTAM", "CEFTOLOZANE-TAZOBACTAM"] },
    ceftaroline: { label: "Ceftaroline", cls: "Anti-MRSA cephalosporin", aware: "R", codes: ["CPT", "CEFTAROLINE"] },
    cefiderocol: { label: "Cefiderocol", cls: "Siderophore cephalosporin", aware: "R", codes: ["FDC", "CFDC", "CEFIDEROCOL"] },
    aztreonam: { label: "Aztreonam", cls: "Monobactam", aware: "R", codes: ["ATM", "AZT", "AT", "AZTREONAM"] },
    aztreonam_avibactam: { label: "Aztreonam-avibactam", cls: "Monobactam + new inhibitor", aware: "R", codes: ["AZA", "ATM-AVI", "AZTREONAM AVIBACTAM", "AZTREONAM-AVIBACTAM"] },
    ertapenem: { label: "Ertapenem", cls: "Carbapenem", aware: "W", codes: ["ETP", "ERT", "ERTAPENEM"] },
    imipenem: { label: "Imipenem", cls: "Carbapenem", aware: "W", codes: ["IPM", "IMP", "IMI", "IMIPENEM", "IMIPENEM-CILASTATIN", "IMIPENEM CILASTATIN"] },
    meropenem: { label: "Meropenem", cls: "Carbapenem", aware: "W", codes: ["MEM", "MRP", "MER", "MERO", "MEROPENEM"] },
    doripenem: { label: "Doripenem", cls: "Carbapenem", aware: "W", codes: ["DOR", "DORIPENEM"] },
    imipenem_relebactam: { label: "Imipenem-relebactam", cls: "Carbapenem + new inhibitor", aware: "R", codes: ["IMR", "IMIPENEM RELEBACTAM", "IMIPENEM-RELEBACTAM"] },
    meropenem_vaborbactam: { label: "Meropenem-vaborbactam", cls: "Carbapenem + new inhibitor", aware: "R", codes: ["MEV", "MEROPENEM VABORBACTAM", "MEROPENEM-VABORBACTAM"] },
    amikacin: { label: "Amikacin", cls: "Aminoglycoside", aware: "A", codes: ["AK", "AMK", "AN", "AMI", "AMIKACIN"] },
    gentamicin: { label: "Gentamicin", cls: "Aminoglycoside", aware: "A", codes: ["GEN", "CN", "GM", "GENT", "GENTAMICIN", "GENTAMYCIN"] },
    gentamicin_hl: { label: "Gentamicin (high-level)", cls: "Aminoglycoside (enterococcal synergy screen)", aware: "A", codes: ["HLG", "HLAR", "GEH", "GM-HL", "HIGH LEVEL GENTAMICIN", "HIGH-LEVEL GENTAMICIN", "GENTAMICIN (HIGH LEVEL)", "GENTAMICIN HIGH LEVEL", "HLGENTAMICIN", "GENTAMICIN_HL", "HLG (120)", "GENTAMICIN 120", "H-GENTAMICIN"] },
    streptomycin_hl: { label: "Streptomycin (high-level)", cls: "Aminoglycoside (enterococcal synergy screen)", aware: "W", codes: ["HLS", "STH", "HIGH LEVEL STREPTOMYCIN", "HIGH-LEVEL STREPTOMYCIN"] },
    tobramycin: { label: "Tobramycin", cls: "Aminoglycoside", aware: "W", codes: ["TOB", "TOBRAMYCIN"] },
    netilmicin: { label: "Netilmicin", cls: "Aminoglycoside", aware: "W", codes: ["NET", "NETILMICIN"] },
    plazomicin: { label: "Plazomicin", cls: "Aminoglycoside", aware: "R", codes: ["PLZ", "PLAZOMICIN"] },
    ciprofloxacin: { label: "Ciprofloxacin", cls: "Fluoroquinolone", aware: "W", codes: ["CIP", "CIPRO", "CIPROFLOXACIN"] },
    levofloxacin: { label: "Levofloxacin", cls: "Fluoroquinolone", aware: "W", codes: ["LVX", "LEV", "LE", "LEVO", "LEVOFLOXACIN"] },
    ofloxacin: { label: "Ofloxacin", cls: "Fluoroquinolone", aware: "W", codes: ["OFX", "OF", "OFLOXACIN"] },
    norfloxacin: { label: "Norfloxacin", cls: "Fluoroquinolone (urine only)", aware: "W", codes: ["NOR", "NX", "NORFLOXACIN"] },
    moxifloxacin: { label: "Moxifloxacin", cls: "Fluoroquinolone", aware: "W", codes: ["MXF", "MFX", "MOX", "MOXIFLOXACIN"] },
    nalidixic_acid: { label: "Nalidixic acid", cls: "Quinolone (screen)", aware: "W", codes: ["NAL", "NA", "NALIDIXIC ACID", "NALIDIXICACID"] },
    cotrimoxazole: { label: "Co-trimoxazole", cls: "Folate antagonist", aware: "A", codes: ["SXT", "COT", "COTRIM", "CO-TRIMOXAZOLE", "COTRIMOXAZOLE", "TRIMETHOPRIM-SULFAMETHOXAZOLE", "TRIMETHOPRIM SULFAMETHOXAZOLE", "TRIMETHOPRIM/SULFAMETHOXAZOLE", "TMP-SMX", "TMP/SMX", "SEPTRAN"] },
    trimethoprim: { label: "Trimethoprim", cls: "Folate antagonist", aware: "A", codes: ["TMP", "TRIMETHOPRIM"] },
    nitrofurantoin: { label: "Nitrofurantoin", cls: "Nitrofuran (urine only)", aware: "A", codes: ["NIT", "NF", "F", "F/M", "NITROFURANTOIN"] },
    fosfomycin: { label: "Fosfomycin", cls: "Phosphonic acid", aware: "W", codes: ["FOS", "FOF", "FO", "FOSFOMYCIN"] },
    tetracycline: { label: "Tetracycline", cls: "Tetracycline", aware: "A", codes: ["TCY", "TE", "TET", "TETRACYCLINE"] },
    doxycycline: { label: "Doxycycline", cls: "Tetracycline", aware: "A", codes: ["DOX", "DO", "DXT", "DOXYCYCLINE"] },
    minocycline: { label: "Minocycline", cls: "Tetracycline", aware: "W", codes: ["MNO", "MI", "MIN", "MINOCYCLINE"] },
    tigecycline: { label: "Tigecycline", cls: "Glycylcycline", aware: "R", codes: ["TGC", "TIG", "TGC15", "TIGECYCLINE"] },
    eravacycline: { label: "Eravacycline", cls: "Fluorocycline", aware: "R", codes: ["ERV", "ERAVACYCLINE"] },
    chloramphenicol: { label: "Chloramphenicol", cls: "Amphenicol", aware: "A", codes: ["CHL", "C", "CHLOR", "CHLORAMPHENICOL"] },
    colistin: { label: "Colistin", cls: "Polymyxin", aware: "R", codes: ["CST", "CL", "COL", "COLISTIN", "COLISTIN (BMD)"] },
    polymyxin_b: { label: "Polymyxin B", cls: "Polymyxin", aware: "R", codes: ["PB", "PMB", "POLYMYXIN B", "POLYMYXIN-B"] },
    erythromycin: { label: "Erythromycin", cls: "Macrolide", aware: "W", codes: ["ERY", "E", "ERYTHROMYCIN"] },
    azithromycin: { label: "Azithromycin", cls: "Macrolide", aware: "W", codes: ["AZM", "AZI", "AZ", "AZITHROMYCIN"] },
    clarithromycin: { label: "Clarithromycin", cls: "Macrolide", aware: "W", codes: ["CLR", "CLA", "CLARITHROMYCIN"] },
    clindamycin: { label: "Clindamycin", cls: "Lincosamide", aware: "A", codes: ["CLI", "CD", "DA", "CM", "CLINDAMYCIN"] },
    vancomycin: { label: "Vancomycin", cls: "Glycopeptide", aware: "W", codes: ["VAN", "VA", "V AN", "V", "VANCO", "VANCOMYCIN"] },
    teicoplanin: { label: "Teicoplanin", cls: "Glycopeptide", aware: "W", codes: ["TEC", "TEI", "TEICO", "TEICOPLANIN"] },
    linezolid: { label: "Linezolid", cls: "Oxazolidinone", aware: "R", codes: ["LNZ", "LZD", "LZ", "LIN", "LINEZOLID"] },
    tedizolid: { label: "Tedizolid", cls: "Oxazolidinone", aware: "R", codes: ["TZD", "TEDIZOLID"] },
    daptomycin: { label: "Daptomycin", cls: "Lipopeptide", aware: "R", codes: ["DAP", "DAPTOMYCIN"] },
    rifampicin: { label: "Rifampicin", cls: "Rifamycin", aware: "W", codes: ["RIF", "RA", "RIFAMPICIN", "RIFAMPIN"] },
    fusidic_acid: { label: "Fusidic acid", cls: "Fusidane", aware: "W", codes: ["FUS", "FA", "FD", "FUSIDIC ACID"] },
    mupirocin: { label: "Mupirocin (high-level)", cls: "Topical", aware: null, codes: ["MUP", "MU", "MUPIROCIN"] },
    metronidazole: { label: "Metronidazole", cls: "Nitroimidazole", aware: "A", codes: ["MTZ", "MET", "METRONIDAZOLE"] },
    sulbactam_durlobactam: { label: "Sulbactam-durlobactam", cls: "Sulbactam + new inhibitor", aware: "R", codes: ["SUD", "SULBACTAM DURLOBACTAM", "SULBACTAM-DURLOBACTAM"] },
    fluconazole: { label: "Fluconazole", cls: "Azole", aware: null, kind: "antifungal", codes: ["FLU", "FCA", "FLC", "FLUCONAZOLE"] },
    voriconazole: { label: "Voriconazole", cls: "Azole", aware: null, kind: "antifungal", codes: ["VOR", "VRC", "VORICONAZOLE"] },
    itraconazole: { label: "Itraconazole", cls: "Azole", aware: null, kind: "antifungal", codes: ["ITR", "ITC", "ITRACONAZOLE"] },
    posaconazole: { label: "Posaconazole", cls: "Azole", aware: null, kind: "antifungal", codes: ["POS", "PSC", "POSACONAZOLE"] },
    isavuconazole: { label: "Isavuconazole", cls: "Azole", aware: null, kind: "antifungal", codes: ["ISA", "ISAVUCONAZOLE"] },
    amphotericin_b: { label: "Amphotericin B", cls: "Polyene", aware: null, kind: "antifungal", codes: ["AMB", "AMPB", "AMPHO B", "AMPHOTERICIN", "AMPHOTERICIN B", "AMPHOTERICIN-B"] },
    caspofungin: { label: "Caspofungin", cls: "Echinocandin", aware: null, kind: "antifungal", codes: ["CAS", "CFG", "CASPOFUNGIN"] },
    micafungin: { label: "Micafungin", cls: "Echinocandin", aware: null, kind: "antifungal", codes: ["MCF", "MFG", "MICAFUNGIN"] },
    anidulafungin: { label: "Anidulafungin", cls: "Echinocandin", aware: null, kind: "antifungal", codes: ["ANF", "AND", "ANIDULAFUNGIN"] },
    flucytosine: { label: "Flucytosine", cls: "Pyrimidine analogue", aware: null, kind: "antifungal", codes: ["5FC", "5-FC", "FCT", "FLUCYTOSINE"] }
  };

  /* ----------------------------------------------------------------------------------
   * Organisms. group: gpc | entero | nonferm | fastid | ana | fungi | other.
   * names: lowercase spellings (exact after normalising dots and spaces).
   * ---------------------------------------------------------------------------------- */
  var ORGS = {
    ecoli: { label: "Escherichia coli", short: "E. coli", group: "entero", names: ["escherichia coli", "e coli", "e. coli", "e.coli", "ecoli"] },
    ecoli_dec: { label: "Diarrhoeagenic E. coli", short: "DEC", group: "entero", names: ["diarrhoeagenic e. coli", "diarrheagenic e. coli", "diarrhoeagenic escherichia coli", "diarrheagenic escherichia coli", "dec"] },
    klebsiella: { label: "Klebsiella pneumoniae / spp.", short: "Klebsiella", group: "entero", names: ["klebsiella pneumoniae", "k pneumoniae", "k. pneumoniae", "klebsiella spp", "klebsiella species", "klebsiella", "klebsiella spp.", "klebsiella pneumoniae complex"] },
    koxytoca: { label: "Klebsiella oxytoca", short: "K. oxytoca", group: "entero", names: ["klebsiella oxytoca", "k. oxytoca", "k oxytoca"] },
    kaerogenes: { label: "Klebsiella aerogenes", short: "K. aerogenes", group: "entero", names: ["klebsiella aerogenes", "k. aerogenes", "enterobacter aerogenes", "e. aerogenes"] },
    ecloacae: { label: "Enterobacter cloacae complex", short: "E. cloacae", group: "entero", names: ["enterobacter cloacae", "enterobacter cloacae complex", "e. cloacae", "e cloacae"] },
    enterobacter: { label: "Enterobacter spp.", short: "Enterobacter", group: "entero", names: ["enterobacter spp", "enterobacter spp.", "enterobacter species", "enterobacter"] },
    citrobacter: { label: "Citrobacter spp.", short: "Citrobacter", group: "entero", names: ["citrobacter spp", "citrobacter spp.", "citrobacter species", "citrobacter"] },
    cfreundii: { label: "Citrobacter freundii", short: "C. freundii", group: "entero", names: ["citrobacter freundii", "c. freundii", "citrobacter freundii complex"] },
    ckoseri: { label: "Citrobacter koseri", short: "C. koseri", group: "entero", names: ["citrobacter koseri", "c. koseri", "citrobacter diversus"] },
    pmirabilis: { label: "Proteus mirabilis", short: "P. mirabilis", group: "entero", names: ["proteus mirabilis", "p. mirabilis", "p mirabilis"] },
    proteus_other: { label: "Proteus vulgaris / penneri", short: "P. vulgaris", group: "entero", names: ["proteus vulgaris", "p. vulgaris", "proteus penneri"] },
    proteus: { label: "Proteus spp.", short: "Proteus", group: "entero", names: ["proteus spp", "proteus spp.", "proteus species", "proteus"] },
    entero_other: { label: "Enterobacter and Citrobacter (grouped)", short: "Enterobacter/Citrobacter", group: "entero", names: ["enterobacter spp. / citrobacter spp", "enterobacter/citrobacter", "enterobacter and citrobacter", "other enterobacterales"] },
    ppm: { label: "Proteus, Morganella and Providencia (grouped)", short: "Proteus group", group: "entero", names: ["proteus spp. / morganella / providencia", "proteus/morganella/providencia", "proteus, morganella, providencia", "proteus morganella providencia", "ppm"] },
    morganella: { label: "Morganella morganii", short: "Morganella", group: "entero", names: ["morganella morganii", "morganella", "morganella spp", "morganella spp."] },
    providencia: { label: "Providencia spp.", short: "Providencia", group: "entero", names: ["providencia spp", "providencia spp.", "providencia", "providencia species"] },
    pstuartii: { label: "Providencia stuartii", short: "P. stuartii", group: "entero", names: ["providencia stuartii", "p. stuartii"] },
    prettgeri: { label: "Providencia rettgeri", short: "P. rettgeri", group: "entero", names: ["providencia rettgeri", "p. rettgeri"] },
    serratia: { label: "Serratia marcescens", short: "Serratia", group: "entero", names: ["serratia marcescens", "serratia", "serratia spp", "serratia spp."] },
    salmonella_typhi: { label: "Salmonella Typhi", short: "S. Typhi", group: "entero", names: ["salmonella typhi", "s. typhi", "s typhi", "salmonella enterica serovar typhi"] },
    salmonella_paratyphi: { label: "Salmonella Paratyphi", short: "S. Paratyphi", group: "entero", names: ["salmonella paratyphi a", "salmonella paratyphi", "s. paratyphi a", "s. paratyphi", "salmonella paratyphi b"] },
    salmonella_enteric: { label: "Salmonella Typhi and Paratyphi (grouped)", short: "Typhoidal Salmonella", group: "entero", names: ["salmonella spp. (typhi, paratyphi a & b)", "salmonella typhi and paratyphi", "typhoidal salmonella", "salmonella spp", "salmonella spp.", "salmonella species", "salmonella"] },
    salmonella_nts: { label: "Non-typhoidal Salmonella", short: "NTS", group: "entero", names: ["non-typhoidal salmonella", "non typhoidal salmonella", "nts"] },
    shigella: { label: "Shigella spp.", short: "Shigella", group: "entero", names: ["shigella spp", "shigella spp.", "shigella", "shigella species"] },
    shigella_sonnei: { label: "Shigella sonnei", short: "S. sonnei", group: "entero", names: ["shigella sonnei", "s. sonnei"] },
    shigella_flexneri: { label: "Shigella flexneri", short: "S. flexneri", group: "entero", names: ["shigella flexneri", "s. flexneri"] },
    vcholerae: { label: "Vibrio cholerae", short: "V. cholerae", group: "other", names: ["vibrio cholerae", "v. cholerae"] },
    paeruginosa: { label: "Pseudomonas aeruginosa", short: "P. aeruginosa", group: "nonferm", names: ["pseudomonas aeruginosa", "p. aeruginosa", "p aeruginosa", "pseudomonas spp", "pseudomonas spp.", "pseudomonas", "pseudomonas species"] },
    acinetobacter: { label: "Acinetobacter baumannii complex / spp.", short: "Acinetobacter", group: "nonferm", names: ["acinetobacter baumannii", "a. baumannii", "acinetobacter spp", "acinetobacter spp.", "acinetobacter", "acinetobacter species", "acinetobacter baumannii complex", "acinetobacter baumannii-calcoaceticus complex", "acinetobacter calcoaceticus-baumannii complex"] },
    steno: { label: "Stenotrophomonas maltophilia", short: "S. maltophilia", group: "nonferm", names: ["stenotrophomonas maltophilia", "s. maltophilia", "stenotrophomonas"] },
    burkholderia: { label: "Burkholderia spp.", short: "Burkholderia", group: "nonferm", names: ["burkholderia spp", "burkholderia spp.", "burkholderia", "burkholderia species"] },
    bcepacia: { label: "Burkholderia cepacia complex", short: "B. cepacia", group: "nonferm", names: ["burkholderia cepacia", "burkholderia cepacia complex", "b. cepacia"] },
    bpseudomallei: { label: "Burkholderia pseudomallei", short: "B. pseudomallei", group: "nonferm", names: ["burkholderia pseudomallei", "b. pseudomallei"] },
    hinfluenzae: { label: "Haemophilus influenzae", short: "H. influenzae", group: "fastid", names: ["haemophilus influenzae", "h. influenzae", "h influenzae"] },
    ngonorrhoeae: { label: "Neisseria gonorrhoeae", short: "N. gonorrhoeae", group: "fastid", names: ["neisseria gonorrhoeae", "n. gonorrhoeae"] },
    nmeningitidis: { label: "Neisseria meningitidis", short: "N. meningitidis", group: "fastid", names: ["neisseria meningitidis", "n. meningitidis"] },
    mcatarrhalis: { label: "Moraxella catarrhalis", short: "M. catarrhalis", group: "fastid", names: ["moraxella catarrhalis", "m. catarrhalis", "moraxella"] },
    saureus: { label: "Staphylococcus aureus", short: "S. aureus", group: "gpc", staph: true, names: ["staphylococcus aureus", "s. aureus", "s aureus", "staph aureus", "staph. aureus"] },
    cons: { label: "Coagulase-negative staphylococci", short: "CoNS", group: "gpc", staph: true, names: ["coagulase-negative staphylococci", "coagulase negative staphylococci", "coagulase-negative staphylococcus", "coagulase negative staphylococcus", "cons", "significant cons", "cons (coagulase-negative staphylococcus)", "staphylococcus spp. (cons)"] },
    sepidermidis: { label: "Staphylococcus epidermidis", short: "S. epidermidis", group: "gpc", staph: true, names: ["staphylococcus epidermidis", "s. epidermidis", "s epidermidis"] },
    shaemolyticus: { label: "Staphylococcus haemolyticus", short: "S. haemolyticus", group: "gpc", staph: true, names: ["staphylococcus haemolyticus", "s. haemolyticus", "s haemolyticus"] },
    shominis: { label: "Staphylococcus hominis", short: "S. hominis", group: "gpc", staph: true, names: ["staphylococcus hominis", "staphylococcus hominis ss. hominis", "staphylococcus hominis subsp. hominis", "s. hominis", "s hominis"] },
    cons_other: { label: "Other coagulase-negative staphylococci", short: "Other CoNS", group: "gpc", staph: true, names: ["other cons", "other coagulase-negative staphylococci", "other coagulase negative staphylococci", "other cons species"] },
    ssaprophyticus: { label: "Staphylococcus saprophyticus", short: "S. saprophyticus", group: "gpc", staph: true, names: ["staphylococcus saprophyticus", "s. saprophyticus"] },
    efaecalis: { label: "Enterococcus faecalis", short: "E. faecalis", group: "gpc", names: ["enterococcus faecalis", "e. faecalis", "e faecalis"] },
    efaecium: { label: "Enterococcus faecium", short: "E. faecium", group: "gpc", names: ["enterococcus faecium", "e. faecium", "e faecium"] },
    enterococcus: { label: "Enterococcus spp.", short: "Enterococcus", group: "gpc", names: ["enterococcus spp", "enterococcus spp.", "enterococcus", "enterococcus species", "enterococci"] },
    spneumoniae: { label: "Streptococcus pneumoniae", short: "S. pneumoniae", group: "gpc", strep: true, names: ["streptococcus pneumoniae", "s. pneumoniae", "pneumococcus"] },
    strep_bhs: { label: "Beta-haemolytic streptococci", short: "Beta-haemolytic strep", group: "gpc", strep: true, names: ["beta-haemolytic streptococci", "beta haemolytic streptococci", "beta-hemolytic streptococci", "streptococcus pyogenes", "s. pyogenes", "streptococcus agalactiae", "s. agalactiae", "group a streptococcus", "group b streptococcus"] },
    strep_viridans: { label: "Viridans group streptococci", short: "Viridans strep", group: "gpc", strep: true, names: ["viridans streptococci", "viridans group streptococci", "streptococcus viridans"] },
    streptococcus: { label: "Streptococcus spp.", short: "Streptococcus", group: "gpc", strep: true, names: ["streptococcus spp", "streptococcus spp.", "streptococcus", "streptococci", "streptococcus species"] },
    listeria: { label: "Listeria monocytogenes", short: "Listeria", group: "gpc", names: ["listeria monocytogenes", "listeria"] },
    brucella: { label: "Brucella spp.", short: "Brucella", group: "other", names: ["brucella spp", "brucella spp.", "brucella", "brucella melitensis"] },
    kocuria: { label: "Kocuria spp.", short: "Kocuria", group: "other", names: ["kocuria spp", "kocuria spp.", "kocuria"] },
    sphingomonas: { label: "Sphingomonas spp.", short: "Sphingomonas", group: "other", names: ["sphingomonas spp", "sphingomonas spp.", "sphinogomonas spp", "sphinogomonas spp.", "sphingomonas paucimobilis"] },
    aerococcus: { label: "Aerococcus spp.", short: "Aerococcus", group: "other", names: ["aerococcus spp", "aerococcus spp.", "aerococcus"] },
    aeromonas: { label: "Aeromonas spp.", short: "Aeromonas", group: "other", names: ["aeromonas spp", "aeromonas spp.", "aeromonas", "aeromonas hydrophila"] },
    elizabethkingia: { label: "Elizabethkingia meningoseptica", short: "Elizabethkingia", group: "nonferm", names: ["elizabethkingia meningoseptica", "elizabethkingia spp", "elizabethkingia"] },
    candida: { label: "Candida spp.", short: "Candida", group: "fungi", names: ["candida spp", "candida spp.", "candida", "candida species", "yeast", "yeasts"] },
    calbicans: { label: "Candida albicans", short: "C. albicans", group: "fungi", names: ["candida albicans", "c. albicans"] },
    ctropicalis: { label: "Candida tropicalis", short: "C. tropicalis", group: "fungi", names: ["candida tropicalis", "c. tropicalis"] },
    cparapsilosis: { label: "Candida parapsilosis", short: "C. parapsilosis", group: "fungi", names: ["candida parapsilosis", "c. parapsilosis"] },
    cglabrata: { label: "Candida (Nakaseomyces) glabrata", short: "C. glabrata", group: "fungi", names: ["candida glabrata", "c. glabrata", "nakaseomyces glabratus", "nakaseomyces glabrata"] },
    ckrusei: { label: "Candida krusei (Pichia kudriavzevii)", short: "C. krusei", group: "fungi", names: ["candida krusei", "c. krusei", "pichia kudriavzevii"] },
    cauris: { label: "Candida auris", short: "C. auris", group: "fungi", names: ["candida auris", "c. auris", "candidozyma auris"] },
    aspergillus: { label: "Aspergillus spp.", short: "Aspergillus", group: "fungi", names: ["aspergillus spp", "aspergillus spp.", "aspergillus species", "aspergillus"] },
    aflavus: { label: "Aspergillus flavus", short: "A. flavus", group: "fungi", names: ["aspergillus flavus", "a. flavus"] },
    afumigatus: { label: "Aspergillus fumigatus", short: "A. fumigatus", group: "fungi", names: ["aspergillus fumigatus", "a. fumigatus"] },
    aniger: { label: "Aspergillus niger", short: "A. niger", group: "fungi", names: ["aspergillus niger", "a. niger"] }
  };

  var SPECIMENS = {
    blood: { label: "Blood", names: ["blood", "blood culture", "blood cultures", "bsi", "bloodstream"] },
    urine: { label: "Urine", names: ["urine", "urine culture", "uti", "urinary"] },
    respiratory: { label: "Respiratory", names: ["respiratory", "sputum", "bal", "eta", "endotracheal aspirate", "tracheal aspirate", "lower respiratory", "lower respiratory tract", "lrt", "respiratory samples", "respiratory tract"] },
    pus: { label: "Pus, wounds and body fluids", names: ["pus", "wound", "swab", "pus and wound", "pus & body fluids", "pus/swab", "ssti", "sterile body fluids/pus/swab", "pus, swabs and body fluids", "superficial infection", "superficial infections", "si"] },
    deep: { label: "Deep infections (tissue, aspirates)", names: ["deep infection", "deep infections", "di", "tissue", "deep tissue", "aspirate", "abscess aspirate"] },
    sterile: { label: "Sterile body fluids", names: ["sterile body fluids", "sterile fluids", "sterile sites", "ss", "body fluids", "pleural fluid", "ascitic fluid", "peritoneal fluid", "synovial fluid", "bile"] },
    csf: { label: "CSF", names: ["csf", "cerebrospinal fluid"] },
    stool: { label: "Stool", names: ["stool", "faeces", "feces", "stool culture"] },
    nonurine: { label: "All specimens except urine and stool", names: ["all specimens except urine", "all samples except urine", "all specimens (except urine and faeces)", "all samples (except faeces and urine)", "non-urinary", "except urine and faeces", "total samples (except faeces & urine)"] },
    all: { label: "All specimens", names: ["all", "all specimens", "all clinical", "overall", "all samples", "mixed", "total", "all samples (except faeces)"] }
  };
  var SETTINGS = {
    opd: { label: "Outpatients", names: ["opd", "outpatient", "outpatients", "op"] },
    ward: { label: "Wards", names: ["ipd", "ward", "wards", "inpatient ward", "non-icu", "non icu", "ip", "ipd (wards)"] },
    icu: { label: "ICU", names: ["icu", "intensive care", "micu", "sicu", "picu", "nicu", "critical care"] },
    inpatient: { label: "All inpatients", names: ["inpatient", "inpatients", "ipd+icu", "hospitalised"] },
    all: { label: "All settings", names: ["all", "overall", "total", "combined", "opd+ipd"] }
  };

  /* ---------------------------------------------------------------------------------- */
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/ /g, " ").replace(/\s+/g, " ").replace(/\s*\.\s*/g, ". ").replace(/\s+$/, "").replace(/\.$/, "").trim(); }
  var DRUG_INDEX = null, ORG_INDEX = null;
  function drugIndex() {
    if (DRUG_INDEX) return DRUG_INDEX;
    DRUG_INDEX = {};
    Object.keys(DRUGS).forEach(function (k) {
      DRUG_INDEX[k.toUpperCase()] = k;
      DRUG_INDEX[DRUGS[k].label.toUpperCase()] = k;
      (DRUGS[k].codes || []).forEach(function (c) { DRUG_INDEX[c.toUpperCase()] = k; });
    });
    return DRUG_INDEX;
  }
  /* Resolve a printed drug name or abbreviation to its key, or null. */
  function canonDrug(s) {
    if (s == null) return null;
    var raw = String(s).trim(); if (!raw) return null;
    if (DRUGS[raw]) return raw;
    var idx = drugIndex(), up = raw.toUpperCase().replace(/ /g, " ").replace(/\s+/g, " ");
    if (idx[up]) return idx[up];
    var up2 = up.replace(/\s*[\/+&]\s*/g, "-").replace(/\s*-\s*/g, "-");
    if (idx[up2]) return idx[up2];
    var up3 = up.replace(/[^A-Z0-9]/g, "");
    var keys = Object.keys(idx);
    for (var i = 0; i < keys.length; i++) if (keys[i].replace(/[^A-Z0-9]/g, "") === up3) return idx[keys[i]];
    // WHONET column names: code + test method and guideline, e.g. AMK_ND30, MEM_NM, CIP_EE5,
    // VAN_NE (N/E = CLSI/EUCAST, D/M/E = disc/MIC/Etest, then disc content).
    var w = /^([A-Z]{2,4})_[NE][DME]\d*(?:[.\/]\d+)*$/.exec(up);
    if (w && idx[w[1]]) return idx[w[1]];
    return null;
  }
  function orgIndex() {
    if (ORG_INDEX) return ORG_INDEX;
    ORG_INDEX = {};
    Object.keys(ORGS).forEach(function (k) {
      ORG_INDEX[norm(k)] = k; ORG_INDEX[norm(ORGS[k].label)] = k; ORG_INDEX[norm(ORGS[k].short)] = k;
      (ORGS[k].names || []).forEach(function (n) { ORG_INDEX[norm(n)] = k; });
    });
    return ORG_INDEX;
  }
  /* Resolve a printed organism name to {key, pheno}. Phenotype words (MRSA, MSSA, MR-CoNS,
   * ESBL, CRE, VRE) are split off: "MRSA" -> {key:"saureus", pheno:"MRSA"}. */
  function canonOrg(s) {
    if (s == null) return null;
    var t = norm(s).replace(/\(n\s*=\s*\d+\)/g, "").trim(), pheno = null;
    if (ORGS[t]) return { key: t, pheno: null };
    var m;
    if (/^mrsa\b|methicillin[- ]resistant staphylococcus aureus/.test(t)) return { key: "saureus", pheno: "MRSA" };
    if (/^mssa\b|methicillin[- ]susceptible staphylococcus aureus|methicillin[- ]sensitive staphylococcus aureus/.test(t)) return { key: "saureus", pheno: "MSSA" };
    if (/^mr-?cons\b|methicillin[- ]resistant (coagulase|cons)/.test(t)) return { key: "cons", pheno: "MR" };
    if (/^ms-?cons\b|methicillin[- ]susceptible (coagulase|cons)/.test(t)) return { key: "cons", pheno: "MS" };
    if ((m = /^(.*?)[\s(-]*\b(esbl|cre|crab|crpa|vre|mdr|xdr|carbapenem[- ]resistant)\b.*$/.exec(t)) && m[1]) {
      pheno = m[2].toUpperCase().replace(/^CARBAPENEM[- ]RESISTANT$/, "CR"); t = m[1].trim();
    }
    var idx = orgIndex(), k = idx[t] || idx[t.replace(/\s+spp$/, " spp.")] || idx[t.replace(/\s+species$/, " spp.")];
    if (!k) return null;
    return { key: k, pheno: pheno };
  }
  function canonFrom(dict, s) {
    if (s == null) return null;
    var t = norm(s); if (dict[t]) return t;
    var keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) if ((dict[keys[i]].names || []).indexOf(t) >= 0) return keys[i];
    return null;
  }
  function canonSpecimen(s) { return canonFrom(SPECIMENS, s); }
  function canonSetting(s) { return canonFrom(SETTINGS, s); }

  function drugLabel(k) { return (DRUGS[k] && DRUGS[k].label) || String(k || ""); }
  function orgLabel(k) { return (ORGS[k] && ORGS[k].label) || String(k || ""); }
  function orgShort(k) { return (ORGS[k] && ORGS[k].short) || orgLabel(k); }
  function aware(k) { return (DRUGS[k] && DRUGS[k].aware) || null; }

  /* ----------------------------------------------------------------------------------
   * Expected resistance (CLSI M100 Appendix B; EUCAST Expected Resistant Phenotypes v1.2).
   * Only pairs that are true for every member of the organism key are listed, so a genus
   * key ("Proteus spp.") carries the rules common to its species.
   * ---------------------------------------------------------------------------------- */
  var CEPHS = ["cefazolin", "cephalexin", "cefuroxime", "cefoxitin", "cefotaxime", "ceftriaxone", "ceftazidime", "cefepime", "cefixime", "cefpodoxime", "cefoperazone", "cefoperazone_sulbactam", "ceftaroline", "ceftazidime_avibactam", "ceftolozane_tazobactam", "cefiderocol"];
  var AMINO_STD = ["amikacin", "gentamicin", "tobramycin", "netilmicin"];
  var TETRAS = ["tetracycline", "doxycycline", "minocycline", "tigecycline", "eravacycline"];
  var POLYMYXINS = ["colistin", "polymyxin_b"];
  var GN_BASE = ["penicillin", "oxacillin", "cloxacillin", "vancomycin", "teicoplanin", "linezolid", "tedizolid", "daptomycin", "clindamycin", "fusidic_acid", "mupirocin"];
  var GP_BASE = ["aztreonam", "aztreonam_avibactam", "colistin", "polymyxin_b", "nalidixic_acid"];
  var ANTIFUNGALS = Object.keys(DRUGS).filter(function (k) { return DRUGS[k].kind === "antifungal"; });
  var ANTIBACTERIALS = Object.keys(DRUGS).filter(function (k) { return DRUGS[k].kind !== "antifungal"; });
  var GROUP_INTRINSIC = {
    entero: GN_BASE.concat(["erythromycin", "clarithromycin"]),
    nonferm: GN_BASE.concat(["erythromycin", "clarithromycin", "azithromycin"]),
    fastid: ["vancomycin", "teicoplanin", "linezolid", "tedizolid", "daptomycin", "clindamycin", "oxacillin", "cloxacillin"],
    gpc: GP_BASE,
    fungi: ANTIBACTERIALS,
    other: []
  };
  var ORG_INTRINSIC = {
    klebsiella: ["ampicillin", "amoxicillin"],
    koxytoca: ["ampicillin", "amoxicillin"],
    kaerogenes: ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "cefazolin", "cephalexin", "cefoxitin"],
    ecloacae: ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "cefazolin", "cephalexin", "cefoxitin"],
    enterobacter: ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "cefazolin", "cephalexin", "cefoxitin"],
    citrobacter: ["ampicillin", "amoxicillin"],
    entero_other: ["ampicillin", "amoxicillin"],
    cfreundii: ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "cefazolin", "cephalexin", "cefoxitin"],
    ckoseri: ["ampicillin", "amoxicillin"],
    serratia: ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "cefazolin", "cephalexin", "cefuroxime"].concat(POLYMYXINS),
    pmirabilis: ["nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    proteus_other: ["ampicillin", "amoxicillin", "cefazolin", "cephalexin", "cefuroxime", "nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    proteus: ["nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    ppm: ["nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    morganella: ["ampicillin", "amoxicillin", "amoxiclav", "cefazolin", "cephalexin", "cefuroxime", "nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    providencia: ["ampicillin", "amoxicillin", "amoxiclav", "cefazolin", "cephalexin", "nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    prettgeri: ["ampicillin", "amoxicillin", "amoxiclav", "cefazolin", "cephalexin", "nitrofurantoin"].concat(POLYMYXINS, TETRAS),
    // P. stuartii also carries the chromosomal aac(2')-Ia: gentamicin, tobramycin and netilmicin.
    pstuartii: ["ampicillin", "amoxicillin", "amoxiclav", "cefazolin", "cephalexin", "nitrofurantoin", "gentamicin", "tobramycin", "netilmicin"].concat(POLYMYXINS, TETRAS),
    paeruginosa: ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "cefazolin", "cephalexin", "cefuroxime", "cefoxitin", "cefotaxime", "ceftriaxone", "cefixime", "cefpodoxime", "ertapenem", "cotrimoxazole", "trimethoprim", "chloramphenicol", "nitrofurantoin", "nalidixic_acid"].concat(TETRAS),
    acinetobacter: ["ampicillin", "amoxicillin", "amoxiclav", "aztreonam", "ertapenem", "trimethoprim", "chloramphenicol", "fosfomycin", "cefazolin", "cephalexin", "nitrofurantoin"],
    steno: ["ampicillin", "amoxicillin", "amoxiclav", "piptazo", "cefazolin", "cephalexin", "cefuroxime", "cefotaxime", "ceftriaxone", "aztreonam", "ertapenem", "imipenem", "meropenem", "doripenem", "fosfomycin", "nitrofurantoin"].concat(AMINO_STD),
    burkholderia: ["ampicillin", "amoxicillin", "cefazolin", "cephalexin"].concat(AMINO_STD, POLYMYXINS),
    bcepacia: ["ampicillin", "amoxicillin", "cefazolin", "cephalexin", "ertapenem", "fosfomycin"].concat(AMINO_STD, POLYMYXINS),
    bpseudomallei: ["penicillin", "ampicillin", "amoxicillin", "cefazolin", "cephalexin", "cefuroxime"].concat(AMINO_STD, POLYMYXINS),
    ssaprophyticus: ["fosfomycin", "fusidic_acid"],
    efaecalis: CEPHS.concat(AMINO_STD, ["clindamycin", "cotrimoxazole", "trimethoprim", "oxacillin", "cloxacillin", "fusidic_acid"]),
    efaecium: CEPHS.concat(AMINO_STD, ["clindamycin", "cotrimoxazole", "trimethoprim", "oxacillin", "cloxacillin", "fusidic_acid"]),
    enterococcus: CEPHS.concat(AMINO_STD, ["clindamycin", "cotrimoxazole", "trimethoprim", "oxacillin", "cloxacillin", "fusidic_acid"]),
    spneumoniae: AMINO_STD.slice(),
    strep_bhs: AMINO_STD.slice(),
    strep_viridans: AMINO_STD.slice(),
    streptococcus: AMINO_STD.slice(),
    listeria: CEPHS.slice(),
    ckrusei: ["fluconazole"],
    aspergillus: ["fluconazole"], aflavus: ["fluconazole"], afumigatus: ["fluconazole"], aniger: ["fluconazole"]
  };
  // Drugs used against bacteria make no sense for yeasts and vice versa (handled by group).
  var SALMONELLA_SHIGELLA = ["salmonella_typhi", "salmonella_paratyphi", "salmonella_enteric", "salmonella_nts", "shigella", "shigella_sonnei", "shigella_flexneri"];
  var NOT_EFFECTIVE_SS = AMINO_STD.concat(["cefazolin", "cephalexin", "cefuroxime", "cefoxitin"]);
  var URINE_ONLY = ["nitrofurantoin", "norfloxacin"];
  var NOT_RESPIRATORY = ["daptomycin"];
  // Too little reaches the urine to treat a urinary infection (IDSA 2024 AMR guidance advises
  // against tigecycline and eravacycline for UTI; moxifloxacin is not renally excreted).
  var NOT_URINE = ["tigecycline", "eravacycline", "moxifloxacin"];
  var STAPH_BL_LABILE = ["penicillin", "ampicillin", "amoxicillin"];
  var STAPH_BL_STABLE = ["oxacillin", "cloxacillin", "amoxiclav", "ampsulbactam", "piptazo", "cefazolin", "cephalexin", "cefuroxime", "cefotaxime", "ceftriaxone", "ceftazidime", "cefepime", "cefixime", "cefpodoxime", "cefoperazone", "cefoperazone_sulbactam", "piperacillin", "ertapenem", "imipenem", "meropenem", "doripenem", "ceftazidime_avibactam", "ceftolozane_tazobactam", "imipenem_relebactam", "meropenem_vaborbactam", "cefiderocol"];

  function orgGroup(k) { return (ORGS[k] && ORGS[k].group) || "other"; }
  /* Why a drug is expected to be inactive against an organism, or null. */
  function intrinsicReason(orgKey, drugKey) {
    var g = orgGroup(orgKey);
    if (g === "fungi" && DRUGS[drugKey] && DRUGS[drugKey].kind !== "antifungal") return "an antibacterial has no activity against yeasts";
    if (g !== "fungi" && DRUGS[drugKey] && DRUGS[drugKey].kind === "antifungal") return "an antifungal has no activity against bacteria";
    if ((ORG_INTRINSIC[orgKey] || []).indexOf(drugKey) >= 0) return "intrinsic resistance (CLSI M100 Appendix B; EUCAST expected resistant phenotypes)";
    if (orgKey === "hinfluenzae" || orgKey === "mcatarrhalis") { if (drugKey === "penicillin") return null; }
    if ((GROUP_INTRINSIC[g] || []).indexOf(drugKey) >= 0) {
      if (g === "fastid" && (orgKey === "ngonorrhoeae" || orgKey === "nmeningitidis") && drugKey === "penicillin") return null;
      return g === "gpc" ? "Gram-positive bacteria are intrinsically resistant (CLSI M100 Appendix B)" : "intrinsic resistance of Gram-negative bacteria (CLSI M100 Appendix B)";
    }
    if (SALMONELLA_SHIGELLA.indexOf(orgKey) >= 0 && NOT_EFFECTIVE_SS.indexOf(drugKey) >= 0) return "may test active but is not effective clinically for Salmonella or Shigella; not reported as susceptible (CLSI M100)";
    return null;
  }

  /* Can a %S value come from a whole number of isolates out of at most n tested? */
  function achievable(s, n) {
    if (n == null || !(n > 0)) return true;
    if (n >= 1000) return true;                     // every 0.1% step is reachable
    var dec = Math.abs(s - Math.round(s)) > 1e-9, tol = dec ? 0.1 : 1.0;
    for (var d = 1; d <= n; d++) {
      var k = Math.round(s * d / 100);
      if (k < 0 || k > d) continue;
      if (Math.abs(100 * k / d - s) <= tol + 1e-9) return true;
      // truncation (e.g. 26.66 printed as 26.6)
      var kf = Math.floor(s * d / 100 + 1e-9);
      if (Math.abs(100 * kf / d - s) <= tol + 1e-9) return true;
    }
    return false;
  }

  var M39_MIN = 30;
  /* Validate one antibiogram row. Input: {org (key), pheno, spec, set, n, s:{drug:%S},
   * nt:{drug:tested}, approx:[drug]}. Output: {cells:{drug:{s, nt, act, why}}, flags:[...]}.
   * act: "keep" | "intrinsic" (shown as expected resistance, no number) | "hide" (not
   * relevant for this specimen) | "suppress" (impossible or inconsistent; never shown) |
   * "caution" (shown, not pooled). */
  function validateRow(row) {
    var out = { cells: {}, flags: [] }, s = row.s || {}, nt = row.nt || {}, approx = row.approx || [], conflict = row.conflict || {};
    var org = row.org, pheno = row.pheno || null, isStaph = ORGS[org] && ORGS[org].staph;
    if (!(row.n > 0)) out.flags.push("noN");
    else if (row.n < M39_MIN) out.flags.push("lowN");
    var fox = null;
    if (isStaph && !pheno) {
      if (typeof s.cefoxitin === "number") fox = s.cefoxitin;
      else if (typeof s.oxacillin === "number") fox = s.oxacillin;
    }
    Object.keys(s).forEach(function (d) {
      var v = s[d], c = { s: v, nt: nt[d] != null ? nt[d] : null, act: "keep", why: null };
      out.cells[d] = c;
      if (typeof v !== "number" || isNaN(v) || v < 0 || v > 100) { c.act = "suppress"; c.why = "not a percentage between 0 and 100"; return; }
      var ir = intrinsicReason(org, d);
      if (ir) { c.act = "intrinsic"; c.why = ir; return; }
      // The extractor found the source contradicting itself for this figure (e.g. a printed %
      // that its own printed counts do not give).
      if (conflict[d]) { c.act = "caution"; c.why = "the source contradicts itself: " + conflict[d]; return; }
      if (URINE_ONLY.indexOf(d) >= 0 && row.spec && row.spec !== "urine" && row.spec !== "all") { c.act = "hide"; c.why = drugLabel(d) + " is reported for urinary isolates only"; return; }
      if (NOT_RESPIRATORY.indexOf(d) >= 0 && row.spec === "respiratory") { c.act = "hide"; c.why = "daptomycin is inactivated by lung surfactant"; return; }
      if (NOT_URINE.indexOf(d) >= 0 && row.spec === "urine") { c.act = "hide"; c.why = drugLabel(d) + " reaches too little concentration in urine to treat a urinary infection"; return; }
      if (isStaph && (pheno === "MRSA" || pheno === "MR") && v > 0 && (STAPH_BL_LABILE.indexOf(d) >= 0 || STAPH_BL_STABLE.indexOf(d) >= 0 || d === "cefoxitin")) {
        c.act = "suppress"; c.why = "methicillin-resistant staphylococci are resistant to beta-lactams (other than ceftaroline) by definition; the printed figure cannot be right"; return;
      }
      if (isStaph && (pheno === "MSSA" || pheno === "MS") && (d === "cefoxitin" || d === "oxacillin") && v < 100) {
        c.act = "suppress"; c.why = "a methicillin-susceptible row cannot be cefoxitin or oxacillin resistant"; return;
      }
      if (fox != null && d !== "cefoxitin" && d !== "oxacillin" && (STAPH_BL_LABILE.indexOf(d) >= 0 || STAPH_BL_STABLE.indexOf(d) >= 0) && v > fox + 5) {
        c.act = "suppress"; c.why = drugLabel(d) + " susceptibility (" + v + "%) is higher than methicillin (cefoxitin/oxacillin) susceptibility (" + fox + "%), which is impossible: methicillin-resistant strains are beta-lactam resistant"; return;
      }
      if (approx.indexOf(d) >= 0) { c.act = "caution"; c.why = "approximate (read from a chart in the source)"; return; }
      if (!achievable(v, c.nt != null ? c.nt : row.n)) { c.act = "caution"; c.why = "no whole number of the " + (c.nt != null ? c.nt : row.n) + " isolates gives " + v + "%; check the source"; return; }
      if (d === "fosfomycin" && row.spec && row.spec !== "urine" && row.spec !== "all") { c.act = "caution"; c.why = "fosfomycin breakpoints are for urinary isolates; systemic use needs MIC testing"; return; }
      // CLSI (2020 onward) has no susceptible category for colistin or polymyxin B, only
      // intermediate and resistant, and laboratories report these agents in different ways: a 0%
      // (or low) "susceptible" is not a resistance rate. MIC by broth microdilution decides.
      if ((d === "colistin" || d === "polymyxin_b") && v < 50 && (orgGroup(org) === "entero" || orgGroup(org) === "nonferm")) {
        c.act = "caution"; c.why = (v === 0 ? "0%" : "a low figure") + " for colistin or polymyxin B usually reflects the breakpoint system (CLSI has no susceptible category, only intermediate and resistant) rather than resistance; confirm with a broth microdilution MIC"; return;
      }
    });
    // Paired agents that should agree. Cefotaxime and ceftriaxone have the same activity
    // against Enterobacterales, and imipenem and meropenem nearly so for E. coli and
    // Klebsiella; a wide gap means a transcription or testing problem in the source.
    function pair(a, b, gap, why) {
      var ca = out.cells[a], cb = out.cells[b];
      if (!ca || !cb || ca.act !== "keep" || cb.act !== "keep") return;
      if (Math.abs(ca.s - cb.s) > gap) { ca.act = cb.act = "caution"; ca.why = cb.why = why + " (" + drugLabel(a) + " " + ca.s + "%, " + drugLabel(b) + " " + cb.s + "%)"; }
    }
    if (orgGroup(org) === "entero") pair("cefotaxime", "ceftriaxone", 20, "cefotaxime and ceftriaxone should give nearly the same result; the source figures disagree");
    if (org === "ecoli" || org === "klebsiella") pair("imipenem", "meropenem", 25, "imipenem and meropenem should give similar results for this organism; the source figures disagree");
    // Warnings that do not change a cell.
    if ((org === "efaecalis" || org === "efaecium" || org === "enterococcus") && typeof s.vancomycin === "number" && typeof s.teicoplanin === "number" && s.vancomycin > s.teicoplanin + 10)
      out.flags.push("vanco>teico");
    return out;
  }

  /* ----------------------------------------------------------------------------------
   * Pooling across institutions. rows: [{src, inst, year, n, cells:{drug:{s,nt,act}}}].
   * Uses cells with act "keep", rows with n >= 30, and one edition per institution (the
   * latest). Returns {drug: {s, n, k, min, max, parts:[{src, s, n}]}}.
   * ---------------------------------------------------------------------------------- */
  function latestPerInstitution(rows) {
    var best = {};
    rows.forEach(function (r) { var k = r.inst || r.src; if (!best[k] || (r.year || 0) > (best[k].year || 0)) best[k] = { year: r.year || 0, src: r.src }; });
    return rows.filter(function (r) { var b = best[r.inst || r.src]; return b && b.src === r.src; });
  }
  function pool(rows, opts) {
    opts = opts || {};
    var use = opts.allEditions ? rows : latestPerInstitution(rows), out = {};
    use.forEach(function (r) {
      if (!(r.n >= M39_MIN)) return;
      Object.keys(r.cells || {}).forEach(function (d) {
        var c = r.cells[d]; if (!c || c.act !== "keep") return;
        var w = c.nt != null ? c.nt : r.n; if (!(w >= M39_MIN)) return;
        var o = out[d] || (out[d] = { sw: 0, w: 0, k: 0, min: 101, max: -1, parts: [] });
        o.sw += c.s * w; o.w += w; o.k++; if (c.s < o.min) o.min = c.s; if (c.s > o.max) o.max = c.s;
        o.parts.push({ src: r.src, s: c.s, n: w, year: r.year });
      });
    });
    Object.keys(out).forEach(function (d) { var o = out[d]; out[d] = { s: Math.round(10 * o.sw / o.w) / 10, n: o.w, k: o.k, min: o.min, max: o.max, parts: o.parts }; });
    return out;
  }

  /* Derived phenotype rates from one row set (per organism). */
  function phenoRates(byOrg) {
    // byOrg: {orgKey: {drug: {s, n}}} (pooled or single-source), plus optional counts {MRSA:n, MSSA:n}
    var out = [];
    function r(org, label, drugs, note) {
      var d = byOrg[org]; if (!d) return;
      for (var i = 0; i < drugs.length; i++) if (d[drugs[i]] && typeof d[drugs[i]].s === "number") {
        out.push({ org: org, label: label, pct: Math.round(10 * (100 - d[drugs[i]].s)) / 10, n: d[drugs[i]].n || null, basis: drugLabel(drugs[i]) + " resistance", note: note || null }); return;
      }
    }
    r("saureus", "MRSA", ["cefoxitin", "oxacillin"]);
    r("cons", "Methicillin-resistant CoNS", ["cefoxitin", "oxacillin"]);
    r("ecoli", "E. coli 3rd-gen cephalosporin resistant", ["ceftriaxone", "cefotaxime", "ceftazidime"], "proxy for ESBL or AmpC");
    r("klebsiella", "Klebsiella 3rd-gen cephalosporin resistant", ["ceftriaxone", "cefotaxime", "ceftazidime"], "proxy for ESBL or AmpC");
    r("ecoli", "Carbapenem-resistant E. coli", ["meropenem", "imipenem", "ertapenem"]);
    r("klebsiella", "Carbapenem-resistant Klebsiella", ["meropenem", "imipenem", "ertapenem"]);
    r("paeruginosa", "Carbapenem-resistant P. aeruginosa", ["meropenem", "imipenem"]);
    r("acinetobacter", "Carbapenem-resistant Acinetobacter", ["meropenem", "imipenem"]);
    r("efaecium", "Vancomycin-resistant E. faecium", ["vancomycin"]);
    r("efaecalis", "Vancomycin-resistant E. faecalis", ["vancomycin"]);
    r("enterococcus", "Vancomycin-resistant enterococci", ["vancomycin"]);
    r("salmonella_typhi", "Fluoroquinolone non-susceptible S. Typhi", ["ciprofloxacin", "levofloxacin"]);
    r("salmonella_enteric", "Fluoroquinolone non-susceptible typhoidal Salmonella", ["ciprofloxacin", "levofloxacin"]);
    return out;
  }

  /* ----------------------------------------------------------------------------------
   * WISCA from cumulative data. parts: [{org, n, s:{drug:%S}, act:{drug:act}}] for one
   * specimen/setting stratum. regimen: [drugKey] (1 or 2 drugs).
   * Single agent: coverage = sum(n_i * S_i) / sum(n_i) over organisms with data.
   * Two agents: cumulative tables do not say which isolates overlap, so the result is a
   * range: at least sum(n_i * max(Sa, Sb)), at most sum(n_i * min(100, Sa + Sb)).
   * Intrinsic resistance counts as 0% susceptible. Organisms with no data for a drug are
   * left out and reported as the share of isolates not covered by data.
   * ---------------------------------------------------------------------------------- */
  function wisca(parts, regimen) {
    var tot = 0, known = 0, lo = 0, hi = 0, detail = [];
    parts.forEach(function (p) { tot += p.n || 0; });
    parts.forEach(function (p) {
      var ss = regimen.map(function (d) {
        var a = p.act && p.act[d];
        if (a === "intrinsic" || intrinsicReason(p.org, d)) return 0;
        var v = p.s && p.s[d];
        return (typeof v === "number" && (!a || a === "keep")) ? v : null;
      });
      if (ss.some(function (v) { return v == null; })) { detail.push({ org: p.org, n: p.n, s: null }); return; }
      var mx = Math.max.apply(null, ss), sm = Math.min(100, ss.reduce(function (a, b) { return a + b; }, 0));
      known += p.n; lo += p.n * mx; hi += p.n * (regimen.length > 1 ? sm : mx);
      detail.push({ org: p.org, n: p.n, s: mx });
    });
    if (!known) return { coverage: null, low: null, high: null, knownPct: 0, total: tot, detail: detail };
    return { coverage: Math.round(10 * lo / known) / 10, low: Math.round(10 * lo / known) / 10, high: Math.round(10 * hi / known) / 10,
      knownPct: tot ? Math.round(1000 * known / tot) / 10 : 0, total: tot, known: known, detail: detail };
  }

  /* ----------------------------------------------------------------------------------
   * CSV. RFC 4180-ish: quoted fields, doubled quotes, commas/semicolons/tabs detected.
   * ---------------------------------------------------------------------------------- */
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/)[0] || "", delim = ",";
    if ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length) delim = ";";
    if ((first.match(/\t/g) || []).length > (first.match(new RegExp(delim === "," ? "," : ";", "g")) || []).length) delim = "\t";
    var rows = [], row = [], f = "", q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = ""; if (row.some(function (x) { return String(x).trim() !== ""; })) rows.push(row); row = [];
      } else f += ch;
    }
    row.push(f); if (row.some(function (x) { return String(x).trim() !== ""; })) rows.push(row);
    return rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); });
  }

  function findCol(header, names) {
    for (var i = 0; i < header.length; i++) { var h = norm(header[i]).replace(/[_]/g, " "); if (names.indexOf(h) >= 0) return i; }
    return -1;
  }

  /* Summary antibiogram CSV: organism, specimen, setting, n, then one column per drug with
   * %S (numbers; blank = not tested). Returns {rows:[...], errors:[...], warnings:[...]}. */
  // Values in the specimen or setting column that are not recognised are counted under "all" and
  // listed, so the user can rename them (WHONET codes such as "ur" or "bl", local ward names).
  /* Free-text specimen and setting values from a laboratory export (imports only; source files
   * must use the exact keys). */
  function guessSpecimen(v) {
    var t = String(v || "").toLowerCase();
    if (!t.trim()) return null;
    if (/\bcsf\b|cerebro/.test(t)) return "csf";
    if (/blood|\bbl\b|bact/.test(t)) return "blood";
    if (/urin|\bur\b/.test(t)) return "urine";
    if (/sputum|\bbal\b|broncho|trache|\beta\b|resp|\blrt\b|\bsp\b/.test(t)) return "respiratory";
    if (/stool|faec|fec/.test(t)) return "stool";
    if (/pleural|ascit|periton|synovial|bile|fluid/.test(t)) return "sterile";
    if (/pus|wound|swab|tissue|abscess|\bpu\b|\bwd\b/.test(t)) return "pus";
    return null;
  }
  function guessSetting(v) {
    var t = String(v || "").toLowerCase();
    if (!t.trim()) return null;
    if (/icu|intensive|\bccu\b|\bhdu\b|critical/.test(t)) return "icu";
    if (/\bopd\b|out.?patient|clinic/.test(t)) return "opd";
    if (/ward|\bipd\b|in.?patient|\bip\b/.test(t)) return "ward";
    return null;
  }
  function unknownWarn(res, unknown) {
    var sp = Object.keys(unknown.spec).filter(Boolean), se = Object.keys(unknown.set).filter(Boolean);
    if (sp.length) res.warnings.unshift("Specimen values not recognised, counted under all specimens: " + sp.slice(0, 12).join(", ") + (sp.length > 12 ? " and " + (sp.length - 12) + " more" : "") + ". Use blood, urine, respiratory, pus, sterile fluid, CSF or stool.");
    if (se.length) res.warnings.unshift("Setting values not recognised, counted under all settings: " + se.slice(0, 12).join(", ") + (se.length > 12 ? " and " + (se.length - 12) + " more" : "") + ". Use OPD, ward or ICU.");
  }
  function importSummaryCsv(text) {
    var t = parseCsv(text), res = { rows: [], errors: [], warnings: [] }, unknown = { spec: {}, set: {} };
    if (t.length < 2) { res.errors.push("The file has no data rows."); return res; }
    var h = t[0], cOrg = findCol(h, ["organism", "organisms", "pathogen", "bacteria", "isolate"]), cSpec = findCol(h, ["specimen", "sample", "specimen type", "sample type"]),
      cSet = findCol(h, ["setting", "location", "ward", "area", "unit"]), cN = findCol(h, ["n", "isolates", "number", "no. of isolates", "count", "total"]);
    if (cOrg < 0) { res.errors.push("No 'organism' column found."); return res; }
    if (cN < 0) res.warnings.push("No 'n' (isolate count) column: rows cannot be pooled or checked against the 30-isolate rule.");
    var drugCols = [];
    h.forEach(function (x, i) { if (i === cOrg || i === cSpec || i === cSet || i === cN) return; var d = canonDrug(x); if (d) drugCols.push({ i: i, d: d }); else if (String(x).trim()) res.warnings.push("Column '" + x + "' is not a recognised antibiotic and was ignored."); });
    if (!drugCols.length) { res.errors.push("No antibiotic columns recognised."); return res; }
    for (var r = 1; r < t.length; r++) {
      var line = t[r], o = canonOrg(line[cOrg]);
      if (!o) { res.warnings.push("Row " + (r + 1) + ": organism '" + line[cOrg] + "' not recognised; skipped."); continue; }
      var spec = cSpec >= 0 ? (canonSpecimen(line[cSpec]) || guessSpecimen(line[cSpec])) : "all", set = cSet >= 0 ? (canonSetting(line[cSet]) || guessSetting(line[cSet])) : "all";
      if (!spec) { unknown.spec[String(line[cSpec]).trim()] = 1; spec = "all"; }
      if (!set) { unknown.set[String(line[cSet]).trim()] = 1; set = "all"; }
      var n = cN >= 0 ? parseInt(String(line[cN]).replace(/[^0-9]/g, ""), 10) : null;
      var row = { org: o.key, pheno: o.pheno, spec: spec, set: set, n: n > 0 ? n : null, s: {} };
      drugCols.forEach(function (dc) {
        var raw = String(line[dc.i] || "").replace("%", "").trim(); if (raw === "" || raw === "-" || /^n\/?a$/i.test(raw)) return;
        var v = parseFloat(raw); if (isNaN(v)) { res.warnings.push("Row " + (r + 1) + " " + drugLabel(dc.d) + ": '" + raw + "' is not a number; skipped."); return; }
        if (v < 0 || v > 100) { res.warnings.push("Row " + (r + 1) + " " + drugLabel(dc.d) + ": " + v + " is outside 0 to 100; skipped."); return; }
        row.s[dc.d] = v;
      });
      res.rows.push(row);
    }
    unknownWarn(res, unknown);
    return res;
  }

  /* Isolate-level CSV (one row per isolate, drug columns hold S / I / R; SDD counts as not
   * susceptible). Applies CLSI M39: first isolate per patient per organism in the period,
   * %S = S / tested. Patient IDs are hashed in memory and never kept. Returns the same
   * shape as importSummaryCsv plus {isolates, firstIsolates}. */
  function importIsolateCsv(text, opts) {
    opts = opts || {};
    var t = parseCsv(text), res = { rows: [], errors: [], warnings: [], isolates: 0, firstIsolates: 0 };
    if (t.length < 2) { res.errors.push("The file has no data rows."); return res; }
    var h = t[0];
    var cPt = findCol(h, ["patient id", "patient", "uhid", "mrn", "patient no", "patient number", "patient_id", "ip no", "cr no", "reg no"]),
      cDate = findCol(h, ["date", "specimen date", "sample date", "collection date", "spec date", "culture date"]),
      cOrg = findCol(h, ["organism", "organisms", "pathogen", "isolate", "bacteria", "organism name"]),
      cSpec = findCol(h, ["specimen", "sample", "specimen type", "sample type", "spec type"]),
      cSet = findCol(h, ["setting", "location", "ward", "unit", "department", "area"]);
    if (cOrg < 0) { res.errors.push("No 'organism' column found."); return res; }
    if (cPt < 0) res.warnings.push("No patient ID column: duplicate isolates from the same patient cannot be removed (CLSI M39 first-isolate rule not applied).");
    var drugCols = [];
    h.forEach(function (x, i) { if ([cPt, cDate, cOrg, cSpec, cSet].indexOf(i) >= 0) return; var d = canonDrug(x); if (d) drugCols.push({ i: i, d: d }); });
    if (!drugCols.length) { res.errors.push("No antibiotic columns recognised."); return res; }
    function hash(s) { var x = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul ? Math.imul(x, 16777619) : (x * 16777619) >>> 0; } return (x >>> 0).toString(36); }
    function dt(s) { var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s) || null; if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime(); m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s); if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]).getTime(); } return null; }
    var from = opts.from ? dt(opts.from) : null, to = opts.to ? dt(opts.to) : null;
    var isolates = [], expert = 0, unknown = { spec: {}, set: {} };
    for (var r = 1; r < t.length; r++) {
      var line = t[r], o = canonOrg(line[cOrg]);
      if (!o) { if (String(line[cOrg] || "").trim()) res.warnings.push("Row " + (r + 1) + ": organism '" + line[cOrg] + "' not recognised; skipped."); continue; }
      var when = cDate >= 0 ? dt(line[cDate]) : null;
      if (from != null && when != null && when < from) continue;
      if (to != null && when != null && when > to) continue;
      var res1 = {};
      drugCols.forEach(function (dc) { var v = String(line[dc.i] || "").trim().toUpperCase(); if (v === "S" || v === "I" || v === "R" || v === "SDD" || v === "NS") res1[dc.d] = v; });
      // CLSI expert rule: a methicillin-resistant staphylococcus is resistant to beta-lactams
      // (except ceftaroline) whatever the individual results say. The methicillin result also
      // gives the phenotype (MRSA/MSSA, MR/MS CoNS) when the name did not.
      var pheno = o.pheno;
      if (ORGS[o.key] && ORGS[o.key].staph) {
        var mr = res1.cefoxitin === "R" || res1.oxacillin === "R", ms = !mr && (res1.cefoxitin === "S" || res1.oxacillin === "S");
        if (mr) STAPH_BL_LABILE.concat(STAPH_BL_STABLE).forEach(function (d) { if (res1[d] && res1[d] !== "R") { res1[d] = "R"; expert++; } });
        if (!pheno && (mr || ms)) pheno = o.key === "saureus" ? (mr ? "MRSA" : "MSSA") : (mr ? "MR" : "MS");
      }
      var sp = cSpec >= 0 ? (canonSpecimen(line[cSpec]) || guessSpecimen(line[cSpec])) : "all", se = cSet >= 0 ? (canonSetting(line[cSet]) || guessSetting(line[cSet])) : "all";
      if (!sp) { unknown.spec[String(line[cSpec]).trim()] = 1; sp = "all"; }
      if (!se) { unknown.set[String(line[cSet]).trim()] = 1; se = "all"; }
      isolates.push({ pt: cPt >= 0 ? hash(line[cPt]) : "row" + r, when: when == null ? r : when, org: o.key, pheno: pheno, named: o.pheno, spec: sp, set: se, res: res1 });
    }
    res.isolates = isolates.length;
    isolates.sort(function (a, b) { return a.when - b.when; });
    var seen = {}, first = [];
    isolates.forEach(function (x) { var k = x.pt + "|" + x.org; if (seen[k]) return; seen[k] = 1; first.push(x); });
    res.firstIsolates = first.length;
    if (expert) res.warnings.push(expert + " beta-lactam results of methicillin-resistant staphylococci were set to resistant (CLSI expert rule).");
    unknownWarn(res, unknown);
    var groups = {};
    first.forEach(function (x) {
      var combos = [], seenC = {};
      [[x.spec, x.set], [x.spec, "all"], ["all", x.set], ["all", "all"]].forEach(function (ss) { var ck = ss[0] + "|" + ss[1]; if (!seenC[ck]) { seenC[ck] = 1; combos.push(ss); } });
      // A staphylococcus counts in the organism row and, when its methicillin result is known,
      // in the MRSA/MSSA row too (unless the file named the phenotype as the organism).
      var phenos = x.named ? [x.named] : (x.pheno ? [null, x.pheno] : [null]);
      combos.forEach(function (ss) {
        phenos.forEach(function (ph) {
          var k = x.org + "|" + (ph || "") + "|" + ss[0] + "|" + ss[1];
          var g = groups[k] || (groups[k] = { org: x.org, pheno: ph, spec: ss[0], set: ss[1], n: 0, S: {}, T: {} });
          g.n++;
          Object.keys(x.res).forEach(function (d) { g.T[d] = (g.T[d] || 0) + 1; if (x.res[d] === "S") g.S[d] = (g.S[d] || 0) + 1; });
        });
      });
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], row = { org: g.org, pheno: g.pheno, spec: g.spec, set: g.set, n: g.n, s: {}, nt: {} };
      Object.keys(g.T).forEach(function (d) { row.s[d] = Math.round(1000 * (g.S[d] || 0) / g.T[d]) / 10; row.nt[d] = g.T[d]; });
      res.rows.push(row);
    });
    return res;
  }

  /* Template the import screen offers for download. */
  function summaryTemplate() {
    return "organism,specimen,setting,n,AMK,GEN,AMC,TZP,CRO,CAZ,FEP,CIP,SXT,NIT,MEM,IPM,CST,VAN,LNZ,FOX\n" +
      "Escherichia coli,urine,opd,120,92,70,48,76,30,32,35,28,45,90,95,95,,,,\n" +
      "Staphylococcus aureus,blood,icu,40,,55,,,,,,20,60,,,,,100,100,45\n";
  }
  function isolateTemplate() {
    return "patient_id,date,specimen,location,organism,AMK,CRO,MEM,CIP,SXT,VAN,FOX\n" +
      "P001,2026-01-04,urine,opd,Escherichia coli,S,R,S,R,S,,\n" +
      "P002,2026-01-09,blood,icu,Staphylococcus aureus,,,,R,S,S,R\n";
  }

  return {
    DRUGS: DRUGS, ORGS: ORGS, SPECIMENS: SPECIMENS, SETTINGS: SETTINGS, M39_MIN: M39_MIN,
    ORG_INTRINSIC: ORG_INTRINSIC, GROUP_INTRINSIC: GROUP_INTRINSIC, URINE_ONLY: URINE_ONLY,
    canonDrug: canonDrug, canonOrg: canonOrg, canonSpecimen: canonSpecimen, canonSetting: canonSetting,
    drugLabel: drugLabel, orgLabel: orgLabel, orgShort: orgShort, orgGroup: orgGroup, aware: aware,
    intrinsicReason: intrinsicReason, achievable: achievable, validateRow: validateRow,
    latestPerInstitution: latestPerInstitution, pool: pool, phenoRates: phenoRates, wisca: wisca,
    parseCsv: parseCsv, importSummaryCsv: importSummaryCsv, importIsolateCsv: importIsolateCsv,
    summaryTemplate: summaryTemplate, isolateTemplate: isolateTemplate
  };
});
