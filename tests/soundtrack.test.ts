import { describe, expect, it } from 'vitest';
import {
  DangerLatch,
  TRACKS,
  analyseSpectrum,
  auroraAnimated,
  auroraIntensity,
  bandEnergy,
  dangerRows,
  resolveTrack,
  smooth,
  trackPath,
} from '../src/client/soundtrack.js';

describe('soundtrack map', () => {
  it('points at the six supplied files with exact names', () => {
    expect(Object.keys(TRACKS)).toHaveLength(6);
    expect(trackPath('afterHours')).toBe('/Soundtrack/Meldra_%20After%20Hours%20(Main%20Lobby).mp3');
    expect(trackPath('pixelated')).toBe(
      '/Soundtrack/Meldra_%20Pixelated%20Memories%20(Alternate%20Lobby).mp3',
    );
    expect(trackPath('solo')).toBe('/Soundtrack/Meldra_%20One%20More%20Round%20(Solo%20Mode).mp3');
    expect(trackPath('coop')).toBe('/Soundtrack/Meldra_%20Same%20Frequency%20(Co-Op%20Mode).mp3');
    expect(trackPath('versus')).toBe('/Soundtrack/Meldra_%20Friendly%20Fire%20(Versus%20Mode).mp3');
    expect(trackPath('pressure')).toBe('/Soundtrack/Meldra_%20Pressure%20Loop%20(High%20Risk).mp3');
    for (const id of Object.keys(TRACKS) as (keyof typeof TRACKS)[]) {
      expect(trackPath(id).startsWith('/Soundtrack/Meldra_')).toBe(true);
      expect(trackPath(id).endsWith('.mp3')).toBe(true);
    }
  });

  it('chooses lobby themes, mode tracks and the danger override', () => {
    const base = { screen: 'lobby' as const, mode: 'coop' as const, lobbyTheme: 'afterHours' as const, danger: false };
    expect(resolveTrack(base)).toBe('afterHours');
    expect(resolveTrack({ ...base, lobbyTheme: 'pixelated' })).toBe('pixelated');
    expect(resolveTrack({ ...base, screen: 'game' })).toBe('coop');
    expect(resolveTrack({ ...base, screen: 'game', mode: 'solo' })).toBe('solo');
    expect(resolveTrack({ ...base, screen: 'game', mode: 'versus' })).toBe('versus');
    for (const mode of ['coop', 'solo', 'versus'] as const) {
      expect(resolveTrack({ ...base, screen: 'game', mode, danger: true })).toBe('pressure');
    }
    // Danger is a gameplay state; it never overrides the lobby theme.
    expect(resolveTrack({ ...base, danger: true })).toBe('afterHours');
  });
});

describe('danger latch', () => {
  it('needs a tall stack, a safer clear and the minimum hold', () => {
    const latch = new DangerLatch();
    expect(latch.update(7, 0)).toBe(false);
    expect(latch.update(6, 100)).toBe(true);
    expect(latch.update(7, 1_000)).toBe(true);
    // One row cleared is not enough to leave danger.
    expect(latch.update(8, 2_000)).toBe(true);
    expect(latch.update(8, 3_000)).toBe(false);
  });

  it('suppresses an immediate re-trigger after the danger clears', () => {
    const latch = new DangerLatch();
    latch.update(5, 0);
    latch.update(9, 3_000);
    expect(latch.update(4, 3_500)).toBe(false);
    expect(latch.update(4, 4_300)).toBe(true);
  });

  it('counts rows from the top of a real board', () => {
    const board = Array<null>(200).fill(null);
    board[14 * 10 + 3] = { p: 0, k: 0 } as unknown as null;
    expect(dangerRows(board)).toBe(15);
    expect(dangerRows(Array<null>(200).fill(null))).toBe(20);
  });
});

describe('audio analysis helpers', () => {
  it('averages a frequency window and clamps to 0..1', () => {
    const bins = new Uint8Array(256);
    bins[0] = 255;
    // 48 kHz / 512 = 93.75 Hz per bin, so 25–160 Hz covers bins 0..2.
    expect(bandEnergy(bins, 48_000, 512, 25, 160)).toBeCloseTo(255 / 3 / 255, 5);
    expect(bandEnergy(bins, 48_000, 512, 5_000, 9_000)).toBeCloseTo(0, 5);
    expect(bandEnergy(new Uint8Array(0), 48_000, 512, 25, 160)).toBe(0);
  });

  it('returns bass, mids and overall energy inside 0..1', () => {
    const bins = new Uint8Array(256);
    bins.fill(128);
    const levels = analyseSpectrum(bins, 48_000, 512);
    expect(levels.bass).toBeCloseTo(128 / 255, 5);
    expect(levels.energy).toBeCloseTo(128 / 255, 5);
    expect(levels.mid).toBeGreaterThan(0);
  });

  it('reacts quickly and releases slowly', () => {
    expect(smooth(0, 1, 0.3, 0.05)).toBeCloseTo(0.3, 5);
    expect(smooth(1, 0, 0.3, 0.05)).toBeCloseTo(0.95, 5);
    expect(smooth(0.5, 0.5)).toBe(0.5);
    expect(smooth(Number.NaN, 0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe('aurora settings', () => {
  it('maps levels to restrained intensities', () => {
    expect(auroraIntensity('off')).toBe(0);
    expect(auroraIntensity('subtle')).toBeLessThan(auroraIntensity('enhanced'));
    expect(auroraIntensity('enhanced')).toBe(1);
  });

  it('never animates when off, reduced or hidden', () => {
    expect(auroraAnimated('subtle', false, false)).toBe(true);
    expect(auroraAnimated('off', false, false)).toBe(false);
    expect(auroraAnimated('enhanced', true, false)).toBe(false);
    expect(auroraAnimated('enhanced', false, true)).toBe(false);
  });
});
