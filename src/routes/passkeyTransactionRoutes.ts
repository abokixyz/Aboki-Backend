// ============= src/routes/passkeyTransactionRoutes.ts =============
/**
 * Passkey Transaction Verification Routes
 * Handles WebAuthn passkey verification for transaction signing
 * 
 * Flow:
 * 1. POST /api/auth/passkey/transaction-verify-options -> Get challenge
 * 2. User completes biometric auth on device
 * 3. POST /api/auth/passkey/transaction-verify -> Verify signature & get token
 * 4. Include X-Passkey-Verified-Token header on transfer requests
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import crypto from 'crypto';
import { protect } from '../middleware/auth';
import User from '../models/User';
import PasskeyTransaction from '../models/PasskeyTransaction';
import jwt from 'jsonwebtoken';

const router = Router();

// ============= HELPER FUNCTIONS =============

/**
 * Extract RPID from request origin
 * This ensures the RPID always matches the origin making the request
 */
function extractRpIdFromOrigin(origin: string | undefined): string {
  if (!origin) {
    return process.env.RPID_DOMAIN || 'localhost';
  }

  try {
    const url = new URL(origin);
    // Return just the hostname (domain without protocol or port)
    return url.hostname;
  } catch {
    return process.env.RPID_DOMAIN || 'localhost';
  }
}

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
const generateChallenge = (): Buffer => {
  return crypto.randomBytes(32);
};

// ============= ROUTES =============

