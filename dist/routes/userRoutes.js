"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============= src/routes/userRoutes.ts =============
const express_1 = require("express");
const userController_1 = require("../controllers/userController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All routes are protected and use JWT token
/**
 * @swagger
 * /api/users/me:
 *   get:
 *     summary: Get my profile
 *     description: Get your user profile information
 *     tags: [My Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 _id: "507f1f77bcf86cd799439011"
 *                 name: "John Doe"
 *                 username: "johndoe"
 *                 email: "john@example.com"
 *                 wallet:
 *                   ownerAddress: "0x742d35Cc..."
 *                   smartAccountAddress: "0x1234567..."
 *                   network: "base-mainnet"
 *                 createdAt: "2024-12-10T10:30:00Z"
 */
router.get('/me', auth_1.protect, userController_1.getMe);
/**
 * @swagger
 * /api/users/me:
 *   put:
 *     summary: Update my profile
 *     description: Update your profile information (name, username, email)
 *     tags: [My Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Smith"
 *               username:
 *                 type: string
 *                 example: "johnsmith"
 *               email:
 *                 type: string
 *                 example: "john.smith@example.com"
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.put('/me', auth_1.protect, userController_1.updateMe);
/**
 * @swagger
 * /api/users/me/wallet:
 *   get:
 *     summary: Get my wallet
 *     description: Get your wallet address and details
 *     tags: [My Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 ownerAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 *                 smartAccountAddress: "0x1234567890abcdef1234567890abcdef12345678"
 *                 network: "base-mainnet"
 */
router.get('/me/wallet', auth_1.protect, userController_1.getMyWallet);
/**
 * @swagger
 * /api/users/me/wallet/balance:
 *   get:
 *     summary: Get my wallet balance
 *     description: Get your ETH and USDC balance
 *     tags: [My Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Balance retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 ethBalance: "0.245678"
 *                 usdcBalance: "100.50"
 *                 balances:
 *                   ETH:
 *                     balance: "0.245678"
 *                     balanceInWei: "245678000000000000"
 *                   USDC:
 *                     balance: "100.50"
 *                     balanceInWei: "100500000"
 */
router.get('/me/wallet/balance', auth_1.protect, userController_1.getMyBalance);
exports.default = router;
