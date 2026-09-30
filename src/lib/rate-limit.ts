import { NextResponse } from "next/server";

export interface RateLimitOptions {
  /** Logical bucket name, e.g. "upload", "export", "ai". */
  bucket: string;
  /** Requests allowed within the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

/**
 * Storage-agnostic rate limiter interface. `hit` records one attempt for
 * `key` and returns whether it's allowed under `opts`, plus (on rejection)
 * how many seconds until the caller should retry. Swapping the backing store
 * (single-node in-memory → shared Redis for a multi-instance deployment) is a
 * one-line change in `getRateLimiter()` below — nothing else in the app
 * depends on which implementation is active.
 */
export interface RateLimiter {
  hit(key: string, opts: RateLimitOptions): Promise<{ allowed: boolean; retryAfterSec?: number }>;
}

/**
 * Single-node sliding-window limiter. Good enough for dev or a small
 * production deployment behind one server process — it does NOT coordinate
 * across multiple instances. That's exactly what RedisRateLimiter is for.
 */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, number[]>();

  constructor() {
    // Periodically drop buckets with no recent activity so this doesn't grow
    // unbounded for a long-running process.
    setInterval(
      () => {
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [key, hits] of this.buckets) {
          if (!hits.length || hits[hits.length - 1] < cutoff) this.buckets.delete(key);
        }
      },
      5 * 60 * 1000,
    ).unref?.();
  }

  async hit(key: string, opts: RateLimitOptions) {
    const bucketKey = `${opts.bucket}:${key}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const hits = (this.buckets.get(bucketKey) ?? []).filter((t) => t > windowStart);
    if (hits.length >= opts.limit) {
      const retryAfterSec = Math.ceil((hits[0] + opts.windowMs - now) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }

    hits.push(now);
    this.buckets.set(bucketKey, hits);
    return { allowed: true };
  }
}

/**
 * Shared-store limiter for multi-instance deployments — same sliding-window
 * algorithm as MemoryRateLimiter, implemented with Redis sorted sets (ZADD +
 * ZREMRANGEBYSCORE + ZCARD) so every server process sees the same counts.
 * Requires the optional `ioredis` package and REDIS_URL:
 *
 *   npm install ioredis
 *
 * Not wired up by default — see getRateLimiter() below. Deliberately left as
 * a real, runnable implementation rather than a TODO stub so switching
 * providers in production is a config change, not a rewrite.
 */
/** Minimal shape we actually use from ioredis — avoids depending on its types when the package isn't installed. */
interface RedisLike {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number, withScores: "WITHSCORES"): Promise<string[]>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export class RedisRateLimiter implements RateLimiter {
  private clientPromise: Promise<RedisLike> | null = null;

  constructor(private redisUrl: string) {}

  private async client(): Promise<RedisLike> {
    if (!this.clientPromise) {
      this.clientPromise = importOptional<{ default: new (url: string) => RedisLike }>(REDIS_SPECIFIER).then(
        (mod) => new mod.default(this.redisUrl),
      );
    }
    return this.clientPromise;
  }

  async hit(key: string, opts: RateLimitOptions) {
    const redis = await this.client();
    const bucketKey = `ratelimit:${opts.bucket}:${key}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    await redis.zremrangebyscore(bucketKey, 0, windowStart);
    const count = await redis.zcard(bucketKey);
    if (count >= opts.limit) {
      const oldest = await redis.zrange(bucketKey, 0, 0, "WITHSCORES");
      const oldestTs = Array.isArray(oldest) && oldest[1] ? Number(oldest[1]) : now;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldestTs + opts.windowMs - now) / 1000)) };
    }

    await redis.zadd(bucketKey, now, `${now}:${Math.random()}`);
    await redis.expire(bucketKey, Math.ceil(opts.windowMs / 1000));
    return { allowed: true };
  }
}

// Built the same way as the optional S3 driver (lib/storage/s3.ts) — a
// runtime-built specifier so bundlers don't try to resolve `ioredis` at build
// time when it isn't installed (which is the point of it being optional).
const REDIS_SPECIFIER = "ioredis";
function importOptional<T>(specifier: string): Promise<T> {
  return import(/* webpackIgnore: true */ specifier) as Promise<T>;
}

let limiter: RateLimiter | null = null;

/** Selects the active limiter: Redis when REDIS_URL is set (multi-instance-safe), otherwise in-memory (single-node). */
export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  limiter = process.env.REDIS_URL ? new RedisRateLimiter(process.env.REDIS_URL) : new MemoryRateLimiter();
  return limiter;
}

/** Best-effort client IP for rate-limiting unauthenticated endpoints (e.g. registration), where there's no userId yet to key on. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Convenience wrapper used by API routes: returns null if allowed, or a ready-to-return 429 NextResponse if not. */
export async function checkRateLimit(key: string, opts: RateLimitOptions): Promise<NextResponse | null> {
  const result = await getRateLimiter().hit(key, opts);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "You're doing that too often. Please wait a moment and try again." },
    { status: 429, headers: result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : undefined },
  );
}
