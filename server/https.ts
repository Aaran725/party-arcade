import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const CERT_DIR = path.resolve(import.meta.dirname, "..", "certs");
const KEY_PATH = path.join(CERT_DIR, "dev-key.pem");
const CERT_PATH = path.join(CERT_DIR, "dev-cert.pem");

export function loadDevCert(): { key: Buffer; cert: Buffer } {
  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    throw new Error(
      "Dev HTTPS cert not found. Run `npm run predev` (or just `npm run dev`, which generates it automatically).",
    );
  }
  return { key: readFileSync(KEY_PATH), cert: readFileSync(CERT_PATH) };
}
