// ============= src/controllers/offrampController.ts (COMPLETE & FIXED) =============

import { Request, Response } from 'express';
import crypto from 'crypto';
import OfframpTransaction from '../models/OfframpTransaction';
import Beneficiary from '../models/Beneficiary';
import FrequentAccount from '../models/FrequentAccount';
import User from '../models/User';
import { getOfframpRate } from '../services/offrampRateService';
import { executeAbokiCreateOrder } from '../services/paymasterService';
import { 
  verifyBankAccount, 
  initiateLencoTransfer, 
  verifyWebhookSignature 
} from '../services/lencoService';

const ADMIN_WALLET_ADDRESS = process.env.ADMIN_WALLET_ADDRESS || '';

// ============= HELPER FUNCTIONS =============

function generateTransactionReference(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `ABOKI_OFFRAMP_${timestamp}${random}`.toUpperCase();
}

function logTransaction(stage: string, data: any): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 ${stage}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(JSON.stringify(data, null, 2));
  console.log(`${'═'.repeat(70)}\n`);
}

// ============= GET RATE =============

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

// ============= INITIATE OFFRAMP =============

export const initiateOfframp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      amountUSDC, 
      beneficiary, 
      accountNumber,
      bankCode,
      name,
      frequentAccountId
    } = req.body;
    
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    if (!amountUSDC) {
      res.status(400).json({ success: false, error: 'Missing required field: amountUSDC' });
      return;
    }

    const amount = parseFloat(amountUSDC);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Invalid amount' });
      return;
    }

    // ============= EXTRACT ACCOUNT DETAILS =============
    let accountDetails: any = {};

    if (beneficiary && beneficiary.accountNumber && beneficiary.bankCode) {
      accountDetails = {
        name: beneficiary.name,
        accountNumber: beneficiary.accountNumber,
        bankCode: beneficiary.bankCode
      };
    }
    else if (accountNumber && bankCode) {
      accountDetails = {
        name: name || 'Unknown',
        accountNumber,
        bankCode
      };
    }
    else if (frequentAccountId) {
      try {
        const frequentAccount = await FrequentAccount.findById(frequentAccountId);
        if (!frequentAccount || frequentAccount.userId.toString() !== userId) {
          res.status(404).json({ success: false, error: 'Frequent account not found' });
          return;
        }
        accountDetails = {
          name: frequentAccount.name || 'Unknown',
          accountNumber: frequentAccount.accountNumber,
          bankCode: frequentAccount.bankCode
        };
      } catch (error: any) {
        res.status(400).json({ success: false, error: 'Invalid frequent account ID' });
        return;
      }
    }
    else {
      res.status(400).json({
        success: false,
        error: 'Missing account details'
      });
      return;
    }

    const { name: accName, accountNumber: accNumber, bankCode: accCode } = accountDetails;

    logTransaction('INITIATE OFFRAMP', {
      userId,
      amountUSDC: amount,
      beneficiary: {
        name: accName,
        accountNumber: accNumber.slice(-4).padStart(accNumber.length, '*'),
        bankCode: accCode
      }
    });

    // ============= STEP 1: Verify Bank Account =============
    console.log(`\n🏦 Step 1: Verifying bank account with Lenco...`);
    let bankDetails;
    try {
      bankDetails = await verifyBankAccount(accCode, accNumber);
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
      res.status(400).json({ success: false, error: 'Failed to calculate rate' });
      return;
    }

    // ============= STEP 3: Validate Amount =============
    console.log(`\n💰 Step 3: Validating offramp amount...`);
    
    if (amount < 0.1) {
      res.status(400).json({ success: false, error: 'Minimum offramp amount is 0.1 USDC' });
      return;
    }

    if (amount > 5000) {
      res.status(400).json({ success: false, error: 'Maximum offramp amount is 5000 USDC' });
      return;
    }

    console.log(`   ✅ Amount validation passed (${amount} USDC is within limits)`);

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
      res.status(500).json({ success: false, error: 'Failed to get user wallet' });
      return;
    }

    // ============= STEP 5: Create Transaction Record =============
    console.log(`\n📝 Step 5: Creating transaction record...`);
    const transactionReference = generateTransactionReference();

    // ✅ FIX: Ensure source is valid enum value
    let validSource: 'Paycrest' | 'Fallback' = 'Fallback';
    if (rateData.data.source === 'Paycrest' || rateData.data.source === 'Fallback') {
      validSource = rateData.data.source;
    }

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
        name: bankDetails.accountName || accName,
        accountNumber: accNumber,
        bankCode: accCode,
        bankName: bankDetails.bankName
      },
      lpFeeUSDC: rateData.data.calculation.lpFeeUSDC,
      status: 'PENDING',
      rateSource: validSource,
      cached: rateData.data.cached,
      webhookAttempts: 0
    });

    await transaction.save();
    console.log(`   ✅ Transaction created: ${transactionReference}`);

    // ============= STEP 6: Record Frequent Account =============
    console.log(`\n📊 Step 6: Recording frequent account...`);
    try {
      await FrequentAccount.recordUsage(userId, accNumber, accCode, amount, accName);
      console.log(`   ✅ Frequent account recorded`);
    } catch (error: any) {
      console.warn(`   ⚠️ Failed to record frequent account: ${error.message}`);
    }

    // ============= RESPONSE =============
    res.status(201).json({
      success: true,
      message: 'Offramp initiated. Call Aboki.createOrder() via Smart Account (gasless)',
      data: {
        transactionReference,
        status: 'PENDING',
        amountUSDC: amount,
        feeUSDC: rateData.data.fee.amountUSDC,
        netUSDC: rateData.data.calculation.netUSDC,
        amountNGN: rateData.data.calculation.ngnAmount,
        offrampRate: rateData.data.offrampRate,
        bankName: bankDetails.bankName,
        accountNumber: accNumber.slice(-4).padStart(accNumber.length, '*'),
        accountName: bankDetails.accountName || accName,
        userSmartAccount: user.wallet.smartAccountAddress,
        adminLiquidityProvider: ADMIN_WALLET_ADDRESS,
        nextStep: 'Smart Account calls Aboki.createOrder() (gasless via Paymaster)',
        timeLimit: '1 hour'
      }
    });

    logTransaction('OFFRAMP INITIATED', { transactionReference, status: 'PENDING' });
  } catch (error: any) {
    console.error('❌ ERROR INITIATING OFFRAMP');
    console.error('Error Message:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to initiate offramp',
      details: error.message
    });
  }
};

