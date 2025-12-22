// ============= src/services/lencoPollingService.ts =============
/**
 * Lenco Status Polling Service - FIXED
 * 
 * ✅ CORRECT: Query Lenco using the transaction REFERENCE (your custom reference)
 * ❌ WRONG: Using Lenco's internal transaction ID
 * 
 * When you initiate a transfer, send your reference: ABOKI_OFFRAMP_MJF$2DICD4B4BF2
 * Lenco will store it and you query it back using that same reference
 */

import axios from 'axios';
import OfframpTransaction from '../models/OfframpTransaction';

const LENCO_API_BASE = 'https://api.lenco.co/access/v1';
const LENCO_API_KEY = process.env.LENCO_API_KEY || '';
const LENCO_API_SECRET = process.env.LENCO_API_SECRET || '';

if (!LENCO_API_KEY) {
  console.warn('⚠️ LENCO_API_KEY not set in environment');
}

/**
 * ✅ FIXED: Query Lenco transfer status using YOUR reference (not Lenco's transaction ID)
 * 
 * When you POST to /transfers, you include:
 * {
 *   "reference": "ABOKI_OFFRAMP_MJF$2DICD4B4BF2",  ← YOUR reference
 *   ...
 * }
 * 
 * Then query it back using that same reference:
 * GET /transfers?reference=ABOKI_OFFRAMP_MJF$2DICD4B4BF2
 */
