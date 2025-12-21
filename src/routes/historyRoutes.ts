// ============= src/routes/historyRoutes.ts (COMPLETE) =============
import { Router, Request, Response, NextFunction } from 'express';
import { protect } from '../middleware/auth';
import {
  getUnifiedHistory,
  getOnrampHistory,
  getOfframpHistory,
  getTransferHistory,
  getHistoryStats
} from '../controllers/historyController';
import rateLimitMiddleware from '../middleware/rateLimiter';

const router = Router();

/**
 * ROOT ENDPOINT
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'History API',
    version: '1.0.0',
    endpoints: {
      unified: 'GET /api/history - Get all transactions (onramp, offramp, transfer)',
      onramp: 'GET /api/history/onramp - Get only onramp transactions',
      offramp: 'GET /api/history/offramp - Get only offramp transactions',
      transfer: 'GET /api/history/transfer - Get only transfer transactions',
      stats: 'GET /api/history/stats - Get aggregated statistics'
    },
    queryParameters: {
      type: 'Filter by type: onramp, offramp, transfer, link',
      status: 'Filter by status: PENDING, COMPLETED, FAILED, CANCELLED, etc.',
      startDate: 'Filter by start date (YYYY-MM-DD)',
      endDate: 'Filter by end date (YYYY-MM-DD)',
      limit: 'Number of records (default: 20, max: 100)',
      skip: 'Pagination offset (default: 0)'
    },
    examples: {
      allTransactions: 'GET /api/history',
      onlyOnramp: 'GET /api/history?type=onramp',
      completedOnly: 'GET /api/history?status=COMPLETED',
      dateRange: 'GET /api/history?startDate=2024-01-01&endDate=2024-12-31',
      pagination: 'GET /api/history?limit=50&skip=0',
      stats: 'GET /api/history/stats'
    }
  });
});

/**
 * @swagger
 * /api/history/unified:
 *   get:
 *     summary: Get unified history (all transactions combined)
 *     description: |
 *       Fetch all transactions across onramp, offramp, and transfers.
 *       Results are sorted by date (newest first) and normalized to a unified format.
 *       
 *       Transaction Types:
 *       - onramp: Buy USDC with NGN (via Monnify)
 *       - offramp: Sell USDC for NGN (via Lenco)
 *       - transfer: Send/receive USDC with other users
 *       - link: Payment links (sent or received)
 *       
 *       Supported Statuses:
 *       - PENDING: Transaction initiated, awaiting completion
 *       - COMPLETED: Successfully completed
 *       - PAID: Payment received (onramp only)
 *       - PROCESSING: Being processed (offramp)
 *       - SETTLING: Settlement in progress (offramp)
 *       - FAILED: Transaction failed
 *       - CANCELLED: User cancelled
 *       
 *       Query Examples:
 *       - GET /api/history/unified (all)
 *       - GET /api/history/unified?type=onramp (only buys)
 *       - GET /api/history/unified?type=transfer&status=COMPLETED (only completed transfers)
 *       - GET /api/history/unified?startDate=2024-01-01&endDate=2024-12-31 (date range)
 *       - GET /api/history/unified?limit=50&skip=0 (pagination)
 *     tags: [History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [onramp, offramp, transfer, link]
 *         description: Filter by transaction type
 *         example: "onramp"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, COMPLETED, FAILED, CANCELLED, PAID, PROCESSING, SETTLING]
 *         description: Filter by transaction status
 *         example: "COMPLETED"
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering (YYYY-MM-DD)
 *         example: "2024-01-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering (YYYY-MM-DD)
 *         example: "2024-12-31"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *         description: Number of records to return per page
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *           minimum: 0
 *         description: Number of records to skip (for pagination)
 *     responses:
 *       200:
 *         description: Unified history retrieved successfully
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
 *                     transactions:
 *                       type: array
 *                       description: Array of normalized transactions
 *                       items:
 *                         type: object
 *                         properties:
 *                           transactionId:
 *                             type: string
 *                             example: "507f1f77bcf86cd799439011"
 *                           type:
 *                             type: string
 *                             enum: [onramp, offramp, transfer, link]
 *                             example: "onramp"
 *                           description:
 *                             type: string
 *                             example: "Bought 31.25 USDC"
 *                           amount:
 *                             type: number
 *                             description: Primary amount (NGN for onramp, USDC for others)
 *                             example: 50000
 *                           amountUSDC:
 *                             type: number
 *                             example: 31.25
 *                           amountNGN:
 *                             type: number
 *                             example: 50000
 *                           currency:
 *                             type: string
 *                             example: "NGN"
 *                           status:
 *                             type: string
 *                             example: "COMPLETED"
 *                           date:
 *                             type: string
 *                             format: date-time
 *                             example: "2024-12-16T10:30:00.000Z"
 *                           reference:
 *                             type: string
 *                             nullable: true
 *                             description: Payment reference or link code
 *                             example: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *                           transactionHash:
 *                             type: string
 *                             nullable: true
 *                             description: Blockchain transaction hash
 *                             example: "0x1234567890abcdef..."
 *                           explorerUrl:
 *                             type: string
 *                             nullable: true
 *                             description: Block explorer URL
 *                             example: "https://basescan.org/tx/0x1234567890abcdef..."
 *                           metadata:
 *                             type: object
 *                             description: Type-specific metadata
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalTransactions:
 *                           type: number
 *                           example: 20
 *                         totalOnramp:
 *                           type: number
 *                           example: 5
 *                         totalOfframp:
 *                           type: number
 *                           example: 3
 *                         totalTransfer:
 *                           type: number
 *                           example: 12
 *                         totalLink:
 *                           type: number
 *                           example: 0
 *                         completedCount:
 *                           type: number
 *                           example: 18
 *                         pendingCount:
 *                           type: number
 *                           example: 1
 *                         failedCount:
 *                           type: number
 *                           example: 1
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         limit:
 *                           type: number
 *                           example: 20
 *                         skip:
 *                           type: number
 *                           example: 0
 *                         hasMore:
 *                           type: boolean
 *                           example: false
 *                         total:
 *                           type: number
 *                           example: 20
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Invalid date format"
 *       401:
 *         description: Unauthorized - JWT token required
 *       500:
 *         description: Server error
 */
