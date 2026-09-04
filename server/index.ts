import { createServer as createHttpServer, type Server as HTTPServer } from "node:http";
import { createServer as createHttpsServer, type Server as HTTPSServer } from "node:https";
import path from "node:path";
import { readFileSync } from "node:fs";
import { loadDevCert } from "./https";
import { getLanIPv4 } from "./lan";
import { attachWebSocketServer } from "./ws-server";
import { startCertWatcher } from "./certWatcher";
import { handleCertTrustRoute } from "./certTrustRoute";
import { sendToHost } from "./protocol/broadcast";

const PORT = Number(process.env.PORT ?? 8443);
const isProd = process.env.NODE_ENV === "production";
const root = path.resolve(import.meta.dirname, "..");
// Fly.io auto-injects FLY_APP_NAME and Render auto-injects RENDER_EXTERNAL_URL into every
// deployed container, so either platform self-configures with no manual secret needed —
// both give a working public https:// URL with its own real, properly trusted TLS cert.
// PUBLIC_URL stays available as an explicit override for a custom domain or a different
// host entirely. Unset (the normal `npm run dev`/`npm start` case) means "we're on
// someone's LAN" — every existing self-signed-cert code path below runs exactly as it
// always has.
const publicUrl =
  process.env.PUBLIC_URL ??
  (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : null) ??
  process.env.RENDER_EXTERNAL_URL ??
  null;

async function main() {
  // Recomputed on every call (not captured once) so a QR code generated after the LAN
  // network changes still points somewhere real — and, since startCertWatcher below
  // hot-swaps the TLS cert to match, that new address is actually reachable too. In the
  // publicUrl case this is just a constant — nothing about it ever changes at runtime.
  const lanUrlBase = () => publicUrl ?? `https://${getLanIPv4()}:${PORT}`;

  // publicUrl means we're behind a real TLS-terminating edge (Fly's proxy, with its own
  // Let's Encrypt-backed cert) that forwards plain HTTP internally — hand-rolling our own
  // self-signed cert for this path would be wrong, not just redundant. The LAN path is
  // unchanged: our own https.Server using the locally generated/hot-swapped dev cert.
  const server: HTTPServer | HTTPSServer = publicUrl ? createHttpServer() : createHttpsServer(loadDevCert());

  if (isProd) {
    const { default: sirv } = await import("sirv");
    const serve = sirv(path.join(root, "dist"), { single: false, dev: false });
    server.on("request", (req, res) => {
      if (!publicUrl && handleCertTrustRoute(req, res)) return;
      serve(req, res, () => {
        res.statusCode = 404;
        res.end("Not found");
      });
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root,
      // HMR is deliberately disabled: sharing this HTTPS server's upgrade handling between
      // Vite's HMR websocket and our own /ws app socket was unreliable (intermittent frame
      // errors triggering full-page reload loops — the "flickering" this app must never do
      // for a screen a room full of people is looking at). Refresh the browser after editing
      // source files instead of relying on hot reload.
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
    server.on("request", (req, res) => {
      if (!publicUrl && handleCertTrustRoute(req, res)) return;
      vite.middlewares(req, res, async () => {
        const url = req.url ?? "/";
        const page = url === "/" || url.startsWith("/?") ? "index.html" : url.startsWith("/play.html") ? "play.html" : null;
        if (!page) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        try {
          const raw = readFileSync(path.join(root, page), "utf-8");
          let html = await vite.transformIndexHtml(url, raw);
          // Vite still bakes a hardcoded fallback HMR websocket port into the injected
          // client script here even with hmr:false (a quirk of this middlewareMode +
          // manual transformIndexHtml setup) — strip the tag so it never tries to connect.
          html = html.replace(/<script[^>]*src="\/@vite\/client"[^>]*><\/script>\s*/, "");
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (err) {
          vite.ssrFixStacktrace(err as Error);
          res.statusCode = 500;
          res.end((err as Error).stack ?? String(err));
        }
      });
    });
  }

  const roomManager = attachWebSocketServer(server, lanUrlBase);

  // The cert hot-swap only means anything for our own self-signed LAN cert — publicUrl's
  // TLS is Fly's problem, and its hostname never changes at runtime the way a LAN IP does.
  if (!publicUrl) {
    startCertWatcher(server as HTTPSServer, () => {
      for (const room of roomManager.allRooms()) {
        sendToHost(room, { type: "room:lan_url_changed", lanUrl: `${lanUrlBase()}/play.html?room=${room.code}` });
      }
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log(`  Party Arcade running at:`);
    console.log(`  \x1b[1m${lanUrlBase()}/\x1b[0m  <- open this on the big screen`);
    console.log("");
    if (publicUrl) {
      console.log(`  Anyone with that link can join from any network — no shared Wi-Fi needed.`);
    } else {
      console.log(`  Phones join by scanning the QR code shown there (same Wi-Fi network).`);
      console.log(`  First connection: tap through Safari's "not private" cert warning once.`);
    }
    console.log("");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Last-resort backstop: everything reachable from a client message already has its own
// handling (per-message try/catch in ws-server.ts, fireAndForget in handlers.ts), but
// there's no way to prove that's exhaustive across every setTimeout/interval callback in
// the app. Without this, anything that slips through takes down every room on the box —
// with it, the party degrades to a logged error instead of ending for everyone at once.
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException — party continues:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection — party continues:", reason);
});
