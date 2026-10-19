/**
 * Seeded pseudo-random numbers. The same seed always yields the same sequence,
 * so a piece can be shared as a URL and reproduced in tests.
 */

/** Hashes any string to a 32-bit unsigned integer (cyrb53, folded to 32 bits). */
export function hashSeed(seed: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export class Random {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  }

  /** Uniform float in [0, 1) — mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() from empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks one item with probability proportional to its weight. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const weights = items.map((item) => Math.max(0, weight(item)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Orders items randomly, heavier weights tending to come first (Efraimidis–Spirakis). */
  weightedOrder<T>(items: readonly T[], weight: (item: T) => number): T[] {
    return items
      .map((item) => {
        const w = Math.max(1e-9, weight(item));
        return { item, key: Math.pow(this.next(), 1 / w) };
      })
      .sort((a, b) => b.key - a.key)
      .map((e) => e.item);
  }
}

/** A short random seed for a fresh piece, e.g. "k3x9qa". Not deterministic: uses crypto. */
export function freshSeed(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0].toString(36).padStart(6, '0').slice(-6);
}
