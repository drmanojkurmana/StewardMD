/* StewardMD — Phase 2 unit tests (pure Node, mock D1): user prefs, bookmarks, and
 * push workspace-matching. USAGE: node test/run-updates-prefs.mjs
 */
import * as repo from "../functions/_updates_repo.js";
import { subMatchesWorkspace } from "../functions/_webpush.js";

let fails = 0;
const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

function mockDb() {
  const prefs = new Map(), bms = new Set();
  return {
    prepare(sql) {
      const stmt = (b) => ({
        bind: (...nb) => stmt(nb),
        run: async () => {
          if (/INSERT INTO user_prefs/.test(sql)) prefs.set(b[0], { uid: b[0], workspaces: b[1], branches: b[2], push_enabled: b[3], updated_ts: b[4] });
          else if (/INSERT OR IGNORE INTO bookmarks/.test(sql)) bms.add(b[0] + "|" + b[1]);
          else if (/DELETE FROM bookmarks/.test(sql)) bms.delete(b[0] + "|" + b[1]);
          return {};
        },
        first: async () => (/FROM user_prefs WHERE uid/.test(sql) ? (prefs.get(b[0]) || null) : null),
        all: async () => {
          if (/FROM bookmarks WHERE uid/.test(sql)) { const uid = b[0]; return { results: [...bms].filter((k) => k.startsWith(uid + "|")).map((k) => ({ update_id: k.split("|")[1] })) }; }
          return { results: [] };
        },
      });
      return stmt([]);
    },
  };
}

(async () => {
  const env = { UPDATES_DB: mockDb() };

  console.log("\n── user prefs ──");
  chk("unknown uid → null", (await repo.getPrefs(env, "fb:nope")) === null);
  await repo.savePrefs(env, "fb:u1", { workspaces: ["internal_medicine", "surgery"], branches: ["cardiology", "nephrology"], push_enabled: true });
  let p = await repo.getPrefs(env, "fb:u1");
  chk("saved workspaces round-trip", p && p.workspaces.length === 2 && p.workspaces.indexOf("surgery") >= 0, JSON.stringify(p && p.workspaces));
  chk("saved branches round-trip", p && p.branches.length === 2 && p.branches.indexOf("cardiology") >= 0, JSON.stringify(p && p.branches));
  chk("push_enabled persisted", p && p.push_enabled === true);
  await repo.savePrefs(env, "fb:u1", { workspaces: [], push_enabled: false });
  p = await repo.getPrefs(env, "fb:u1");
  chk("empty workspaces defaults to internal_medicine", p && p.workspaces.length === 1 && p.workspaces[0] === "internal_medicine");
  chk("push_enabled=false persisted", p && p.push_enabled === false);

  console.log("\n── bookmarks ──");
  await repo.addBookmark(env, "fb:u1", "u123");
  await repo.addBookmark(env, "fb:u1", "u123");   // idempotent
  await repo.addBookmark(env, "fb:u1", "u456");
  let ids = await repo.listBookmarkIds(env, "fb:u1");
  chk("two distinct bookmarks (idempotent add)", ids.length === 2 && ids.indexOf("u123") >= 0, JSON.stringify(ids));
  chk("bookmarks are per-user", (await repo.listBookmarkIds(env, "fb:other")).length === 0);
  await repo.removeBookmark(env, "fb:u1", "u123");
  ids = await repo.listBookmarkIds(env, "fb:u1");
  chk("remove works", ids.length === 1 && ids[0] === "u456");

  console.log("\n── push workspace matching ──");
  chk("no target → broadcast (match)", subMatchesWorkspace({ workspaces: ["surgery"] }, null) === true);
  chk("target in sub's workspaces → match", subMatchesWorkspace({ workspaces: ["internal_medicine", "surgery"] }, "surgery") === true);
  chk("target NOT in sub's workspaces → no match", subMatchesWorkspace({ workspaces: ["surgery"] }, "ent") === false);
  chk("legacy sub (no workspaces) → match all", subMatchesWorkspace({ workspaces: [] }, "ent") === true);
  chk("legacy sub (undefined) → match all", subMatchesWorkspace({}, "ent") === true);

  console.log(`\n${fails ? "❌ " + fails + " failed" : "✅ all passed"}\n`);
  process.exit(fails ? 1 : 0);
})();
