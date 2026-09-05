import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION } from "@shared/protocol/constants";
import type { ClientToServerMessage, InputMessage } from "@shared/protocol/messages";
import type { GameId, PlayerInfo } from "@shared/types/room";
import { colorForIndex } from "@shared/colors";
import { GAME_REGISTRY, getGameMeta } from "../games/registry";
import type { RoomManager } from "../rooms/RoomManager";
import type { Room } from "../rooms/Room";
import { broadcastRoom, broadcastToControllers, broadcastToSpectators, sendTo, sendToHost } from "./broadcast";
import { rateDrawing } from "../ai/rateDrawing";
import { transcribeAudio } from "../ai/transcribeAudio";
import { getScenario } from "../ai/generateScenario";
import { textToSpeech } from "../ai/textToSpeech";
import { createAvatarSession } from "../ai/simliSession";
import { getWildcard } from "../ai/generateWildcard";
import { ensureProfile, getProfile, recordGameResult, getHallOfFame } from "../storage/playerStore";
import { saveSnapshot, loadSnapshot } from "../rooms/roomSnapshot";

export interface ConnectionState {
  role: "unassigned" | "host" | "controller" | "spectator";
  roomCode?: string;
  playerId?: string;
}

const REACTION_MIN_INTERVAL_MS = 150;
const lastReactionAt = new WeakMap<WebSocket, number>();

// Motion input is already client-throttled to 45Hz (TiltMazeController etc.) — this floor
// sits well above any legitimate stream and only catches a runaway loop or malicious spam.
const INPUT_MIN_INTERVAL_MS = 1000 / 120;
const WAVE_STAGGER_MS = 220;
const lastInputAt = new WeakMap<WebSocket, number>();

/**
 * handleMessage() itself stays synchronous (see ws-server.ts's message handler, which wraps
 * it in a try/catch), but several handlers below kick off an AI call and reply later via
 * sendToHost — a bare `void (async () => {...})()` there means a throw inside becomes an
 * *unhandled rejection*, which is invisible to that try/catch and can crash the whole
 * process. Every fire-and-forget handler routes through here instead so one failed AI call
 * degrades to a logged error, not a dead server.
 */
export function fireAndForget(fn: () => Promise<void>): void {
  fn().catch((err) => console.error("[handlers] unhandled error in fire-and-forget handler:", err));
}

export interface ServerInfo {
  lanUrlBase: string; // e.g. https://192.168.1.23:8443
}

function toPlayerInfo(id: string, p: { name: string; color: string; connected: boolean }): PlayerInfo {
  return { id, name: p.name, color: p.color, connected: p.connected };
}

function roomPlayerList(room: Room): PlayerInfo[] {
  return [...room.players.entries()].map(([id, p]) => toPlayerInfo(id, p));
}

