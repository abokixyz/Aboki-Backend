// ============= src/middleware/requirePasskey.ts =============
/**
 * Middleware to require passkey for sensitive operations
 * 
 * Usage:
 * router.post('/transfer/send', protect, requirePasskey, controller);
 * router.post('/offramp/initiate', protect, requirePasskey, controller);
 */

import { Request, Response, NextFunction } from 'express';
import User from '../models/User';

/**
 * @middleware requirePasskey
 * @desc      Ensure user has passkey registered
 * @access    Private (must be authenticated first)
 * 
 * Usage:
 * router.post('/sensitive-endpoint', protect, requirePasskey, controller);
 * 
 * If user doesn't have passkey, returns:
 * {
 *   success: false,
 *   error: 'Passkey authentication required for this operation',
 *   code: 'PASSKEY_REQUIRED',
 *   details: {
 *     message: 'You need to set up a passkey to use this feature',
 *     setupUrl: '/dashboard/security/passkey-setup',
 *     action: 'Please set up biometric authentication first'
 *   }
 * }
 */
export const requirePasskey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
        code: 'NOT_AUTHENTICATED'
      });
      return;
    }

    // Fetch user with passkey field (it's hidden by default)
    const user = await User.findById(userId).select('+passkey');

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // Check if passkey exists
    if (!user.passkey || !user.passkey.credentialID) {
      console.warn('⚠️ User attempted sensitive operation without passkey:', {
        userId,
        email: user.email,
        endpoint: req.path,
        method: req.method
      });
      
      res.status(400).json({
        success: false,
        error: 'Passkey authentication required for this operation',
        code: 'PASSKEY_REQUIRED',
        details: {
          message: 'You need to set up a passkey to use this feature',
          setupUrl: '/dashboard/security/passkey-setup',
          action: 'Please set up biometric authentication first'
        }
      });
      return;
    }

    // Passkey exists, allow request to proceed
    console.log('✅ Passkey verified for user:', user.email);
    next();
  } catch (error: any) {
    console.error('❌ Passkey requirement check error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during passkey verification',
      code: 'PASSKEY_CHECK_ERROR'
    });
  }
};

export default requirePasskey;