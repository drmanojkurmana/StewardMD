/* codeblue-trainer-data.js — Megacode and ACLS practice content (StewardMD Code Blue trainer).
 * Self-contained: no network, no doses, no real ECGs. Rhythms are text labels only.
 * Guideline basis: AHA 2020 ACLS/PALS/NRP. Each scenario cites its source string.
 * British spelling. No emojis, no em-dashes.
 *
 * Schema:
 *   SCENARIOS: [{id, mode, title, level, src, states:[{p, o:[[label,correct,why]x3], c, due, t:[topics]}]}]
 *     p: state prompt (rhythm shown as text). o: [label, isCorrect, whyWrongOrRight].
 *     c: one-sentence coach line for the correct pick. due: sim seconds allowed before "late".
 *   CASES: [{id, mode, level, title, vignette, clues:[{at, text}], quiz:[{q, o:[4], a, why, topic}]}]
 *     at: sim seconds after case open when the clue appears.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CodeBlueTrainerData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ADULT_SRC = "AHA 2020 adult cardiac arrest algorithm";
  var BRADY_SRC = "AHA 2020 adult bradycardia algorithm";
  var TACHY_SRC = "AHA 2020 adult tachycardia algorithm";
  var ROSC_SRC = "AHA 2020 post cardiac arrest care";
  var PALS_SRC = "AHA 2020 paediatric cardiac arrest algorithm";
  var PALS_BRADY_SRC = "AHA 2020 paediatric bradycardia algorithm";
  var PALS_TACHY_SRC = "AHA 2020 paediatric tachycardia algorithm";
  var NRP_SRC = "AHA 2020 neonatal resuscitation";

  var SCENARIOS = [
    {
      id: "adult-vf-1", mode: "adult", level: "easy", title: "Witnessed collapse with VF", src: ADULT_SRC,
      states: [
        { p: "A patient collapses. No response, no normal breathing, no pulse. Pads are on the trolley.",
          o: [["Start CPR and attach the defibrillator pads", 1, "Correct: compressions start at once and pads allow a rhythm check with minimal pause."],
            ["Fetch the airway trolley first", 0, "Airway kit can wait: compressions and pads come first in witnessed collapse."],
            ["Wait for the resuscitation team before touching the patient", 0, "Waiting costs perfusion: start CPR now and the team joins in."]],
          c: "Immediate CPR plus early pads gives the fastest safe shock for VF.",
          due: 60, t: ["team roles", "defibrillation"] },
        { p: "Monitor shows VF. The patient remains pulseless.",
          o: [["Deliver a shock, then resume CPR at once", 1, "Correct: shock ends VF and compressions restart within seconds to keep perfusion up."],
            ["Give epinephrine before any shock", 0, "Epinephrine comes after the second shock here, not before the first."],
            ["Pause CPR for a full minute to confirm the rhythm", 0, "Long pauses drop survival: confirm fast, shock, resume."]],
          c: "Shockable rhythm means shock first, with only a brief pause in compressions.",
          due: 60, t: ["rhythm recognition", "defibrillation"] },
        { p: "Two minutes of CPR done. Monitor shows VF. This is the second shock point.",
          o: [["Deliver the second shock, resume CPR, give epinephrine", 1, "Correct: epinephrine is due after the second shock while cycles continue."],
            ["Stop CPR to secure an advanced airway now", 0, "Airway work must not stop cycles: shocks, CPR and epinephrine come first."],
            ["Shock three times in a row without CPR between", 0, "Stacked shocks are outdated: one shock, then two minutes of CPR."]],
          c: "After the second shock, epinephrine joins continued CPR cycles.",
          due: 90, t: ["defibrillation", "epinephrine timing"] },
        { p: "Two more minutes of CPR. Monitor shows VF. This is the third shock point.",
          o: [["Deliver the third shock and consider amiodarone or lidocaine", 1, "Correct: an antiarrhythmic is considered after the third shock."],
            ["Give the first dose of epinephrine now", 0, "Epinephrine was already due after the second shock, so this is late."],
            ["Stop the resuscitation attempt", 0, "Refractory VF still has reversible causes to check before stopping."]],
          c: "Persistent VF after three shocks calls for an antiarrhythmic plus cause hunting.",
          due: 90, t: ["defibrillation", "reversible causes"] },
        { p: "Still VF after the third shock. CPR continues. No cause found yet.",
          o: [["Run through the Hs and Ts while CPR continues", 1, "Correct: hypoxia, hypovolaemia, tamponade and the rest are treatable and often missed."],
            ["Pause CPR for five minutes to rest the team", 0, "Rest breaks without compressions harm the patient: rotate compressors instead."],
            ["Give epinephrine every thirty seconds", 0, "Epinephrine repeats every three to five minutes, not every half minute."]],
          c: "Treatable causes hide behind refractory VF, so hunt them without pausing CPR.",
          due: 120, t: ["reversible causes"] },
        { p: "Monitor shows sinus rhythm with a pulse. Blood pressure is measurable. ROSC achieved.",
          o: [["Begin post-ROSC care: oxygen, monitoring, 12-lead ECG, find the cause", 1, "Correct: ROSC starts a new phase of oxygen titration, monitoring and cause finding."],
            ["Stop all monitoring now the pulse is back", 0, "Re-arrest is common: monitoring and cause finding continue after ROSC."],
            ["Deliver one more shock to stabilise the rhythm", 0, "Never shock a perfusing rhythm: shocks are for pulseless VF and pulseless VT only."]],
          c: "ROSC shifts the goal to oxygen titration, monitoring and treating the cause.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "adult-pea-1", mode: "adult", level: "easy", title: "PEA after a fall", src: ADULT_SRC,
      states: [
        { p: "Unresponsive, no pulse. Pads attached. Monitor shows organised complexes but no pulse: PEA.",
          o: [["Start CPR and give epinephrine as soon as possible", 1, "Correct: non-shockable arrest needs epinephrine early plus continuous cycles."],
            ["Deliver a shock to organise the rhythm", 0, "PEA is non-shockable: shocks help VF and pulseless VT, not PEA."],
            ["Wait for spontaneous recovery before compressions", 0, "PEA never recovers alone: compressions plus epinephrine are required."]],
          c: "PEA means immediate CPR with epinephrine given as early as possible.",
          due: 60, t: ["rhythm recognition", "epinephrine timing"] },
        { p: "Two minutes of CPR. Monitor shows PEA. Access is in place.",
          o: [["Continue CPR and repeat epinephrine every three to five minutes", 1, "Correct: cycles continue on a two minute rhythm with epinephrine on schedule."],
            ["Shock once in case the monitor is wrong", 0, "Shocking PEA wastes a cycle and pauses compressions for nothing."],
            ["Stop epinephrine now one dose is given", 0, "One dose is not enough: epinephrine repeats every three to five minutes."]],
          c: "PEA runs on steady cycles with epinephrine repeated on its interval.",
          due: 90, t: ["epinephrine timing"] },
        { p: "Still PEA. The patient is pale with flat neck veins. Blood loss is possible.",
          o: [["Treat likely hypovolaemia: fluids and bleeding control, CPR continues", 1, "Correct: hypovolaemia is a leading H and bleeding control treats the cause."],
            ["Shock at higher energy to force a rhythm", 0, "Energy does not convert non-shockable rhythms: treat the cause instead."],
            ["Hyperventilate to blow off acid", 0, "Over-ventilation raises chest pressure and cuts venous return."]],
          c: "Matching the H to the signs turns PEA from hopeless to treatable.",
          due: 120, t: ["reversible causes"] },
        { p: "Monitor shows sinus rhythm with a pulse after fluids and CPR. ROSC achieved.",
          o: [["Begin post-ROSC care: oxygen, monitoring, 12-lead ECG, find the cause", 1, "Correct: post-ROSC care secures the airway, titrates oxygen and finds the cause."],
            ["Remove all lines now the pulse is back", 0, "Access stays: post-ROSC patients often need infusions and re-arrest happens."],
            ["Keep giving epinephrine boluses on schedule", 0, "Scheduled boluses stop at ROSC: further drugs follow blood pressure, not the clock."]],
          c: "ROSC care protects the brain and heart while the cause is nailed down.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "adult-asystole-1", mode: "adult", level: "easy", title: "Asystole on the ward", src: ADULT_SRC,
      states: [
        { p: "Unresponsive, no pulse. Monitor shows a flat line. The patient is still.",
          o: [["Start CPR, confirm asystole in a second view, give epinephrine as soon as possible", 1, "Correct: confirm the flat line is real, then CPR plus early epinephrine."],
            ["Shock the flat line to jump start the heart", 0, "Asystole is non-shockable: shocks cannot restart a flat line."],
            ["Check for a pulse every thirty seconds", 0, "Frequent pulse checks fragment compressions: check with the two minute rhythm."]],
          c: "Confirmed asystole gets CPR plus the earliest possible epinephrine.",
          due: 60, t: ["rhythm recognition", "epinephrine timing"] },
        { p: "Two minutes of CPR. Monitor shows asystole. The team asks about pacing.",
          o: [["Continue CPR and epinephrine: pacing does not help asystole", 1, "Correct: transcutaneous pacing has no role in asystole."],
            ["Apply pacing pads at maximum output", 0, "Pacing a flat line wastes time and pauses compressions."],
            ["Give epinephrine only if a shockable rhythm appears", 0, "Asystole needs epinephrine on schedule regardless of later rhythms."]],
          c: "Nothing shocks or paces asystole, so drugs and compressions carry the attempt.",
          due: 90, t: ["epinephrine timing"] },
        { p: "Still asystole after several cycles. Family asks what is being done.",
          o: [["Continue cycles, review the Hs and Ts, update the family briefly", 1, "Correct: cause hunting continues and the family deserves honest brief updates."],
            ["Stop compressions to hold a long family discussion", 0, "Long pauses harm the patient: brief updates happen while cycles continue."],
            ["Shock once so the family sees everything tried", 0, "Shocking asystole for show is wrong: only indicated actions are performed."]],
          c: "Cause review plus honest updates keeps a long attempt correct and humane.",
          due: 120, t: ["reversible causes", "team roles"] },
        { p: "Monitor shows sinus rhythm with a pulse. ROSC achieved.",
          o: [["Begin post-ROSC care: oxygen, monitoring, 12-lead ECG, find the cause", 1, "Correct: ROSC care follows every arrest rhythm the same way."],
            ["Stand down the team completely", 0, "Re-arrest peaks early: the team stays until handover to intensive care."],
            ["Keep the two minute cycle going despite the pulse", 0, "Compressions on a perfusing patient injure: stop CPR once the pulse is confirmed."]],
          c: "The same post-ROSC bundle follows ROSC from any starting rhythm.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "adult-brady-1", mode: "adult", level: "medium", title: "Bradycardia with poor perfusion", src: BRADY_SRC,
      states: [
        { p: "Monitor shows bradycardia with a pulse. The patient is clammy, confused, systolic pressure low.",
          o: [["Support airway and oxygen, attach monitoring, prepare atropine and pacing", 1, "Correct: poor perfusion makes this an emergency needing drugs and pacing ready."],
            ["Reassure and observe: slow rhythms are usually benign", 0, "Confusion plus low pressure means poor perfusion, never benign."],
            ["Start CPR immediately", 0, "A perfusing bradycardia needs drugs and pacing, not compressions."]],
          c: "Poor perfusion turns bradycardia into a prepare-everything emergency.",
          due: 90, t: ["rhythm recognition", "bradycardia"] },
        { p: "Atropine given, still bradycardic with poor perfusion. Pads are on.",
          o: [["Start transcutaneous pacing and arrange an infusion with expert help", 1, "Correct: failed atropine moves to pacing or an infusion with senior input."],
            ["Repeat reassurance and wait longer", 0, "Waiting through poor perfusion risks arrest: escalate now."],
            ["Shock with an unsynchronised shock", 0, "Unsynchronised shocks are for VF: a perfusing bradycardia needs pacing."]],
          c: "Atropine failure means pacing or infusion, guided by an expert.",
          due: 90, t: ["bradycardia"] },
        { p: "Pacing captures with a pulse and pressure improving.",
          o: [["Confirm capture, sedate if needed, arrange definitive pacing and cause finding", 1, "Correct: capture is the bridge to a definitive plan plus cause treatment."],
            ["Switch pacing off once pressure rises", 0, "Switching off drops the patient back: pacing continues to handover."],
            ["Deliver a synchronised shock as well", 0, "Extra shocks add nothing once pacing captures with a pulse."]],
          c: "Capture buys time for sedation, a definitive wire and the underlying cause.",
          due: 120, t: ["bradycardia", "post-ROSC care"] }
      ]
    },
    {
      id: "adult-tachy-1", mode: "adult", level: "medium", title: "Unstable tachycardia", src: TACHY_SRC,
      states: [
        { p: "Monitor shows a fast wide rhythm with a pulse. The patient is hypotensive and breathless.",
          o: [["Prepare for synchronised cardioversion with sedation", 1, "Correct: instability plus tachycardia means prompt synchronised cardioversion."],
            ["Try vagal manoeuvres for twenty minutes", 0, "Vagal tricks suit stable narrow rhythms, not unstable wide ones."],
            ["Leave the patient to compensate alone", 0, "Hypotension with tachycardia decompensates fast without cardioversion."]],
          c: "Unstable tachycardia is cardioverted promptly, with sedation when possible.",
          due: 90, t: ["rhythm recognition", "cardioversion"] },
        { p: "Sedation given, pads on, synchronisation confirmed. The rhythm persists.",
          o: [["Deliver a synchronised shock and reassess", 1, "Correct: synchronised energy with reassessment is the unstable pathway."],
            ["Deliver an unsynchronised shock", 0, "Unsynchronised shocks risk VF in a perfusing tachycardia: stay synchronised."],
            ["Give epinephrine boluses instead", 0, "Arrest-dose epinephrine has no place in perfusing tachycardia."]],
          c: "Synchronised energy, then reassess: the unstable loop is short and decisive.",
          due: 90, t: ["cardioversion"] },
        { p: "Monitor shows sinus rhythm with a pulse and rising pressure.",
          o: [["Monitor, 12-lead ECG, find and treat the cause", 1, "Correct: conversion starts monitoring, a 12-lead and cause finding."],
            ["Discharge the patient at once", 0, "Recurrence is likely: observe, record and investigate first."],
            ["Repeat cardioversion to make sure", 0, "Never shock sinus rhythm: conversion ends the shocks."]],
          c: "Conversion is followed by a 12-lead and a search for triggers.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "adult-vf-2", mode: "adult", level: "hard", title: "Refractory VF with a hidden cause", src: ADULT_SRC,
      states: [
        { p: "Collapse in the emergency bay. Monitor shows VF. Distractor: a nurse suggests shocking only after intubation.",
          o: [["Shock now and resume CPR: airway never delays the first shock", 1, "Correct: intubation waits; the first shock must not wait."],
            ["Intubate first, then shock", 0, "Intubation delays defibrillation and kills the shockable window."],
            ["Give amiodarone before the first shock", 0, "Antiarrhythmics come after the third shock, not before the first."]],
          c: "The first shock beats every other task, including the airway.",
          due: 60, t: ["defibrillation", "team roles"] },
        { p: "Two shocks given with CPR, epinephrine on board. Monitor shows VF. Distractor: hyperventilate the patient.",
          o: [["Continue cycles at the correct rate and avoid hyperventilation", 1, "Correct: correct rate and full recoil matter; hyperventilation harms return."],
            ["Double the compression rate for effect", 0, "Faster than 120 per minute ruins recoil and coronary filling."],
            ["Pause compressions for prolonged suctioning", 0, "Long suction pauses drop perfusion: keep pauses under seconds."]],
          c: "Quality compressions at 100 to 120 per minute carry refractory VF.",
          due: 90, t: ["defibrillation", "airway and ventilation"] },
        { p: "Third shock given, antiarrhythmic considered. Monitor shows VF. The trachea is deviated with absent breath sounds on one side.",
          o: [["Treat suspected tension pneumothorax while CPR continues", 1, "Correct: tension is a reversible T and decompression can flip the arrest."],
            ["Ignore the chest signs and shock a fourth time only", 0, "More shocks cannot fix tension: the T must be released."],
            ["Stop to order a CT scan", 0, "Scanning during arrest abandons perfusion: treat clinically, scan after ROSC."]],
          c: "A deviated trachea with one-sided silence means release the tension now.",
          due: 120, t: ["reversible causes"] },
        { p: "Chest released, CPR continues. Monitor shows VF, then sinus rhythm with a pulse.",
          o: [["Confirm ROSC, begin post-ROSC bundle: oxygen, 12-lead, cause review, ICU transfer", 1, "Correct: ROSC needs the full bundle plus the found cause documented."],
            ["Celebrate and stand the team down", 0, "Re-arrest stalks the first minutes: bundle, monitor and transfer."],
            ["Keep shocking on schedule", 0, "The perfusing rhythm ends all shocks immediately."]],
          c: "Found-cause ROSC still needs the whole post-ROSC bundle and handover.",
          due: 120, t: ["post-ROSC care", "reversible causes"] }
      ]
    },
    {
      id: "paed-vf-1", mode: "paediatric", level: "easy", title: "Paediatric collapse with VF", src: PALS_SRC,
      states: [
        { p: "A child collapses, no response, no pulse. Two rescuers present.",
          o: [["Start CPR at 15 to 2 with two rescuers and attach pads", 1, "Correct: paediatric two-rescuer ratio is 15 to 2 with pads on early."],
            ["Use the adult 30 to 2 ratio with two rescuers", 0, "With two rescuers the paediatric ratio is 15 to 2, not 30 to 2."],
            ["Ventilate only and skip compressions", 0, "Pulseless children need compressions plus breaths, never breaths alone."]],
          c: "Two rescuers use 15 to 2 so breaths keep up with compressions.",
          due: 60, t: ["team roles", "airway and ventilation"] },
        { p: "Monitor shows VF. The child remains pulseless.",
          o: [["Deliver a shock and resume CPR at once", 1, "Correct: shockable paediatric rhythms are shocked with immediate resumption."],
            ["Withhold shocks in children", 0, "Children in VF need shocks: VF is shockable at every age."],
            ["Give epinephrine before the first shock", 0, "The first shock comes first; epinephrine follows the schedule."]],
          c: "VF in a child is shocked exactly like VF in an adult.",
          due: 60, t: ["rhythm recognition", "defibrillation"] },
        { p: "Two minutes of CPR. Monitor shows VF. Second shock point reached.",
          o: [["Second shock, resume CPR, give epinephrine", 1, "Correct: epinephrine joins after the second shock with cycles continuing."],
            ["Stop CPR to place an advanced airway first", 0, "Airway placement must not interrupt the shock and drug sequence."],
            ["Shock twice more without CPR", 0, "Single shocks separated by CPR remain the rule in children too."]],
          c: "The paediatric sequence mirrors adults: shock, CPR, then epinephrine.",
          due: 90, t: ["defibrillation", "epinephrine timing"] },
        { p: "Monitor shows sinus rhythm with a pulse. ROSC achieved.",
          o: [["Begin post-ROSC care: oxygen titration, monitoring, glucose, cause finding", 1, "Correct: paediatric ROSC needs oxygen titration, glucose checks and cause finding."],
            ["Remove monitoring now the child is awake", 0, "Children re-arrest too: monitoring continues to intensive care."],
            ["Shock once more for safety", 0, "Never shock a perfusing rhythm at any age."]],
          c: "Paediatric ROSC care titrates oxygen and hunts the trigger.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "paed-brady-1", mode: "paediatric", level: "medium", title: "Paediatric bradycardia, poor perfusion", src: PALS_BRADY_SRC,
      states: [
        { p: "Monitor shows bradycardia with a pulse. The child is floppy with poor perfusion despite oxygen.",
          o: [["Support airway and ventilation, monitor, prepare epinephrine", 1, "Correct: hypoxia drives paediatric bradycardia, so oxygenation and ventilation lead."],
            ["Reassure: children tolerate slow rates", 0, "Floppy with poor perfusion means intervene, whatever the number."],
            ["Cardiovert immediately", 0, "Cardioversion treats tachycardia, not bradycardia."]],
          c: "Oxygenation and ventilation come first in paediatric bradycardia.",
          due: 90, t: ["bradycardia", "airway and ventilation"] },
        { p: "Heart rate stays below 60 with poor perfusion despite oxygenation and ventilation.",
          o: [["Start compressions and give epinephrine", 1, "Correct: below 60 with poor perfusion despite support means compressions plus epinephrine."],
            ["Keep ventilating alone indefinitely", 0, "Failed ventilation support triggers compressions, not endless waiting."],
            ["Shock the bradycardia", 0, "Shocks do not fix bradycardia: compressions and epinephrine do."]],
          c: "Below 60 with poor perfusion despite support, compressions start.",
          due: 90, t: ["bradycardia", "epinephrine timing"] },
        { p: "Monitor shows sinus rhythm with a pulse and better perfusion.",
          o: [["Continue support, find the cause, monitor to handover", 1, "Correct: recovery needs cause finding and watched handover."],
            ["Discharge home at once", 0, "Bradycardic children need observation and investigation, not instant discharge."],
            ["Stop oxygen even if saturation falls", 0, "Oxygen is titrated, not abandoned: keep saturation in range."]],
          c: "Recovery is watched, investigated and handed over, not discharged.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "paed-asystole-1", mode: "paediatric", level: "medium", title: "Paediatric asystole", src: PALS_SRC,
      states: [
        { p: "Child unresponsive, no pulse. Monitor shows asystole.",
          o: [["Start CPR, confirm asystole, give epinephrine as soon as possible", 1, "Correct: asystole needs immediate CPR with the earliest epinephrine."],
            ["Pace the asystole", 0, "Pacing does not work in asystole at any age."],
            ["Shock the flat line", 0, "Asystole is never shocked."]],
          c: "Paediatric asystole runs on CPR plus early epinephrine.",
          due: 60, t: ["rhythm recognition", "epinephrine timing"] },
        { p: "Two minutes of CPR. Still asystole. Ventilation seems difficult.",
          o: [["Reassess the airway and ventilation quality while cycles continue", 1, "Correct: hypoxia and airway problems commonly underlie paediatric arrest."],
            ["Pause CPR for prolonged airway attempts", 0, "Long airway pauses cost perfusion: brief, skilled attempts only."],
            ["Double epinephrine frequency", 0, "The three to five minute interval holds in children too."]],
          c: "Airway and ventilation quality often decides paediatric outcomes.",
          due: 90, t: ["airway and ventilation", "reversible causes"] },
        { p: "Monitor shows sinus rhythm with a pulse. ROSC achieved.",
          o: [["Begin post-ROSC care: oxygen titration, monitoring, glucose, temperature, cause finding", 1, "Correct: the paediatric bundle covers oxygen, glucose, temperature and cause."],
            ["Allow full celebration break in monitoring", 0, "Monitoring never takes a break after ROSC."],
            ["Continue full CPR cycles", 0, "Compressions stop once a pulse is confirmed."]],
          c: "The paediatric post-ROSC bundle guards brain and body together.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "paed-svt-1", mode: "paediatric", level: "hard", title: "Paediatric SVT, stable infant", src: PALS_TACHY_SRC,
      states: [
        { p: "Monitor shows a fast narrow regular rhythm with a pulse. The infant is alert with normal perfusion. Distractor: cardiovert at once.",
          o: [["Try vagal manoeuvres first while monitored", 1, "Correct: stable narrow regular tachycardia starts with vagal manoeuvres."],
            ["Synchronised cardioversion immediately", 0, "Stable perfusing infants start vagal, not shocked."],
            ["Start CPR", 0, "A perfusing alert infant needs vagal tricks, not compressions."]],
          c: "Stable SVT in an infant opens with vagal manoeuvres under monitoring.",
          due: 90, t: ["rhythm recognition", "cardioversion"] },
        { p: "Vagal manoeuvres fail. The infant remains stable with the same rhythm.",
          o: [["Give adenosine with expert guidance and monitor the rhythm", 1, "Correct: failed vagal in stable SVT moves to adenosine with monitoring."],
            ["Give epinephrine boluses", 0, "Arrest epinephrine has no role in stable SVT."],
            ["Shock without sedation", 0, "Stable rhythm plus no sedation makes shock the wrong escalation."]],
          c: "Failed vagal in stable SVT means adenosine, watched on the monitor.",
          due: 90, t: ["cardioversion"] },
        { p: "Monitor shows sinus rhythm with a pulse after treatment.",
          o: [["Monitor, record a 12-lead, arrange paediatric cardiology follow up", 1, "Correct: conversion needs documentation and specialist follow up."],
            ["Send home with no plan", 0, "SVT recurs: follow up and a family plan are required."],
            ["Start CPR to test the rhythm", 0, "Never compress a perfusing child to test anything."]],
          c: "Converted SVT is documented, recorded and followed up.",
          due: 120, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "neo-ppv-1", mode: "neonatal", level: "easy", title: "Term infant, not breathing", src: NRP_SRC,
      states: [
        { p: "Term birth. The infant is apnoeic with poor tone. Heart rate check: the cord is clamped.",
          o: [["Dry, warm, position the airway, clear secretions, stimulate", 1, "Correct: the initial steps of drying, warmth, position, clearing and stimulation come first."],
            ["Start chest compressions at once", 0, "Compressions need failed ventilation first: initial steps and breaths lead."],
            ["Leave the infant to recover alone", 0, "Apnoeic infants need action within seconds, never waiting."]],
          c: "Warmth, position and stimulation open every neonatal resuscitation.",
          due: 60, t: ["airway and ventilation", "team roles"] },
        { p: "Still apnoeic after initial steps. Heart rate below 100.",
          o: [["Start positive pressure ventilation and watch for chest rise", 1, "Correct: apnoea or a rate below 100 means ventilate with visible chest movement."],
            ["Give epinephrine now", 0, "Epinephrine waits until compressions plus ventilation fail to lift the rate."],
            ["Stop and reassess in five minutes", 0, "Neonatal checks run every 60 seconds, not every five minutes."]],
          c: "Ventilation is the decisive neonatal act: rate below 100 means breathe for the infant.",
          due: 60, t: ["airway and ventilation"] },
        { p: "Heart rate check at 60 seconds: rate above 100 with spontaneous breathing.",
          o: [["Begin post-resuscitation care: monitor, glucose, temperature, talk with the parents", 1, "Correct: recovery needs monitoring, glucose, warmth and parental communication."],
            ["Discharge from monitoring at once", 0, "Recovered infants still need monitored post-resuscitation care."],
            ["Start compressions for safety", 0, "Compressions on a vigorous infant injure: support, do not compress."]],
          c: "Recovery moves to monitored post-resuscitation care with the family.",
          due: 60, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "neo-comp-1", mode: "neonatal", level: "medium", title: "Heart rate below 60 after ventilation", src: NRP_SRC,
      states: [
        { p: "Thirty seconds of effective ventilation with chest rise. Heart rate still below 60.",
          o: [["Start 3 to 1 compressions with coordinated breaths", 1, "Correct: below 60 after 30 seconds of good ventilation means 3 to 1 compressions."],
            ["Continue ventilation alone for ten more minutes", 0, "The 30 second rule triggers compressions: waiting longer risks the infant."],
            ["Shock the infant", 0, "Defibrillation has no routine place in neonatal resuscitation."]],
          c: "Below 60 after good ventilation means 90 compressions with 30 breaths per minute.",
          due: 60, t: ["airway and ventilation", "rhythm recognition"] },
        { p: "Sixty seconds of coordinated 3 to 1 compressions. Heart rate check: still below 60.",
          o: [["Continue compressions, secure the airway, gain access, prepare epinephrine", 1, "Correct: persistent bradycardia escalates to airway, access and epinephrine readiness."],
            ["Stop compressions: they clearly failed", 0, "Stopping abandons perfusion: escalate drugs and airway instead."],
            ["Hyperventilate rapidly", 0, "Rate is fixed at 3 to 1: speed alone never fixes bradycardia."]],
          c: "Persistent bradycardia adds airway, access and epinephrine to the compressions.",
          due: 60, t: ["epinephrine timing"] },
        { p: "Heart rate check: above 100 with improving tone.",
          o: [["Stop compressions, wean support, begin post-resuscitation care", 1, "Correct: recovery stops compressions and starts monitored care."],
            ["Continue compressions for ten more minutes", 0, "Compressions on a recovered rate injure: stop and monitor."],
            ["Give epinephrine anyway", 0, "Recovered rate needs no epinephrine: drugs follow the rate, not routine."]],
          c: "A recovered rate ends compressions and starts careful weaning.",
          due: 60, t: ["post-ROSC care"] }
      ]
    },
    {
      id: "neo-full-1", mode: "neonatal", level: "hard", title: "Prolonged resuscitation, cause hunt", src: NRP_SRC,
      states: [
        { p: "Preterm infant, poor response to ventilation. Distractor: start compressions immediately without checking seal.",
          o: [["Correct mask seal and ventilation first, then reassess the rate", 1, "Correct: most failed ventilation is leak or position, fixed before compressions."],
            ["Compress at once with a leaking mask", 0, "Compressing over failed ventilation perfuses nothing: fix the seal first."],
            ["Give epinephrine before any breaths", 0, "Drugs never precede effective ventilation in neonatal resuscitation."]],
          c: "Neonatal resuscitation stands or falls on the seal: ventilation first, always.",
          due: 60, t: ["airway and ventilation"] },
        { p: "Good seal, chest rising, yet the rate stays below 60. Distractor: increase ventilation pressure sharply.",
          o: [["Start 3 to 1 compressions and consider an advanced airway", 1, "Correct: the rate rule holds; an advanced airway secures prolonged support."],
            ["Crank pressure to maximum", 0, "Excess pressure injures preterm lungs: right size breaths, then compressions."],
            ["Abandon ventilation and compress only", 0, "Neonatal arrest is ventilatory: breaths continue with compressions."]],
          c: "Failed rate despite good breaths means compressions plus a secured airway.",
          due: 60, t: ["airway and ventilation"] },
        { p: "Compressions plus ventilation continue with no response. Access is in place.",
          o: [["Give epinephrine, consider volume and pneumothorax, review technique", 1, "Correct: drugs join only now, with volume, air leak and technique review."],
            ["Repeat the same failing steps unchanged", 0, "No response means reassess technique and causes, not repetition."],
            ["Cool the infant rapidly without criteria", 0, "Therapeutic hypothermia follows criteria and senior input, not impulse."]],
          c: "Refractory bradycardia gets epinephrine plus a full technique and cause review.",
          due: 60, t: ["epinephrine timing", "reversible causes"] },
        { p: "Heart rate rises above 100 with tone improving.",
          o: [["Stop compressions, support transition, post-resuscitation care with glucose, temperature and parental communication", 1, "Correct: recovery care covers monitoring, glucose, temperature and the family."],
            ["Keep full resuscitation running", 0, "Full measures on a recovered infant harm: step down with monitoring."],
            ["Send to the ward unmonitored", 0, "Post-resuscitation infants need monitored care, never an unmonitored cot."]],
          c: "Recovery care watches glucose and temperature while the family is kept close.",
          due: 60, t: ["post-ROSC care"] }
      ]
    }
  ];

  var CASES = [
    { id: "ac-e1", mode: "adult", level: "easy", title: "Collapse in the corridor",
      vignette: "A visitor collapses in the hospital corridor. No response, agonal gasps, no pulse. A defibrillator arrives in one minute.",
      clues: [{ at: 0, text: "No pulse, agonal gasps: this is cardiac arrest." }, { at: 30, text: "Pads are on. The first rhythm check is due." }, { at: 150, text: "Two minutes of CPR have passed since the last check." }],
      quiz: [
        { q: "First action on finding the collapse?", o: ["Start CPR and attach pads", "Fetch notes", "Wait for the team", "Check glucose"], a: 0, why: "Compressions plus early pads decide shockable arrests.", topic: "team roles" },
        { q: "Monitor shows VF. Next step?", o: ["Shock then resume CPR", "Epinephrine first", "Observe ten minutes", "Pace"], a: 0, why: "Shockable rhythm means immediate shock with brief pauses.", topic: "defibrillation" },
        { q: "When is epinephrine due in shockable arrest?", o: ["After the second shock", "Before the first shock", "Only after ROSC", "Never"], a: 0, why: "Epinephrine joins after the second shock with cycles continuing.", topic: "epinephrine timing" } ] },
    { id: "ac-e2", mode: "adult", level: "easy", title: "PEA in resus",
      vignette: "A patient arrives peri-arrest with no pulse. The monitor shows organised complexes at 40 per minute.",
      clues: [{ at: 0, text: "Organised complexes without a pulse means PEA." }, { at: 60, text: "Epinephrine is due as soon as possible." }, { at: 180, text: "Review the Hs and Ts now." }],
      quiz: [
        { q: "PEA is best described as?", o: ["Organised rhythm without a pulse", "VF variant", "Normal rhythm", "Paced rhythm"], a: 0, why: "Electrical activity without perfusion defines PEA.", topic: "rhythm recognition" },
        { q: "Correct epinephrine plan in PEA?", o: ["As soon as possible, then every 3 to 5 min", "After the third shock", "Once only", "After ROSC"], a: 0, why: "Non-shockable arrest needs early epinephrine on schedule.", topic: "epinephrine timing" },
        { q: "Should PEA be shocked?", o: ["No, it is non-shockable", "Yes, once", "Yes, repeatedly", "Only in children"], a: 0, why: "Shocks treat VF and pulseless VT, not PEA or asystole.", topic: "defibrillation" } ] },
    { id: "ac-e3", mode: "adult", level: "easy", title: "Flat line at night",
      vignette: "A ward patient is found unresponsive with no pulse. The monitor shows a flat line in one view.",
      clues: [{ at: 0, text: "A flat line needs confirmation it is truly asystole." }, { at: 60, text: "Epinephrine is due as soon as possible." }, { at: 150, text: "Keep cycles going and review causes." }],
      quiz: [
        { q: "Before treating asystole, what must be checked?", o: ["Confirm in a second view and check leads", "Shock at once", "Pace at once", "Stop CPR"], a: 0, why: "Loose leads mimic asystole, so confirm before drugs.", topic: "rhythm recognition" },
        { q: "Role of pacing in asystole?", o: ["No role", "First line", "After ROSC", "Always"], a: 0, why: "Pacing cannot capture asystole.", topic: "bradycardia" },
        { q: "Post-ROSC oxygen target?", o: ["Titrate to saturation 92 to 98 percent", "Maximum flow always", "Room air only", "No oxygen"], a: 0, why: "Both hypoxia and excess oxygen harm after ROSC.", topic: "post-ROSC care" } ] },
    { id: "ac-m1", mode: "adult", level: "medium", title: "Slow and clammy",
      vignette: "A patient is confused and clammy with a pulse of 32. The monitor shows bradycardia with a pulse.",
      clues: [{ at: 0, text: "Confusion plus low pressure means poor perfusion." }, { at: 60, text: "Atropine has been tried without effect." }, { at: 150, text: "Pacing is capturing. Plan the next step." }],
      quiz: [
        { q: "Signs of poor perfusion in bradycardia include?", o: ["Confusion and clammy skin", "Mild headache", "Normal pressure", "Hunger"], a: 0, why: "Altered conscious state with shock signs marks poor perfusion.", topic: "bradycardia" },
        { q: "Atropine fails. Next step?", o: ["Pacing or infusion with expert help", "Wait and see", "Unsynchronised shock", "Discharge"], a: 0, why: "Failed atropine escalates to pacing or infusion.", topic: "bradycardia" },
        { q: "Once pacing captures?", o: ["Confirm capture, sedate, arrange definitive pacing", "Switch off", "Shock as well", "Remove pads"], a: 0, why: "Capture bridges to a definitive wire and cause treatment.", topic: "post-ROSC care" } ] },
    { id: "ac-m2", mode: "adult", level: "medium", title: "Fast, wide and unstable",
      vignette: "A patient is hypotensive and breathless. The monitor shows a fast wide rhythm with a pulse at 190 per minute.",
      clues: [{ at: 0, text: "Hypotension with tachycardia means unstable." }, { at: 60, text: "Sedation is being prepared." }, { at: 150, text: "The rhythm persists after the first intervention." }],
      quiz: [
        { q: "Unstable tachycardia with a pulse needs?", o: ["Prompt synchronised cardioversion", "Vagal manoeuvres for an hour", "Observation", "CPR"], a: 0, why: "Instability makes cardioversion the prompt treatment.", topic: "cardioversion" },
        { q: "For cardioversion of a perfusing tachycardia, use?", o: ["Synchronised shocks", "Unsynchronised shocks", "Pacing", "Defibrillation at VF settings"], a: 0, why: "Synchronisation avoids shocking the vulnerable period.", topic: "cardioversion" },
        { q: "After successful conversion?", o: ["Monitor, 12-lead ECG, find the cause", "Discharge at once", "Repeat shocks", "Stop monitoring"], a: 0, why: "Conversion starts documentation and trigger hunting.", topic: "post-ROSC care" } ] },
    { id: "ac-m3", mode: "adult", level: "medium", title: "Second shock point",
      vignette: "VF arrest in progress. One shock given, CPR resumed. Two minutes have passed and the rhythm check is due.",
      clues: [{ at: 0, text: "Two minutes since the first shock." }, { at: 30, text: "The rhythm check shows VF again." }, { at: 90, text: "Epinephrine timing is now the question." }],
      quiz: [
        { q: "Second shock point in persistent VF?", o: ["Shock, resume CPR, epinephrine", "Three stacked shocks", "Stop CPR for airway", "No more shocks"], a: 0, why: "One shock per cycle with epinephrine joining here.", topic: "defibrillation" },
        { q: "Correct compression rate?", o: ["100 to 120 per minute", "60 per minute", "200 per minute", "As fast as possible"], a: 0, why: "Rate outside 100 to 120 harms recoil and filling.", topic: "team roles" },
        { q: "Antiarrhythmic timing?", o: ["Considered after the third shock", "Before the first shock", "Only after ROSC", "Never"], a: 0, why: "Amiodarone or lidocaine enters after the third shock.", topic: "defibrillation" } ] },
    { id: "ac-h1", mode: "adult", level: "hard", title: "Refractory VF, chest signs",
      vignette: "VF persists after three shocks with good CPR. The trachea looks deviated and one side of the chest is silent. Distractors: demands for stacked shocks and a CT scan during the arrest.",
      clues: [{ at: 0, text: "Three shocks given, still VF. Examine the chest." }, { at: 60, text: "One-sided silence with deviation points to a T." }, { at: 150, text: "The chest has been released. Reassess the rhythm." }],
      quiz: [
        { q: "Deviated trachea with one-sided silence in arrest means?", o: ["Suspected tension pneumothorax: release it", "Simple pneumothorax: ignore", "Needs CT first", "Needs more shocks only"], a: 0, why: "Tension is a reversible T treated clinically during CPR.", topic: "reversible causes" },
        { q: "Which statement about stacked shocks is true?", o: ["They are outdated: one shock then CPR", "Three shocks save time", "Stack if tired", "Stack in children"], a: 0, why: "Single shocks with two minute cycles replaced stacking.", topic: "defibrillation" },
        { q: "Imaging during ongoing refractory arrest?", o: ["Treat clinically; scan after ROSC", "CT during CPR", "X-ray pauses CPR freely", "No imaging ever"], a: 0, why: "Perfusion comes first; imaging follows ROSC.", topic: "team roles" } ] },
    { id: "ac-h2", mode: "adult", level: "hard", title: "PEA with hidden bleeding",
      vignette: "PEA persists despite epinephrine and good CPR. The patient is pale with a rigid abdomen after a fall. Distractors: calls to shock the PEA and to hyperventilate.",
      clues: [{ at: 0, text: "PEA with pallor after trauma: think blood loss." }, { at: 60, text: "Shocking PEA helps nothing." }, { at: 150, text: "The abdomen is rigid: control bleeding, give fluids." }],
      quiz: [
        { q: "Most likely H in pale traumatic PEA?", o: ["Hypovolaemia", "Hypothermia", "Hyperkalaemia", "Tamponade alone"], a: 0, why: "Pallor plus rigid abdomen after trauma means blood loss.", topic: "reversible causes" },
        { q: "Why not hyperventilate?", o: ["It cuts venous return", "It helps always", "It replaces fluids", "It fixes PEA"], a: 0, why: "Over-ventilation raises chest pressure and drops return.", topic: "airway and ventilation" },
        { q: "Epinephrine interval?", o: ["Every 3 to 5 minutes", "Every 30 seconds", "Once only", "Every hour"], a: 0, why: "Epinephrine is due at 180 s and overdue at 300 s after the last dose.", topic: "epinephrine timing" } ] },
    { id: "pc-e1", mode: "paediatric", level: "easy", title: "Child collapse in clinic",
      vignette: "A child collapses in clinic, no response, no pulse. Two staff start resuscitation.",
      clues: [{ at: 0, text: "Two rescuers present: choose the paediatric ratio." }, { at: 60, text: "Pads are on. Check the rhythm." }, { at: 150, text: "VF confirmed. Act on it." }],
      quiz: [
        { q: "Two-rescuer paediatric ratio?", o: ["15 to 2", "30 to 2", "3 to 1", "5 to 1"], a: 0, why: "Two rescuers use 15 to 2 in children.", topic: "airway and ventilation" },
        { q: "VF in a child: shock?", o: ["Yes, VF is shockable at every age", "No, never shock children", "Only adults", "Only with pads off"], a: 0, why: "Shockable rhythms are shocked whatever the age.", topic: "defibrillation" },
        { q: "Single rescuer paediatric ratio?", o: ["30 to 2", "15 to 2", "3 to 1", "Continuous only"], a: 0, why: "Alone the ratio is 30 to 2; 15 to 2 needs two rescuers.", topic: "airway and ventilation" } ] },
    { id: "pc-e2", mode: "paediatric", level: "easy", title: "Asystole in a toddler",
      vignette: "A toddler is found lifeless. No pulse, monitor shows a flat line.",
      clues: [{ at: 0, text: "Confirm the flat line before drugs." }, { at: 60, text: "Hypoxia commonly underlies paediatric arrest." }, { at: 150, text: "Review airway and ventilation quality." }],
      quiz: [
        { q: "First drug in paediatric asystole?", o: ["Epinephrine as soon as possible", "Amiodarone first", "Adenosine", "None"], a: 0, why: "Asystole needs the earliest epinephrine.", topic: "epinephrine timing" },
        { q: "Commonest driver of paediatric arrest?", o: ["Hypoxia", "Primary VF always", "Stroke", "Allergy only"], a: 0, why: "Most paediatric arrests follow hypoxia, so ventilation matters.", topic: "airway and ventilation" },
        { q: "Pacing in asystole?", o: ["No role", "First line", "Routine", "After ROSC"], a: 0, why: "Pacing cannot capture asystole.", topic: "bradycardia" } ] },
    { id: "pc-m1", mode: "paediatric", level: "medium", title: "Floppy bradycardic infant",
      vignette: "An infant is floppy with poor perfusion. The monitor shows bradycardia with a pulse despite oxygen.",
      clues: [{ at: 0, text: "Poor perfusion despite oxygen: prepare to escalate." }, { at: 60, text: "Rate stays below 60." }, { at: 150, text: "Support has failed: decide on compressions." }],
      quiz: [
        { q: "First steps in paediatric bradycardia?", o: ["Airway, oxygenation, ventilation, monitoring", "Immediate shock", "Immediate CPR", "Discharge"], a: 0, why: "Hypoxia drives it, so oxygenation and ventilation lead.", topic: "bradycardia" },
        { q: "Start compressions when?", o: ["Below 60 with poor perfusion despite support", "Below 100 always", "Never", "Only in asystole"], a: 0, why: "The under-60 rule needs poor perfusion despite oxygenation.", topic: "bradycardia" },
        { q: "Drug alongside compressions here?", o: ["Epinephrine", "Amiodarone", "Adenosine", "Atropine only"], a: 0, why: "Epinephrine supports bradycardia with poor perfusion.", topic: "epinephrine timing" } ] },
    { id: "pc-m2", mode: "paediatric", level: "medium", title: "Paediatric VF, second shock",
      vignette: "A child in VF has had one shock with CPR resumed. Two minutes pass.",
      clues: [{ at: 0, text: "Two minutes since the first shock." }, { at: 30, text: "Rhythm check: still VF." }, { at: 90, text: "Epinephrine timing applies as in adults." }],
      quiz: [
        { q: "At the second shock point?", o: ["Shock, CPR, epinephrine", "Stop shocks", "Triple shock", "Airway only"], a: 0, why: "The sequence mirrors adults without showing energies.", topic: "defibrillation" },
        { q: "Are shock energies shown in training?", o: ["No, energies are never shown", "Yes, always", "Only for adults", "Only for infants"], a: 0, why: "Paediatric shock energy and dosing are not shown.", topic: "defibrillation" },
        { q: "With an advanced airway, ventilate?", o: ["One breath every 6 seconds with continuous compressions", "Stop compressions", "30 breaths a minute", "No breaths"], a: 0, why: "Advanced airway means continuous compressions with a breath every 6 s.", topic: "airway and ventilation" } ] },
    { id: "pc-m3", mode: "paediatric", level: "medium", title: "Post-ROSC in a child",
      vignette: "A child regains a pulse after asystole. Saturation reads 100 percent on high flow oxygen.",
      clues: [{ at: 0, text: "Pulse back: start the paediatric bundle." }, { at: 60, text: "Saturation is high: titrate oxygen." }, { at: 150, text: "Check glucose and temperature." }],
      quiz: [
        { q: "Oxygen after paediatric ROSC?", o: ["Titrate to 92 to 98 percent", "Maximum always", "None", "Only at night"], a: 0, why: "Excess oxygen harms recovering brains.", topic: "post-ROSC care" },
        { q: "Which checks belong in the bundle?", o: ["Glucose and temperature", "Shoe size", "Vision test", "Hearing test"], a: 0, why: "Glucose and temperature control sit in the paediatric bundle.", topic: "post-ROSC care" },
        { q: "Next destination?", o: ["Monitored transfer to intensive care", "Home", "Unmonitored ward", "Playroom"], a: 0, why: "Re-arrest risk demands intensive monitored care.", topic: "team roles" } ] },
    { id: "pc-h1", mode: "paediatric", level: "hard", title: "Stable SVT, worried parents",
      vignette: "An infant has a fast narrow regular rhythm with a pulse, alert with normal perfusion. Parents demand immediate shock. Distractors: shock without sedation, arrest epinephrine.",
      clues: [{ at: 0, text: "Stable and perfusing: vagal first." }, { at: 60, text: "Vagal fails. The rhythm is unchanged." }, { at: 150, text: "Escalate with monitoring and expert help." }],
      quiz: [
        { q: "Stable narrow regular tachycardia: first step?", o: ["Vagal manoeuvres", "Immediate shock", "CPR", "Epinephrine bolus"], a: 0, why: "Stable SVT starts vagal under monitoring.", topic: "cardioversion" },
        { q: "Vagal fails in stable SVT?", o: ["Adenosine with monitoring", "Shock unsedated", "Give up", "Epinephrine bolus"], a: 0, why: "Adenosine follows failed vagal in stable SVT.", topic: "cardioversion" },
        { q: "Why not cardiovert this stable infant at once?", o: ["Stability allows vagal then drug steps", "Shocks never work", "SVT is normal", "Monitors lie"], a: 0, why: "Stability buys safe stepwise care over shocks.", topic: "rhythm recognition" } ] },
    { id: "pc-h2", mode: "paediatric", level: "hard", title: "Refractory asystole, airway doubt",
      vignette: "A child in asystole shows no response after cycles. Ventilation looks difficult with poor chest rise. Distractors: double epinephrine frequency, prolonged blind airway attempts.",
      clues: [{ at: 0, text: "No response: reassess technique, not just drugs." }, { at: 60, text: "Poor chest rise means ventilation failure." }, { at: 150, text: "Fix airway and ventilation while cycles continue." }],
      quiz: [
        { q: "Poor chest rise during paediatric arrest means?", o: ["Reassess airway and ventilation", "More epinephrine", "Shock", "Stop"], a: 0, why: "Technique failure is common and fixable.", topic: "airway and ventilation" },
        { q: "Epinephrine interval in children?", o: ["Every 3 to 5 minutes", "Every 30 seconds", "Once", "Hourly"], a: 0, why: "The interval holds across ages.", topic: "epinephrine timing" },
        { q: "Long blind airway attempts during CPR?", o: ["Avoid: brief skilled attempts only", "Encouraged", "Replace CPR", "Unlimited"], a: 0, why: "Long pauses destroy perfusion for uncertain gain.", topic: "team roles" } ] },
    { id: "pc-h3", mode: "paediatric", level: "hard", title: "Unstable tachycardia in a child",
      vignette: "A child is hypotensive with a fast wide rhythm and a pulse. Distractors: vagal manoeuvres for an hour, unsynchronised shocks.",
      clues: [{ at: 0, text: "Hypotension means unstable whatever the width." }, { at: 60, text: "Synchronisation matters for perfusing rhythms." }, { at: 150, text: "Convert then investigate." }],
      quiz: [
        { q: "Unstable paediatric tachycardia needs?", o: ["Prompt synchronised cardioversion", "Hour of vagal", "Observation", "CPR first"], a: 0, why: "Instability drives prompt cardioversion.", topic: "cardioversion" },
        { q: "Why synchronised?", o: ["Avoids shocking the vulnerable period", "Stronger", "Faster", "Cheaper"], a: 0, why: "Unsynchronised shocks risk VF.", topic: "cardioversion" },
        { q: "After conversion?", o: ["Monitor, 12-lead, specialist follow up", "Discharge", "Repeat shocks", "No records"], a: 0, why: "Converted rhythms need records and follow up.", topic: "post-ROSC care" } ] },
    { id: "nc-e1", mode: "neonatal", level: "easy", title: "Term, apnoeic at birth",
      vignette: "Term infant born flat: apnoeic, poor tone. Cord clamped.",
      clues: [{ at: 0, text: "Start with drying, warmth and position." }, { at: 30, text: "Still apnoeic: check the heart rate." }, { at: 60, text: "Rate below 100 or apnoea means ventilate." }],
      quiz: [
        { q: "First steps for a flat term infant?", o: ["Dry, warm, position, clear, stimulate", "Compressions", "Epinephrine", "Intubate at once"], a: 0, why: "Initial steps open every resuscitation.", topic: "team roles" },
        { q: "Ventilate when?", o: ["Apnoea, gasping or rate below 100", "Only below 60", "Never", "After an hour"], a: 0, why: "The NRP threshold for PPV is apnoea or under 100.", topic: "airway and ventilation" },
        { q: "Heart rate checks run every?", o: ["60 seconds", "10 minutes", "Hourly", "Once"], a: 0, why: "Neonatal checks repeat each minute.", topic: "rhythm recognition" } ] },
    { id: "nc-e2", mode: "neonatal", level: "easy", title: "Slow to cry",
      vignette: "A term infant is breathing slowly with a rate around 90 after initial steps.",
      clues: [{ at: 0, text: "Slow breathing with a low rate: support." }, { at: 30, text: "Watch the chest rise." }, { at: 60, text: "Reassess at one minute." }],
      quiz: [
        { q: "Rate 90 with poor effort needs?", o: ["Positive pressure ventilation", "Compressions", "Epinephrine", "Nothing"], a: 0, why: "Under 100 with poor effort means PPV.", topic: "airway and ventilation" },
        { q: "Sign of effective ventilation?", o: ["Visible chest rise", "Noise", "Speed", "Colour alone"], a: 0, why: "Chest movement proves air entry.", topic: "airway and ventilation" },
        { q: "After recovery?", o: ["Monitored post-resuscitation care", "Unmonitored cot", "Discharge", "Cold room"], a: 0, why: "Recovery still needs monitoring, warmth and glucose checks.", topic: "post-ROSC care" } ] },
    { id: "nc-m1", mode: "neonatal", level: "medium", title: "Rate below 60",
      vignette: "Thirty seconds of effective ventilation with chest rise. The heart rate stays below 60.",
      clues: [{ at: 0, text: "Good ventilation, rate still below 60." }, { at: 30, text: "The 30 second rule now applies." }, { at: 60, text: "Coordinate breaths with compressions." }],
      quiz: [
        { q: "Below 60 after 30 s of good ventilation?", o: ["Start 3 to 1 compressions", "Ventilate alone longer", "Shock", "Stop"], a: 0, why: "The threshold for compressions is met.", topic: "rhythm recognition" },
        { q: "Neonatal compression to ventilation ratio?", o: ["3 to 1", "15 to 2", "30 to 2", "5 to 1"], a: 0, why: "NRP uses 3 to 1: 90 compressions with 30 breaths a minute.", topic: "airway and ventilation" },
        { q: "Breaths during compressions?", o: ["Continue coordinated breaths", "Stop breaths", "Double rate", "Random breaths"], a: 0, why: "Neonatal arrest stays ventilatory throughout.", topic: "airway and ventilation" } ] },
    { id: "nc-m2", mode: "neonatal", level: "medium", title: "Persistent bradycardia",
      vignette: "Sixty seconds of 3 to 1 compressions. The rate stays below 60.",
      clues: [{ at: 0, text: "Compressions plus breaths failing: escalate." }, { at: 30, text: "Secure airway and access." }, { at: 60, text: "Drugs enter only now." }],
      quiz: [
        { q: "Next escalation?", o: ["Airway, access, prepare epinephrine", "Stop compressions", "Shock", "Hyperventilate"], a: 0, why: "Persistent bradycardia adds airway, access and drugs.", topic: "epinephrine timing" },
        { q: "Epinephrine comes when?", o: ["After compressions plus ventilation fail", "Before any breaths", "At birth always", "Never"], a: 0, why: "Drugs follow failed ventilation and compressions.", topic: "epinephrine timing" },
        { q: "Recovered rate above 100 means?", o: ["Stop compressions, wean, monitor", "Continue compressions", "More epinephrine", "Discharge"], a: 0, why: "Recovery ends compressions and starts weaning.", topic: "post-ROSC care" } ] },
    { id: "nc-m3", mode: "neonatal", level: "medium", title: "Bad seal, failing ventilation",
      vignette: "Ventilation shows no chest rise. The mask leaks at the side.",
      clues: [{ at: 0, text: "No chest rise: check the seal." }, { at: 30, text: "Reposition before escalating." }, { at: 60, text: "Good breaths change everything." }],
      quiz: [
        { q: "No chest rise first means?", o: ["Fix seal and position", "Compress at once", "Epinephrine", "More pressure always"], a: 0, why: "Leak and position cause most failed ventilation.", topic: "airway and ventilation" },
        { q: "Compressing over failed ventilation?", o: ["Wrong: fix breaths first", "Right", "Always", "Never ventilate"], a: 0, why: "Compressions without air entry perfuse nothing.", topic: "airway and ventilation" },
        { q: "Excess pressure in preterm lungs?", o: ["Injures: use right-size breaths", "Helps always", "Needed", "Harmless"], a: 0, why: "Over-distension injures preterm lungs.", topic: "airway and ventilation" } ] },
    { id: "nc-h1", mode: "neonatal", level: "hard", title: "Refractory bradycardia, full review",
      vignette: "Preterm infant unresponsive to compressions and ventilation. Distractors: maximum pressure, rapid cooling without criteria, repeating failed steps.",
      clues: [{ at: 0, text: "No response: review technique and causes." }, { at: 30, text: "Consider volume, air leak and access." }, { at: 60, text: "Hypothermia needs criteria and senior input." }],
      quiz: [
        { q: "Refractory bradycardia needs?", o: ["Epinephrine plus technique and cause review", "Same steps unchanged", "Maximum pressure", "Instant cooling"], a: 0, why: "Drugs join a full review of technique, volume and air leak.", topic: "reversible causes" },
        { q: "Therapeutic hypothermia?", o: ["By criteria with senior input", "Always at once", "Never", "By parents alone"], a: 0, why: "Cooling follows criteria, not impulse.", topic: "post-ROSC care" },
        { q: "Volume in a pale preterm infant?", o: ["Consider with senior input", "Never", "Always maximum", "Replace breaths"], a: 0, why: "Volume is a senior decision in blood loss or shock.", topic: "reversible causes" } ] },
    { id: "nc-h2", mode: "neonatal", level: "hard", title: "Prolonged support, airway decision",
      vignette: "An infant needs prolonged ventilation with a poor seal and falling rates. Distractors: abandoning breaths for compressions alone, compressing a recovered infant.",
      clues: [{ at: 0, text: "Prolonged support: secure the airway." }, { at: 30, text: "Breaths never stop in neonatal resuscitation." }, { at: 60, text: "Match support to the rate." }],
      quiz: [
        { q: "Prolonged difficult ventilation suggests?", o: ["An advanced airway", "Stopping breaths", "Shock", "Cooling"], a: 0, why: "A secured airway stabilises prolonged support.", topic: "airway and ventilation" },
        { q: "Compressions on a recovered rate?", o: ["Stop: they injure", "Continue", "Double", "Add drugs"], a: 0, why: "Compressions end once the rate recovers.", topic: "post-ROSC care" },
        { q: "Post-resuscitation essentials?", o: ["Monitoring, glucose, temperature, parents", "Isolation", "No monitoring", "Cold stress"], a: 0, why: "The bundle covers body, monitoring and family.", topic: "post-ROSC care" } ] },
    { id: "nc-h3", mode: "neonatal", level: "hard", title: "Apnoea with meconium history",
      vignette: "An infant is born through stained liquor, apnoeic with poor tone. Distractors: routine suctioning of a vigorous infant, delaying ventilation for deep suction.",
      clues: [{ at: 0, text: "Non-vigorous: clear then ventilate fast." }, { at: 30, text: "Ventilation must not wait for perfect clearing." }, { at: 60, text: "Rate decides the next step." }],
      quiz: [
        { q: "Non-vigorous infant with stained liquor?", o: ["Clear the airway then ventilate promptly", "Delay breaths for long suction", "Suction vigorous infants routinely", "Compress first"], a: 0, why: "Clearing never delays needed breaths.", topic: "airway and ventilation" },
        { q: "Routine deep suction of vigorous infants?", o: ["Avoid", "Always", "With compressions", "Instead of drying"], a: 0, why: "Routine suction harms vigorous infants.", topic: "airway and ventilation" },
        { q: "Rate below 60 after good breaths?", o: ["3 to 1 compressions", "Wait", "Shock", "Cool"], a: 0, why: "The rate rule applies whatever the history.", topic: "rhythm recognition" } ] }
  ];

  var TOPICS = ["rhythm recognition", "defibrillation", "epinephrine timing", "reversible causes",
    "airway and ventilation", "bradycardia", "cardioversion", "post-ROSC care", "team roles"];

  var TIMINGS = {
    rhythmCheckSec: { adult: 120, paediatric: 120, neonatal: 60 },
    epiDueSec: 180, epiOverdueSec: 300, clockSpeed: 20
  };

  return { SCENARIOS: SCENARIOS, CASES: CASES, TOPICS: TOPICS, TIMINGS: TIMINGS,
    ADULT_SRC: ADULT_SRC, BRADY_SRC: BRADY_SRC, TACHY_SRC: TACHY_SRC, ROSC_SRC: ROSC_SRC,
    PALS_SRC: PALS_SRC, NRP_SRC: NRP_SRC };
});
