import {
  ARCHITECT_LINE_TARGET,
  COLS,
  COUNTDOWN_TICKS,
  DIFFICULTY_PROFILES,
  LOCK_DELAY_TICKS,
  MAX_LOCK_RESETS,
  MELD_BONUS,
  MELD_TARGET,
  PING_COOLDOWN_TICKS,
  RIFT_WAVES,
  RIFT_WAVE_TICKS,
  ROWS,
  SOLO_LINE_TARGET,
  SPAWN_X,
  TICK_MS,
  VERSUS_LINE_TARGET,
} from './constants.js';
import { KIND_NAMES, SHAPES, collides, pieceCells } from './pieces.js';
import type {
  Action,
  Cell,
  Difficulty,
  GameEvent,
  GameMode,
  GameState,
  PlayerRuntime,
  Snapshot,
} from './types.js';

const LINE_SCORE = [0, 100, 300, 500, 800];

function xorshift(state: GameState, p: number): number {
  let x = state.rng[p] >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  state.rng[p] = x;
  return x;
}

function seedRng(seed: number): number {
  // Any non-zero value works for xorshift32.
  const s = (seed ^ 0x9e3779b9) >>> 0;
  return s === 0 ? 0x1234567 : s;
}

function shuffledBag(state: GameState, p: number): number[] {
  const bag = KIND_NAMES.map((_, i) => i);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = xorshift(state, p) % (i + 1);
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return bag;
}

function drawKind(state: GameState, p: number): number {
  if (state.bags[p].length === 0) state.bags[p] = shuffledBag(state, p);
  return state.bags[p].pop() as number;
}

function refillQueue(state: GameState, p: number): void {
  const runtime = state.players[p];
  while (runtime.next.length < 3) runtime.next.push(drawKind(state, p));
}

function pushEvent(state: GameState, event: Omit<GameEvent, 'id' | 'tick'>): void {
  state.eventSeq += 1;
  state.events.push({ id: state.eventSeq, tick: state.tick, ...event });
  if (state.events.length > 32) state.events.splice(0, state.events.length - 32);
}

export function gravityTicks(state: GameState): number {
  const profile = DIFFICULTY_PROFILES[state.difficulty];
  const seconds = (state.playTicks * TICK_MS) / 1000;
  const interval = Math.max(profile.minMs, profile.baseMs - seconds * profile.rampMsPerSec);
  return Math.max(2, Math.round(interval / TICK_MS));
}

function endMatch(state: GameState, phase: 'won' | 'lost', by?: number): void {
  if (state.phase === 'won' || state.phase === 'lost') return;
  state.phase = phase;
  state.phaseTick = 0;
  pushEvent(state, { type: phase === 'won' ? 'win' : 'lose', p: by });
}

export function spawnPiece(state: GameState, p: number): void {
  const runtime = state.players[p];
  refillQueue(state, p);
  const kind = runtime.next.shift() as number;
  const piece = { k: kind, r: 0, x: SPAWN_X[p] ?? 1, y: 0, fallT: 0, lockT: 0, resets: 0 };
  refillQueue(state, p);
  if (collides(state.board, piece)) {
    runtime.piece = null;
    if (state.mode === 'versus') {
      // In a Duel a blocked spawn loses the match for that player, not the room.
      state.winner = 1 - p;
      endMatch(state, 'won', state.winner);
    } else {
      endMatch(state, 'lost', p);
    }
    return;
  }
  runtime.piece = piece;
}

