export const PROTOCOL_VERSION = 1;

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
export const ROOM_CODE_LENGTH = 4;

export const MAX_PLAYERS_PER_ROOM = 8;

/** Degrees of tilt that sweep the pointer from center to a screen edge. */
export const POINTER_SENSITIVITY_DEG = 30;

/** Max normalized pointer input rate sent to the server, in Hz. */
export const POINTER_SEND_HZ = 45;

/** Rolling window (ms) used to detect a slice/swipe motion spike. */
export const SWIPE_WINDOW_MS = 140;

/** Minimum acceleration delta (m/s^2) within the window to count as a swipe. */
export const SWIPE_ACCEL_THRESHOLD = 14;

/** Minimum ms between two accepted swipe events (debounce). */
export const SWIPE_DEBOUNCE_MS = 220;

export const APP_WS_PATH = "/ws";
