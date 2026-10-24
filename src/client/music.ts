/**
 * Central soundtrack manager.
 *
 * - one explicit mapping from game state to track (soundtrack.ts)
 * - two decks so tracks can crossfade without overlapping at full volume
 * - a single AnalyserNode shared by both decks for the Liquid Aurora
 * - autoplay, 404/decoding failures and tab suspension are all non-fatal
 *
 * No second player is created for the visualizer: the aurora reads this manager's
 * analyser, so it always follows whichever soundtrack is actually audible.
 */
import {
  analyseSpectrum,
  clamp01,
  resolveTrack,
  smooth,
  trackPath,
  type GameMode,
  type LobbyTheme,
  type SpectrumLevels,
  type TrackId,
} from './soundtrack.js';

const CROSSFADE_MS = 900;
const RETRY_AFTER_MS = 30_000;
/**
 * The supplied MP3s are songs, not authored game loops. Measurements show quiet tails
 * (Pixelated Memories) and audible seams (Friendly Fire, Pressure Loop), so a hard
 * `audio.loop` would click or drop. Instead the last moments crossfade into a fresh deck.
 */
const LOOP_CROSSFADE_S = 1.25;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  track: TrackId | null;
  generation: number;
}

export interface AudioLevels extends SpectrumLevels {
  /** True only while a real soundtrack is decoded and running through the analyser. */
  live: boolean;
}

export interface MusicSnapshot {
  wanted: TrackId | null;
  audible: TrackId | null;
  missing: TrackId[];
  enabled: boolean;
  blocked: boolean;
  live: boolean;
}

export interface MusicDeps {
  createAudio?: () => HTMLAudioElement;
  createContext?: () => AudioContext | null;
  warn?: (message: string) => void;
}

export class MusicManager {
  private deps: MusicDeps;
  private decks: Deck[] = [];
  private active = 0;
  private wanted: TrackId | null = null;

  private scene: 'lobby' | 'game' = 'lobby';
  private mode: GameMode = 'coop';
  private lobbyTheme: LobbyTheme = 'afterHours';
  private danger = false;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;
  private smoothed: SpectrumLevels = { bass: 0, mid: 0, energy: 0 };

  private enabled = true;
  private volume = 0.7;
  private missing = new Set<TrackId>();
  private blocked = false;
  private unlockArmed = false;
  private visibilityBound = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryBudget = 2;

  constructor(deps: MusicDeps = {}) {
    this.deps = deps;
  }

