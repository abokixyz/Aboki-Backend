// ============= src/routes/transferRoutes.ts =============
/**
 * TRANSFER FLOW WITH PASSKEY VERIFICATION:
 * 
 * 1. POST /api/transfer/send/username OR /api/transfer/send/external
 *    - Must include X-Passkey-Verified-Token header
 *    - Gets passkey token from /api/auth/passkey/transaction-verify
 * 
 * 2. POST /api/transfer/create-link
 *    - Create payment link (no passkey required initially)
 *    - Link can be shared and claimed by others
 * 
 * 3. POST /api/transfer/claim/:linkCode
 *    - Claim payment from link (requires user to have wallet)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { protect } from '../middleware/auth';
import { 
  verifyPasskeyToken, 
  requirePasskeyVerification 
} from '../middleware/passkeyVerification';
import { validateRequest } from '../middleware/validation';
import { requirePasskey } from '../middleware/requirePasskey';
import rateLimitMiddleware from '../middleware/rateLimiter';
import transferController from '../controllers/transferController';

const router = Router();

// ============= ROOT ENDPOINT =============

/**
 * @route   GET /api/transfer
 * @access  Public
 * @desc    API information
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Transfer API (with Passkey Verification)',
    version: '2.0.0',
    features: {
      usernameTransfer: 'Send USDC to another Aboki user',
      externalWalletTransfer: 'Send USDC to external wallet address',
      paymentLinks: 'Create shareable payment links'
    },
    flow: {
      step1: 'POST /api/auth/passkey/transaction-verify-options - Get challenge',
      step2: 'User completes biometric auth',
      step3: 'POST /api/auth/passkey/transaction-verify - Get verification token',
      step4: 'POST /send/username or /send/external - Include verification token'
    }
  });
});

// ============= PUBLIC ENDPOINTS =============

/**
 * @route    GET /api/transfer/validate-username/:username
 * @access   Public
 * @desc     Validate if username exists
 * 
 * @param    username - Username to check
 * 
 * @example
 * GET /api/transfer/validate-username/johndoe
 * 
 * Response:
 * {
 *   "success": true,
 *   "exists": true,
 *   "data": {
 *     "username": "johndoe",
 *     "name": "John Doe"
 *   }
 * }
 */
router.get(
  '/validate-username/:username',
  rateLimitMiddleware,
  transferController.validateUsername
);

/**
 * @route    GET /api/transfer/link/:linkCode
 * @access   Public
 * @desc     Get payment link details (shows who sent it)
 * 
 * @param    linkCode - Link code from create-link response
 * 
 * @example
 * GET /api/transfer/link/ABOKI_1704067200000_abc123
 */
router.get(
  '/link/:linkCode',
  rateLimitMiddleware,
  transferController.getPaymentLinkDetails
);

// ============= PROTECTED ENDPOINTS (JWT Required) =============

/**
 * @route    GET /api/transfer/contacts
 * @access   Private (JWT required)
 * @desc     Get all contacts (users you've sent to)
 * 
 * @example
 * GET /api/transfer/contacts
 * Authorization: Bearer {jwt_token}
 * 
 * Response:
 * {
 *   "success": true,
 *   "count": 5,
 *   "data": [
 *     {
 *       "id": "...",
 *       "username": "johndoe",
 *       "name": "John Doe",
 *       "transferCount": 3,
 *       "totalAmountTransferred": 50,
 *       "lastInteractedAt": "2024-01-01T00:00:00Z"
 *     }
 *   ]
 * }
 */
router.get(
  '/contacts',
  protect,
  rateLimitMiddleware,
  transferController.getMyContacts
);

/**
 * @route    GET /api/transfer/contacts/recent
 * @access   Private (JWT required)
 * @desc     Get recent contacts for quick send suggestions
 * 
 * @query    limit - Number of contacts (default: 5)
 * 
 * @example
 * GET /api/transfer/contacts/recent?limit=10
 * Authorization: Bearer {jwt_token}
 */
router.get(
  '/contacts/recent',
  protect,
  rateLimitMiddleware,
  transferController.getRecentContacts
);

/**
 * @route    POST /api/transfer/send/username
 * @access   Private (JWT required + Passkey verification required)
 * @desc     Send USDC to another Aboki user by username
 * 
 * REQUIRES PASSKEY VERIFICATION:
 * 1. POST /api/auth/passkey/transaction-verify-options
 * 2. User completes biometric auth
 * 3. POST /api/auth/passkey/transaction-verify (get token)
 * 4. Include X-Passkey-Verified-Token header in this request
 * 
 * @headers
 * - Authorization: Bearer {jwt_token}
 * - X-Passkey-Verified-Token: {passkey_token_from_step_3}
 * 
 * @example
 * POST /api/transfer/send/username
 * Authorization: Bearer {jwt_token}
 * X-Passkey-Verified-Token: {passkey_token}
 * {
 *   "username": "johndoe",
 *   "amount": 10.5,
 *   "message": "Coffee money"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transferId": "...",
 *     "from": "yourname",
 *     "to": "johndoe",
 *     "amount": 10.5,
 *     "transactionHash": "0x...",
 *     "explorerUrl": "https://basescan.org/tx/...",
 *     "gasSponsored": true,
 *     "verifiedWithPasskey": true
 *   }
 * }
 */
router.post(
  '/send/username',
  protect,
  requirePasskey,  // ✅ ADD THIS LINE
  rateLimitMiddleware,
  validateRequest({
    body: {
      username: { type: 'string', required: true },
      amount: { type: 'number', required: true, min: 0.01 }
    }
  }),
  transferController.sendToUsername
);

