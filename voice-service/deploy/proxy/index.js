// Reverse proxy: forward every request to the FollowCare Pages API, preserving method/headers/body (incl.
// X-Voice-Token). The pod calls this Worker instead of stewardmd.in, sidestepping the datacenter-IP 403.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://stewardmd.pages.dev" + url.pathname + url.search;
    const resp = await fetch(new Request(target, request));
    // Pass the upstream response straight back.
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  },
};
