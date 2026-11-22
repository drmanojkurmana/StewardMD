/* Queue consumer for the hybrid Research pipeline.
 * Cloudflare owns durable delivery/retries; Python owns deterministic analysis.
 * No PHI is allowed in the queue payload. Only extracted study-level estimates.
 */
function log(event, fields = {}) {
  console.log(JSON.stringify({ service: "research-orchestrator", event, ...fields }));
}
async function execute(message, env) {
  const job = message.body || {};
  if (job.type !== "meta-analysis" || !job.jobId || !job.analysisId || !job.input) {
    log("invalid-message", { id: message.id });
    message.ack();
    return;
  }
  if (!env.RESEARCH_API_URL || !env.RESEARCH_WORKER_TOKEN || !env.RESEARCH_CALLBACK_URL || !env.RESEARCH_CALLBACK_TOKEN) {
    log("configuration-missing", { jobId: job.jobId });
    message.retry({ delaySeconds: 60 });
    return;
  }
  try {
    const response = await fetch(env.RESEARCH_API_URL.replace(/\/$/, "") + "/v1/meta-analysis/compute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-research-worker-token": env.RESEARCH_WORKER_TOKEN },
      body: JSON.stringify(job.input),
      signal: AbortSignal.timeout(90000)
    });
    const text = await response.text();
    let result = null;
    try { result = JSON.parse(text); } catch {}
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) throw new Error("analysis_upstream_" + response.status);
      await callback(job, env, { status: "failed", errorCode: "analysis_rejected" });
      message.ack();
      return;
    }
    await callback(job, env, { status: "succeeded", result });
    log("completed", { jobId: job.jobId, studies: result.studiesIncluded });
    message.ack();
  } catch (error) {
    log("retry", { jobId: job.jobId, reason: String(error && error.message || error).slice(0, 120) });
    message.retry({ delaySeconds: 30 });
  }
}
async function callback(job, env, payload) {
  const url = env.RESEARCH_CALLBACK_URL.replace(/\/$/, "") +
    "/api/research/v1/internal/jobs/" + encodeURIComponent(job.jobId) + "/complete";
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-research-callback-token": env.RESEARCH_CALLBACK_TOKEN },
    body: JSON.stringify({ analysisId: job.analysisId, ...payload })
  });
  if (!response.ok) throw new Error("callback_failed_" + response.status);
}
export default {
  async queue(batch, env) {
    for (const message of batch.messages) await execute(message, env);
  }
};
