// ============= src/middlewares/rateLimitMiddleware.ts =============
/**
 * Rate Limiting Middleware
 * 
 * General purpose rate limiter for API endpoints
 * Can be customized per route as needed
 * 
 * Handles IPv6 addresses properly
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request } from 'express';

// ============= HELPER FUNCTION =============

/**
 * Get safe key for rate limiter (handles IPv6 properly)
 * Prevents "ERR_ERL_KEY_GEN_IPV6" error
 */
function getSafeKey(req: Request): string {
  // Prefer user ID if authenticated
  if ((req as any).user?.id) {
    return (req as any).user.id;
  }
  
  // Get IP address - try multiple sources
  let ip: string | undefined;
  
  // Try req.ip first (most reliable)
  if (req.ip) {
    ip = req.ip;
  }
  // Try connection.remoteAddress
  else if ((req.connection as any)?.remoteAddress) {
    ip = (req.connection as any).remoteAddress;
  }
  // Try socket.remoteAddress
  else if ((req.socket as any)?.remoteAddress) {
    ip = (req.socket as any).remoteAddress;
  }
  // Fallback
  else {
    ip = 'unknown';
  }
  
  // Handle IPv6 addresses
  if (ip && typeof ip === 'string') {
    // Remove IPv4 mapped prefix (::ffff:192.0.2.1 -> 192.0.2.1)
    ip = ip.replace(/^::ffff:/, '');
    
    // Remove IPv6 scope ID (%eth0)
    ip = ip.split('%')[0];
    
    // If still IPv6 (contains colons), convert to safe format
    if (ip.includes(':')) {
      // Replace colons and truncate to 20 chars for key safety
      return `ipv6_${ip.replace(/:/g, '_').slice(0, 20)}`;
    }
  }
  
  return ip || 'unknown';
}

// ============= DEFAULT RATE LIMITER =============

/**
 * Default rate limiter - 30 requests per minute per user/IP
 */
const rateLimitMiddleware: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  keyGenerator: (req) => getSafeKey(req as Request)
});

// ============= SPECIFIC RATE LIMITERS =============

/**
 * Rate limiter for public endpoints
 * 100 requests per minute per IP
 */
export const publicLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    error: 'Rate limit exceeded. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getSafeKey(req as Request)
});

/**
 * Strict rate limiter for high-value operations (offramp, onramp)
 * 20 requests per minute per user
 */
export const strictLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per user
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getSafeKey(req as Request)
});

/**
 * Webhook rate limiter
 * 1000 requests per minute (webhooks may retry)
 */
export const webhookLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // 1000 per minute
  message: {
    success: false,
    error: 'Rate limit exceeded.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getSafeKey(req as Request)
});

/**
 * Create custom rate limiter
 * @param options - Configuration options
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      success: false,
      error: options.message || 'Rate limit exceeded.',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getSafeKey(req as Request)
  });
}

// ============= EXPORTS =============

export default rateLimitMiddleware;