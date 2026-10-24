import { describe, expect, it } from 'vitest';
import { MusicManager } from '../src/client/music.js';

type Listener = () => void;

class FakeAudio {
  src = '';
  loop = false;
  preload = '';
  volume = 1;
  paused = true;
  duration = 180;
  currentTime = 0;
  plays = 0;
  error: { code: number } | null = null;
  failWith: { name: string } | null = null;
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, handler: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: Listener): void {
    this.listeners.get(type)?.delete(handler);
  }

  play(): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.plays++;
    this.paused = false;
    this.emit('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {
    /* nothing to decode */
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  emit(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) handler();
  }
}

function setup(options: { fail?: boolean } = {}): {
  manager: MusicManager;
  elements: FakeAudio[];
} {
  const elements: FakeAudio[] = [];
  const manager = new MusicManager({
    createAudio: () => {
      const element = new FakeAudio();
      if (options.fail) element.failWith = { name: 'NotSupportedError' };
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
    createContext: () => null,
    warn: () => undefined,
  });
  return { manager, elements };
}

describe('music manager', () => {
  it('reuses two decks and maps scene, mode and danger to tracks', () => {
    const { manager, elements } = setup();
    manager.setScene('lobby');
    expect(manager.snapshot().wanted).toBe('afterHours');
    expect(manager.snapshot().audible).toBe('afterHours');
    expect(elements).toHaveLength(2);
    expect(elements.filter((element) => !element.paused)).toHaveLength(1);

    manager.setScene('game', 'solo');
    expect(manager.snapshot().wanted).toBe('solo');
    expect(manager.snapshot().audible).toBe('solo');
    expect(elements).toHaveLength(2);
    expect(elements.filter((element) => !element.paused)).toHaveLength(1);

    manager.setDanger(true);
    expect(manager.snapshot().wanted).toBe('pressure');
    expect(manager.snapshot().audible).toBe('pressure');

    manager.setDanger(false);
    expect(manager.snapshot().wanted).toBe('solo');
    expect(manager.snapshot().audible).toBe('solo');
    expect(elements.filter((element) => !element.paused)).toHaveLength(1);

    manager.setScene('game', 'coop');
    expect(manager.snapshot().wanted).toBe('coop');
    manager.setLobbyTheme('pixelated');
    manager.setScene('lobby');
    expect(manager.snapshot().wanted).toBe('pixelated');
    expect(elements.filter((element) => !element.paused)).toHaveLength(1);

    manager.dispose();
  });

  it('does not restart a track when the same scene is applied again', () => {
    const { manager, elements } = setup();
    manager.setScene('lobby');
    const deck = elements.find((element) => !element.paused);
    expect(deck).toBeDefined();
    const src = deck?.src;
    manager.setScene('lobby');
    manager.setMode('coop');
    manager.setLobbyTheme('afterHours');
    expect(deck?.src).toBe(src);
    expect(deck?.paused).toBe(false);
    expect(elements).toHaveLength(2);
    manager.dispose();
  });

  it('mutes by pausing and resumes the same track without creating another deck', () => {
    const { manager, elements } = setup();
    manager.setScene('lobby');
    manager.setEnabled(false);
    expect(elements.every((element) => element.paused)).toBe(true);
    manager.setEnabled(true);
    expect(elements).toHaveLength(2);
    expect(elements.filter((element) => !element.paused)).toHaveLength(1);
    expect(manager.snapshot().wanted).toBe('afterHours');
    manager.dispose();
  });

  it('clamps volume and keeps it on the active deck', () => {
    const { manager, elements } = setup();
    manager.setScene('lobby');
    manager.setVolume(2);
    expect(elements.find((element) => !element.paused)?.volume).toBe(1);
    manager.setVolume(0.25);
    expect(elements.find((element) => !element.paused)?.volume).toBe(0.25);
    manager.setVolume(Number.NaN);
    expect(elements.find((element) => !element.paused)?.volume).toBe(0);
    manager.dispose();
  });

  it('degrades to silence when a soundtrack file cannot be decoded', async () => {
    const { manager } = setup({ fail: true });
    manager.setScene('game', 'solo');
    await Promise.resolve();
    await Promise.resolve();
    const snapshot = manager.snapshot();
    expect(snapshot.missing).toContain('solo');
    expect(snapshot.live).toBe(false);
    expect(manager.levels().live).toBe(false);
    expect(manager.levels().energy).toBeGreaterThanOrEqual(0);
    manager.dispose();
  });

  it('crossfades a fresh copy near the end instead of hard-looping', () => {
    const { manager, elements } = setup();
    manager.setScene('lobby');
    const playing = elements.find((element) => !element.paused);
    expect(playing).toBeDefined();
    const active = elements.indexOf(playing as FakeAudio);
    (playing as FakeAudio).duration = 100;
    (playing as FakeAudio).currentTime = 99.1;
    const before = elements.reduce((sum, element) => sum + element.plays, 0);

    (manager as unknown as { onTimeUpdate(index: number): void }).onTimeUpdate(active);

    expect(elements.reduce((sum, element) => sum + element.plays, 0)).toBe(before + 1);
    expect(elements.filter((element) => !element.paused)).toHaveLength(1);
    expect(manager.snapshot().audible).toBe('afterHours');
    expect(elements).toHaveLength(2);

    // A later timeupdate on the fresh deck is far from the end and must not restart it again.
    (manager as unknown as { onTimeUpdate(index: number): void }).onTimeUpdate(1 - active);
    expect(elements.reduce((sum, element) => sum + element.plays, 0)).toBe(before + 1);
    manager.dispose();
  });

  it('reports no live analysis before audio is initialised', () => {
    const { manager } = setup();
    expect(manager.levels()).toEqual({ bass: 0, mid: 0, energy: 0, live: false });
    manager.dispose();
  });
});
