// ============= src/models/FrequentAccount.ts =============
/**
 * Frequent Account Model
 * 
 * Tracks frequently used bank accounts for quick access
 * Records usage count and amount for sorting recommendations
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ============= INTERFACE =============

export interface IFrequentAccount extends Document {
  userId: string;
  key: string; // "bankCode_accountNumber"
  name: string;
  accountNumber: string;
  bankCode: string;
  totalAmount: number;
  usageCount: number;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============= STATIC METHODS INTERFACE =============

interface IFrequentAccountModel extends Model<IFrequentAccount> {
  recordUsage(
    userId: string,
    accountNumber: string,
    bankCode: string,
    amount: number,
    name: string
  ): Promise<void>;
  
  getRecentAccounts(userId: string, limit: number): Promise<IFrequentAccount[]>;
  getTopAccounts(userId: string, limit: number): Promise<IFrequentAccount[]>;
}

// ============= SCHEMA =============

const frequentAccountSchema = new Schema<IFrequentAccount, IFrequentAccountModel>(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    key: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    accountNumber: {
      type: String,
      required: true
    },
    bankCode: {
      type: String,
      required: true
    },
    totalAmount: {
      type: Number,
      default: 0
    },
    usageCount: {
      type: Number,
      default: 0
    },
    lastUsedAt: {
      type: Date,
      default: () => new Date()
    }
  },
  {
    timestamps: true,
    collection: 'frequent_accounts'
  }
);

// ============= INDEXES =============

frequentAccountSchema.index({ userId: 1, lastUsedAt: -1 });
frequentAccountSchema.index({ userId: 1, usageCount: -1, totalAmount: -1 });

// ============= STATIC METHODS =============

/**
 * Record account usage
 */
frequentAccountSchema.statics.recordUsage = async function(
  userId: string,
  accountNumber: string,
  bankCode: string,
  amount: number,
  name: string
): Promise<void> {
  try {
    const key = `${bankCode}_${accountNumber}`;

    await this.findOneAndUpdate(
      { userId, key },
      {
        $set: {
          userId,
          key,
          name,
          accountNumber,
          bankCode,
          lastUsedAt: new Date()
        },
        $inc: {
          usageCount: 1,
          totalAmount: amount
        }
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Frequent account recorded: ${name}`);
  } catch (error) {
    console.error('⚠️ Failed to record frequent account:', error);
    // Don't throw - this is non-critical
  }
};

/**
 * Get recent accounts (sorted by last used)
 */
frequentAccountSchema.statics.getRecentAccounts = async function(
  userId: string,
  limit: number
): Promise<IFrequentAccount[]> {
  return this.find({ userId })
    .sort({ lastUsedAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get top accounts (sorted by usage count and total amount)
 */
frequentAccountSchema.statics.getTopAccounts = async function(
  userId: string,
  limit: number
): Promise<IFrequentAccount[]> {
  return this.find({ userId })
    .sort({ usageCount: -1, totalAmount: -1 })
    .limit(limit)
    .lean();
};

// ============= MODEL =============

export default mongoose.model<IFrequentAccount, IFrequentAccountModel>(
  'FrequentAccount',
  frequentAccountSchema
);