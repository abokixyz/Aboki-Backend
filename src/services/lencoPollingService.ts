// ============= src/services/lencoPollingService.ts =============
/**
 * Lenco Polling Service
 * 
 * Polls Lenco API for pending offramp transactions since webhooks are unavailable.
 * 
 * ADVANTAGES:
 * - No webhook setup required
 * - Self-contained polling logic
 * - Automatic retry on failures
 * - Handles offline scenarios
 * 
 * LIMITATIONS:
 * - Slight delay before status updates (polling interval)
 * - More API calls to Lenco
 * 
 * SOLUTION: Poll every 30 seconds for pending/settling transactions
 */

import OfframpTransaction from '../models/OfframpTransaction';
import { getTransferStatus } from './lencoService';

// Polling configuration
const POLLING_INTERVAL = 30 * 1000; // Poll every 30 seconds
const MAX_POLL_ATTEMPTS = 720; // Stop polling after 6 hours (720 * 30s)
const BATCH_SIZE = 10; // Process 10 transactions at a time

// Track polling state
let pollingActive = false;
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Start the Lenco polling service
 * Call this once on server startup
 */
export async function startPollingService(): Promise<void> {
  if (pollingActive) {
    console.log('⚠️ Lenco polling service already running');
    return;
  }

  pollingActive = true;
  console.log('✅ Starting Lenco polling service...');
  console.log(`   Polling interval: ${POLLING_INTERVAL / 1000} seconds`);
  console.log(`   Batch size: ${BATCH_SIZE} transactions`);

  // Run first poll immediately
  await pollPendingTransactions();

  // Schedule regular polling
  pollingInterval = setInterval(async () => {
    try {
      await pollPendingTransactions();
    } catch (error: any) {
      console.error('❌ Polling error:', error.message);
    }
  }, POLLING_INTERVAL);

  console.log('🚀 Lenco polling service started');
}

/**
 * Stop the polling service
 */
export function stopPollingService(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  pollingActive = false;
  console.log('⛔ Lenco polling service stopped');
}

/**
 * Poll pending/settling transactions
 * 
 * Status progression:
 * PENDING → (user confirms) → PROCESSING → (Lenco settles) → SETTLING → COMPLETED/FAILED
 */
async function pollPendingTransactions(): Promise<void> {
  try {
    // Find all PROCESSING and SETTLING transactions
    const pendingTransactions = await OfframpTransaction.find({
      status: { $in: ['PROCESSING', 'SETTLING'] },
      lencoReference: { $exists: true, $ne: null }
    })
      .sort({ processedAt: 1 })
      .limit(BATCH_SIZE);

    if (pendingTransactions.length === 0) {
      // Only log if there are any transactions in the system
      const totalCount = await OfframpTransaction.countDocuments({});
      if (totalCount > 0) {
        console.log(`⏳ No pending transactions to poll (${totalCount} total)`);
      }
      return;
    }

    console.log(`\n🔄 Polling ${pendingTransactions.length} pending Lenco transfers...`);

    let updated = 0;
    let failed = 0;

    for (const transaction of pendingTransactions) {
      try {
        await pollSingleTransaction(transaction);
        updated++;
      } catch (error: any) {
        console.error(`  ❌ Error polling ${transaction.transactionReference}: ${error.message}`);
        failed++;
      }
    }

    console.log(`✅ Polling complete: ${updated} updated, ${failed} failed`);

  } catch (error: any) {
    console.error('❌ Error polling pending transactions:', error.message);
  }
}

/**
 * Poll a single transaction status
 */
