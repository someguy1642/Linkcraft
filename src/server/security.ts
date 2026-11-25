import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Ephemeral fallback signing key locally; deployment-scoped fallback on Vercel if CSRF_SECRET is unset
const CSRF_SECRET =
  process.env.CSRF_SECRET ||
  (process.env.VERCEL
    ? crypto
        .createHmac('sha256', process.env.VERCEL_PROJECT_ID || 'linkcraft-vercel-project')
        .update(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'linkcraft')
        .digest('hex')
    : crypto.randomBytes(32).toString('hex'));

/**
 * Hashes a user-supplied link password with scrypt and a random 16-byte salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Constant-time verification of a password against a stored scrypt hash.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

interface RateBucket {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private buckets = new Map<string, RateBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  public check(key: string, nowMs = Date.now()): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const cutoff = nowMs - this.windowMs;
    const bucket = this.buckets.get(key) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

    if (bucket.timestamps.length >= this.maxRequests) {
      const oldest = bucket.timestamps[0];
      const retryAfterMs = Math.max(1000, oldest + this.windowMs - nowMs);
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    bucket.timestamps.push(nowMs);
    this.buckets.set(key, bucket);

    // Opportunistic cleanup to keep memory bounded
    if (this.buckets.size > 5000) {
      for (const [k, b] of this.buckets.entries()) {
        if (b.timestamps.length === 0 || b.timestamps[b.timestamps.length - 1] <= cutoff) {
          this.buckets.delete(k);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - bucket.timestamps.length),
      retryAfterSeconds: 0,
    };
  }
}

// 100 API requests / min per IP or API key
export const apiRateLimiter = new SlidingWindowRateLimiter(100, 60_000);
// 20 link creations / min per IP
export const linkCreateRateLimiter = new SlidingWindowRateLimiter(20, 60_000);
// 5 password attempts / min per IP + short code
export const passwordUnlockRateLimiter = new SlidingWindowRateLimiter(5, 60_000);

export function apiRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.header('x-api-key');
  const key = apiKey ? `key:${apiKey.slice(0, 64)}` : `ip:${getClientIp(req)}`;
  const result = apiRateLimiter.check(key);

  res.setHeader('X-RateLimit-Limit', '100');
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many API requests. Please wait a moment before retrying.',
      retryAfterSeconds: result.retryAfterSeconds,
    });
    return;
  }
  next();
}

export function issueCsrfToken(): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', CSRF_SECRET).update(nonce).digest('hex');
  return `${nonce}.${sig}`;
}

function verifySignedCsrfToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  if (!nonce || !sig) return false;
  try {
    const expected = crypto.createHmac('sha256', CSRF_SECRET).update(nonce).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Cookie-free CSRF protection on state-changing API routes.
 * Validates a stateless HMAC-signed X-CSRF-Token header plus X-Requested-With / Origin checks.
 */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  // Stateless API key integrations and Stripe webhook (verified via Stripe-Signature) bypass browser CSRF
  if (req.header('x-api-key') || req.path === '/billing/webhook') {
    next();
    return;
  }

  const headerToken = req.header('x-csrf-token') || '';
  if (!headerToken || !verifySignedCsrfToken(headerToken)) {
    res.status(403).json({ error: 'Invalid or missing CSRF token. Please refresh and try again.' });
    return;
  }

  next();
}

/**
 * Origin-aware CORS middleware.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowedEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === host;
    } catch {
      sameHost = false;
    }

    if (sameHost || allowedEnv.includes(origin) || origin.startsWith('http://localhost:')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-CSRF-Token, X-API-Key, X-Requested-With',
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Sets secure HTTP headers across API and HTML responses.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.path.startsWith('/api/') || req.path === '/openapi.json') {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  } else {
    // Allow embedding in AI Studio preview iframe, Firebase Google Auth, and external ad network scripts/iframes
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' ws: wss: https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https:",
        "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com",
      ].join('; '),
    );
  }

  next();
}