// ============= CONFIRM ACCOUNT AND SIGN =============
// Called AFTER Smart Account has called Aboki.createOrder()
// txHash proves the createOrder transaction was successful

// ============= UPDATE: confirmAccountAndSign in offrampController.ts =============

export const confirmAccountAndSign = async (req: Request, res: Response): Promise<void> => {
  try {
    const { transactionReference, accountNumber, bankCode, userPrivateKey } = req.body;
    const userId = (req as any).user?.id;
    const passkeyVerified = req.headers['x-passkey-verified'];

    console.log('\n' + '═'.repeat(70));
    console.log('🔐 CONFIRM ACCOUNT & SIGN TRANSACTION');
    console.log('═'.repeat(70));

    // ============= STEP 1: Validate Passkey =============
    console.log('\n✓ Step 1: Validating passkey verification...');
    
    if (!userId) {
      console.error('  ❌ User not authenticated');
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    if (!passkeyVerified || passkeyVerified !== 'true') {
      console.error('  ❌ Passkey verification header missing or invalid');
      res.status(401).json({
        success: false,
        error: 'Passkey verification required',
        code: 'PASSKEY_VERIFICATION_REQUIRED'
      });
      return;
    }

    console.log('  ✅ Passkey verification header valid');

    // ============= STEP 2: Validate Input =============
    console.log('\n✓ Step 2: Validating input...');
    
    if (!transactionReference || !accountNumber || !bankCode) {
      console.error('  ❌ Missing required fields');
      res.status(400).json({
        success: false,
        error: 'Missing required fields: transactionReference, accountNumber, bankCode'
      });
      return;
    }

    console.log('  ✅ All required fields present');

    // ============= STEP 3: Find Transaction =============
    console.log('\n✓ Step 3: Finding transaction...');
    
    const transaction = await OfframpTransaction.findOne({
      transactionReference,
      userId
    });

    if (!transaction) {
      console.error('  ❌ Transaction not found');
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    if (transaction.status !== 'PENDING') {
      console.error(`  ❌ Transaction status is ${transaction.status}, not PENDING`);
      res.status(400).json({
        success: false,
        error: `Transaction is already ${transaction.status}. Cannot confirm again.`
      });
      return;
    }

    console.log(`  ✅ Transaction found: ${transactionReference}`);
    console.log(`     Status: ${transaction.status}`);
    console.log(`     Amount: ${transaction.amountUSDC} USDC → ₦${transaction.amountNGN.toFixed(2)}`);

    // ============= STEP 4: Verify Account Details Match =============
    console.log('\n✓ Step 4: Verifying account details match...');
    
    if (accountNumber !== transaction.beneficiary.accountNumber) {
      console.error(`  ❌ Account number mismatch`);
      res.status(400).json({ success: false, error: 'Account number does not match' });
      return;
    }

    if (bankCode !== transaction.beneficiary.bankCode) {
      console.error(`  ❌ Bank code mismatch`);
      res.status(400).json({ success: false, error: 'Bank code does not match' });
      return;
    }

    console.log('  ✅ Account details verified');

    // ============= STEP 5: GET USER'S ENCRYPTED PRIVATE KEY =============
    // ✅ FIX: Fetch from database like in transferController
    console.log('\n✓ Step 5: Retrieving user wallet...');
    
    const user = await User.findById(userId).select('+wallet.encryptedWalletData');
    
    if (!user || !user.wallet) {
      console.error('  ❌ User wallet not found');
      res.status(404).json({ success: false, error: 'User wallet not found' });
      return;
    }

    if (!user.wallet.encryptedWalletData) {
      console.error('  ❌ Encrypted private key not found');
      res.status(400).json({
        success: false,
        error: 'Wallet not properly configured. Please create a wallet first.'
      });
      return;
    }

    console.log('  ✅ Wallet found');

    // ============= STEP 6: Execute Aboki.createOrder() via Smart Account =============
    console.log('\n✓ Step 6: Executing Aboki.createOrder() via Smart Account...');
    console.log('  📍 Smart Account will execute gasless transaction');
    console.log(`  💳 Amount: ${transaction.amountUSDC} USDC`);
    console.log(`  👤 Admin Liquidity Provider: ${ADMIN_WALLET_ADDRESS}`);
    console.log(`  🔄 Gas: SPONSORED by Paymaster`);

    let txHash: string;
    try {
      // ✅ USE: user.wallet.encryptedWalletData instead of userPrivateKey from request
      const result = await executeAbokiCreateOrder(
        user.wallet.encryptedWalletData,          // ✅ FROM DATABASE
        transaction.userAddress,                   // Smart Account address
        transaction.amountUSDC.toString(),          // Amount in USDC (as string)
        transaction.offrampRate,                    // Exchange rate
        ADMIN_WALLET_ADDRESS,                       // Admin LP receives USDC
        'base-mainnet'                              // Network
      );

      txHash = result.transactionHash;
      console.log(`  ✅ Aboki.createOrder() executed!`);
      console.log(`     TxHash: ${txHash.slice(0, 20)}...`);
      console.log(`     Gas: ✨ SPONSORED (FREE)`);
    } catch (error: any) {
      console.error(`  ❌ Smart Account execution failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to execute Aboki order',
        details: error.message
      });
      return;
    }

    // ============= STEP 7: Update Transaction Status =============
    console.log('\n✓ Step 7: Updating transaction status...');
    
    transaction.status = 'PROCESSING';
    transaction.processedAt = new Date();
    transaction.passkeyVerified = true;
    transaction.passkeyVerifiedAt = new Date();
    transaction.transactionHash = txHash;
    
    await transaction.save();
    
    console.log('  ✅ Status updated to PROCESSING');
    console.log('  ✅ Passkey verification recorded');
    console.log(`  ✅ Blockchain txHash: ${txHash.slice(0, 20)}...`);

    // ============= STEP 8: Initiate Lenco Settlement =============
    console.log('\n✓ Step 8: Initiating Lenco settlement...');
    console.log('  💡 USDC received by admin wallet via Aboki');
    console.log('  💸 Now settling NGN to user\'s bank account...');
    
    let lencoResult;
    try {
      lencoResult = await initiateLencoTransfer(
        transaction.amountNGN,
        transaction.beneficiary.accountNumber,
        transaction.beneficiary.bankCode,
        transaction.beneficiary.name,
        transactionReference
      );

      if (!lencoResult.success) {
        throw new Error(lencoResult.error || 'Lenco transfer failed');
      }

      transaction.status = 'SETTLING';
      transaction.lencoReference = lencoResult.transferId;
      transaction.settledAt = new Date();
      
      await transaction.save();
      
      console.log('  ✅ Lenco settlement initiated');
      console.log(`     Reference: ${lencoResult.transferId}`);

    } catch (error: any) {
      console.error(`  ❌ Lenco settlement failed: ${error.message}`);
      
      transaction.status = 'FAILED';
      transaction.errorCode = 'LENCO_ERROR';
      transaction.errorMessage = 'Lenco settlement failed';
      transaction.failureReason = error.message;
      transaction.completedAt = new Date();
      
      await transaction.save();

      res.status(500).json({
        success: false,
        error: 'Failed to initiate bank settlement',
        details: error.message,
        hint: 'USDC was received but NGN settlement failed. Contact support.'
      });
      return;
    }

    // ============= STEP 9: Record Frequent Account =============
    console.log('\n✓ Step 9: Recording frequent account...');
    
    try {
      await FrequentAccount.recordUsage(
        userId,
        accountNumber,
        bankCode,
        transaction.amountUSDC,
        transaction.beneficiary.name
      );
      console.log('  ✅ Frequent account recorded');
    } catch (error: any) {
      console.warn(`  ⚠️ Failed to record frequent account: ${error.message}`);
    }

    // ============= RESPONSE =============
    console.log('\n✅ OFFRAMP PROCESSING');
    console.log(`Blockchain: ${txHash.slice(0, 20)}...`);
    console.log(`Lenco: ${lencoResult?.transferId}`);
    console.log(`Status: ${transaction.status}`);
    console.log('═'.repeat(70) + '\n');

    const successPageParams = new URLSearchParams({
      txHash: txHash,
      reference: transactionReference,
      amountUSDC: transaction.amountUSDC.toString(),
      amountNGN: transaction.amountNGN.toFixed(2),
      accountName: transaction.beneficiary.name,
      bankName: transaction.beneficiary.bankName || ''
    }).toString();
    
    const redirectTo = `/send/bank-success?${successPageParams}`;

    res.status(200).json({
        success: true,
        message: 'Aboki order confirmed. NGN settlement in progress.',
        redirectTo: redirectTo,  // ← ADD THIS
      data: {
        transactionReference,
        status: transaction.status,
        amountUSDC: transaction.amountUSDC,
        feeUSDC: transaction.feeUSDC,
        netUSDC: transaction.netUSDC,
        amountNGN: transaction.amountNGN,
        accountName: transaction.beneficiary.name,
        accountNumber: transaction.beneficiary.accountNumber,
        bankName: transaction.beneficiary.bankName,
        bankCode: transaction.beneficiary.bankCode,
        transactionHash: txHash,
        lencoReference: lencoResult?.transferId,
        verifiedWithPasskey: true,
        verifiedAt: transaction.passkeyVerifiedAt?.toISOString(),
        estimatedSettlementTime: '5-15 minutes',
        nextStep: 'Wait for NGN settlement to your bank account',
        gasSponsored: true,
        explorerUrl: `https://basescan.org/tx/${txHash}`
      }
    });

  } catch (error: any) {
    console.error('❌ Error confirming account and signing:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to confirm account and sign transaction',
      details: error.message
    });
  }
};

