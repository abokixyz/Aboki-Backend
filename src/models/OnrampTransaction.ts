// ============= src/models/OnrampTransaction.ts =============
import mongoose, { Document, Schema } from 'mongoose';

export interface IOnrampTransaction extends Document {
  userId: mongoose.Types.ObjectId;
  paymentReference: string; // Our internal reference (e.g., ABOKI_1234567890_abc123_a1b2c3d4)
  monnifyReference: string; // Monnify's transaction reference
  amountNGN: number; // Amount in Nigerian Naira
  amountPaidNGN?: number; // Actual amount paid (from webhook)
  amountUSD: number; // Amount in USD
  usdcAmount: number; // Final USDC amount after fees
  exchangeRate: number; // NGN to USD rate used
  fee: number; // Fee in USD
  status: 'PENDING' | 'PAID' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  paymentMethod?: string; // CARD, ACCOUNT_TRANSFER, USSD, PHONE_NUMBER
  customerEmail: string;
  customerName: string;
  walletAddress: string; // User's wallet address (where USDC will be sent)
  transactionHash?: string; // Blockchain transaction hash (once USDC is sent)
  failureReason?: string; // Reason if transaction failed
  paidAt?: Date; // When payment was completed on Monnify
  completedAt?: Date; // When USDC was successfully credited
  createdAt: Date;
  updatedAt: Date;
}

const OnrampTransactionSchema = new Schema<IOnrampTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    paymentReference: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    monnifyReference: {
      type: String,
      default: '',
      index: true
    },
    amountNGN: {
      type: Number,
      required: true,
      min: 0
    },
    amountPaidNGN: {
      type: Number,
      min: 0
    },
    amountUSD: {
      type: Number,
      required: true,
      min: 0
    },
    usdcAmount: {
      type: Number,
      required: true,
      min: 0
    },
    exchangeRate: {
      type: Number,
      required: true,
      min: 0
    },
    fee: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true
    },
    paymentMethod: {
      type: String,
      enum: ['CARD', 'ACCOUNT_TRANSFER', 'USSD', 'PHONE_NUMBER', ''],
      default: ''
    },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    transactionHash: {
      type: String,
      lowercase: true,
      trim: true
    },
    failureReason: {
      type: String,
      trim: true
    },
    paidAt: {
      type: Date
    },
    completedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
OnrampTransactionSchema.index({ userId: 1, createdAt: -1 });
OnrampTransactionSchema.index({ userId: 1, status: 1 });
OnrampTransactionSchema.index({ status: 1, createdAt: -1 });
OnrampTransactionSchema.index({ paymentReference: 1 }, { unique: true });
OnrampTransactionSchema.index({ monnifyReference: 1 });
OnrampTransactionSchema.index({ walletAddress: 1 });

// Virtual for explorer URL (if needed)
OnrampTransactionSchema.virtual('explorerUrl').get(function() {
  if (this.transactionHash) {
    return `https://basescan.org/tx/${this.transactionHash}`;
  }
  return null;
});

// Method to check if transaction can be retried
OnrampTransactionSchema.methods.canRetry = function(): boolean {
  return this.status === 'FAILED' && 
         this.amountPaidNGN && 
         this.amountPaidNGN > 0 && 
         !this.transactionHash;
};

// Static method to get user's daily total
OnrampTransactionSchema.statics.getUserDailyTotal = async function(
  userId: string, 
  date: Date = new Date()
): Promise<number> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['COMPLETED', 'PENDING', 'PAID'] }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amountNGN' }
      }
    }
  ]);

  return result[0]?.total || 0;
};

// Static method to get user statistics
OnrampTransactionSchema.statics.getUserStats = async function(userId: string) {
  const stats = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId)
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalNGN: { $sum: '$amountNGN' },
        totalUSDC: { $sum: '$usdcAmount' }
      }
    }
  ]);

  return stats;
};

// Pre-save middleware to validate amounts
OnrampTransactionSchema.pre('save', function(next) {
  // Ensure amountPaidNGN is not negative
  if (this.amountPaidNGN && this.amountPaidNGN < 0) {
    this.amountPaidNGN = 0;
  }

  // Ensure all amounts are properly rounded
  if (this.amountNGN) {
    this.amountNGN = Math.round(this.amountNGN * 100) / 100;
  }
  if (this.amountUSD) {
    this.amountUSD = Math.round(this.amountUSD * 100) / 100;
  }
  if (this.usdcAmount) {
    this.usdcAmount = Math.round(this.usdcAmount * 1e6) / 1e6;
  }
  if (this.fee) {
    this.fee = Math.round(this.fee * 100) / 100;
  }

  next();
});

export default mongoose.model<IOnrampTransaction>('OnrampTransaction', OnrampTransactionSchema);