// ============= src/controllers/userController.ts (UPDATED) =============
import { Request, Response } from 'express';
import User from '../models/User';
import {
  getWalletBalance,
  getUSDCBalance,
  NetworkType
} from '../services/walletService';

/**
 * @desc    Get my profile
 * @route   GET /api/users/me
 * @access  Private (uses JWT token)
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id)
      .select('-password')
      .populate('createdInviteCodes', 'code isUsed createdAt');

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
 * @desc    Update my profile
 * @route   PUT /api/users/me
 * @access  Private (uses JWT token)
 */
export const updateMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, username, email } = req.body;

    const user = await User.findById(req.user?.id);

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    // Check if new username is already taken
    if (username && username.toLowerCase() !== user.username) {
      const existingUsername = await User.findOne({ 
        username: username.toLowerCase(),
        _id: { $ne: user._id }
      });
      
      if (existingUsername) {
        res.status(400).json({
          success: false,
          error: 'Username already taken'
        });
        return;
      }
    }

    // Check if new email is already taken
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ 
        email,
        _id: { $ne: user._id }
      });
      
      if (existingEmail) {
        res.status(400).json({
          success: false,
          error: 'Email already registered'
        });
        return;
      }
    }

    // Update fields
    if (name) user.name = name;
    if (username) user.username = username.toLowerCase();
    if (email) user.email = email;

    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser
    });
  } catch (error: any) {
    console.error('❌ Error updating profile:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my wallet
 * @route   GET /api/users/me/wallet
 * @access  Private (uses JWT token)
 */
export const getMyWallet = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id).select('name username wallet');

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    if (!user.wallet) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        ownerAddress: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        isReal: user.wallet.isReal || false,
        userName: user.name,
        username: user.username
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching wallet:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my wallet balance (ETH + USDC)
 * @route   GET /api/users/me/wallet/balance
 * @access  Private (uses JWT token)
 */
export const getMyBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id).select('wallet');

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    if (!user.wallet) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
      return;
    }

    const address = user.wallet.smartAccountAddress || user.wallet.ownerAddress;
    const network = (user.wallet.network || 'base-mainnet') as NetworkType;

    // Get both ETH and USDC balances
    const ethBalance = await getWalletBalance(address, network);
    const usdcBalance = await getUSDCBalance(address, network);

    res.status(200).json({
      success: true,
      data: {
        address: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        ethBalance: ethBalance.balance,
        usdcBalance: usdcBalance.balance,
        balances: {
          ETH: ethBalance,
          USDC: usdcBalance
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching balance:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

export default {
  getMe,
  updateMe,
  getMyWallet,
  getMyBalance
};