// ============= GET STATUS =============

export const getStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reference } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const transaction = await OfframpTransaction.findOne({
      transactionReference: reference,
      userId
    });

    if (!transaction) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: transaction.getSummary()
    });
  } catch (error: any) {
    console.error('❌ Error getting status:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
};

// ============= GET HISTORY =============

export const getHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const { limit = '10', skip = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 10, 50);
    const skipNum = parseInt(skip as string) || 0;

    const transactions = await OfframpTransaction.findUserTransactions(userId, limitNum, skipNum);
    const total = await OfframpTransaction.countDocuments({ userId });

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: { total, limit: limitNum, skip: skipNum, hasMore: skipNum + limitNum < total }
    });
  } catch (error: any) {
    console.error('❌ Error fetching history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
};

// ============= LENCO WEBHOOK =============

export const handleLencoWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log(`\n🪝 Lenco Webhook Received`);

    const signature = req.headers['x-lenco-signature'] as string;
    if (!signature) {
      console.error('   ❌ Missing signature');
      res.status(401).json({ success: false, error: 'Missing signature' });
      return;
    }

    const isValid = verifyWebhookSignature(req.body, signature);

    if (!isValid) {
      console.error('   ❌ Invalid signature');
      res.status(401).json({ success: false, error: 'Invalid signature' });
      return;
    }

    console.log(`   ✅ Signature verified`);

    const { event, data } = req.body;

    if (event === 'transfer.completed') {
      console.log(`   ✅ Transfer completed event`);

      const transaction = await OfframpTransaction.findOne({ lencoReference: data.reference });

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

      const transaction = await OfframpTransaction.findOne({ lencoReference: data.reference });

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

// ============= VERIFY ACCOUNT =============

export const verifyAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountNumber, bankCode } = req.body;

    console.log(`\n🔍 Verifying bank account...`);

    if (!/^\d{10}$/.test(accountNumber)) {
      res.status(400).json({ success: false, error: 'Invalid account number. Must be 10 digits.' });
      return;
    }

    const bankDetails = await verifyBankAccount(bankCode, accountNumber);

    if (!bankDetails.success) {
      console.error(`   ❌ Verification failed: ${bankDetails.error}`);
      res.status(400).json({
        success: false,
        error: bankDetails.error || 'Account verification failed'
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

// ============= BENEFICIARY ENDPOINTS =============

export const addBeneficiary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { name, accountNumber, bankCode } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    if (!name || !accountNumber || !bankCode) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    let bankDetails;
    try {
      bankDetails = await verifyBankAccount(bankCode, accountNumber);
    } catch (error: any) {
      res.status(400).json({ success: false, error: 'Bank account verification failed' });
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
    res.status(500).json({ success: false, error: 'Failed to add beneficiary' });
  }
};

export const getBeneficiaries = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const beneficiaries = await Beneficiary.getUserBeneficiaries(userId);

    res.status(200).json({ success: true, data: beneficiaries });
  } catch (error: any) {
    console.error('❌ Error getting beneficiaries:', error);
    res.status(500).json({ success: false, error: 'Failed to get beneficiaries' });
  }
};

export const deleteBeneficiary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const beneficiary = await Beneficiary.findById(id);

    if (!beneficiary || beneficiary.userId.toString() !== userId) {
      res.status(404).json({ success: false, error: 'Beneficiary not found' });
      return;
    }

    if (!beneficiary.canDelete()) {
      res.status(400).json({ success: false, error: 'Cannot delete default beneficiary' });
      return;
    }

    await Beneficiary.softDelete(id);

    res.status(200).json({ success: true, message: 'Beneficiary deleted' });
  } catch (error: any) {
    console.error('❌ Error deleting beneficiary:', error);
    res.status(500).json({ success: false, error: 'Failed to delete beneficiary' });
  }
};

