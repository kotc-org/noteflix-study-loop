import type { NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import type { AppConfig } from "../config.js";
import { hashOpaque } from "../security/crypto.js";
import { uidFromAuthInfo } from "../oauth/provider.js";

export class FirestoreFixedWindowRateLimiter {
  private readonly collection: string;

  constructor(
    private readonly db: Firestore,
    config: AppConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.collection = `${config.collectionPrefix}_rate_limits`;
  }

  async consume(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = this.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const ref = this.db.collection(this.collection).doc(hashOpaque(`${key}:${windowStartMs}`));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const count = snapshot.exists ? Number(snapshot.data()?.count ?? 0) + 1 : 1;
      if (snapshot.exists) transaction.update(ref, { count, updatedAtMs: now });
      else {
        transaction.create(ref, {
          keyHash: hashOpaque(key),
          windowStartMs,
          count,
          createdAtMs: now,
          deleteAfter: Timestamp.fromMillis(windowStartMs + windowMs + 24 * 60 * 60 * 1000),
        });
      }
      return {
        allowed: count <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000)),
      };
    });
  }
}

export function persistentMcpRateLimit(
  limiter: FirestoreFixedWindowRateLimiter,
  config: AppConfig,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = uidFromAuthInfo(req.auth);
      const result = await limiter.consume(`mcp:${uid}`, config.mcpRateLimitPerMinute, 60_000);
      res.set("X-RateLimit-Limit", String(config.mcpRateLimitPerMinute));
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfterSeconds));
        return res.status(429).json({ error: "rate_limit_exceeded", error_description: "Too many MCP requests." });
      }
      return next();
    } catch {
      return res.status(500).json({ error: "server_error", error_description: "Rate limit validation failed." });
    }
  };
}