function clearRows(state: GameState, locker: number): void {
  const full: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    let complete = true;
    for (let x = 0; x < COLS; x++) {
      if (!state.board[y * COLS + x]) {
        complete = false;
        break;
      }
    }
    if (complete) full.push(y);
  }
  if (full.length === 0) return;

  const meldRows: number[] = [];
  for (const y of full) {
    const owners = new Set<number>();
    for (let x = 0; x < COLS; x++) {
      const cell = state.board[y * COLS + x];
      if (cell) owners.add(cell.p);
    }
    if (owners.size > 1) meldRows.push(y);
  }

  // Contribution credit: a player gets a "row joined" for every cleared row holding their cells.
  for (const y of full) {
    const owners = new Set<number>();
    for (let x = 0; x < COLS; x++) {
      const cell = state.board[y * COLS + x];
      if (cell) owners.add(cell.p);
    }
    for (const owner of owners) {
      const runtime = state.players[owner];
      if (!runtime) continue;
      runtime.rows += 1;
      if (meldRows.includes(y)) runtime.melds += 1;
    }
  }

  const survivors: (Cell | null)[] = [];
  for (let y = 0; y < ROWS; y++) {
    if (full.includes(y)) continue;
    for (let x = 0; x < COLS; x++) survivors.push(state.board[y * COLS + x]);
  }
  const clean: (Cell | null)[] = new Array(full.length * COLS).fill(null);
  state.board = clean.concat(survivors);

  state.lines += full.length;
  state.melds += meldRows.length;
  state.score += LINE_SCORE[Math.min(full.length, 4)] + meldRows.length * MELD_BONUS;

  pushEvent(state, { type: 'clear', p: locker, rows: [...full], n: full.length });
  if (meldRows.length > 0) {
    pushEvent(state, { type: 'meld', p: locker, rows: [...meldRows], n: meldRows.length });
  }

  const closer = state.players[locker];
  if (closer) closer.clears += full.length;

  if (state.mode === 'versus') {
    if (closer && closer.clears >= state.objective) {
      state.winner = locker;
      endMatch(state, 'won', locker);
    }
  } else if (state.mode === 'coop' || state.mode === 'relay') {
    if (state.melds >= state.objective) endMatch(state, 'won', locker);
  } else if (state.mode === 'solo' || state.mode === 'architect') {
    if (state.lines >= state.objective) endMatch(state, 'won', locker);
  }
}

function lockPiece(state: GameState, p: number): void {
  const runtime = state.players[p];
  const piece = runtime.piece;
  if (!piece) return;
  for (const c of pieceCells(piece.k, piece.r, piece.x, piece.y)) {
    if (c.y < 0) continue;
    const index = c.y * COLS + c.x;
    // If the partner locked into a cell this piece still occupies (only possible when both
    // pieces land on the same tick), the first locked cell wins and this cell is absorbed.
    if (!state.board[index]) state.board[index] = { p: (p === 0 ? 0 : 1) as 0 | 1, k: piece.k };
  }
  runtime.cells += 4;
  runtime.piece = null;
  pushEvent(state, { type: 'lock', p });

  // Lift the partner's active piece out of the newly locked cells instead of leaving it
  // embedded. Overlaps are rare, but they must resolve deterministically.
  for (let other = 0; other < state.players.length; other++) {
    if (other === p) continue;
    const partner = state.players[other].piece;
    if (!partner) continue;
    let guard = 0;
    while (collides(state.board, partner) && partner.y > 0 && guard < 4) {
      partner.y -= 1;
      partner.fallT = 0;
      guard += 1;
    }
  }

  clearRows(state, p);
  if (state.phase !== 'playing') return;
  if (state.mode === 'relay') {
    // Only one piece is in play; the next player receives it after every lock.
    state.turn = (p + 1) % state.players.length;
    spawnPiece(state, state.turn);
    return;
  }
  spawnPiece(state, p);
}

function touchLock(state: GameState, p: number): void {
  const piece = state.players[p].piece;
  if (!piece) return;
  if (!collides(state.board, { ...piece, y: piece.y + 1 })) return;
  if (piece.resets >= MAX_LOCK_RESETS) return;
  piece.lockT = 0;
  piece.resets += 1;
}

const ONLINE_TWO_PLAYER: GameMode[] = ['coop', 'versus', 'relay', 'rift'];

function objectiveFor(mode: GameMode): number {
  switch (mode) {
    case 'coop':
    case 'relay':
      return MELD_TARGET;
    case 'versus':
      return VERSUS_LINE_TARGET;
    case 'solo':
      return SOLO_LINE_TARGET;
    case 'architect':
      return ARCHITECT_LINE_TARGET;
    case 'rift':
      return RIFT_WAVES;
    default:
      return 0;
  }
}

export function createGame(
  mode: GameMode,
  seed = Date.now() >>> 0,
  difficulty: Difficulty = 'normal',
): GameState {
  const count = ONLINE_TWO_PLAYER.includes(mode) ? 2 : 1;
  const state: GameState = {
    mode,
    difficulty,
    tick: 0,
    playTicks: 0,
    phase: 'countdown',
    phaseTick: 0,
    board: new Array(ROWS * COLS).fill(null),
    players: [],
    rng: [],
    bags: [],
    score: 0,
    lines: 0,
    melds: 0,
    objective: objectiveFor(mode),
    winner: null,
    turn: 0,
    events: [],
    eventSeq: 0,
  };
  for (let p = 0; p < count; p++) {
    const runtime: PlayerRuntime = {
      piece: null,
      next: [],
      cells: 0,
      rows: 0,
      melds: 0,
      clears: 0,
      lastPingTick: -PING_COOLDOWN_TICKS,
    };
    state.players.push(runtime);
    state.rng.push(seedRng(seed + p * 7919));
    state.bags.push([]);
  }
  // Architect starts with a deterministic half-built stack, leaving the top clear.
  if (mode === 'architect') {
    for (let y = ROWS - 6; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if ((x + y * 2) % 4 !== 0 && (x * 3 + y) % 7 !== 0) {
          state.board[y * COLS + x] = { p: 0, k: (x + y) % 7 };
        }
      }
    }
  }
  if (mode === 'relay') spawnPiece(state, 0);
  else for (let p = 0; p < count; p++) spawnPiece(state, p);
  // A fresh board cannot top out, so the phase is always the countdown here.
  state.phase = 'countdown';
  state.phaseTick = 0;
  return state;
}

