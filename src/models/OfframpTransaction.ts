// ============= src/models/OfframpTransaction.ts =============
/**
 * Offramp Transaction Model
 * 
 * Tracks USDC → NGN offramp transactions
 * Records transaction status, amounts, fees, and settlement details
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ============= INTERFACE =============

export interface IOfframpTransaction extends Document {
  transactionReference: string;
  userId: string;
  userAddress: string;
  amountUSDC: number;
  feeUSDC: number;
  netUSDC: number;
  amountNGN: number;
  baseRate: number;
  offrampRate: number;
  effectiveRate: number;
  beneficiary: {
    name: string;
    accountNumber: string;
    bankCode: string;
    bankName: string;
  };
  lpFeeUSDC: number;
  status: 'PENDING' | 'PROCESSING' | 'SETTLING' | 'COMPLETED' | 'FAILED';
  rateSource: 'Paycrest' | 'Fallback';
  cached: boolean;
  transactionHash?: string;
  lencoReference?: string;
  processedAt?: Date;
  settledAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  failureReason?: string;
  webhookAttempts: number;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  getSummary(): any;
}

// ============= STATIC METHODS INTERFACE =============

interface IOfframpTransactionModel extends Model<IOfframpTransaction> {
  findUserTransactions(
    userId: string,
    limit: number,
    skip: number
  ): Promise<IOfframpTransaction[]>;
}

// ============= SCHEMA =============

const offrampTransactionSchema = new Schema<IOfframpTransaction, IOfframpTransactionModel>(
  {
    transactionReference: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    userAddress: {
      type: String,
      required: true
    },
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
    beneficiary: {
      name: { type: String, required: true },
      accountNumber: { type: String, required: true },
      bankCode: { type: String, required: true },
      bankName: { type: String, required: true }
    },
    lpFeeUSDC: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'SETTLING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true
    },
    rateSource: {
      type: String,
      enum: ['Paycrest', 'Fallback'],
      default: 'Paycrest'
    },
    cached: {
      type: Boolean,
      default: false
    },
    transactionHash: String,
    lencoReference: String,
    processedAt: Date,
    settledAt: Date,
    completedAt: Date,
    errorCode: String,
    errorMessage: String,
    failureReason: String,
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

// ============= INDEXES =============

offrampTransactionSchema.index({ userId: 1, createdAt: -1 });
offrampTransactionSchema.index({ transactionReference: 1 });
offrampTransactionSchema.index({ lencoReference: 1 });
offrampTransactionSchema.index({ status: 1 });

// ============= INSTANCE METHODS =============

/**
 * Get transaction summary
 */
offrampTransactionSchema.methods.getSummary = function(): any {
  return {
    transactionReference: this.transactionReference,
    status: this.status,
    amountUSDC: this.amountUSDC,
    amountNGN: this.amountNGN,
    feeUSDC: this.feeUSDC,
    offrampRate: this.offrampRate,
    bankName: this.beneficiary?.bankName,
    accountName: this.beneficiary?.name,
    accountNumber: this.beneficiary?.accountNumber?.slice(-4).padStart(this.beneficiary?.accountNumber?.length || 4, '*'),
    createdAt: this.createdAt,
    processedAt: this.processedAt,
    completedAt: this.completedAt,
    txHash: this.transactionHash,
    lencoReference: this.lencoReference,
    errorMessage: this.errorMessage,
    failureReason: this.failureReason
  };
};

// ============= STATIC METHODS =============

/**
 * Find user transactions with pagination
 */
offrampTransactionSchema.statics.findUserTransactions = async function(
  userId: string,
  limit: number,
  skip: number
): Promise<IOfframpTransaction[]> {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();
};

// ============= MODEL =============

export default mongoose.model<IOfframpTransaction, IOfframpTransactionModel>(
  'OfframpTransaction',
  offrampTransactionSchema
);