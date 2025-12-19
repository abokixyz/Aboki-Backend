// ============= src/controllers/offrampController.ts =============
/**
 * OFFRAMP FLOW (CORRECTED):
 * 
 * 1. User initiates offramp → Creates transaction, status: PENDING
 * 2. User sends USDC via Smart Account (gasless, Paymaster sponsors)
 * 3. User signs Aboki.createOrder() call (Smart Account owner)
 * 4. Aboki contract:
 *    - Takes 100 USDC from user's Smart Account
 *    - Deducts 0.5% LP fee = 0.50 USDC → Treasury
 *    - Sends 99.50 USDC to admin wallet (liquidity provider)
 * 5. Backend updates status to PROCESSING
 * 6. Backend initiates Lenco settlement
 * 7. Lenco settles NGN to user's bank (5-15 minutes)
 * 8. Lenco webhook confirms → Transaction COMPLETED
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import OfframpTransaction from '../models/OfframpTransaction';
import Beneficiary from '../models/Beneficiary';
import FrequentAccount from '../models/FrequentAccount';
import User from '../models/User';
import { getOfframpRate } from '../services/offrampRateService';
import { 
  verifyBankAccount, 
  initiateLencoTransfer, 
  verifyWebhookSignature 
} from '../services/lencoService';
import {
  performPreflightChecks
} from '../services/adminWalletService';

const LENCO_WEBHOOK_SECRET = process.env.LENCO_WEBHOOK_SECRET || '';
const ADMIN_WALLET_ADDRESS = process.env.ADMIN_WALLET_ADDRESS || '';

// ============= HELPER FUNCTIONS =============

/**
 * Generate unique transaction reference
 */
function generateTransactionReference(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `ABOKI_OFFRAMP_${timestamp}${random}`.toUpperCase();
}

/**
 * Log transaction details
 */
function logTransaction(stage: string, data: any): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 ${stage}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(JSON.stringify(data, null, 2));
  console.log(`${'═'.repeat(70)}\n`);
}

// ============= CONTROLLERS =============

/**
 * @desc    Get offramp rate (detailed breakdown - PAYCREST)
 * @route   GET /api/offramp/rate?amountUSDC=100
 * @access  Public
 */
export const getRate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amountUSDC } = req.query;

    if (!amountUSDC) {
      res.status(400).json({
        success: false,
        error: 'amountUSDC query parameter is required. Example: /api/offramp/rate?amountUSDC=100'
      });
      return;
    }

    const amount = parseFloat(amountUSDC as string);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be a positive number.'
      });
      return;
    }

    const rateResponse = await getOfframpRate(amount);
    res.status(200).json(rateResponse);
  } catch (error: any) {
    console.error('❌ Error getting rate:', error.message);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to get rate'
    });
  }
};

/**
 * @desc    Initiate offramp (USDC → NGN)
 * @route   POST /api/offramp/initiate
 * @access  Private (requires JWT)
 */
