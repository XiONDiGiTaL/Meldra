import { COLS, ROWS } from './constants.js';
import type { Cell, Piece } from './types.js';

/** I, O, T, S, Z, J, L — index is the piece-kind id used by cells and previews. */
export const KIND_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type KindName = (typeof KIND_NAMES)[number];

/** Spawn orientations (SRS-like). Rotations are derived once at module load. */
const BASE_SHAPES: string[][] = [
  ['....', '####', '....', '....'], // I
  ['##', '##'], // O
  ['.#.', '###', '...'], // T
  ['.##', '##.', '...'], // S
  ['##.', '.##', '...'], // Z
  ['#..', '###', '...'], // J
  ['..#', '###', '...'], // L
];

function rotateCW(matrix: string[]): string[] {
  const n = matrix.length;
  const out: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) row += matrix[n - 1 - x][y];
    out.push(row);
  }
  return out;
}

export interface PieceShape {
  size: number;
  /** Four rotation states, each a list of board offsets relative to the piece origin. */
  rotations: { x: number; y: number }[][];
  /** Rotation states that are visually identical to the spawn state (O has one). */
  rotational: boolean;
}

function buildShape(base: string[]): PieceShape {
  const states: string[][] = [base];
  for (let i = 1; i < 4; i++) states.push(rotateCW(states[i - 1]));
  const unique = new Set(states.map((s) => s.join('/')));
  return {
    size: base.length,
    rotations: states.map((state) =>
      state.flatMap((row, y) =>
        [...row].flatMap((ch, x) => (ch === '#' ? [{ x, y }] : [])),
      ),
    ),
    rotational: unique.size > 1,
  };
}

export const SHAPES: PieceShape[] = BASE_SHAPES.map(buildShape);

export function pieceCells(kind: number, rot: number, x: number, y: number): { x: number; y: number }[] {
  const shape = SHAPES[kind];
  const cells = shape.rotations[((rot % 4) + 4) % 4];
  return cells.map((c) => ({ x: x + c.x, y: y + c.y }));
}

export function cellAt(board: (Cell | null)[], x: number, y: number): Cell | null {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null;
  return board[y * COLS + x];
}

/** True when the piece would overlap the walls, floor or a locked cell. */
export function collides(board: (Cell | null)[], piece: Pick<Piece, 'k' | 'r' | 'x' | 'y'>): boolean {
  for (const c of pieceCells(piece.k, piece.r, piece.x, piece.y)) {
    if (c.x < 0 || c.x >= COLS || c.y >= ROWS) return true;
    if (c.y < 0) continue;
    if (board[c.y * COLS + c.x]) return true;
  }
  return false;
}

/** Highest stack row (0 = top) for the danger meter. */
export function stackTop(board: (Cell | null)[]): number {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) if (board[y * COLS + x]) return y + 1;
  }
  return ROWS;
}
