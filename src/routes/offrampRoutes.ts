// ============= src/routes/offrampRoutes.ts =============
/**
 * OFFRAMP FLOW WITH PASSKEY VERIFICATION:
 * 
 * 1. POST /api/offramp/initiate
 *    - Create transaction record
 *    - Response: transactionReference, accountName, amountNGN
 * 
 * 2. POST /api/auth/passkey/transaction-verify-options
 *    - Get passkey challenge
 *    - User completes biometric auth
 * 
 * 3. POST /api/auth/passkey/transaction-verify
 *    - Verify biometric signature
 *    - Get verification token
 *    - Include X-Passkey-Verified-Token header in next request
 * 
 * 4. POST /api/offramp/confirm-account-and-sign
 *    - Include X-Passkey-Verified-Token header
 *    - Confirms account match
 *    - Executes Aboki.createOrder() on Smart Account
 *    - Initiates Lenco settlement
 */

import { Router, Request, Response, NextFunction } from 'express';
import { protect } from '../middleware/auth';
import { 
  verifyPasskeyToken, 
  requirePasskeyVerification 
} from '../middleware/passkeyVerification';
import { validateRequest } from '../middleware/validation';
import rateLimitMiddleware from '../middleware/rateLimiter';
import offrampController from '../controllers/offrampController';

const router = Router();

// ============= ROOT ENDPOINT =============

/**
 * @route   GET /api/offramp
 * @access  Public
 * @desc    API information
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

// ============= PUBLIC ENDPOINTS =============

/**
 * @route    GET /api/offramp/rate
 * @access   Public
 * @desc     Get current offramp rate
 * @query    amountUSDC - Optional amount for specific calculation
 */
router.get(
  '/rate',
  rateLimitMiddleware,
  offrampController.getRate
);

/**
 * @route    POST /api/offramp/verify-account
 * @access   Public
 * @desc     Verify Nigerian bank account details
 * 
 * @example
 * POST /api/offramp/verify-account
 * {
 *   "accountNumber": "1234567890",
 *   "bankCode": "011"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "accountName": "John Doe",
 *     "accountNumber": "1234567890",
 *     "bankCode": "011",
 *     "bankName": "First Bank of Nigeria"
 *   }
 * }
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
 * @access   Public (Webhook from Lenco)
 * @desc     Lenco settlement confirmation webhook
 * 
 * Events:
 * - transfer.completed
 * - transfer.failed
 */
router.post(
  '/webhook/lenco',
  rateLimitMiddleware,
  offrampController.handleLencoWebhook
);

// ============= PROTECTED ENDPOINTS (JWT Required) =============

/**
 * @route    POST /api/offramp/initiate
 * @access   Private (JWT required)
 * @desc     Initiate USDC → NGN offramp transaction
 * 
 * @example
 * POST /api/offramp/initiate
 * Authorization: Bearer {jwt_token}
 * {
 *   "amountUSDC": 100,
 *   "accountNumber": "1234567890",
 *   "bankCode": "011"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transactionReference": "ABOKI_OFFRAMP_...",
 *     "status": "PENDING",
 *     "amountUSDC": 100,
 *     "amountNGN": 140580,
 *     "accountName": "John Doe",
 *     "accountNumber": "****7890",
 *     "nextStep": "Verify account & sign with passkey"
 *   }
 * }
 */
router.post(
  '/initiate',
  protect,
  rateLimitMiddleware,
  validateRequest({
    body: {
      amountUSDC: { type: 'number', required: true, min: 0.1, max: 5000 }
    }
  }),
  offrampController.initiateOfframp
);

/**
 * @route    POST /api/offramp/confirm-account-and-sign
 * @access   Private (JWT required + Passkey token required)
 * @desc     Confirm account details and sign transaction with passkey
 * 
 * This is the final step:
 * 1. Validates account matches original
 * 2. Checks passkey verification token
 * 3. Executes Aboki.createOrder() on Smart Account (gasless)
 * 4. Initiates Lenco NGN settlement
 * 
 * @headers
 * - Authorization: Bearer {jwt_token}
 * - X-Passkey-Verified-Token: {passkey_token_from_step_3}
 * 
 * @example
 * POST /api/offramp/confirm-account-and-sign
 * Authorization: Bearer {jwt_token}
 * X-Passkey-Verified-Token: {passkey_token}
 * {
 *   "transactionReference": "ABOKI_OFFRAMP_...",
 *   "accountNumber": "1234567890",
 *   "bankCode": "011"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transactionReference": "ABOKI_OFFRAMP_...",
 *     "status": "SETTLING",
 *     "amountUSDC": 100,
 *     "amountNGN": 140580,
 *     "accountName": "John Doe",
 *     "transactionHash": "0x...",
 *     "lencoTransactionId": "LENCO_...",
 *     "verifiedWithPasskey": true,
 *     "estimatedSettlementTime": "5-15 minutes"
 *   }
 * }
 */
