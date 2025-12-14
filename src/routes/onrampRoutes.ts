// ============= src/routes/onrampRoutes.ts =============
import { Router } from 'express';
import {
  initializeOnramp,
  verifyPayment,
  getOnrampHistory,
  handleMonnifyWebhook
} from '../controllers/onrampController';
import { protect } from '../middleware/auth';
import { onrampLimiter } from '../middleware/rateLimiter';

const router = Router();

/**
 * @swagger
 * /api/onramp/initialize:
 *   post:
 *     summary: Initialize onramp payment
 *     description: |
 *       Initialize a Monnify payment to buy USDC.
 *       User pays in NGN and receives USDC in their wallet.
 *       
 *       Exchange Rate: Current NGN/USD rate + 2% fee
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
 *                 description: Amount in Nigerian Naira
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
 *                     paymentReference:
 *                       type: string
 *                       example: "ABOKI_1234567890"
 *                     amountNGN:
 *                       type: number
 *                       example: 50000
 *                     expectedUSDC:
 *                       type: string
 *                       example: "32.50"
 *                     exchangeRate:
 *                       type: number
 *                       example: 1538.46
 *                     fee:
 *                       type: number
 *                       example: 1000
 *                     monnifyConfig:
 *                       type: object
 *                       description: Configuration to pass to MonnifySDK.initialize()
 */
router.post('/initialize', protect, initializeOnramp);

/**
 * @swagger
 * /api/onramp/verify/{reference}:
 *   get:
 *     summary: Verify payment status
 *     description: Check if a payment has been confirmed and USDC credited
 *     tags: [Onramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference
 *     responses:
 *       200:
 *         description: Payment status retrieved
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
 *                     paymentStatus:
 *                       type: string
 *                       enum: [PENDING, PAID, COMPLETED, FAILED, CANCELLED]
 *                     amountPaid:
 *                       type: number
 *                     usdcCredited:
 *                       type: string
 *                     transactionHash:
 *                       type: string
 */
router.get('/verify/:reference', protect, verifyPayment);

/**
 * @swagger
 * /api/onramp/history:
 *   get:
 *     summary: Get onramp transaction history
 *     description: Get all your onramp transactions
 *     tags: [Onramp]
 *     security:
 *       - bearerAuth: []
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
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/history', protect, getOnrampHistory);

/**
 * @swagger
 * /api/onramp/webhook:
 *   post:
 *     summary: Monnify webhook endpoint
 *     description: |
 *       Webhook called by Monnify when payment is completed.
 *       This endpoint verifies the payment and credits USDC.
 *       
 *       ⚠️ This endpoint should be registered in your Monnify dashboard
 *     tags: [Onramp]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 */
router.post('/webhook', handleMonnifyWebhook);

export default router;