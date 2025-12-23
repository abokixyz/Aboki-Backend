// ============= src/controllers/authController.ts (FIXED - COMPLETE) =============
import { Request, Response } from 'express';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import crypto from 'crypto';

// ============= HELPER FUNCTIONS =============

/**
 * Extract RPID from request origin
 */
function extractRpIdFromOrigin(origin: string | undefined): string {
  if (!origin) {
    return process.env.RPID_DOMAIN || 'localhost';
  }

  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return process.env.RPID_DOMAIN || 'localhost';
  }
}

/**
 * Get expected origin for verification
 */
function getExpectedOrigin(origin: string | undefined): string {
  return origin || process.env.FRONTEND_URL || 'http://localhost:3000';
}

/**
 * Convert base64url string back to base64url (validation only)
 * The simplewebauthn library expects challenge as base64url string, not Buffer
 */
function validateAndNormalizeChallenge(challenge: string): string {
  if (!challenge || typeof challenge !== 'string') {
    throw new Error('Challenge must be a base64url string');
  }
  
  // Just validate it's valid base64url format
  // Pattern: alphanumeric, dash, underscore only (no padding =)
  if (!/^[A-Za-z0-9_-]+$/.test(challenge)) {
    throw new Error('Challenge is not valid base64url format');
  }
  
  return challenge;
}

/**
 * Generate JWT token
 */
function generateToken(userId: string): string {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '30d' }
  );
}

// ============= SIGNUP CONTROLLER =============

export const signup = async (req: Request, res: Response) => {
  try {
    const { email, name, username, inviteCode, passkey } = req.body;

    console.log('📝 Signup Request:', {
      email,
      name,
      username,
      hasPasskey: !!passkey,
      origin: req.headers.origin
    });

    // ============= VALIDATE REQUIRED FIELDS =============
    if (!email || !name || !username) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, name, username'
      });
    }

    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: 'Invite code is required'
      });
    }

    if (!passkey) {
      return res.status(400).json({
        success: false,
        error: 'Passkey is required for account creation'
      });
    }

    // ============= CHECK IF USER EXISTS =============
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: existingUser.email === email.toLowerCase()
          ? 'Email already registered'
          : 'Username already taken'
      });
    }

    // ============= EXTRACT RPID FROM REQUEST =============
    const rpId = extractRpIdFromOrigin(req.headers.origin);
    const expectedOrigin = getExpectedOrigin(req.headers.origin);

    console.log('🔐 RPID Configuration:', {
      requestOrigin: req.headers.origin,
      extractedRpId: rpId,
      expectedOrigin: expectedOrigin,
      envRpId: process.env.RPID_DOMAIN
    });

    // ============= VERIFY PASSKEY SIGNATURE =============
    console.log('🔐 Verifying passkey signature...');

    // Challenge must be passed as base64url string to simplewebauthn
    const challengeString = validateAndNormalizeChallenge(passkey.challenge);

    console.log('🔐 Challenge validation:', {
      originalChallenge: challengeString.substring(0, 20) + '...',
      isValid: true
    });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: passkey,
        expectedChallenge: challengeString,
        expectedOrigin: expectedOrigin,
        expectedRPID: rpId
      });
    } catch (verifyError: any) {
      console.error('❌ Passkey verification failed:', {
        message: verifyError.message,
        expectedRpId: rpId,
        expectedOrigin: expectedOrigin,
        errorName: verifyError.name
      });

      return res.status(400).json({
        success: false,
        error: 'Passkey verification failed: ' + verifyError.message,
        debug: {
          expectedRpId: rpId,
          expectedOrigin: expectedOrigin,
          errorType: verifyError.name
        }
      });
    }

    // Check if verification was successful
    if (!verification.verified) {
      console.error('❌ Verification returned false');
      return res.status(400).json({
        success: false,
        error: 'Passkey verification failed'
      });
    }

    if (!verification.registrationInfo) {
      console.error('❌ No registration info in verification response');
      return res.status(400).json({
        success: false,
        error: 'Invalid passkey registration data'
      });
    }

    console.log('✅ Passkey verified successfully');

    // ============= EXTRACT CREDENTIAL DATA =============
    const { credential } = verification.registrationInfo;

    if (!credential || !credential.id || !credential.publicKey) {
      console.error('❌ Missing credential data');
      return res.status(400).json({
        success: false,
        error: 'Invalid credential data in passkey'
      });
    }

    console.log('✅ Credential data extracted:', {
      credentialId: credential.id.substring(0, 20) + '...',
      publicKeyLength: credential.publicKey.length,
      counter: credential.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp
    });

    // ============= CREATE USER WITH PASSKEY =============
    console.log('💾 Creating user with passkey...');

    const newUser = await User.create({
      name: name.trim(),
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      inviteCode: inviteCode.toUpperCase().trim(),
      authMethod: 'passkey',
      passkey: {
        credentialID: Buffer.from(credential.id),
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: credential.counter || 0,
        credentialDeviceType: verification.registrationInfo.credentialDeviceType || 'single-device',
        credentialBackedUp: verification.registrationInfo.credentialBackedUp || false
      },
      wallet: {
        ownerAddress: '', // Will be set during wallet creation
        smartAccountAddress: '',
        network: 'base-mainnet',
        isReal: false
      }
    });

    console.log('✅ User created successfully:', {
      userId: newUser._id,
      email: newUser.email,
      username: newUser.username
    });

    // ============= VERIFY PASSKEY WAS SAVED =============
    const savedUser = await User.findById(newUser._id).select('+passkey');
    const hasPasskey = !!(savedUser?.passkey?.credentialID);

    console.log('✅ Passkey save verification:', {
      userExists: !!savedUser,
      hasPasskey: hasPasskey,
      credentialIDLength: savedUser?.passkey?.credentialID?.length || 0
    });

    if (!hasPasskey) {
      console.error('⚠️  WARNING: Passkey was created but not saved to database!');
      return res.status(500).json({
        success: false,
        error: 'Failed to save passkey to database'
      });
    }

    // ============= GENERATE JWT TOKEN =============
    const token = generateToken(newUser._id.toString());

    console.log('✅ JWT token generated');

    // ============= RESPONSE =============
    return res.status(201).json({
      success: true,
      message: 'User created successfully with passkey',
      data: {
        token,
        user: {
          _id: newUser._id,
          email: newUser.email,
          name: newUser.name,
          username: newUser.username,
          hasPasskey: true
        }
      }
    });

  } catch (error: any) {
    console.error('❌ Signup error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Check for specific MongoDB errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        error: `${field} already exists`
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message || 'Signup failed. Please try again.'
    });
  }
};