export const initiateOfframp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amountUSDC, beneficiary } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!amountUSDC || !beneficiary) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: amountUSDC, beneficiary'
      });
      return;
    }

    const { name, accountNumber, bankCode } = beneficiary;
    if (!name || !accountNumber || !bankCode) {
      res.status(400).json({
        success: false,
        error: 'Missing beneficiary fields: name, accountNumber, bankCode'
      });
      return;
    }

    const amount = parseFloat(amountUSDC);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
      return;
    }

    logTransaction('INITIATE OFFRAMP', {
      userId,
      amountUSDC: amount,
      beneficiary: {
        name,
        accountNumber: accountNumber.slice(-4).padStart(accountNumber.length, '*'),
        bankCode
      }
    });

    // ============= STEP 1: Verify Bank Account =============
    console.log(`\n🏦 Step 1: Verifying bank account with Lenco...`);
    let bankDetails;
    try {
      bankDetails = await verifyBankAccount(bankCode, accountNumber);
      console.log(`   ✅ Bank account verified: ${bankDetails.accountName}`);
    } catch (error: any) {
      console.error(`   ❌ Bank verification failed: ${error.message}`);
      res.status(400).json({
        success: false,
        error: 'Bank account verification failed',
        details: error.message
      });
      return;
    }

    // ============= STEP 2: Calculate Rate & Fees =============
    console.log(`\n💹 Step 2: Calculating rate and fees...`);
    let rateData;
    try {
      rateData = await getOfframpRate(amount);
      
      if (!rateData.success || !rateData.data) {
        throw new Error(rateData.error || 'Failed to calculate rate');
      }
      
      console.log(`   Rate: ₦${rateData.data.offrampRate.toFixed(2)}/USDC`);
      console.log(`   Fee: ${rateData.data.fee.amountUSDC.toFixed(6)} USDC`);
      console.log(`   Net USDC: ${rateData.data.calculation.netUSDC.toFixed(6)}`);
      console.log(`   User gets: ₦${rateData.data.calculation.ngnAmount.toFixed(2)}`);
    } catch (error: any) {
      console.error(`   ❌ Rate calculation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        error: 'Failed to calculate rate'
      });
      return;
    }

    // ============= STEP 3: Validate Offramp Amount =============
    console.log(`\n💰 Step 3: Validating offramp amount...`);
    
    // Check minimum and maximum limits
    if (amount < 10) {
      res.status(400).json({
        success: false,
        error: 'Minimum offramp amount is 10 USDC'
      });
      return;
    }

    if (amount > 5000) {
      res.status(400).json({
        success: false,
        error: 'Maximum offramp amount is 5000 USDC'
      });
      return;
    }

    console.log(`   ✅ Amount validation passed (${amount} USDC is within limits)`);
    
    // NOTE: Admin balance is NOT checked for offramp because:
    // - Admin RECEIVES USDC from user's Smart Account
    // - Admin does NOT spend money
    // - Lenco will check their own NGN balance when settlement is initiated
    console.log(`   ℹ️ Admin receives USDC, doesn't spend it`);
    console.log(`   ℹ️ Lenco will validate NGN liquidity during settlement`);

    // ============= STEP 4: Get User Info =============
    console.log(`\n👤 Step 4: Getting user info...`);
    let user;
    try {
      user = await User.findById(userId);
      if (!user || !user.wallet?.smartAccountAddress) {
        res.status(400).json({
          success: false,
          error: 'User wallet not found. Please create a wallet first.'
        });
        return;
      }
      console.log(`   ✅ User Smart Account: ${user.wallet.smartAccountAddress.slice(0, 10)}...`);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'Failed to get user wallet'
      });
      return;
    }

    // ============= STEP 5: Create Transaction Record =============
    console.log(`\n📝 Step 5: Creating transaction record...`);
    const transactionReference = generateTransactionReference();

    const transaction = new OfframpTransaction({
      transactionReference,
      userId,
      userAddress: user.wallet.smartAccountAddress,
      amountUSDC: amount,
      feeUSDC: rateData.data.fee.amountUSDC,
      netUSDC: rateData.data.calculation.netUSDC,
      amountNGN: rateData.data.calculation.ngnAmount,
      baseRate: rateData.data.baseRate,
      offrampRate: rateData.data.offrampRate,
      effectiveRate: rateData.data.calculation.effectiveRate,
      beneficiary: {
        name: bankDetails.accountName || name,
        accountNumber,
        bankCode,
        bankName: bankDetails.bankName
      },
      lpFeeUSDC: rateData.data.calculation.lpFeeUSDC,
      status: 'PENDING',
      rateSource: rateData.data.source as 'Paycrest' | 'Fallback',
      cached: rateData.data.cached,
      webhookAttempts: 0
    });

    await transaction.save();
    console.log(`   ✅ Transaction created: ${transactionReference}`);

    // ============= STEP 6: Record Frequent Account =============
    console.log(`\n📊 Step 6: Recording frequent account...`);
    try {
      await FrequentAccount.recordUsage(
        userId,
        accountNumber,
        bankCode,
        amount,
        name
      );
      console.log(`   ✅ Frequent account recorded`);
    } catch (error: any) {
      console.warn(`   ⚠️ Failed to record frequent account: ${error.message}`);
    }

    // ============= RESPONSE =============
    res.status(201).json({
      success: true,
      message: 'Offramp initiated. User Smart Account will call Aboki.createOrder() (gasless)',
      data: {
        transactionReference,
        status: 'PENDING',
        amountUSDC: amount,
        feeUSDC: rateData.data.fee.amountUSDC,
        netUSDC: rateData.data.calculation.netUSDC,
        amountNGN: rateData.data.calculation.ngnAmount,
        offrampRate: rateData.data.offrampRate,
        bankName: bankDetails.bankName,
        accountNumber: accountNumber.slice(-4).padStart(accountNumber.length, '*'),
        accountName: bankDetails.accountName || name,
        userSmartAccount: user.wallet.smartAccountAddress,
        adminLiquidityProvider: ADMIN_WALLET_ADDRESS,
        nextStep: 'User Smart Account signs Aboki.createOrder() (gasless via Paymaster)',
        timeLimit: '1 hour'
      }
    });

    logTransaction('OFFRAMP INITIATED', { transactionReference, status: 'PENDING' });
  } catch (error: any) {
    console.error('❌ Error initiating offramp:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate offramp',
      details: error.message
    });
  }
};

