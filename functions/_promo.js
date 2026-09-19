/* StewardMD - the promotional email series.
 *
 * Seven editions, each selling TWO or THREE features like an advertisement: one big figure, one
 * line, a tile per feature, one button. The price is always quoted per day and always derived from
 * the live plan amounts (functions/_pricing.js), never typed into the copy.
 *
 * Every edition is marketing, so emailPromo() attaches the unsubscribe link and headers, and the
 * nightly sweep (functions/_lifecycle.js promoSweep) skips anyone who unsubscribed or already pays.
 *
 * Copy rules: no em-dash (CLAUDE.md); imaging modules are decision support, never "a report"; nothing
 * here may state or imply a diagnosis. Keep every claim to what the app ships today.
 */
import { hero, tile, ctaRow, priceLine, note } from "./_email.js";
import { sendBranded } from "./_email.js";
import { dayPrices, inr } from "./_pricing.js";

const APP = "https://stewardmd.in";
const PRO = APP + "/?pro=1";

export const PROMO_EDITIONS = ["maik", "bedside", "imaging", "reason", "prescribe", "practice", "annual"];

function chai(p) { return "Pro from " + inr(p.pro.day) + " a day. A roadside chai costs about the same."; }

const EDITIONS = {
  maik: function (p) { return {
    subject: "Your AI resident. " + inr(p.pro.day) + " a day.",
    title: "Meet MaiK.",
    subtitle: "An AI resident who has read the whole knowledge base, never sleeps, and costs less than a chai.",
    preheader: "Ask the case, read the image, write the note. MaiK, from " + inr(p.pro.day) + " a day.",
    bodyHtml:
      hero({ eyebrow: "MaiK AI", big: "Ask the case.", small: "Type it or dictate it. MaiK answers with citations, and when you name a score it opens the calculator instead of guessing." }) +
      tile({ eyebrow: "Imaging", glyph: "&#128247;", title: "Reads the picture.", text: "Snap an ECG, a chest film, a fundus or a skin lesion. MaiK describes what it sees to support your read, never to replace it." }) +
      tile({ eyebrow: "Scribe", glyph: "&#127908;", title: "Writes the note.", text: "Dictate at the bedside. A structured note appears, ready to review and sign." }) +
      tile({ eyebrow: "Evidence", glyph: "&#128218;", title: "Cites its sources.", text: "Every answer is grounded in the StewardMD Knowledge Base, with the reference beside the claim." }) +
      ctaRow("Try MaiK", PRO, "See every Pro feature", PRO) + priceLine(chai(p)),
  }; },

  bedside: function (p) { return {
    subject: "The ward, in your pocket. " + inr(p.pro.day) + " a day.",
    title: "The ward comes to you.",
    subtitle: "Your live ward list, the critical results, the drips. Before the phone rings.",
    preheader: "Ward Sync, Lab Watch 24/7 and the ICU dashboard, for less than a bottle of water.",
    bodyHtml:
      hero({ eyebrow: "Lab Watch", big: "24/7", small: "An alert the moment a critical result lands, even with the app closed and the phone in your pocket." }) +
      tile({ eyebrow: "Ward Sync", glyph: "&#128203;", title: "Your ward list. One tap.", text: "Pull the live list from the hospital system and see every admission, every pending lab, in seconds." }) +
      tile({ eyebrow: "ICU dashboard", glyph: "&#10084;&#65039;", title: "MAP, lactate, urine output, drips.", text: "Live targets, an event log, and a view your whole team shares." }) +
      tile({ eyebrow: "Infusions", glyph: "&#128137;", title: "Pump rate in one tap.", text: "24 drugs with weight-based dosing, a full monograph and a Nurse Mode you can print." }) +
      ctaRow("Open the ward tools", PRO, "Compare plans", PRO) + priceLine("Pro from " + inr(p.pro.day) + " a day. Less than a bottle of water at the canteen."),
  }; },

  imaging: function (p) { return {
    subject: "Four image readers. One camera. " + inr(p.pro.day) + " a day.",
    title: "Point the camera.",
    subtitle: "ECG, chest X-ray, fundus and skin: an AI second look on every one, from the phone already in your hand.",
    preheader: "KardiQ X, ThoreX, FundX and SknX. Decision support on a photo.",
    bodyHtml:
      hero({ eyebrow: "Imaging AI", big: "ECG. CXR.<br>Fundus. Skin.", size: 44, small: "Four specialist readers, on-device where possible, each one built to support your judgement, not replace it." }) +
      tile({ eyebrow: "KardiQ X", glyph: "&#128147;", title: "The ECG, read from a photo.", text: "Rhythm, intervals, the STEMI question, with the confidence shown." }) +
      tile({ eyebrow: "ThoreX", glyph: "&#129729;", title: "The chest film, in seconds.", text: "Consolidation, effusion, pneumothorax and cardiomegaly flagged for your review." }) +
      tile({ eyebrow: "FundX and SknX", glyph: "&#128065;&#65039;", title: "The fundus and the lesion.", text: "Retinal red flags and dermatology support, with the differential you would expect from a colleague." }) +
      ctaRow("Open the imaging suite", PRO, "How the readers work", PRO) + priceLine(chai(p)) +
      note("Imaging AI is decision support. It never makes a diagnosis and every read is for a registered clinician to confirm."),
  }; },

  reason: function (p) { return {
    subject: "Think like a consultant. Free.",
    title: "Zero rupees.",
    subtitle: "The clinical reasoning engine, every calculator and every drug check are free, forever. Pro is only the AI layer on top.",
    preheader: "Live differentials, stewardship and calculators, free. Pro adds the AI from " + inr(p.pro.day) + " a day.",
    bodyHtml:
      hero({ eyebrow: "Clinical Reasoning Engine", big: inr(0), small: "A differential that re-ranks as you add findings, splits infectious from non-infectious, and explains why it moved." }) +
      tile({ eyebrow: "Stewardship", glyph: "&#128138;", title: "Empiric to definitive.", text: "Likely organisms, coverage, dose, route, duration and de-escalation, with your hospital policy and AWaRe class on every drug." }) +
      tile({ eyebrow: "Calculators", glyph: "&#129518;", title: "Every score you type.", text: "CURB-65 to HACOR, CrCl to MELD. Ask by name and the calculator opens." }) +
      ctaRow("Open StewardMD", APP, "What Pro adds", PRO) + priceLine("Free forever. Pro adds MaiK AI, Ward Sync and Lab Watch from " + inr(p.pro.day) + " a day."),
  }; },

  prescribe: function (p) { return {
    subject: "Prescribe with the database behind you.",
    title: "Prescribe with confidence.",
    subtitle: "A generator that knows the dose, a scanner that knows the interaction, and an insulin tool that knows the ward.",
    preheader: "The prescription generator, Scan-Meds and dosing tools.",
    bodyHtml:
      hero({ eyebrow: "Prescription generator", big: "&#8478;", size: 72, small: "Database-driven dosing, renal adjustment and a clean printable prescription, for verified doctors." }) +
      tile({ eyebrow: "Scan-Meds", glyph: "&#128248;", title: "Scan the strip. See the interaction.", text: "Photograph the medicines in the patient's bag and get the drug index and interaction check at once." }) +
      tile({ eyebrow: "Insulin and infusions", glyph: "&#128137;", title: "Titrate without the spreadsheet.", text: "Insulin regimens, sliding scales and every infusion rate, with your unit's own concentrations." }) +
      ctaRow("Verify and start prescribing", APP, "Compare plans", PRO) + priceLine("Verified doctors get Pro free for 7 days, then from " + inr(p.pro.day) + " a day."),
  }; },

  practice: function (p) { return {
    subject: "Run the practice, not the paperwork.",
    title: "Your OPD, organised.",
    subtitle: "A queue that runs itself, a follow-up that checks on the patient for you, and a logbook the council will accept.",
    preheader: "OPD Queue, FollowCare AI and the NMC Logbook.",
    bodyHtml:
      hero({ eyebrow: "OPD Queue", big: "Next, please.", small: "Tokens, live wait times and a display board, from any phone in the clinic." }) +
      tile({ eyebrow: "FollowCare AI", glyph: "&#128172;", title: "The follow-up that follows up.", text: "Scheduled WhatsApp or SMS check-ins after discharge, escalated to you when a reply worries it. It never changes a prescription." }) +
      tile({ eyebrow: "NMC Logbook", glyph: "&#128221;", title: "Every case, logged.", text: "Procedures and cases recorded as you go, exported the way the council wants them." }) +
      ctaRow("Set up my clinic", PRO, "Compare plans", PRO) + priceLine(chai(p)),
  }; },

  annual: function (p) { return {
    subject: "A year of Pro. " + inr(p.annual.day) + " a day.",
    title: inr(p.annual.day) + " a day.",
    subtitle: "A whole year of StewardMD Pro for " + inr(p.annual.year) + ". A pastry costs more.",
    preheader: "Pro for a year at " + inr(p.annual.day) + " a day. Trainees from " + inr(p.trainee.day) + ".",
    bodyHtml:
      hero({ eyebrow: "Pro, yearly", big: inr(p.annual.year) + "/year", size: 48, small: "That is " + inr(p.annual.day) + " a day for MaiK AI, Ward Sync, Lab Watch 24/7, the imaging suite and team collaboration." }) +
      tile({ eyebrow: "Trainee", glyph: "&#127891;", title: inr(p.trainee.day) + " a day.", text: "Interns, residents and fellows with a verified registration pay " + inr(p.trainee.month) + " a month. Less than a cup of chai." }) +
      tile({ eyebrow: "Co-resident", glyph: "&#128101;", title: "Two seats. " + inr(p.coresident.perSeatDay) + " a day each.", text: "Share one plan with the colleague on the opposite shift, for " + inr(p.coresident.month) + " a month." }) +
      ctaRow("Choose a plan", PRO, "See everything Pro includes", PRO) + priceLine("Monthly " + inr(p.pro.month) + ". Yearly " + inr(p.annual.year) + ". Verified doctors try Pro free for 7 days."),
  }; },
};

// Resolve an edition by id or index. Returns { id, subject, title, subtitle, preheader, bodyHtml } or null.
export function promoEdition(env, which) {
  var id = typeof which === "number" ? PROMO_EDITIONS[which] : String(which || "");
  var f = EDITIONS[id];
  if (!f) return null;
  var e = f(dayPrices(env)); e.id = id;
  return e;
}

// Send one edition. Marketing: the unsubscribe link and headers are attached by sendBranded.
export function emailPromo(env, { email, name, uid, edition }) {
  var e = promoEdition(env, edition);
  if (!e) return Promise.resolve({ ok: false, reason: "no-edition" });
  return sendBranded(env, { to: email, uid: uid, kind: "marketing", subject: e.subject, title: e.title, subtitle: e.subtitle, preheader: e.preheader, bodyHtml: e.bodyHtml });
}
