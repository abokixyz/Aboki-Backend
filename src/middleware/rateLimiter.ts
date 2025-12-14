// ============= src/middleware/rateLimiter.ts =============
import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for onramp initialization
 * Prevents spam and abuse
 */
export const onrampLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes per IP
  message: {
    success: false,
    error: 'Too many onramp attempts. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for webhook endpoint
  skip: (req) => req.path.includes('/webhook')
});

/**
 * Stricter rate limiter for general API endpoints
 */
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: 'Too many requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Very strict rate limiter for auth endpoints
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

export default {
  onrampLimiter,
  apiLimiter,
  authLimiter
};