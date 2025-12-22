// ============= src/models/OfframpTransaction.ts (UPDATED FOR FIXED POLLING) =============
import mongoose, { Schema, Document, Model } from 'mongoose';

interface IOfframpTransaction extends Document {
  // Identifiers
  transactionReference: string; // ✅ YOUR reference (ABOKI_OFFRAMP_*) - used for polling
  userId: mongoose.Types.ObjectId;
  userAddress: string;

  // Amount & Rate
  amountUSDC: number;
  feeUSDC: number;
  netUSDC: number;
  amountNGN: number;
  baseRate: number;
  offrampRate: number;
  effectiveRate: number;
  lpFeeUSDC: number;

  // Beneficiary
  beneficiary: {
    name: string;
    accountNumber: string;
    bankCode: string;
    bankName?: string;
  };

  // Blockchain
  transactionHash?: string;

  // Lenco Integration (FIXED)
  lencoTransactionId?: string; // ✅ Lenco's transaction ID (from response)
  lencoStatus?: string; // pending, successful, failed, declined

  // Status
  status: 'PENDING' | 'PROCESSING' | 'SETTLING' | 'COMPLETED' | 'FAILED';

  // Error Handling
  errorCode?: string;
  errorMessage?: string;
  failureReason?: string;

  // Polling Tracking
  pollAttempts?: number; // Number of times we've polled Lenco
  lastPolledAt?: Date; // Last time we queried Lenco
  nextPollAt?: Date; // When to poll next

  // Timestamps
  createdAt?: Date;
  initiatedAt?: Date; // When transfer was initiated with Lenco
  processedAt?: Date; // When user confirmed with passkey
  settledAt?: Date; // When settlement was initiated
  completedAt?: Date; // When settlement finished
  passkeyVerifiedAt?: Date; // When passkey verification occurred

  // Metadata
  rateSource?: 'Paycrest' | 'Fallback';
  cached?: boolean;
  webhookAttempts?: number;
  passkeyVerified?: boolean;

  // Methods
  getSummary(): any;
  updatePollingStatus(status: string): void;
  markAsPolled(): void;
}

// Define the static methods interface
interface IOfframpTransactionModel extends Model<IOfframpTransaction> {
  findUserTransactions(
    userId: string,
    limit?: number,
    skip?: number
  ): Promise<IOfframpTransaction[]>;
  
  findActiveTransactions(
    limit?: number
  ): Promise<IOfframpTransaction[]>;
}

const OfframpTransactionSchema = new Schema<IOfframpTransaction, IOfframpTransactionModel>(
  {
    // Identifiers
    transactionReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      // Format: ABOKI_OFFRAMP_1699564800000_ABC12XYZ
      match: /^ABOKI_OFFRAMP_/
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    userAddress: {
      type: String,
      required: true
    },

    // Amount & Rate
    amountUSDC: {
      type: Number,
      required: true,
      min: 0
    },
    feeUSDC: {
      type: Number,
      required: true,
      min: 0
    },
    netUSDC: {
      type: Number,
      required: true,
      min: 0
    },
    amountNGN: {
      type: Number,
      required: true,
      min: 0
    },
    baseRate: {
      type: Number,
      required: true,
      min: 0
    },
    offrampRate: {
      type: Number,
      required: true,
      min: 0
    },
    effectiveRate: {
      type: Number,
      required: true,
      min: 0
    },
    lpFeeUSDC: {
      type: Number,
      required: true,
      min: 0
    },

    // Beneficiary
    beneficiary: {
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
      bankName: {
        type: String,
        sparse: true
      }
    },

    // Blockchain
    transactionHash: {
      type: String,
      sparse: true,
      index: true
    },

    // ✅ FIXED: Lenco Integration
    lencoTransactionId: {
      type: String,
      sparse: true,
      index: true,
      // This is Lenco's internal transaction ID (gets populated after initiating transfer)
    },
    lencoStatus: {
      type: String,
      enum: ['pending', 'successful', 'failed', 'declined'],
      sparse: true
    },

    // Status
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'SETTLING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true
    },

    // Error Handling
    errorCode: {
      type: String,
      sparse: true
    },
    errorMessage: {
      type: String,
      sparse: true
    },
    failureReason: {
      type: String,
      sparse: true
    },

    // Polling Tracking
    pollAttempts: {
      type: Number,
      default: 0,
      min: 0
    },
    lastPolledAt: {
      type: Date,
      sparse: true
    },
    nextPollAt: {
      type: Date,
      sparse: true
    },

    // Timestamps
    initiatedAt: {
      type: Date,
      sparse: true
    },
    processedAt: {
      type: Date,
      sparse: true
    },
    settledAt: {
      type: Date,
      sparse: true
    },
    completedAt: {
      type: Date,
      sparse: true
    },
    passkeyVerifiedAt: {
      type: Date,
      sparse: true
    },

    // Metadata
    rateSource: {
      type: String,
      enum: ['Paycrest', 'Fallback'],
      sparse: true
    },
    cached: {
      type: Boolean,
      default: false
    },
    webhookAttempts: {
      type: Number,
      default: 0,
      min: 0
    },
    passkeyVerified: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    collection: 'offramp_transactions'
  }
);