/**
 * @desc    Confirm blockchain transaction (Smart Account sent USDC)
 * @route   POST /api/offramp/confirm-transfer
 * @access  Private (requires JWT)
 */
export const confirmTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { transactionReference, txHash } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!transactionReference || !txHash) {
      res.status(400).json({
        success: false,
        error: 'Missing transactionReference or txHash'
      });
      return;
    }

    // ============= STEP 1: Find Transaction =============
    console.log(`\n🔍 Step 1: Finding transaction...`);
    const transaction = await OfframpTransaction.findOne({
      transactionReference,
      userId
    });

    if (!transaction) {
      res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
      return;
    }

    if (transaction.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        error: `Transaction is already ${transaction.status}`
      });
      return;
    }

    console.log(`   ✅ Found transaction: ${transactionReference}`);

    // ============= STEP 2: Update Transaction with Blockchain Hash =============
    console.log(`\n📋 Step 2: Updating blockchain confirmation...`);
    transaction.status = 'PROCESSING';
    transaction.transactionHash = txHash;
    transaction.processedAt = new Date();
    await transaction.save();
    console.log(`   ✅ Status: PROCESSING`);
    console.log(`   ✅ Tx Hash: ${txHash.slice(0, 20)}...`);

    // ============= STEP 3: Initiate Lenco Settlement =============
    console.log(`\n💸 Step 3: Initiating Lenco settlement...`);
    let lencoResult;
    try {
      lencoResult = await initiateLencoTransfer(
        transaction.amountNGN,
        transaction.beneficiary.accountNumber,
        transaction.beneficiary.bankCode,
        transaction.beneficiary.name,
        transactionReference
      );

      transaction.status = 'SETTLING';
      transaction.lencoReference = lencoResult.transferId;
      transaction.settledAt = new Date();
      await transaction.save();
      console.log(`   ✅ Lenco transfer initiated: ${lencoResult.transferId}`);
    } catch (error: any) {
      console.error(`   ❌ Lenco settlement failed: ${error.message}`);
      transaction.status = 'FAILED';
      transaction.errorCode = 'LENCO_ERROR';
      transaction.errorMessage = 'Lenco settlement failed';
      transaction.failureReason = error.message;
      transaction.completedAt = new Date();
      await transaction.save();

      res.status(500).json({
        success: false,
        error: 'Failed to initiate bank settlement',
        details: error.message
      });
      return;
    }

    // ============= RESPONSE =============
    res.status(200).json({
      success: true,
      message: 'Blockchain transaction confirmed. NGN settlement in progress (5-15 minutes).',
      data: {
        transactionReference,
        status: transaction.status,
        amountUSDC: transaction.amountUSDC,
        amountNGN: transaction.amountNGN,
        txHash,
        lencoReference: lencoResult.transferId,
        bankName: transaction.beneficiary.bankName,
        accountName: transaction.beneficiary.name,
        estimatedSettlementTime: '5-15 minutes',
        nextStep: 'Wait for Lenco to settle NGN to your bank account'
      }
    });

    logTransaction('OFFRAMP SETTLING', {
      transactionReference,
      txHash,
      lencoReference: lencoResult.transferId,
      status: 'SETTLING'
    });
  } catch (error: any) {
    console.error('❌ Error confirming transfer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm transfer',
      details: error.message
    });
  }
};

