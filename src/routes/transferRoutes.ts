// ============= src/routes/transferRoutes.ts (WITH PASSKEY VERIFICATION) =============
import { Router, Request, Response, NextFunction } from 'express';
import {
  validateUsername,
  getMyContacts,
  getRecentContacts,
  sendToUsername,
  sendToExternal,
  createPaymentLink,
  claimPaymentLink,
  getPaymentLinkDetails,
  getTransferHistory,
  cancelPaymentLink
} from '../controllers/transferController';
import { protect } from '../middleware/auth';

const router = Router();

/**
 * MIDDLEWARE: Check if transaction has been verified with passkey
 * This middleware checks if the request has been authorized by passkey verification
 */
const requirePasskeyVerification = (req: Request, res: Response, next: NextFunction) => {
  // Check if this request includes passkey verification header
  const passkeyVerification = req.headers['x-passkey-verified'] === 'true';
  
  if (!passkeyVerification) {
    return res.status(401).json({
      success: false,
      error: 'Transaction verification required',
      code: 'PASSKEY_VERIFICATION_REQUIRED',
      requiresPasskeyVerification: true,
      message: 'Please verify this transaction with your passkey before proceeding'
    });
  }

  // Mark request as verified
  (req as any).passkeyVerified = true;
  next();
};

/**
 * @swagger
 * /api/transfer/validate-username/{username}:
 *   get:
 *     summary: Validate if username exists in the system
 *     tags: [Transfer - Validation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         example: "johndoe"
 *     responses:
 *       200:
 *         description: Username exists and is valid
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               exists: true
 *               data:
 *                 username: "johndoe"
 *                 name: "John Doe"
 *       404:
 *         description: Username not found
 */
router.get('/validate-username/:username', protect, validateUsername);

/**
 * @swagger
 * /api/transfer/contacts:
 *   get:
 *     summary: Get all my contacts (users I've transferred to)
 *     description: Retrieve list of all users you've had transfers with, sorted by last interaction
 *     tags: [Contacts]
 *     security:
 *       - bearerAuth: []
 */
router.get('/contacts', protect, getMyContacts);

/**
 * @swagger
 * /api/transfer/contacts/recent:
 *   get:
 *     summary: Get recent contacts (quick send suggestions)
 *     description: Get your most recent contacts for quick access and sending
 *     tags: [Contacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 */
router.get('/contacts/recent', protect, getRecentContacts);

/**
 * @swagger
 * /api/transfer/send/username:
 *   post:
 *     summary: Send USDC to another user by username (REQUIRES PASSKEY VERIFICATION)
 *     description: |
 *       Transfer USDC to another user in the system.
 *       
 *       ⚠️ IMPORTANT: This endpoint requires passkey verification!
 *       
 *       Steps:
 *       1. Call POST /api/auth/passkey/transaction-verify-options to get challenge
 *       2. Complete passkey biometric verification
 *       3. Call POST /api/auth/passkey/transaction-verify to verify signature
 *       4. Include header: X-Passkey-Verified: true
 *       5. Call this endpoint to send the transfer
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Passkey-Verified
 *         required: true
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Must be set to 'true' after passkey verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - amount
 *             properties:
 *               username:
 *                 type: string
 *                 example: "johndoe"
 *               amount:
 *                 type: number
 *                 example: 10.50
 *               message:
 *                 type: string
 *                 example: "Coffee money! ☕"
 *     responses:
 *       200:
 *         description: Transfer successful (was passkey verified)
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Successfully sent 10.50 USDC to @johndoe"
 *               data:
 *                 transferId: "507f1f77bcf86cd799439011"
 *                 from: "alice"
 *                 to: "johndoe"
 *                 amount: 10.50
 *                 transactionHash: "0x123abc..."
 *                 verifiedWithPasskey: true
 *       401:
 *         description: Passkey verification required
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: "Transaction verification required"
 *               code: "PASSKEY_VERIFICATION_REQUIRED"
 *               requiresPasskeyVerification: true
 */
router.post('/send/username', protect, requirePasskeyVerification, sendToUsername);

/**
 * @swagger
 * /api/transfer/send/external:
 *   post:
 *     summary: Withdraw USDC to external wallet (REQUIRES PASSKEY VERIFICATION)
 *     description: |
 *       Send USDC to an external wallet address.
 *       
 *       ⚠️ IMPORTANT: This endpoint requires passkey verification!
 *       
 *       Steps:
 *       1. Call POST /api/auth/passkey/transaction-verify-options to get challenge
 *       2. Complete passkey biometric verification
 *       3. Call POST /api/auth/passkey/transaction-verify to verify signature
 *       4. Include header: X-Passkey-Verified: true
 *       5. Call this endpoint to send the transfer
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Passkey-Verified
 *         required: true
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Must be set to 'true' after passkey verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *               - amount
 *             properties:
 *               address:
 *                 type: string
 *                 pattern: "^0x[a-fA-F0-9]{40}$"
 *                 example: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
 *               amount:
 *                 type: number
 *                 example: 25.00
 *               message:
 *                 type: string
 *                 example: "Withdrawal"
 *     responses:
 *       200:
 *         description: Transfer successful (was passkey verified)
 *       401:
 *         description: Passkey verification required
 */
router.post('/send/external', protect, requirePasskeyVerification, sendToExternal);

/**
 * @swagger
 * /api/transfer/create-link:
 *   post:
 *     summary: Create a payment link with embedded invite code
 *     tags: [Payment Links]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 15.00
 *               message:
 *                 type: string
 *                 maxLength: 200
 *                 example: "Happy Birthday! 🎉"
 */
router.post('/create-link', protect, createPaymentLink);

/**
 * @swagger
 * /api/transfer/link/{linkCode}:
 *   get:
 *     summary: Get payment link details (PUBLIC)
 *     tags: [Payment Links]
 *     parameters:
 *       - in: path
 *         name: linkCode
 *         required: true
 *         schema:
 *           type: string
 *         example: "ABOKI_1734352800000_A1B2C3D4"
 */
router.get('/link/:linkCode', getPaymentLinkDetails);

/**
 * @swagger
 * /api/transfer/claim/{linkCode}:
 *   post:
 *     summary: Claim payment from link
 *     tags: [Payment Links]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: linkCode
 *         required: true
 *         schema:
 *           type: string
 */
router.post('/claim/:linkCode', protect, claimPaymentLink);

/**
 * @swagger
 * /api/transfer/link/{linkCode}:
 *   delete:
 *     summary: Cancel a pending payment link
 *     tags: [Payment Links]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/link/:linkCode', protect, cancelPaymentLink);

/**
 * @swagger
 * /api/transfer/history:
 *   get:
 *     summary: Get my transfer history
 *     description: Get all your transfer activity (sent, received, and payment links)
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 */
router.get('/history', protect, getTransferHistory);

export default router;
export { requirePasskeyVerification };