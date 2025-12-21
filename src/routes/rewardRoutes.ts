// ============= src/routes/rewardRoutes.ts =============
import { Router, Request, Response } from 'express';
import { protect } from '../middleware/auth';
import rateLimitMiddleware from '../middleware/rateLimiter';
import {
  getMyPoints,
  getMyPointsHistory,
  getReferralBonusInfo,
  getLeaderboard,
  getRewardRules,
  getRewardStats
} from '../controllers/rewardController';

const router = Router();

/**
 * ROOT ENDPOINT
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Aboki Rewards Points System',
    status: 'Active (Tracking Only - Rewards Coming Soon)',
    version: '1.0.0',
    endpoints: {
      myPoints: 'GET /api/rewards/my-points - View your total points',
      myHistory: 'GET /api/rewards/my-history - View your points history',
      referralInfo: 'GET /api/rewards/referral-info - View referral bonus info',
      leaderboard: 'GET /api/rewards/leaderboard - View top earners',
      rules: 'GET /api/rewards/rules - View points rules',
      stats: 'GET /api/rewards/stats - View system statistics'
    },
    pointSystem: {
      invite: '1 friend invited = 1 point',
      trade: '$100 traded = 20 points (0.2 points per $1)',
      referralBonus: '50% of referral trade points',
      accumulation: 'Points accumulate forever - No expiry'
    },
    rewardsStatus: '🔜 Coming Soon - Points are being tracked for future reward redemption'
  });
});

// ============================================
// AUTHENTICATED USER ROUTES (My Rewards)
// ============================================

/**
 * @swagger
 * /api/rewards/my-points:
 *   get:
 *     summary: Get my reward points and breakdown
 *     description: |
 *       View your total accumulated points and breakdown by type.
 *       
 *       Point Categories:
 *       - Invite Points: From inviting friends (1 point per friend)
 *       - Trade Points: From your own trades ($100 = 20 points)
 *       - Referral Bonus: 50% of points from people you invited
 *     tags: [My Rewards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your points information
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 userId: "507f1f77bcf86cd799439011"
 *                 totalPoints: 150
 *                 pointBreakdown:
 *                   invitePoints: 5
 *                   tradePoints: 100
 *                   referralBonusPoints: 45
 *                 details:
 *                   fromInvites:
 *                     points: 5
 *                     description: "1 point per friend invited"
 *                   fromTrades:
 *                     points: 100
 *                     description: "$100 = 20 points, $200 = 40 points (0.2 points per $1)"
 *                   fromReferralBonus:
 *                     points: 45
 *                     description: "50% of points earned by people you invited"
 *                 lastUpdated: "2024-12-16T10:30:00.000Z"
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/my-points', protect, rateLimitMiddleware, getMyPoints);

/**
 * @swagger
 * /api/rewards/my-history:
 *   get:
 *     summary: Get my points earning history
 *     description: |
 *       View your complete points transaction history.
 *       Each entry shows how you earned points and when.
 *     tags: [My Rewards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [invite, trade, referral_bonus]
 *         description: Filter by point type
 *         example: "trade"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Your points history
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - transactionId: "507f1f77bcf86cd799439011"
 *                   pointType: "trade"
 *                   points: 20
 *                   description: "Traded $100 USDC"
 *                   amount: 100
 *                   earnedAt: "2024-12-16T10:30:00.000Z"
 *                 - transactionId: "507f1f77bcf86cd799439012"
 *                   pointType: "referral_bonus"
 *                   points: 10
 *                   description: "Referral bonus: user123 traded $200"
 *                   referrerId: "user123"
 *                   earnedAt: "2024-12-16T09:20:00.000Z"
 *               pagination:
 *                 limit: 50
 *                 skip: 0
 *                 total: 2
 *                 hasMore: false
 *       401:
 *         description: Unauthorized
 */
router.get('/my-history', protect, rateLimitMiddleware, getMyPointsHistory);

/**
 * @swagger
 * /api/rewards/referral-info:
 *   get:
 *     summary: Get referral bonus information
 *     description: |
 *       View your referral information and how much bonus points
 *       you've earned from people you invited.
 *       
 *       How Referral Bonus Works:
 *       1. You invite a friend with your invite code
 *       2. Friend signs up and trades
 *       3. Friend earns points (e.g., 20 pts for $100 trade)
 *       4. You get 50% as referral bonus (10 pts)
 *       5. Both keep their points!
 *     tags: [My Rewards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your referral information
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 youAreInvitedBy:
 *                   username: "johndoe"
 *                   name: "John Doe"
 *                   referralBonusPoints: 500
 *                   totalPoints: 750
 *                 yourReferralBonus:
 *                   totalBonusPoints: 150
 *                   description: "50% of points earned by people you invited"
 *                   howItWorks:
 *                     step1: "You invite a friend with your code"
 *                     step2: "Friend signs up and starts trading"
 *                     step3: "Friend earns points (e.g., 20 points for $100 trade)"
 *                     step4: "You get 50% of their trade points as bonus (10 points)"
 *                     step5: "Points accumulate in your referral bonus pool"
 *       401:
 *         description: Unauthorized
 */
