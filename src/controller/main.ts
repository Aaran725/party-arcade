import { ArcadeSocket } from "@shared/ws-client";
import { ControllerRouter } from "./Router";
import { startLiquidGlassTilt } from "./liquidGlass";
import { initGlassRefraction } from "@shared/glassRefraction";

// iOS Safari famously won't reliably arm `:active` CSS states without a real touchstart
// listener registered somewhere in the document — a no-op listener is enough to satisfy
// it. Without this, every `:active` press-state rule in controller.css/glass.css is at
// risk of feeling flaky specifically on iPhone.
document.addEventListener("touchstart", () => {}, { passive: true });

startLiquidGlassTilt();
initGlassRefraction();

const root = document.getElementById("app")!;
const socket = new ArcadeSocket();
new ControllerRouter(root, socket);
socket.connect();
