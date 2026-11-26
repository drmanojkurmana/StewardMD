/* StewardMD - home hero greetings (window.SMD_GREETINGS).
 *
 * Time-of-day greeting pairs for the home hero: { line, note }. home.js renders
 * line ("Hi night owl,"), then "Dr <first>", then note in the small caption.
 * One pair is picked per (calendar day, time window), so the greeting stays put
 * while the doctor uses the app and changes the next window or the next day.
 * Weekday specials (Monday morning, Friday evening, weekend days) join the pool
 * for their window. Lines stay short (the hero line column is ~64% wide);
 * notes stay under ~40 characters. No em-dash in any string (app-facing text).
 * Pure: pick(date) has no DOM or storage access; unit-tested in
 * test/home-greetings.test.mjs.
 */
(function (G) {
  "use strict";
  var Q = "’";   // typographic apostrophe, as the original night-owl line used

  // [startMinute, endMinute] inclusive, minutes since local midnight.
  var WINDOWS = [
    { id: "night",     from: 0,    to: 270 },    // 00:00 - 04:30
    { id: "dawn",      from: 271,  to: 359 },    // 04:31 - 05:59
    { id: "morning",   from: 360,  to: 719 },    // 06:00 - 11:59
    { id: "lunch",     from: 720,  to: 839 },    // 12:00 - 13:59
    { id: "afternoon", from: 840,  to: 1019 },   // 14:00 - 16:59
    { id: "evening",   from: 1020, to: 1259 },   // 17:00 - 20:59
    { id: "late",      from: 1260, to: 1439 }    // 21:00 - 23:59
  ];

  var POOL = {
    night: [
      ["Hi night owl,", "It" + Q + "s too early to say good morning"],
      ["Still up,", "The night shift salutes you"],
      ["Hello night shift,", "Coffee first, then the differentials"],
      ["Up with the stars,", "The wards are quiet. Mostly."],
      ["Quiet hours,", "Hope the pager is kind tonight"],
      ["Hi night owl,", "Even the monitors are yawning"]
    ],
    dawn: [
      ["Up before the sun,", "Even the roosters are impressed"],
      ["Early bird,", "Rounds haven" + Q + "t even started yet"],
      ["Rise and shine,", "The first chai is the best chai"],
      ["Morning already,", "Almost handover. Hang in there"]
    ],
    morning: [
      ["Good morning,", "Fresh start, fresh admissions"],
      ["Good morning,", "Rounds await. You" + Q + "ve got this"],
      ["Morning,", "May every cannula go in first time"],
      ["Good morning,", "Coffee in hand, stethoscope on"],
      ["Good morning,", "Today" + Q + "s patients are lucky to have you"]
    ],
    lunch: [
      ["Good afternoon,", "Have you eaten? Doctors forget too"],
      ["Hello,", "Lunch counts as self-care"],
      ["Good afternoon,", "Halfway through the day already"]
    ],
    afternoon: [
      ["Good afternoon,", "Hydrate. You tell patients to"],
      ["Good afternoon,", "Post-lunch slump is not a diagnosis"],
      ["Afternoon,", "Discharge summaries won" + Q + "t write themselves"],
      ["Good afternoon,", "Keep going, the day is nearly done"]
    ],
    evening: [
      ["Good evening,", "Hope the day was kind to you"],
      ["Good evening,", "Handover done? Time to breathe"],
      ["Evening,", "One more case, then some rest"],
      ["Good evening,", "Thanks for showing up today"]
    ],
    late: [
      ["Working late,", "Your patients are lucky to have you"],
      ["Good evening,", "Long day? You" + Q + "ve earned a break"],
      ["Still at it,", "Don" + Q + "t forget dinner"],
      ["Hello night shift,", "Hope the pager stays quiet"]
    ]
  };

  // Extra pairs that join a window's pool on certain days (0 = Sunday).
  var SPECIALS = [
    { days: [1], win: ["morning"], pair: ["Happy Monday,", "New week, same oath"] },
    { days: [1], win: ["morning"], pair: ["Good morning,", "Mondays need extra coffee"] },
    { days: [5], win: ["evening", "late"], pair: ["Happy Friday,", "Hope the weekend on-call is quiet"] },
    { days: [0, 6], win: ["morning", "lunch", "afternoon"], pair: ["Happy weekend,", "On call? We" + Q + "ve got your back"] },
    { days: [0, 6], win: ["morning"], pair: ["Weekend rounds,", "Shorter list, same care"] }
  ];

  function windowFor(mins) {
    for (var i = 0; i < WINDOWS.length; i++) if (mins >= WINDOWS[i].from && mins <= WINDOWS[i].to) return WINDOWS[i].id;
    return "morning";
  }

  function poolFor(win, day) {
    var out = (POOL[win] || []).slice();
    for (var i = 0; i < SPECIALS.length; i++) {
      var s = SPECIALS[i];
      if (s.days.indexOf(day) > -1 && s.win.indexOf(win) > -1) out.push(s.pair);
    }
    return out;
  }

  // Small string hash (FNV-1a), so the pick is stable for a day + window.
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  function pick(d) {
    d = d instanceof Date ? d : new Date();
    var mins = d.getHours() * 60 + d.getMinutes();
    var win = windowFor(mins), day = d.getDay();
    var pool = poolFor(win, day);
    var key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + ":" + win;
    var p = pool[hash(key) % pool.length];
    return { window: win, line: p[0], note: p[1] };
  }

  var API = { pick: pick, windowFor: windowFor, poolFor: poolFor, WINDOWS: WINDOWS, POOL: POOL, SPECIALS: SPECIALS };
  G.SMD_GREETINGS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
