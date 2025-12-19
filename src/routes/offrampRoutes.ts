// ============= src/routes/offrampRoutes.ts =============
/**
 * Offramp Routes
 * 
 * All USDC → NGN offramp endpoints
 * 
 * Public Endpoints:
 * - GET /rate - Get current rate (public)
 * - POST /webhook/lenco - Lenco webhook confirmation (signed)
 * 
 * Protected Endpoints (require JWT):
 * - POST /initiate - Start offramp
 * - POST /confirm-transfer - Confirm blockchain transaction
 * - GET /status/:reference - Get transaction status
 * - GET /history - Get user's transaction history
 * - POST /beneficiaries - Add/manage beneficiaries
 * - GET /frequent-accounts - Get frequently used accounts
 * 
 * Example Usage:
 * 
 * 1. Get Rate:
 *    GET /api/offramp/rate?amountUSDC=100
 * 
 * 2. Initiate Offramp:
 *    POST /api/offramp/initiate
 *    {
 *      "amountUSDC": 100,
 *      "beneficiary": {
 *        "name": "John Doe",
 *        "accountNumber": "1234567890",
 *        "bankCode": "011"
 *      }
 *    }
 * 
 * 3. Confirm Transaction (after user signs with Smart Account):
 *    POST /api/offramp/confirm-transfer
 *    {
 *      "transactionReference": "ABOKI_OFFRAMP_...",
 *      "txHash": "0x..."
 *    }
 * 
 * 4. Get Status:
 *    GET /api/offramp/status/ABOKI_OFFRAMP_...
 * 
 * 5. Get History:
 *    GET /api/offramp/history?limit=10&skip=0
 */

import express, { Router, Request, Response, NextFunction } from 'express';

// Middleware
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { 
    getRateLimiter,
    webhookLimiter,
    initiateOfframpLimiter,
    confirmTransferLimiter,
    statusLimiter,
    historyLimiter,
    beneficiaryLimiter
  } from '../middleware/rateLimiter'

// Controllers
import {
  getRate,
  initiateOfframp,
  confirmTransfer,
  getStatus,
  getHistory,
  handleLencoWebhook,
  addBeneficiary,
  getBeneficiaries,
  deleteBeneficiary,
  setDefaultBeneficiary,
  getFrequentAccounts
} from '../controllers/offrampController';

// ============= ROUTER SETUP =============

const router = Router();

// ============= PUBLIC ENDPOINTS =============

/**
 * @route    GET /api/offramp/rate
 * @query    amountUSDC=100
 * @access   Public
 * @desc     Get current offramp rate (detailed breakdown)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "baseRate": 1400,
 *     "offrampRate": 1420,
 *     "markup": 20,
 *     "fee": {
 *       "percentage": 1,
 *       "amountUSDC": 1,
 *       "amountNGN": 1400,
 *       "maxFeeUSD": 2,
 *       "effectiveFeePercent": 1
 *     },
 *     "calculation": {
 *       "amountUSDC": 100,
 *       "feeUSDC": 1,
 *       "netUSDC": 99,
 *       "ngnAmount": 140580,
 *       "effectiveRate": 1405.80,
 *       "lpFeeUSDC": 0.5,
 *       "breakdown": "100 USDC - 1 USDC fee = 99 USDC net = ₦140,580"
 *     },
 *     "source": "Paycrest",
 *     "cached": false,
 *     "timestamp": "2025-12-19T14:07:32.701Z"
 *   }
 * }
 */
router.get(
  '/rate',
  getRateLimiter,
  getRate
);

/**
 * @route    POST /api/offramp/webhook/lenco
 * @access   Public (but signature verified)
 * @desc     Webhook endpoint for Lenco settlement confirmation
 * 
 * Body:
 * {
 *   "event": "transfer.completed",
 *   "data": {
 *     "reference": "LENCO_...",
 *     "amount": 140580,
 *     "status": "completed"
 *   },
 *   "signature": "..."
 * }
 */
router.post(
  '/webhook/lenco',
  webhookLimiter,
  handleLencoWebhook
);

