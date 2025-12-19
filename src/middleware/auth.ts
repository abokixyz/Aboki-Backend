// ============= src/middleware/auth.ts =============
/**
 * Authentication Middleware
 * 
 * Verify JWT tokens and attach user to request
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

// ============= TYPE EXTENSIONS =============

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };
    }
  }
}

interface JWTPayload {
  id: string;
  iat: number;
  exp: number;
}

// ============= CONSTANTS =============

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// ============= MIDDLEWARE =============

/**
 * @middleware authMiddleware
 * @desc      Protect routes - verify JWT token
 * @access    Private
 * 
 * Usage:
 * router.post('/protected-endpoint', authMiddleware, controller);
 * 
 * Checks for Bearer token in Authorization header
 * Verifies token validity and user existence
 * Attaches user to request.user
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Make sure token exists
    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Not authorized to access this route. Please provide a valid token.',
        code: 'NO_TOKEN'
      });
      return;
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;

      // Check if user still exists
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        res.status(401).json({
          success: false,
          error: 'User no longer exists',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      // Attach user to request
      req.user = {
        id: user._id.toString()
      };

      next();
    } catch (error: any) {
      let errorMessage = 'Invalid token.';
      let errorCode = 'INVALID_TOKEN';

      if (error.name === 'TokenExpiredError') {
        errorMessage = 'Token has expired.';
        errorCode = 'TOKEN_EXPIRED';
      } else if (error.name === 'JsonWebTokenError') {
        errorMessage = 'Malformed token.';
        errorCode = 'MALFORMED_TOKEN';
      }

      res.status(401).json({
        success: false,
        error: errorMessage,
        code: errorCode
      });
      return;
    }
  } catch (error: any) {
    console.error('❌ Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during authentication',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * @middleware optionalAuth
 * @desc      Optional authentication - doesn't fail without token
 * @access    Public (but adds user if valid token exists)
 * 
 * Usage:
 * router.get('/public-endpoint', optionalAuth, controller);
 * 
 * If valid token exists, attaches user to request
 * If no token or invalid token, continues without user
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;

      const user = await User.findById(decoded.id).select('-password');

      if (user) {
        req.user = {
          id: user._id.toString()
        };
      }
    } catch (error: any) {
      // Invalid token, but we continue anyway
      console.log('⚠️ Invalid token in optional auth, continuing without user');
    }

    next();
  } catch (error: any) {
    console.error('❌ Optional auth middleware error:', error);
    next();
  }
};

/**
 * @middleware protect (alias for authMiddleware)
 * @desc      Alias for authMiddleware for backwards compatibility
 */
export const protect = authMiddleware;

export default {
  authMiddleware,
  optionalAuth,
  protect
};