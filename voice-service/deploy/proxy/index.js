// Reverse proxy so the RunPod GPU can reach the FollowCare API. The pod's datacenter IP is 403'd by
// Cloudflare bot-protection on stewardmd.in AND pages.dev — and a plain HTTP fetch from here preserves that
// IP, so it 403s too. Calling Pages through the SERVICE BINDING (env.PAGES) routes internally, skipping the
// edge + bot check entirely. Falls back to HTTP if the binding is absent.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Fast telephony smoke-test: Plivo fetches this for answer XML and speaks a line (no GPU needed).
    if (url.pathname === "/plivo-test-answer") {
      const xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Speak language="en-US">Hello. This is a test call from Steward M D Follow Care. Your automated voice follow up line is working. Goodbye.</Speak></Response>';
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
    }
    if (env && env.PAGES) {
      return env.PAGES.fetch(new Request("https://stewardmd.pages.dev" + url.pathname + url.search, request));
    }
    const resp = await fetch(new Request("https://stewardmd.pages.dev" + url.pathname + url.search, request));
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  },
};