// ============= PROTECTED ENDPOINTS =============

/**
 * @route    POST /api/offramp/initiate
 * @access   Private (requires JWT)
 * @desc     Initiate USDC → NGN offramp
 * 
 * Body:
 * {
 *   "amountUSDC": 100,
 *   "beneficiary": {
 *     "name": "John Doe",
 *     "accountNumber": "1234567890",
 *     "bankCode": "011"
 *   }
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
 *     "userAddress": "0x...",
 *     "beneficiary": {
 *       "name": "John Doe",
 *       "bankCode": "011"
 *     }
 *   }
 * }
 */
router.post(
  '/initiate',
  authMiddleware,
  initiateOfframpLimiter,
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
  initiateOfframp
);

/**
 * @route    POST /api/offramp/confirm-transfer
 * @access   Private (requires JWT)
 * @desc     Confirm blockchain transaction (user's Smart Account sent USDC)
 * 
 * Body:
 * {
 *   "transactionReference": "ABOKI_OFFRAMP_...",
 *   "txHash": "0x..."
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "status": "PROCESSING",
 *     "message": "Transfer confirmed, settling with Lenco",
 *     "lencoReference": "LENCO_..."
 *   }
 * }
 */
router.post(
  '/confirm-transfer',
  authMiddleware,
  confirmTransferLimiter,
  validateRequest({
    body: {
      transactionReference: { type: 'string', required: true },
      txHash: { type: 'string', required: true }
    }
  }),
  confirmTransfer
);

/**
 * @route    GET /api/offramp/status/:reference
 * @access   Private (requires JWT)
 * @desc     Get offramp transaction status
 * 
 * Params:
 * - reference: ABOKI_OFFRAMP_... (transaction reference)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transactionReference": "ABOKI_OFFRAMP_...",
 *     "status": "SETTLING",
 *     "amountUSDC": 100,
 *     "amountNGN": 140580,
 *     "beneficiary": "John Doe",
 *     "createdAt": "2025-12-19T...",
 *     "completedAt": null
 *   }
 * }
 */
router.get(
  '/status/:reference',
  authMiddleware,
  statusLimiter,
  getStatus
);

/**
 * @route    GET /api/offramp/history
 * @access   Private (requires JWT)
 * @desc     Get user's offramp transaction history
 * 
 * Query:
 * - limit: number (default: 10, max: 50)
 * - skip: number (default: 0)
 * - status: PENDING|PROCESSING|SETTLING|COMPLETED|FAILED (optional)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "reference": "ABOKI_OFFRAMP_...",
 *       "status": "COMPLETED",
 *       "amountUSDC": 100,
 *       "amountNGN": 140580,
 *       "beneficiary": "John Doe",
 *       "createdAt": "2025-12-19T..."
 *     }
 *   ],
 *   "pagination": {
 *     "total": 25,
 *     "limit": 10,
 *     "skip": 0
 *   }
 * }
 */
router.get(
  '/history',
  authMiddleware,
  historyLimiter,
  getHistory
);

// ============= BENEFICIARY ENDPOINTS =============

/**
 * @route    POST /api/offramp/beneficiaries
 * @access   Private (requires JWT)
 * @desc     Add new beneficiary
 * 
 * Body:
 * {
 *   "name": "John Doe",
 *   "accountNumber": "1234567890",
 *   "bankCode": "011"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "507f1f77bcf86cd799439011",
 *     "name": "John Doe",
 *     "accountNumber": "1234567890",
 *     "bankCode": "011",
 *     "isVerified": false,
 *     "verificationStatus": "PENDING"
 *   }
 * }
 */
router.post(
  '/beneficiaries',
  authMiddleware,
  beneficiaryLimiter,
  validateRequest({
    body: {
      name: { type: 'string', required: true },
      accountNumber: { type: 'string', required: true },
      bankCode: { type: 'string', required: true }
    }
  }),
  addBeneficiary
);

