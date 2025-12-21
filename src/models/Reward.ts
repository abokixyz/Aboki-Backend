// ============= src/models/Reward.ts =============
import mongoose, { Schema, Document } from 'mongoose';

interface IRewardPoint extends Document {
  userId: mongoose.Types.ObjectId;
  pointType: 'invite' | 'trade' | 'referral_bonus';
  points: number;
  amount?: number; // Amount in USD for trade points
  description: string;
  referrerId?: mongoose.Types.ObjectId; // Who referred this user (for referral bonus tracking)
  relatedTransactionId?: string; // Link to transaction/invite ID
  createdAt: Date;
  updatedAt: Date;
}

interface IUserReward extends Document {
  userId: mongoose.Types.ObjectId;
  totalPoints: number;
  invitePoints: number; // Points from inviting
  tradePoints: number; // Points from trading
  referralBonusPoints: number; // Points earned from referrals
  pointsHistory: mongoose.Types.ObjectId[]; // References to reward points
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  addPoints(type: string, points: number, description: string, transactionId?: string): Promise<void>;
  getReferralBonus(amount: number): number;
  getPointBreakdown(): any;
}

// ============= REWARD POINT SCHEMA =============
const rewardPointSchema = new Schema<IRewardPoint>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    pointType: {
      type: String,
      enum: ['invite', 'trade', 'referral_bonus'],
      required: true,
      index: true
    },
    points: {
      type: Number,
      required: true,
      min: 0
    },
    amount: {
      type: Number,
      description: 'Amount in USD for trade points'
    },
    description: {
      type: String,
      required: true
    },
    referrerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      description: 'The user who referred this user'
    },
    relatedTransactionId: {
      type: String,
      description: 'Link to transaction or invite reference'
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// ============= USER REWARD SCHEMA =============
const userRewardSchema = new Schema<IUserReward>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    totalPoints: {
      type: Number,
      default: 0,
      min: 0
    },
    invitePoints: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Points earned from inviting friends'
    },
    tradePoints: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Points earned from trading'
    },
    referralBonusPoints: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Points earned from referrals trading'
    },
    pointsHistory: [
      {
        type: Schema.Types.ObjectId,
        ref: 'RewardPoint'
      }
    ],
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// ============= METHODS =============

/**
 * Add points to user and create history record
 */
userRewardSchema.methods.addPoints = async function (
  type: string,
  points: number,
  description: string,
  transactionId?: string
): Promise<void> {
  try {
    // Create point record
    const pointRecord = await RewardPoint.create({
      userId: this.userId,
      pointType: type,
      points,
      description,
      relatedTransactionId: transactionId
    });

    // Update totals
    this.totalPoints += points;

    if (type === 'invite') {
      this.invitePoints += points;
    } else if (type === 'trade') {
      this.tradePoints += points;
    } else if (type === 'referral_bonus') {
      this.referralBonusPoints += points;
    }

    this.pointsHistory.push(pointRecord._id);
    await this.save();

    console.log(`✅ Points added: ${points} (${type}) to user ${this.userId}`);
  } catch (error: any) {
    console.error('❌ Error adding points:', error.message);
    throw error;
  }
};

/**
 * Calculate referral bonus points (50% of trade points)
 */
userRewardSchema.methods.getReferralBonus = function (amount: number): number {
  // Trade points: 100$ = 20 points, 200$ = 40 points
  // So: points = amount * 0.2
  const tradePoints = amount * 0.2;
  // Referral bonus is half
  return Math.floor(tradePoints * 0.5);
};

/**
 * Get breakdown of points by type
 */
userRewardSchema.methods.getPointBreakdown = function (): any {
  return {
    totalPoints: this.totalPoints,
    invitePoints: this.invitePoints,
    tradePoints: this.tradePoints,
    referralBonusPoints: this.referralBonusPoints,
    breakdown: {
      fromInvites: {
        points: this.invitePoints,
        description: '1 point per friend invited'
      },
      fromTrades: {
        points: this.tradePoints,
        description: '$100 = 20 points, $200 = 40 points (0.2 points per $1)'
      },
      fromReferralBonus: {
        points: this.referralBonusPoints,
        description: '50% of points earned by people you invited'
      }
    }
  };
};

// ============= STATIC METHODS =============

/**
 * Calculate trade points based on amount
 */
userRewardSchema.statics.calculateTradePoints = function (amountUSD: number): number {
  // 0.2 points per dollar: $100 = 20 points, $200 = 40 points
  return Math.floor(amountUSD * 0.2);
};

// ============= EXPORTS =============
const RewardPoint = mongoose.model<IRewardPoint>(
  'RewardPoint',
  rewardPointSchema
);

const UserReward = mongoose.model<IUserReward>(
  'UserReward',
  userRewardSchema
);

export { RewardPoint, UserReward, IRewardPoint, IUserReward };