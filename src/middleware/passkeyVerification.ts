// ============= src/middleware/passkeyVerification.ts =============
/**
 * Middleware: Verify passkey verification token
 * Checks if the X-Passkey-Verified-Token header contains a valid JWT token
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface PasskeyVerificationData {
  transactionId: string;
  userId: string;
  verified: boolean;
  type: string;
  transaction?: {
    type: 'send' | 'withdraw';
    amount: number;
    recipient: string;
  };
  iat?: number;
  exp?: number;
}

/**
 * Verify passkey token from X-Passkey-Verified-Token header
 * 
 * Sets on request:
 * - (req as any).passkeyVerified: boolean
 * - (req as any).passkeyData: PasskeyVerificationData
 * 
 * Usage: Use for transaction endpoints that require passkey verification
 */
export const verifyPasskeyToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const token = req.headers['x-passkey-verified-token'] as string;

    console.log('🔐 Checking passkey verification token:', {
      hasToken: !!token,
      header: 'X-Passkey-Verified-Token',
      endpoint: req.path,
      method: req.method
    });

    if (!token) {
      // Token not provided - mark as not verified
      console.warn('⚠️ No passkey token provided');
      (req as any).passkeyVerified = false;
      (req as any).passkeyData = null;
      next();
      return;
    }

    // Verify the token signature and expiration
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    ) as PasskeyVerificationData;

    if (decoded.verified && decoded.type === 'passkey_transaction_verification') {
      (req as any).passkeyVerified = true;
      (req as any).passkeyData = decoded;

      console.log('✅ Passkey token verified:', {
        transactionId: decoded.transactionId,
        userId: decoded.userId,
        transactionType: decoded.transaction?.type,
        amount: decoded.transaction?.amount,
        expiresIn: decoded.exp ? Math.round((decoded.exp * 1000 - Date.now()) / 1000) + 's' : 'unknown'
      });

      next();
    } else {
      console.warn('⚠️ Invalid passkey token - verification flag not set');
      (req as any).passkeyVerified = false;
      (req as any).passkeyData = null;
      next();
    }

  } catch (error: any) {
    console.warn('⚠️ Passkey token validation failed:', {
      error: error.message,
      name: error.name
    });

    // Token is invalid or expired - mark as not verified
    (req as any).passkeyVerified = false;
    (req as any).passkeyData = null;

    // Don't fail the request - let the controller decide if it's required
    next();
  }
};

/**
 * Require passkey verification for a route
 * Use this middleware after verifyPasskeyToken to enforce verification
 * 
 * Usage:
 * router.post('/endpoint', protect, verifyPasskeyToken, requirePasskeyVerification, controller)
 */
export const requirePasskeyVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const passkeyVerified = (req as any).passkeyVerified;

  if (!passkeyVerified) {
    console.error('❌ Passkey verification required but not provided');

    res.status(401).json({
      success: false,
      error: 'Transaction verification required',
      code: 'PASSKEY_VERIFICATION_REQUIRED',
      message: 'This transaction requires passkey (biometric) verification for security',
      hint: 'Complete passkey verification before proceeding with this transaction'
    });
    return;
  }

  // Verification is valid - proceed
  console.log('✅ Passkey verification confirmed - proceeding with request');
  next();
};

/**
 * Optional passkey verification checker
 * Logs if verification is present but doesn't fail if missing
 */
export const checkPasskeyVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const passkeyVerified = (req as any).passkeyVerified;

  if (passkeyVerified) {
    console.log('ℹ️ Request includes valid passkey verification');
  } else {
    console.log('ℹ️ Request does not include passkey verification');
  }

  next();
};

export default verifyPasskeyToken;