import type { GameId, GameMeta, PlayerInfo, RoomPhase } from "@shared/types/room";

// ---------- Display -> Server ----------
export interface DisplayCreateMsg {
  type: "display:create";
  protocolVersion: number;
}
export interface DisplayResumeMsg {
  type: "display:resume";
  roomCode: string;
  protocolVersion: number;
}
export interface GameSelectMsg {
  type: "game:select";
  gameId: GameId;
}
export interface GameStartMsg {
  type: "game:start";
  gameId: GameId;
  seed?: number;
}
export interface GameOverMsg {
  type: "game:over";
  scores: Record<string, number>;
}
export interface DisplayScoreUpdateMsg {
  type: "display:score_update";
  playerId: string;
  score: number;
}
export interface DisplayPrivateMessageMsg {
  type: "display:private_message";
  playerId: string;
  payload: unknown;
}
export interface DisplayRequestRatingMsg {
  type: "display:request_rating";
  word: string;
  submissions: { playerId: string; imageData: string }[];
}
export interface DisplayRequestTranscriptionMsg {
  type: "display:request_transcription";
  playerId: string;
  audioData: string;
}
export interface DisplayRequestScenarioMsg {
  type: "display:request_scenario";
}
export interface DisplayRequestHostSpeechMsg {
  type: "display:request_host_speech";
  text: string;
}
export interface DisplayRequestAvatarSessionMsg {
  type: "display:request_avatar_session";
}
export interface DisplayRequestWildcardMsg {
  type: "display:request_wildcard";
}
/** Host-triggered — the server relays one room:wave to each controller, staggered by that room's stable join order, so connected phones flash/vibrate/sound in a visible ripple around the room. */
export interface DisplayTriggerWaveMsg {
  type: "display:trigger_wave";
}

export interface HostKickPlayerMsg {
  type: "host:kick_player";
  playerId: string;
}
export interface HostPauseGameMsg {
  type: "host:pause_game";
}
export interface HostResumeGameMsg {
  type: "host:resume_game";
}

// ---------- Controller -> Server ----------
export interface PlayerJoinMsg {
  type: "player:join";
  roomCode: string;
  name: string;
  protocolVersion: number;
  /** Persistent per-device id (localStorage, not a real account) — links this join to a Career profile across any room/server-restart. */
  deviceId: string;
}
export interface PlayerRequestProfileMsg {
  type: "player:request_profile";
}
export interface PlayerReconnectMsg {
  type: "player:reconnect";
  roomCode: string;
  playerId: string;
  sessionToken: string;
  protocolVersion: number;
}
export interface CalibrateAckMsg {
  type: "game:calibrate_ack";
}
export interface InputTiltMsg {
  type: "input:tilt";
  beta: number;
  gamma: number;
  ts: number;
}
export interface InputPointerMsg {
  type: "input:pointer";
  x: number;
  y: number;
  ts: number;
}
export interface InputSwipeMsg {
  type: "input:swipe";
  dx: number;
  dy: number;
  speed: number;
  ts: number;
}
export interface InputTapMsg {
  type: "input:tap";
  targetId?: string;
  ts: number;
}
export interface InputButtonMsg {
  type: "input:button";
  buttonId: string;
  pressed: boolean;
  ts: number;
}
export interface InputDrawMsg {
  type: "input:draw";
  points: { x: number; y: number }[]; // normalized 0..1, canvas-relative
  color: string;
  /** Optional — older/simpler callsites (undo/clear) don't set a brush, so the Display falls back to its own default. */
  lineWidth?: number;
  strokeId: number;
  phase: "start" | "move" | "end" | "undo" | "clear"; // undo/clear carry no points
  ts: number;
}
export interface InputMicLevelMsg {
  type: "input:mic_level";
  level: number; // 0-100, normalized amplitude — raw audio never leaves the phone
  ts: number;
}
export interface InputPhotoMsg {
  type: "input:photo";
  imageData: string; // data:image/jpeg;base64,...
  ts: number;
}
export interface InputAudioMsg {
  type: "input:audio";
  audioData: string; // data:audio/webm;base64,... (mime type depends on device support — see audio-recorder.ts)
  ts: number;
}
export interface InputTextMsg {
  type: "input:text";
  text: string;
  ts: number;
}
export interface InputPredictionMsg {
  type: "input:prediction";
  targetPlayerId: string;
  ts: number;
}

