// ============= src/controllers/historyController.ts =============
import { Request, Response } from 'express';
import OnrampTransaction from '../models/OnrampTransaction';
import OfframpTransaction from '../models/OfframpTransaction';
import Transfer from '../models/Transfer';

/**
 * Normalize transactions to unified format
 */
interface UnifiedTransaction {
  transactionId: string;
  type: 'onramp' | 'offramp' | 'transfer' | 'link';
  description: string;
  amount: number;
  amountUSDC?: number;
  amountNGN?: number;
  currency: string;
  status: string;
  date: Date;
  reference: string | null;
  transactionHash?: string;
  explorerUrl?: string;
  metadata: any;
}

/**
 * Normalize onramp transactions
 */
function normalizeOnrampTransaction(tx: any): UnifiedTransaction {
  return {
    transactionId: tx._id.toString(),
    type: 'onramp',
    description: `Bought ${tx.usdcAmount?.toFixed(2) || '0'} USDC`,
    amount: tx.amountNGN,
    amountUSDC: tx.usdcAmount,
    amountNGN: tx.amountNGN,
    currency: 'NGN',
    status: tx.status,
    date: tx.createdAt,
    reference: tx.paymentReference,
    transactionHash: tx.transactionHash,
    explorerUrl: tx.transactionHash ? `https://basescan.org/tx/${tx.transactionHash}` : undefined,
    metadata: {
      monnifyReference: tx.monnifyReference,
      customerEmail: tx.customerEmail,
      customerName: tx.customerName,
      paymentMethod: tx.paymentMethod,
      fee: tx.fee,
      exchangeRate: tx.exchangeRate,
      walletAddress: tx.walletAddress,
      paidAt: tx.paidAt,
      completedAt: tx.completedAt,
      failureReason: tx.failureReason
    }
  };
}

/**
 * Normalize offramp transactions
 */
function normalizeOfframpTransaction(tx: any): UnifiedTransaction {
  return {
    transactionId: tx._id.toString(),
    type: 'offramp',
    description: `Sold ${tx.amountUSDC?.toFixed(2) || '0'} USDC for ₦${tx.amountNGN?.toFixed(0) || '0'}`,
    amount: tx.amountUSDC,
    amountUSDC: tx.amountUSDC,
    amountNGN: tx.amountNGN,
    currency: 'USDC',
    status: tx.status,
    date: tx.createdAt,
    reference: tx.transactionReference,
    transactionHash: tx.transactionHash,
    explorerUrl: tx.transactionHash ? `https://basescan.org/tx/${tx.transactionHash}` : undefined,
    metadata: {
      beneficiary: {
        name: tx.beneficiary?.name,
        accountNumber: tx.beneficiary?.accountNumber,
        bankCode: tx.beneficiary?.bankCode,
        bankName: tx.beneficiary?.bankName
      },
      lencoReference: tx.lencoReference,
      feeUSDC: tx.feeUSDC,
      netUSDC: tx.netUSDC,
      offrampRate: tx.offrampRate,
      passkeyVerified: tx.passkeyVerified,
      processedAt: tx.processedAt,
      settledAt: tx.settledAt,
      completedAt: tx.completedAt,
      failureReason: tx.failureReason
    }
  };
}

/**
 * Normalize transfer transactions
 */
function normalizeTransferTransaction(tx: any): UnifiedTransaction {
  const isLink = tx.transferType === 'LINK';
  const direction = tx.fromUser ? 'Sent' : 'Received';
  
  let description = '';
  if (isLink) {
    description = `Payment link (${tx.status.toLowerCase()})`;
  } else if (tx.transferType === 'USERNAME') {
    const otherUsername = tx.toUsername || tx.fromUsername;
    description = tx.toUsername ? `Sent to @${tx.toUsername}` : `Received from @${tx.fromUsername}`;
  } else if (tx.transferType === 'EXTERNAL') {
    description = `Sent to ${tx.toAddress?.slice(0, 10)}...`;
  } else {
    description = `Transfer (${tx.transferType})`;
  }

  return {
    transactionId: tx._id.toString(),
    type: isLink ? 'link' : 'transfer',
    description,
    amount: tx.amount,
    amountUSDC: tx.amount,
    currency: 'USDC',
    status: tx.status,
    date: tx.createdAt,
    reference: tx.linkCode || null,
    transactionHash: tx.transactionHash,
    explorerUrl: tx.transactionHash ? `https://basescan.org/tx/${tx.transactionHash}` : undefined,
    metadata: {
      transferType: tx.transferType,
      fromUsername: tx.fromUsername,
      toUsername: tx.toUsername,
      toAddress: tx.toAddress,
      message: tx.message,
      verifiedWithPasskey: tx.verifiedWithPasskey,
      linkExpiry: tx.linkExpiry,
      claimedAt: tx.claimedAt,
      claimedBy: tx.claimedBy,
      failureReason: tx.failureReason
    }
  };
}

