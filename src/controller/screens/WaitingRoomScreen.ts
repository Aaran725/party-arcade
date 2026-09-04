import { el } from "@shared/dom";
import { createAvatarSvg } from "@shared/avatar";
import type { PlayerInfo } from "@shared/types/room";

/** A live "who else is here" strip — shared by the waiting room and the sitting-out screen so both feel like part of an active room instead of a dead end. */
export function roomPresenceStrip(players: PlayerInfo[]): HTMLElement {
  const connected = players.filter((p) => p.connected);
  return el("div", { class: "room-presence" }, [
    el("div", { class: "player-strip" }, connected.map((p) => createAvatarSvg(p.id, p.color, { size: "1.8em" }))),
    el("p", { class: "text-caption" }, [`${connected.length} player${connected.length === 1 ? "" : "s"} in the room`]),
  ]);
}

export function renderWaitingRoomScreen(
  root: HTMLElement,
  opts: { id: string; name: string; color: string; players?: PlayerInfo[]; onCareer?: () => void },
): void {
  const avatar = createAvatarSvg(opts.id, opts.color, { size: "2.2em" });
  avatar.classList.add("anim-pulse");

  const careerBtn = el("button", { class: "glass-button" }, ["🏆 Career"]);
  careerBtn.addEventListener("click", () => opts.onCareer?.());

  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      avatar,
      el("h2", { class: "title-md" }, [`You're in, ${opts.name}`]),
      el("p", { class: "text-body" }, ["Waiting for the host to start a game…"]),
      ...(opts.players ? [roomPresenceStrip(opts.players)] : []),
      ...(opts.onCareer ? [careerBtn] : []),
    ]),
  );
}