export interface PlayerReactionMsg {
  type: "player:reaction";
  emoji: string;
}

// ---------- Server -> Display / Controller(s) ----------
export interface RoomCreatedMsg {
  type: "room:created";
  roomCode: string;
  lanUrl: string;
  games: GameMeta[];
}
export interface RoomResumedMsg {
  type: "room:resumed";
  roomCode: string;
  lanUrl: string;
  games: GameMeta[];
  players: PlayerInfo[];
}
/** Sent to a room's host only, when the server's own LAN IP changes mid-session (the cert has just been hot-swapped to match) — the host's QR code was baked with the old address and needs to show a fresh one. */
export interface RoomLanUrlChangedMsg {
  type: "room:lan_url_changed";
  lanUrl: string;
}
export interface PlayerJoinedMsg {
  type: "player:joined";
  playerId: string;
  sessionToken: string;
  color: string;
  roomCode: string;
  games: GameMeta[];
}
export interface PlayerJoinRejectedMsg {
  type: "player:join_rejected";
  reason: "room_not_found" | "room_full" | "name_taken" | "game_in_progress" | "version_mismatch";
}
export interface PlayerProfileResultMsg {
  type: "player:profile_result";
  gamesPlayed: number;
  wins: number;
  playCounts: Partial<Record<GameId, number>>;
  winsByGame: Partial<Record<GameId, number>>;
  achievements: string[];
  /** Resolved server-side (GAME_REGISTRY has the titles) so the controller doesn't need its own id->title lookup table. */
  favoriteGameTitle: string | null;
}
export interface GameAchievementsUnlockedMsg {
  type: "game:achievements_unlocked";
  achievementIds: string[];
}
/** Host-only — mirrors GameAchievementsUnlockedMsg's unicast to the player's own controller, so the Party Recap Reel can also show what unlocked this session. */
export interface RoomAchievementUnlockedMsg {
  type: "room:achievement_unlocked";
  playerId: string;
  achievementIds: string[];
}
/** One controller's cue for the synchronized phone wave — staggerIndex is that player's position in the room's stable join order, staggerMs is the per-step delay; the controller waits staggerIndex * staggerMs before flashing/vibrating/sounding. color is that player's own avatar color, so the wave carries everyone's identity around the room instead of one flat flash. */
export interface RoomWaveMsg {
  type: "room:wave";
  staggerIndex: number;
  staggerMs: number;
  color: string;
}
export interface PlayerReconnectedMsg {
  type: "player:reconnected";
  playerId: string;
  color: string;
  name: string;
  roomCode: string;
  games: GameMeta[];
  phase: RoomPhase;
  currentGame: GameId | null;
  players: PlayerInfo[];
  lastScores: Record<string, number> | null;
}
export interface PlayerReconnectFailedMsg {
  type: "player:reconnect_failed";
  reason: "room_not_found" | "session_invalid" | "version_mismatch";
}
export interface PlayerKickedMsg {
  type: "player:kicked";
}
export interface RoomStateSyncMsg {
  type: "room:state_sync";
  players: PlayerInfo[];
  phase: RoomPhase;
  currentGame: GameId | null;
}
export interface RoomPlayerJoinedMsg {
  type: "room:player_joined";
  player: PlayerInfo;
}
export interface RoomPlayerLeftMsg {
  type: "room:player_left";
  playerId: string;
}
export interface RoomPlayerReconnectedMsg {
  type: "room:player_reconnected";
  playerId: string;
}
export interface GameSelectedMsg {
  type: "game:selected";
  gameId: GameId;
  meta: GameMeta;
}
export interface GameStartBroadcastMsg {
  type: "game:start";
  gameId: GameId;
}
export interface GameCalibrateRequestMsg {
  type: "game:calibrate_request";
}
export interface GameCalibrateProgressMsg {
  type: "game:calibrate_progress";
  playerId: string;
}
export interface GameOverBroadcastMsg {
  type: "game:over";
  scores: Record<string, number>;
}
export interface GameScoreUpdateMsg {
  type: "game:score_update";
  playerId: string;
  score: number;
}
export interface GamePrivateMessageMsg {
  type: "game:private_message";
  payload: unknown;
}
export interface GameRatingsResultMsg {
  type: "game:ratings_result";
  ratings: { playerId: string; score: number | null; comment: string | null }[];
}
export interface GameTranscriptionResultMsg {
  type: "game:transcription_result";
  playerId: string;
  text: string | null;
}
export interface GameScenarioResultMsg {
  type: "game:scenario_result";
  scenario: string;
}
export interface GameHostSpeechResultMsg {
  type: "game:host_speech_result";
  audioData: string | null; // data:audio/mpeg;base64,... — null if TTS failed, caller just skips speaking
}
export interface GameAvatarSessionResultMsg {
  type: "game:avatar_session_result";
  sessionToken: string | null; // null if the Simli API key isn't configured or the request failed
}
export type WildcardMechanic = "vote" | "type" | "fast-tap" | "would-you-rather" | "aim";
export interface GameWildcardResultMsg {
  type: "game:wildcard_result";
  mechanic: WildcardMechanic;
  prompt: string;
  choices?: [string, string]; // "would-you-rather" only
}
export interface GameReactionMsg {
  type: "game:reaction";
  playerId: string;
  emoji: string;
}
export interface GamePausedMsg {
  type: "game:paused";
}
export interface GameResumedMsg {
  type: "game:resumed";
}
export interface RelayedInputMsg {
  type: "relay:input";
  playerId: string;
  input:
    | InputTiltMsg
    | InputPointerMsg
    | InputSwipeMsg
    | InputTapMsg
    | InputButtonMsg
    | InputDrawMsg
    | InputMicLevelMsg
    | InputPhotoMsg
    | InputAudioMsg
    | InputTextMsg
    | InputPredictionMsg;
}
export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}
export interface PingMsg {
  type: "ping";
}
export interface PongMsg {
  type: "pong";
}

