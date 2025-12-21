// ============= src/controllers/rewardController.ts =============
import { Request, Response } from 'express';
import { UserReward, RewardPoint } from '../models/Reward';
import User from '../models/User';

/**
 * @desc    Get my reward points and breakdown
 * @route   GET /api/rewards/my-points
 * @access  Private
 */
export const getMyPoints = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Find or create user reward record
    let userReward = await UserReward.findOne({ userId });

    if (!userReward) {
      userReward = await UserReward.create({ userId });
      console.log(`✅ Created new reward record for user ${userId}`);
    }

    const breakdown = userReward.getPointBreakdown();

    res.status(200).json({
      success: true,
      data: {
        userId,
        totalPoints: breakdown.totalPoints,
        pointBreakdown: {
          invitePoints: breakdown.invitePoints,
          tradePoints: breakdown.tradePoints,
          referralBonusPoints: breakdown.referralBonusPoints
        },
        details: breakdown.breakdown,
        lastUpdated: userReward.updatedAt
      }
    });
  } catch (error: any) {
    console.error('❌ Error getting my points:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my points history (all point transactions)
 * @route   GET /api/rewards/my-history
 * @access  Private
 */
export const getMyPointsHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { limit = '50', skip = '0', type } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const skipNum = parseInt(skip as string) || 0;

    const filter: any = { userId };
    if (type) {
      filter.pointType = type;
    }

    const history = await RewardPoint.find(filter)
      .populate('referrerId', 'username name')
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum);

    const total = await RewardPoint.countDocuments(filter);

    const formattedHistory = history.map(record => ({
      transactionId: record._id,
      pointType: record.pointType,
      points: record.points,
      description: record.description,
      amount: record.amount,
      referrerId: record.referrerId ? (record.referrerId as any).username : null,
      relatedTransactionId: record.relatedTransactionId,
      earnedAt: record.createdAt
    }));

    res.status(200).json({
      success: true,
      data: formattedHistory,
      pagination: {
        limit: limitNum,
        skip: skipNum,
        total,
        hasMore: skipNum + limitNum < total
      }
    });
  } catch (error: any) {
    console.error('❌ Error getting points history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get referral bonus information
 * @route   GET /api/rewards/referral-info
 * @access  Private
 */
export const getReferralBonusInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId).select('invitedBy username');
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    let referrerInfo: any = null;
    if (user.invitedBy) {
      const referrer = await User.findById(user.invitedBy).select('username name');
      const referrerReward = await UserReward.findOne({ userId: user.invitedBy });

      referrerInfo = {
        username: referrer?.username,
        name: referrer?.name,
        referralBonusPoints: referrerReward?.referralBonusPoints || 0,
        totalPoints: referrerReward?.totalPoints || 0,
        earnedFromYou: referrerReward?.referralBonusPoints || 0
      };
    }

    const myReward = await UserReward.findOne({ userId });

    res.status(200).json({
      success: true,
      data: {
        youAreInvitedBy: referrerInfo,
        yourReferralBonus: {
          totalBonusPoints: myReward?.referralBonusPoints || 0,
          description: '50% of points earned by people you invited',
          howItWorks: {
            step1: 'You invite a friend with your code',
            step2: 'Friend signs up and starts trading',
            step3: 'Friend earns points (e.g., 20 points for $100 trade)',
            step4: 'You get 50% of their trade points as bonus (10 points)',
            step5: 'Points accumulate in your referral bonus pool'
          }
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error getting referral info:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get top point earners (leaderboard)
 * @route   GET /api/rewards/leaderboard
 * @access  Public
 */
export const getLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '20', type = 'total' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 20, 100);

    let sortField = '-totalPoints';
    if (type === 'invite') sortField = '-invitePoints';
    else if (type === 'trade') sortField = '-tradePoints';
    else if (type === 'referral') sortField = '-referralBonusPoints';

    const topEarners = await UserReward.find()
      .populate('userId', 'username name')
      .sort(sortField)
      .limit(limitNum);

    const leaderboard = topEarners.map((earner, index) => ({
      rank: index + 1,
      username: (earner.userId as any)?.username || 'Unknown',
      name: (earner.userId as any)?.name || 'Unknown',
      totalPoints: earner.totalPoints,
      invitePoints: earner.invitePoints,
      tradePoints: earner.tradePoints,
      referralBonusPoints: earner.referralBonusPoints
    }));

    res.status(200).json({
      success: true,
      data: {
        leaderboardType: type === 'total' ? 'Total Points' : `${type} Points`,
        leaderboard,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get points rules and information
 * @route   GET /api/rewards/rules
 * @access  Public
 */
export const getRewardRules = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      data: {
        pointSystem: {
          title: 'Aboki Rewards Points System',
          status: 'Active (Tracking Only - Rewards Coming Soon)',
          description: 'Earn points for various activities and track your progress',
          
          rules: [
            {
              activity: 'Invite a Friend',
              pointsEarned: 1,
              description: 'Get 1 point for each friend you invite',
              maxPoints: 'Unlimited',
              example: 'Invite 5 friends = 5 points'
            },
            {
              activity: 'Trade/Buy USDC ($100)',
              pointsEarned: 20,
              description: 'Earn points based on trading amount (0.2 points per $1)',
              maxPoints: 'No limit',
              example: '$100 trade = 20 points, $200 trade = 40 points'
            },
            {
              activity: 'Referral Bonus',
              pointsEarned: '50% of referral trades',
              description: 'Earn 50% of the points your invitees earn from trading',
              maxPoints: 'No limit',
              example: 'Referral trades $100 (20 pts) → You get 10 referral bonus points'
            }
          ],

          pointCalculations: {
            tradePoints: {
              formula: 'Trade Amount (USD) × 0.2',
              examples: [
                { amount: '$50', points: 10 },
                { amount: '$100', points: 20 },
                { amount: '$200', points: 40 },
                { amount: '$500', points: 100 },
                { amount: '$1000', points: 200 }
              ]
            },
            referralBonus: {
              formula: 'Referral Trade Points × 0.5',
              examples: [
                {
                  referralTradeAmount: '$100',
                  referralEarns: 20,
                  youEarn: 10
                },
                {
                  referralTradeAmount: '$500',
                  referralEarns: 100,
                  youEarn: 50
                }
              ]
            }
          },

          pointAccumulation: {
            description: 'Points accumulate in three categories',
            categories: [
              {
                name: 'Invite Points',
                description: 'Points from inviting friends',
                color: 'blue'
              },
              {
                name: 'Trade Points',
                description: 'Points from your own trades/purchases',
                color: 'green'
              },
              {
                name: 'Referral Bonus Points',
                description: 'Points earned from referrals trading',
                color: 'gold'
              }
            ],
            totalPoints: 'Sum of all three categories'
          },

          upcomingRewards: {
            status: '🔜 Coming Soon',
            description: 'Rewards redemption will be available soon',
            message: 'Your accumulated points are being tracked and will be convertible to rewards in the future'
          },

          tracking: {
            description: 'You can track your points in real-time',
            features: [
              'View your total points',
              'See detailed breakdown by category',
              'Check your complete points history',
              'View your referral bonus information',
              'See leaderboards of top earners'
            ]
          }
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching reward rules:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get rewards statistics
 * @route   GET /api/rewards/stats
 * @access  Public
 */
export const getRewardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const totalRewardRecords = await RewardPoint.countDocuments();
    const totalUsersWithPoints = await UserReward.countDocuments({ totalPoints: { $gt: 0 } });
    
    const pointStats = await UserReward.aggregate([
      {
        $group: {
          _id: null,
          totalPointsDistributed: { $sum: '$totalPoints' },
          avgPointsPerUser: { $avg: '$totalPoints' },
          maxPoints: { $max: '$totalPoints' },
          minPoints: { $min: '$totalPoints' },
          totalInvitePoints: { $sum: '$invitePoints' },
          totalTradePoints: { $sum: '$tradePoints' },
          totalReferralBonusPoints: { $sum: '$referralBonusPoints' }
        }
      }
    ]);

    const stats = pointStats[0] || {
      totalPointsDistributed: 0,
      avgPointsPerUser: 0,
      maxPoints: 0,
      minPoints: 0,
      totalInvitePoints: 0,
      totalTradePoints: 0,
      totalReferralBonusPoints: 0
    };

    res.status(200).json({
      success: true,
      data: {
        systemStats: {
          totalRewardRecords,
          totalUsersWithPoints,
          totalPointsDistributed: Math.floor(stats.totalPointsDistributed),
          avgPointsPerUser: Math.floor(stats.avgPointsPerUser),
          maxPointsEarned: stats.maxPoints,
          minPointsEarned: stats.minPoints
        },
        pointsBreakdown: {
          invitePoints: Math.floor(stats.totalInvitePoints),
          tradePoints: Math.floor(stats.totalTradePoints),
          referralBonusPoints: Math.floor(stats.totalReferralBonusPoints)
        },
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching reward stats:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

// ============= HELPER FUNCTIONS (For use in other controllers) =============

/**
 * Award points when user invites someone
 * Called from user signup with referral code
 */
export const awardInvitePoints = async (inviterId: string, code: string): Promise<void> => {
  try {
    let userReward = await UserReward.findOne({ userId: inviterId });
    
    if (!userReward) {
      userReward = await UserReward.create({ userId: inviterId });
    }

    await userReward.addPoints(
      'invite',
      1,
      `Invited friend with code ${code}`,
      code
    );

    console.log(`✅ Awarded 1 invite point to user ${inviterId}`);
  } catch (error: any) {
    console.error('❌ Error awarding invite points:', error.message);
  }
};

/**
 * Award points when user completes a trade (onramp/offramp)
 * Called after successful trade completion
 */
export const awardTradePoints = async (
  userId: string,
  amountUSD: number,
  transactionId: string,
  invitedBy?: string
): Promise<void> => {
  try {
    // Calculate trade points (0.2 per dollar)
    const tradePoints = Math.floor(amountUSD * 0.2);

    let userReward = await UserReward.findOne({ userId });
    if (!userReward) {
      userReward = await UserReward.create({ userId });
    }

    // Award trade points to user
    await userReward.addPoints(
      'trade',
      tradePoints,
      `Traded $${amountUSD} USDC`,
      transactionId
    );

    console.log(`✅ Awarded ${tradePoints} trade points to user ${userId}`);

    // Award referral bonus to inviter (if they have one)
    if (invitedBy) {
      const referralBonus = Math.floor(tradePoints * 0.5); // 50% of trade points

      let referrerReward = await UserReward.findOne({ userId: invitedBy });
      if (!referrerReward) {
        referrerReward = await UserReward.create({ userId: invitedBy });
      }

      await referrerReward.addPoints(
        'referral_bonus',
        referralBonus,
        `Referral bonus: ${userId} traded $${amountUSD}`,
        transactionId
      );

      console.log(`✅ Awarded ${referralBonus} referral bonus points to user ${invitedBy}`);
    }
  } catch (error: any) {
    console.error('❌ Error awarding trade points:', error.message);
  }
};

export default {
  getMyPoints,
  getMyPointsHistory,
  getReferralBonusInfo,
  getLeaderboard,
  getRewardRules,
  getRewardStats,
  awardInvitePoints,
  awardTradePoints
};