/**
 * @desc    Get unified history across all transaction types
 * @route   GET /api/history
 * @access  Private
 */
export const getUnifiedHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { type, status, startDate, endDate, limit = '20', skip = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 20, 100);
    const skipNum = parseInt(skip as string) || 0;

    // Build date filter
    const dateFilter: any = {};
    if (startDate) {
      const start = new Date(startDate as string);
      dateFilter.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    const createdAtFilter = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    const transactions: UnifiedTransaction[] = [];

    // Fetch onramp if not filtered out
    if (!type || type === 'onramp') {
      const statusFilter = status && status !== 'onramp' ? { status } : {};
      const onrampTxs = await OnrampTransaction.find({
        userId,
        ...statusFilter,
        ...createdAtFilter
      })
        .sort({ createdAt: -1 })
        .limit(limitNum + skipNum);

      transactions.push(
        ...onrampTxs.slice(skipNum).map(tx => normalizeOnrampTransaction(tx))
      );
    }

    // Fetch offramp if not filtered out
    if (!type || type === 'offramp') {
      const statusFilter = status && status !== 'offramp' ? { status } : {};
      const offrampTxs = await OfframpTransaction.find({
        userId,
        ...statusFilter,
        ...createdAtFilter
      })
        .sort({ createdAt: -1 })
        .limit(limitNum + skipNum);

      transactions.push(
        ...offrampTxs.slice(skipNum).map(tx => normalizeOfframpTransaction(tx))
      );
    }

    // Fetch transfers if not filtered out
    if (!type || type === 'transfer' || type === 'link') {
      const transferFilter: any = {
        $or: [
          { fromUser: userId },
          { toUser: userId },
          { claimedBy: userId }
        ],
        ...createdAtFilter
      };

      if (type === 'link') {
        transferFilter.transferType = 'LINK';
      } else if (type === 'transfer') {
        transferFilter.transferType = { $ne: 'LINK' };
      }

      if (status) {
        transferFilter.status = status;
      }

      const transferTxs = await Transfer.find(transferFilter)
        .sort({ createdAt: -1 })
        .limit(limitNum + skipNum);

      transactions.push(
        ...transferTxs.slice(skipNum).map(tx => normalizeTransferTransaction(tx))
      );
    }

    // Sort by date descending and limit
    const sorted = transactions.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limitNum);

    // Generate summary stats
    const summary = {
      totalTransactions: transactions.length,
      totalOnramp: transactions.filter(t => t.type === 'onramp').length,
      totalOfframp: transactions.filter(t => t.type === 'offramp').length,
      totalTransfer: transactions.filter(t => t.type === 'transfer').length,
      totalLink: transactions.filter(t => t.type === 'link').length,
      completedCount: transactions.filter(t => t.status === 'COMPLETED').length,
      pendingCount: transactions.filter(t => t.status === 'PENDING').length,
      failedCount: transactions.filter(t => t.status === 'FAILED').length
    };

    console.log(`📊 Unified history fetched for user ${userId}`);
    console.log(`   Total: ${summary.totalTransactions}`);
    console.log(`   Onramp: ${summary.totalOnramp}, Offramp: ${summary.totalOfframp}, Transfer: ${summary.totalTransfer}`);

    res.status(200).json({
      success: true,
      data: {
        transactions: sorted,
        summary,
        pagination: {
          limit: limitNum,
          skip: skipNum,
          hasMore: skipNum + limitNum < transactions.length,
          total: transactions.length
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching unified history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch history'
    });
  }
};

/**
 * @desc    Get onramp history only
 * @route   GET /api/history/onramp
 * @access  Private
 */
export const getOnrampHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { status, limit = '20', skip = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 20, 100);
    const skipNum = parseInt(skip as string) || 0;

    const filter: any = { userId };
    if (status) filter.status = status;

    const transactions = await OnrampTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum);

    const total = await OnrampTransaction.countDocuments(filter);

    const normalized = transactions.map(tx => normalizeOnrampTransaction(tx));

    res.status(200).json({
      success: true,
      data: {
        transactions: normalized,
        pagination: {
          limit: limitNum,
          skip: skipNum,
          total,
          hasMore: skipNum + limitNum < total
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching onramp history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch onramp history'
    });
  }
};

/**
 * @desc    Get offramp history only
 * @route   GET /api/history/offramp
 * @access  Private
 */
export const getOfframpHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { status, limit = '20', skip = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 20, 100);
    const skipNum = parseInt(skip as string) || 0;

    const filter: any = { userId };
    if (status) filter.status = status;

    const transactions = await OfframpTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum);

    const total = await OfframpTransaction.countDocuments(filter);

    const normalized = transactions.map(tx => normalizeOfframpTransaction(tx));

    res.status(200).json({
      success: true,
      data: {
        transactions: normalized,
        pagination: {
          limit: limitNum,
          skip: skipNum,
          total,
          hasMore: skipNum + limitNum < total
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching offramp history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch offramp history'
    });
  }
};

