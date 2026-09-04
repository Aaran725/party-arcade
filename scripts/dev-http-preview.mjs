// Local-only plain-HTTP variant of server/index.ts, used to sanity-check the app in
// browsers/sandboxes that reject self-signed HTTPS certs. Motion/orientation sensors
// won't work over plain HTTP (that's the whole reason the real app uses HTTPS — see
// server/index.ts) — this is for verifying layout, room flow, and non-motion games only.
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 8444);

const { attachWebSocketServer } = await import(path.join(root, "server/ws-server.ts"));

const httpServer = createHttpServer();

const vite = await createViteServer({
  root,
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
httpServer.on("request", (req, res) => {
  vite.middlewares(req, res, async () => {
    const url = req.url ?? "/";
    const page = url === "/" || url.startsWith("/?") ? "index.html" : url.startsWith("/play.html") ? "play.html" : null;
    if (!page) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const raw = readFileSync(path.join(root, page), "utf-8");
    let html = await vite.transformIndexHtml(url, raw);
    html = html.replace(/<script[^>]*src="\/@vite\/client"[^>]*><\/script>\s*/, "");
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
});

attachWebSocketServer(httpServer, () => `http://localhost:${PORT}`);

httpServer.listen(PORT, () => {
  console.log(`[dev-http-preview] http://localhost:${PORT}/ (plain HTTP, verification only)`);
});
