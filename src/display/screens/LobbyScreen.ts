import { el, clear } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import { renderQrCode } from "../qrcode";
import { mountAmbientBackground } from "../game-runtime/ambientMenuBackground";

function playerListNodes(players: PlayerInfo[]): (Node | string)[] {
  return players.length
    ? players.map((p) =>
        el("div", { class: "glass-pill anim-pop-in" }, [
          createAvatarSvg(p.id, p.color),
          p.name,
        ]),
      )
    : [el("p", { class: "text-body anim-pulse" }, ["Waiting for players to scan the QR code…"])];
}

export function renderLobbyScreen(
  root: HTMLElement,
  opts: { roomCode: string; lanUrl: string; players: PlayerInfo[]; onContinue: () => void },
): void {
  const playerStrip = el("div", { class: "player-strip" }, playerListNodes(opts.players));
  const canvas = el("canvas", { class: "qr-canvas" });

  const panel = el("div", { class: "glass-panel lobby-panel anim-pop-in" }, [
    el("p", { class: "text-caption" }, ["Scan to join"]),
    canvas,
    el("div", { class: "glass-pill room-code mono" }, [opts.roomCode]),
    el("p", { class: "text-body" }, ["Same Wi-Fi network as this screen."]),
    el("p", { class: "text-caption" }, ["Tip: phones can visit /trust once to stop future security warnings."]),
  ]);

  const continueBtn = el("button", { class: "glass-button accent" }, ["Continue to game select →"]);
  continueBtn.disabled = opts.players.length === 0;
  continueBtn.addEventListener("click", opts.onContinue);

  root.replaceChildren(
    el("div", { class: "lobby-layout" }, [
      el("div", { class: "lobby-hero" }, [
        el("h1", { class: "title-xl" }, ["Party Arcade"]),
        el("p", { class: "text-body" }, ["Grab your phone, scan the code, and jump in."]),
        el("div", { class: "player-strip-wrap" }, [playerStrip]),
        continueBtn,
      ]),
      panel,
    ]),
  );

  void renderQrCode(canvas, opts.lanUrl);
  mountAmbientBackground(root);
}

/**
 * Updates the player list and Continue button in place, without touching the QR
 * canvas or anything else — avoids the blank-then-redraw flash a full re-render
 * of renderLobbyScreen would cause every time a player joins or leaves.
 */
export function updateLobbyPlayers(root: HTMLElement, players: PlayerInfo[]): boolean {
  const strip = root.querySelector<HTMLElement>(".player-strip");
  const continueBtn = root.querySelector<HTMLButtonElement>(".lobby-hero .glass-button");
  if (!strip || !continueBtn) return false;

  clear(strip);
  strip.append(...playerListNodes(players));
  continueBtn.disabled = players.length === 0;
  return true;
}
