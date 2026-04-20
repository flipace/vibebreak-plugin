import { IDLE_PAUSE_MS } from "./shared.js";

export interface TokenMeterOptions {
  threshold: number;
  onTrigger: () => void;
  /** Override idle window in tests. Defaults to IDLE_PAUSE_MS. */
  idlePauseMs?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

/**
 * Accumulates tokens and fires `onTrigger` once when the running total
 * crosses `threshold`. Implements idle protection: if more than
 * `idlePauseMs` elapsed since the last `add()` call, the gap is treated
 * as a pause (we don't penalize the user for being in a meeting), so
 * the new delta resumes counting without inflating the bucket.
 */
export class TokenMeter {
  private threshold: number;
  private readonly onTrigger: () => void;
  private readonly idlePauseMs: number;
  private readonly clock: () => number;

  private acc = 0;
  private lastEmit = 0;
  private fired = false;
  private disposed = false;

  constructor(opts: TokenMeterOptions) {
    this.threshold = opts.threshold;
    this.onTrigger = opts.onTrigger;
    this.idlePauseMs = opts.idlePauseMs ?? IDLE_PAUSE_MS;
    this.clock = opts.now ?? (() => Date.now());
  }

  get total(): number {
    return this.acc;
  }

  get triggered(): boolean {
    return this.fired;
  }

  get currentThreshold(): number {
    return this.threshold;
  }

  /**
   * Update the threshold mid-flight (e.g. user changed it from the mobile
   * app). Preserves the running accumulator so the user doesn't lose
   * progress they've already racked up. If the new threshold is already
   * crossed by the current acc, fire immediately.
   */
  setThreshold(n: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(n) || n <= 0 || n === this.threshold) return;
    this.threshold = n;
    if (!this.fired && this.acc >= this.threshold) {
      this.fired = true;
      try {
        this.onTrigger();
      } catch {
        // Caller's problem - swallow so the meter stays usable.
      }
    }
  }

  add(n: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(n) || n <= 0) return;
    const now = this.clock();
    if (this.lastEmit !== 0 && now - this.lastEmit > this.idlePauseMs) {
      // Idle pause: drop the gap, just resume from current acc.
      this.lastEmit = now;
      this.acc += n;
    } else {
      this.lastEmit = now;
      this.acc += n;
    }
    if (!this.fired && this.acc >= this.threshold) {
      this.fired = true;
      try {
        this.onTrigger();
      } catch {
        // Caller's problem - swallow so the meter stays usable.
      }
    }
  }

  /** Reset accumulator + trigger flag (e.g. after a gate is unlocked). */
  reset(): void {
    this.acc = 0;
    this.fired = false;
    this.lastEmit = 0;
  }

  dispose(): void {
    this.disposed = true;
  }
}
