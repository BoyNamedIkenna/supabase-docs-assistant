// Allows each key (for example an IP address) at most `max` requests per `windowMs`.
export function createLimiter(opts: { max: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now
  const hits = new Map<string, number[]>()

  return {
    hit(key: string): { allowed: boolean; retryAfterSec: number } {
      const t = now()
      if (hits.size > 5000) {
        // tidy up: forget keys with no recent requests
        for (const [k, times] of hits) if (times.every((x) => t - x >= opts.windowMs)) hits.delete(k)
      }
      const recent = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs)
      if (recent.length >= opts.max) {
        hits.set(key, recent)
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + opts.windowMs - t) / 1000)) }
      }
      recent.push(t)
      hits.set(key, recent)
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}