/**
 * @route    GET /api/offramp/beneficiaries
 * @access   Private (requires JWT)
 * @desc     Get all user's beneficiaries
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "507f1f77bcf86cd799439011",
 *       "name": "John Doe",
 *       "accountNumber": "1234567890",
 *       "bankCode": "011",
 *       "bankName": "First Bank",
 *       "isVerified": true,
 *       "isDefault": true,
 *       "usageCount": 5,
 *       "lastUsedAt": "2025-12-19T..."
 *     }
 *   ]
 * }
 */
router.get(
  '/beneficiaries',
  authMiddleware,
  beneficiaryLimiter,
  getBeneficiaries
);

/**
 * @route    DELETE /api/offramp/beneficiaries/:id
 * @access   Private (requires JWT)
 * @desc     Delete beneficiary (soft delete)
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Beneficiary deleted"
 * }
 */
router.delete(
  '/beneficiaries/:id',
  authMiddleware,
  beneficiaryLimiter,
  deleteBeneficiary
);

/**
 * @route    PUT /api/offramp/beneficiaries/:id/default
 * @access   Private (requires JWT)
 * @desc     Set beneficiary as default
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "507f1f77bcf86cd799439011",
 *     "isDefault": true
 *   }
 * }
 */
router.put(
  '/beneficiaries/:id/default',
  authMiddleware,
  beneficiaryLimiter,
  setDefaultBeneficiary
);

// ============= FREQUENT ACCOUNTS ENDPOINTS =============

/**
 * @route    GET /api/offramp/frequent-accounts
 * @access   Private (requires JWT)
 * @desc     Get frequently used bank accounts
 * 
 * Query:
 * - type: 'top' | 'recent' (default: 'top')
 * - limit: number (default: 5, max: 20)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "507f1f77bcf86cd799439011",
 *       "name": "John's Account",
 *       "accountNumber": "1234567890",
 *       "bankCode": "011",
 *       "bankName": "First Bank",
 *       "usageCount": 15,
 *       "totalAmountSent": 1500,
 *       "lastUsedAt": "2025-12-19T..."
 *     }
 *   ]
 * }
 */
router.get(
  '/frequent-accounts',
  authMiddleware,
  historyLimiter,
  getFrequentAccounts
);

// ============= ERROR HANDLING =============

/**
 * 404 for undefined offramp routes
 */
router.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Offramp endpoint not found: ${req.method} ${req.path}`
  });
});

// ============= EXPORTS =============

export default router;

/**
 * INTEGRATION EXAMPLE:
 * 
 * In your main app.ts:
 * 
 * import offrampRoutes from './routes/offrampRoutes';
 * 
 * app.use('/api/offramp', offrampRoutes);
 * 
 * This mounts all routes at /api/offramp with 11 endpoints:
 * 1. GET /rate
 * 2. POST /webhook/lenco
 * 3. POST /initiate
 * 4. POST /confirm-transfer
 * 5. GET /status/:reference
 * 6. GET /history
 * 7. POST /beneficiaries
 * 8. GET /beneficiaries
 * 9. DELETE /beneficiaries/:id
 * 10. PUT /beneficiaries/:id/default
 * 11. GET /frequent-accounts
 */

/**
 * RATE LIMITS (per minute):
 * - GET /rate: 100 (public)
 * - POST /webhook/lenco: 1000 (webhooks)
 * - POST /initiate: 20 (per user)
 * - POST /confirm-transfer: 30 (per user)
 * - GET /status: 100 (per user)
 * - GET /history: 50 (per user)
 * - POST /beneficiaries: 20 (per user)
 * - GET /beneficiaries: 50 (per user)
 * - DELETE /beneficiaries: 20 (per user)
 * - PUT /beneficiaries/default: 20 (per user)
 * - GET /frequent-accounts: 50 (per user)
 */

/**
 * RESPONSE PATTERN:
 * 
 * Success:
 * {
 *   "success": true,
 *   "data": { ... },
 *   "message": "Optional success message"
 * }
 * 
 * Error:
 * {
 *   "success": false,
 *   "error": "Error message",
 *   "code": "ERROR_CODE" (optional)
 * }
 */