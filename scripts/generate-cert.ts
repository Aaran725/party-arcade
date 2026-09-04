import { getLanIPv4 } from "../server/lan";
import { needsRegeneration, generateSelfSignedCert, writeCertToDisk } from "../server/certGen";

// A public deploy (Fly.io — FLY_APP_NAME auto-injected; Render — RENDER_EXTERNAL_URL
// auto-injected; or an explicit PUBLIC_URL override) sits behind a real TLS-terminating
// edge and never touches our self-signed LAN cert at all (see server/index.ts). Skipping
// this keeps predev/prebuild/prestart safe to run unconditionally anywhere, including
// inside a container image build, without needing a bespoke build command that diverges
// from the normal npm script surface.
if (process.env.PUBLIC_URL || process.env.FLY_APP_NAME || process.env.RENDER_EXTERNAL_URL) {
  console.log("[generate-cert] Public deploy env detected — skipping self-signed cert generation.");
  process.exit(0);
}

const lanIp = getLanIPv4();

if (needsRegeneration(lanIp)) {
  const { key, cert } = generateSelfSignedCert(lanIp);
  writeCertToDisk(lanIp, key, cert);
  console.log(`[generate-cert] Generated dev HTTPS cert for ${lanIp} -> certs/`);
} else {
  console.log(`[generate-cert] Reusing existing dev HTTPS cert (covers ${lanIp})`);
}
