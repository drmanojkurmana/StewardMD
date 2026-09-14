/* wardsynq/site/i18n/te.js - తెలుగు catalog for the WardSynQ patient portal. D6.
 *
 * Owned by Antigravity: see docs/wardsynq/TRANSLATION_BRIEF_ANTIGRAVITY.md before editing.
 * reviewed:false - NOT yet checked by a native speaker with clinical context. English (i18n.js) is
 * the fallback for any key not yet here, so an empty or partial file is always safe to ship.
 *
 * First pass imported from Antigravity's branch feat/wardsynq-multilingual-emr (363117f5), checked for
 * clinical meaning (negation, numbers, placeholders) but not by a native speaker.
 *
 * This file does ONE thing: register this catalog with the engine (window.WSQI18n, loaded first).
 * module.exports = the catalog, for tests. No other logic belongs here.
 */
(function (root) {
  "use strict";

  var catalog = {
    "lang.label": "భాష",
    "lang.codedNote": "మందుల పేర్లు, మోతాదులు, పరీక్షల పేర్లు, ఫలితాలు మరియు నిర్ధారణలు మీ వైద్య బృందం నమోదు చేసినట్లే చూపబడతాయి. వాటిని అనువదించరు.",

    "portal.title.yours": "మీ రికార్డు",
    "portal.title.proxy": "{name} గారి రికార్డు",
    "portal.thePatient": "రోగి",
    "portal.proxyNote": "మీరు {relationship} గా, రోగి అంగీకారంతో చూస్తున్నారు. వారు పంచుకోవడానికి అంగీకరించినది మాత్రమే మీరు చూడగలరు.",
    "portal.familyMember": "కుటుంబ సభ్యుడు",

    "section.failed": "మీ రికార్డులోని ఈ భాగాన్ని లోడ్ చేయలేకపోయాము. ఇక్కడ ఏమీ లేదని దీని అర్థం కాదు. తర్వాత మళ్లీ ప్రయత్నించండి.",

    "appt.title": "అపాయింట్‌మెంట్లు",
    "appt.tbc": "సమయం ధృవీకరించాలి",
    "appt.with": "{who} తో",
    "appt.empty": "ఏ అపాయింట్‌మెంట్లు బుక్ కాలేదు.",
    "appt.ask": "అపాయింట్‌మెంట్ కోసం అడగండి",
    "appt.askNote": "ఇది కేవలం అభ్యర్థనను పంపుతుంది. ఆసుపత్రి మిమ్మల్ని సంప్రదించే వరకు ఏమీ బుక్ కాదు.",
    "appt.reason": "ఇది దేని కోసం?",
    "appt.pref": "మీకు అనుకూలమైన రోజులు లేదా సమయాలు (ఐచ్ఛికం)",
    "appt.send": "అభ్యర్థన పంపండి",
    "appt.sent": "అభ్యర్థన పంపబడింది.",

    "meds.title": "ప్రిస్క్రిప్షన్లు మరియు మందులు",
    "meds.empty": "ప్రస్తుత మందులు ఏవీ జాబితాలో లేవు.",

    "results.title": "ల్యాబ్ మరియు రేడియాలజీ ఫలితాలు",
    "results.empty": "మీతో ఇంకా ఏ ఫలితాలు పంచుకోబడలేదు.",

    "dx.title": "నిర్ధారణలు",
    "dx.empty": "ఏ నిర్ధారణలు జాబితాలో లేవు.",

    "allergy.title": "అలర్జీలు",
    "allergy.empty": "ఏ అలర్జీలు నమోదు కాలేదు.",

    "dc.title": "డిశ్చార్జి సారాంశాలు మరియు సంరక్షణ సూచనలు",
    "dc.stay": "మీ బస",
    "dc.meds": "మందులు",
    "dc.care": "సంరక్షణ సూచనలు",
    "dc.empty": "మీతో ఏ డిశ్చార్జి సారాంశం పంచుకోబడలేదు.",

    "bills.title": "బిల్లులు మరియు చెల్లింపులు",
    "bills.cancelled": "రద్దు చేయబడింది",
    "bills.paid": "చెల్లించబడింది",
    "bills.due": "మిగిలిన బకాయి {amount}",
    "bills.summary": "ఛార్జి {charged}, చెల్లించినది {paid}",
    "bills.empty": "మీకు బిల్లులు లేవు.",

    "consents.title": "సమ్మతులు",
    "consents.withdraw": "ఈ సమ్మతిని ఉపసంహరించండి",
    "consents.speak": "దీన్ని ఉపసంహరించడానికి మీ వైద్య బృందంతో మాట్లాడండి.",
    "consents.empty": "ఏ సమ్మతులు నమోదు కాలేదు.",
    "consents.confirm": "ఇప్పటి నుండి ఈ సమ్మతిని ఉపసంహరించాలా? మీ వైద్య బృందం దీన్ని చూస్తుంది.",

    "msg.title": "మీ వైద్య బృందానికి సందేశాలు",
    "msg.notEmergency": "ఇది అత్యవసర సహాయం పొందే మార్గం కాదు.",
    "msg.label": "మీ సందేశం",
    "msg.send": "సందేశం పంపండి",
    "msg.sent": "పంపబడింది.",
    "msg.reply": "సమాధానం {when}:",
    "msg.unanswered": "ఇంకా సమాధానం రాలేదు.",
    "msg.empty": "మీరు ఇంకా ఏ సందేశాలు పంపలేదు.",
    "msg.writeFirst": "ముందు సందేశం రాయండి.",

    "phase.loading": "మీ రికార్డు లోడ్ అవుతోంది...",
    "phase.failed": "మీ రికార్డును లోడ్ చేయలేకపోయాము. ఇది కనెక్షన్ లేదా సర్వర్ సమస్య, రికార్డు ఖాళీ అని కాదు.",
    "phase.retry": "మళ్లీ ప్రయత్నించండి",
    "phase.ended": "మీ సెషన్ ముగిసింది.",
    "phase.newCode": "కొత్త కోడ్ కోసం మీ వైద్య బృందాన్ని అడగండి.",
    "phase.startAgain": "మళ్లీ ప్రారంభించండి",

    "signout": "సైన్ అవుట్",

    "signin.title": "మీ రికార్డులోకి సైన్ ఇన్ చేయండి",
    "signin.intro": "మీ వైద్య బృందం మీకు స్వయంగా ఇచ్చిన యాక్సెస్ ID మరియు కోడ్‌ను వాడండి. కోడ్ ఒక్కసారి మాత్రమే పనిచేస్తుంది.",
    "signin.hospital": "ఆసుపత్రి ID",
    "signin.access": "యాక్సెస్ ID",
    "signin.code": "కోడ్",
    "signin.submit": "సైన్ ఇన్",
    "signin.checking": "తనిఖీ చేస్తోంది...",
    "signin.invalid": "ఆ కోడ్ చెల్లదు.",
    "signin.unreachable": "ఆసుపత్రిని చేరుకోలేకపోయాము. మీ కనెక్షన్ తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.",

    "action.failed": "అది పూర్తి కాలేదు. ఏమీ పంపబడలేదు.",
    "action.failedShort": "అది పూర్తి కాలేదు.",

    "status.title": "ఈరోజు OPD క్యూలో మీ స్థానం",
    "status.loading": "క్యూ తనిఖీ చేస్తోంది...",
    "status.failed": "మీ క్యూ స్థితిని లోడ్ చేయలేకపోయాము. మీరు క్యూలో లేరని దీని అర్థం కాదు. దయచేసి డెస్క్ వద్ద అడగండి.",
    "status.off": "ఈ ఆసుపత్రి ఇక్కడ క్యూ స్థితిని చూపదు. దయచేసి డెస్క్ వద్ద అడగండి.",
    "status.ambiguous": "క్యూలో ఏ ఎంట్రీ మీదో మేము ఖచ్చితంగా చెప్పలేము, కాబట్టి ఏదీ చూపలేదు. దయచేసి డెస్క్ వద్ద అడగండి.",
    "status.empty": "మీరు ఈరోజు OPD క్యూలో లేరు.",
    "status.where": "ఎక్కడ: {place}",
    "status.desk": "రిజిస్ట్రేషన్ డెస్క్, ఇంకా ఏ గదికి పంపలేదు",
    "status.state.waiting": "వేచి ఉన్నారు",
    "status.state.called": "మిమ్మల్ని పిలిచారు. దయచేసి ఇప్పుడే లోపలికి వెళ్లండి.",
    "status.state.in-consultation": "డాక్టర్‌తో",
    "status.state.investigation": "పరీక్షల కోసం వెళ్లారు",
    "status.state.done": "పూర్తయింది",
    "status.state.cancelled": "రద్దు చేయబడింది",
    "status.state.missed": "మీ వంతు తప్పిపోయింది. దయచేసి డెస్క్ వద్ద అడగండి.",
    "status.token": "మీ టోకెన్: {token}",
    "status.aheadNone": "తర్వాతి వంతు మీదే",
    "status.aheadOne": "మీ కంటే ముందు 1 వ్యక్తి ఉన్నారు",
    "status.ahead": "మీ కంటే ముందు {n} మంది ఉన్నారు",
    "status.eta": "అంచనా సమయం: {time}",
    "status.noEta": "సమయ అంచనా లేదు",
    "status.refresh": "మళ్లీ తనిఖీ చేయండి",

    "docs.title": "మీ వైద్య బృందం నుండి పత్రాలు",
    "docs.empty": "మీతో ఏ పత్రాలు పంచుకోబడలేదు.",
    "docs.version": "వెర్షన్ {n}",
    "docs.download": "డౌన్‌లోడ్",
    "docs.downloading": "డౌన్‌లోడ్ అవుతోంది...",
    "docs.failed": "ఈ పత్రాన్ని డౌన్‌లోడ్ చేయలేకపోయాము. తర్వాత మళ్లీ ప్రయత్నించండి.",
    "docs.withdrawn": "ఆసుపత్రి ఒక పత్రాన్ని ఉపసంహరించింది.",
    "docs.unavailable": "ఒక పత్రం ఇక అందుబాటులో లేదు.",
    "docs.type.consent": "సమ్మతి పత్రం",
    "docs.type.referral-letter": "రెఫరల్ లేఖ",
    "docs.type.outside-report": "మరో ఆసుపత్రి నివేదిక",
    "docs.type.outside-imaging": "మరో ఆసుపత్రి స్కాన్",
    "docs.type.id-proof": "గుర్తింపు పత్రం",
    "docs.type.insurance": "బీమా",
    "docs.type.prescription-outside": "మరో డాక్టర్ ప్రిస్క్రిప్షన్",
    "docs.type.other": "ఇతర పత్రం",

    "dc.full": "పూర్తి డిశ్చార్జి సారాంశం",
    "dc.print": "ఈ సారాంశాన్ని ప్రింట్ చేయండి",
    "dc.withheld": "మీ వైద్య బృందం మీతో దీని గురించి మాట్లాడే వరకు ఇది నిలిపివేయబడింది.",
    "dc.section.admission": "మీ బస",
    "dc.section.diagnoses": "నిర్ధారణలు",
    "dc.section.allergies": "అలర్జీలు",
    "dc.section.vitals": "పరిశీలనలు",
    "dc.section.investigations": "పరీక్షలు",
    "dc.section.medications": "ఆసుపత్రిలో మందులు",
    "dc.section.homeMedicines": "బసకు ముందటి మందులు",
    "dc.section.assessment": "డాక్టర్ అంచనా",
    "dc.section.plan": "సంరక్షణ ప్రణాళిక",

    "pcopy.noAllergies": "మీకు ఏ అలర్జీలు నమోదు కాలేదు. మీకు తెలిసినవి ఉంటే మీ వైద్య బృందానికి చెప్పండి.",
    "pcopy.dx": "మీ నిర్ధారణలు",
    "pcopy.dxEmpty": "ఏ నిర్ధారణలు నమోదు కాలేదు.",
    "pcopy.meds": "మీ మందులు",
    "pcopy.medsEmpty": "ఏ మందులు నమోదు కాలేదు.",
    "pcopy.results": "మీ ఫలితాలు",
    "pcopy.resultsEmpty": "మీకు ఇవ్వడానికి ఇంకా ఏ ఫలితాలు సిద్ధంగా లేవు.",
    "pcopy.withheld": "ఇక్కడ చేర్చలేదు",
    "pcopy.appts": "తర్వాతి అపాయింట్‌మెంట్లు",
    "pcopy.apptsEmpty": "ఏ అపాయింట్‌మెంట్ బుక్ కాలేదు.",
    "pcopy.print": "ప్రింట్",

    "nav.map": "మ్యాప్",
    "nav.workstation": "వర్క్‌స్టేషన్",
    "nav.ward": "వార్డు",
    "nav.beds": "బెడ్ బోర్డు",
    "nav.emergency": "అత్యవసరం",
    "nav.criticals": "క్రిటికల్ ఫలితాలు",
    "nav.lab": "ప్రయోగశాల",
    "nav.radiology": "రేడియాలజీ",
    "nav.opd": "OPD డెస్క్",
    "nav.patients": "రోగులు",
    "nav.command": "కమాండ్",
    "nav.commandCenter": "కమాండ్ సెంటర్",
    "nav.twin": "డిజిటల్ ట్విన్",
    "nav.reports": "నివేదికలు",
    "nav.billing": "బిల్లింగ్",
    "nav.integration": "ఇంటిగ్రేషన్",
    "nav.administration": "నిర్వహణ",
    "nav.adminCenter": "అడ్మిన్ సెంటర్",
    "nav.audit": "ఆడిట్ మరియు భద్రత",
    "nav.security": "సైన్-ఇన్ భద్రత",
    "nav.rota": "సిబ్బంది రోస్టర్",
    "nav.accounts": "ఖాతాలు"
  };

  if (root && root.WSQI18n) root.WSQI18n.register("te", "తెలుగు", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
