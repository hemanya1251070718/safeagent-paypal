import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const WINDOW_MS = 60 * 1000; // 1 minute sliding window
const MAX_REQUESTS = 120; // 120 requests per minute
const clients = new Map<string, RateLimitRecord>();

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  const record = clients.get(ip);
  if (!record || now > record.resetTime) {
    clients.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', MAX_REQUESTS - 1);
    return next();
  }

  record.count++;
  const remaining = Math.max(0, MAX_REQUESTS - record.count);
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (record.count > MAX_REQUESTS) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP. Gateway rate limit exceeded.'
    });
  }

  next();
}

