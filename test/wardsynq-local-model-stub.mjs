/* test/wardsynq-local-model-stub.mjs - the on-premises model, as a hospital's own GPU presents it.
 *
 *   node test/wardsynq-local-model-stub.mjs [port]        prints LISTENING <port>
 *
 * An OpenAI-compatible /v1/chat/completions endpoint, which is the interface WardSynQ's
 * "local-openai" provider (functions/_wardsynq/maik-gateway.js) already speaks to llama.cpp's
 * server, vLLM and Ollama. It exists so the WHOLE MaiK path can be driven for real - the gateway's
 * provider selection, its PHI gate, the fenced prompt, the real HTTP request and response parsing,
 * the output screen, the interaction record and the clinician's review - without a network call to
 * a vendor and without a key.
 *
 * IT DOES NOT GENERATE. It echoes a fixed clinical-sounding sentence and reports the prompt back in
 * a header for the harness to inspect. Nothing here may ever stand in for a model's judgement: this
 * proves the PLUMBING carries a real answer safely, and says nothing about clinical quality.
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2]) || 8801;
// Deliberately plain: it must survive the output screen, which withholds reassurance ("no
// significant interactions", "safe to give") and anything that looks like a credential or an export.
const ANSWER = "Day 1 of this admission. One regular medication is charted and the observations recorded so far are in the chart above. Review the medication chart and the latest observations before deciding anything.";
let lastPrompt = "";

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (req.url === "/__lastprompt") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ prompt: lastPrompt }));
    return;
  }
  if (!req.url.endsWith("/chat/completions")) { res.writeHead(404); res.end("not found"); return; }
  let body = {};
  try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
  lastPrompt = (body.messages || []).map((m) => `${m.role}: ${m.content}`).join("\n\n");
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    // The model NAME the server actually answered with, which is what the gateway records - not
    // what was asked for. A hospital swapping the weights behind the same name is visible here.
    model: body.model || "wardsynq-local-stub",
    choices: [{ index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }],
    usage: { prompt_tokens: Math.ceil(lastPrompt.length / 4), completion_tokens: Math.ceil(ANSWER.length / 4) },
  }));
});
server.listen(PORT, () => console.log(`LISTENING ${PORT}`));
process.on("SIGTERM", () => process.exit(0));
