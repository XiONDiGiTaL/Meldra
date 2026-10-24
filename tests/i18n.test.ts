import { describe, expect, it } from 'vitest';
import { EN, TR } from '../src/client/i18n.js';
import {
  isRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  versionMatches,
} from '../src/shared/protocol.js';
import { PROTOCOL_VERSION } from '../src/shared/constants.js';

const placeholders = (text: string): string[] => (text.match(/\{(\w+)\}/g) ?? []).sort();

describe('localization', () => {
  it('defines every English key in Turkish', () => {
    expect(Object.keys(TR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('has no empty or placeholder-mismatched strings', () => {
    for (const [key, english] of Object.entries(EN)) {
      const turkish = TR[key as keyof typeof TR];
      expect(english.trim().length, key).toBeGreaterThan(0);
      expect(turkish.trim().length, key).toBeGreaterThan(0);
      expect(placeholders(turkish), key).toEqual(placeholders(english));
    }
  });

  it('renders Turkish characters', () => {
    expect(TR['app.tagline']).toBe('Farklı renkler. Ortak kader.');
    expect(TR['game.paused']).toContain('Duraklatıldı');
    expect(TR['home.playTogether']).toContain('Arkadaşınla');
  });
});

describe('room codes', () => {
  it('generates five unambiguous characters', () => {
    const code = makeRoomCode(() => 0.42);
    expect(code).toHaveLength(5);
    for (const ch of code) expect('ABCDEFGHJKMNPQRSTUVWXYZ23456789').toContain(ch);
  });

  it('normalizes case and separators', () => {
    expect(normalizeRoomCode(' ab-cd 9 ')).toBe('ABCD9');
    expect(isRoomCode('abcd9')).toBe(true);
    expect(isRoomCode('ABCD')).toBe(false);
    expect(isRoomCode('ABCDO')).toBe(false);
    expect(isRoomCode('ABCDI')).toBe(false);
  });

  it('accepts only the current protocol version', () => {
    expect(versionMatches(PROTOCOL_VERSION)).toBe(true);
    expect(versionMatches(PROTOCOL_VERSION + 1)).toBe(false);
  });
});
