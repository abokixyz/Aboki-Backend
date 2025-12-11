// ============= src/routes/inviteRoutes.ts =============
import { Router } from 'express';
import {
  getAllInviteCodes,
  getMyInviteCode,
  getMyReferrals,
  getInviteCodeByCode,
  createDefaultInviteCode,
  validateInviteCode,
  getAvailableInviteCodes
} from '../controllers/inviteController';
import { protect } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/invites/my-code:
 *   get:
 *     summary: Get my personal invite code
 *     description: Get your personal invite code in format {username}inviteyou
 *     tags: [My Invites]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your invite code
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 code: "JOHNDOEINVITEYOU"
 *                 isUsed: false
 *                 createdAt: "2024-12-10T10:30:00Z"
 */
router.get('/my-code', protect, getMyInviteCode);

/**
 * @swagger
 * /api/invites/my-referrals:
 *   get:
 *     summary: Get my referrals
 *     description: Get all users who signed up using your invite code
 *     tags: [My Invites]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your referrals list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 myInviteCode: "JOHNDOEINVITEYOU"
 *                 totalReferrals: 5
 *                 referrals:
 *                   - name: "Jane Smith"
 *                     username: "janesmith"
 *                     email: "jane@example.com"
 *                     joinedAt: "2024-12-10T10:30:00Z"
 *                     hasWallet: true
 */
router.get('/my-referrals', protect, getMyReferrals);

/**
 * @swagger
 * /api/invites:
 *   get:
 *     summary: Get all invite codes
 *     description: Retrieve all invite codes (admin use)
 *     tags: [Invite Codes]
 *     responses:
 *       200:
 *         description: List of all invite codes
 */
router.get('/', getAllInviteCodes);

/**
 * @swagger
 * /api/invites/available:
 *   get:
 *     summary: Get available invite codes
 *     description: Retrieve all unused, non-expired invite codes
 *     tags: [Invite Codes]
 *     responses:
 *       200:
 *         description: List of available invite codes
 */
router.get('/available', getAvailableInviteCodes);

/**
 * @swagger
 * /api/invites/default:
 *   post:
 *     summary: Create default project invite code
 *     description: |
 *       Creates the default project invite code "PROJECTINVITE".
 *       This is the master invite code for initial project signups.
 *       Users who sign up with this code won't have a referrer.
 *     tags: [Invite Codes]
 *     responses:
 *       201:
 *         description: Default invite code created
 *       200:
 *         description: Default invite code already exists
 */
router.post('/default', createDefaultInviteCode);

/**
 * @swagger
 * /api/invites/{code}:
 *   get:
 *     summary: Get invite code details
 *     description: Get detailed information about a specific invite code
 *     tags: [Invite Codes]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *           example: JOHNDOEINVITEYOU
 *     responses:
 *       200:
 *         description: Invite code found
 *       404:
 *         description: Invite code not found
 */
router.get('/:code', getInviteCodeByCode);

/**
 * @swagger
 * /api/invites/{code}/validate:
 *   post:
 *     summary: Validate an invite code
 *     description: |
 *       Check if an invite code is valid for signup.
 *       Returns who invited you if it's a user code.
 *     tags: [Invite Codes]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *           example: JOHNDOEINVITEYOU
 *     responses:
 *       200:
 *         description: Invite code is valid
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               valid: true
 *               message: "Invite code is valid"
 *               data:
 *                 code: "JOHNDOEINVITEYOU"
 *                 isLifetime: true
 *                 invitedBy: "johndoe"
 *       400:
 *         description: Invite code is invalid or expired
 *       404:
 *         description: Invite code not found
 */
router.post('/:code/validate', validateInviteCode);

export default router;