/**
 * @desc    Get transfer history only
 * @route   GET /api/history/transfer
 * @access  Private
 */
export const getTransferHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { status, limit = '20', skip = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 20, 100);
    const skipNum = parseInt(skip as string) || 0;

    const filter: any = {
      $or: [
        { fromUser: userId },
        { toUser: userId },
        { claimedBy: userId }
      ]
    };

    if (status) filter.status = status;

    const transactions = await Transfer.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum);

    const total = await Transfer.countDocuments(filter);

    const normalized = transactions.map(tx => normalizeTransferTransaction(tx));

    res.status(200).json({
      success: true,
      data: {
        transactions: normalized,
        pagination: {
          limit: limitNum,
          skip: skipNum,
          total,
          hasMore: skipNum + limitNum < total
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching transfer history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transfer history'
    });
  }
};

/**
 * @desc    Get transaction statistics
 * @route   GET /api/history/stats
 * @access  Private
 */
export const getHistoryStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Onramp stats
    const onrampData = await OnrampTransaction.aggregate([
      { $match: { userId: userId } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalNGN: { $sum: '$amountNGN' },
          totalUSDC: { $sum: '$usdcAmount' },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
          }
        }
      }
    ]);

    // Offramp stats
    const offrampData = await OfframpTransaction.aggregate([
      { $match: { userId: userId } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalUSDC: { $sum: '$amountUSDC' },
          totalNGN: { $sum: '$amountNGN' },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
          }
        }
      }
    ]);

    // Transfer stats
    const transferData = await Transfer.aggregate([
      {
        $match: {
          $or: [
            { fromUser: userId },
            { toUser: userId },
            { claimedBy: userId }
          ]
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalUSDC: { $sum: '$amount' },
          sentCount: {
            $sum: { $cond: [{ $eq: ['$fromUser', userId] }, 1, 0] }
          },
          receivedCount: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ['$toUser', userId] }, { $eq: ['$claimedBy', userId] }] },
                1,
                0
              ]
            }
          },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
          }
        }
      }
    ]);

    const onramp = onrampData[0] || { count: 0, totalNGN: 0, totalUSDC: 0, completedCount: 0 };
    const offramp = offrampData[0] || { count: 0, totalUSDC: 0, totalNGN: 0, completedCount: 0 };
    const transfer = transferData[0] || { count: 0, totalUSDC: 0, sentCount: 0, receivedCount: 0, completedCount: 0 };

    const totalTransactions = onramp.count + offramp.count + transfer.count;
    const totalCompleted = onramp.completedCount + offramp.completedCount + transfer.completedCount;

    res.status(200).json({
      success: true,
      data: {
        onramp: {
          count: onramp.count,
          totalNGN: onramp.totalNGN || 0,
          totalUSDC: parseFloat((onramp.totalUSDC || 0).toFixed(2)),
          avgAmount: onramp.count > 0 ? parseFloat(((onramp.totalUSDC || 0) / onramp.count).toFixed(2)) : 0,
          completedCount: onramp.completedCount
        },
        offramp: {
          count: offramp.count,
          totalUSDC: parseFloat((offramp.totalUSDC || 0).toFixed(2)),
          totalNGN: offramp.totalNGN || 0,
          avgAmount: offramp.count > 0 ? parseFloat(((offramp.totalUSDC || 0) / offramp.count).toFixed(2)) : 0,
          completedCount: offramp.completedCount
        },
        transfer: {
          count: transfer.count,
          totalUSDC: parseFloat((transfer.totalUSDC || 0).toFixed(2)),
          avgAmount: transfer.count > 0 ? parseFloat(((transfer.totalUSDC || 0) / transfer.count).toFixed(2)) : 0,
          sent: transfer.sentCount || 0,
          received: transfer.receivedCount || 0,
          completedCount: transfer.completedCount
        },
        overall: {
          totalTransactions,
          totalCompleted,
          completionRate: totalTransactions > 0 ? parseFloat(((totalCompleted / totalTransactions) * 100).toFixed(1)) : 0,
          totalUSDCInvolved: parseFloat(
            ((onramp.totalUSDC || 0) + (offramp.totalUSDC || 0) + (transfer.totalUSDC || 0)).toFixed(2)
          ),
          totalNGNInvolved: (onramp.totalNGN || 0) + (offramp.totalNGN || 0)
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching history stats:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch statistics'
    });
  }
};

export default {
  getUnifiedHistory,
  getOnrampHistory,
  getOfframpHistory,
  getTransferHistory,
  getHistoryStats
};