// ============= src/middleware/rateLimit.ts =============
/**
 * Rate Limiting Middleware
 * 
 * Prevents spam and abuse with configurable per-endpoint limits
 */

import rateLimitLib, { RateLimitRequestHandler } from 'express-rate-limit';

// ============= GLOBAL RATE LIMITERS =============

/**
 * @limiter onrampLimiter
 * @desc    For onramp payment initiation (high-value operations)
 * @limit   5 requests per 15 minutes per IP
 */
export const onrampLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes per IP
  message: {
    success: false,
    error: 'Too many onramp attempts. Please try again in 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skip: (req) => req.path.includes('/webhook'),
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise use IP
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @limiter apiLimiter
 * @desc    General rate limiter for standard API endpoints
 * @limit   30 requests per 1 minute per user/IP
 */
export const apiLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @limiter authLimiter
 * @desc    Strict rate limiter for authentication endpoints
 * @limit   10 requests per 15 minutes per IP
 */
export const authLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown'
});

// ============= OFFRAMP-SPECIFIC RATE LIMITERS =============

/**
 * @limiter getRateLimiter
 * @desc    For GET /api/offramp/rate endpoint
 * @limit   100 requests per 1 minute (public endpoint)
 */
export const getRateLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    error: 'Rate limit exceeded. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown'
});

/**
 * @limiter initiateOfframpLimiter
 * @desc    For POST /api/offramp/initiate
 * @limit   20 requests per 1 minute per user
 */
export const initiateOfframpLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 per minute per user
  message: {
    success: false,
    error: 'Too many offramp initiation attempts. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @limiter confirmTransferLimiter
 * @desc    For POST /api/offramp/confirm-transfer
 * @limit   30 requests per 1 minute per user
 */
export const confirmTransferLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 per minute per user
  message: {
    success: false,
    error: 'Too many transfer confirmations. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @limiter webhookLimiter
 * @desc    For POST /api/offramp/webhook/lenco
 * @limit   1000 requests per 1 minute (webhooks can retry)
 */
export const webhookLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // 1000 per minute (webhooks may retry)
  message: {
    success: false,
    error: 'Rate limit exceeded.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown'
});

/**
 * @limiter beneficiaryLimiter
 * @desc    For beneficiary endpoints
 * @limit   20 requests per 1 minute per user
 */
export const beneficiaryLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 per minute per user
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @limiter historyLimiter
 * @desc    For GET /api/offramp/history
 * @limit   50 requests per 1 minute per user
 */
export const historyLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // 50 per minute per user
  message: {
    success: false,
    error: 'Rate limit exceeded.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @limiter statusLimiter
 * @desc    For GET /api/offramp/status/:reference
 * @limit   100 requests per 1 minute per user
 */
export const statusLimiter: RateLimitRequestHandler = rateLimitLib({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 per minute per user
  message: {
    success: false,
    error: 'Rate limit exceeded.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'unknown';
  }
});

/**
 * @function createRateLimiter
 * @desc     Factory function to create custom rate limiters
 * 
 * @param    options: { windowMs, max, message?, keyGenerator? }
 * @return   RateLimitRequestHandler
 * 
 * Usage:
 * const customLimiter = createRateLimiter({
 *   windowMs: 60000,
 *   max: 50,
 *   message: 'Custom rate limit message'
 * });
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: any) => string;
}): RateLimitRequestHandler {
  return rateLimitLib({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      success: false,
      error: options.message || 'Rate limit exceeded.',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || ((req) => req.ip || 'unknown')
  });
}

// ============= EXPORTS =============

export default {
  onrampLimiter,
  apiLimiter,
  authLimiter,
  getRateLimiter,
  initiateOfframpLimiter,
  confirmTransferLimiter,
  webhookLimiter,
  beneficiaryLimiter,
  historyLimiter,
  statusLimiter,
  createRateLimiter
};