// ✅ Indexes for efficient querying
OfframpTransactionSchema.index({ userId: 1, status: 1 });
OfframpTransactionSchema.index({ status: 1, initiatedAt: 1 }); // For finding active transactions to poll
OfframpTransactionSchema.index({ transactionReference: 1 }); // For looking up by reference
OfframpTransactionSchema.index({ lencoTransactionId: 1 }); // For Lenco lookups
OfframpTransactionSchema.index({ createdAt: -1 }); // For sorting by newest
OfframpTransactionSchema.index({ status: 1, lastPolledAt: 1 }); // For polling query

// ✅ Instance method: Get transaction summary
OfframpTransactionSchema.methods.getSummary = function() {
  const pollDiff = this.lastPolledAt ? Date.now() - this.lastPolledAt.getTime() : null;
  const isStale = pollDiff && pollDiff > 5 * 60 * 1000; // More than 5 minutes old

  return {
    transactionReference: this.transactionReference,
    status: this.status,
    lencoStatus: this.lencoStatus,
    amountUSDC: this.amountUSDC,
    amountNGN: this.amountNGN,
    beneficiary: {
      name: this.beneficiary.name,
      accountNumber: `****${this.beneficiary.accountNumber.slice(-4)}`,
      bankName: this.beneficiary.bankName
    },
    createdAt: this.createdAt,
    initiatedAt: this.initiatedAt,
    processedAt: this.processedAt,
    completedAt: this.completedAt,
    
    // ✅ Polling info
    pollingInfo: {
      pollAttempts: this.pollAttempts || 0,
      lastPolledAt: this.lastPolledAt,
      isStale: isStale,
      nextPollAt: this.nextPollAt
    },
    
    // Error info
    error: this.errorMessage ? {
      code: this.errorCode,
      message: this.errorMessage,
      reason: this.failureReason
    } : null
  };
};

// ✅ Instance method: Update polling status
OfframpTransactionSchema.methods.updatePollingStatus = function(status: string) {
  if (['pending', 'successful', 'failed', 'declined'].includes(status)) {
    this.lencoStatus = status;
    
    // Update main status based on Lenco status
    switch (status) {
      case 'successful':
        this.status = 'COMPLETED';
        this.completedAt = new Date();
        break;
      case 'failed':
      case 'declined':
        this.status = 'FAILED';
        this.completedAt = new Date();
        this.errorCode = 'LENCO_SETTLEMENT_FAILED';
        this.errorMessage = `Lenco settlement ${status}`;
        break;
      case 'pending':
        this.status = 'SETTLING';
        break;
    }
  }
};

// ✅ Instance method: Mark as polled
OfframpTransactionSchema.methods.markAsPolled = function() {
  this.lastPolledAt = new Date();
  this.pollAttempts = (this.pollAttempts || 0) + 1;
  // Schedule next poll in 5 seconds
  this.nextPollAt = new Date(Date.now() + 5000);
};

// ✅ Static method: Find user's transactions
OfframpTransactionSchema.statics.findUserTransactions = async function(
  userId: string,
  limit: number = 10,
  skip: number = 0
): Promise<IOfframpTransaction[]> {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();
};

// ✅ Static method: Find active transactions needing polling
OfframpTransactionSchema.statics.findActiveTransactions = async function(
  limit: number = 10
): Promise<IOfframpTransaction[]> {
  return this.find({
    status: { $in: ['PROCESSING', 'SETTLING'] },
    initiatedAt: { $exists: true }
  })
    .sort({ lastPolledAt: 1 }) // Poll least recently polled first
    .limit(limit)
    .lean();
};

const OfframpTransaction = mongoose.model<IOfframpTransaction, IOfframpTransactionModel>(
  'OfframpTransaction',
  OfframpTransactionSchema
);

export default OfframpTransaction;