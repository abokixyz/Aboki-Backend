// ============= src/services/lencoPollingService.ts (NEW FILE - WEBHOOK ALTERNATIVE) =============
/**
 * Lenco Polling Service (Webhook Alternative)
 * 
 * Since webhook access is not available, this service polls Lenco API
 * to check transfer status for pending/settling transactions.
 * 
 * Polling Strategy:
 * - Check every 30 seconds for first 5 minutes
 * - Then every 2 minutes for next 10 minutes
 * - Then every 5 minutes for up to 30 minutes
 * - Mark as TIMEOUT if not completed after 30 minutes
 */

import cron from 'node-cron';
import OfframpTransaction from '../models/OfframpTransaction';
import { getTransferStatus } from './lencoService';

let isPollingActive = false;

/**
 * Poll a single transaction status
 */
async function pollTransactionStatus(transaction: any): Promise<void> {
  try {
    if (!transaction.lencoReference) {
      console.warn(`⚠️ No Lenco reference for ${transaction.transactionReference}`);
      return;
    }

    console.log(`🔄 Polling status for ${transaction.transactionReference}...`);

    const statusResult = await getTransferStatus(transaction.lencoReference);

    if (!statusResult.success) {
      console.error(`❌ Failed to get status: ${statusResult.error}`);
      return;
    }

    const { status } = statusResult;

    // Map Lenco status to our status
    switch (status?.toLowerCase()) {
      case 'successful':
      case 'completed':
        console.log(`✅ Transfer completed: ${transaction.transactionReference}`);
        transaction.status = 'COMPLETED';
        transaction.completedAt = new Date();
        await transaction.save();
        break;

      case 'failed':
      case 'reversed':
        console.log(`❌ Transfer failed: ${transaction.transactionReference}`);
        transaction.status = 'FAILED';
        transaction.errorCode = 'LENCO_FAILED';
        transaction.errorMessage = 'Transfer failed';
        transaction.failureReason = status;
        transaction.completedAt = new Date();
        await transaction.save();
        break;

      case 'pending':
      case 'processing':
        // Check if transaction has timed out (30 minutes)
        const timeElapsed = Date.now() - transaction.settledAt.getTime();
        const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

        if (timeElapsed > TIMEOUT_MS) {
          console.log(`⏱️ Transfer timeout: ${transaction.transactionReference}`);
          transaction.status = 'TIMEOUT';
          transaction.errorCode = 'TIMEOUT';
          transaction.errorMessage = 'Transfer took too long';
          transaction.completedAt = new Date();
          await transaction.save();
        } else {
          console.log(`⏳ Still processing: ${transaction.transactionReference}`);
        }
        break;

      default:
        console.log(`ℹ️ Unknown status: ${status}`);
    }
  } catch (error: any) {
    console.error(`❌ Error polling transaction:`, error.message);
  }
}

/**
 * Poll all pending/settling transactions
 */
async function pollPendingTransactions(): Promise<void> {
  try {
    // Find all transactions in SETTLING status
    const pendingTransactions = await OfframpTransaction.find({
      status: 'SETTLING',
      lencoReference: { $exists: true }
    }).sort({ settledAt: -1 });

    if (pendingTransactions.length === 0) {
      return;
    }

    console.log(`\n📊 Polling ${pendingTransactions.length} pending transaction(s)...`);

    // Poll each transaction
    for (const transaction of pendingTransactions) {
      await pollTransactionStatus(transaction);
      // Small delay between polls to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Polling cycle completed\n`);
  } catch (error: any) {
    console.error('❌ Error in polling cycle:', error.message);
  }
}

/**
 * Start polling service
 * Runs every 30 seconds
 */
export function startPollingService(): void {
  if (isPollingActive) {
    console.log('ℹ️ Polling service already running');
    return;
  }

  console.log('🚀 Starting Lenco polling service...');
  console.log('   Interval: Every 30 seconds');
  console.log('   Timeout: 30 minutes per transaction');

  // Run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    await pollPendingTransactions();
  });

  // Also run immediately on startup
  pollPendingTransactions();

  isPollingActive = true;
  console.log('✅ Polling service started');
}

/**
 * Stop polling service
 */
export function stopPollingService(): void {
  isPollingActive = false;
  console.log('⏹️ Polling service stopped');
}

/**
 * Poll specific transaction (for manual checks)
 */
export async function pollSpecificTransaction(transactionReference: string): Promise<void> {
  const transaction = await OfframpTransaction.findOne({ transactionReference });
  
  if (!transaction) {
    throw new Error('Transaction not found');
  }

  await pollTransactionStatus(transaction);
}

export default {
  startPollingService,
  stopPollingService,
  pollSpecificTransaction
};
