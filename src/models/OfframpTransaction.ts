// ============= src/models/OfframpTransaction.ts (UPDATED FOR POLLING) =============
import mongoose, { Schema, Document, Model } from 'mongoose';

interface IOfframpTransaction extends Document {
  // Identifiers
  transactionReference: string;
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

  // Lenco Integration
  lencoReference?: string;
  lencoStatus?: string; // pending, processing, successful, failed, rejected

  // Status
  status: 'PENDING' | 'PROCESSING' | 'SETTLING' | 'COMPLETED' | 'FAILED';

  // Error Handling
  errorCode?: string;
  errorMessage?: string;
  failureReason?: string;

  // Polling Tracking (NEW)
  pollAttempts?: number; // Number of times we've polled this transaction
  lastPolledAt?: Date; // Last time we checked status with Lenco
  polledAt?: Date; // When we last updated via polling

  // Timestamps
  createdAt?: Date;
  processedAt?: Date; // When user confirmed with passkey
  settledAt?: Date; // When settlement was initiated
  completedAt?: Date; // When settlement finished
  passkeyVerifiedAt?: Date; // When passkey verification occurred
  passkeyVerified?: boolean;

  // Metadata
  rateSource?: 'Paycrest' | 'Fallback';
  cached?: boolean;
  webhookAttempts?: number;

  // Methods
  getSummary(): any;
}

// Define the static methods interface
interface IOfframpTransactionModel extends Model<IOfframpTransaction> {
  findUserTransactions(
    userId: string,
    limit?: number,
    skip?: number
  ): Promise<IOfframpTransaction[]>;
}

const OfframpTransactionSchema = new Schema<IOfframpTransaction, IOfframpTransactionModel>(
  {
    // Identifiers
    transactionReference: {
      type: String,
      required: true,
      unique: true,
      index: true
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
      required: true
    },
    feeUSDC: {
      type: Number,
      required: true
    },
    netUSDC: {
      type: Number,
      required: true
    },
    amountNGN: {
      type: Number,
      required: true
    },
    baseRate: {
      type: Number,
      required: true
    },
    offrampRate: {
      type: Number,
      required: true
    },
    effectiveRate: {
      type: Number,
      required: true
    },
    lpFeeUSDC: {
      type: Number,
      required: true
    },

    // Beneficiary
    beneficiary: {
      name: String,
      accountNumber: String,
      bankCode: String,
      bankName: String
    },

    // Blockchain
    transactionHash: String,

    // Lenco Integration
    lencoReference: String,
    lencoStatus: String, // Track Lenco's status independently

    // Status
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'SETTLING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true
    },

    // Error Handling
    errorCode: String,
    errorMessage: String,
    failureReason: String,

    // Polling Tracking (NEW)
    pollAttempts: {
      type: Number,
      default: 0
    },
    lastPolledAt: Date,
    polledAt: Date,

    // Timestamps
    processedAt: Date,
    settledAt: Date,
    completedAt: Date,
    passkeyVerifiedAt: Date,
    passkeyVerified: {
      type: Boolean,
      default: false
    },

    // Metadata
    rateSource: {
      type: String,
      enum: ['Paycrest', 'Fallback']
    },
    cached: Boolean,
    webhookAttempts: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true,
    collection: 'offramp_transactions'
  }
);

// Indexes for querying
OfframpTransactionSchema.index({ userId: 1, status: 1 });
OfframpTransactionSchema.index({ status: 1, lencoReference: 1 });
OfframpTransactionSchema.index({ createdAt: -1 });
OfframpTransactionSchema.index({ status: 1, processedAt: 1 }); // For polling query

// Get summary of transaction
OfframpTransactionSchema.methods.getSummary = function() {
  return {
    transactionReference: this.transactionReference,
    status: this.status,
    amountUSDC: this.amountUSDC,
    amountNGN: this.amountNGN,
    beneficiary: {
      name: this.beneficiary.name,
      accountNumber: this.beneficiary.accountNumber.slice(-4).padStart(this.beneficiary.accountNumber.length, '*'),
      bankName: this.beneficiary.bankName
    },
    createdAt: this.createdAt,
    processedAt: this.processedAt,
    completedAt: this.completedAt,
    lencoReference: this.lencoReference,
    lencoStatus: this.lencoStatus,
    pollingInfo: {
      pollAttempts: this.pollAttempts || 0,
      lastPolledAt: this.lastPolledAt,
      isStale: this.lastPolledAt && (Date.now() - this.lastPolledAt.getTime()) > 5 * 60 * 1000 // More than 5 minutes old
    },
    error: this.errorMessage ? {
      code: this.errorCode,
      message: this.errorMessage,
      reason: this.failureReason
    } : null
  };
};

// Static method to find user's transactions
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

const OfframpTransaction = mongoose.model<IOfframpTransaction, IOfframpTransactionModel>(
  'OfframpTransaction',
  OfframpTransactionSchema
);

export default OfframpTransaction;