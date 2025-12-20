// ============= src/routes/offrampRoutes.ts =============
/**
 * Offramp Routes
 * 
 * All USDC → NGN offramp endpoints
 * 
 * Public Endpoints:
 * - GET / - Offramp endpoint info
 * - GET /rate - Get current rate (public)
 * - POST /webhook/lenco - Lenco webhook confirmation (signed)
 * - POST /verify-account - Verify bank account
 * 
 * Protected Endpoints (require JWT):
 * - POST /initiate - Start offramp
 * - POST /confirm-transfer - Confirm blockchain transaction
 * - GET /status/:reference - Get transaction status
 * - GET /history - Get user's transaction history
 * - POST /beneficiaries - Add/manage beneficiaries
 * - GET /frequent-accounts - Get frequently used accounts
 */

import { Router, Request, Response } from 'express';

// Middleware - Import from correct paths (middlewares folder)
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import rateLimitMiddleware from '../middleware/rateLimiter';

// Controllers
import offrampController from '../controllers/offrampController';

// ============= ROUTER SETUP =============

const router = Router();

// ============= ROOT ENDPOINT =============

/**
 * @route    GET /api/offramp
 * @access   Public
 * @desc     Offramp endpoint info and available routes
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Offramp API is running',
    version: '1.0.0',
    endpoints: {
      rate: 'GET /api/offramp/rate',
      verifyAccount: 'POST /api/offramp/verify-account',
      initiate: 'POST /api/offramp/initiate',
      confirmTransfer: 'POST /api/offramp/confirm-transfer',
      status: 'GET /api/offramp/status/:reference',
      history: 'GET /api/offramp/history',
      beneficiaries: {
        add: 'POST /api/offramp/beneficiaries',
        list: 'GET /api/offramp/beneficiaries',
        delete: 'DELETE /api/offramp/beneficiaries/:id',
        setDefault: 'PUT /api/offramp/beneficiaries/:id/default'
      },
      frequentAccounts: 'GET /api/offramp/frequent-accounts',
      webhook: 'POST /api/offramp/webhook/lenco'
    },
    documentation: '/api-docs'
  });
});

// ============= PUBLIC ENDPOINTS =============

/**
 * @route    GET /api/offramp/rate
 * @query    amountUSDC=100
 * @access   Public
 * @desc     Get current offramp rate (detailed breakdown)
 * 
 * @swagger
 * /api/offramp/rate:
 *   get:
 *     summary: Get current offramp rate
 *     description: |
 *       Get the current USDC/NGN exchange rate with fee breakdown.
 *       
 *       Rate Calculation:
 *       - Base Rate: From Paycrest (fallback: 1400)
 *       - Offramp Rate: Base Rate + ₦20 markup
 *       - Fee: 1% of USDC (capped at $2) - DEDUCTED from amount
 *       - LP Fee: 0.5% of net USDC
 *       
 *       Example: 100 USDC offramp
 *       - Base Rate: 1400 NGN/USDC
 *       - Offramp Rate: 1420 NGN/USDC (1400 + 20 markup)
 *       - Fee: 1 USDC (1% of 100, not capped)
 *       - Net USDC: 99 USDC
 *       - NGN Amount: 99 × 1420 = 140,580 NGN
 *       - LP Fee: 0.495 USDC (0.5% of 99)
 *     tags: [Offramp]
 *     parameters:
 *       - in: query
 *         name: amountUSDC
 *         schema:
 *           type: number
 *         description: Amount in USDC
 *         example: 100
 *     responses:
 *       200:
 *         description: Rate retrieved successfully
 */
router.get(
  '/rate',
  rateLimitMiddleware,
  offrampController.getRate
);

/**
 * @route    POST /api/offramp/verify-account
 * @access   Public
 * @desc     Verify bank account details before initiating offramp
 * 
 * @swagger
 * /api/offramp/verify-account:
 *   post:
 *     summary: Verify bank account
 *     description: |
 *       Verify a Nigerian bank account before initiating an offramp transaction.
 *       Returns the verified account name if successful.
 *       
 *       This should be called BEFORE /initiate to ensure the account is valid.
 *     tags: [Offramp]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accountNumber
 *               - bankCode
 *             properties:
 *               accountNumber:
 *                 type: string
 *                 example: "1234567890"
 *                 description: 10-digit Nigerian bank account number
 *               bankCode:
 *                 type: string
 *                 example: "011"
 *                 description: Nigerian bank code (e.g., 011 for First Bank)
 *     responses:
 *       200:
 *         description: Account verified successfully
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
 *                     accountName:
 *                       type: string
 *                       example: "John Doe"
 *                     accountNumber:
 *                       type: string
 *                       example: "1234567890"
 *                     bankCode:
 *                       type: string
 *                       example: "011"
 *                     bankName:
 *                       type: string
 *                       example: "First Bank of Nigeria"
 *       400:
 *         description: Invalid account details or verification failed
 *       429:
 *         description: Rate limit exceeded
 */
router.post(
  '/verify-account',
  rateLimitMiddleware,
  validateRequest({
    body: {
      accountNumber: { type: 'string', required: true },
      bankCode: { type: 'string', required: true }
    }
  }),
  offrampController.verifyAccount
);

/**
 * @route    POST /api/offramp/webhook/lenco
 * @access   Public (signature verified if secret available)
 * @desc     Webhook endpoint for Lenco settlement confirmation
 */
