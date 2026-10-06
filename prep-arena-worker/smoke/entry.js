/* Local smoke only (never deployed): the real Matchmaker and BattleRoom, with auth replaced by ?u=<id> so two local
 * clients can play a whole battle. Run by smoke/run.sh. */
export { Matchmaker, BattleRoom } from "../src/index.js";
export default {
  async fetch(request, env) {
    const u = new URL(request.url).searchParams.get("u") || "";
    if (!/^[a-z0-9]{1,24}$/.test(u)) return new Response("bad", { status: 400 });
    await env.PREP_ARENA_DB.prepare("INSERT OR IGNORE INTO arena_players (uidh, name, consent_at) VALUES (?, ?, ?)").bind(u, "Player " + u, Date.now()).run();
    const h = new Headers({ Upgrade: "websocket", "X-Arena-Uidh": u, "X-Arena-Name": "Player%20" + u, "X-Arena-Rating": "1200", "X-Arena-Exam": "neet-pg" });
    return env.MATCHMAKER.get(env.MATCHMAKER.idFromName("neet-pg")).fetch(new Request("https://arena/connect", { headers: h }));
  },
};