/**
 * @desc    Get offramp transaction status
 * @route   GET /api/offramp/status/:reference
 * @access  Private (requires JWT)
 */
export const getStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reference } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const transaction = await OfframpTransaction.findOne({
      transactionReference: reference,
      userId
    });

    if (!transaction) {
      res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: transaction.getSummary()
    });
  } catch (error: any) {
    console.error('❌ Error getting status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get status'
    });
  }
};

/**
 * @desc    Get offramp transaction history
 * @route   GET /api/offramp/history
 * @access  Private (requires JWT)
 */
export const getHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const { limit = '10', skip = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 10, 50);
    const skipNum = parseInt(skip as string) || 0;

    const transactions = await OfframpTransaction.findUserTransactions(
      userId,
      limitNum,
      skipNum
    );

    const total = await OfframpTransaction.countDocuments({ userId });

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        limit: limitNum,
        skip: skipNum,
        hasMore: skipNum + limitNum < total
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history'
    });
  }
};

/**
 * @desc    Handle Lenco webhook confirmation
 * @route   POST /api/offramp/webhook/lenco
 * @access  Public (but signature verified)
 */
export const handleLencoWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log(`\n🪝 Lenco Webhook Received`);

    const signature = req.headers['x-lenco-signature'] as string;
    if (!signature) {
      console.error('   ❌ Missing signature');
      res.status(401).json({ success: false, error: 'Missing signature' });
      return;
    }

    const isValid = verifyWebhookSignature(
      req.body,
      signature
    );

    if (!isValid) {
      console.error('   ❌ Invalid signature');
      res.status(401).json({ success: false, error: 'Invalid signature' });
      return;
    }

    console.log(`   ✅ Signature verified`);

    const { event, data } = req.body;

    if (event === 'transfer.completed') {
      console.log(`   ✅ Transfer completed event`);

      const transaction = await OfframpTransaction.findOne({
        lencoReference: data.reference
      });

      if (!transaction) {
        console.warn(`   ⚠️ Transaction not found for Lenco reference: ${data.reference}`);
        res.status(200).json({ success: true, message: 'Webhook processed' });
        return;
      }

      if (transaction.status === 'COMPLETED') {
        console.log(`   ℹ️ Transaction already completed (idempotency)`);
        res.status(200).json({ success: true, message: 'Already processed' });
        return;
      }

      transaction.status = 'COMPLETED';
      transaction.completedAt = new Date();
      await transaction.save();

      console.log(`   ✅ Transaction marked COMPLETED`);
      console.log(`   User received: ₦${transaction.amountNGN.toFixed(2)}`);

      res.status(200).json({ success: true, message: 'Transaction completed' });
    } else if (event === 'transfer.failed') {
      console.log(`   ❌ Transfer failed event`);

      const transaction = await OfframpTransaction.findOne({
        lencoReference: data.reference
      });

      if (transaction) {
        transaction.status = 'FAILED';
        transaction.errorCode = 'LENCO_FAILED';
        transaction.errorMessage = data.reason || 'Lenco settlement failed';
        transaction.failureReason = data.reason || 'Settlement failed';
        transaction.completedAt = new Date();
        await transaction.save();
        console.log(`   ❌ Transaction marked FAILED: ${data.reason}`);
      }

      res.status(200).json({ success: true, message: 'Failure processed' });
    } else {
      console.log(`   ℹ️ Unhandled event: ${event}`);
      res.status(200).json({ success: true, message: 'Event processed' });
    }
  } catch (error: any) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
};

