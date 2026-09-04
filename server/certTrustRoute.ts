import { existsSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ROOT_CERT_PATH } from "./certGen";

// Fixed, not random — re-downloading/reinstalling the profile replaces the existing one on
// the device instead of piling up duplicates under a new identifier each time.
const PAYLOAD_UUID = "8f3b6b4c-9b0a-4e9a-8f1a-6a2f9a2b7c11";
const PAYLOAD_IDENTIFIER = "com.party-arcade.devcert";
const LEAF_PAYLOAD_UUID = "3c7d9e2a-5f6b-4a1c-9d0e-2b8a4f6c1e33";

function trustPageHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Party Arcade — Stop the security warning</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0b0b12; color: rgba(255,255,255,0.92); margin: 0; padding: 2em 1.4em 3em; max-width: 480px; margin-inline: auto; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: 0.2em; }
  p { color: rgba(255,255,255,0.7); }
  ol { padding-left: 1.2em; color: rgba(255,255,255,0.85); }
  li { margin-bottom: 0.6em; }
  a.button { display: block; text-align: center; background: #0a84ff; color: white; text-decoration: none; font-weight: 600; padding: 0.9em; border-radius: 14px; margin: 1.6em 0; }
  .note { font-size: 0.85rem; color: rgba(255,255,255,0.45); }
</style>
</head>
<body>
  <h1>Stop the "Not Secure" warning</h1>
  <p>This installs a trust profile for this room's host device, so future parties on this Wi-Fi connect without a browser warning.</p>
  <a class="button" href="/trust/profile.mobileconfig">Download the profile</a>
  <ol>
    <li>Tap the download button above, then open <strong>Settings</strong> — you'll see "Profile Downloaded" near the top.</li>
    <li>Tap it, then <strong>Install</strong> (twice, entering your passcode if asked).</li>
    <li>Go to <strong>Settings → General → About → Certificate Trust Settings</strong> and turn on full trust for "Party Arcade Dev CA".</li>
  </ol>
  <p class="note">One-time, per device. iOS will call the profile "Not Verified" during install since it isn't signed by a paid certificate authority — that's expected and it still works.</p>
</body>
</html>`;
}

function mobileConfigXml(rootCertDer: Buffer): string {
  const base64 = rootCertDer.toString("base64");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>party-arcade-dev-ca.cer</string>
      <key>PayloadContent</key>
      <data>${base64}</data>
      <key>PayloadDescription</key>
      <string>Trusts the Party Arcade local dev certificate so this device stops showing a security warning when it joins a party on this Wi-Fi.</string>
      <key>PayloadDisplayName</key>
      <string>Party Arcade Dev CA</string>
      <key>PayloadIdentifier</key>
      <string>${PAYLOAD_IDENTIFIER}.leaf</string>
      <key>PayloadType</key>
      <string>com.apple.security.pkcs1</string>
      <key>PayloadUUID</key>
      <string>${LEAF_PAYLOAD_UUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Trusts this Party Arcade host so future parties on this Wi-Fi connect without a browser warning.</string>
  <key>PayloadDisplayName</key>
  <string>Party Arcade Trust</string>
  <key>PayloadIdentifier</key>
  <string>${PAYLOAD_IDENTIFIER}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${PAYLOAD_UUID}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
}

/**
 * Serves the one-time "stop the security warning" flow — a plain instructions page at
 * /trust and the actual Apple Configuration Profile at /trust/profile.mobileconfig, both
 * outside the Vite/sirv app routing since neither needs the app bundle. Reads the root CA
 * fresh off disk on every request (never cached) so it always reflects whatever's currently
 * there, including after a cold-start regeneration. Returns true if it handled the request —
 * callers should `return` immediately after a true result.
 */
export function handleCertTrustRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "/";

  if (url === "/trust") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(trustPageHtml());
    return true;
  }

  if (url === "/trust/profile.mobileconfig") {
    if (!existsSync(ROOT_CERT_PATH)) {
      res.statusCode = 404;
      res.end("Root certificate not generated yet — load the app once first.");
      return true;
    }
    const rootCertPem = readFileSync(ROOT_CERT_PATH, "utf8");
    const der = new X509Certificate(rootCertPem).raw;
    res.setHeader("Content-Type", "application/x-apple-aspen-config; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="party-arcade-trust.mobileconfig"');
    res.end(mobileConfigXml(der));
    return true;
  }

  return false;
}
