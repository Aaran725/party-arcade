import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import forge from "node-forge";

export const CERT_DIR = path.resolve(import.meta.dirname, "..", "certs");
export const KEY_PATH = path.join(CERT_DIR, "dev-key.pem");
export const CERT_PATH = path.join(CERT_DIR, "dev-cert.pem");
const META_PATH = path.join(CERT_DIR, "dev-cert.meta.json");
// The trust anchor server/certTrustRoute.ts serves for phones to install once — generated a
// single time and never touched by the per-IP leaf rotation below, so trusting it survives
// every future Wi-Fi change instead of needing reinstalling each time the leaf cert rotates.
export const ROOT_KEY_PATH = path.join(CERT_DIR, "root-ca-key.pem");
export const ROOT_CERT_PATH = path.join(CERT_DIR, "root-ca-cert.pem");

export function certCoversIp(certPem: string, ip: string): boolean {
  try {
    const cert = new X509Certificate(certPem);
    const san = cert.subjectAltName ?? "";
    return san.includes(`IP Address:${ip}`);
  } catch {
    return false;
  }
}

/** True if there's no cert on disk yet, it doesn't cover `ip`, or it's about to expire — the single source of truth both the startup script and the live cert watcher check against. */
export function needsRegeneration(ip: string): boolean {
  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) return true;
  const certPem = readFileSync(CERT_PATH, "utf8");
  if (!certCoversIp(certPem, ip)) return true;
  try {
    const cert = new X509Certificate(certPem);
    if (new Date(cert.validTo).getTime() < Date.now() + 24 * 60 * 60 * 1000) return true;
  } catch {
    return true;
  }
  return false;
}

function randomSerial(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(9));
}

/** Loads the persisted root CA off disk, generating it once if missing or near expiry (~10y validity, so this basically never re-fires once a device has trusted it). */
function ensureRootCa(): { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate } {
  if (existsSync(ROOT_KEY_PATH) && existsSync(ROOT_CERT_PATH)) {
    try {
      const cert = forge.pki.certificateFromPem(readFileSync(ROOT_CERT_PATH, "utf8"));
      if (cert.validity.notAfter.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        return { key: forge.pki.privateKeyFromPem(readFileSync(ROOT_KEY_PATH, "utf8")), cert };
      }
    } catch {
      // Corrupt or unreadable — fall through and regenerate below.
    }
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.serialNumber = randomSerial();
  cert.publicKey = keys.publicKey;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [{ name: "commonName", value: "Party Arcade Dev CA" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, cRLSign: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  if (!existsSync(CERT_DIR)) mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(ROOT_KEY_PATH, forge.pki.privateKeyToPem(keys.privateKey));
  writeFileSync(ROOT_CERT_PATH, forge.pki.certificateToPem(cert));
  return { key: keys.privateKey, cert };
}

/** A per-IP leaf cert signed by the persisted root CA (ensureRootCa above) rather than self-signed — trusting the root once (server/certTrustRoute.ts) covers every future leaf this rotates to, including across Wi-Fi changes (server/certWatcher.ts). */
export function generateSelfSignedCert(ip: string): { key: string; cert: string } {
  const root = ensureRootCa();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.serialNumber = randomSerial();
  cert.publicKey = keys.publicKey;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 825);
  cert.setSubject([{ name: "commonName", value: ip }]);
  cert.setIssuer(root.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, dataEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
        { type: 7, ip },
      ],
    },
  ]);
  cert.sign(root.key, forge.md.sha256.create());

  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
}

export function writeCertToDisk(ip: string, key: string, cert: string): void {
  if (!existsSync(CERT_DIR)) mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(KEY_PATH, key);
  writeFileSync(CERT_PATH, cert);
  writeFileSync(META_PATH, JSON.stringify({ lanIp: ip, generatedAt: new Date().toISOString() }, null, 2));
}