/** Apply a player action immediately. Returns true when the action changed the state. */
export function applyAction(state: GameState, p: number, action: Action): boolean {
  const runtime = state.players[p];
  if (!runtime) return false;
  if (state.mode === 'relay' && state.turn !== p) return false;

  if (action.t === 'ping') {
    if (state.phase !== 'playing') return false;
    if (state.tick - runtime.lastPingTick < PING_COOLDOWN_TICKS) return false;
    const piece = runtime.piece;
    const col = action.col ?? (piece ? piece.x + Math.floor(SHAPES[piece.k].size / 2) : 4);
    runtime.lastPingTick = state.tick;
    pushEvent(state, { type: 'ping', p, col: Math.max(0, Math.min(COLS - 1, col)) });
    return true;
  }

  if (state.phase !== 'playing') return false;
  const piece = runtime.piece;
  if (!piece) return false;

  switch (action.t) {
    case 'left':
    case 'right': {
      const dx = action.t === 'left' ? -1 : 1;
      if (collides(state.board, { ...piece, x: piece.x + dx })) return false;
      piece.x += dx;
      touchLock(state, p);
      return true;
    }
    case 'rot': {
      if (!SHAPES[piece.k].rotational) return false;
      const nextR = ((piece.r + action.d) % 4 + 4) % 4;
      const kicks = [
        [0, 0],
        [-1, 0],
        [1, 0],
        [-2, 0],
        [2, 0],
        [0, -1],
      ];
      for (const [dx, dy] of kicks) {
        const candidate = { ...piece, r: nextR, x: piece.x + dx, y: piece.y + dy };
        if (!collides(state.board, candidate)) {
          piece.r = nextR;
          piece.x = candidate.x;
          piece.y = candidate.y;
          touchLock(state, p);
          return true;
        }
      }
      return false;
    }
    case 'soft': {
      if (collides(state.board, { ...piece, y: piece.y + 1 })) return false;
      piece.y += 1;
      piece.fallT = 0;
      state.score += 1;
      touchLock(state, p);
      return true;
    }
    case 'hard': {
      let distance = 0;
      while (!collides(state.board, { ...piece, y: piece.y + 1 })) {
        piece.y += 1;
        distance += 1;
      }
      state.score += distance * 2;
      lockPiece(state, p);
      return true;
    }
    default:
      return false;
  }
}

function stepPlayer(state: GameState, p: number): void {
  const runtime = state.players[p];
  const piece = runtime.piece;
  if (!piece) return;

  piece.fallT += 1;
  if (piece.fallT >= gravityTicks(state)) {
    piece.fallT = 0;
    if (!collides(state.board, { ...piece, y: piece.y + 1 })) piece.y += 1;
  }

  if (collides(state.board, { ...piece, y: piece.y + 1 })) {
    piece.lockT += 1;
    if (piece.lockT >= LOCK_DELAY_TICKS) lockPiece(state, p);
  } else {
    piece.lockT = 0;
  }
}

