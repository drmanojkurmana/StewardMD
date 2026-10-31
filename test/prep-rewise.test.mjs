/* ReWise (prep-timetable.js v2) pure planner, owner 2026-10-31: "see the timetable your PrepNucleus vs ChatGPT created".
 * What must hold: a one-subject exam (NEET-SS Medical Oncology) gets a topic on every study day, never the subject name
 * on repeat; weak topics come first and strong ones get no first-reading day; the week has a grand test, its review
 * on the next study day and a rest day; the last days before the exam are light; every block has minutes and the
 * question targets follow the hours; missed days and re-plans keep what was read.
 * node --test test/prep-rewise.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TT = require("../prep-timetable.js");
const PN = require("../prep-nudges.js");
const NV = require("../prep-native.js");

// Day 20000 = 2024-10-04, a Friday (weekday 5).
const START = 20000;
function topics(n, more = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Object.assign({ id: "son-" + i, g: "sec-" + Math.floor(i / 8), n: 30 + (i % 5) * 5, t: 0, ok: 0, cf: 0 }, more[i] || {}));
  return out;
}

test("tiers and reasons come from the student's own numbers", () => {
  assert.equal(TT.tierOf({ t: 20, ok: 8 }), 1);
  assert.equal(TT.whyOf({ t: 20, ok: 8 }), "40% right of 20");
  assert.equal(TT.tierOf({ t: 20, ok: 15, cf: 6 }), 1);
  assert.equal(TT.whyOf({ t: 20, ok: 15, cf: 6 }), "6 of 20 guessed or confused");
  assert.equal(TT.tierOf({ weak: true, t: 50, ok: 50 }), 1, "ticked weak wins over strong numbers");
  assert.equal(TT.whyOf({ t: 0 }), "Not started");
  assert.equal(TT.whyOf({ t: 4, ok: 4 }), "Only 4 answered so far");
  assert.equal(TT.tierOf({ t: 40, ok: 34 }), 4);
  assert.match(TT.whyOf({ t: 40, ok: 34 }), /85% right of 40, so mixed practice only/);
  assert.equal(TT.tierOf({ t: 20, ok: 14 }), 3);
});

test("a 46-day Medical Oncology plan: a topic on every study day, weekly grand test and review, rest, light finish", () => {
  const exam = START + 45, tp = topics(104, { 50: { t: 20, ok: 6 }, 70: { weak: true }, 3: { t: 40, ok: 36 } });
  const p = TT.plan({ start: START, end: exam - 12, exam, off: [0], gt: 5, topics: tp });
  const by = (k) => p.days.filter((d) => d.k === k);
  assert.equal(p.days.length, 46);
  assert.equal(p.days[45].k, "exam");
  assert.deepEqual(p.days.slice(43, 45).map((d) => d.k), ["taper", "taper"], "the last 2 days before the exam are light");
  assert.ok(by("learn").length >= 20);
  assert.ok(by("learn").every((d) => d.t && d.t.length >= 1 && d.t.length <= 8), "every learn day names 1 to 8 topics");
  assert.equal(by("learn")[0].t[0], "son-50", "the weakest by accuracy leads (tier 1, earlier in the tree than the ticked one)");
  assert.ok(by("learn")[0].t.indexOf("son-70") >= 0 || by("learn")[1].t.indexOf("son-70") >= 0, "the ticked topic follows at once");
  assert.ok(!by("learn").some((d) => d.t.indexOf("son-3") >= 0), "a strong topic gets no first-reading day");
  assert.deepEqual(p.strong, ["son-3"]);
  const read = new Set(); by("learn").forEach((d) => d.t.forEach((id) => read.add(id)));
  assert.equal(read.size, 103, "every other topic is read once");
  // Grand tests: Fridays, not in the first 3 days, each followed by its review on the next study day.
  assert.ok(by("gt").length >= 5);
  assert.ok(by("gt").every((d) => TT.weekday(d.d) === 5 && d.d >= START + 3));
  by("gt").forEach((g) => { const nx = p.days.find((d) => d.d > g.d && d.k !== "rest"); if (nx && nx.k !== "taper" && nx.k !== "exam") assert.equal(nx.k, "gtr", "review after the test on " + g.d); });
  assert.ok(by("rest").every((d) => TT.weekday(d.d) === 0), "Sundays rest");
  // Revision: sections swept, then mixed.
  const rv = by("rev");
  assert.ok(rv.length >= 1 && rv.every((d) => d.g && d.g.length && d.t.length));
  assert.equal(rv[0].g[0], "sec-6", "the section holding the weakest topic is revised first");
});

test("no exam date: the plan ends at the finish date; fewer days than topics still covers them", () => {
  const p = TT.plan({ start: START, end: START + 6, exam: null, off: [], gt: -1, topics: topics(30) });
  assert.equal(p.days.length, 7);
  assert.ok(p.days.every((d) => d.k === "learn" && d.t.length >= 1));
  assert.equal(new Set(p.days.flatMap((d) => d.t)).size, 30);
  // More days than topics: a long topic spans days.
  const q = TT.plan({ start: START, end: START + 9, exam: null, off: [], gt: -1, topics: topics(3) });
  assert.ok(q.days.every((d) => d.t.length >= 1));
});

test("blocks: minutes and targets follow the hours; the grand test day; rest and exam plan nothing", () => {
  const b8 = TT.blocks("learn", 480, { due: 30 });
  assert.deepEqual(b8.map((b) => b.k), ["recall", "read", "topic", "mixed", "errors", "quick"]);
  assert.equal(b8.find((b) => b.k === "topic").n, 80);
  assert.equal(b8.find((b) => b.k === "recall").n, 30);
  const b2 = TT.blocks("learn", 120, { due: 300 });
  assert.equal(b2.find((b) => b.k === "topic").n, 20, "2 h: fewer questions");
  assert.ok(b2.find((b) => b.k === "errors").min >= 15, "error review stays");
  assert.deepEqual(TT.blocks("gt", 480, { gtMin: 150 }).map((b) => [b.k, b.min]), [["gt", 150], ["first", 60]]);
  assert.deepEqual(TT.blocks("rest", 480, {}), []);
  assert.deepEqual(TT.blocks("exam", 480, {}), []);
  assert.ok(TT.blocks("taper", 480, {}).reduce((a, b) => a + b.min, 0) <= 240, "the taper is half a day");
});

test("missed days and re-plan: what was read keeps its day, the rest is laid from today", () => {
  const tp = topics(12);
  const p = TT.plan({ start: START, end: START + 11, exam: null, off: [], gt: -1, topics: tp });
  const today = START + 4, seen = { [p.days[0].t[0]]: START, [p.days[1].t[0]]: START + 1 };
  const studied = (id, d) => seen[id] != null && seen[id] >= d;
  const miss = TT.missed(p.days, today, studied);
  assert.deepEqual(miss.map((d) => d.d), [START + 2, START + 3]);
  const done = TT.readSet(p.days, today, studied);
  assert.deepEqual(Object.keys(done).sort(), [p.days[0].t[0], p.days[1].t[0]].sort());
  const q = TT.plan({ start: today, end: START + 11, exam: null, off: [], gt: -1, topics: tp, skip: done });
  const laid = new Set(q.days.flatMap((d) => d.t));
  assert.ok(!laid.has(p.days[0].t[0]) && laid.size === 10, "read topics are not laid again; nothing is doubled");
  assert.deepEqual(TT.weakest([{ id: "a", t: 12, ok: 3 }, { id: "b", t: 30, ok: 25 }, { id: "c", t: 5, ok: 0 }, { id: "d", t: 20, ok: 10 }]), ["a", "d", "b"]);
});

test("kinds: a grand test never falls in the taper; an exam under 10 days away has no taper", () => {
  const k = TT.kinds({ start: START, end: START + 20, exam: START + 30, off: [0], gt: 3 });
  assert.ok(!k.some((d) => d.k === "gt" && d.d >= START + 28));
  assert.ok(!TT.kinds({ start: START, end: START + 5, exam: START + 8, off: [], gt: -1 }).some((d) => d.k === "taper"));
});

test("reminders say what to read and practise: smart nudges and the daily reminder", () => {
  const now = new Date(2026, 9, 31, 9, 0).getTime();
  const rw = [{ k: "learn", title: "Anthracyclines, Platinum agents", body: "Read Anthracyclines. Practise 80 questions on Anthracyclines, Platinum agents." },
    { k: "gt", title: "Grand test", body: "Grand test today, then review every wrong and guessed answer." }];
  const out = PN._pure ? PN._pure.build : PN.build;
  const list = out({ now, quiet: "22:30-07:30", anchor: 18 * 60, name: null, exam: "NEET-SS", examDays: 40, plan: { items: [{ k: "prac", done: false, x: 0, of: 80, min: 120 }] }, due: [], streak: 0, studiedToday: false, weak: null, wins: [], recap: null, arena: null, hist: [], rw });
  const t0 = list.find((n) => n.k === "rw_today"), t1 = list.find((n) => n.k === "rw_next");
  assert.ok(t0 && /Anthracyclines/.test(t0.title + t0.body) && /Practise 80 questions/.test(t0.body), JSON.stringify(t0));
  assert.ok(t1 && /Grand test/.test(t1.title + t1.body), JSON.stringify(t1));
  const restDay = out({ now, quiet: "22:30-07:30", anchor: 18 * 60, plan: { items: [{ k: "rev", done: false, x: 0, of: 5, min: 3 }] }, due: [], hist: [], rw: [{ k: "rest", title: "Rest day", body: "Rest day. Nothing planned." }, null] });
  assert.ok(!restDay.some((n) => n.k === "rw_today"), "no ReWise nudge on a rest day");
  const P = NV.reminderPayload || NV._pure.reminderPayload;
  const r = P("18:00", now, "2026-10-31", 3, rw);
  assert.equal(r.title, "ReWise: Anthracyclines, Platinum agents");
  assert.match(r.body, /^Read Anthracyclines\. Practise 80/);
  const r2 = P("08:00", now, "2026-10-31", 3, rw);
  assert.equal(r2.title, "ReWise: Grand test", "a reminder that falls tomorrow uses tomorrow's line");
  assert.equal(P("18:00", now, "2026-10-31", 3, null).body, "Today's plan: 3 items");
});

test("PDF: a valid file (header, objects, xref offsets, trailer), every page footed, text wrapped to the column", () => {
  const rows = [];
  for (let i = 0; i < 80; i++) rows.push({ cells: ["Mon " + i, "Study", "Anthracyclines (doxorubicin), platinum agents and 5\u2013FU/capecitabine: topic " + i, "80 topic MCQs + 47 mixed"], fill: i % 7 === 4 ? "gt" : null });
  const pdf = TT.pdfDoc({ title: "ReWise: NEET-SS Medical Oncology", sub: "46-day plan", box: { head: "HOW", text: "Weakest first." }, facts: [["Rest days:", "Sun"]],
    sections: [{ h: "3. Date-wise plan", table: { boldSecond: true, cols: [["Date", 1], ["Main task", 1], ["Topics", 3], ["Practice", 2]], rows } }, { h: "Rules", bullets: ["Rest."] }], foot: "ReWise" });
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(/%%EOF\n$/.test(pdf));
  assert.ok([...pdf].every((c) => c.charCodeAt(0) < 256), "one byte per char");
  const xref = +pdf.match(/startxref\n(\d+)\n/)[1];
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const n = +pdf.slice(xref).match(/^xref\n0 (\d+)/)[1];
  const offs = pdf.slice(xref).split("\n").slice(3, 2 + n).map((l) => +l.slice(0, 10));
  offs.forEach((o, i) => assert.equal(pdf.slice(o, o + String(i + 1).length + 6), (i + 1) + " 0 obj", "object " + (i + 1) + " at its offset"));
  // Each stream's /Length is its byte count.
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) { const st = m.index + m[0].length; assert.equal(pdf.slice(st + +m[1], st + +m[1] + 10), "\nendstream"); }
  const pages = +pdf.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1];
  assert.ok(pages >= 3, "80 rows run over pages: " + pages);
  assert.equal((pdf.match(/\(ReWise   Page \d+ of \d+\) Tj/g) || []).length, pages, "every page has the footer with the count");
  assert.ok(pdf.indexOf("(5-FU/capecitabine:") > 0 || pdf.indexOf("5-FU/capecitabine") > 0, "an en dash becomes a hyphen");
  assert.ok(pdf.indexOf("Anthracyclines \\(doxorubicin\\)") > 0, "brackets are escaped");
  // Wrapping: no line wider than its width.
  TT.wrap("A long topic name that has to wrap across more than one line in a narrow cell", 9, false, 80).forEach((l) => assert.ok(TT.textW(l, 9, false) <= 80, l));
  assert.equal(TT.pdfText("a\u2014b \u2265 c \u4e2d"), "a-b >= c ?");
});