export function handleMessage(
  roomManager: RoomManager,
  socket: WebSocket,
  state: ConnectionState,
  msg: ClientToServerMessage,
  serverInfo: ServerInfo,
): void {
  switch (msg.type) {
    case "display:create": {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        sendTo(socket, { type: "error", code: "version_mismatch", message: "Client/server protocol mismatch. Reload the page." });
        return;
      }
      const room = roomManager.createRoom(socket);
      saveSnapshot(room);
      state.role = "host";
      state.roomCode = room.code;
      sendTo(socket, {
        type: "room:created",
        roomCode: room.code,
        lanUrl: `${serverInfo.lanUrlBase}/play.html?room=${room.code}`,
        games: GAME_REGISTRY,
      });
      return;
    }

    case "display:resume": {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        sendTo(socket, { type: "error", code: "version_mismatch", message: "Client/server protocol mismatch. Reload the page." });
        return;
      }
      const existing = roomManager.getRoom(msg.roomCode);
      if (!existing) {
        // Room is gone from memory — either the grace period genuinely expired, or (the
        // case this now actually recovers from) the whole process restarted. Check disk
        // before assuming the latter is unrecoverable: a snapshot means the party can
        // pick back up in the same room code instead of everyone getting bounced to a
        // brand new one. Rehydrated with an empty player list on purpose — nobody's
        // reconnected yet; each phone's own player:reconnect fills itself back in below.
        const snapshot = loadSnapshot(msg.roomCode);
        if (snapshot) {
          const room = roomManager.createRoomWithCode(snapshot.code, socket);
          room.phase = snapshot.phase;
          room.currentGame = snapshot.currentGame;
          room.lastScores = snapshot.lastScores;
          state.role = "host";
          state.roomCode = room.code;
          sendTo(socket, {
            type: "room:resumed",
            roomCode: room.code,
            lanUrl: `${serverInfo.lanUrlBase}/play.html?room=${room.code}`,
            games: GAME_REGISTRY,
            players: [],
          });
          return;
        }
        // No snapshot either — genuinely gone, fall back to a fresh room.
        const room = roomManager.createRoom(socket);
        state.role = "host";
        state.roomCode = room.code;
        sendTo(socket, {
          type: "room:created",
          roomCode: room.code,
          lanUrl: `${serverInfo.lanUrlBase}/play.html?room=${room.code}`,
          games: GAME_REGISTRY,
        });
        return;
      }
      roomManager.cancelHostDisconnect(existing);
      existing.hostSocket = socket;
      state.role = "host";
      state.roomCode = existing.code;
      sendTo(socket, {
        type: "room:resumed",
        roomCode: existing.code,
        lanUrl: `${serverInfo.lanUrlBase}/play.html?room=${existing.code}`,
        games: GAME_REGISTRY,
        players: roomPlayerList(existing),
      });
      return;
    }

    case "player:join": {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        sendTo(socket, { type: "player:join_rejected", reason: "version_mismatch" });
        return;
      }
      const room = roomManager.getRoom(msg.roomCode);
      if (!room) {
        sendTo(socket, { type: "player:join_rejected", reason: "room_not_found" });
        return;
      }
      if (room.phase !== "lobby" && room.phase !== "selecting" && room.phase !== "game_over") {
        sendTo(socket, { type: "player:join_rejected", reason: "game_in_progress" });
        return;
      }
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        sendTo(socket, { type: "player:join_rejected", reason: "room_full" });
        return;
      }
      const name = msg.name.trim().slice(0, 16) || "Player";
      const nameTaken = [...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (nameTaken) {
        sendTo(socket, { type: "player:join_rejected", reason: "name_taken" });
        return;
      }

      const playerId = randomUUID();
      const sessionToken = randomUUID();
      const color = colorForIndex(room.players.size);
      room.players.set(playerId, {
        id: playerId,
        sessionToken,
        name,
        color,
        socket,
        connected: true,
        joinedAt: Date.now(),
        leaveTimer: null,
        deviceId: msg.deviceId,
      });
      ensureProfile(msg.deviceId, name); // touches lastSeen/name even if this device never finishes a game this session
      saveSnapshot(room);

      state.role = "controller";
      state.roomCode = room.code;
      state.playerId = playerId;

      sendTo(socket, {
        type: "player:joined",
        playerId,
        sessionToken,
        color,
        roomCode: room.code,
        games: GAME_REGISTRY,
      });
      sendTo(socket, {
        type: "room:state_sync",
        players: roomPlayerList(room),
        phase: room.phase,
        currentGame: room.currentGame,
      });

      sendToHost(room, { type: "room:player_joined", player: toPlayerInfo(playerId, room.players.get(playerId)!) });
      broadcastToControllers(room, { type: "room:player_joined", player: toPlayerInfo(playerId, room.players.get(playerId)!) }, playerId);
      broadcastToSpectators(room, { type: "room:player_joined", player: toPlayerInfo(playerId, room.players.get(playerId)!) });
      return;
    }

    case "player:reconnect": {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        sendTo(socket, { type: "player:reconnect_failed", reason: "version_mismatch" });
        return;
      }
      const room = roomManager.getRoom(msg.roomCode);
      if (!room) {
        // Genuinely no room to reconnect to yet. If this is a post-restart reconnect race
        // (this phone got here before the Display's own display:resume rehydrated the
        // room shell — see that handler), there's nothing to attach to yet either way; the
        // phone's own ArcadeSocket already retries with backoff, and the next attempt
        // will find the room once the Display has reconnected.
        sendTo(socket, { type: "player:reconnect_failed", reason: "room_not_found" });
        return;
      }
      let player = room.players.get(msg.playerId);
      // Tracks whether this player had to be rebuilt from a snapshot just now — the
      // Display's own room.players map may be genuinely empty after a rehydrated
      // display:resume, so "reconnected" (which only updates an *existing* entry,
      // client-side) isn't enough to make them show up there; they need the fuller
      // "joined" broadcast that actually inserts a new one. See below.
      let rehydratedFromSnapshot = false;
      if (!player) {
        // Not yet materialized in this room — e.g. the room was just rehydrated from a
        // snapshot (server/rooms/roomSnapshot.ts) after a restart and this is the first
        // time this specific player has been seen since. Check whether they genuinely
        // belong here before giving up, rather than treating "not found yet" as "never existed."
        const snapshot = loadSnapshot(room.code);
        const known = snapshot?.players.find((p) => p.id === msg.playerId && p.sessionToken === msg.sessionToken);
        if (known) {
          player = {
            id: known.id,
            sessionToken: known.sessionToken,
            name: known.name,
            color: known.color,
            socket,
            connected: true,
            joinedAt: Date.now(),
            leaveTimer: null,
            deviceId: known.deviceId,
          };
          room.players.set(known.id, player);
          rehydratedFromSnapshot = true;
        }
      }
      if (!player || player.sessionToken !== msg.sessionToken) {
        sendTo(socket, { type: "player:reconnect_failed", reason: "session_invalid" });
        return;
      }

      // Deliberately no phase gate here, unlike "player:join" — reconnect must succeed
      // in every phase, including "calibrating" and "in_game". That asymmetry is the
      // entire point of this message; do not copy player:join's phase check over.

      if (player.socket !== socket && player.socket.readyState === player.socket.OPEN) {
        // A second connection is presenting this player's session (duplicate tab, or a
        // stale socket the server hasn't detected as closed yet) — tell it plainly and
        // close it, so only one socket is ever registered as this player's.
        sendTo(player.socket, { type: "error", code: "session_replaced", message: "You reconnected from another tab or device." });
        player.socket.close();
      }

      roomManager.cancelPlayerDisconnect(player);
      player.socket = socket;
      player.connected = true;

      state.role = "controller";
      state.roomCode = room.code;
      state.playerId = player.id;

      sendTo(socket, {
        type: "player:reconnected",
        playerId: player.id,
        color: player.color,
        name: player.name,
        roomCode: room.code,
        games: GAME_REGISTRY,
        phase: room.phase,
        currentGame: room.currentGame,
        players: roomPlayerList(room),
        lastScores: room.phase === "game_over" ? room.lastScores : null,
      });

      if (rehydratedFromSnapshot) {
        // The Display (and any already-connected controllers/spectators) may have never
        // seen this player at all this process lifetime — a plain "reconnected" signal
        // only updates an existing entry client-side, which would silently no-op here.
        const info = toPlayerInfo(player.id, player);
        sendToHost(room, { type: "room:player_joined", player: info });
        broadcastToControllers(room, { type: "room:player_joined", player: info }, player.id);
        broadcastToSpectators(room, { type: "room:player_joined", player: info });
      } else {
        sendToHost(room, { type: "room:player_reconnected", playerId: player.id });
        broadcastToControllers(room, { type: "room:player_reconnected", playerId: player.id }, player.id);
        broadcastToSpectators(room, { type: "room:player_reconnected", playerId: player.id });
      }
      return;
    }

    case "display:score_update": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      broadcastToControllers(room, { type: "game:score_update", playerId: msg.playerId, score: msg.score });
      broadcastToSpectators(room, { type: "game:score_update", playerId: msg.playerId, score: msg.score });
      return;
    }

    case "display:private_message": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      const target = room.players.get(msg.playerId);
      if (!target) return; // player left — silently drop
      sendTo(target.socket, { type: "game:private_message", payload: msg.payload });
      return;
    }

    case "display:request_rating": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      // Fire-and-forget: handleMessage stays synchronous (see ws-server.ts's message
      // handler), so this responds later via sendToHost once every rating settles —
      // Promise.all so one slow/failed image never blocks the others.
      fireAndForget(async () => {
        const ratings = await Promise.all(
          msg.submissions.map(async (s) => {
            const rated = await rateDrawing(s.imageData, msg.word);
            return { playerId: s.playerId, score: rated?.score ?? null, comment: rated?.comment ?? null };
          }),
        );
        sendToHost(room, { type: "game:ratings_result", ratings });
      });
      return;
    }

    case "display:request_transcription": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      fireAndForget(async () => {
        const text = await transcribeAudio(msg.audioData);
        sendToHost(room, { type: "game:transcription_result", playerId: msg.playerId, text });
      });
      return;
    }

    case "display:request_scenario": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      fireAndForget(async () => {
        const scenario = await getScenario();
        sendToHost(room, { type: "game:scenario_result", scenario });
      });
      return;
    }

    case "display:request_hall_of_fame": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      sendToHost(room, { type: "game:hall_of_fame_result", entries: getHallOfFame() });
      return;
    }

    case "display:request_host_speech": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      fireAndForget(async () => {
        const audioData = await textToSpeech(msg.text);
        sendToHost(room, { type: "game:host_speech_result", audioData });
      });
      return;
    }

    case "display:request_avatar_session": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      fireAndForget(async () => {
        const sessionToken = await createAvatarSession();
        sendToHost(room, { type: "game:avatar_session_result", sessionToken });
      });
      return;
    }

    case "display:request_wildcard": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      fireAndForget(async () => {
        const round = await getWildcard();
        sendToHost(room, { type: "game:wildcard_result", mechanic: round.mechanic, prompt: round.prompt, choices: round.choices });
      });
      return;
    }

    case "display:party_recap": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      broadcastToSpectators(room, {
        type: "spectator:party_recap",
        players: msg.players,
        standings: msg.standings,
        history: msg.history,
        achievements: msg.achievements,
      });
      return;
    }

    case "display:standings_update": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      broadcastToSpectators(room, { type: "spectator:standings_update", standings: msg.standings });
      return;
    }

    case "display:trigger_wave": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      // room.players is a Map, populated via .set() only on join and never reordered —
      // iteration order is stable join order, exactly the sequencing a "wave" needs, for free.
      let i = 0;
      for (const player of room.players.values()) {
        sendTo(player.socket, { type: "room:wave", staggerIndex: i, staggerMs: WAVE_STAGGER_MS, color: player.color });
        i++;
      }
      return;
    }

    case "host:kick_player": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      const target = room.players.get(msg.playerId);
      if (!target) return;
      room.players.delete(msg.playerId);
      saveSnapshot(room);
      sendTo(target.socket, { type: "player:kicked" });
      target.socket.close();
      sendToHost(room, { type: "room:player_left", playerId: msg.playerId });
      broadcastToControllers(room, { type: "room:player_left", playerId: msg.playerId }, msg.playerId);
      broadcastToSpectators(room, { type: "room:player_left", playerId: msg.playerId });
      return;
    }

    case "host:pause_game": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      broadcastToControllers(room, { type: "game:paused" });
      return;
    }

    case "host:resume_game": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      broadcastToControllers(room, { type: "game:resumed" });
      return;
    }

    case "game:select": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      const meta = getGameMeta(msg.gameId);
      if (!meta) return;
      room.currentGame = msg.gameId;
      room.phase = meta.requiresMotion ? "calibrating" : "selecting";
      saveSnapshot(room);
      broadcastRoom(room, { type: "game:selected", gameId: msg.gameId, meta });
      broadcastToSpectators(room, { type: "game:selected", gameId: msg.gameId, meta });
      if (meta.requiresMotion) {
        broadcastToControllers(room, { type: "game:calibrate_request" });
      }
      return;
    }

    case "game:calibrate_ack": {
      const found = roomManager.findRoomByPlayerSocket(socket);
      if (!found) return;
      sendToHost(found.room, { type: "game:calibrate_progress", playerId: found.playerId });
      return;
    }

    case "game:start": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      // The client already gates this in the UI (GameSelectScreen/PartySetupScreen), but
      // that's stale-state-vulnerable, not authoritative — re-check here so a mismatched
      // client can't put a room into a broken mid-game state.
      const meta = getGameMeta(msg.gameId);
      const count = room.players.size;
      if (meta && (count < meta.minPlayers || count > meta.maxPlayers)) {
        sendTo(socket, {
          type: "error",
          code: "not_enough_players",
          message: `${meta.title} needs ${meta.minPlayers}-${meta.maxPlayers} players — this room has ${count}.`,
        });
        return;
      }
      room.phase = "in_game";
      room.lastScores = null;
      saveSnapshot(room);
      broadcastToControllers(room, { type: "game:start", gameId: msg.gameId });
      return;
    }

    case "game:over": {
      const room = requireHostRoom(roomManager, state);
      if (!room) return;
      room.phase = "game_over";
      room.lastScores = msg.scores;
      saveSnapshot(room);
      broadcastRoom(room, { type: "game:over", scores: msg.scores });
      broadcastToSpectators(room, { type: "game:over", scores: msg.scores });

      // Career tracking — best-effort: a game with no currentGame set (shouldn't happen)
      // or a player who's already disconnected just doesn't get recorded, never blocks
      // the room's own flow.
      if (room.currentGame) {
        const ranks = computeRanks(msg.scores);
        for (const [playerId, rank] of ranks) {
          const player = room.players.get(playerId);
          if (!player) continue;
          const newlyUnlocked = recordGameResult(player.deviceId, room.currentGame, rank);
          if (newlyUnlocked.length > 0) {
            sendTo(player.socket, { type: "game:achievements_unlocked", achievementIds: newlyUnlocked });
            // The Display never otherwise learns about achievements (they're normally a
            // controller-only unicast) — the Party Recap Reel needs to know what unlocked
            // this session to show it at the end.
            sendToHost(room, { type: "room:achievement_unlocked", playerId, achievementIds: newlyUnlocked });
          }
        }
      }
      return;
    }

    case "spectator:join": {
      const room = roomManager.getRoom(msg.roomCode);
      if (!room) {
        sendTo(socket, { type: "spectator:join_rejected", reason: "room_not_found" });
        return;
      }
      room.spectatorSockets.add(socket);
      state.role = "spectator";
      state.roomCode = room.code;
      sendTo(socket, {
        type: "spectator:joined",
        roomCode: room.code,
        players: roomPlayerList(room),
        phase: room.phase,
        currentGame: room.currentGame,
        games: GAME_REGISTRY,
        standings: room.lastScores ?? {},
      });
      return;
    }

    case "player:request_profile": {
      const found = roomManager.findRoomByPlayerSocket(socket);
      if (!found) return;
      const player = found.room.players.get(found.playerId);
      if (!player) return;
      const profile = getProfile(player.deviceId);
      const playCounts = profile?.playCounts ?? {};
      const favoriteId = (Object.entries(playCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as GameId | undefined) ?? null;
      sendTo(socket, {
        type: "player:profile_result",
        gamesPlayed: profile?.gamesPlayed ?? 0,
        wins: profile?.wins ?? 0,
        playCounts,
        winsByGame: profile?.winsByGame ?? {},
        achievements: profile?.achievements ?? [],
        favoriteGameTitle: favoriteId ? (getGameMeta(favoriteId)?.title ?? null) : null,
      });
      return;
    }

    case "input:tilt":
    case "input:pointer":
    case "input:swipe":
    case "input:tap":
    case "input:button":
    case "input:draw":
    case "input:mic_level":
    case "input:photo":
    case "input:audio":
    case "input:text":
    case "input:prediction": {
      relayInput(roomManager, socket, msg);
      return;
    }

    case "player:reaction": {
      const found = roomManager.findRoomByPlayerSocket(socket);
      if (!found) return;
      const now = Date.now();
      const last = lastReactionAt.get(socket) ?? 0;
      if (now - last < REACTION_MIN_INTERVAL_MS) return;
      lastReactionAt.set(socket, now);
      sendToHost(found.room, { type: "game:reaction", playerId: found.playerId, emoji: msg.emoji });
      broadcastToSpectators(found.room, { type: "game:reaction", playerId: found.playerId, emoji: msg.emoji });
      return;
    }

    case "pong":
      return;
  }
}

function requireHostRoom(roomManager: RoomManager, state: ConnectionState): Room | undefined {
  if (state.role !== "host" || !state.roomCode) return undefined;
  return roomManager.getRoom(state.roomCode);
}

function relayInput(roomManager: RoomManager, socket: WebSocket, msg: InputMessage): void {
  const now = Date.now();
  const last = lastInputAt.get(socket) ?? 0;
  if (now - last < INPUT_MIN_INTERVAL_MS) return;
  lastInputAt.set(socket, now);

  const found = roomManager.findRoomByPlayerSocket(socket);
  if (!found) return;
  sendToHost(found.room, { type: "relay:input", playerId: found.playerId, input: msg });
}

/** Same tie-sharing rank convention used by every ranked game's own display-side logic (Draw-Off, Scream Royale, etc.) — computed once here so Career tracking doesn't need each game to separately report its own ranks. */
export function computeRanks(scores: Record<string, number>): Map<string, number> {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const ranks = new Map<string, number>();
  let rank = 0;
  let prevScore: number | null = null;
  sorted.forEach(([playerId, score], i) => {
    if (prevScore === null || score !== prevScore) rank = i + 1;
    prevScore = score;
    ranks.set(playerId, rank);
  });
  return ranks;
}
