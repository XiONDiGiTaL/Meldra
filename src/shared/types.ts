export type Phase = 'countdown' | 'playing' | 'won' | 'lost';

export type GameMode = 'solo' | 'coop' | 'versus' | 'relay' | 'rift' | 'endless' | 'architect';

/** Pace of gravity. Zen is a slower ramp, Normal is the designed pace, Hard starts quick. */
export type Difficulty = 'zen' | 'normal' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['zen', 'normal', 'hard'];

export function isDifficulty(value: unknown): value is Difficulty {
  return value === 'zen' || value === 'normal' || value === 'hard';
}

/** Modes played alone in one tab. */
export const SOLO_MODES: GameMode[] = ['solo', 'endless', 'architect'];
/** Modes that need a room; the host selects the mode and the guest inherits it. */
export const ONLINE_MODES: GameMode[] = ['coop', 'versus', 'relay', 'rift'];

export function isSoloMode(mode: GameMode): boolean {
  return SOLO_MODES.includes(mode);
}

export function isOnlineMode(mode: GameMode): boolean {
  return ONLINE_MODES.includes(mode);
}

/** A locked cell remembers which player placed it (for Meld rows) and which piece kind (for colour). */
export interface Cell {
  /** Owning player slot. */
  p: 0 | 1;
  /** Piece kind index, used to pick the block colour. */
  k: number;
}

export interface Piece {
  k: number;
  r: number;
  x: number;
  y: number;
  /** Ticks since this piece last fell one row. */
  fallT: number;
  /** Ticks the piece has been resting. */
  lockT: number;
  /** Lock-delay resets used by this piece. */
  resets: number;
}

export type EventType = 'clear' | 'meld' | 'ping' | 'lock' | 'win' | 'lose' | 'start';

/** Small state events used purely for feedback; the client renders and dedupes them. */
export interface GameEvent {
  id: number;
  tick: number;
  type: EventType;
  /** Player that caused the event. */
  p?: number;
  /** Rows (indices at clear time) for `clear` / `meld`. */
  rows?: number[];
  /** Row count or meld count, depending on the event. */
  n?: number;
  col?: number;
}

export interface PlayerRuntime {
  piece: Piece | null;
  /** Upcoming piece kinds, at least one entry while the match runs. */
  next: number[];
  cells: number;
  /** Rows this player had cells in when they cleared. */
  rows: number;
  /** Co-op objective credit earned by this player. */
  melds: number;
  /** Rows this player finished (the versus score); rows with their cells are `rows`. */
  clears: number;
  lastPingTick: number;
}

export interface GameState {
  mode: GameMode;
  difficulty: Difficulty;
  tick: number;
  /** Ticks spent in the playing phase; drives gravity ramping. */
  playTicks: number;
  phase: Phase;
  phaseTick: number;
  board: (Cell | null)[];
  players: PlayerRuntime[];
  /** xorshift32 state per player, kept in the state so replays are deterministic. */
  rng: number[];
  bags: number[][];
  score: number;
  lines: number;
  melds: number;
  objective: number;
  /** Winner slot for a versus match; null when the objective is shared. */
  winner: number | null;
  /** Active slot in Relay, where only one piece falls at a time. */
  turn: number;
  events: GameEvent[];
  eventSeq: number;
}

export type Action =
  | { t: 'left' }
  | { t: 'right' }
  | { t: 'rot'; d: 1 | -1 }
  | { t: 'soft' }
  | { t: 'hard' }
  | { t: 'ping'; col?: number };

export interface PlayerMeta {
  name: string;
  palette: string;
}

export interface Snapshot {
  v: 1;
  difficulty: Difficulty;
  tick: number;
  playTicks: number;
  phase: Phase;
  phaseTick: number;
  board: string;
  score: number;
  lines: number;
  melds: number;
  objective: number;
  players: {
    piece: [number, number, number, number] | null;
    next: number[];
    cells: number;
    rows: number;
    melds: number;
    clears: number;
    /** Last action sequence number processed for this player. */
    seq: number;
  }[];
  events: GameEvent[];
  winner?: number | null;
  turn?: number;
  paused?: boolean;
  pauseMs?: number;
}
