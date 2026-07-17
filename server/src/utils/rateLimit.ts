import { type NextFunction, type Request, type Response } from "express";
import { clientKey } from "./net";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window limiter, in memory. Spectre runs as a single process per
 * deployment, so a shared store would be machinery without a purpose; if the
 * server is ever horizontally scaled this needs to move to the device store.
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientKey(req);
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: options.message ?? "too many requests",
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    next();
  };
}