// ============= LOGIN CONTROLLER =============

export const login = async (req: Request, res: Response) => {
  try {
    const { email, username, passkey } = req.body;

    console.log('🔑 Login request:', {
      email,
      username,
      hasPasskey: !!passkey
    });

    // ============= VALIDATE INPUT =============
    if (!passkey) {
      return res.status(400).json({
        success: false,
        error: 'Passkey assertion is required'
      });
    }

    if (!email && !username) {
      return res.status(400).json({
        success: false,
        error: 'Email or username is required'
      });
    }

    // ============= FIND USER =============
    const user = await User.findOne({
      $or: [
        { email: email?.toLowerCase() },
        { username: username?.toLowerCase() }
      ]
    }).select('+passkey');

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    if (!user.passkey || !user.passkey.credentialID) {
      return res.status(401).json({
        success: false,
        error: 'No passkey registered for this user. Please sign up instead.'
      });
    }

    // ============= EXTRACT RPID =============
    const rpId = extractRpIdFromOrigin(req.headers.origin);
    const expectedOrigin = getExpectedOrigin(req.headers.origin);

    // ============= VERIFY PASSKEY =============
    const challengeString = validateAndNormalizeChallenge(passkey.challenge);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: passkey,
        expectedChallenge: challengeString,
        expectedOrigin: expectedOrigin,
        expectedRPID: rpId,
        credential: {
          id: user.passkey.credentialID.toString(),
          publicKey: new Uint8Array(user.passkey.credentialPublicKey),
          counter: user.passkey.counter || 0
        },
        requireUserVerification: true
      });
    } catch (verifyError: any) {
      console.error('❌ Login verification failed:', verifyError.message);
      return res.status(401).json({
        success: false,
        error: 'Authentication failed: ' + verifyError.message
      });
    }

    if (!verification.verified) {
      return res.status(401).json({
        success: false,
        error: 'Authentication verification failed'
      });
    }

    // ============= UPDATE COUNTER =============
    user.passkey.counter = verification.authenticationInfo.newCounter;
    await user.save();

    console.log('✅ Login successful for:', user.email);

    // ============= GENERATE TOKEN =============
    const token = generateToken(user._id.toString());

    // ============= RESPONSE =============
    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          username: user.username
        }
      }
    });

  } catch (error: any) {
    console.error('❌ Login error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Login failed'
    });
  }
};

// ============= GET ME CONTROLLER =============

export const getMe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const user = await User.findById(userId).select('+passkey');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          username: user.username,
          hasPasskey: !!(user.passkey?.credentialID)
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Get me error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get user'
    });
  }
};

// ============= LOGOUT CONTROLLER =============

export const logout = async (req: Request, res: Response) => {
  try {
    // Logout is handled on frontend by removing token
    // Backend just confirms logout
    return res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Logout failed'
    });
  }
};

// ============= DEBUG ENDPOINT =============

/**
 * Check if a user has a passkey registered
 * GET /api/auth/debug/check-passkey
 * Headers: Authorization: Bearer {token}
 */
export const checkPasskey = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const user = await User.findById(userId).select('+passkey');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const hasPasskey = !!(user.passkey?.credentialID);

    return res.json({
      success: true,
      data: {
        userId: user._id,
        email: user.email,
        username: user.username,
        hasPasskey: hasPasskey,
        passkeyDetails: hasPasskey ? {
          credentialIDLength: user.passkey!.credentialID!.length,
          publicKeyLength: user.passkey!.credentialPublicKey!.length,
          counter: user.passkey!.counter,
          deviceType: user.passkey!.credentialDeviceType,
          backedUp: user.passkey!.credentialBackedUp
        } : null
      }
    });
  } catch (error: any) {
    console.error('❌ Check passkey error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check passkey'
    });
  }
};