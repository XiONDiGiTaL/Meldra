import type { Cell, Difficulty, GameEvent, GameMode, Phase, Piece } from '../shared/types.js';
import { RIFT_WAVE_TICKS } from '../shared/constants.js';

export interface ViewPlayer {
  name: string;
  paletteId: string;
  connected: boolean;
}

export interface ViewState {
  mode: GameMode;
  difficulty: Difficulty;
  phase: Phase;
  countdown: number;
  board: (Cell | null)[];
  pieces: (Piece | null)[];
  next: number[][];
  cells: number[];
  rows: number[];
  clears: number[];
  melds: number;
  objective: number;
  score: number;
  lines: number;
  winner: number | null;
  turn: number;
  /** Rift wave number, 1-based; 0 for other modes. */
  wave: number;
  players: ViewPlayer[];
  events: GameEvent[];
  localPlayer: number;
  paused: boolean;
  pauseMs: number;
}

export function difficultyKey(difficulty: Difficulty): 'diff.zen' | 'diff.normal' | 'diff.hard' {
  return difficulty === 'zen' ? 'diff.zen' : difficulty === 'hard' ? 'diff.hard' : 'diff.normal';
}

export function riftWave(mode: GameMode, playTicks: number): number {
  if (mode !== 'rift') return 0;
  return Math.min(3, Math.floor(playTicks / RIFT_WAVE_TICKS) + 1);
}

export function countdownSeconds(phase: Phase, phaseTick: number, countdownTicks: number): number {
  if (phase !== 'countdown') return 0;
  return Math.max(0, Math.ceil((countdownTicks - phaseTick) / 20));
}
