// ============= src/controllers/onrampController.ts (COMPLETE WITH GAS CHECKS) =============
import { Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User';
import OnrampTransaction from '../models/OnrampTransaction';
import { NetworkType } from '../services/walletService';
import { calculateOnrampRate } from '../services/rateService';
import {
  getAdminUSDCBalance,
  getAdminETHBalance,
  performPreflightChecks,
  createAbokiOrder,
  verifyAdminWalletConfig
} from '../services/adminWalletService';

// Monnify Configuration
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY || 'MK_PROD_FLX4P92EDF';
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || '';
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE || '626609763141';

// Monnify IPs for webhook verification
const MONNIFY_ALLOWED_IPS = process.env.MONNIFY_IPS?.split(',') || [];

// USDC Contract on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Transaction limits (in NGN)
const MIN_AMOUNT_NGN = 1000;
const MAX_AMOUNT_NGN = 1000000;
const DAILY_LIMIT_NGN = 5000000;

/**
 * Verify Monnify webhook signature
 */
const verifyMonnifySignature = (payload: any, signature: string): boolean => {
  if (!MONNIFY_SECRET_KEY) {
    console.warn('⚠️ MONNIFY_SECRET_KEY not set - skipping signature verification');
    return true;
  }

  try {
    const hash = crypto
      .createHmac('sha512', MONNIFY_SECRET_KEY)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return hash === signature;
  } catch (error) {
    console.error('❌ Signature verification error:', error);
    return false;
  }
};

/**
 * Check if request IP is from Monnify
 */
const isValidMonnifyIP = (req: Request): boolean => {
  if (MONNIFY_ALLOWED_IPS.length === 0) {
    console.warn('⚠️ MONNIFY_ALLOWED_IPS not set - skipping IP verification');
    return true;
  }

  const clientIP = req.ip || 
                   req.headers['x-forwarded-for'] || 
                   req.connection.remoteAddress;
  
  return MONNIFY_ALLOWED_IPS.includes(clientIP as string);
};

/**
 * Check user's daily transaction limit
 */
const checkDailyLimit = async (userId: string, newAmount: number): Promise<boolean> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayTransactions = await OnrampTransaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: today },
        status: { $in: ['COMPLETED', 'PENDING', 'PAID'] }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amountNGN' }
      }
    }
  ]);

  const currentTotal = todayTransactions[0]?.total || 0;
  return (currentTotal + newAmount) <= DAILY_LIMIT_NGN;
};

/**
 * @desc    Get current onramp rate
 * @route   GET /api/onramp/rate
 * @access  Public
 */
export const getOnrampRate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amountNGN } = req.query;
    
    // Parse amount if provided
    let amount: number | undefined;
    if (amountNGN) {
      amount = parseFloat(amountNGN as string);
      
      if (isNaN(amount) || amount <= 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid amount. Please provide a valid positive number.'
        });
        return;
      }
    }
    
    // Get rate calculation
    const rateData = await calculateOnrampRate(amount);
    
    console.log(`📊 Rate requested${amount ? ` for ₦${amount.toLocaleString()}` : ''}`);
    console.log(`   Base Rate: ₦${rateData.baseRate}`);
    console.log(`   Onramp Rate: ₦${rateData.onrampRate}`);
    console.log(`   Source: ${rateData.source}${rateData.cached ? ' (cached)' : ''}`);
    
    res.status(200).json({
      success: true,
      data: {
        baseRate: rateData.baseRate,
        onrampRate: rateData.onrampRate,
        markup: rateData.markup,
        fee: {
          percentage: rateData.feePercentage,
          amount: rateData.feeAmount,
          maxFee: rateData.maxFee
        },
        ...(amount && {
          calculation: {
            amountNGN: rateData.amountNGN,
            feeAmount: rateData.feeAmount,
            totalPayable: rateData.totalPayable,
            usdcAmount: rateData.amountUSDC,
            effectiveRate: rateData.effectiveRate,
            breakdown: `₦${rateData.amountNGN?.toLocaleString()} + ₦${rateData.feeAmount.toLocaleString()} fee = ₦${rateData.totalPayable?.toLocaleString()} total`
          }
        }),
        source: rateData.source,
        cached: rateData.cached,
        timestamp: new Date().toISOString(),
        ...(rateData.warning && { warning: rateData.warning })
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching onramp rate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch rate'
    });
  }
};

/**
 * @desc    Initialize onramp payment
 * @route   POST /api/onramp/initialize
 * @access  Private
 */
