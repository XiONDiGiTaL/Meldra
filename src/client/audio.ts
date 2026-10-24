/** Original synthesized cues. No samples or third-party audio are used. */
class Sfx {
  private ctx: AudioContext | null = null;
  enabled = true;

  private context(): AudioContext | null {
    if (!this.enabled) return null;
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(
    frequency: number,
    duration: number,
    options: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {},
  ): void {
    const ctx = this.context();
    if (!ctx) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    if (options.slide !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, options.slide), start + duration);
    }
    const peak = options.gain ?? 0.055;
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  unlock(): void {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  move(): void {
    this.tone(240, 0.05, { type: 'triangle', gain: 0.028 });
  }

  rotate(): void {
    this.tone(360, 0.07, { type: 'triangle', gain: 0.035, slide: 420 });
  }

  lock(): void {
    this.tone(150, 0.1, { type: 'square', gain: 0.03, slide: 110 });
  }

  clear(rows: number): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < Math.min(rows, 4); i++) {
      this.tone(notes[i], 0.16, { type: 'sine', gain: 0.05, delay: i * 0.055 });
    }
  }

  meld(): void {
    [659.25, 880, 1174.66].forEach((frequency, index) => {
      this.tone(frequency, 0.26, { type: 'sine', gain: 0.055, delay: index * 0.07 });
    });
  }

  ping(): void {
    this.tone(880, 0.12, { type: 'sine', gain: 0.04, slide: 1320 });
  }

  win(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => {
      this.tone(frequency, 0.34, { type: 'sine', gain: 0.06, delay: index * 0.11 });
    });
  }

  lose(): void {
    [392, 329.63, 261.63, 196].forEach((frequency, index) => {
      this.tone(frequency, 0.3, { type: 'triangle', gain: 0.05, delay: index * 0.12 });
    });
  }

  ui(): void {
    this.tone(520, 0.05, { type: 'sine', gain: 0.025 });
  }
}

export const sfx = new Sfx();
