import { ArcadeSocket } from "@shared/ws-client";
import { DisplayRouter } from "./Router";
import { startLiquidGlassPointer } from "./liquidGlass";
import { initGlassRefraction } from "@shared/glassRefraction";

startLiquidGlassPointer();
initGlassRefraction();

const root = document.getElementById("app")!;
const socket = new ArcadeSocket();
new DisplayRouter(root, socket);
socket.connect();
