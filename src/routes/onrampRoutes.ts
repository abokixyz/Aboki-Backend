// ============= src/routes/onrampRoutes.ts (UPDATED) =============
import { Router } from 'express';
import {
  getOnrampRate,
  initializeOnramp,
  verifyPayment,
  getOnrampHistory,
  handleMonnifyWebhook
} from '../controllers/onrampController';
import { protect } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/onramp/rate:
 *   get:
 *     summary: Get current onramp rate
 *     description: |
 *       Get the current USD/NGN rate for onramp with markup and fee calculation.
 *       
 *       Rate Calculation:
 *       - Base Rate: Fetched from Paycrest API (or fallbacks)
 *       - Onramp Rate: Base Rate + ₦40 markup
 *       - Fee: 1.5% of amount (capped at ₦2000) - ADDED to amount
 *       
 *       Important: Fee is added on top, not deducted!
 *       Example: Want ₦10,000 USDC? Pay ₦10,000 + ₦150 fee = ₦10,150
 *       
 *       Fallback Chain:
 *       1. Cache (fresh, 30 min TTL)
 *       2. Paycrest API (primary)
 *       3. ExchangeRate-API (fallback 1)
 *       4. Fawazahmed0 API (fallback 2)
 *       5. Cache (expired)
 *       6. Hardcoded fallback (₦1550)
 *     tags: [Onramp]
 *     parameters:
 *       - in: query
 *         name: amountNGN
 *         schema:
 *           type: number
 *         description: Desired amount in NGN (fee will be added on top)
 *         example: 50000
 *     responses:
 *       200:
 *         description: Rate retrieved successfully
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
 *                       description: Base USD/NGN rate from API
 *                       example: 1560.50
 *                     onrampRate:
 *                       type: number
 *                       description: Rate with ₦40 markup
 *                       example: 1600.50
 *                     markup:
 *                       type: number
 *                       description: Markup added to base rate
 *                       example: 40
 *                     fee:
 *                       type: object
 *                       properties:
 *                         percentage:
 *                           type: number
 *                           example: 1.5
 *                         amount:
 *                           type: number
 *                           description: Fee amount (only if amountNGN provided)
 *                           example: 750
 *                         maxFee:
 *                           type: number
 *                           example: 2000
 *                     calculation:
 *                       type: object
 *                       description: Detailed calculation (only if amountNGN provided)
 *                       properties:
 *                         amountNGN:
 *                           type: number
 *                           description: Desired USDC value in NGN
 *                           example: 50000
 *                         feeAmount:
 *                           type: number
 *                           description: Fee added on top
 *                           example: 750
 *                         totalPayable:
 *                           type: number
 *                           description: Total amount to pay (amount + fee)
 *                           example: 50750
 *                         usdcAmount:
 *                           type: number
 *                           description: USDC you'll receive
 *                           example: 31.23
 *                         effectiveRate:
 *                           type: number
 *                           description: Actual cost per USDC including fee
 *                           example: 1624.59
 *                         breakdown:
 *                           type: string
 *                           example: "₦50,000 + ₦750 fee = ₦50,750 total"
 *                     source:
 *                       type: string
 *                       example: "Paycrest"
 *                     cached:
 *                       type: boolean
 *                       example: false
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid amount
 *       500:
 *         description: Failed to fetch rate
 */
router.get('/rate', getOnrampRate);