router.post(
  '/confirm-account-and-sign',
  protect,
  verifyPasskeyToken,  // ✅ Check for passkey token
  rateLimitMiddleware,
  offrampController.confirmAccountAndSign
);

/**
 * @route    GET /api/offramp/status/:reference
 * @access   Private (JWT required)
 * @desc     Get transaction status
 * 
 * @param    reference - Transaction reference from initiate response
 * 
 * @example
 * GET /api/offramp/status/ABOKI_OFFRAMP_...
 * Authorization: Bearer {jwt_token}
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transactionReference": "ABOKI_OFFRAMP_...",
 *     "status": "SETTLING",
 *     "amountUSDC": 100,
 *     "amountNGN": 140580,
 *     "accountName": "John Doe",
 *     "bankName": "First Bank",
 *     "transactionHash": "0x...",
 *     "lencoTransactionId": "LENCO_...",
 *     "createdAt": "2024-01-01T00:00:00Z"
 *   }
 * }
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
 * @desc     Get user's offramp transaction history
 * 
 * @query    limit - Number of transactions (default: 10, max: 50)
 * @query    skip - Pagination offset (default: 0)
 * 
 * @example
 * GET /api/offramp/history?limit=20&skip=0
 * Authorization: Bearer {jwt_token}
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": [...transactions],
 *   "pagination": {
 *     "total": 100,
 *     "limit": 20,
 *     "skip": 0,
 *     "hasMore": true
 *   }
 * }
 */
router.get(
  '/history',
  protect,
  rateLimitMiddleware,
  offrampController.getHistory
);

// ============= BENEFICIARY ENDPOINTS =============

/**
 * @route    POST /api/offramp/beneficiaries
 * @access   Private (JWT required)
 * @desc     Add a new beneficiary bank account
 * 
 * @example
 * POST /api/offramp/beneficiaries
 * Authorization: Bearer {jwt_token}
 * {
 *   "name": "John Doe",
 *   "accountNumber": "1234567890",
 *   "bankCode": "011"
 * }
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

/**
 * @route    GET /api/offramp/beneficiaries
 * @access   Private (JWT required)
 * @desc     Get all saved beneficiaries
 * 
 * @example
 * GET /api/offramp/beneficiaries
 * Authorization: Bearer {jwt_token}
 */
router.get(
  '/beneficiaries',
  protect,
  rateLimitMiddleware,
  offrampController.getBeneficiaries
);

/**
 * @route    DELETE /api/offramp/beneficiaries/:id
 * @access   Private (JWT required)
 * @desc     Delete a beneficiary
 * 
 * @param    id - Beneficiary ID
 */
router.delete(
  '/beneficiaries/:id',
  protect,
  rateLimitMiddleware,
  offrampController.deleteBeneficiary
);

/**
 * @route    PUT /api/offramp/beneficiaries/:id/default
 * @access   Private (JWT required)
 * @desc     Set a beneficiary as default
 * 
 * @param    id - Beneficiary ID
 */
router.put(
  '/beneficiaries/:id/default',
  protect,
  rateLimitMiddleware,
  offrampController.setDefaultBeneficiary
);

// ============= FREQUENT ACCOUNTS =============

/**
 * @route    GET /api/offramp/frequent-accounts
 * @access   Private (JWT required)
 * @desc     Get frequently used bank accounts
 * 
 * @query    type - 'top' (default) or 'recent'
 * @query    limit - Number of accounts (default: 5, max: 20)
 * 
 * @example
 * GET /api/offramp/frequent-accounts?type=top&limit=5
 * Authorization: Bearer {jwt_token}
 */
router.get(
  '/frequent-accounts',
  protect,
  rateLimitMiddleware,
  offrampController.getFrequentAccounts
);

// ============= 404 HANDLER =============

router.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Offramp endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET  /api/offramp',
      'GET  /api/offramp/rate',
      'POST /api/offramp/verify-account',
      'POST /api/offramp/webhook/lenco',
      'POST /api/offramp/initiate',
      'POST /api/offramp/confirm-account-and-sign',
      'GET  /api/offramp/status/:reference',
      'GET  /api/offramp/history',
      'POST /api/offramp/beneficiaries',
      'GET  /api/offramp/beneficiaries',
      'DELETE /api/offramp/beneficiaries/:id',
      'PUT /api/offramp/beneficiaries/:id/default',
      'GET /api/offramp/frequent-accounts'
    ]
  });
});

export default router;