router.post(
  '/webhook/lenco',
  rateLimitMiddleware,
  offrampController.handleLencoWebhook
);

// ============= PROTECTED ENDPOINTS =============

/**
 * @route    POST /api/offramp/initiate
 * @access   Private (requires JWT)
 * @desc     Initiate USDC → NGN offramp
 * 
 * @swagger
 * /api/offramp/initiate:
 *   post:
 *     summary: Initiate offramp transaction
 *     description: |
 *       Start a USDC to NGN offramp transaction.
 *       
 *       Process Flow:
 *       1. Validate amount (10-5000 USDC)
 *       2. Verify bank account with Lenco
 *       3. Calculate NGN amount with fees
 *       4. Create transaction record
 *       5. Return transaction reference for signing
 *       
 *       User must sign with Smart Account to confirm transfer.
 *       
 *       Limits:
 *       - Minimum: 10 USDC
 *       - Maximum: 5000 USDC per transaction
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountUSDC
 *               - beneficiary
 *             properties:
 *               amountUSDC:
 *                 type: number
 *                 minimum: 10
 *                 maximum: 5000
 *                 example: 100
 *               beneficiary:
 *                 type: object
 *                 required:
 *                   - name
 *                   - accountNumber
 *                   - bankCode
 *                 properties:
 *                   name:
 *                     type: string
 *                     example: "John Doe"
 *                   accountNumber:
 *                     type: string
 *                     example: "1234567890"
 *                   bankCode:
 *                     type: string
 *                     example: "011"
 *     responses:
 *       200:
 *         description: Offramp initiated successfully
 */
router.post(
  '/initiate',
  authMiddleware,
  rateLimitMiddleware,
  validateRequest({
    body: {
      amountUSDC: { type: 'number', required: true, min: 10, max: 5000 },
      beneficiary: {
        type: 'object',
        required: true,
        properties: {
          name: { type: 'string', required: true },
          accountNumber: { type: 'string', required: true },
          bankCode: { type: 'string', required: true }
        }
      }
    }
  }),
  offrampController.initiateOfframp
);

/**
 * @route    POST /api/offramp/confirm-transfer
 * @access   Private (requires JWT)
 * @desc     Confirm blockchain transaction
 */
router.post(
  '/confirm-transfer',
  authMiddleware,
  rateLimitMiddleware,
  validateRequest({
    body: {
      transactionReference: { type: 'string', required: true },
      txHash: { type: 'string', required: true }
    }
  }),
  offrampController.confirmTransfer
);

/**
 * @route    GET /api/offramp/status/:reference
 * @access   Private (requires JWT)
 * @desc     Get offramp transaction status
 */
router.get(
  '/status/:reference',
  authMiddleware,
  rateLimitMiddleware,
  offrampController.getStatus
);

/**
 * @route    GET /api/offramp/history
 * @access   Private (requires JWT)
 * @desc     Get user's offramp transaction history
 */
router.get(
  '/history',
  authMiddleware,
  rateLimitMiddleware,
  offrampController.getHistory
);

// ============= BENEFICIARY ENDPOINTS =============

/**
 * @route    POST /api/offramp/beneficiaries
 * @access   Private (requires JWT)
 * @desc     Add new beneficiary
 */
router.post(
  '/beneficiaries',
  authMiddleware,
  rateLimitMiddleware,
  validateRequest({
    body: {
      name: { type: 'string', required: true },
      accountNumber: { type: 'string', required: true },
      bankCode: { type: 'string', required: true }
    }
  }),
  offrampController.addBeneficiary
);

/**
 * @route    GET /api/offramp/beneficiaries
 * @access   Private (requires JWT)
 * @desc     Get all user's beneficiaries
 */
router.get(
  '/beneficiaries',
  authMiddleware,
  rateLimitMiddleware,
  offrampController.getBeneficiaries
);

/**
 * @route    DELETE /api/offramp/beneficiaries/:id
 * @access   Private (requires JWT)
 * @desc     Delete beneficiary (soft delete)
 */
router.delete(
  '/beneficiaries/:id',
  authMiddleware,
  rateLimitMiddleware,
  offrampController.deleteBeneficiary
);

/**
 * @route    PUT /api/offramp/beneficiaries/:id/default
 * @access   Private (requires JWT)
 * @desc     Set beneficiary as default
 */
router.put(
  '/beneficiaries/:id/default',
  authMiddleware,
  rateLimitMiddleware,
  offrampController.setDefaultBeneficiary
);

// ============= FREQUENT ACCOUNTS ENDPOINTS =============

/**
 * @route    GET /api/offramp/frequent-accounts
 * @access   Private (requires JWT)
 * @desc     Get frequently used bank accounts
 */
router.get(
  '/frequent-accounts',
  authMiddleware,
  rateLimitMiddleware,
  offrampController.getFrequentAccounts
);

// ============= ERROR HANDLING =============

/**
 * 404 for undefined offramp routes
 */
router.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Offramp endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET /',
      'GET /rate',
      'POST /verify-account',
      'POST /webhook/lenco',
      'POST /initiate',
      'POST /confirm-transfer',
      'GET /status/:reference',
      'GET /history',
      'POST /beneficiaries',
      'GET /beneficiaries',
      'DELETE /beneficiaries/:id',
      'PUT /beneficiaries/:id/default',
      'GET /frequent-accounts'
    ]
  });
});

// ============= EXPORTS =============

export default router;