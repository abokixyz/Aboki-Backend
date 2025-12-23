// ============= src/routes/authRoutes.ts (COMPLETE - FIXED) =============
import { Router, Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse
} from '@simplewebauthn/server';
import crypto from 'crypto';
import {
  signup,
  login,
  getMe,
  logout
} from '../controllers/authController';
import { protect } from '../middleware/auth';
import User from '../models/User';

const router = Router();

// ============= HELPER FUNCTIONS =============

const extractRpId = (origin?: string): string => {
  try {
    const url = new URL(origin || process.env.FRONTEND_URL || 'http://localhost:3000');
    return url.hostname;
  } catch {
    return 'localhost';
  }
};

const getOrigin = (origin?: string): string => {
  return origin || process.env.FRONTEND_URL || 'http://localhost:3000';
};

// ============= PUBLIC AUTH ROUTES =============

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Register with PASSKEY (Passwordless)
 *     description: Create a new account with passkey authentication
 *     tags: [Authentication]
 */
router.post('/signup', signup);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with PASSKEY (Passwordless)
 *     description: Authenticate user with passkey
 *     tags: [Authentication]
 */
router.post('/login', login);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     description: Get the profile of the currently authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.get('/me', protect, getMe);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     description: Logout the current user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.post('/logout', protect, logout);

// ============= PASSKEY REGISTRATION FOR NEW USERS =============

/**
 * @swagger
 * /api/auth/passkey/register-options:
 *   post:
 *     summary: Get passkey registration challenge (NEW USER SIGNUP)
 *     description: |
 *       Step 1 for new user signup with passkey.
 *       Returns a challenge for device to create a passkey.
 *     tags: [Authentication - Passkey Registration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               name:
 *                 type: string
 */
router.post('/passkey/register-options', async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;

    if (!email || !name) {
      res.status(400).json({
        success: false,
        error: 'Please provide email and name'
      });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
      return;
    }

    const rpId = extractRpId(req.headers.origin);
    const origin = getOrigin(req.headers.origin);

    console.log('🔐 Generating passkey registration options:', {
      email,
      rpId,
      origin
    });

    // Generate registration options
    const options = await generateRegistrationOptions({
      rpID: rpId,
      rpName: 'Aboki',
      userID: new TextEncoder().encode(email), // ✅ FIXED: Convert string to Uint8Array
      userName: email,
      userDisplayName: name,
      attestationType: 'direct',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60000,
      challenge: crypto.randomBytes(32)
    });

    // Convert challenge to base64url for frontend
    const challengeBase64Url = Buffer.from(options.challenge).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    res.status(200).json({
      success: true,
      data: {
        options,
        challenge: challengeBase64Url,
        rpId,
        origin
      }
    });
  } catch (error: any) {
    console.error('❌ Error generating registration options:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate registration options'
    });
  }
});

// ============= PASSKEY SETUP FOR EXISTING USERS =============

/**
 * @swagger
 * /api/auth/passkey/setup-options:
 *   post:
 *     summary: Get passkey setup challenge (EXISTING USER)
 *     description: |
 *       ⭐ FOR EXISTING USERS WHO NEED TO ADD PASSKEY ⭐
 *       Step 1 for existing user to add passkey to their account.
 *     tags: [Authentication - Passkey Setup]
 *     security:
 *       - bearerAuth: []
 */
router.post('/passkey/setup-options', protect, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const user = await User.findById(userId).select('+passkey');
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    // Check if user already has passkey
    if (user.passkey && user.passkey.credentialID) {
      res.status(400).json({
        success: false,
        error: 'You already have a passkey registered. Use /api/auth/passkey/remove to change it.'
      });
      return;
    }

    const rpId = extractRpId(req.headers.origin);
    const origin = getOrigin(req.headers.origin);

    console.log('🔐 Generating passkey setup options for user:', user.email);

    const options = await generateRegistrationOptions({
      rpID: rpId,
      rpName: 'Aboki',
      userID: new TextEncoder().encode(user._id.toString()), // ✅ FIXED: Convert string to Uint8Array
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'direct',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60000,
      challenge: crypto.randomBytes(32)
    });

    const challengeBase64Url = Buffer.from(options.challenge).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    res.status(200).json({
      success: true,
      data: {
        options,
        challenge: challengeBase64Url,
        rpId,
        origin
      }
    });
  } catch (error: any) {
    console.error('❌ Error generating setup options:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate setup options'
    });
  }
});

/**
 * @swagger
 * /api/auth/passkey/setup:
 *   post:
 *     summary: Add passkey to existing user account
 *     description: |
 *       ⭐ FOR EXISTING USERS WHO NEED TO ADD PASSKEY ⭐
 *       Step 2: After user creates passkey with navigator.credentials.create()
 *     tags: [Authentication - Passkey Setup]
 *     security:
 *       - bearerAuth: []
 */
router.post('/passkey/setup', protect, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { passkey } = req.body;

    if (!passkey) {
      res.status(400).json({
        success: false,
        error: 'No passkey credential provided'
      });
      return;
    }

    const user = await User.findById(userId).select('+passkey');
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    // Check if user already has passkey
    if (user.passkey && user.passkey.credentialID) {
      res.status(400).json({
        success: false,
        error: 'You already have a passkey. Remove the existing one first.'
      });
      return;
    }

    const rpId = extractRpId(req.headers.origin);
    const origin = getOrigin(req.headers.origin);

    console.log('🔐 Verifying passkey setup for:', user.email);

    // Verify the passkey credential
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: passkey,
        expectedChallenge: passkey.challenge || 'temp-challenge',
        expectedOrigin: origin,
        expectedRPID: rpId,
      });
    } catch (error: any) {
      console.error('❌ Passkey verification failed:', error);
      res.status(400).json({
        success: false,
        error: 'Passkey verification failed: ' + error.message
      });
      return;
    }

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({
        success: false,
        error: 'Passkey verification failed'
      });
      return;
    }

    const { registrationInfo } = verification;
    const { credential } = registrationInfo;

    // Save passkey to user
    user.passkey = {
      credentialID: Buffer.from(credential.id),
      credentialPublicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      credentialDeviceType: registrationInfo.credentialDeviceType,
      credentialBackedUp: registrationInfo.credentialBackedUp,
    };

    await user.save();

    console.log('✅ Passkey added successfully for:', user.email);

    res.status(200).json({
      success: true,
      message: 'Passkey added successfully. You can now verify transactions.',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          hasPasskey: true
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error setting up passkey:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to setup passkey'
    });
  }
});

/**
 * @swagger
 * /api/auth/passkey/remove:
 *   post:
 *     summary: Remove current passkey
 *     description: Remove existing passkey from user account
 *     tags: [Authentication - Passkey Setup]
 *     security:
 *       - bearerAuth: []
 */
router.post('/passkey/remove', protect, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const user = await User.findById(userId).select('+passkey');
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    if (!user.passkey || !user.passkey.credentialID) {
      res.status(400).json({
        success: false,
        error: 'No passkey to remove'
      });
      return;
    }

    // Remove passkey
    user.passkey = undefined;
    await user.save();

    console.log('✅ Passkey removed for:', user.email);

    res.status(200).json({
      success: true,
      message: 'Passkey removed. You can setup a new one anytime.'
    });
  } catch (error: any) {
    console.error('❌ Error removing passkey:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to remove passkey'
    });
  }
});

export default router;