async function pollSingleTransaction(transaction: any): Promise<void> {
  const { transactionReference, lencoReference, status } = transaction;

  try {
    console.log(`  📊 Checking: ${transactionReference} (${lencoReference})`);

    // Get current status from Lenco
    const statusResult = await getTransferStatus(lencoReference);

    if (!statusResult.success) {
      console.error(`     ❌ Failed to fetch status: ${statusResult.error}`);
      return;
    }

    const lencoStatus = statusResult.status?.toLowerCase();

    console.log(`     Lenco Status: ${lencoStatus}`);

    // Handle different Lenco status values
    if (lencoStatus === 'successful' || lencoStatus === 'completed') {
      // Transfer succeeded
      if (transaction.status !== 'COMPLETED') {
        console.log(`     ✅ COMPLETED - User received ₦${transaction.amountNGN.toFixed(2)}`);
        
        transaction.status = 'COMPLETED';
        transaction.completedAt = new Date();
        transaction.lencoStatus = lencoStatus;
        
        await transaction.save();

        // Send notification to user (if you have a notification service)
        // await notifyUser(transaction.userId, {
        //   type: 'offramp_completed',
        //   amount: transaction.amountNGN,
        //   status: 'COMPLETED'
        // });
      }

    } else if (lencoStatus === 'failed' || lencoStatus === 'rejected') {
      // Transfer failed
      if (transaction.status !== 'FAILED') {
        console.log(`     ❌ FAILED - Settlement could not be completed`);
        
        transaction.status = 'FAILED';
        transaction.completedAt = new Date();
        transaction.errorCode = 'LENCO_FAILED';
        transaction.errorMessage = statusResult.status || 'Lenco settlement failed';
        transaction.lencoStatus = lencoStatus;
        
        await transaction.save();

        // Send failure notification
        // await notifyUser(transaction.userId, {
        //   type: 'offramp_failed',
        //   reason: statusResult.status
        // });
      }

    } else if (lencoStatus === 'pending' || lencoStatus === 'processing') {
      // Still processing - update lenco status but keep transaction status
      console.log(`     ⏳ Still settling...`);
      
      transaction.lencoStatus = lencoStatus;
      transaction.polledAt = new Date();
      
      await transaction.save();

    } else {
      console.log(`     ℹ️ Unknown status: ${lencoStatus}`);
      transaction.lencoStatus = lencoStatus;
      transaction.polledAt = new Date();
      
      await transaction.save();
    }

  } catch (error: any) {
    console.error(`     ❌ Polling error: ${error.message}`);
    
    // Increment poll attempt counter
    if (!transaction.pollAttempts) {
      transaction.pollAttempts = 0;
    }
    transaction.pollAttempts += 1;
    transaction.lastPolledAt = new Date();

    // Stop polling after too many failed attempts
    if (transaction.pollAttempts > MAX_POLL_ATTEMPTS) {
      console.warn(`     ⚠️ Max polling attempts reached (${MAX_POLL_ATTEMPTS}), marking as FAILED`);
      transaction.status = 'FAILED';
      transaction.errorCode = 'POLLING_TIMEOUT';
      transaction.errorMessage = 'Unable to confirm settlement status after 6 hours';
      transaction.completedAt = new Date();
    }

    await transaction.save();
  }
}

/**
 * Manually trigger polling (useful for testing)
 */
export async function triggerManualPolling(): Promise<{
  success: boolean;
  transactionsPolled: number;
  message: string;
}> {
  try {
    const pendingCount = await OfframpTransaction.countDocuments({
      status: { $in: ['PROCESSING', 'SETTLING'] }
    });

    console.log(`\n🔄 MANUAL POLLING TRIGGERED`);
    console.log(`   Found ${pendingCount} pending transactions`);

    await pollPendingTransactions();

    return {
      success: true,
      transactionsPolled: pendingCount,
      message: 'Manual polling completed'
    };

  } catch (error: any) {
    console.error('❌ Manual polling error:', error);
    return {
      success: false,
      transactionsPolled: 0,
      message: error.message
    };
  }
}

/**
 * Get polling statistics
 */
export async function getPollingStats(): Promise<{
  isRunning: boolean;
  pollingInterval: number;
  pendingTransactions: number;
  settlingTransactions: number;
  completedToday: number;
  failedToday: number;
}> {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const stats = {
      isRunning: pollingActive,
      pollingInterval: POLLING_INTERVAL / 1000,
      pendingTransactions: await OfframpTransaction.countDocuments({
        status: 'PROCESSING'
      }),
      settlingTransactions: await OfframpTransaction.countDocuments({
        status: 'SETTLING'
      }),
      completedToday: await OfframpTransaction.countDocuments({
        status: 'COMPLETED',
        completedAt: { $gte: todayStart }
      }),
      failedToday: await OfframpTransaction.countDocuments({
        status: 'FAILED',
        completedAt: { $gte: todayStart }
      })
    };

    return stats;
  } catch (error: any) {
    console.error('❌ Error getting polling stats:', error);
    return {
      isRunning: pollingActive,
      pollingInterval: POLLING_INTERVAL / 1000,
      pendingTransactions: 0,
      settlingTransactions: 0,
      completedToday: 0,
      failedToday: 0
    };
  }
}

export default {
  startPollingService,
  stopPollingService,
  triggerManualPolling,
  getPollingStats
};