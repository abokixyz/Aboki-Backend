// ============= src/routes/offrampRoutes.ts (WITH PASSKEY VERIFICATION) =============
/**
 * CORRECTED OFFRAMP FLOW WITH PASSKEY:
 * 
 * 1. User initiates offramp
 *    POST /api/offramp/initiate
 *    Request: { amountUSDC, accountNumber, bankCode }
 *    Response: { transactionRef, accountName, amountNGN } (status: PENDING)
 * 
 * 2. User verifies account (optional, but recommended)
 *    POST /api/offramp/verify-account
 *    Request: { accountNumber, bankCode }
 *    Response: { accountName, bankCode, bankName }
 * 
 * 3. User requests passkey challenge
 *    POST /api/auth/passkey/transaction-verify-options
 *    Request: { type: 'withdraw', amount, recipient: bankCode }
 *    Response: { challenge, timeout, rpId }
 * 
 * 4. User completes biometric auth & gets verification token
 *    POST /api/auth/passkey/transaction-verify
 *    Request: { credentialId, signature, authenticatorData, etc }
 *    Response: { verified: true, token }
 * 
 * 5. User confirms account & initiates settlement
 *    POST /api/offramp/confirm-account-and-sign
 *    Request: { transactionRef, passkeyToken, accountNumber, bankCode }
 *    Response: { status: PROCESSING, lencoRef }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, protect } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import rateLimitMiddleware from '../middleware/rateLimiter';
import offrampController from '../controllers/offrampController';

const router = Router();

/**
 * ROOT ENDPOINT
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Offramp API (with Passkey Verification)',
    version: '2.0.0',
    flow: {
      step1: 'POST /api/offramp/initiate - Start offramp',
      step2: 'POST /api/offramp/verify-account - Verify bank details',
      step3: 'POST /api/auth/passkey/transaction-verify-options - Get challenge',
      step4: 'POST /api/auth/passkey/transaction-verify - Sign with passkey',
      step5: 'POST /api/offramp/confirm-account-and-sign - Confirm & settle'
    }
  });
});

/**
 * PUBLIC ENDPOINTS
 */

/**
 * @route    GET /api/offramp/rate
 * @access   Public
 * @desc     Get current offramp rate
 */
router.get(
  '/rate',
  rateLimitMiddleware,
  offrampController.getRate
);

/**
 * @route    POST /api/offramp/verify-account
 * @access   Public
 * @desc     Verify bank account details
 * 
 * @swagger
 * /api/offramp/verify-account:
 *   post:
 *     summary: Verify Nigerian bank account
 *     description: |
 *       Verify a bank account before initiating offramp.
 *       Returns account name if verification succeeds.
 *       
 *       This is used to confirm the account number is correct.
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
 *               bankCode:
 *                 type: string
 *                 example: "011"
 *     responses:
 *       200:
 *         description: Account verified successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 accountName: "John Doe"
 *                 accountNumber: "1234567890"
 *                 bankCode: "011"
 *                 bankName: "First Bank of Nigeria"
 *       400:
 *         description: Invalid account or verification failed
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
 * @access   Public
 * @desc     Lenco settlement confirmation webhook
 */
router.post(
  '/webhook/lenco',
  rateLimitMiddleware,
  offrampController.handleLencoWebhook
);

/**
 * PROTECTED ENDPOINTS (Require JWT)
 */

/**
 * @route    POST /api/offramp/initiate
 * @access   Private (JWT required)
 * @desc     Initiate USDC → NGN offramp transaction
 * 
 * @swagger
 * /api/offramp/initiate:
 *   post:
 *     summary: Initiate offramp transaction
 *     description: |
 *       Start an offramp transaction. Creates a PENDING transaction record.
 *       
 *       Process:
 *       1. Validate amount (0.1-5000 USDC)
 *       2. Verify bank account with Lenco
 *       3. Calculate NGN amount with fees
 *       4. Create transaction record (PENDING)
 *       5. User must verify account & sign with passkey
 *       
 *       Next step: Call POST /api/offramp/verify-account to confirm details
 *       Then: Call POST /api/offramp/confirm-account-and-sign after passkey verification
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
 *               - accountNumber
 *               - bankCode
 *             properties:
 *               amountUSDC:
 *                 type: number
 *                 minimum: 0.1
 *                 maximum: 5000
 *                 example: 100
 *               accountNumber:
 *                 type: string
 *                 example: "1234567890"
 *               bankCode:
 *                 type: string
 *                 example: "011"
 *     responses:
 *       201:
 *         description: Offramp initiated (PENDING verification)
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 transactionReference: "ABOKI_OFFRAMP_abc123..."
 *                 status: "PENDING"
 *                 amountUSDC: 100
 *                 amountNGN: 140580
 *                 accountName: "John Doe"
 *                 nextStep: "Verify account & sign with passkey"
 */
