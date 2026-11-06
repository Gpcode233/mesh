import { sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { rateLimits } from "@/lib/db/schema"

/** Fixed-window limiter. The upsert is atomic, so concurrent requests cannot under-count. */
export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const windowFloor = now - windowMs
  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} <= ${windowFloor} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= ${windowFloor} THEN ${now} ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart })
  return {
    allowed: row.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((row.windowStart + windowMs - now) / 1000)),
  }
}

export function limitFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}