export async function getLencoTransferStatus(
  offrampTransactionReference: string  // ✅ Your ABOKI_OFFRAMP_* reference
): Promise<{
  success: boolean;
  status: 'pending' | 'successful' | 'failed' | 'declined' | null;
  message: string;
  data?: any;
  error?: string;
}> {
  try {
    if (!offrampTransactionReference) {
      return {
        success: false,
        status: null,
        message: 'No transaction reference provided',
        error: 'Missing offrampTransactionReference'
      };
    }

    console.log(`\n🔍 Checking Lenco transfer status...`);
    console.log(`   Reference: ${offrampTransactionReference}`);

    // ✅ CORRECT ENDPOINT: Query by reference parameter
    const url = `${LENCO_API_BASE}/transfers`;

    console.log(`   Endpoint: ${url}?reference=${offrampTransactionReference}`);

    const response = await axios.get(url, {
      params: {
        reference: offrampTransactionReference
      },
      headers: {
        'Authorization': `Bearer ${LENCO_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    // Lenco returns array of matching transfers
    if (!response.data || !response.data.data || response.data.data.length === 0) {
      console.log(`   ⚠️ No transfers found for reference`);
      return {
        success: false,
        status: null,
        message: 'No transfer found for this reference',
        data: response.data
      };
    }

    // Get the first (most recent) transfer
    const transfer = response.data.data[0];
    const status = transfer.status?.toLowerCase();
    const validStatuses = ['pending', 'successful', 'failed', 'declined'];
    
    if (!validStatuses.includes(status)) {
      console.log(`   ⚠️ Unknown status: ${status}`);
      return {
        success: false,
        status: null,
        message: `Unknown transfer status: ${status}`,
        data: transfer
      };
    }

    console.log(`   ✅ Status: ${status.toUpperCase()}`);
    console.log(`   Lenco Transaction ID: ${transfer.id}`);
    console.log(`   Amount: ${transfer.amount} ${transfer.currency}`);

    return {
      success: true,
      status: status as 'pending' | 'successful' | 'failed' | 'declined',
      message: `Transfer is ${status}`,
      data: transfer
    };
  } catch (error: any) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    if (status === 404) {
      console.error(`   ❌ Transfer not found (404)`);
      console.error(`   📌 Make sure the reference was sent to Lenco when initiating transfer`);
      
      return {
        success: false,
        status: null,
        message: 'Transfer not found on Lenco - verify reference is correct',
        error: `404 Not Found: ${message}`
      };
    }

    if (status === 401) {
      console.error(`   ❌ Unauthorized (401) - Check LENCO_API_KEY`);
      return {
        success: false,
        status: null,
        message: 'API authentication failed',
        error: message
      };
    }

    console.error(`   ❌ Error: ${message}`);
    return {
      success: false,
      status: null,
      message: `Failed to check Lenco status`,
      error: message
    };
  }
}

/**
 * Poll Lenco status every 5 seconds until completion (max 30 attempts = 2.5 minutes)
 */
export async function pollLencoUntilComplete(
  offrampTransactionReference: string,
  maxAttempts: number = 30,
  intervalSeconds: number = 5
): Promise<{
  completed: boolean;
  finalStatus: 'pending' | 'successful' | 'failed' | 'declined' | null;
  attempts: number;
  data?: any;
}> {
  let attempts = 0;
  let lastStatus: 'pending' | 'successful' | 'failed' | 'declined' | null = null;

  console.log(`\n📋 Starting Lenco polling...`);
  console.log(`   Reference: ${offrampTransactionReference}`);
  console.log(`   Max attempts: ${maxAttempts}`);
  console.log(`   Interval: ${intervalSeconds}s`);

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`\n   [Attempt ${attempts}/${maxAttempts}]`);

    const result = await getLencoTransferStatus(offrampTransactionReference);
    lastStatus = result.status;

    if (!result.success || !result.status) {
      console.log(`   ⚠️ Check failed: ${result.error}`);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
      continue;
    }

    if (result.status === 'pending') {
      console.log(`   ⏳ Still pending... waiting ${intervalSeconds}s`);
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
      continue;
    }

    // Transfer completed (successful, failed, or declined)
    console.log(`\n✅ Polling complete!`);
    console.log(`   Final status: ${result.status.toUpperCase()}`);
    console.log(`   Attempts: ${attempts}`);

    return {
      completed: true,
      finalStatus: result.status,
      attempts,
      data: result.data
    };
  }

  // Max attempts reached
  console.log(`\n⚠️ Polling timed out after ${attempts} attempts`);
  return {
    completed: false,
    finalStatus: lastStatus,
    attempts,
    data: null
  };
}

/**
 * Background polling service - runs on server startup
 * Monitors all PENDING/SETTLING offramp transactions and polls Lenco
 * 
 * Runs every 10 seconds and checks for transactions needing status updates
 */
export function startPollingService(): void {
  console.log('🚀 Starting Lenco Polling Service...');
  
  // Poll every 10 seconds
  const POLLING_INTERVAL = 10000;

  setInterval(async () => {
    try {
      // Find all active offramp transactions
      const activeTransactions = await OfframpTransaction.find({
        status: { $in: ['PROCESSING', 'SETTLING'] }
      }).limit(10); // Process max 10 at a time

      if (activeTransactions.length === 0) {
        return; // No transactions to poll
      }

      console.log(`\n🔄 Polling Lenco for ${activeTransactions.length} transactions...`);

      // Poll each transaction
      for (const transaction of activeTransactions) {
        try {
          // ✅ Use the transaction's own reference to query Lenco
          const result = await getLencoTransferStatus(transaction.transactionReference);

          if (!result.success || !result.status) {
            continue; // Skip if we can't get status
          }

          // Store the Lenco transaction ID for future reference
          if (result.data?.id && !transaction.lencoTransactionId) {
            transaction.lencoTransactionId = result.data.id;
          }

          // Update transaction based on Lenco status
          let newStatus = transaction.status;
          let shouldSave = false;

          switch (result.status) {
            case 'successful':
              newStatus = 'COMPLETED';
              transaction.completedAt = new Date();
              shouldSave = true;
              console.log(`   ✅ ${transaction.transactionReference}: COMPLETED`);
              break;
            case 'failed':
            case 'declined':
              newStatus = 'FAILED';
              transaction.completedAt = new Date();
              transaction.errorCode = 'LENCO_FAILED';
              transaction.errorMessage = `Lenco settlement ${result.status}`;
              shouldSave = true;
              console.log(`   ❌ ${transaction.transactionReference}: FAILED`);
              break;
            // 'pending' - keep polling
          }

          if (shouldSave) {
            transaction.status = newStatus;
            await transaction.save();
          }
        } catch (txError: any) {
          console.error(`   ⚠️ Error polling ${transaction.transactionReference}:`, txError.message);
        }
      }
    } catch (error: any) {
      console.error('❌ Polling service error:', error.message);
    }
  }, POLLING_INTERVAL);

  console.log('✅ Lenco Polling Service started (interval: 10s)');
}

/**
 * Poll a specific transaction immediately (for testing or manual triggers)
 */
export async function pollSpecificTransaction(
  offrampTransactionId: string
): Promise<{
  success: boolean;
  message: string;
  finalStatus?: string;
}> {
  try {
    const transaction = await OfframpTransaction.findById(offrampTransactionId);

    if (!transaction) {
      return {
        success: false,
        message: 'Transaction not found'
      };
    }

    console.log(`\n🚀 Polling specific transaction: ${transaction.transactionReference}`);

    // ✅ Poll Lenco using the transaction reference
    const result = await pollLencoUntilComplete(
      transaction.transactionReference,
      30,
      5
    );

    if (result.completed) {
      // Update transaction with final status
      const updateResult = await updateOfframpStatusFromLenco(offrampTransactionId);
      return {
        success: true,
        message: `Polling complete: ${result.finalStatus}`,
        finalStatus: result.finalStatus || undefined
      };
    } else {
      return {
        success: false,
        message: `Polling timed out after ${result.attempts} attempts`,
        finalStatus: result.finalStatus || undefined
      };
    }
  } catch (error: any) {
    console.error('❌ Polling error:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Background job: Poll Lenco and update offramp transaction status
 * 
 * This should be called from a background worker/cron job
 */
export async function updateOfframpStatusFromLenco(
  offrampTransactionId: string
): Promise<{
  success: boolean;
  updated: boolean;
  newStatus: string;
  message: string;
}> {
  try {
    const transaction = await OfframpTransaction.findById(offrampTransactionId);

    if (!transaction) {
      return {
        success: false,
        updated: false,
        newStatus: 'NOT_FOUND',
        message: 'Offramp transaction not found'
      };
    }

    // ✅ CORRECT: Use the transaction reference (what you sent to Lenco)
    const result = await getLencoTransferStatus(transaction.transactionReference);

    if (!result.success) {
      return {
        success: false,
        updated: false,
        newStatus: transaction.status,
        message: result.error || 'Failed to get Lenco status'
      };
    }

    // Store Lenco's transaction ID for future reference
    if (result.data?.id && !transaction.lencoTransactionId) {
      transaction.lencoTransactionId = result.data.id;
    }

    // Update transaction based on Lenco status
    let newStatus = transaction.status;

    switch (result.status) {
      case 'successful':
        newStatus = 'COMPLETED';
        transaction.completedAt = new Date();
        break;
      case 'failed':
      case 'declined':
        newStatus = 'FAILED';
        transaction.completedAt = new Date();
        transaction.errorCode = 'LENCO_FAILED';
        transaction.errorMessage = `Lenco settlement ${result.status}`;
        break;
      case 'pending':
        newStatus = 'SETTLING';
        break;
    }

    // Only update if status changed
    if (newStatus !== transaction.status) {
      transaction.status = newStatus;
      await transaction.save();

      return {
        success: true,
        updated: true,
        newStatus,
        message: `Status updated from Lenco: ${newStatus}`
      };
    }

    return {
      success: true,
      updated: false,
      newStatus: transaction.status,
      message: 'Status unchanged'
    };
  } catch (error: any) {
    console.error('❌ Error updating offramp status:', error);
    return {
      success: false,
      updated: false,
      newStatus: 'ERROR',
      message: error.message
    };
  }
}

export default {
  startPollingService,
  pollSpecificTransaction,
  getLencoTransferStatus,
  pollLencoUntilComplete,
  updateOfframpStatusFromLenco
};