router.get('/referral-info', protect, rateLimitMiddleware, getReferralBonusInfo);

// ============================================
// PUBLIC REWARD ROUTES
// ============================================

/**
 * @swagger
 * /api/rewards/leaderboard:
 *   get:
 *     summary: View reward points leaderboard
 *     description: |
 *       See top earners across different categories.
 *       
 *       Leaderboard Types:
 *       - total: Total points (default)
 *       - invite: Points from inviting
 *       - trade: Points from trading
 *       - referral: Points from referrals
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [total, invite, trade, referral]
 *           default: total
 *         description: Which leaderboard to view
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of top earners to show
 *     responses:
 *       200:
 *         description: Leaderboard data
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 leaderboardType: "Total Points"
 *                 leaderboard:
 *                   - rank: 1
 *                     username: "alice"
 *                     name: "Alice Smith"
 *                     totalPoints: 5000
 *                     invitePoints: 500
 *                     tradePoints: 3500
 *                     referralBonusPoints: 1000
 *                   - rank: 2
 *                     username: "bob"
 *                     name: "Bob Johnson"
 *                     totalPoints: 3500
 *                     invitePoints: 200
 *                     tradePoints: 2800
 *                     referralBonusPoints: 500
 *                 generatedAt: "2024-12-16T10:30:00.000Z"
 */
router.get('/leaderboard', rateLimitMiddleware, getLeaderboard);

/**
 * @swagger
 * /api/rewards/rules:
 *   get:
 *     summary: Get reward system rules and information
 *     description: |
 *       View complete information about how the points system works,
 *       point calculations, and upcoming rewards.
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Reward system rules
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 pointSystem:
 *                   title: "Aboki Rewards Points System"
 *                   status: "Active (Tracking Only - Rewards Coming Soon)"
 *                   description: "Earn points for various activities and track your progress"
 *                   rules:
 *                     - activity: "Invite a Friend"
 *                       pointsEarned: 1
 *                       description: "Get 1 point for each friend you invite"
 *                       maxPoints: "Unlimited"
 *                       example: "Invite 5 friends = 5 points"
 *                     - activity: "Trade/Buy USDC ($100)"
 *                       pointsEarned: 20
 *                       description: "Earn points based on trading amount (0.2 points per $1)"
 *                       maxPoints: "No limit"
 *                       example: "$100 trade = 20 points, $200 trade = 40 points"
 *                     - activity: "Referral Bonus"
 *                       pointsEarned: "50% of referral trades"
 *                       description: "Earn 50% of the points your invitees earn from trading"
 *                       maxPoints: "No limit"
 *                       example: "Referral trades $100 (20 pts) → You get 10 referral bonus points"
 *                   upcomingRewards:
 *                     status: "🔜 Coming Soon"
 *                     description: "Rewards redemption will be available soon"
 *                     message: "Your accumulated points are being tracked and will be convertible to rewards in the future"
 */
router.get('/rules', rateLimitMiddleware, getRewardRules);

/**
 * @swagger
 * /api/rewards/stats:
 *   get:
 *     summary: Get reward system statistics
 *     description: |
 *       View aggregated statistics about the rewards system,
 *       including total points distributed, top earners, and more.
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Reward system statistics
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 systemStats:
 *                   totalRewardRecords: 1250
 *                   totalUsersWithPoints: 450
 *                   totalPointsDistributed: 125000
 *                   avgPointsPerUser: 278
 *                   maxPointsEarned: 5000
 *                   minPointsEarned: 1
 *                 pointsBreakdown:
 *                   invitePoints: 45000
 *                   tradePoints: 60000
 *                   referralBonusPoints: 20000
 *                 generatedAt: "2024-12-16T10:30:00.000Z"
 */
router.get('/stats', rateLimitMiddleware, getRewardStats);

// ============================================
// 404 HANDLER
// ============================================

router.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Reward endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET /api/rewards',
      'GET /api/rewards/my-points',
      'GET /api/rewards/my-history',
      'GET /api/rewards/referral-info',
      'GET /api/rewards/leaderboard',
      'GET /api/rewards/rules',
      'GET /api/rewards/stats'
    ]
  });
});

export default router;