export const initializeOnramp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amountNGN, customerEmail, customerPhone } = req.body;

    // Verify admin wallet configuration first
    if (!verifyAdminWalletConfig()) {
      res.status(500).json({
        success: false,
        error: 'Liquidity provider not configured. Please contact support.'
      });
      return;
    }

    // Validate amount
    if (!amountNGN || amountNGN <= 0) {
      res.status(400).json({
        success: false,
        error: 'Please provide a valid amount in NGN'
      });
      return;
    }

    if (typeof amountNGN !== 'number' && isNaN(parseFloat(amountNGN))) {
      res.status(400).json({
        success: false,
        error: 'Amount must be a valid number'
      });
      return;
    }

    const amount = parseFloat(amountNGN.toString());

    // Check limits
    if (amount < MIN_AMOUNT_NGN) {
      res.status(400).json({
        success: false,
        error: `Minimum amount is ₦${MIN_AMOUNT_NGN.toLocaleString()}`
      });
      return;
    }

    if (amount > MAX_AMOUNT_NGN) {
      res.status(400).json({
        success: false,
        error: `Maximum amount per transaction is ₦${MAX_AMOUNT_NGN.toLocaleString()}`
      });
      return;
    }

    // Get user
    const user = await User.findById(req.user?.id);
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    // Check wallet exists
    if (!user.wallet) {
      res.status(400).json({
        success: false,
        error: 'Please create a wallet first'
      });
      return;
    }

    // Check daily limit
    const withinLimit = await checkDailyLimit(user._id.toString(), amount);
    if (!withinLimit) {
      res.status(400).json({
        success: false,
        error: `Daily transaction limit of ₦${DAILY_LIMIT_NGN.toLocaleString()} exceeded`
      });
      return;
    }

    // Get current onramp rate with dynamic calculation
    const rateData = await calculateOnrampRate(amount);
    
    // Get user network
    const network = (user.wallet.network || 'base-mainnet') as NetworkType;
    const requiredUSDC = rateData.amountUSDC || 0;

    // 🔍 CRITICAL: Comprehensive pre-flight checks (USDC + ETH + Gas)
    console.log(`🔍 Running comprehensive pre-flight checks...`);
    
    let preflightResult;
    try {
      preflightResult = await performPreflightChecks(
        requiredUSDC,
        rateData.onrampRate,
        user.wallet.smartAccountAddress || user.wallet.ownerAddress,
        network
      );
    } catch (preflightError: any) {
      console.error(`❌ Pre-flight checks failed:`, preflightError);
      res.status(503).json({
        success: false,
        error: 'Service temporarily unavailable. Please try again in a few minutes.',
        details: {
          reason: 'System checks failed'
        }
      });
      return;
    }

    if (!preflightResult.success) {
      // Handle USDC insufficiency
      if (!preflightResult.checks.usdcBalance.passed) {
        console.error(`❌ Insufficient USDC liquidity!`);
        console.error(`   Required: ${requiredUSDC.toFixed(2)} USDC`);
        console.error(`   Available: ${preflightResult.checks.usdcBalance.available.toFixed(2)} USDC`);
        
        res.status(503).json({
          success: false,
          error: 'Insufficient liquidity. Please try a smaller amount or contact support.',
          details: {
            required: requiredUSDC.toFixed(2),
            available: preflightResult.checks.usdcBalance.available.toFixed(2)
          }
        });
        return;
      }

      // Handle ETH insufficiency (minimum balance)
      if (!preflightResult.checks.ethBalance.passed) {
        console.error(`❌ Insufficient ETH for gas fees!`);
        console.error(`   Available: ${preflightResult.checks.ethBalance.available.toFixed(6)} ETH`);
        console.error(`   Minimum Required: ${preflightResult.checks.ethBalance.required} ETH`);
        
        res.status(503).json({
          success: false,
          error: 'Service temporarily unavailable. Our system is being refilled. Please try again in a few minutes.',
          details: {
            reason: 'Insufficient gas funds'
          }
        });
        return;
      }

      // Handle gas estimate insufficiency
      if (!preflightResult.checks.gasEstimate.passed) {
        console.error(`❌ Insufficient ETH for estimated gas cost!`);
        console.error(`   Estimated Gas Cost: ${preflightResult.checks.gasEstimate.estimated.toFixed(6)} ETH`);
        console.error(`   Available: ${preflightResult.checks.gasEstimate.available.toFixed(6)} ETH`);
        
        res.status(503).json({
          success: false,
          error: 'Service temporarily unavailable. Our system is being refilled. Please try again in a few minutes.',
          details: {
            reason: 'Insufficient gas funds for transaction'
          }
        });
        return;
      }
    }

    console.log(`✅ All pre-flight checks passed`);
    console.log(`   USDC: ${preflightResult.checks.usdcBalance.available.toFixed(2)} USDC available`);
    console.log(`   ETH: ${preflightResult.checks.ethBalance.available.toFixed(6)} ETH available`);
    console.log(`   Gas: ${preflightResult.gasEstimate?.gasCostWithBuffer.toFixed(6)} ETH estimated`);

    // Generate unique payment reference
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(4).toString('hex');
    const userIdShort = user._id.toString().slice(-6);
    const paymentReference = `ABOKI_${timestamp}_${userIdShort}_${randomBytes}`;

    // Create transaction record
    const transaction = await OnrampTransaction.create({
      userId: user._id,
      paymentReference,
      monnifyReference: '',
      amountNGN: amount,
      amountUSD: parseFloat((rateData.amountUSDC || 0).toFixed(2)),
      usdcAmount: parseFloat((rateData.amountUSDC || 0).toFixed(6)),
      exchangeRate: rateData.onrampRate,
      fee: rateData.feeAmount,
      status: 'PENDING',
      customerEmail: customerEmail || user.email,
      customerName: user.name,
      walletAddress: user.wallet.smartAccountAddress || user.wallet.ownerAddress
    });

    // Prepare Monnify configuration
    const monnifyConfig = {
      amount: rateData.totalPayable, // User pays amount + fee
      currency: 'NGN',
      reference: paymentReference,
      customerFullName: user.name,
      customerEmail: customerEmail || user.email,
      customerMobileNumber: customerPhone || '',
      apiKey: MONNIFY_API_KEY,
      contractCode: MONNIFY_CONTRACT_CODE,
      paymentDescription: `Buy ${rateData.amountUSDC?.toFixed(2)} USDC on Aboki (₦${amount.toLocaleString()} + ₦${rateData.feeAmount.toLocaleString()} fee)`,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER', 'USSD', 'PHONE_NUMBER'],
      metadata: {
        userId: user._id.toString(),
        username: user.username,
        transactionId: transaction._id.toString(),
        expectedUSDC: rateData.amountUSDC?.toFixed(6),
        walletAddress: transaction.walletAddress,
        baseAmount: amount,
        feeAmount: rateData.feeAmount,
        totalPayable: rateData.totalPayable
      }
    };

    console.log(`🎫 Onramp initialized for ${user.username}`);
    console.log(`   Base Amount: ₦${amount.toLocaleString()}`);
    console.log(`   Fee (1.5%): ₦${rateData.feeAmount.toLocaleString()}`);
    console.log(`   Total Payable: ₦${rateData.totalPayable?.toLocaleString()}`);
    console.log(`   Expected USDC: ${rateData.amountUSDC?.toFixed(6)}`);
    console.log(`   Rate: ₦${rateData.onrampRate} (Base: ₦${rateData.baseRate} + ₦${rateData.markup})`);
    console.log(`   Reference: ${paymentReference}`);

    res.status(200).json({
      success: true,
      data: {
        transactionId: transaction._id,
        paymentReference,
        amountNGN: amount,
        feeAmount: rateData.feeAmount,
        totalPayable: rateData.totalPayable,
        expectedUSDC: rateData.amountUSDC?.toFixed(6),
        exchangeRate: rateData.onrampRate,
        baseRate: rateData.baseRate,
        markup: rateData.markup,
        feePercentage: rateData.feePercentage,
        effectiveRate: rateData.effectiveRate,
        breakdown: {
          description: `You want ₦${amount.toLocaleString()} worth of USDC`,
          fee: `Service fee: ₦${rateData.feeAmount.toLocaleString()} (${rateData.feePercentage}%)`,
          total: `Total to pay: ₦${rateData.totalPayable?.toLocaleString()}`,
          receiving: `You'll receive: ${rateData.amountUSDC?.toFixed(6)} USDC`
        },
        limits: {
          min: MIN_AMOUNT_NGN,
          max: MAX_AMOUNT_NGN,
          dailyLimit: DAILY_LIMIT_NGN
        },
        liquidity: {
          usdc: {
            available: preflightResult.checks.usdcBalance.available.toFixed(2),
            required: requiredUSDC.toFixed(2),
            sufficient: true
          },
          gas: {
            available: preflightResult.checks.ethBalance.available.toFixed(6),
            estimated: preflightResult.gasEstimate?.gasCostWithBuffer.toFixed(6) || '0',
            sufficient: true
          }
        },
        monnifyConfig,
        rateSource: rateData.source
      }
    });
  } catch (error: any) {
    console.error('❌ Error initializing onramp:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initialize payment'
    });
  }
};

