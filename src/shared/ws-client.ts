import { APP_WS_PATH } from "@shared/protocol/constants";
import type { ClientToServerMessage, ServerToClientMessage } from "@shared/protocol/messages";

type MessageHandler = (msg: ServerToClientMessage) => void;
type ConnectionHandler = () => void;

export class ArcadeSocket {
  private ws: WebSocket | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private openHandlers = new Set<ConnectionHandler>();
  private closeHandlers = new Set<ConnectionHandler>();
  private reconnectDelay = 500;
  private shouldReconnect = true;
  private sendQueue: ClientToServerMessage[] = [];

  connect(): void {
    this.shouldReconnect = true;
    this.open();
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}${APP_WS_PATH}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelay = 500;
      for (const msg of this.sendQueue.splice(0)) this.send(msg);
      this.openHandlers.forEach((h) => h());
    });

    ws.addEventListener("message", (ev) => {
      let msg: ServerToClientMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // malformed frame — safe to ignore
      }
      if (msg.type === "ping") {
        this.send({ type: "pong" });
        return;
      }
      // Deliberately outside the parse try/catch: a bug in a handler must surface in the
      // console, not get silently swallowed alongside malformed-JSON handling — a handler
      // throwing here previously meant the UI just hung with no trace at all.
      this.messageHandlers.forEach((h) => h(msg));
    });

    ws.addEventListener("close", () => {
      this.closeHandlers.forEach((h) => h());
      if (this.shouldReconnect) {
        setTimeout(() => this.open(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 5000);
      }
    });

    ws.addEventListener("error", () => ws.close());
  }

  send(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.sendQueue.push(msg);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onOpen(handler: ConnectionHandler): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: ConnectionHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
