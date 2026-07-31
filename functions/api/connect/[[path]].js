// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (flag-gated). Routes filled in Task 11.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/connect/, "") || "/";
  if (path === "/health") return jsonResponse({ ok: true, service: "stewardmd-connect", phase: 0 });
  return jsonResponse({ error: "not_found" }, { status: 404 });
}
