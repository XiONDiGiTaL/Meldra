/**
 * Soundtrack rules, kept free of DOM and audio APIs so they can be tested directly.
 *
 * A single explicit map decides which track belongs to the current screen, mode and
 * danger state. Everything else (crossfades, analysis, autoplay) lives in music.ts.
 */

import { COLS, ROWS } from '../shared/constants.js';
import type { GameMode } from '../shared/types.js';

export type TrackId = 'afterHours' | 'pixelated' | 'solo' | 'coop' | 'versus' | 'pressure';
export type LobbyTheme = 'afterHours' | 'pixelated';
export type { GameMode };

export interface TrackDefinition {
  readonly file: string;
  readonly title: string;
}

/** Exact filenames supplied for the project; the folder is served from the repo root. */
export const TRACKS: Record<TrackId, TrackDefinition> = {
  afterHours: { file: 'Meldra_ After Hours (Main Lobby).mp3', title: 'After Hours' },
  pixelated: { file: 'Meldra_ Pixelated Memories (Alternate Lobby).mp3', title: 'Pixelated Memories' },
  solo: { file: 'Meldra_ One More Round (Solo Mode).mp3', title: 'One More Round' },
  coop: { file: 'Meldra_ Same Frequency (Co-Op Mode).mp3', title: 'Same Frequency' },
  versus: { file: 'Meldra_ Friendly Fire (Versus Mode).mp3', title: 'Friendly Fire' },
  pressure: { file: 'Meldra_ Pressure Loop (High Risk).mp3', title: 'Pressure Loop' },
};

export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

export function isLobbyTheme(value: unknown): value is LobbyTheme {
  return value === 'afterHours' || value === 'pixelated';
}

export function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRACKS, value);
}

/**
 * `/Soundtrack/Meldra_%20After%20Hours%20(Main%20Lobby).mp3`
 *
 * Encoding keeps the exact on-disk filenames while staying valid in a URL. `(` and
 * `)` are legal path characters but encodeURIComponent leaves them readable.
 */
export function trackPath(id: TrackId): string {
  const base = import.meta.env?.BASE_URL || '/';
  return `${base}Soundtrack/${encodeURIComponent(TRACKS[id].file)}`;
}

export interface TrackRequest {
  screen: 'lobby' | 'game';
  mode: GameMode;
  lobbyTheme: LobbyTheme;
  danger: boolean;
}

/** The base track for a mode, before any danger override. */
export function baseTrack(mode: GameMode): TrackId {
  if (mode === 'versus') return 'versus';
  if (mode === 'solo' || mode === 'endless' || mode === 'architect') return 'solo';
  return 'coop';
}

/** Single source of truth for which track should be audible. */
export function resolveTrack({ screen, mode, lobbyTheme, danger }: TrackRequest): TrackId {
  if (screen === 'lobby') return lobbyTheme;
  if (danger) return 'pressure';
  return baseTrack(mode);
}

/** Rows of empty space counted from the top of the board. Lower means taller stack. */
export const DANGER_ENTER_ROWS = 6;
export const DANGER_EXIT_ROWS = 8;
/** Keep Pressure Loop on screen for a moment even after a lucky clear. */
export const DANGER_MIN_HOLD_MS = 2500;
/** Prevent an instant re-trigger while the board flickers around the threshold. */
export const DANGER_REENTRY_MS = 1200;

/**
 * Hysteretic danger detector.
 *
 * Entering danger needs the stack to reach DANGER_ENTER_ROWS; leaving needs both a
 * safer stack (DANGER_EXIT_ROWS) and the minimum hold. The gap means a single clear
 * that only shaves one row does not immediately swap the soundtrack.
 */
export class DangerLatch {
  private active = false;
  private enteredAt = 0;
  private reentryAt = 0;

  get value(): boolean {
    return this.active;
  }

  update(emptyRows: number, now: number): boolean {
    if (!this.active) {
      if (emptyRows <= DANGER_ENTER_ROWS && now >= this.reentryAt) {
        this.active = true;
        this.enteredAt = now;
      }
      return this.active;
    }
    if (emptyRows >= DANGER_EXIT_ROWS && now - this.enteredAt >= DANGER_MIN_HOLD_MS) {
      this.active = false;
      this.reentryAt = now + DANGER_REENTRY_MS;
    }
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.enteredAt = 0;
    this.reentryAt = 0;
  }
}

/** Stack height in rows from the top edge; exposes no renderer state. */
export function dangerRows(board: readonly (unknown | null)[]): number {
  for (let index = 0; index < board.length; index++) {
    if (board[index]) return Math.floor(index / COLS) + 1;
  }
  return ROWS;
}

export interface SpectrumLevels {
  bass: number;
  mid: number;
  energy: number;
}

/** Average of a frequency window, normalised to 0..1 from the analyser's bytes. */
export function bandEnergy(
  bins: Uint8Array | readonly number[],
  sampleRate: number,
  fftSize: number,
  lowHz: number,
  highHz: number,
): number {
  const binHz = sampleRate / fftSize;
  const from = Math.max(0, Math.floor(lowHz / binHz));
  const to = Math.min(bins.length - 1, Math.ceil(highHz / binHz));
  if (to < from) return 0;
  let sum = 0;
  for (let i = from; i <= to; i++) sum += bins[i] ?? 0;
  return clamp01(sum / (to - from + 1) / 255);
}

/** Bass, mid and overall energy for the aurora. Values are intentionally gentle. */
export function analyseSpectrum(
  bins: Uint8Array | readonly number[],
  sampleRate: number,
  fftSize: number,
): SpectrumLevels {
  return {
    bass: bandEnergy(bins, sampleRate, fftSize, 25, 160),
    mid: bandEnergy(bins, sampleRate, fftSize, 160, 2200),
    energy: bandEnergy(bins, sampleRate, fftSize, 40, 9000),
  };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Asymmetric smoothing: quick to react, slow to fall back, so the aurora never flickers. */
export function smooth(previous: number, next: number, attack = 0.22, release = 0.07): number {
  const target = clamp01(next);
  const rate = target > previous ? attack : release;
  return clamp01(previous + (target - previous) * rate);
}

export type AuroraSetting = 'off' | 'subtle' | 'enhanced';

export function isAuroraSetting(value: unknown): value is AuroraSetting {
  return value === 'off' || value === 'subtle' || value === 'enhanced';
}

/** Relative ribbon intensity. 'off' never draws; 'enhanced' is still board-safe. */
export function auroraIntensity(level: AuroraSetting): number {
  if (level === 'off') return 0;
  return level === 'enhanced' ? 1 : 0.55;
}

export function auroraAnimated(level: AuroraSetting, reduceMotion: boolean, hidden = false): boolean {
  return level !== 'off' && !reduceMotion && !hidden;
}
