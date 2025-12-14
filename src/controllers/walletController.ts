// ============= src/controllers/walletController.ts (UPDATED) =============
import { Request, Response } from 'express';
import User from '../models/User';
import {
  getWalletBalance,
  getUSDCBalance,
  sendTransaction as sendETH,
  sendToken,
  NetworkType
} from '../services/walletService';

// USDC Contract Address on Base Mainnet
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * @desc    Get my wallet details
 * @route   GET /api/wallet
 * @access  Private (uses JWT token)
 */
export const getMyWallet = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id);

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

    // Get ETH balance
    const ethBalance = await getWalletBalance(address, network);

    // Get USDC balance
    const usdcBalance = await getUSDCBalance(address, network);

    res.status(200).json({
      success: true,
      data: {
        ownerAddress: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        balance: ethBalance.balance,
        usdcBalance: usdcBalance.balance,
        isReal: user.wallet.isReal
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
 * @route   GET /api/wallet/balance
 * @access  Private (uses JWT token)
 */
export const getMyBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id);

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
        ownerAddress: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        isReal: user.wallet.isReal,
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

/**
 * @desc    Send transaction (ETH or USDC)
 * @route   POST /api/wallet/send
 * @access  Private (uses JWT token)
 */
export const sendTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { toAddress, amount, token = 'USDC', network } = req.body;

    // Validate inputs
    if (!toAddress || !amount) {
      res.status(400).json({
        success: false,
        error: 'Please provide toAddress and amount'
      });
      return;
    }

    // Validate amount
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
      return;
    }

    // Validate token
    const tokenUpper = token.toUpperCase();
    if (!['ETH', 'USDC'].includes(tokenUpper)) {
      res.status(400).json({
        success: false,
        error: 'Token must be either ETH or USDC'
      });
      return;
    }

    // Get user with wallet data (including encrypted data)
    const user = await User.findById(req.user?.id).select('+wallet.encryptedWalletData');

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    if (!user.wallet) {
      res.status(400).json({
        success: false,
        error: 'Wallet not found'
      });
      return;
    }

    if (!user.wallet.encryptedWalletData) {
      res.status(400).json({
        success: false,
        error: 'Wallet not configured for transactions'
      });
      return;
    }

    // Check if wallet is real (on mainnet)
    if (!user.wallet.isReal) {
      res.status(400).json({
        success: false,
        error: 'This wallet is in test mode and cannot send real transactions'
      });
      return;
    }

    const networkToUse = (network || user.wallet.network || 'base-mainnet') as NetworkType;

    console.log(`💸 Processing ${tokenUpper} transaction for ${user.username}`);
    console.log(`   From: ${user.wallet.smartAccountAddress || user.wallet.ownerAddress}`);
    console.log(`   To: ${toAddress}`);
    console.log(`   Amount: ${amount} ${tokenUpper}`);
    console.log(`   Network: ${networkToUse}`);

    let result;

    if (tokenUpper === 'ETH') {
      // Send ETH
      result = await sendETH(
        user._id.toString(),
        user.wallet.encryptedWalletData,
        toAddress,
        amount,
        networkToUse
      );
    } else {
      // Send USDC
      // Convert amount to USDC wei (6 decimals)
      const amountInWei = (parseFloat(amount) * 1e6).toString();
      
      result = await sendToken(
        user._id.toString(),
        user.wallet.encryptedWalletData,
        USDC_ADDRESS,
        toAddress,
        amountInWei,
        6, // USDC has 6 decimals
        networkToUse
      );
    }

    console.log(`✅ Transaction successful: ${result.transactionHash}`);

    res.status(200).json({
      success: true,
      message: `${tokenUpper} sent successfully`,
      data: {
        ...result,
        token: tokenUpper,
        amount,
        to: toAddress
      }
    });
  } catch (error: any) {
    console.error('❌ Transaction error:', error);
    
    // Provide more specific error messages
    let errorMessage = error.message || 'Transaction failed';
    
    if (error.message?.includes('insufficient funds')) {
      errorMessage = 'Insufficient balance to complete transaction';
    } else if (error.message?.includes('invalid address')) {
      errorMessage = 'Invalid recipient address';
    } else if (error.message?.includes('nonce')) {
      errorMessage = 'Transaction nonce error. Please try again';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
};

/**
 * @desc    Get my transaction history
 * @route   GET /api/wallet/transactions
 * @access  Private (uses JWT token)
 */
export const getMyTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id);

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    if (!user.wallet || !user.wallet.smartAccountAddress) {
      res.status(200).json({
        success: true,
        data: [],
        message: 'No wallet found'
      });
      return;
    }

    const address = user.wallet.smartAccountAddress || user.wallet.ownerAddress;
    const network = user.wallet.network || 'base-mainnet';
    const isMainnet = user.wallet.isReal;

    // Provide explorer link for user to view transactions
    const explorerUrl = isMainnet 
      ? `https://basescan.org/address/${address}`
      : `https://sepolia.basescan.org/address/${address}`;

    res.status(200).json({
      success: true,
      data: {
        address,
        network,
        explorerUrl,
        message: 'View full transaction history on the block explorer'
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get wallet address by username
 * @route   GET /api/wallet/user/:username
 * @access  Public
 */
export const getWalletByUsername = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ 
      username: username.toLowerCase() 
    }).select('username name wallet');

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
        error: 'User does not have a wallet'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        username: user.username,
        name: user.name,
        ownerAddress: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching wallet by username:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

export default {
  getMyWallet,
  getMyBalance,
  sendTransaction,
  getMyTransactions,
  getWalletByUsername
};