export const setDefaultBeneficiary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const beneficiary = await Beneficiary.findById(id);

    if (!beneficiary || beneficiary.userId.toString() !== userId) {
      res.status(404).json({ success: false, error: 'Beneficiary not found' });
      return;
    }

    await Beneficiary.setAsDefault(userId, id);

    res.status(200).json({ success: true, data: { id, isDefault: true } });
  } catch (error: any) {
    console.error('❌ Error setting default beneficiary:', error);
    res.status(500).json({ success: false, error: 'Failed to set default beneficiary' });
  }
};

export const getFrequentAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { type = 'top', limit = '5' } = req.query;

    if (!userId) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const limitNum = Math.min(parseInt(limit as string) || 5, 20);

    let accounts;
    if (type === 'recent') {
      accounts = await FrequentAccount.getRecentAccounts(userId, limitNum);
    } else {
      accounts = await FrequentAccount.getTopAccounts(userId, limitNum);
    }

    res.status(200).json({ success: true, data: accounts });
  } catch (error: any) {
    console.error('❌ Error getting frequent accounts:', error);
    res.status(500).json({ success: false, error: 'Failed to get frequent accounts' });
  }
};

// ============= EXPORTS =============

export default {
  getRate,
  initiateOfframp,
  confirmAccountAndSign,
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