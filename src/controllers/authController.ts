// ============= src/controllers/authController.ts =============
import { Request, Response } from 'express';
import User from '../models/User';
import InviteCode from '../models/InviteCode';
import { createServerWallet } from '../services/walletService';
import { SignupDTO, LoginDTO } from '../types';

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
 * @desc    Register new user with invite code
 * @route   POST /api/auth/signup
 * @access  Public
 */
export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, username, email, password, inviteCode }: SignupDTO = req.body;

    console.log('📝 User signup attempt:', {
      username,
      email,
      inviteCode
    });

    // Validate required fields
    if (!name || !username || !email || !password || !inviteCode) {
      res.status(400).json({
        success: false,
        error: 'Please provide name, username, email, password, and invite code'
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
    console.log('✅ Invite code validated:', inviteCode.toUpperCase());
    const invite = await InviteCode.findOne({ 
      code: inviteCode.toUpperCase() 
    }).populate('createdBy', 'username');

    if (!invite) {
      res.status(400).json({
        success: false,
        error: 'Invalid invite code'
      });
      return;
    }

    if (invite.isUsed) {
      res.status(400).json({
        success: false,
        error: 'This invite code has already been used'
      });
      return;
    }

    // Check if code is expired
    if (!invite.isLifetime && invite.expiresAt && invite.expiresAt < new Date()) {
      res.status(400).json({
        success: false,
        error: 'This invite code has expired'
      });
      return;
    }

    // Create wallet
    console.log('🔐 Creating wallet...');
    const wallet = await createServerWallet();
    console.log('✅ Wallet created:', {
      ownerAddress: wallet.ownerAddress,
      smartAccountAddress: wallet.smartAccountAddress,
      network: wallet.network,
      isReal: wallet.isReal
    });

    // Create user
    const user = await User.create({
      name,
      username: username.toLowerCase(),
      email,
      password,
      inviteCode: invite.code,
      invitedBy: invite.createdBy || null, // Track who invited this user
      wallet,
      createdInviteCodes: []
    });

    console.log('✅ User created:', user._id);

    // Mark invite code as used
    invite.isUsed = true;
    invite.usedBy = user._id as any;
    await invite.save();
    console.log('✅ Invite code marked as used');

    // Auto-generate personal invite code for new user
    const personalInviteCode = `${username.toLowerCase()}inviteyou`.toUpperCase();
    
    console.log(`📨 Creating personal invite code: ${personalInviteCode}`);
    
    try {
      const newInviteCode = await InviteCode.create({
        code: personalInviteCode,
        isLifetime: true,
        createdBy: user._id,
        isUsed: false,
        expiresAt: null
      });

      // Add to user's created invite codes
      user.createdInviteCodes.push(newInviteCode._id as any);
      await user.save();

      console.log('✅ Personal invite code created:', personalInviteCode);
    } catch (inviteError: any) {
      // If invite code already exists, just log it (shouldn't happen with unique usernames)
      console.log('⚠️ Could not create personal invite code:', inviteError.message);
    }

    // Generate token
    const token = generateToken(user);

    // Return user without password
    const userResponse = await User.findById(user._id)
      .select('-password')
      .populate('createdInviteCodes', 'code isUsed usedBy');

    res.status(201).json({
      success: true,
      message: wallet.isReal 
        ? 'Account created successfully with real CDP smart wallet on Base!'
        : 'Account created successfully (wallet creation pending)',
      data: {
        user: userResponse,
        token,
        inviteCode: personalInviteCode // Return the user's personal invite code
      }
    });
  } catch (error: any) {
    console.error('❌ Signup error:', error);
    
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
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password }: LoginDTO = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Please provide email and password'
      });
      return;
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
      return;
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
      return;
    }

    const token = generateToken(user);

    const userResponse = await User.findById(user._id)
      .select('-password')
      .populate('createdInviteCodes', 'code isUsed usedBy');

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        token
      }
    });
  } catch (error: any) {
    console.error('❌ Login error:', error);
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
      .select('-password')
      .populate('createdInviteCodes', 'code isUsed usedBy createdAt')
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
 * @desc    Update password
 * @route   PUT /api/auth/update-password
 * @access  Private
 */
export const updatePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        error: 'Please provide current and new password'
      });
      return;
    }

    const user = await User.findById(req.user?.id).select('+password');

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
      return;
    }

    user.password = newPassword;
    await user.save();

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
      data: { token }
    });
  } catch (error: any) {
    console.error('❌ Password update error:', error);
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
  updatePassword,
  logout
};