  // ---------- public controls ----------

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.applyMaster();
    if (!enabled) {
      this.pauseDecks();
      this.setDataset('music', 'off');
    } else if (this.wanted) {
      const deck = this.decks[this.active];
      if (deck && deck.track === this.wanted && !deck.el.paused) {
        this.ramp(deck.gain, 1, 200);
        this.setDataset('music', this.wanted);
        this.setDataset('musicLive', this.ctx ? '1' : '0');
      } else {
        this.playTrack(this.wanted, true);
      }
    }
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    this.applyMaster();
    if (!this.ctx) {
      const deck = this.decks[this.active];
      if (deck) deck.el.volume = this.enabled ? this.volume : 0;
    }
  }

  setLobbyTheme(theme: LobbyTheme): void {
    if (this.lobbyTheme === theme) return;
    this.lobbyTheme = theme;
    this.applyTrack();
  }

  setScene(scene: 'lobby' | 'game', mode?: GameMode): void {
    const changed = this.scene !== scene;
    this.scene = scene;
    if (mode) this.mode = mode;
    if (scene === 'lobby' && (changed || this.danger)) {
      this.danger = false;
    }
    this.applyTrack();
  }

  setMode(mode: GameMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.applyTrack();
  }

  setDanger(danger: boolean): void {
    if (this.danger === danger) return;
    this.danger = danger;
    this.applyTrack();
  }

  /** Called every animation frame by the aurora. */
  levels(): AudioLevels {
    const live = this.isLive();
    if (!live || !this.analyser || !this.ctx || !this.bins) {
      this.smoothed = {
        bass: smooth(this.smoothed.bass, 0, 0.2, 0.05),
        mid: smooth(this.smoothed.mid, 0, 0.2, 0.05),
        energy: smooth(this.smoothed.energy, 0, 0.2, 0.05),
      };
      return { ...this.smoothed, live: false };
    }
    this.analyser.getByteFrequencyData(this.bins);
    const raw = analyseSpectrum(this.bins, this.ctx.sampleRate, this.analyser.fftSize);
    this.smoothed = {
      bass: smooth(this.smoothed.bass, raw.bass, 0.3, 0.08),
      mid: smooth(this.smoothed.mid, raw.mid, 0.24, 0.06),
      energy: smooth(this.smoothed.energy, raw.energy, 0.26, 0.07),
    };
    return { ...this.smoothed, live: true };
  }

  snapshot(): MusicSnapshot {
    return {
      wanted: this.wanted,
      audible: this.decks[this.active]?.track ?? null,
      missing: [...this.missing],
      enabled: this.enabled,
      blocked: this.blocked,
      live: this.isLive(),
    };
  }

  dispose(): void {
    this.pauseDecks();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.decks = [];
  }

  // ---------- state mapping ----------

  private applyTrack(): void {
    const next = resolveTrack({
      screen: this.scene,
      mode: this.mode,
      lobbyTheme: this.lobbyTheme,
      danger: this.danger,
    });
    this.setDataset('musicWanted', next);
    if (next !== this.wanted) {
      this.wanted = next;
      this.playTrack(next);
    } else if (this.enabled && !this.blocked && !this.missing.has(next)) {
      // Keep a suspended deck alive if the tab becomes active again.
      const deck = this.decks[this.active];
      if (deck && deck.track === next) void deck.el.play().catch(() => undefined);
    }
  }

  // ---------- playback ----------

  private ensureInit(): void {
    if (this.decks.length > 0) return;
    const createAudio = this.deps.createAudio ?? (() => new Audio());
    for (let i = 0; i < 2; i++) {
      const el = createAudio();
      // Looping is handled by a self-crossfade; a native loop would cut the tail.
      el.loop = false;
      el.preload = 'none';
      el.volume = 1;
      const index = i;
      el.addEventListener('playing', () => this.onPlaying(index));
      el.addEventListener('error', () => this.onError(index));
      el.addEventListener('timeupdate', () => this.onTimeUpdate(index));
      el.addEventListener('ended', () => this.onEnded(index));
      this.decks.push({ el, gain: null, track: null, generation: 0 });
    }

    const context = this.createContext();
    if (!context) {
      // No Web Audio: plain element playback, and the aurora uses its ambient fallback.
      this.decks[this.active].el.volume = this.enabled ? this.volume : 0;
      this.bindVisibility();
      this.setDataset('musicLive', '0');
      return;
    }
    this.ctx = context;
    try {
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      const master = context.createGain();
      master.gain.value = this.enabled ? this.volume : 0;
      for (const deck of this.decks) {
        const gain = context.createGain();
        gain.gain.value = 0;
        const source = context.createMediaElementSource(deck.el);
        source.connect(gain);
        gain.connect(analyser);
        deck.gain = gain;
      }
      analyser.connect(master);
      master.connect(context.destination);
      this.analyser = analyser;
      this.master = master;
      this.bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch (error) {
      this.deps.warn?.(`[meldra] Audio analysis unavailable: ${String(error)}`);
      this.ctx = null;
      this.analyser = null;
      this.master = null;
      this.setDataset('musicLive', '0');
    }
    this.bindVisibility();
  }

  private createContext(): AudioContext | null {
    if (this.deps.createContext) {
      try {
        return this.deps.createContext();
      } catch {
        return null;
      }
    }
    if (typeof window === 'undefined') return null;
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      return Ctor ? new Ctor() : null;
    } catch {
      return null;
    }
  }

  private playTrack(track: TrackId, force = false): void {
    this.ensureInit();
    if (!track || !this.enabled) return;
    if (!force && this.missing.has(track)) {
      this.markSilent(track);
      return;
    }

    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);

    const current = this.decks[this.active];
    // Reuse the active deck when it already holds the track (resume, unmute, tab return).
    const reuse = current.track === track;
    const index = reuse ? this.active : 1 - this.active;
    const deck = this.decks[index];
    if (!deck) return;

    if (deck.track !== track) {
      deck.generation += 1;
      deck.track = track;
      deck.el.src = trackPath(track);
      deck.el.load();
    }

    this.setDataset('music', this.blocked ? 'blocked' : track);
    const attempt = deck.el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch((error: unknown) => this.onPlayRejected(index, error));
    }
  }

  private onPlaying(index: number): void {
    const deck = this.decks[index];
    if (!deck || !deck.track || deck.track !== this.wanted) return;
    if (!this.enabled) {
      deck.el.pause();
      return;
    }
    this.retryBudget = 2;

    const previousIndex = this.active;
    const previous = this.decks[previousIndex];
    this.active = index;
    this.blocked = false;

    if (previous && previous !== deck && previous.track) {
      if (!this.ctx) {
        // No Web Audio fade available: never let two full-volume tracks overlap.
        previous.el.pause();
        previous.el.removeAttribute('src');
        previous.el.load();
        previous.track = null;
      } else {
        const generation = previous.generation;
        this.ramp(previous.gain, 0, CROSSFADE_MS);
        setTimeout(() => {
          if (previous.generation !== generation || this.decks[this.active] === previous) return;
          previous.el.pause();
          previous.el.removeAttribute('src');
          previous.el.load();
          previous.track = null;
          this.ramp(previous.gain, 0, 20);
        }, CROSSFADE_MS + 80);
      }
    } else if (previous === deck) {
      this.ramp(deck.gain, 1, 120);
    }

    this.ramp(deck.gain, 1, CROSSFADE_MS);
    if (!this.ctx) deck.el.volume = this.volume;
    this.setDataset('music', deck.track);
    this.setDataset('musicLive', this.ctx ? '1' : '0');
  }

  /** Near the end of a track, fade a fresh copy in on the idle deck. */
  private onTimeUpdate(index: number): void {
    const deck = this.decks[index];
    if (!deck || this.active !== index || !deck.track || deck.track !== this.wanted || !this.enabled) return;
    const remaining = deck.el.duration - deck.el.currentTime;
    if (!Number.isFinite(remaining) || remaining > LOOP_CROSSFADE_S + 0.3) return;
    const other = this.decks[1 - index];
    // If the other deck is still fading out a previous track, let this one finish instead.
    if (!other || !other.el.paused || other.track !== null) return;
    other.generation += 1;
    other.track = deck.track;
    other.el.src = trackPath(deck.track);
    other.el.load();
    const attempt = other.el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch((error: unknown) => this.onPlayRejected(1 - index, error));
    }
  }

  /** Safety net if a throttled tab misses the loop crossfade window. */
  private onEnded(index: number): void {
    const deck = this.decks[index];
    if (!deck || this.active !== index || !deck.track || deck.track !== this.wanted || !this.enabled) return;
    const attempt = deck.el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch((error: unknown) => this.onPlayRejected(index, error));
    }
  }

  private onPlayRejected(index: number, error: unknown): void {
    const deck = this.decks[index];
    if (!deck || !deck.track) return;
    const name = typeof error === 'object' && error && 'name' in error ? String((error as { name: unknown }).name) : '';
    const mediaError = deck.el.error;
    if (name === 'NotAllowedError') {
      this.blocked = true;
      this.setDataset('music', 'blocked');
      this.armUnlock();
      return;
    }
    if (name === 'AbortError') return;
    if (mediaError || name === 'NotSupportedError') {
      this.fail(deck.track);
      return;
    }
    // A network failure can be temporary; try again on the next explicit track change.
    this.deps.warn?.(`[meldra] Soundtrack could not start (${name || 'unknown'}): ${trackPath(deck.track)}`);
    this.markSilent(deck.track);
  }

  private onError(index: number): void {
    const deck = this.decks[index];
    if (deck?.track) this.fail(deck.track);
  }

  private fail(track: TrackId): void {
    if (!this.missing.has(track)) {
      this.missing.add(track);
      this.deps.warn?.(
        `[meldra] Soundtrack missing or unreadable: ${trackPath(track)}\n` +
          `         Add the file to Soundtrack/. Music stays silent; the aurora keeps its ambient fallback.`,
      );
    }
    this.markSilent(track);
    this.scheduleRetry();
  }

  private markSilent(track: TrackId): void {
    if (this.wanted !== track) return;
    this.setDataset('music', 'silent');
    this.setDataset('musicLive', '0');
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.retryBudget <= 0) return;
    this.retryBudget -= 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.wanted || !this.enabled) return;
      this.missing.clear();
      this.playTrack(this.wanted, true);
    }, RETRY_AFTER_MS);
    // Never keep a Node test process alive just for a retry.
    (this.retryTimer as unknown as { unref?: () => void }).unref?.();
  }

  private armUnlock(): void {
    if (this.unlockArmed || typeof window === 'undefined') return;
    this.unlockArmed = true;
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      this.unlockArmed = false;
      this.blocked = false;
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      if (this.wanted) this.playTrack(this.wanted, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.wanted) return;
      if (document.hidden) {
        this.pauseDecks();
      } else if (this.enabled) {
        this.playTrack(this.wanted, true);
      }
    });
  }

  private pauseDecks(): void {
    for (const deck of this.decks) deck.el.pause();
    this.setDataset('musicLive', '0');
  }

  private applyMaster(): void {
    if (this.master && this.ctx) {
      const value = this.enabled ? this.volume : 0;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(value, now, 0.04);
    } else {
      for (const deck of this.decks) deck.el.volume = this.enabled ? this.volume : 0;
    }
  }

  private ramp(gain: GainNode | null, value: number, ms: number): void {
    if (!gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0, gain.gain.value), now);
    gain.gain.linearRampToValueAtTime(Math.max(0, value), now + ms / 1000);
  }

  private isLive(): boolean {
    const deck = this.decks[this.active];
    return Boolean(
      this.ctx &&
        this.ctx.state === 'running' &&
        this.analyser &&
        this.enabled &&
        this.wanted &&
        !this.missing.has(this.wanted) &&
        deck &&
        !deck.el.paused,
    );
  }

  private setDataset(key: string, value: string): void {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset[key] = value;
  }
}

export const music = new MusicManager();