/** Advance the simulation by exactly one tick. */
export function advance(state: GameState): void {
  if (state.phase === 'won' || state.phase === 'lost') return;
  state.tick += 1;

  if (state.phase === 'countdown') {
    state.phaseTick += 1;
    if (state.phaseTick >= COUNTDOWN_TICKS) {
      state.phase = 'playing';
      state.phaseTick = 0;
      pushEvent(state, { type: 'start' });
    }
    return;
  }

  state.playTicks += 1;
  state.phaseTick += 1;
  for (let p = 0; p < state.players.length; p++) {
    if (state.phase !== 'playing') break;
    if (state.mode === 'relay' && state.turn !== p) continue;
    stepPlayer(state, p);
  }
  if (state.mode === 'rift' && state.phase === 'playing' && state.playTicks >= RIFT_WAVES * RIFT_WAVE_TICKS) {
    endMatch(state, 'won');
  }
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** Stable checksum used by tests to prove the simulation is deterministic. */
export function stateHash(state: GameState): string {
  let hash = 0x811c9dc5;
  const feed = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const cell of state.board) feed(cell ? 1 + cell.p * 8 + cell.k : 0);
  for (const runtime of state.players) {
    const piece = runtime.piece;
    feed(runtime.cells & 0xff);
    feed(runtime.clears & 0xff);
    if (piece) {
      feed(piece.k);
      feed(piece.r);
      feed(piece.x + 8);
      feed(piece.y + 8);
    } else {
      feed(255);
    }
    for (const kind of runtime.next) feed(kind + 16);
  }
  feed(state.score & 0xff);
  feed((state.score >> 8) & 0xff);
  feed((state.score >> 16) & 0xff);
  feed(state.lines);
  feed(state.melds);
  feed(state.phase === 'playing' ? 1 : state.phase === 'won' ? 2 : state.phase === 'lost' ? 3 : 0);
  feed(state.tick & 0xff);
  return hash.toString(16).padStart(8, '0');
}

const CELL_CHARS = '0123456';
const CELL_CHARS_P1 = 'abcdefg';

export function encodeBoard(board: (Cell | null)[]): string {
  const rows: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    let row = '';
    for (let x = 0; x < COLS; x++) {
      const cell = board[y * COLS + x];
      row += cell ? (cell.p === 0 ? CELL_CHARS[cell.k] : CELL_CHARS_P1[cell.k]) : '.';
    }
    rows.push(row);
  }
  return rows.join('/');
}

export function decodeBoard(encoded: string): (Cell | null)[] {
  const rows = encoded.split('/');
  const board: (Cell | null)[] = new Array(ROWS * COLS).fill(null);
  for (let y = 0; y < Math.min(ROWS, rows.length); y++) {
    const row = rows[y];
    for (let x = 0; x < Math.min(COLS, row.length); x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const p0 = CELL_CHARS.indexOf(ch);
      const p1 = CELL_CHARS_P1.indexOf(ch);
      const k = p0 >= 0 ? p0 : p1;
      if (k < 0) continue;
      board[y * COLS + x] = { p: p0 >= 0 ? 0 : 1, k };
    }
  }
  return board;
}

export function toSnapshot(state: GameState, seqs: number[], paused = false, pauseMs = 0): Snapshot {
  return {
    v: 1,
    difficulty: state.difficulty,
    tick: state.tick,
    playTicks: state.playTicks,
    phase: state.phase,
    phaseTick: state.phaseTick,
    board: encodeBoard(state.board),
    score: state.score,
    lines: state.lines,
    melds: state.melds,
    objective: state.objective,
    players: state.players.map((runtime, i) => ({
      piece: runtime.piece
        ? [runtime.piece.k, runtime.piece.r, runtime.piece.x, runtime.piece.y]
        : null,
      next: [...runtime.next],
      cells: runtime.cells,
      rows: runtime.rows,
      melds: runtime.melds,
      clears: runtime.clears,
      seq: seqs[i] ?? 0,
    })),
    events: state.events.slice(-12),
    winner: state.winner,
    turn: state.turn,
    paused,
    pauseMs,
  };
}

export function snapshotToState(snapshot: Snapshot, mode: GameMode): GameState {
  const count = snapshot.players.length;
  const state: GameState = {
    mode,
    difficulty: snapshot.difficulty ?? 'normal',
    tick: snapshot.tick,
    playTicks: snapshot.playTicks,
    phase: snapshot.phase,
    phaseTick: snapshot.phaseTick,
    board: decodeBoard(snapshot.board),
    players: snapshot.players.map((player) => ({
      piece: player.piece
        ? { k: player.piece[0], r: player.piece[1], x: player.piece[2], y: player.piece[3], fallT: 0, lockT: 0, resets: 0 }
        : null,
      next: [...player.next],
      cells: player.cells,
      rows: player.rows,
      melds: player.melds,
      clears: player.clears ?? 0,
      lastPingTick: -PING_COOLDOWN_TICKS,
    })),
    rng: new Array(count).fill(0x1234567),
    bags: new Array(count).fill(null).map(() => []),
    score: snapshot.score,
    lines: snapshot.lines,
    melds: snapshot.melds,
    objective: snapshot.objective,
    winner: snapshot.winner ?? null,
    turn: snapshot.turn ?? 0,
    events: snapshot.events,
    eventSeq: snapshot.events.reduce((max, event) => Math.max(max, event.id), 0),
  };
  return state;
}
