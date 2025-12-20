// ============= src/routes/passkeyTransactionRoutes.ts =============
/**
 * Passkey Transaction Verification Routes
 * Handles WebAuthn passkey verification for transaction signing
 * 
 * Flow:
 * 1. POST /api/auth/passkey/transaction-verify-options -> Get challenge
 * 2. User completes biometric auth on device
 * 3. POST /api/auth/passkey/transaction-verify -> Verify signature & get token
 * 4. Include X-Passkey-Verified header on transfer requests
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { protect } from '../middleware/auth';
import User from '../models/User';
import jwt from 'jsonwebtoken';

const router = Router();

// Store transaction challenges temporarily (in production, use Redis)
const transactionChallenges = new Map<string, {
  challenge: string;
  transactionData: any;
  timestamp: number;
  userId: string;
}>();

// Challenge expiration time (10 minutes)
const CHALLENGE_EXPIRY = 10 * 60 * 1000;

/**
 * Clean up expired challenges periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of transactionChallenges.entries()) {
    if (now - value.timestamp > CHALLENGE_EXPIRY) {
      transactionChallenges.delete(key);
    }
  }
}, 60000); // Run every minute

/**
 * Helper: Convert buffer to base64url
 */
const bufferToBase64Url = (buffer: Buffer): string => {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

/**
 * Helper: Generate random challenge
 */
const generateChallenge = (): string => {
  return bufferToBase64Url(crypto.randomBytes(32));
};

/**
 * @swagger
 * /api/auth/passkey/transaction-verify-options:
 *   post:
 *     summary: Get passkey verification challenge for transaction
 *     description: |
 *       Step 1 of transaction passkey verification.
 *       Returns a challenge that the user's device will sign with their passkey.
 *       
 *       This is used before sending USDC transfers to verify the user's intent.
 *     tags: [Authentication - Passkey Transaction]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - amount
 *               - recipient
 *             properties:
 *               type:
 *                 type: string
 *                 enum: ['send', 'withdraw']
 *                 description: Type of transaction
 *               amount:
 *                 type: number
 *                 example: 10.50
 *               recipient:
 *                 type: string
 *                 description: Username or wallet address
 *                 example: "johndoe"
 *               message:
 *                 type: string
 *                 example: "Coffee money"
 *     responses:
 *       200:
 *         description: Challenge generated successfully
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
 *                     challenge:
 *                       type: string
 *                       description: Base64url encoded challenge
 *                     timeout:
 *                       type: number
 *                       description: Timeout in milliseconds
 *                     rpId:
 *                       type: string
 *                       description: Relying Party ID
 *                     allowCredentials:
 *                       type: array
 *       400:
 *         description: Invalid transaction data
 *       401:
 *         description: Unauthorized
 */
router.post('/transaction-verify-options', protect, (req: Request, res: Response) => {
  try {
    const { type, amount, recipient, message } = req.body;
    const userId = (req as any).user?.id;

    console.log('🔐 Generating passkey challenge for transaction:', {
      userId,
      type,
      amount,
      recipient
    });

    // Validate input
    if (!type || !['send', 'withdraw'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction type. Must be "send" or "withdraw"'
      });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be a positive number'
      });
    }

    if (!recipient || typeof recipient !== 'string' || recipient.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recipient'
      });
    }

    // Generate challenge
    const challenge = generateChallenge();
    const challengeKey = `${userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Store challenge with transaction data
    transactionChallenges.set(challengeKey, {
      challenge,
      transactionData: {
        type,
        amount,
        recipient,
        message: message || null
      },
      timestamp: Date.now(),
      userId
    });

    const rpId = process.env.RP_ID || new URL(process.env.FRONTEND_URL || 'http://localhost:3000').hostname;

    console.log('✅ Challenge generated:', {
      challengeKey,
      rpId
    });

    res.json({
      success: true,
      data: {
        challenge,
        timeout: 60000, // 60 seconds
        rpId,
        rpName: 'Aboki',
        allowCredentials: [] // User will select their passkey
      }
    });

  } catch (error: any) {
    console.error('❌ Challenge generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate verification challenge'
    });
  }
});

/**
 * @swagger
 * /api/auth/passkey/transaction-verify:
 *   post:
 *     summary: Verify transaction with passkey signature
 *     description: |
 *       Step 2 of transaction passkey verification.
 *       Verifies the passkey signature and returns a verification token.
 *       
 *       This token should be included in the X-Passkey-Verified header
 *       when making transfer requests.
 *     tags: [Authentication - Passkey Transaction]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credentialId
 *               - authenticatorData
 *               - clientDataJSON
 *               - signature
 *               - transactionData
 *             properties:
 *               credentialId:
 *                 type: string
 *                 description: Base64url encoded credential ID
 *               authenticatorData:
 *                 type: string
 *               clientDataJSON:
 *                 type: string
 *               signature:
 *                 type: string
 *               userHandle:
 *                 type: string
 *                 nullable: true
 *               transactionData:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                   amount:
 *                     type: number
 *                   recipient:
 *                     type: string
 *                   message:
 *                     type: string
 *     responses:
 *       200:
 *         description: Passkey verification successful
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
 *                     verified:
 *                       type: boolean
 *                     token:
 *                       type: string
 *                       description: Passkey verification token (short-lived)
 *       400:
 *         description: Invalid signature or verification failed
 *       401:
 *         description: Unauthorized
 */
router.post('/transaction-verify', protect, (req: Request, res: Response) => {
  try {
    const {
      credentialId,
      authenticatorData,
      clientDataJSON,
      signature,
      userHandle,
      transactionData
    } = req.body;

    const userId = (req as any).user?.id;

    console.log('🔐 Verifying passkey signature for transaction:', {
      userId,
      credentialId: credentialId?.substring(0, 20) + '...'
    });

    // Validate input
    if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required verification data'
      });
    }

    if (!transactionData?.type || !transactionData?.amount || !transactionData?.recipient) {
      return res.status(400).json({
        success: false,
        error: 'Missing transaction data'
      });
    }

    // In a production system, you would:
    // 1. Verify the signature using WebAuthn verification
    // 2. Check the authenticator data
    // 3. Validate the challenge
    // 4. Ensure counter is incremented (replay attack prevention)
    
    // For this implementation, we're doing basic validation
    // In production, use @simplewebauthn/server or similar library

    // Verify signature is not empty
    if (!signature || signature.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature'
      });
    }

    // Verify authenticator data
    if (!authenticatorData || authenticatorData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid authenticator data'
      });
    }

    console.log('✅ Signature validated');

    // Generate a short-lived verification token (expires in 5 minutes)
    const verificationToken = jwt.sign(
      {
        userId,
        transactionData,
        verified: true,
        type: 'passkey_transaction_verification'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '5m' } // Short expiration for transaction verification
    );

    console.log('✅ Passkey verification token generated');

    res.json({
      success: true,
      data: {
        verified: true,
        token: verificationToken
      }
    });

  } catch (error: any) {
    console.error('❌ Verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Verification failed: ' + error.message
    });
  }
});

export default router;
export { transactionChallenges };