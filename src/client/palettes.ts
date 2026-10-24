import type { I18nKey } from './i18n.js';

export interface Palette {
  id: string;
  nameKey: I18nKey;
  /** Seven colours, one per piece kind (I O T S Z J L). */
  colors: string[];
  accent: string;
}

/**
 * Palettes are deliberately mid-to-high luminance so every block stays legible on the
 * near-black arena. Ownership is additionally encoded with borders/patterns, never colour alone.
 */
export const PALETTES: Palette[] = [
  {
    id: 'aurora',
    nameKey: 'palette.aurora',
    colors: ['#67e8f9', '#a78bfa', '#f472b6', '#fbbf24', '#4ade80', '#fb7185', '#93c5fd'],
    accent: '#7dd3fc',
  },
  {
    id: 'ember',
    nameKey: 'palette.ember',
    colors: ['#ffd166', '#ff9f43', '#ff6b6b', '#f472b6', '#fca5a5', '#fde68a', '#fb923c'],
    accent: '#ffb27a',
  },
  {
    id: 'tide',
    nameKey: 'palette.tide',
    colors: ['#22d3ee', '#38bdf8', '#818cf8', '#2dd4bf', '#7dd3fc', '#a5b4fc', '#5eead4'],
    accent: '#5eead4',
  },
  {
    id: 'bloom',
    nameKey: 'palette.bloom',
    colors: ['#f9a8d4', '#c084fc', '#f0abfc', '#fda4af', '#e879f9', '#a78bfa', '#fbcfe8'],
    accent: '#f0abfc',
  },
];

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function nextPaletteId(id: string, direction: 1 | -1): string {
  const index = PALETTES.findIndex((p) => p.id === id);
  const start = index < 0 ? 0 : index;
  return PALETTES[(start + direction + PALETTES.length) % PALETTES.length].id;
}

/** Display order for preview blocks: a representative little stack, not just kind 0..6. */
export function sampleKinds(): number[] {
  return [0, 2, 4, 5, 1, 6, 3, 2, 0];
}
