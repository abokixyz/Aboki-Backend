// ============= src/routes/authRoutes.ts =============
import { Router } from 'express';
import {
  signup,
  login,
  getMe,
  updatePassword,
  logout
} from '../controllers/authController';
import { protect } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Register a new user
 *     description: |
 *       Create a new account with invite code. This will:
 *       - Validate the invite code
 *       - Create a user account with hashed password
 *       - Generate a Base blockchain wallet automatically
 *       - Auto-generate personal invite code: {username}inviteyou
 *       - Mark the invite code as used
 *       - Track who invited you (referral system)
 *       - Return a JWT token for authentication
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
 *               - password
 *               - inviteCode
 *             properties:
 *               name:
 *                 type: string
 *                 description: Full name
 *                 example: John Doe
 *               username:
 *                 type: string
 *                 description: Unique username (3-30 characters, lowercase alphanumeric and underscores)
 *                 minLength: 3
 *                 maxLength: 30
 *                 example: johndoe
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address (must be unique)
 *                 example: john.doe@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Password (minimum 6 characters)
 *                 minLength: 6
 *                 example: SecurePass123!
 *               inviteCode:
 *                 type: string
 *                 description: Valid invite code (PROJECTINVITE or another user's code like JOHNDOEINVITEYOU)
 *                 example: PROJECTINVITE
 *     responses:
 *       201:
 *         description: User registered successfully
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
 *                   example: Account created successfully with real CDP smart wallet on Base!
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                           example: "507f1f77bcf86cd799439011"
 *                         name:
 *                           type: string
 *                           example: "John Doe"
 *                         username:
 *                           type: string
 *                           example: "johndoe"
 *                         email:
 *                           type: string
 *                           example: "john.doe@example.com"
 *                         wallet:
 *                           type: object
 *                           properties:
 *                             ownerAddress:
 *                               type: string
 *                               example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 *                             smartAccountAddress:
 *                               type: string
 *                               example: "0x1234567890abcdef1234567890abcdef12345678"
 *                             network:
 *                               type: string
 *                               example: "base-mainnet"
 *                             isReal:
 *                               type: boolean
 *                               example: true
 *                         invitedBy:
 *                           type: object
 *                           nullable: true
 *                           properties:
 *                             username:
 *                               type: string
 *                               example: "referrer"
 *                     token:
 *                       type: string
 *                       description: JWT authentication token
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     inviteCode:
 *                       type: string
 *                       description: Your personal invite code (auto-generated)
 *                       example: JOHNDOEINVITEYOU
 *       400:
 *         description: Bad request (validation error, user exists, invalid invite code)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: Email already registered
 *       500:
 *         description: Server error
 */
router.post('/signup', signup);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     description: |
 *       Authenticate user with email and password.
 *       Returns a JWT token that should be included in subsequent requests.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *                 example: john.doe@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 description: User password
 *                 example: SecurePass123!
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
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Invalid credentials
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
 *                     wallet:
 *                       type: object
 *                     invitedBy:
 *                       type: object
 *                       description: User who invited you
 *                       properties:
 *                         username:
 *                           type: string
 *                         name:
 *                           type: string
 *                     createdInviteCodes:
 *                       type: array
 *                       description: Invite codes you created
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           isUsed:
 *                             type: boolean
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
 * /api/auth/update-password:
 *   put:
 *     summary: Update user password
 *     description: |
 *       Change the password for the currently authenticated user.
 *       Returns a new JWT token.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *                 description: Current password
 *                 example: OldPass123!
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 description: New password (minimum 6 characters)
 *                 minLength: 6
 *                 example: NewSecurePass456!
 *     responses:
 *       200:
 *         description: Password updated successfully
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
 *                   example: Password updated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: New JWT token
 *       401:
 *         description: Current password is incorrect or not authorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.put('/update-password', protect, updatePassword);

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