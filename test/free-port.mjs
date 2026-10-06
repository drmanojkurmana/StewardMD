// A port nothing is listening on. The headless runners default to this so they never reuse a server another checkout left
// on a fixed port (it serves that checkout's app) or another suite's Chrome (its storage and tabs).
import net from "node:net";
export const freePort = () => new Promise((res, rej) => {
  const s = net.createServer().once("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