router.post(
  '/initiate',
  protect,
  rateLimitMiddleware,
  validateRequest({
    body: {
      amountUSDC: { type: 'number', required: true, min: 0.1, max: 5000 },
      accountNumber: { type: 'string', required: true },
      bankCode: { type: 'string', required: true }
    }
  }),
  offrampController.initiateOfframp
);

/**
 * @route    POST /api/offramp/confirm-account-and-sign
 * @access   Private (JWT required + Passkey token required)
 * @desc     Confirm account details and sign transaction with passkey
 * 
 * @swagger
 * /api/offramp/confirm-account-and-sign:
 *   post:
 *     summary: Confirm account and sign transaction with passkey
 *     description: |
 *       Final step of offramp: Confirm account is correct, verify with passkey signature,
 *       and initiate Lenco settlement.
 *       
 *       This requires:
 *       1. Valid transaction reference from /initiate
 *       2. Valid passkey verification token from /api/auth/passkey/transaction-verify
 *       3. Account details match original transaction
 *       4. Include X-Passkey-Verified: true header
 *       
 *       Status flow: PENDING → PROCESSING → SETTLING → COMPLETED
 *     tags: [Offramp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Passkey-Verified
 *         required: true
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Must be 'true' after passkey verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionReference
 *               - accountNumber
 *               - bankCode
 *             properties:
 *               transactionReference:
 *                 type: string
 *                 example: "ABOKI_OFFRAMP_abc123..."
 *                 description: From /initiate response
 *               accountNumber:
 *                 type: string
 *                 example: "1234567890"
 *                 description: Must match original account
 *               bankCode:
 *                 type: string
 *                 example: "011"
 *                 description: Must match original bank
 *     responses:
 *       200:
 *         description: Account confirmed and settlement initiated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 transactionReference: "ABOKI_OFFRAMP_abc123..."
 *                 status: "SETTLING"
 *                 amountUSDC: 100
 *                 amountNGN: 140580
 *                 accountName: "John Doe"
 *                 lencoReference: "LENCO_REF_123"
 *                 estimatedTime: "5-15 minutes"
 *                 verifiedWithPasskey: true
 *       400:
 *         description: Account mismatch or invalid request
 *       401:
 *         description: Missing passkey verification or invalid token
 */
router.post(
  '/confirm-account-and-sign',
  protect,
  rateLimitMiddleware,
  offrampController.confirmAccountAndSign
);

/**
 * @route    GET /api/offramp/status/:reference
 * @access   Private (JWT required)
 * @desc     Get transaction status
 */
router.get(
  '/status/:reference',
  protect,
  rateLimitMiddleware,
  offrampController.getStatus
);

/**
 * @route    GET /api/offramp/history
 * @access   Private (JWT required)
 * @desc     Get transaction history
 */
router.get(
  '/history',
  protect,
  rateLimitMiddleware,
  offrampController.getHistory
);

/**
 * BENEFICIARY ENDPOINTS
 */

router.post(
  '/beneficiaries',
  protect,
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

router.get(
  '/beneficiaries',
  protect,
  rateLimitMiddleware,
  offrampController.getBeneficiaries
);

router.delete(
  '/beneficiaries/:id',
  protect,
  rateLimitMiddleware,
  offrampController.deleteBeneficiary
);

router.put(
  '/beneficiaries/:id/default',
  protect,
  rateLimitMiddleware,
  offrampController.setDefaultBeneficiary
);

/**
 * FREQUENT ACCOUNTS
 */

router.get(
  '/frequent-accounts',
  protect,
  rateLimitMiddleware,
  offrampController.getFrequentAccounts
);

/**
 * 404 HANDLER
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
      'POST /confirm-account-and-sign',
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

export default router;