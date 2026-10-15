/**
 * A token bucket, so we never spend more of Pixabay's quota than we mean to.
 *
 * Their documented ceiling is 100 requests per 60 seconds; we run under it on
 * purpose and leave headroom, because going over gets the key throttled and the
 * feature is not worth risking that for.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMinute: number = capacity,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const at = this.now();
    const elapsed = at - this.lastRefill;
    if (elapsed <= 0) return;

    const gained = (elapsed / 60_000) * this.refillPerMinute;
    this.tokens = Math.min(this.capacity, this.tokens + gained);
    this.lastRefill = at;
  }

  /** Spends a token if one is available. Never blocks — callers skip instead. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Pixabay reports what is actually left in `X-RateLimit-Remaining`. If their
   * count is lower than ours — another process sharing the key, say — believe
   * theirs.
   */
  syncRemaining(remaining: number): void {
    this.refill();
    if (Number.isFinite(remaining) && remaining >= 0) {
      this.tokens = Math.min(this.tokens, remaining);
    }
  }

  /** Test helper. */
  drain(): void {
    this.refill();
    this.tokens = 0;
  }
}
