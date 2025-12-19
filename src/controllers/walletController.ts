// ============= src/controllers/walletController.ts (SMART ACCOUNT VERSION) =============
import { Request, Response } from 'express';
import User from '../models/User';
import {
  getWalletBalance,
  getUSDCBalance,
  NetworkType
} from '../services/walletService';
import { sendUSDCWithPaymaster } from '../services/paymasterService';

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

    // Check Smart Account balance
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
        ownerAddress: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        isReal: user.wallet.isReal,
        // Primary balances (Smart Account)
        balance: smartAccountEthBalance.balance,
        usdcBalance: smartAccountUsdcBalance.balance,
        // Detailed balances
        balances: {
          smartAccount: {
            address: smartAccountAddress,
            eth: smartAccountEthBalance.balance,
            usdc: smartAccountUsdcBalance.balance
          },
          eoa: {
            address: eoaAddress,
            eth: eoaEthBalance.balance,
            usdc: eoaUsdcBalance.balance
          }
        }
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
        ownerAddress: user.wallet.ownerAddress,
        smartAccountAddress: user.wallet.smartAccountAddress,
        network: user.wallet.network,
        isReal: user.wallet.isReal,
        // Primary balances (Smart Account - used for transactions)
        ethBalance: smartAccountEthBalance.balance,
        usdcBalance: smartAccountUsdcBalance.balance,
        // Detailed breakdown
        balances: {
          smartAccount: {
            address: smartAccountAddress,
            ETH: smartAccountEthBalance,
            USDC: smartAccountUsdcBalance
          },
          eoa: {
            address: eoaAddress,
            ETH: eoaEthBalance,
            USDC: eoaUsdcBalance
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

/**
 * @desc    Send transaction (USDC via gasless paymaster)
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
    if (tokenUpper !== 'USDC') {
      res.status(400).json({
        success: false,
        error: 'Only USDC transfers are supported. Use /api/transfer endpoints for user-to-user transfers.'
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
    const smartAccountAddress = user.wallet.smartAccountAddress || user.wallet.ownerAddress;

    console.log(`💸 Processing USDC transaction (gasless) for ${user.username}`);
    console.log(`   From (Smart Account): ${smartAccountAddress}`);
    console.log(`   To: ${toAddress}`);
    console.log(`   Amount: ${amount} USDC`);
    console.log(`   Network: ${networkToUse}`);

    // Check Smart Account balance
    const balance = await getUSDCBalance(smartAccountAddress, networkToUse);
    if (parseFloat(balance.balance) < parseFloat(amount)) {
      res.status(400).json({
        success: false,
        error: `Insufficient USDC in Smart Account. You have ${balance.balance} USDC.`,
        hint: 'If you have USDC in your EOA, use the /api/wallet/migrate-funds endpoint to transfer it to your Smart Account.'
      });
      return;
    }

    // Send USDC using gasless paymaster
    try {
      const result = await sendUSDCWithPaymaster(
        user.wallet.encryptedWalletData,
        toAddress,
        amount,
        networkToUse
      );

      console.log(`✅ Gasless transaction successful: ${result.transactionHash}`);

      res.status(200).json({
        success: true,
        message: `${amount} USDC sent successfully (gasless)`,
        data: {
          transactionHash: result.transactionHash,
          explorerUrl: result.explorerUrl,
          token: 'USDC',
          amount,
          to: toAddress,
          from: smartAccountAddress,
          gasSponsored: result.gasSponsored,
          blockNumber: result.blockNumber
        }
      });
    } catch (txError: any) {
      console.error('❌ Transaction failed:', txError);
      res.status(500).json({
        success: false,
        error: 'Transaction failed',
        details: txError.message
      });
    }
  } catch (error: any) {
    console.error('❌ Transaction error:', error);
    
    let errorMessage = error.message || 'Transaction failed';
    
    if (error.message?.includes('insufficient funds')) {
      errorMessage = 'Insufficient balance to complete transaction';
    } else if (error.message?.includes('invalid address')) {
      errorMessage = 'Invalid recipient address';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
};

/**
 * @desc    Migrate funds from EOA to Smart Account
 * @route   POST /api/wallet/migrate-funds
 * @access  Private (uses JWT token)
 */
export const migrateFunds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount } = req.body;

    const user = await User.findById(req.user?.id).select('+wallet.encryptedWalletData');

    if (!user || !user.wallet) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
      return;
    }

    if (!user.wallet.smartAccountAddress) {
      res.status(400).json({
        success: false,
        error: 'Smart Account address not found. Please contact support.'
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

    const eoaAddress = user.wallet.ownerAddress;
    const smartAccountAddress = user.wallet.smartAccountAddress;
    const network = (user.wallet.network || 'base-mainnet') as NetworkType;

    console.log(`🔄 Migrating USDC from EOA to Smart Account`);
    console.log(`   From (EOA): ${eoaAddress}`);
    console.log(`   To (Smart Account): ${smartAccountAddress}`);

    // Check EOA balance
    const eoaBalance = await getUSDCBalance(eoaAddress, network);
    const amountToTransfer = amount || eoaBalance.balance;

    if (parseFloat(eoaBalance.balance) === 0) {
      res.status(400).json({
        success: false,
        error: 'No USDC in EOA to migrate'
      });
      return;
    }

    if (amount && parseFloat(amount) > parseFloat(eoaBalance.balance)) {
      res.status(400).json({
        success: false,
        error: `Insufficient USDC in EOA. You have ${eoaBalance.balance} USDC.`
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'To migrate funds from your EOA to Smart Account, please send USDC manually.',
      data: {
        eoaAddress,
        smartAccountAddress,
        eoaBalance: eoaBalance.balance,
        instructions: {
          step1: `Open your wallet (Coinbase, MetaMask, etc.)`,
          step2: `Send ${amountToTransfer} USDC to: ${smartAccountAddress}`,
          step3: `Cost: ~$0.01 in gas (one-time only)`,
          step4: `After this, all future transfers will be gasless!`
        },
        explorerLink: `https://basescan.org/address/${eoaAddress}`
      }
    });
  } catch (error: any) {
    console.error('❌ Migration error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
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

    if (!user.wallet) {
      res.status(200).json({
        success: true,
        data: [],
        message: 'No wallet found'
      });
      return;
    }

    const smartAccountAddress = user.wallet.smartAccountAddress || user.wallet.ownerAddress;
    const eoaAddress = user.wallet.ownerAddress;
    const network = user.wallet.network || 'base-mainnet';
    const isMainnet = user.wallet.isReal;

    // Provide explorer links for both addresses
    const baseUrl = isMainnet ? 'https://basescan.org' : 'https://sepolia.basescan.org';

    res.status(200).json({
      success: true,
      data: {
        smartAccount: {
          address: smartAccountAddress,
          explorerUrl: `${baseUrl}/address/${smartAccountAddress}`,
          note: 'Primary address for gasless transactions'
        },
        eoa: {
          address: eoaAddress,
          explorerUrl: `${baseUrl}/address/${eoaAddress}`,
          note: 'Original address (for reference)'
        },
        network,
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
        network: user.wallet.network,
        note: 'smartAccountAddress is the primary address for transactions'
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
  migrateFunds,
  getMyTransactions,
  getWalletByUsername
};