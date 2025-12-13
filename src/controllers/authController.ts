// ============= src/controllers/authController.ts (PURE PASSKEY VERSION) =============
import { Request, Response } from 'express';
import User from '../models/User';
import InviteCode from '../models/InviteCode';
import { createServerWallet } from '../services/walletService';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse
} from '@simplewebauthn/server';

/**
 * Generate JWT Token
 */
const generateToken = (user: any): string => {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '30d' }
  );
};

/**
 * @desc    Register new user with PASSKEY ONLY
 * @route   POST /api/auth/signup
 * @access  Public
 */
export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, username, email, inviteCode, passkey } = req.body;

    console.log('🔐 Passkey-based signup attempt:', {
      username,
      email,
      inviteCode
    });

    // Validate required fields
    if (!name || !username || !email || !inviteCode || !passkey) {
      res.status(400).json({
        success: false,
        error: 'Please provide name, username, email, passkey, and invite code'
      });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username: username.toLowerCase() }] 
    });
    
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: existingUser.email === email 
          ? 'Email already registered' 
          : 'Username already taken'
      });
      return;
    }

    // Validate invite code
    console.log('🔍 Validating invite code:', inviteCode.toUpperCase());
    const invite = await InviteCode.findOne({ 
      code: inviteCode.toUpperCase() 
    }).populate('createdBy', 'username name');

    if (!invite) {
      res.status(400).json({
        success: false,
        error: 'Invalid invite code'
      });
      return;
    }

    if (!invite.isLifetime && invite.expiresAt && invite.expiresAt < new Date()) {
      res.status(400).json({
        success: false,
        error: 'This invite code has expired'
      });
      return;
    }

    console.log('✅ Invite code validated');

    // Verify passkey registration
    const expectedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
    const expectedRPID = new URL(expectedOrigin).hostname;

    console.log('🔐 Verifying passkey with:', { expectedOrigin, expectedRPID });

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: passkey,
        expectedChallenge: passkey.challenge || 'temp-challenge',
        expectedOrigin,
        expectedRPID,
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

    console.log('✅ Passkey verified successfully');

    // Create wallet
    console.log('🔐 Creating wallet...');
    const wallet = await createServerWallet();
    console.log('✅ Wallet created:', {
      ownerAddress: wallet.ownerAddress,
      smartAccountAddress: wallet.smartAccountAddress,
      network: wallet.network,
      isReal: wallet.isReal
    });

    // Extract credential data from registrationInfo
    const { registrationInfo } = verification;
    const { credential } = registrationInfo;

    // Create user with passkey (NO PASSWORD)
    const user = await User.create({
      name,
      username: username.toLowerCase(),
      email,
      inviteCode: invite.code,
      invitedBy: invite.createdBy || null,
      wallet,
      authMethod: 'passkey',
      passkey: {
        credentialID: Buffer.from(credential.id),
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        credentialDeviceType: registrationInfo.credentialDeviceType,
        credentialBackedUp: registrationInfo.credentialBackedUp,
      }
    });

    console.log('✅ User created with passkey authentication');

    // Track invite usage (reusable invite codes)
    invite.usedBy ??= [];
    invite.usedBy.push(user._id as any);
    await invite.save();
    
    console.log('✅ User added to invite code usage tracking');

    // Auto-generate personal invite code
    const personalInviteCode = `${username.toLowerCase()}inviteyou`.toUpperCase();
    
    console.log(`📨 Creating personal invite code: ${personalInviteCode}`);
    
    try {
      const newInviteCode = await InviteCode.create({
        code: personalInviteCode,
        isLifetime: true,
        createdBy: user._id,
        usedBy: [],
        expiresAt: null
      });

      user.createdInviteCodes.push(newInviteCode._id as any);
      await user.save();

      console.log('✅ Personal invite code created');
    } catch (inviteError: any) {
      console.log('⚠️ Could not create personal invite code:', inviteError.message);
    }

    const token = generateToken(user);

    const referrerInfo = invite.createdBy ? {
      username: (invite.createdBy as any).username,
      name: (invite.createdBy as any).name
    } : null;

    const userResponse = await User.findById(user._id)
      .select('-passkey')
      .populate('createdInviteCodes', 'code usedBy');

    res.status(201).json({
      success: true,
      message: wallet.isReal 
        ? 'Account created successfully with passkey authentication on Base!'
        : 'Account created successfully with passkey authentication!',
      data: {
        user: userResponse,
        token,
        inviteCode: personalInviteCode,
        invitedBy: referrerInfo,
        authMethod: 'passkey'
      }
    });
  } catch (error: any) {
    console.error('❌ Passkey signup error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err: any) => err.message);
      res.status(400).json({
        success: false,
        error: messages.join(', ')
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Login user with PASSKEY ONLY
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, passkey } = req.body;

    if (!email || !passkey) {
      res.status(400).json({
        success: false,
        error: 'Please provide email and passkey'
      });
      return;
    }

    console.log('🔐 Passkey login attempt for:', email);

    const user = await User.findOne({ email }).select('+passkey');

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
      return;
    }

    if (!user.passkey) {
      res.status(400).json({
        success: false,
        error: 'No passkey found for this account. Please contact support.'
      });
      return;
    }

    // Verify passkey authentication
    const expectedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
    const expectedRPID = new URL(expectedOrigin).hostname;

    console.log('🔐 Verifying passkey authentication');

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: passkey,
        expectedChallenge: passkey.challenge || 'temp-challenge',
        expectedOrigin,
        expectedRPID,
        credential: {
          id: user.passkey.credentialID.toString('base64url'),
          publicKey: new Uint8Array(user.passkey.credentialPublicKey), // Convert Buffer to Uint8Array
          counter: user.passkey.counter,
        },
      });
    } catch (error: any) {
      console.error('❌ Passkey authentication failed:', error);
      res.status(401).json({
        success: false,
        error: 'Passkey authentication failed: ' + error.message
      });
      return;
    }

    if (!verification.verified) {
      res.status(401).json({
        success: false,
        error: 'Passkey authentication failed'
      });
      return;
    }

    console.log('✅ Passkey authentication successful');

    // Update counter (prevents replay attacks)
    user.passkey.counter = verification.authenticationInfo.newCounter;
    await user.save();

    const token = generateToken(user);

    const userResponse = await User.findById(user._id)
      .select('-passkey')
      .populate('createdInviteCodes', 'code usedBy')
      .populate('invitedBy', 'username name');

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        token,
        authMethod: 'passkey'
      }
    });
  } catch (error: any) {
    console.error('❌ Passkey login error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get current user
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id)
      .select('-passkey')
      .populate('createdInviteCodes', 'code usedBy createdAt')
      .populate('invitedBy', 'username name email');

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully. Please remove the token from client.'
  });
};

export default {
  signup,
  login,
  getMe,
  logout
};