/**
 * @swagger
 * /api/onramp/initialize:
 *   post:
 *     summary: Initialize onramp payment
 *     description: |
 *       Initialize a Monnify payment to buy USDC via smart contract.
 *       User pays in NGN and receives USDC in their wallet.
 *       
 *       Process Flow:
 *       1. User initiates payment with desired NGN amount
 *       2. System calculates USDC amount and fee (1.5%, max ₦2000)
 *       3. System checks admin wallet liquidity
 *       4. Payment initialized with Monnify
 *       5. Upon successful payment, smart contract transfers USDC from admin → user
 *       
 *       Rate Calculation:
 *       - Onramp Rate: Base Rate + ₦40 markup
 *       - Fee: 1.5% (capped at ₦2000) - ADDED on top
 *       
 *       Example: Want ₦10,000 worth of USDC?
 *       - Amount: ₦10,000
 *       - Fee (1.5%): ₦150
 *       - Total Payable to Monnify: ₦10,150
 *       - USDC Received: ₦10,000 / rate
 *       
 *       Limits:
 *       - Minimum: ₦1,000
 *       - Maximum: ₦1,000,000 per transaction
 *       - Daily Limit: ₦5,000,000
 *     tags: [Onramp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountNGN
 *             properties:
 *               amountNGN:
 *                 type: number
 *                 description: Desired USDC value in NGN (fee will be added on top)
 *                 minimum: 1000
 *                 maximum: 1000000
 *                 example: 50000
 *               customerEmail:
 *                 type: string
 *                 description: Email for payment receipt (optional, uses account email)
 *                 example: "user@example.com"
 *               customerPhone:
 *                 type: string
 *                 description: Phone number (optional)
 *                 example: "08012345678"
 *     responses:
 *       200:
 *         description: Payment initialized successfully
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
 *                     transactionId:
 *                       type: string
 *                       description: Database transaction ID
 *                       example: "507f1f77bcf86cd799439011"
 *                     paymentReference:
 *                       type: string
 *                       description: Unique payment reference
 *                       example: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *                     amountNGN:
 *                       type: number
 *                       description: Desired USDC value
 *                       example: 50000
 *                     feeAmount:
 *                       type: number
 *                       description: Fee added on top
 *                       example: 750
 *                     totalPayable:
 *                       type: number
 *                       description: Total to pay (amount + fee)
 *                       example: 50750
 *                     expectedUSDC:
 *                       type: string
 *                       description: USDC amount you'll receive
 *                       example: "31.250000"
 *                     exchangeRate:
 *                       type: number
 *                       description: Onramp rate (base + markup)
 *                       example: 1600.50
 *                     baseRate:
 *                       type: number
 *                       description: Base USD/NGN rate
 *                       example: 1560.50
 *                     markup:
 *                       type: number
 *                       description: Markup per dollar
 *                       example: 40
 *                     feePercentage:
 *                       type: number
 *                       description: Fee percentage
 *                       example: 1.5
 *                     effectiveRate:
 *                       type: number
 *                       description: Actual cost per USDC including fee
 *                       example: 1624.00
 *                     breakdown:
 *                       type: object
 *                       description: Human-readable breakdown
 *                       properties:
 *                         description:
 *                           type: string
 *                           example: "You want ₦50,000 worth of USDC"
 *                         fee:
 *                           type: string
 *                           example: "Service fee: ₦750 (1.5%)"
 *                         total:
 *                           type: string
 *                           example: "Total to pay: ₦50,750"
 *                         receiving:
 *                           type: string
 *                           example: "You'll receive: 31.250000 USDC"
 *                     limits:
 *                       type: object
 *                       properties:
 *                         min:
 *                           type: number
 *                           example: 1000
 *                         max:
 *                           type: number
 *                           example: 1000000
 *                         dailyLimit:
 *                           type: number
 *                           example: 5000000
 *                     liquidity:
 *                       type: object
 *                       description: Liquidity check results
 *                       properties:
 *                         available:
 *                           type: string
 *                           description: Available USDC in admin wallet
 *                           example: "1500.00"
 *                         required:
 *                           type: string
 *                           description: Required USDC for this transaction
 *                           example: "31.25"
 *                         sufficient:
 *                           type: boolean
 *                           example: true
 *                     monnifyConfig:
 *                       type: object
 *                       description: Configuration to pass to MonnifySDK.initialize()
 *                       properties:
 *                         amount:
 *                           type: number
 *                           description: Total amount including fee
 *                           example: 50750
 *                         currency:
 *                           type: string
 *                           example: "NGN"
 *                         reference:
 *                           type: string
 *                           example: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *                         customerFullName:
 *                           type: string
 *                           example: "John Doe"
 *                         customerEmail:
 *                           type: string
 *                           example: "john@example.com"
 *                         apiKey:
 *                           type: string
 *                           example: "MK_PROD_FLX4P92EDF"
 *                         contractCode:
 *                           type: string
 *                           example: "626609763141"
 *                         paymentDescription:
 *                           type: string
 *                           example: "Buy 31.25 USDC on Aboki (₦50,000 + ₦750 fee)"
 *                         paymentMethods:
 *                           type: array
 *                           items:
 *                             type: string
 *                           example: ["CARD", "ACCOUNT_TRANSFER", "USSD", "PHONE_NUMBER"]
 *                         metadata:
 *                           type: object
 *                           description: Additional transaction metadata
 *                     rateSource:
 *                       type: string
 *                       description: Source of exchange rate
 *                       example: "Paycrest"
 *       400:
 *         description: Invalid request or limit exceeded
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
 *                   example: "Minimum amount is ₦1,000"
 *       404:
 *         description: User or wallet not found
 *       500:
 *         description: Server error or liquidity provider not configured
 *       503:
 *         description: Insufficient liquidity
 */
