// ============= src/routes/transferRoutes.ts (UPDATED) =============
import { Router } from 'express';
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
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               exists: false
 *               error: "User @johndoe not found"
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
 *     responses:
 *       200:
 *         description: Contacts retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               count: 3
 *               data:
 *                 - id: "507f1f77bcf86cd799439011"
 *                   username: "alice"
 *                   name: "Alice Johnson"
 *                   address: "0x742d35Cc..."
 *                   interactionCount: 5
 *                   transferCount: 5
 *                   totalAmountTransferred: 125.50
 *                   lastInteractedAt: "2024-12-15T10:30:00Z"
 *                 - id: "507f1f77bcf86cd799439012"
 *                   username: "bob"
 *                   name: "Bob Smith"
 *                   address: "0x1234567..."
 *                   interactionCount: 2
 *                   transferCount: 2
 *                   totalAmountTransferred: 50.00
 *                   lastInteractedAt: "2024-12-10T15:45:00Z"
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
 *         description: Number of recent contacts to return
 *     responses:
 *       200:
 *         description: Recent contacts retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               count: 3
 *               data:
 *                 - username: "alice"
 *                   name: "Alice Johnson"
 *                   lastInteractedAt: "2024-12-15T10:30:00Z"
 *                 - username: "bob"
 *                   name: "Bob Smith"
 *                   lastInteractedAt: "2024-12-10T15:45:00Z"
 */
router.get('/contacts/recent', protect, getRecentContacts);

/**
 * @swagger
 * /api/transfer/send/username:
 *   post:
 *     summary: Send USDC to another user by username
 *     description: Transfer USDC to another user in the system (validates username exists)
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
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
 *         description: Transfer successful
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
 *       400:
 *         description: Invalid input or insufficient balance
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               exists: false
 *               error: "User @johndoe not found in our system"
 *       500:
 *         description: Transfer failed
 */
router.post('/send/username', protect, sendToUsername);

/**
 * @swagger
 * /api/transfer/send/external:
 *   post:
 *     summary: Withdraw USDC to external wallet address
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
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
 *                 example: "Withdrawal to Coinbase"
 *     responses:
 *       200:
 *         description: Transfer successful
 *       400:
 *         description: Invalid address or insufficient balance
 *       500:
 *         description: Transfer failed
 */
router.post('/send/external', protect, sendToExternal);

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
 *     responses:
 *       201:
 *         description: Payment link created successfully
 *       400:
 *         description: Insufficient balance
 *       404:
 *         description: Wallet not found
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
 *     responses:
 *       200:
 *         description: Link details retrieved successfully
 *       404:
 *         description: Payment link not found
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
 *         example: "ABOKI_1734352800000_A1B2C3D4"
 *     responses:
 *       200:
 *         description: Payment claimed successfully
 *       400:
 *         description: Link already claimed, expired, or invalid
 *       404:
 *         description: Link not found or wallet required
 *       500:
 *         description: Failed to claim payment
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
 *     parameters:
 *       - in: path
 *         name: linkCode
 *         required: true
 *         schema:
 *           type: string
 *         example: "ABOKI_1734352800000_A1B2C3D4"
 *     responses:
 *       200:
 *         description: Link cancelled successfully
 *       400:
 *         description: Cannot cancel (already claimed/completed)
 *       404:
 *         description: Link not found or not yours
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
 *     responses:
 *       200:
 *         description: Transfer history retrieved successfully
 *       500:
 *         description: Server error
 */
router.get('/history', protect, getTransferHistory);

export default router;