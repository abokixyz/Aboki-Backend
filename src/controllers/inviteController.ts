// ============= src/controllers/inviteController.ts =============
import { Request, Response } from 'express';
import InviteCode from '../models/InviteCode';
import User from '../models/User';

/**
 * @desc    Get all invite codes (admin)
 * @route   GET /api/invites
 * @access  Public (should add admin middleware in production)
 */
export const getAllInviteCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const inviteCodes = await InviteCode.find()
      .populate('createdBy', 'username name')
      .populate('usedBy', 'username name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: inviteCodes.length,
      data: inviteCodes
    });
  } catch (error: any) {
    console.error('❌ Error fetching all invite codes:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get available (unused, non-expired) invite codes
 * @route   GET /api/invites/available
 * @access  Public
 */
export const getAvailableInviteCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    
    // Find codes that are:
    // 1. Either lifetime codes OR non-expired codes
    // 2. Not used (or can be reused if lifetime)
    const availableCodes = await InviteCode.find({
      $or: [
        { isLifetime: true },
        { isLifetime: false, expiresAt: { $gt: now } }
      ]
    })
      .populate('createdBy', 'username name')
      .select('code isLifetime createdBy createdAt expiresAt usageCount')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: availableCodes.length,
      data: availableCodes
    });
  } catch (error: any) {
    console.error('❌ Error fetching available invite codes:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my personal invite code
 * @route   GET /api/invites/my-code
 * @access  Private
 */
export const getMyInviteCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Find the invite code created by this user
    const inviteCode = await InviteCode.findOne({ createdBy: userId })
      .populate('usedBy', 'username name email createdAt');

    if (!inviteCode) {
      res.status(404).json({
        success: false,
        error: 'You do not have an invite code yet'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        code: inviteCode.code,
        isLifetime: inviteCode.isLifetime,
        usageCount: inviteCode.usageCount,
        createdAt: inviteCode.createdAt,
        usedBy: inviteCode.usedBy
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching my invite code:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my referrals (users who used my invite code)
 * @route   GET /api/invites/my-referrals
 * @access  Private
 */
export const getMyReferrals = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Find users who were invited by this user
    const referrals = await User.find({ invitedBy: userId })
      .select('name username email createdAt wallet')
      .sort({ createdAt: -1 });

    // Get the user's invite code
    const inviteCode = await InviteCode.findOne({ createdBy: userId });

    res.status(200).json({
      success: true,
      data: {
        myInviteCode: inviteCode?.code || null,
        totalReferrals: referrals.length,
        referrals: referrals.map(user => ({
          name: user.name,
          username: user.username,
          email: user.email,
          joinedAt: user.createdAt,
          hasWallet: !!user.wallet
        }))
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching my referrals:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get invite code by code
 * @route   GET /api/invites/:code
 * @access  Public
 */
export const getInviteCodeByCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;

    const inviteCode = await InviteCode.findOne({ code: code.toUpperCase() })
      .populate('createdBy', 'username name')
      .populate('usedBy', 'username name');

    if (!inviteCode) {
      res.status(404).json({
        success: false,
        error: 'Invite code not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: inviteCode
    });
  } catch (error: any) {
    console.error('❌ Error fetching invite code:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Create default project invite code (PROJECTINVITE)
 * @route   POST /api/invites/default
 * @access  Public (should be protected in production)
 */
export const createDefaultInviteCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const defaultCode = 'PROJECTINVITE';

    // Check if default code already exists
    const existingCode = await InviteCode.findOne({ code: defaultCode });

    if (existingCode) {
      res.status(200).json({
        success: true,
        message: `Default invite code '${defaultCode}' already exists`,
        data: existingCode
      });
      return;
    }

    // Create the default code
    const inviteCode = await InviteCode.create({
      code: defaultCode,
      isLifetime: true,
      createdBy: null // Project code, not created by any user
    });

    console.log(`✅ Created default invite code: ${defaultCode}`);

    res.status(201).json({
      success: true,
      message: `Default invite code '${defaultCode}' created successfully`,
      data: inviteCode
    });
  } catch (error: any) {
    console.error('❌ Error creating default invite code:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Validate an invite code
 * @route   POST /api/invites/:code/validate
 * @access  Public
 */
export const validateInviteCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;

    const inviteCode = await InviteCode.findOne({ code: code.toUpperCase() })
      .populate('createdBy', 'username name');

    if (!inviteCode) {
      res.status(404).json({
        success: false,
        valid: false,
        message: 'Invite code not found'
      });
      return;
    }

    // Check if code is valid using the model method
    if (!inviteCode.isValid()) {
      res.status(400).json({
        success: false,
        valid: false,
        message: 'This invite code has expired'
      });
      return;
    }

    res.status(200).json({
      success: true,
      valid: true,
      message: 'Invite code is valid',
      data: {
        code: inviteCode.code,
        isLifetime: inviteCode.isLifetime,
        invitedBy: inviteCode.createdBy ? (inviteCode.createdBy as any).username : null
      }
    });
  } catch (error: any) {
    console.error('❌ Error validating invite code:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

// Export all functions
export default {
  getAllInviteCodes,
  getAvailableInviteCodes,
  getMyInviteCode,
  getMyReferrals,
  getInviteCodeByCode,
  createDefaultInviteCode,
  validateInviteCode
};