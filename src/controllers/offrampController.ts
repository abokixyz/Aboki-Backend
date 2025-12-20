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
 * Get offramp rate with fee breakdown
 * @swagger
 * /api/offramp/rate:
 *   get:
 *     summary: Get current offramp rate
 *     description: |
 *       Get the current USDC/NGN exchange rate with detailed fee breakdown.
 *       
 *       Rate Calculation:
 *       - Base Rate: From Paycrest (fallback: 1400 NGN/USDC)
 *       - Offramp Rate: Base Rate + ₦20 markup
 *       - Fee: 1% of USDC (capped at $2) - DEDUCTED from amount
 *       - LP Fee: 0.5% of net USDC to admin wallet
 *       
 *       Example: 100 USDC offramp
 *       - Fee: 1 USDC (1% of 100)
 *       - Net: 99 USDC
 *       - NGN: 99 × 1420 = 140,580 NGN
 *       - You receive: ₦140,580
 *     tags: [Offramp]
 *     parameters:
 *       - in: query
 *         name: amountUSDC
 *         required: true
 *         schema:
 *           type: number
 *         description: Amount in USDC to offramp
 *         example: 100
 *     responses:
 *       200:
 *         description: Rate calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     baseRate:
 *                       type: number
 *                       example: 1400
 *                     offrampRate:
 *                       type: number
 *                       example: 1420
 *                     calculation:
 *                       type: object
 *                       properties:
 *                         amountUSDC:
 *                           type: number
 *                         feeUSDC:
 *                           type: number
 *                         netUSDC:
 *                           type: number
 *                         ngnAmount:
 *                           type: number
 *       400:
 *         description: Invalid amount parameter
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
 * Initiate USDC to NGN offramp
 * @swagger
 * /api/offramp/initiate:
 *   post:
 *     summary: Initiate offramp transaction
 *     description: |
 *       Start a USDC to NGN conversion. Transaction remains PENDING until user confirms
 *       the blockchain transaction from their Smart Account.
 *       
 *       Process:
 *       1. Validate beneficiary bank account (via Lenco)
 *       2. Calculate rate and fees
 *       3. Create transaction record (status: PENDING)
 *       4. User receives transaction reference
 *       5. User signs Aboki.createOrder() with Smart Account (gasless)
 *       6. User calls /confirm-transfer with transaction hash
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountUSDC
 *               - beneficiary
 *             properties:
 *               amountUSDC:
 *                 type: number
 *                 minimum: 10
 *                 maximum: 5000
 *                 example: 100
 *                 description: Amount to convert (10-5000 USDC)
 *               beneficiary:
 *                 type: object
 *                 required:
 *                   - name
 *                   - accountNumber
 *                   - bankCode
 *                 properties:
 *                   name:
 *                     type: string
 *                     example: John Doe
 *                   accountNumber:
 *                     type: string
 *                     example: "1234567890"
 *                   bankCode:
 *                     type: string
 *                     description: Nigerian bank code (e.g., 011 for First Bank)
 *                     example: "011"
 *     responses:
 *       201:
 *         description: Offramp initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionReference:
 *                       type: string
 *                       example: ABOKI_OFFRAMP_abc123def456
 *                     status:
 *                       type: string
 *                       enum: [PENDING]
 *                     amountUSDC:
 *                       type: number
 *                     amountNGN:
 *                       type: number
 *                     nextStep:
 *                       type: string
 *                       example: "User Smart Account signs Aboki.createOrder() (gasless via Paymaster)"
 *       400:
 *         description: Invalid request or beneficiary verification failed
 *       401:
 *         description: User not authenticated
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
 * Confirm blockchain transaction
 * @swagger
 * /api/offramp/confirm-transfer:
 *   post:
 *     summary: Confirm blockchain USDC transfer
 *     description: |
 *       Confirm that the user's Smart Account has successfully transferred USDC to the admin wallet.
 *       Once confirmed, backend initiates NGN settlement with Lenco (5-15 minutes).
 *       
 *       Status Flow: PENDING → PROCESSING → SETTLING → COMPLETED
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionReference
 *               - txHash
 *             properties:
 *               transactionReference:
 *                 type: string
 *                 example: ABOKI_OFFRAMP_abc123def456
 *                 description: Reference from /initiate response
 *               txHash:
 *                 type: string
 *                 example: "0x1234567890abcdef..."
 *                 description: Blockchain transaction hash
 *     responses:
 *       200:
 *         description: Transfer confirmed, settlement in progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionReference:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [SETTLING]
 *                     txHash:
 *                       type: string
 *                     lencoReference:
 *                       type: string
 *                     estimatedSettlementTime:
 *                       type: string
 *                       example: "5-15 minutes"
 *       400:
 *         description: Transaction not found or already processed
 *       401:
 *         description: User not authenticated
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
 * Get transaction status
 * @swagger
 * /api/offramp/status/{reference}:
 *   get:
 *     summary: Get offramp transaction status
 *     description: Check the current status of an offramp transaction (PENDING, PROCESSING, SETTLING, COMPLETED, FAILED)
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction reference (ABOKI_OFFRAMP_...)
 *         example: ABOKI_OFFRAMP_abc123def456
 *     responses:
 *       200:
 *         description: Transaction status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionReference:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [PENDING, PROCESSING, SETTLING, COMPLETED, FAILED]
 *                     amountUSDC:
 *                       type: number
 *                     amountNGN:
 *                       type: number
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: User not authenticated
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
 * Get transaction history
 * @swagger
 * /api/offramp/history:
 *   get:
 *     summary: Get offramp transaction history
 *     description: Get all your offramp transactions with pagination support
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Number of transactions to return
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of transactions to skip (for pagination)
 *     responses:
 *       200:
 *         description: Transaction history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     skip:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         description: User not authenticated
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
 * Handle Lenco webhook
 * @swagger
 * /api/offramp/webhook/lenco:
 *   post:
 *     summary: Lenco settlement webhook
 *     description: |
 *       Webhook endpoint for Lenco to confirm settlement completion or failure.
 *       Updates transaction status to COMPLETED or FAILED.
 *       
 *       Lenco sends POST request when NGN settlement is complete.
 *       Signature is verified for security.
 *     tags: [Offramp]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 enum: [transfer.completed, transfer.failed]
 *               data:
 *                 type: object
 *                 properties:
 *                   reference:
 *                     type: string
 *                   reason:
 *                     type: string
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       401:
 *         description: Invalid signature
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
 * Verify bank account
 */