router.post('/initialize', protect, initializeOnramp);

/**
 * @swagger
 * /api/onramp/verify/{reference}:
 *   get:
 *     summary: Verify payment status
 *     description: |
 *       Check the status of an onramp transaction.
 *       Returns payment details, USDC amount, and blockchain transaction hash.
 *       
 *       Transaction Statuses:
 *       - PENDING: Payment initialized, waiting for payment
 *       - PAID: Payment received by Monnify, processing USDC transfer
 *       - COMPLETED: USDC successfully transferred via smart contract
 *       - FAILED: Transaction failed (check failureReason)
 *       - CANCELLED: User cancelled the payment
 *     tags: [Onramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference from initialize response
 *         example: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
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
 *                     transactionId:
 *                       type: string
 *                       example: "507f1f77bcf86cd799439011"
 *                     paymentReference:
 *                       type: string
 *                       example: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *                     monnifyReference:
 *                       type: string
 *                       description: Monnify's transaction reference
 *                       example: "MNFY|20231216|......"
 *                     status:
 *                       type: string
 *                       enum: [PENDING, PAID, COMPLETED, FAILED, CANCELLED]
 *                       example: "COMPLETED"
 *                     amountNGN:
 *                       type: number
 *                       description: Desired USDC value in NGN
 *                       example: 50000
 *                     amountPaidNGN:
 *                       type: number
 *                       description: Total amount paid (including fee)
 *                       example: 50750
 *                     usdcAmount:
 *                       type: number
 *                       description: USDC amount credited
 *                       example: 31.25
 *                     transactionHash:
 *                       type: string
 *                       description: Blockchain transaction hash (if completed)
 *                       example: "0x1234567890abcdef..."
 *                     explorerUrl:
 *                       type: string
 *                       description: Blockchain explorer URL
 *                       example: "https://basescan.org/tx/0x1234567890abcdef..."
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2023-12-16T10:30:00.000Z"
 *                     paidAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2023-12-16T10:35:00.000Z"
 *                     completedAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2023-12-16T10:36:00.000Z"
 *                     failureReason:
 *                       type: string
 *                       description: Reason for failure (if status is FAILED)
 *                       example: null
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Verification failed
 */
router.get('/verify/:reference', protect, verifyPayment);