/**
 * @route    POST /api/transfer/send/external
 * @access   Private (JWT required + Passkey verification required)
 * @desc     Send USDC to external wallet (Base network only)
 * 
 * REQUIRES PASSKEY VERIFICATION:
 * 1. POST /api/auth/passkey/transaction-verify-options
 * 2. User completes biometric auth
 * 3. POST /api/auth/passkey/transaction-verify (get token)
 * 4. Include X-Passkey-Verified-Token header in this request
 * 
 * @headers
 * - Authorization: Bearer {jwt_token}
 * - X-Passkey-Verified-Token: {passkey_token_from_step_3}
 * 
 * @example
 * POST /api/transfer/send/external
 * Authorization: Bearer {jwt_token}
 * X-Passkey-Verified-Token: {passkey_token}
 * {
 *   "address": "0x742d35Cc6634C0532925a3b844Bc8e8C42ADDC11",
 *   "amount": 10.5,
 *   "message": "Refund"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transferId": "...",
 *     "from": "yourname",
 *     "to": "0x742d35Cc6634C0532925a3b844Bc8e8C42ADDC11",
 *     "amount": 10.5,
 *     "transactionHash": "0x...",
 *     "explorerUrl": "https://basescan.org/tx/...",
 *     "gasSponsored": true,
 *     "verifiedWithPasskey": true
 *   }
 * }
 */
router.post(
  '/send/external',
  protect,
  requirePasskey,  // ✅ ADD THIS LINE
  rateLimitMiddleware,
  validateRequest({
    body: {
      address: { type: 'string', required: true },
      amount: { type: 'number', required: true, min: 0.01 }
    }
  }),
  transferController.sendToExternal
);

/**
 * @route    POST /api/transfer/create-link
 * @access   Private (JWT required)
 * @desc     Create a payment link to share with others
 * 
 * Anyone can claim this link by visiting the claim URL.
 * The sender's invite code is embedded in the URL.
 * 
 * @example
 * POST /api/transfer/create-link
 * Authorization: Bearer {jwt_token}
 * {
 *   "amount": 25,
 *   "message": "Birthday gift"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transferId": "...",
 *     "linkCode": "ABOKI_1704067200000_abc123",
 *     "claimUrl": "https://aboki.xyz/claim/ABOKI_1704067200000_abc123?invite=abc123",
 *     "amount": 25,
 *     "message": "Birthday gift",
 *     "inviteCode": "abc123",
 *     "expiresAt": "2024-02-01T00:00:00Z"
 *   }
 * }
 */
router.post(
  '/create-link',
  protect,
  requirePasskey,  // ✅ ADD THIS LINE
  rateLimitMiddleware,
  validateRequest({
    body: {
      amount: { type: 'number', required: true, min: 0.01 }
    }
  }),
  transferController.createPaymentLink
);

/**
 * @route    POST /api/transfer/claim/:linkCode
 * @access   Private (JWT required)
 * @desc     Claim USDC from a payment link
 * 
 * Only the payment receiver needs to call this.
 * Requires recipient to have a wallet.
 * 
 * @param    linkCode - Link code from the claim URL
 * 
 * @example
 * POST /api/transfer/claim/ABOKI_1704067200000_abc123
 * Authorization: Bearer {jwt_token}
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transferId": "...",
 *     "from": "johndoe",
 *     "amount": 25,
 *     "transactionHash": "0x...",
 *     "explorerUrl": "https://basescan.org/tx/..."
 *   }
 * }
 */
router.post(
  '/claim/:linkCode',
  protect,
  rateLimitMiddleware,
  transferController.claimPaymentLink
);

/**
 * @route    GET /api/transfer/history
 * @access   Private (JWT required)
 * @desc     Get user's transfer history (sent and received)
 * 
 * @example
 * GET /api/transfer/history
 * Authorization: Bearer {jwt_token}
 * 
 * Response:
 * {
 *   "success": true,
 *   "count": 10,
 *   "data": [
 *     {
 *       "id": "...",
 *       "type": "USERNAME",
 *       "direction": "SENT",
 *       "from": "yourname",
 *       "to": "johndoe",
 *       "amount": 10.5,
 *       "status": "COMPLETED",
 *       "verifiedWithPasskey": true,
 *       "createdAt": "2024-01-01T00:00:00Z"
 *     }
 *   ]
 * }
 */
router.get(
  '/history',
  protect,
  rateLimitMiddleware,
  transferController.getTransferHistory
);

/**
 * @route    DELETE /api/transfer/link/:linkCode
 * @access   Private (JWT required)
 * @desc     Cancel a pending payment link
 * 
 * Can only cancel if status is PENDING
 * 
 * @param    linkCode - Link code from create-link response
 * 
 * @example
 * DELETE /api/transfer/link/ABOKI_1704067200000_abc123
 * Authorization: Bearer {jwt_token}
 */
router.delete(
  '/link/:linkCode',
  protect,
  rateLimitMiddleware,
  transferController.cancelPaymentLink
);

// ============= 404 HANDLER =============

router.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Transfer endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET  /api/transfer',
      'GET  /api/transfer/validate-username/:username',
      'GET  /api/transfer/link/:linkCode',
      'GET  /api/transfer/contacts',
      'GET  /api/transfer/contacts/recent',
      'POST /api/transfer/send/username',
      'POST /api/transfer/send/external',
      'POST /api/transfer/create-link',
      'POST /api/transfer/claim/:linkCode',
      'GET  /api/transfer/history',
      'DELETE /api/transfer/link/:linkCode'
    ]
  });
});

export default router;