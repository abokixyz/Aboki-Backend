// ============= src/services/lencoTransferService.ts =============
/**
 * Lenco Transfer Orchestration Service
 * 
 * Purpose: Bridge between app logic and lencoService (API client)
 * Responsibilities:
 * - Create offramp transactions in database
 * - Call lencoService to initiate transfers
 * - Update database with Lenco responses
 * - Handle errors and retries
 * 
 * Uses: lencoService (low-level API client)
 */

import OfframpTransaction from '../models/OfframpTransaction';
import {
  initiateLencoTransfer,
  verifyBankAccount,
  getSupportedBanks,
  getBankName
} from './lencoService';

/**
 * ✅ Create offramp transaction and initiate Lenco transfer
 */
export async function createAndInitiateOfframpTransfer(
  userId: string,
  walletAddress: string,
  amount: number,
  currency: string,
  recipientName: string,
  recipientBankAccount: string,
  recipientBankCode: string,
  baseRate: number,
  offrampRate: number,
  effectiveRate: number,
  feeUSDC: number,
  lpFeeUSDC: number,
  amountUSDC: number,
  netUSDC: number
): Promise<{
  success: boolean;
  message: string;
  transactionId?: string;
  error?: string;
}> {
  try {
    console.log(`\n🔄 Creating offramp transaction...`);
    console.log(`   User: ${userId}`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Recipient: ${recipientName}`);

    // ✅ Generate unique reference for this transaction
    const reference = `ABOKI_OFFRAMP_${Date.now()}_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    console.log(`   Reference: ${reference}`);

    // ✅ Create transaction in database (PENDING state)
    const offrampTx = await OfframpTransaction.create({
      userId,
      userAddress: walletAddress,
      amount: amount,
      currency: currency,
      transactionReference: reference,
      beneficiary: {
        name: recipientName,
        accountNumber: recipientBankAccount,
        bankCode: recipientBankCode,
        bankName: await getBankName(recipientBankCode)
      },
      amountUSDC,
      feeUSDC,
      netUSDC,
      amountNGN: amount,
      baseRate,
      offrampRate,
      effectiveRate,
      lpFeeUSDC,
      status: 'PENDING',
      passkeyVerified: true,
      createdAt: new Date()
    });

    console.log(`   ✅ Transaction created in DB: ${offrampTx._id}`);

    // ✅ Initiate transfer with Lenco via lencoService
    console.log(`\n   💸 Calling lencoService.initiateLencoTransfer()...`);
    
    const lencoResult = await initiateLencoTransfer(
      amount,
      recipientBankAccount,
      recipientBankCode,
      recipientName,
      reference  // ✅ Send YOUR reference to Lenco
    );

    console.log(`   📥 Lenco response:`, lencoResult);

    if (!lencoResult.success) {
      // Initiation failed
      offrampTx.status = 'FAILED';
      offrampTx.errorCode = 'LENCO_INITIATION_FAILED';
      offrampTx.errorMessage = lencoResult.error || 'Failed to initiate transfer with Lenco';
      offrampTx.completedAt = new Date();
      await offrampTx.save();

      return {
        success: false,
        message: lencoResult.error || 'Failed to initiate Lenco transfer',
        transactionId: offrampTx._id.toString(),
        error: lencoResult.error
      };
    }

    // ✅ Transfer initiated successfully
    // Store Lenco's response data
    offrampTx.lencoTransactionId = lencoResult.transferId;
    offrampTx.status = 'PROCESSING';
    offrampTx.initiatedAt = new Date();
    offrampTx.lencoStatus = 'pending';  // ✅ FIXED: Lenco transfers start as pending
    await offrampTx.save();

    console.log(`   ✅ Transaction updated with Lenco ID: ${lencoResult.transferId}`);

    return {
      success: true,
      message: 'Offramp transfer initiated successfully',
      transactionId: offrampTx._id.toString()
    };

  } catch (error: any) {
    console.error(`❌ Error creating offramp transaction:`, error.message);
    return {
      success: false,
      message: error.message,
      error: error.message
    };
  }
}

/**
 * ✅ Verify bank account using lencoService
 */
export async function verifyBankAccountForOfframp(
  bankCode: string,
  accountNumber: string
): Promise<{
  success: boolean;
  accountName?: string;
  bankName?: string;
  error?: string;
}> {
  try {
    console.log(`\n🔍 Verifying bank account...`);
    console.log(`   Account: ${accountNumber}`);
    console.log(`   Bank Code: ${bankCode}`);

    // ✅ Use lencoService to verify
    const result = await verifyBankAccount(bankCode, accountNumber);

    if (!result.success) {
      console.log(`   ❌ Verification failed: ${result.error}`);
      return {
        success: false,
        error: result.error
      };
    }

    console.log(`   ✅ Account verified: ${result.accountName}`);

    return {
      success: true,
      accountName: result.accountName,
      bankName: result.bankName
    };

  } catch (error: any) {
    console.error(`❌ Verification error:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * ✅ Get list of supported banks using lencoService
 */
export async function getBanksForOfframp(): Promise<
  Array<{ code: string; name: string }>
> {
  try {
    console.log(`\n🏦 Fetching supported banks...`);
    
    // ✅ Use lencoService to get banks
    const banks = await getSupportedBanks();
    
    console.log(`   ✅ Fetched ${banks.length} banks`);
    
    return banks;

  } catch (error: any) {
    console.error(`❌ Error fetching banks:`, error.message);
    throw error;
  }
}

/**
 * ✅ Get offramp transaction status
 */
export async function getOfframpTransactionStatus(
  transactionId: string
): Promise<{
  success: boolean;
  status?: string;
  lencoStatus?: string;
  message?: string;
}> {
  try {
    const transaction = await OfframpTransaction.findById(transactionId);

    if (!transaction) {
      return {
        success: false,
        message: 'Transaction not found'
      };
    }

    return {
      success: true,
      status: transaction.status,
      lencoStatus: transaction.lencoStatus,
      message: `Transaction status: ${transaction.status}`
    };

  } catch (error: any) {
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * ✅ Get user's offramp transactions
 */
export async function getUserOfframpTransactions(
  userId: string,
  limit: number = 10,
  skip: number = 0
): Promise<{
  success: boolean;
  transactions?: any[];
  total?: number;
  error?: string;
}> {
  try {
    const transactions = await OfframpTransaction.findUserTransactions(
      userId,
      limit,
      skip
    );

    const total = await OfframpTransaction.countDocuments({ userId });

    return {
      success: true,
      transactions,
      total
    };

  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  createAndInitiateOfframpTransfer,
  verifyBankAccountForOfframp,
  getBanksForOfframp,
  getOfframpTransactionStatus,
  getUserOfframpTransactions
};