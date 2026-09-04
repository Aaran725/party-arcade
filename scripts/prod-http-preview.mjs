// Same idea as dev-http-preview.mjs but serves the production build (dist/) with
// zero Vite client/HMR involved — useful for a clean sandbox verification pass.
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 8445);

const { attachWebSocketServer } = await import(path.join(root, "server/ws-server.ts"));

const serve = sirv(path.join(root, "dist"), { single: false, dev: false });
const httpServer = createHttpServer((req, res) =>
  serve(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  }),
);

attachWebSocketServer(httpServer, () => `http://localhost:${PORT}`);

httpServer.listen(PORT, () => {
  console.log(`[prod-http-preview] http://localhost:${PORT}/ (prod build, plain HTTP, verification only)`);
});
