// ============= src/routes/authRoutes.ts (PURE PASSKEY VERSION) =============
import { Router } from 'express';
import {
  signup,
  login,
  getMe,
  logout
} from '../controllers/authController';
import { protect } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Register with PASSKEY (Passwordless)
 *     description: |
 *       Create a new account with passkey authentication (Face ID, Touch ID, Windows Hello).
 *       This is a 100% passwordless signup flow using WebAuthn/FIDO2 standard.
 *       
 *       Process:
 *       1. Validate invite code
 *       2. Verify passkey credential
 *       3. Create user account with passkey
 *       4. Generate Base blockchain wallet
 *       5. Auto-generate personal invite code
 *       6. Return JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - username
 *               - email
 *               - passkey
 *               - inviteCode
 *             properties:
 *               name:
 *                 type: string
 *                 description: Full name
 *                 example: Jane Smith
 *               username:
 *                 type: string
 *                 description: Unique username (3-30 characters, lowercase alphanumeric and underscores)
 *                 minLength: 3
 *                 maxLength: 30
 *                 example: janesmith
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address (must be unique)
 *                 example: jane.smith@example.com
 *               passkey:
 *                 type: object
 *                 description: WebAuthn passkey credential
 *                 properties:
 *                   id:
 *                     type: string
 *                   rawId:
 *                     type: string
 *                     format: base64
 *                   type:
 *                     type: string
 *                     example: public-key
 *                   response:
 *                     type: object
 *                     properties:
 *                       clientDataJSON:
 *                         type: string
 *                         format: base64
 *                       attestationObject:
 *                         type: string
 *                         format: base64
 *                   challenge:
 *                     type: string
 *                     format: base64
 *               inviteCode:
 *                 type: string
 *                 description: Valid invite code (reusable)
 *                 example: BOSSINVITEYOU
 *     responses:
 *       201:
 *         description: User registered successfully with passkey
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
 *                   example: Account created successfully with passkey authentication on Base!
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       description: User profile (without passkey data)
 *                     token:
 *                       type: string
 *                       description: JWT authentication token
 *                     inviteCode:
 *                       type: string
 *                       description: Personal invite code (auto-generated)
 *                       example: JANESMITHINVITEYOU
 *                     authMethod:
 *                       type: string
 *                       example: passkey
 *       400:
 *         description: Bad request (validation error, passkey verification failed)
 *       500:
 *         description: Server error
 */
router.post('/signup', signup);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with PASSKEY (Passwordless)
 *     description: |
 *       Authenticate user with passkey (Face ID, Touch ID, Windows Hello).
 *       100% passwordless login using WebAuthn/FIDO2 standard.
 *       
 *       Process:
 *       1. Verify passkey assertion
 *       2. Update counter (replay attack prevention)
 *       3. Issue JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - passkey
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *                 example: jane.smith@example.com
 *               passkey:
 *                 type: object
 *                 description: WebAuthn passkey assertion
 *                 properties:
 *                   id:
 *                     type: string
 *                   rawId:
 *                     type: string
 *                     format: base64
 *                   type:
 *                     type: string
 *                     example: public-key
 *                   response:
 *                     type: object
 *                     properties:
 *                       clientDataJSON:
 *                         type: string
 *                         format: base64
 *                       authenticatorData:
 *                         type: string
 *                         format: base64
 *                       signature:
 *                         type: string
 *                         format: base64
 *                   challenge:
 *                     type: string
 *                     format: base64
 *     responses:
 *       200:
 *         description: Login successful
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
 *                   example: Login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       description: User profile with wallet and invite codes
 *                     token:
 *                       type: string
 *                       description: JWT authentication token
 *                     authMethod:
 *                       type: string
 *                       example: passkey
 *       401:
 *         description: Invalid credentials or passkey verification failed
 *       500:
 *         description: Server error
 */
router.post('/login', login);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     description: |
 *       Get the profile of the currently authenticated user.
 *       Includes wallet info, created invite codes, and who invited you.
 *       Requires a valid JWT token in the Authorization header.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
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
 *                     _id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     username:
 *                       type: string
 *                     email:
 *                       type: string
 *                     authMethod:
 *                       type: string
 *                       example: passkey
 *                     wallet:
 *                       type: object
 *                     invitedBy:
 *                       type: object
 *                       description: User who invited you
 *                     createdInviteCodes:
 *                       type: array
 *                       description: Invite codes you created
 *       401:
 *         description: Not authorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.get('/me', protect, getMe);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     description: |
 *       Logout the current user.
 *       Note: Since we're using JWT, you should remove the token on the client side.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
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
 *                   example: Logged out successfully. Please remove the token from client.
 */
router.post('/logout', protect, logout);

export default router;