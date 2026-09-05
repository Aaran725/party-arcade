import { ArcadeSocket } from "@shared/ws-client";
import { SpectatorRouter } from "./SpectatorRouter";

const root = document.getElementById("app")!;
const socket = new ArcadeSocket();
new SpectatorRouter(root, socket);
socket.connect();