/**
 * Root endpoint
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Passkey Transaction Verification API',
    version: '2.0.0',
    flow: {
      step1: 'POST /transaction-verify-options - Get challenge',
      step2: 'User completes biometric auth',
      step3: 'POST /transaction-verify - Verify assertion',
      step4: 'Include X-Passkey-Verified-Token in transaction requests'
    }
  });
});

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
 *               - transactionType
 *               - amount
 *               - recipient
 *             properties:
 *               transactionType:
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
 *                     options:
 *                       type: object
 *                       description: WebAuthn assertion options
 *                     transactionId:
 *                       type: string
 *                     rpId:
 *                       type: string
 *                     origin:
 *                       type: string
 *       400:
 *         description: Invalid transaction data
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/transaction-verify-options',
  protect,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id;
      const { transactionType, amount, recipient, message } = req.body;

      console.log('🔐 Passkey Transaction - Getting Verification Options', {
        userId,
        transactionType,
        amount,
        recipient,
        origin: req.headers.origin,
        userAgent: req.headers['user-agent']?.substring(0, 50)
      });

      // ============= VALIDATE INPUT =============
      if (!transactionType || !['send', 'withdraw'].includes(transactionType)) {
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

      // ============= GET USER & PASSKEY =============
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      if (!user.passkey || !user.passkey.credentialID) {
        return res.status(400).json({
          success: false,
          error: 'No passkey registered for this user'
        });
      }

      // ============= EXTRACT RPID FROM REQUEST ORIGIN =============
      const rpId = extractRpIdFromOrigin(req.headers.origin);
      const origin = req.headers.origin || `https://${rpId}`;

      console.log('🔐 RPID Configuration:', {
        requestOrigin: req.headers.origin,
        extractedRpId: rpId,
        calculatedOrigin: origin,
        expectedRpId: process.env.RPID_DOMAIN
      });

      // ============= GENERATE CHALLENGE =============
      const challenge = generateChallenge();

      // ============= GENERATE AUTHENTICATION OPTIONS =============
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: [{
          id: user.passkey.credentialID.toString()
        }],
        userVerification: 'preferred',
        timeout: 60000,
        challenge: bufferToBase64Url(challenge)
      });

      // ============= SAVE TRANSACTION & CHALLENGE =============
      const transactionId = `txn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const transaction = new PasskeyTransaction({
        transactionId,
        userId,
        type: transactionType,
        amount,
        recipient,
        challenge: bufferToBase64Url(challenge),
        status: 'pending',
        rpId: rpId,
        origin: origin,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      });

      await transaction.save();

      console.log('✅ Authentication options generated:', {
        transactionId,
        rpId,
        challengeLength: challenge.length,
        expiresAt: transaction.expiresAt
      });

      // ============= RESPONSE =============
      res.json({
        success: true,
        data: {
          options,
          transactionId,
          rpId,
          origin
        }
      });

    } catch (error: any) {
      console.error('❌ Error getting verification options:', error.message);
      console.error('Stack:', error.stack);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate verification options'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/passkey/transaction-verify:
 *   post:
 *     summary: Verify transaction with passkey signature
 *     description: |
 *       Step 2 of transaction passkey verification.
 *       Verifies the passkey signature and returns a verification token.
 *       
 *       This token should be included in the X-Passkey-Verified-Token header
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
 *               - transactionId
 *               - authenticationResponse
 *             properties:
 *               transactionId:
 *                 type: string
 *                 description: From transaction-verify-options response
 *               authenticationResponse:
 *                 type: object
 *                 description: Response from authenticator
 *                 properties:
 *                   id:
 *                     type: string
 *                   rawId:
 *                     type: string
 *                   response:
 *                     type: object
 *                   type:
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
 *                     verificationToken:
 *                       type: string
 *                       description: JWT token for transaction
 *       400:
 *         description: Invalid signature or verification failed
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/transaction-verify',
  protect,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id;
      const { transactionId, authenticationResponse } = req.body;

      console.log('🔐 Passkey Transaction - Verifying Authentication', {
        userId,
        transactionId,
        origin: req.headers.origin
      });

      // ============= VALIDATE INPUT =============
      if (!transactionId || !authenticationResponse) {
        return res.status(400).json({
          success: false,
          error: 'Missing transactionId or authenticationResponse'
        });
      }

      // ============= FIND TRANSACTION =============
      const transaction = await PasskeyTransaction.findOne({
        transactionId,
        userId,
        status: 'pending'
      });

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found or already verified'
        });
      }

      // ============= CHECK EXPIRATION =============
      if (transaction.expiresAt < new Date()) {
        await PasskeyTransaction.updateOne(
          { _id: transaction._id },
          { status: 'expired' }
        );
        return res.status(400).json({
          success: false,
          error: 'Transaction verification expired. Please try again.'
        });
      }

      // ============= GET USER & PASSKEY =============
      const user = await User.findById(userId);
      if (!user || !user.passkey || !user.passkey.credentialID) {
        return res.status(400).json({
          success: false,
          error: 'User passkey not found'
        });
      }

      // ============= EXTRACT RPID FROM TRANSACTION =============
      // Use the stored RPID to ensure consistency
      const rpId = transaction.rpId || extractRpIdFromOrigin(req.headers.origin);
      const origin = transaction.origin || (req.headers.origin || `https://${rpId}`);

      console.log('🔐 Verification RPID:', {
        storedRpId: transaction.rpId,
        storedOrigin: transaction.origin,
        calculatedRpId: rpId,
        requestOrigin: req.headers.origin
      });

      // ============= VERIFY AUTHENTICATION =============
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: authenticationResponse,
          expectedChallenge: transaction.challenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          credential: {
            id: user.passkey.credentialID.toString(),
            publicKey: new Uint8Array(user.passkey.credentialPublicKey),
            counter: user.passkey.counter || 0
          },
          requireUserVerification: true
        });
      } catch (verificationError: any) {
        console.error('❌ Authentication verification failed:', verificationError.message);

        const errorMessage = verificationError.message || 'Authentication verification failed';

        // Check for specific RPID errors
        if (errorMessage.includes('RPID')) {
          console.error('🔴 RPID MISMATCH ERROR:', {
            expectedRpId: rpId,
            storedRpId: transaction.rpId,
            storedOrigin: transaction.origin,
            requestOrigin: req.headers.origin
          });
        }

        return res.status(400).json({
          success: false,
          error: errorMessage,
          details: {
            expectedRpId: rpId,
            expectedOrigin: origin
          }
        });
      }

      // ============= VERIFY WAS SUCCESSFUL =============
      if (!verification.verified) {
        return res.status(400).json({
          success: false,
          error: 'Authentication verification failed'
        });
      }

      console.log('✅ Authentication verified successfully');

      // ============= UPDATE CREDENTIAL COUNTER =============
      user.passkey.counter = verification.authenticationInfo.newCounter;
      await user.save();

      console.log('✅ Credential counter updated');

      // ============= MARK TRANSACTION AS VERIFIED =============
      await PasskeyTransaction.updateOne(
        { _id: transaction._id },
        {
          status: 'verified',
          verifiedAt: new Date(),
          credentialId: user.passkey.credentialID
        }
      );

      // ============= GENERATE VERIFICATION TOKEN =============
      const verificationToken = jwt.sign(
        {
          transactionId,
          userId,
          verified: true,
          type: 'passkey_transaction_verification',
          transaction: {
            type: transaction.type,
            amount: transaction.amount,
            recipient: transaction.recipient
          }
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '5m' } // Short expiration
      );

      console.log('✅ Verification token generated:', {
        transactionId,
        userId,
        type: transaction.type,
        amount: transaction.amount
      });

      // ============= RESPONSE =============
      res.json({
        success: true,
        data: {
          verified: true,
          transactionId,
          verificationToken,
          transaction: {
            id: transaction._id,
            type: transaction.type,
            amount: transaction.amount,
            recipient: transaction.recipient
          }
        }
      });

    } catch (error: any) {
      console.error('❌ Error verifying transaction:', error.message);
      console.error('Stack:', error.stack);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify transaction'
      });
    }
  }
);

/**
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  const rpId = extractRpIdFromOrigin(req.headers.origin);

  res.json({
    success: true,
    status: 'Passkey service healthy',
    origin: req.headers.origin,
    rpId: rpId,
    passkeySupport: true,
    timestamp: new Date().toISOString()
  });
});

export default router;