export const verifyAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountNumber, bankCode } = req.body;
  
      console.log(`\n🔍 Verifying bank account...`);
      console.log(`   Account: ${accountNumber}`);
      console.log(`   Bank Code: ${bankCode}`);
  
      // Validate account number format
      if (!/^\d{10}$/.test(accountNumber)) {
        res.status(400).json({
          success: false,
          error: 'Invalid account number. Must be 10 digits.'
        });
        return;
      }
  
      // Call Lenco verification service
      const bankDetails = await verifyBankAccount(bankCode, accountNumber);
  
      if (!bankDetails.success) {
        console.error(`   ❌ Verification failed: ${bankDetails.error}`);
        res.status(400).json({
          success: false,
          error: bankDetails.error || 'Account verification failed',
          details: 'Please check the account number and bank code'
        });
        return;
      }
  
      console.log(`   ✅ Account verified: ${bankDetails.accountName}`);
  
      res.status(200).json({
        success: true,
        message: 'Account verified successfully',
        data: {
          accountName: bankDetails.accountName,
          accountNumber: bankDetails.accountNumber,
          bankCode: bankDetails.bankCode,
          bankName: bankDetails.bankName,
          isVerified: true
        }
      });
    } catch (error: any) {
      console.error('❌ Error verifying account:', error);
      res.status(500).json({
        success: false,
        error: 'Account verification failed',
        details: error.message
      });
    }
  };
  

/**
 * Add beneficiary bank account
 * @swagger
 * /api/offramp/beneficiaries:
 *   post:
 *     summary: Add beneficiary bank account
 *     description: Add a new bank account as a beneficiary for offramp transactions
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - accountNumber
 *               - bankCode
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *               accountNumber:
 *                 type: string
 *                 example: "1234567890"
 *               bankCode:
 *                 type: string
 *                 example: "011"
 *     responses:
 *       201:
 *         description: Beneficiary added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     isVerified:
 *                       type: boolean
 *       400:
 *         description: Beneficiary verification failed
 *       401:
 *         description: User not authenticated
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
 * Get beneficiaries
 * @swagger
 * /api/offramp/beneficiaries:
 *   get:
 *     summary: Get all beneficiaries
 *     description: Retrieve all saved beneficiary bank accounts
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Beneficiaries retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: User not authenticated
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
 * Delete beneficiary
 * @swagger
 * /api/offramp/beneficiaries/{id}:
 *   delete:
 *     summary: Delete beneficiary
 *     description: Remove a beneficiary account (cannot delete default)
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Beneficiary ID
 *     responses:
 *       200:
 *         description: Beneficiary deleted
 *       400:
 *         description: Cannot delete default beneficiary
 *       404:
 *         description: Beneficiary not found
 *       401:
 *         description: User not authenticated
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
 * Set default beneficiary
 * @swagger
 * /api/offramp/beneficiaries/{id}/default:
 *   put:
 *     summary: Set default beneficiary
 *     description: Set a beneficiary as the default for offramp transactions
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Beneficiary ID
 *     responses:
 *       200:
 *         description: Default beneficiary updated
 *       404:
 *         description: Beneficiary not found
 *       401:
 *         description: User not authenticated
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
 * Get frequent accounts
 * @swagger
 * /api/offramp/frequent-accounts:
 *   get:
 *     summary: Get frequently used bank accounts
 *     description: Get list of frequently used bank accounts for quick offramp selection
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [top, recent]
 *           default: top
 *         description: Sort by top (most used) or recent
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *           maximum: 20
 *         description: Number of accounts to return
 *     responses:
 *       200:
 *         description: Frequent accounts retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: User not authenticated
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
  verifyAccount, 
  setDefaultBeneficiary,
  getFrequentAccounts
};