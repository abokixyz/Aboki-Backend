"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============= src/routes/walletRoutes.ts =============
const express_1 = require("express");
const walletController_1 = require("../controllers/walletController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All routes require authentication and use JWT token to identify user
/**
 * @swagger
 * /api/wallet:
 *   get:
 *     summary: Get my wallet details
 *     description: Get your wallet address, balance, and network information
 *     tags: [My Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet details retrieved
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
 *                     ownerAddress:
 *                       type: string
 *                       example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 *                     smartAccountAddress:
 *                       type: string
 *                       example: "0x1234567890abcdef1234567890abcdef12345678"
 *                     network:
 *                       type: string
 *                       example: "base-mainnet"
 *                     balance:
 *                       type: string
 *                       example: "0.245678"
 *                     usdcBalance:
 *                       type: string
 *                       example: "100.50"
 *                     isReal:
 *                       type: boolean
 *                       example: true
 */
router.get('/', auth_1.protect, walletController_1.getMyWallet);
/**
 * @swagger
 * /api/wallet/balance:
 *   get:
 *     summary: Get my wallet balance
 *     description: Get your ETH and USDC balance on Base
 *     tags: [My Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Balance retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 ownerAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 *                 smartAccountAddress: "0x1234567890abcdef1234567890abcdef12345678"
 *                 network: "base-mainnet"
 *                 ethBalance: "0.245678"
 *                 usdcBalance: "100.50"
 *                 balances:
 *                   ETH:
 *                     balance: "0.245678"
 *                     balanceInWei: "245678000000000000"
 *                   USDC:
 *                     balance: "100.50"
 *                     balanceInWei: "100500000"
 *                 isReal: true
 */
router.get('/balance', auth_1.protect, walletController_1.getMyBalance);
/**
 * @swagger
 * /api/wallet/send:
 *   post:
 *     summary: Send USDC or ETH
 *     description: |
 *       Send USDC or ETH from your wallet to another address.
 *       Transaction is signed server-side - no private key exposure.
 *
 *       USDC Contract Address (Base Mainnet): 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *     tags: [My Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - toAddress
 *               - amount
 *             properties:
 *               toAddress:
 *                 type: string
 *                 description: Recipient wallet address
 *                 example: "0x1234567890abcdef1234567890abcdef12345678"
 *               amount:
 *                 type: string
 *                 description: Amount to send
 *                 example: "10.50"
 *               token:
 *                 type: string
 *                 description: Token to send (ETH or USDC)
 *                 enum: [ETH, USDC]
 *                 default: USDC
 *                 example: "USDC"
 *               network:
 *                 type: string
 *                 description: Network to use (optional)
 *                 enum: [base-mainnet, base-sepolia]
 *                 example: "base-mainnet"
 *     responses:
 *       200:
 *         description: Transaction sent successfully
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
 *                   example: "USDC sent successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionHash:
 *                       type: string
 *                       example: "0xabc123..."
 *                     amount:
 *                       type: string
 *                       example: "10.50"
 *                     token:
 *                       type: string
 *                       example: "USDC"
 *                     to:
 *                       type: string
 *                       example: "0x1234..."
 *                     from:
 *                       type: string
 *                       example: "0x5678..."
 *                     status:
 *                       type: string
 *                       example: "complete"
 *                     explorerUrl:
 *                       type: string
 *                       example: "https://basescan.org/tx/0xabc123..."
 *       400:
 *         description: Invalid request
 */
router.post('/send', auth_1.protect, walletController_1.sendTransaction);
/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get my transaction history
 *     description: |
 *       Get all your wallet transactions.
 *       Shows both ETH and USDC transfers.
 *     tags: [My Wallet]
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
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       transactionHash:
 *                         type: string
 *                         example: "0xabc123..."
 *                       token:
 *                         type: string
 *                         example: "USDC"
 *                       amount:
 *                         type: string
 *                         example: "10.50"
 *                       status:
 *                         type: string
 *                         example: "complete"
 *                       from:
 *                         type: string
 *                         example: "0x123..."
 *                       to:
 *                         type: string
 *                         example: "0x456..."
 *                       timestamp:
 *                         type: string
 *                         example: "2024-12-10T10:30:00Z"
 *                 message:
 *                   type: string
 *                   example: "Use block explorer for full history"
 */
router.get('/transactions', auth_1.protect, walletController_1.getMyTransactions);
exports.default = router;
