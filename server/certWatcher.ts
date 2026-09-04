import type { Server as HTTPSServer } from "node:https";
import { getLanIPv4 } from "./lan";
import { generateSelfSignedCert, writeCertToDisk } from "./certGen";

const POLL_INTERVAL_MS = 5000;

/**
 * The dev cert is only generated once, before the process starts (see
 * scripts/generate-cert.ts) — fine for a normal session, but if the host's LAN IP
 * changes mid-party (switches WiFi, a hotspot drops), the already-loaded cert only
 * covers the old IP forever, and any freshly-printed QR code points somewhere the
 * TLS handshake will reject. This polls for that change and hot-swaps the cert on
 * the already-running server via `setSecureContext` — `https.Server` supports this
 * without a restart, since it's really a `tls.Server` underneath.
 */
export function startCertWatcher(httpsServer: HTTPSServer, onIpChanged: (newIp: string) => void): () => void {
  let lastIp = getLanIPv4();

  const timer = setInterval(() => {
    const currentIp = getLanIPv4();
    if (currentIp === lastIp) return;
    lastIp = currentIp;

    const { key, cert } = generateSelfSignedCert(currentIp);
    writeCertToDisk(currentIp, key, cert);
    httpsServer.setSecureContext({ key, cert });
    console.log(`[cert-watcher] LAN IP changed -> ${currentIp}; cert hot-swapped without a restart.`);
    onIpChanged(currentIp);
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}
