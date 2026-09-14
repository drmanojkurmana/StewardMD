import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = path.join(ROOT, "debug-bugs.jsonl");
const PORT = 4499;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, Accept");
  res.setHeader("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && (req.url === "/api/bug" || req.url === "/bug")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        data.receivedAt = new Date().toISOString();
        const line = JSON.stringify(data) + "\n";
        fs.appendFileSync(LOG_FILE, line, "utf8");
        console.log(`[BUG-COLLECTOR] Recorded bug #${data.id || Date.now()} at ${data.location || data.url}: "${(data.description || "").slice(0, 60)}"`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id: data.id }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === "GET" && (req.url === "/api/bugs" || req.url === "/bugs")) {
    let lines = [];
    if (fs.existsSync(LOG_FILE)) {
      lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch (e) { return null; }
      }).filter(Boolean);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, count: lines.length, bugs: lines }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[BUG-COLLECTOR] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[BUG-COLLECTOR] Logging to: ${LOG_FILE}`);
});
