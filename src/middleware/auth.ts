// ============= src/middleware/auth.ts =============
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

// Extend Express Request type to include user
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

/**
 * Protect routes - verify JWT token
 */
export const protect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
        error: 'Not authorized to access this route. Please provide a valid token.'
      });
      return;
    }

    try {
      // Verify token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key'
      ) as JWTPayload;

      // Check if user still exists
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        res.status(401).json({
          success: false,
          error: 'User no longer exists'
        });
        return;
      }

      // Add user to request object
      req.user = {
        id: user._id.toString()
      };

      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Not authorized to access this route. Invalid token.'
      });
      return;
    }
  } catch (error: any) {
    console.error('❌ Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during authentication'
    });
  }
};

/**
 * Optional auth - doesn't fail if no token, but adds user if valid token exists
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    let token: string | undefined;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key'
      ) as JWTPayload;

      const user = await User.findById(decoded.id).select('-password');

      if (user) {
        req.user = {
          id: user._id.toString()
        };
      }
    } catch (error) {
      // Invalid token, but we continue anyway
      console.log('Invalid token in optional auth, continuing...');
    }

    next();
  } catch (error: any) {
    console.error('❌ Optional auth middleware error:', error);
    next();
  }
};