router.get('/unified', protect, rateLimitMiddleware, getUnifiedHistory);

/**
 * @swagger
 * /api/history/onramp:
 *   get:
 *     summary: Get onramp transaction history
 *     description: |
 *       Get only onramp transactions (NGN → USDC purchases via Monnify).
 *       Includes payment references, fees, and exchange rates.
 *     tags: [History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PAID, COMPLETED, FAILED, CANCELLED]
 *         description: Filter by onramp status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Onramp history retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 transactions:
 *                   - transactionId: "507f1f77bcf86cd799439011"
 *                     type: "onramp"
 *                     description: "Bought 31.25 USDC"
 *                     amount: 50000
 *                     amountUSDC: 31.25
 *                     amountNGN: 50000
 *                     status: "COMPLETED"
 *                     date: "2024-12-16T10:30:00.000Z"
 *                     reference: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *                     transactionHash: "0x1234567890abcdef..."
 *                     metadata:
 *                       monnifyReference: "MNFY|20231216|..."
 *                       customerEmail: "user@example.com"
 *                       paymentMethod: "CARD"
 *                       fee: 750
 *                       exchangeRate: 1600.50
 *                 pagination:
 *                   limit: 20
 *                   skip: 0
 *                   total: 5
 *                   hasMore: false
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/onramp', protect, rateLimitMiddleware, getOnrampHistory);

/**
 * @swagger
 * /api/history/offramp:
 *   get:
 *     summary: Get offramp transaction history
 *     description: |
 *       Get only offramp transactions (USDC → NGN sales via Lenco).
 *       Includes beneficiary details, settlement status, and bank information.
 *     tags: [History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, SETTLING, COMPLETED, FAILED]
 *         description: Filter by offramp status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Offramp history retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 transactions:
 *                   - transactionId: "507f1f77bcf86cd799439012"
 *                     type: "offramp"
 *                     description: "Sold 75 USDC for ₦120000"
 *                     amount: 75
 *                     amountUSDC: 75
 *                     amountNGN: 120000
 *                     status: "COMPLETED"
 *                     date: "2024-12-15T14:20:00.000Z"
 *                     reference: "ABOKI_OFFRAMP_abc123..."
 *                     transactionHash: "0x987654321fedcba0..."
 *                     metadata:
 *                       beneficiary:
 *                         name: "John Doe"
 *                         accountNumber: "1234567890"
 *                         bankCode: "011"
 *                         bankName: "First Bank of Nigeria"
 *                       lencoReference: "LENCO_REF_123"
 *                       feeUSDC: 1.5
 *                       offrampRate: 1600.50
 *                 pagination:
 *                   limit: 20
 *                   skip: 0
 *                   total: 3
 *                   hasMore: false
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/offramp', protect, rateLimitMiddleware, getOfframpHistory);

/**
 * @swagger
 * /api/history/transfer:
 *   get:
 *     summary: Get transfer transaction history
 *     description: |
 *       Get transfer transactions (send/receive USDC with other users).
 *       Includes both internal transfers to usernames and external transfers to wallet addresses.
 *       Also includes payment links (both sent and claimed).
 *     tags: [History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, COMPLETED, CLAIMED, FAILED, CANCELLED]
 *         description: Filter by transfer status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Transfer history retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 transactions:
 *                   - transactionId: "507f1f77bcf86cd799439013"
 *                     type: "transfer"
 *                     description: "Sent to @johndoe"
 *                     amount: 10.50
 *                     amountUSDC: 10.50
 *                     status: "COMPLETED"
 *                     date: "2024-12-14T09:15:00.000Z"
 *                     reference: null
 *                     transactionHash: "0xabcdef0123456789..."
 *                     metadata:
 *                       transferType: "USERNAME"
 *                       fromUsername: "alice"
 *                       toUsername: "johndoe"
 *                       message: "Coffee money!"
 *                       verifiedWithPasskey: true
 *                   - transactionId: "507f1f77bcf86cd799439014"
 *                     type: "link"
 *                     description: "Payment link (completed)"
 *                     amount: 25.00
 *                     status: "COMPLETED"
 *                     date: "2024-12-13T11:45:00.000Z"
 *                     reference: "ABOKI_1734352800000_A1B2C3D4"
 *                     metadata:
 *                       transferType: "LINK"
 *                       fromUsername: "bob"
 *                       claimedBy: "charlie"
 *                       message: "Happy Birthday!"
 *                       linkExpiry: "2025-01-12T11:45:00.000Z"
 *                 pagination:
 *                   limit: 20
 *                   skip: 0
 *                   total: 12
 *                   hasMore: false
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/transfer', protect, rateLimitMiddleware, getTransferHistory);

/**
 * @swagger
 * /api/history/stats:
 *   get:
 *     summary: Get transaction statistics and analytics
 *     description: |
 *       Get aggregated statistics across all transaction types.
 *       Includes counts, totals, averages, and completion rates.
 *       
 *       Helpful for dashboards showing:
 *       - Total USDC bought/sold/transferred
 *       - Total NGN involved in conversions
 *       - Transaction completion rates
 *       - Average transaction amounts
 *     tags: [History]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
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
 *                     onramp:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: number
 *                           description: Total onramp transactions
 *                           example: 5
 *                         totalNGN:
 *                           type: number
 *                           description: Total NGN spent
 *                           example: 250000
 *                         totalUSDC:
 *                           type: number
 *                           description: Total USDC received
 *                           example: 156.25
 *                         avgAmount:
 *                           type: number
 *                           description: Average USDC per transaction
 *                           example: 31.25
 *                         completedCount:
 *                           type: number
 *                           example: 5
 *                     offramp:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: number
 *                           example: 3
 *                         totalUSDC:
 *                           type: number
 *                           example: 75
 *                         totalNGN:
 *                           type: number
 *                           example: 120000
 *                         avgAmount:
 *                           type: number
 *                           example: 25
 *                         completedCount:
 *                           type: number
 *                           example: 3
 *                     transfer:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: number
 *                           example: 12
 *                         totalUSDC:
 *                           type: number
 *                           example: 250
 *                         avgAmount:
 *                           type: number
 *                           example: 20.83
 *                         sent:
 *                           type: number
 *                           example: 8
 *                         received:
 *                           type: number
 *                           example: 4
 *                         completedCount:
 *                           type: number
 *                           example: 12
 *                     overall:
 *                       type: object
 *                       properties:
 *                         totalTransactions:
 *                           type: number
 *                           example: 20
 *                         totalCompleted:
 *                           type: number
 *                           example: 20
 *                         completionRate:
 *                           type: number
 *                           description: Percentage of completed transactions
 *                           example: 100
 *                         totalUSDCInvolved:
 *                           type: number
 *                           example: 481.25
 *                         totalNGNInvolved:
 *                           type: number
 *                           example: 370000
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/stats', protect, rateLimitMiddleware, getHistoryStats);

/**
 * 404 HANDLER
 */
router.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `History endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET /api/history',
      'GET /api/history/unified',
      'GET /api/history/onramp',
      'GET /api/history/offramp',
      'GET /api/history/transfer',
      'GET /api/history/stats'
    ]
  });
});

export default router;