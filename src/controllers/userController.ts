// ============= src/controllers/userController.ts (SMART ACCOUNT VERSION) =============
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

    const updatedUser = await User.findById(user._id)
      .select('-passkey')
      .populate('createdInviteCodes', 'code usedBy createdAt')
      .populate('invitedBy', 'username name email');

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
        username: user.username,
        note: 'smartAccountAddress is the primary address for gasless transactions'
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

    const smartAccountAddress = user.wallet.smartAccountAddress || user.wallet.ownerAddress;
    const eoaAddress = user.wallet.ownerAddress;
    const network = (user.wallet.network || 'base-mainnet') as NetworkType;

    // Get balances for both addresses
    const smartAccountEthBalance = await getWalletBalance(smartAccountAddress, network);
    const smartAccountUsdcBalance = await getUSDCBalance(smartAccountAddress, network);
    
    const eoaEthBalance = await getWalletBalance(eoaAddress, network);
    const eoaUsdcBalance = await getUSDCBalance(eoaAddress, network);

    res.status(200).json({
      success: true,
      data: {
        // Primary addresses (Smart Account)
        address: smartAccountAddress,
        ownerAddress: eoaAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        // Primary balances (Smart Account - used for transactions)
        ethBalance: smartAccountEthBalance.balance,
        usdcBalance: smartAccountUsdcBalance.balance,
        // Detailed breakdown
        balances: {
          smartAccount: {
            address: smartAccountAddress,
            ETH: smartAccountEthBalance,
            USDC: smartAccountUsdcBalance,
            note: 'Primary address for gasless transactions'
          },
          eoa: {
            address: eoaAddress,
            ETH: eoaEthBalance,
            USDC: eoaUsdcBalance,
            note: 'Original address (for reference)'
          }
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