/**
 * @desc    Handle Monnify webhook - FIXED VERSION
 * @route   POST /api/onramp/webhook
 * @access  Public (but verified)
 */
export const handleMonnifyWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = req.body;
      
      console.log('📨 Received Monnify webhook');
      console.log('📦 Event Type:', payload.eventType);
  
      // Verify signature (use full payload for signature verification)
      const signature = req.headers['monnify-signature'] as string;
      if (signature && !verifyMonnifySignature(payload, signature)) {
        console.error('❌ Invalid webhook signature');
        res.status(401).json({
          success: false,
          error: 'Invalid signature'
        });
        return;
      }
  
      // Verify IP
      if (!isValidMonnifyIP(req)) {
        const clientIP = req.ip || req.headers['x-forwarded-for'];
        console.error(`❌ Webhook from unauthorized IP: ${clientIP}`);
        res.status(403).json({
          success: false,
          error: 'Forbidden'
        });
        return;
      }
  
      // ✅ FIX: Extract eventData - Monnify wraps data in eventData object
      const eventData = payload.eventData;
      
      if (!eventData) {
        console.error('❌ Missing eventData in webhook payload');
        res.status(400).json({
          success: false,
          error: 'Invalid webhook payload: missing eventData'
        });
        return;
      }
  
      // ✅ FIX: Extract fields from eventData, not root payload
      const {
        transactionReference,
        paymentReference,
        amountPaid,
        totalPayable,
        paidOn,
        paymentStatus,
        paymentMethod,
        currency,
        customer,
        metaData // This is where your custom data should be
      } = eventData;
  
      // Extract customer info (nested in customer object)
      const customerEmail = customer?.email;
      const customerName = customer?.name;
  
      console.log('📋 Webhook Details:');
      console.log(`   Event Type: ${payload.eventType}`);
      console.log(`   Transaction Ref: ${transactionReference}`);
      console.log(`   Payment Ref: ${paymentReference}`);
      console.log(`   Amount Paid: ₦${amountPaid}`);
      console.log(`   Status: ${paymentStatus}`);
      console.log(`   Method: ${paymentMethod}`);
  
      // Validate required fields
      if (!paymentReference || !paymentStatus) {
        console.error('❌ Missing required webhook fields');
        console.error('📦 Received eventData:', JSON.stringify(eventData, null, 2));
        res.status(400).json({
          success: false,
          error: 'Invalid webhook payload: missing required fields'
        });
        return;
      }
  
      // Find transaction by paymentReference
      const transaction = await OnrampTransaction.findOne({ paymentReference });
  
      if (!transaction) {
        console.error(`❌ Transaction not found for reference: ${paymentReference}`);
        console.log(`📋 Checking if this is a metadata reference...`);
        
        // ✅ ALTERNATIVE: Check metadata for custom payment reference
        // Monnify might use their own reference, but store yours in metadata
        if (metaData && metaData.paymentReference) {
          console.log(`🔍 Found custom reference in metadata: ${metaData.paymentReference}`);
          const txByMetadata = await OnrampTransaction.findOne({ 
            paymentReference: metaData.paymentReference 
          });
          
          if (txByMetadata) {
            console.log(`✅ Transaction found via metadata reference`);
            // Continue processing with this transaction
            return processTransaction(txByMetadata, eventData, res);
          }
        }
        
        res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
        return;
      }
  
      // Process the transaction
      return processTransaction(transaction, eventData, res);
  
    } catch (error: any) {
      console.error('❌ Webhook processing error:', error);
      console.error('Stack:', error.stack);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Webhook processing failed'
      });
    }
  };
  
  /**
   * Helper function to process the transaction
   */
  async function processTransaction(
    transaction: any,
    eventData: any,
    res: Response
  ): Promise<void> {
    const {
      transactionReference,
      paymentReference,
      amountPaid,
      totalPayable,
      paidOn,
      paymentStatus,
      paymentMethod,
      currency,
      customer
    } = eventData;
  
    // Idempotency check
    if (transaction.status === 'COMPLETED') {
      console.log(`✅ Transaction already completed (idempotency): ${paymentReference}`);
      res.status(200).json({
        success: true,
        message: 'Transaction already processed'
      });
      return;
    }
  
    // Update basic transaction info
    transaction.monnifyReference = transactionReference;
    transaction.amountPaidNGN = amountPaid;
    transaction.paymentMethod = paymentMethod;
    transaction.paidAt = paidOn ? new Date(paidOn) : new Date();
  
    // Handle non-successful payment
    if (paymentStatus !== 'PAID') {
      transaction.status = paymentStatus === 'USER_CANCELLED' ? 'CANCELLED' : 'FAILED';
      transaction.failureReason = `Payment status: ${paymentStatus}`;
      await transaction.save();
      
      console.log(`⚠️ Payment not successful: ${paymentStatus}`);
      res.status(200).json({
        success: true,
        message: `Payment ${paymentStatus}`
      });
      return;
    }
  
    // Verify amount paid
    const TOLERANCE_NGN = 1;
    const expectedAmount = transaction.amountNGN + transaction.fee;
    const amountDifference = Math.abs(amountPaid - expectedAmount);
  
    if (amountDifference > TOLERANCE_NGN) {
      console.error(`❌ AMOUNT MISMATCH DETECTED!`);
      console.error(`   Expected: ₦${expectedAmount} (₦${transaction.amountNGN} + ₦${transaction.fee} fee)`);
      console.error(`   Paid: ₦${amountPaid}`);
      
      transaction.status = 'FAILED';
      transaction.failureReason = `Amount mismatch: Expected ${expectedAmount}, Paid ${amountPaid}`;
      await transaction.save();
      
      res.status(400).json({
        success: false,
        error: 'Amount mismatch'
      });
      return;
    }
  
    // Get user
    const user = await User.findById(transaction.userId).select('+wallet.encryptedWalletData');
    
    if (!user || !user.wallet) {
      console.error(`❌ User or wallet not found`);
      
      transaction.status = 'FAILED';
      transaction.failureReason = 'User wallet not found';
      await transaction.save();
      
      res.status(400).json({
        success: false,
        error: 'User wallet not found'
      });
      return;
    }
  
    console.log(`💰 Creating smart contract order`);
    console.log(`   Amount: ${transaction.usdcAmount} USDC`);
    console.log(`   Rate: ₦${transaction.exchangeRate}`);
    console.log(`   To: ${transaction.walletAddress}`);
  
    try {
      // Use smart contract to transfer USDC from admin wallet to user
      const network = (user.wallet.network || 'base-mainnet') as NetworkType;
      
      const result = await createAbokiOrder(
        transaction.usdcAmount,
        transaction.exchangeRate,
        transaction.walletAddress,
        network
      );
  
      transaction.status = 'COMPLETED';
      transaction.transactionHash = result.transactionHash;
      transaction.completedAt = new Date();
      await transaction.save();
  
      console.log(`✅ USDC CREDITED SUCCESSFULLY VIA SMART CONTRACT`);
      console.log(`   Transaction Hash: ${result.transactionHash}`);
      console.log(`   Block: ${result.blockNumber}`);
      console.log(`   Explorer: ${result.explorerUrl}`);
  
      res.status(200).json({
        success: true,
        message: 'USDC credited successfully',
        data: {
          transactionHash: result.transactionHash,
          amount: transaction.usdcAmount,
          usdcAmount: transaction.usdcAmount,
          walletAddress: transaction.walletAddress,
          explorerUrl: result.explorerUrl,
          blockNumber: result.blockNumber
        }
      });
    } catch (sendError: any) {
      console.error('❌ CRITICAL: Failed to create smart contract order');
      console.error('   Error:', sendError.message);
      
      transaction.status = 'FAILED';
      transaction.failureReason = `Smart contract order failed: ${sendError.message}`;
      await transaction.save();
  
      console.error('🚨 URGENT: Manual intervention required!');
      console.error(`   Transaction ID: ${transaction._id}`);
      console.error(`   User: ${user.username}`);
      console.error(`   Amount: ${transaction.usdcAmount} USDC`);
      console.error(`   Wallet: ${transaction.walletAddress}`);
      console.error(`   Payment Reference: ${paymentReference}`);
      console.error(`   Monnify Reference: ${transactionReference}`);
  
      res.status(500).json({
        success: false,
        error: 'Failed to credit USDC. Support team notified.'
      });
    }
  }
  
/**
 * @desc    Get onramp transaction history
 * @route   GET /api/onramp/history
 * @access  Private
 */
export const getOnrampHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const transactions = await OnrampTransaction.find({
      userId: req.user?.id
    })
    .select('-userId')
    .sort({ createdAt: -1 })
    .limit(50);

    // Add explorer URLs for completed transactions
    const transactionsWithUrls = transactions.map(tx => {
      const txObj = tx.toObject();
      return {
        ...txObj,
        ...(txObj.transactionHash && {
          explorerUrl: `https://basescan.org/tx/${txObj.transactionHash}`
        })
      };
    });

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactionsWithUrls
    });
  } catch (error: any) {
    console.error('❌ Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch history'
    });
  }
};

export default {
  getOnrampRate,
  initializeOnramp,
  handleMonnifyWebhook,
  verifyPayment,
  getOnrampHistory
};