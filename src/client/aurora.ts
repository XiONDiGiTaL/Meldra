/**
 * Liquid Aurora: a restrained, audio-reactive ambient layer behind the arena.
 *
 * The canvas is intentionally separate from the board renderer. It never touches game
 * state, never receives pointer events, and is covered by a mostly opaque board fill so
 * pieces and the grid keep their contrast. Most of the light lives in the 8px rim.
 */
import { music } from './music.js';
import {
  auroraAnimated,
  auroraIntensity,
  clamp01,
  smooth,
  type AuroraSetting,
} from './soundtrack.js';

type RGB = readonly [number, number, number];

const TEAL: RGB = [45, 212, 191];
const INDIGO: RGB = [99, 102, 241];
const VIOLET: RGB = [139, 92, 246];
const BLUE: RGB = [56, 189, 248];

const FRAME_MS = 1000 / 30;

interface Ribbon {
  base: number;
  amp: number;
  freq: number;
  speed: number;
  phase: number;
  width: number;
  alpha: number;
  left: RGB;
  right: RGB;
}

interface SideRibbon {
  dir: -1 | 1;
  freq: number;
  speed: number;
  phase: number;
  width: number;
  alpha: number;
  end: RGB;
}

/** Two slow curtains along the outer edges, where the board does not cover them. */
const SIDE_RIBBONS: SideRibbon[] = [
  { dir: -1, freq: 0.85, speed: 0.07, phase: 0.8, width: 0.15, alpha: 0.1, end: INDIGO },
  { dir: 1, freq: 0.7, speed: -0.055, phase: 2.6, width: 0.16, alpha: 0.095, end: BLUE },
];

const RIBBONS: Ribbon[] = [
  { base: 0.1, amp: 0.055, freq: 1.1, speed: 0.09, phase: 0.4, width: 0.2, alpha: 0.075, left: TEAL, right: INDIGO },
  { base: 0.26, amp: 0.07, freq: 0.8, speed: -0.07, phase: 2.1, width: 0.26, alpha: 0.06, left: INDIGO, right: VIOLET },
  { base: 0.48, amp: 0.085, freq: 0.65, speed: 0.055, phase: 4.3, width: 0.34, alpha: 0.05, left: BLUE, right: TEAL },
  { base: 0.7, amp: 0.07, freq: 0.9, speed: -0.05, phase: 1.2, width: 0.28, alpha: 0.055, left: VIOLET, right: BLUE },
  { base: 0.87, amp: 0.05, freq: 1.25, speed: 0.075, phase: 3.4, width: 0.22, alpha: 0.07, left: INDIGO, right: TEAL },
];

