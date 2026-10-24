/** Shared tuning values. The engine has no clock of its own: every duration is in ticks. */

export const COLS = 10;
export const ROWS = 20;

/** Authoritative simulation step (50 ms → 20 Hz). */
export const TICK_MS = 50;

/** How long a resting piece may sit before it locks. */
export const LOCK_DELAY_TICKS = 8; // 400 ms
/** Maximum number of move/rotate lock-delay resets. */
export const MAX_LOCK_RESETS = 12;

export const COUNTDOWN_TICKS = 60; // 3 s

/** Melds required to win a co-op match (see DESIGN_DECISIONS.md). */
export const MELD_TARGET = 5;
/** Rows required to win a solo practice run. */
export const SOLO_LINE_TARGET = 12;
/** Rows a player must finish to win a Duel. */
export const VERSUS_LINE_TARGET = 8;
/** Rows to clear in the Architect puzzle. */
export const ARCHITECT_LINE_TARGET = 10;
/** Rift survival: three 60-second waves of rising pressure. */
export const RIFT_WAVES = 3;
export const RIFT_WAVE_TICKS = 1200;

/** Spawn columns per player so the two pieces never spawn inside each other. */
export const SPAWN_X = [1, 5];
export const MAX_PLAYERS = 2;

export const PING_COOLDOWN_TICKS = 40;
export const PING_LIFE_TICKS = 60;

export const BASE_GRAVITY_MS = 850;
export const MIN_GRAVITY_MS = 150;
export const GRAVITY_RAMP_MS_PER_SEC = 14;

/** Reconnect grace window before a co-op match is abandoned. */
export const DISCONNECT_GRACE_MS = 30_000;

/** Extra points for finishing a row your partner started. */
export const MELD_BONUS = 200;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const PROTOCOL_VERSION = 1;
