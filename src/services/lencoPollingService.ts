// ============= src/services/lencoPollingService.ts =============
/**
 * Lenco Status Polling Service
 * 
 * Polls Lenco for transfer status using the CORRECT reference
 * Issue: Must use lencoReference (transfer ID), NOT offramp transaction reference
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
 * Get Lenco transfer status using CORRECT reference
 * 
 * ✅ CORRECT: Use lencoReference (the transfer ID from Lenco)
 * ❌ WRONG: Use offramp transactionReference
 */
export async function getLencoTransferStatus(
  lencoTransferId: string  // ✅ This is the ID returned from initiateLencoTransfer
): Promise<{
  success: boolean;
  status: 'pending' | 'successful' | 'failed' | 'declined' | null;
  message: string;
  data?: any;
  error?: string;
}> {
  try {
    if (!lencoTransferId) {
      return {
        success: false,
        status: null,
        message: 'No Lenco transfer ID provided',
        error: 'Missing lencoTransferId'
      };
    }

    console.log(`\n🔍 Checking Lenco transfer status...`);
    console.log(`   Transfer ID: ${lencoTransferId}`);

    // ✅ CORRECT ENDPOINT: Use transfer ID, not transaction reference
    const url = `${LENCO_API_BASE}/transactions/${lencoTransferId}`;

    console.log(`   Endpoint: ${url}`);

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${LENCO_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.data || !response.data.status) {
      console.log(`   ⚠️ Unexpected response format`);
      return {
        success: false,
        status: null,
        message: 'Invalid response from Lenco',
        data: response.data
      };
    }

    const status = response.data.status.toLowerCase();
    const validStatuses = ['pending', 'successful', 'failed', 'declined'];
    
    if (!validStatuses.includes(status)) {
      console.log(`   ⚠️ Unknown status: ${status}`);
      return {
        success: false,
        status: null,
        message: `Unknown transfer status: ${status}`,
        data: response.data
      };
    }

    console.log(`   ✅ Status: ${status.toUpperCase()}`);

    return {
      success: true,
      status: status as 'pending' | 'successful' | 'failed' | 'declined',
      message: `Transfer is ${status}`,
      data: response.data
    };
  } catch (error: any) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    // ❌ This is the error you're seeing - 404 means wrong reference
    if (status === 404) {
      console.error(`   ❌ Lenco transfer not found (404)`);
      console.error(`   📌 Make sure you're using the Lenco transfer ID, not the offramp reference`);
      
      return {
        success: false,
        status: null,
        message: 'Lenco transfer not found - verify reference is correct',
        error: `404 Not Found: ${message}`
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
  lencoTransferId: string,
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
  console.log(`   Transfer ID: ${lencoTransferId}`);
  console.log(`   Max attempts: ${maxAttempts}`);
  console.log(`   Interval: ${intervalSeconds}s`);

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`\n   [Attempt ${attempts}/${maxAttempts}]`);

    const result = await getLencoTransferStatus(lencoTransferId);
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
        status: { $in: ['PROCESSING', 'SETTLING'] },
        lencoReference: { $exists: true, $ne: null }
      }).limit(10); // Process max 10 at a time

      if (activeTransactions.length === 0) {
        return; // No transactions to poll
      }

      console.log(`\n🔄 Polling Lenco for ${activeTransactions.length} transactions...`);

      // Poll each transaction
      for (const transaction of activeTransactions) {
        try {
          const result = await getLencoTransferStatus(transaction.lencoReference!);

          if (!result.success || !result.status) {
            continue; // Skip if we can't get status
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

    if (!transaction.lencoReference) {
      return {
        success: false,
        message: 'No Lenco reference available for polling'
      };
    }

    console.log(`\n🚀 Polling specific transaction: ${transaction.transactionReference}`);

    // Poll Lenco every 5 seconds, max 30 attempts (2.5 minutes)
    const result = await pollLencoUntilComplete(
      transaction.lencoReference,
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

    if (!transaction.lencoReference) {
      return {
        success: false,
        updated: false,
        newStatus: transaction.status,
        message: 'No Lenco reference available'
      };
    }

    // ✅ CORRECT: Use lencoReference (the Lenco transfer ID)
    const result = await getLencoTransferStatus(transaction.lencoReference);

    if (!result.success) {
      return {
        success: false,
        updated: false,
        newStatus: transaction.status,
        message: result.error || 'Failed to get Lenco status'
      };
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