function rgba(color: RGB, alpha: number): string {
  const a = clamp01(alpha);
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${a.toFixed(3)})`;
}

export class Aurora {
  readonly canvas: HTMLCanvasElement;
  private host: HTMLElement;
  private ctx: CanvasRenderingContext2D | null;
  private level: AuroraSetting = 'subtle';
  private userReduceMotion = false;
  private danger = false;
  private raf = 0;
  private observer: ResizeObserver | null = null;
  private media: MediaQueryList | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private lastPaint = 0;
  private startedAt = 0;
  private smoothedBass = 0;
  private smoothedEnergy = 0;
  private lastDataset = 0;
  private everPainted = false;
  private frameWidth = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'aurora-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.insertBefore(this.canvas, host.firstChild);
    this.ctx = this.canvas.getContext('2d');

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.media.addEventListener?.('change', this.onMediaChange);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(host);
      this.observer.observe(this.canvas);
    }
    this.startedAt = performance.now();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.start();
  }

  get reduced(): boolean {
    return this.userReduceMotion || Boolean(this.media?.matches);
  }

  /** Keep a 28px light rim around the actual arena, on phones as well as desktop. */
  setFrameWidth(boardWidth: number): void {
    const width = Math.max(80, Math.round(boardWidth + 56));
    if (width === this.frameWidth) return;
    this.frameWidth = width;
    this.canvas.style.width = `${width}px`;
    this.resize();
  }

  setLevel(level: AuroraSetting): void {
    if (this.level === level) return;
    this.level = level;
    this.canvas.dataset.aurora = level;
    this.canvas.dataset.level = level;
    if (level === 'off') {
      this.stop();
      this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.dataset.live = '0';
      this.canvas.dataset.energy = '0';
      return;
    }
    this.start();
    this.paint(performance.now());
  }

  setReduceMotion(reduce: boolean): void {
    if (this.userReduceMotion === reduce) return;
    this.userReduceMotion = reduce;
    if (this.reduced) {
      this.stop();
      this.paint(performance.now());
    } else {
      this.start();
    }
  }

  setDanger(danger: boolean): void {
    if (this.danger === danger) return;
    this.danger = danger;
    this.canvas.dataset.danger = danger ? '1' : '0';
    if (!auroraAnimated(this.level, this.reduced, this.hidden)) this.paint(performance.now());
  }

  dispose(): void {
    this.stop();
    this.observer?.disconnect();
    this.observer = null;
    this.media?.removeEventListener?.('change', this.onMediaChange);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.remove();
  }

  // ---------- loop ----------

  private start(): void {
    if (this.raf || this.level === 'off' || this.reduced || this.hidden) {
      if (this.reduced && !this.raf) this.paint(performance.now());
      return;
    }
    if (!this.startedAt) this.startedAt = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (!auroraAnimated(this.level, this.reduced, this.hidden)) {
      if (this.reduced) this.paint(now);
      return;
    }
    if (now - this.lastPaint >= FRAME_MS) {
      this.lastPaint = now;
      this.paint(now);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private get hidden(): boolean {
    return typeof document !== 'undefined' && document.hidden;
  }

  private onMediaChange = (): void => {
    if (this.reduced) {
      this.stop();
      this.paint(performance.now());
    } else {
      this.start();
    }
  };

  private onVisibility = (): void => {
    if (this.hidden) this.stop();
    else this.start();
  };

  private resize(): void {
    // CSS decides the frame (a narrow band around the arena); never set inline sizes here,
    // or the band would stretch to the whole column.
    const rect = this.canvas.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    const width = Math.max(40, Math.round(rect.width || hostRect.width));
    const height = Math.max(80, Math.round(rect.height || hostRect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, this.level === 'enhanced' ? 2 : 1.5);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.dataset.aurora = this.level;
    this.everPainted = false;
    this.paint(performance.now());
  }

  // ---------- painting ----------

  private paint(now: number): void {
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const intensity = auroraIntensity(this.level);
    if (intensity <= 0) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const t = this.reduced ? 0 : Math.max(0, (now - (this.startedAt || now)) / 1000);
    const levels = music.levels();
    const live = levels.live;
    this.smoothedBass = smooth(this.smoothedBass, live ? levels.bass : 0.12, 0.16, 0.05);
    this.smoothedEnergy = smooth(this.smoothedEnergy, live ? levels.energy : 0.18, 0.16, 0.05);

    // A slow, deterministic breath keeps the scene alive with no audio at all.
    const breath = 0.5 + 0.5 * Math.sin(t * 0.45);
    const energy = clamp01((live ? this.smoothedEnergy : 0.16) + breath * 0.1);
    const bass = clamp01(live ? this.smoothedBass : 0.1);
    const danger = this.danger ? 1.14 : 1;
    // Enhanced is deliberately a clear step above Subtle, but still behind the grid.
    const levelScale = this.level === 'enhanced' ? 1.35 : 1;
    const intensityScale = intensity * danger * levelScale;

    ctx.globalCompositeOperation = 'lighter';

    this.edgeWash(ctx, t, energy, bass, intensityScale);

    for (const ribbon of RIBBONS) {
      this.drawRibbon(ctx, ribbon, t, energy, intensityScale);
    }
    for (const ribbon of SIDE_RIBBONS) {
      this.drawSideRibbon(ctx, ribbon, t, energy, intensityScale);
    }

    ctx.globalCompositeOperation = 'source-over';

    if (now - this.lastDataset > 240 || !this.everPainted) {
      this.lastDataset = now;
      this.canvas.dataset.live = live ? '1' : '0';
      this.canvas.dataset.energy = energy.toFixed(2);
      this.canvas.dataset.level = this.level;
    }
    this.everPainted = true;
  }

  private edgeWash(
    ctx: CanvasRenderingContext2D,
    t: number,
    energy: number,
    bass: number,
    intensity: number,
  ): void {
    const { width: w, height: h } = this;
    const pulse = 0.86 + Math.sin(t * 0.32) * 0.08 + bass * 0.14;
    const glows: Array<{ x: number; y: number; r: number; color: RGB; a: number }> = [
      { x: -w * 0.06, y: h * 0.34, r: w * 0.62, color: TEAL, a: 0.1 },
      { x: w * 1.06, y: h * 0.62, r: w * 0.66, color: INDIGO, a: 0.11 },
      { x: w * 0.5, y: -h * 0.08, r: w * 0.6, color: BLUE, a: 0.065 },
      { x: w * 0.5, y: h * 1.06, r: w * 0.64, color: VIOLET, a: 0.085 },
    ];
    for (const glow of glows) {
      const gradient = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.r);
      const alpha = glow.a * intensity * pulse * (0.8 + energy * 0.5);
      gradient.addColorStop(0, rgba(glow.color, alpha));
      gradient.addColorStop(0.55, rgba(glow.color, alpha * 0.35));
      gradient.addColorStop(1, rgba(glow.color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawSideRibbon(
    ctx: CanvasRenderingContext2D,
    ribbon: SideRibbon,
    t: number,
    energy: number,
    intensity: number,
  ): void {
    const { width: w, height: h } = this;
    const drift = t * ribbon.speed * (this.danger ? 1.15 : 1) + ribbon.phase;
    const base = (ribbon.dir < 0 ? 0.035 : 0.965) * w;
    const amp = w * 0.05;
    const steps = 18;

    const path = (): void => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const y = p * h;
        const x =
          base +
          Math.sin(p * Math.PI * 2 * ribbon.freq + drift) * amp +
          Math.cos(p * Math.PI * 3.2 - drift * 0.7) * amp * 0.45;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };

    const alpha = ribbon.alpha * intensity * (0.75 + energy * 0.6);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, rgba(TEAL, 0));
    gradient.addColorStop(0.22, rgba(TEAL, alpha));
    gradient.addColorStop(0.7, rgba(ribbon.end, alpha * 0.85));
    gradient.addColorStop(1, rgba(ribbon.end, 0));
    ctx.strokeStyle = gradient;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.lineWidth = w * ribbon.width;
    ctx.globalAlpha = 0.5;
    path();
    ctx.stroke();

    ctx.lineWidth = Math.max(1, w * ribbon.width * 0.3);
    ctx.globalAlpha = 0.8;
    path();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawRibbon(
    ctx: CanvasRenderingContext2D,
    ribbon: Ribbon,
    t: number,
    energy: number,
    intensity: number,
  ): void {
    const { width: w, height: h } = this;
    const speed = ribbon.speed * (this.danger ? 1.15 : 1) * (0.85 + energy * 0.4);
    const drift = t * speed + ribbon.phase;
    const steps = 16;

    const path = (): void => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const x = p * w;
        // Most light hugs the horizontal edges; the middle stays calm.
        const edge = Math.pow(Math.abs(p - 0.5) * 2, 0.7);
        const y =
          h * ribbon.base +
          Math.sin(p * Math.PI * 2 * ribbon.freq + drift) * h * ribbon.amp * (0.55 + edge * 0.45) +
          Math.cos(p * Math.PI * 3.1 - drift * 0.6) * h * ribbon.amp * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };

    const alpha = ribbon.alpha * intensity * (0.72 + energy * 0.75) * (this.danger ? 1.12 : 1);
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, rgba(ribbon.left, 0));
    gradient.addColorStop(0.12, rgba(ribbon.left, alpha));
    gradient.addColorStop(0.5, rgba(ribbon.right, alpha * 0.72));
    gradient.addColorStop(0.88, rgba(ribbon.right, alpha));
    gradient.addColorStop(1, rgba(ribbon.right, 0));

    ctx.strokeStyle = gradient;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Wide halo, then a tighter core: soft without ctx.filter blur.
    ctx.lineWidth = h * ribbon.width;
    ctx.globalAlpha = 0.5;
    path();
    ctx.stroke();

    ctx.lineWidth = Math.max(1, h * ribbon.width * 0.32);
    ctx.globalAlpha = 0.85;
    path();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