/**
 * @desc    Add beneficiary
 * @route   POST /api/offramp/beneficiaries
 * @access  Private (requires JWT)
 */
export const addBeneficiary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { name, accountNumber, bankCode } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!name || !accountNumber || !bankCode) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
      return;
    }

    let bankDetails;
    try {
      bankDetails = await verifyBankAccount(bankCode, accountNumber);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: 'Bank account verification failed'
      });
      return;
    }

    const beneficiary = new Beneficiary({
      userId,
      name: bankDetails.accountName || name,
      accountNumber,
      bankCode,
      bankName: bankDetails.bankName,
      isVerified: true,
      verificationStatus: 'VERIFIED',
      verificationDate: new Date()
    });

    await beneficiary.save();

    res.status(201).json({
      success: true,
      data: {
        id: beneficiary._id,
        name: beneficiary.name,
        accountNumber: beneficiary.accountNumber,
        bankCode: beneficiary.bankCode,
        bankName: beneficiary.bankName,
        isVerified: beneficiary.isVerified
      }
    });
  } catch (error: any) {
    console.error('❌ Error adding beneficiary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add beneficiary'
    });
  }
};

/**
 * @desc    Get beneficiaries
 * @route   GET /api/offramp/beneficiaries
 * @access  Private (requires JWT)
 */
export const getBeneficiaries = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const beneficiaries = await Beneficiary.getUserBeneficiaries(userId);

    res.status(200).json({
      success: true,
      data: beneficiaries
    });
  } catch (error: any) {
    console.error('❌ Error getting beneficiaries:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get beneficiaries'
    });
  }
};

/**
 * @desc    Delete beneficiary
 * @route   DELETE /api/offramp/beneficiaries/:id
 * @access  Private (requires JWT)
 */
export const deleteBeneficiary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const beneficiary = await Beneficiary.findById(id);

    if (!beneficiary || beneficiary.userId.toString() !== userId) {
      res.status(404).json({
        success: false,
        error: 'Beneficiary not found'
      });
      return;
    }

    if (!beneficiary.canDelete()) {
      res.status(400).json({
        success: false,
        error: 'Cannot delete default beneficiary'
      });
      return;
    }

    await Beneficiary.softDelete(id);

    res.status(200).json({
      success: true,
      message: 'Beneficiary deleted'
    });
  } catch (error: any) {
    console.error('❌ Error deleting beneficiary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete beneficiary'
    });
  }
};

/**
 * @desc    Set default beneficiary
 * @route   PUT /api/offramp/beneficiaries/:id/default
 * @access  Private (requires JWT)
 */
export const setDefaultBeneficiary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const beneficiary = await Beneficiary.findById(id);

    if (!beneficiary || beneficiary.userId.toString() !== userId) {
      res.status(404).json({
        success: false,
        error: 'Beneficiary not found'
      });
      return;
    }

    await Beneficiary.setAsDefault(userId, id);

    res.status(200).json({
      success: true,
      data: {
        id,
        isDefault: true
      }
    });
  } catch (error: any) {
    console.error('❌ Error setting default beneficiary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set default beneficiary'
    });
  }
};

/**
 * @desc    Get frequent accounts
 * @route   GET /api/offramp/frequent-accounts
 * @access  Private (requires JWT)
 */
export const getFrequentAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { type = 'top', limit = '5' } = req.query;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const limitNum = Math.min(parseInt(limit as string) || 5, 20);

    let accounts;
    if (type === 'recent') {
      accounts = await FrequentAccount.getRecentAccounts(userId, limitNum);
    } else {
      accounts = await FrequentAccount.getTopAccounts(userId, limitNum);
    }

    res.status(200).json({
      success: true,
      data: accounts
    });
  } catch (error: any) {
    console.error('❌ Error getting frequent accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get frequent accounts'
    });
  }
};

export default {
  getRate,
  initiateOfframp,
  confirmTransfer,
  getStatus,
  getHistory,
  handleLencoWebhook,
  addBeneficiary,
  getBeneficiaries,
  deleteBeneficiary,
  setDefaultBeneficiary,
  getFrequentAccounts
};