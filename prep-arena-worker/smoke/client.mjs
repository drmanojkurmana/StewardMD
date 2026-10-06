// Two players over real WebSockets: a answers right at once, b answers wrong. Prints each side's messages.
// FORFEIT=1: b drops its socket at question 2, so a should win by forfeit 10 s later.
const URL_ = process.argv[2] || "ws://localhost:8799/battle";
const play = (u, right) => new Promise((resolve, reject) => {
  const ws = new WebSocket(URL_ + "?u=" + u, ["smd-arena", "aaa.bbb.ccc"]), log = [];   // as the app sends its token
  const t = setTimeout(() => reject(new Error(u + " timed out: " + JSON.stringify(log))), 60000);
  ws.onopen = () => { ws.send("junk"); ws.send(JSON.stringify({ t: "queue" })); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data); log.push(m.t + (m.i !== undefined ? m.i : ""));
    if (m.t === "q" && !right && process.env.FORFEIT && m.i === 2) { clearTimeout(t); ws.close(); return resolve({ u, log, last: { left: true } }); }
    if (m.t === "q") { if ("a" in m) reject(new Error("key leaked in q")); ws.send(JSON.stringify({ t: "a", i: m.i, k: right ? 0 : 1 })); }
    if (m.t === "end" || m.t === "nobody") { clearTimeout(t); ws.close(); resolve({ u, log, last: m }); }
  };
  ws.onerror = (e) => reject(new Error(u + " socket error"));
});
const res = await Promise.all([play("a1", true), play("b1", false)]);
for (const r of res) console.log(r.u, r.log.join(" "), JSON.stringify(r.last));