/**
 * @swagger
 * /api/onramp/history:
 *   get:
 *     summary: Get onramp transaction history
 *     description: |
 *       Get all your onramp transactions (up to 50 most recent).
 *       Includes payment status, amounts, and blockchain transaction hashes.
 *     tags: [Onramp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   description: Number of transactions returned
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "507f1f77bcf86cd799439011"
 *                       paymentReference:
 *                         type: string
 *                         example: "ABOKI_1702735200000_a1b2c3_d4e5f6g7"
 *                       monnifyReference:
 *                         type: string
 *                         example: "MNFY|20231216|......"
 *                       status:
 *                         type: string
 *                         enum: [PENDING, PAID, COMPLETED, FAILED, CANCELLED]
 *                         example: "COMPLETED"
 *                       amountNGN:
 *                         type: number
 *                         example: 50000
 *                       amountPaidNGN:
 *                         type: number
 *                         example: 50750
 *                       usdcAmount:
 *                         type: number
 *                         example: 31.25
 *                       exchangeRate:
 *                         type: number
 *                         example: 1600.50
 *                       fee:
 *                         type: number
 *                         example: 750
 *                       transactionHash:
 *                         type: string
 *                         example: "0x1234567890abcdef..."
 *                       explorerUrl:
 *                         type: string
 *                         description: Blockchain explorer URL (added for completed txs)
 *                         example: "https://basescan.org/tx/0x1234567890abcdef..."
 *                       walletAddress:
 *                         type: string
 *                         example: "0xabcdef..."
 *                       customerEmail:
 *                         type: string
 *                         example: "user@example.com"
 *                       customerName:
 *                         type: string
 *                         example: "John Doe"
 *                       paymentMethod:
 *                         type: string
 *                         example: "CARD"
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       paidAt:
 *                         type: string
 *                         format: date-time
 *                       completedAt:
 *                         type: string
 *                         format: date-time
 *                       failureReason:
 *                         type: string
 *       500:
 *         description: Failed to fetch history
 */
router.get('/history', protect, getOnrampHistory);

/**
 * @swagger
 * /api/onramp/webhook:
 *   post:
 *     summary: Monnify webhook endpoint
 *     description: |
 *       Webhook endpoint called by Monnify when payment is completed.
 *       
 *       Process Flow:
 *       1. Monnify sends webhook when payment is successful
 *       2. System verifies webhook signature and IP address
 *       3. System validates payment amount matches expected amount
 *       4. System checks admin wallet has sufficient USDC
 *       5. System approves USDC spending by Aboki smart contract
 *       6. System calls smart contract to transfer USDC to user
 *       7. Transaction marked as COMPLETED with blockchain hash
 *       
 *       Security Features:
 *       - Webhook signature verification (HMAC-SHA512)
 *       - IP whitelist verification
 *       - Amount validation (must match expected total)
 *       - Idempotency check (prevents duplicate processing)
 *       
 *       Smart Contract Integration:
 *       - Uses Aboki contract's createOrder function
 *       - Transfers USDC from admin wallet → user wallet
 *       - Records blockchain transaction hash
 *       
 *       ⚠️ Important:
 *       - This endpoint must be registered in your Monnify dashboard
 *       - URL format: https://yourdomain.com/api/onramp/webhook
 *       - Monnify IPs must be whitelisted in MONNIFY_IPS env variable
 *       - MONNIFY_SECRET_KEY must be set for signature verification
 *     tags: [Onramp]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionReference:
 *                 type: string
 *                 description: Monnify's transaction reference
 *               paymentReference:
 *                 type: string
 *                 description: Your payment reference
 *               amountPaid:
 *                 type: number
 *                 description: Amount paid by customer
 *               totalPayable:
 *                 type: number
 *                 description: Expected amount
 *               paidOn:
 *                 type: string
 *                 format: date-time
 *                 description: Payment timestamp
 *               paymentStatus:
 *                 type: string
 *                 enum: [PAID, FAILED, USER_CANCELLED]
 *                 description: Payment status from Monnify
 *               paymentMethod:
 *                 type: string
 *                 description: Payment method used
 *               currency:
 *                 type: string
 *                 example: "NGN"
 *               customerEmail:
 *                 type: string
 *               customerName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "USDC credited successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionHash:
 *                       type: string
 *                       description: Blockchain transaction hash
 *                       example: "0x1234567890abcdef..."
 *                     amount:
 *                       type: number
 *                       description: USDC amount credited
 *                       example: 31.25
 *                     walletAddress:
 *                       type: string
 *                       description: User's wallet address
 *                       example: "0xabcdef..."
 *                     explorerUrl:
 *                       type: string
 *                       example: "https://basescan.org/tx/0x1234567890abcdef..."
 *                     blockNumber:
 *                       type: string
 *                       example: "12345678"
 *       400:
 *         description: Invalid webhook payload or amount mismatch
 *       401:
 *         description: Invalid webhook signature
 *       403:
 *         description: Unauthorized IP address
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Failed to credit USDC (manual intervention required)
 */
router.post('/webhook', handleMonnifyWebhook);

export default router;