export type ClientToServerMessage =
  | DisplayCreateMsg
  | DisplayResumeMsg
  | GameSelectMsg
  | GameStartMsg
  | GameOverMsg
  | DisplayScoreUpdateMsg
  | DisplayPrivateMessageMsg
  | DisplayRequestRatingMsg
  | DisplayRequestTranscriptionMsg
  | DisplayRequestScenarioMsg
  | DisplayRequestHostSpeechMsg
  | DisplayRequestAvatarSessionMsg
  | DisplayRequestWildcardMsg
  | DisplayTriggerWaveMsg
  | HostKickPlayerMsg
  | HostPauseGameMsg
  | HostResumeGameMsg
  | PlayerJoinMsg
  | PlayerReconnectMsg
  | PlayerRequestProfileMsg
  | CalibrateAckMsg
  | InputTiltMsg
  | InputPointerMsg
  | InputSwipeMsg
  | InputTapMsg
  | InputButtonMsg
  | InputDrawMsg
  | InputMicLevelMsg
  | InputPhotoMsg
  | InputAudioMsg
  | InputTextMsg
  | InputPredictionMsg
  | PlayerReactionMsg
  | PongMsg;

export type ServerToClientMessage =
  | RoomCreatedMsg
  | RoomResumedMsg
  | RoomLanUrlChangedMsg
  | PlayerJoinedMsg
  | PlayerJoinRejectedMsg
  | PlayerProfileResultMsg
  | GameAchievementsUnlockedMsg
  | RoomAchievementUnlockedMsg
  | RoomWaveMsg
  | PlayerReconnectedMsg
  | PlayerReconnectFailedMsg
  | PlayerKickedMsg
  | RoomStateSyncMsg
  | RoomPlayerJoinedMsg
  | RoomPlayerLeftMsg
  | RoomPlayerReconnectedMsg
  | GameSelectedMsg
  | GameStartBroadcastMsg
  | GameCalibrateRequestMsg
  | GameCalibrateProgressMsg
  | GameOverBroadcastMsg
  | GameScoreUpdateMsg
  | GamePrivateMessageMsg
  | GameRatingsResultMsg
  | GameTranscriptionResultMsg
  | GameScenarioResultMsg
  | GameHostSpeechResultMsg
  | GameAvatarSessionResultMsg
  | GameWildcardResultMsg
  | GameReactionMsg
  | GamePausedMsg
  | GameResumedMsg
  | RelayedInputMsg
  | ErrorMsg
  | PingMsg;

export type InputMessage =
  | InputTiltMsg
  | InputPointerMsg
  | InputSwipeMsg
  | InputTapMsg
  | InputButtonMsg
  | InputDrawMsg
  | InputMicLevelMsg
  | InputPhotoMsg
  | InputAudioMsg
  | InputTextMsg
  | InputPredictionMsg;
