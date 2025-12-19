// ============= src/models/Transfer.ts =============
import mongoose, { Document, Schema } from 'mongoose';

export interface ITransfer extends Document {
  fromUser: mongoose.Types.ObjectId;
  fromUsername: string;
  fromAddress: string;
  toUser?: mongoose.Types.ObjectId;
  toUsername?: string;
  toAddress?: string;
  amount: number;
  amountInWei: string;
  transferType: 'USERNAME' | 'EXTERNAL' | 'LINK';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'CLAIMED';
  transactionHash?: string;
  linkCode?: string;
  linkExpiry?: Date;
  claimedBy?: mongoose.Types.ObjectId;
  claimedAt?: Date;
  message?: string;
  failureReason?: string;
  network: string;
  // NEW: Auto-claim support
  pendingClaimByNewUser?: boolean; // Flag for new user signup
  // ✅ NEW: Passkey verification fields
  verifiedWithPasskey: boolean;
  verificationTimestamp?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transferSchema = new Schema<ITransfer>(
  {
    fromUser: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    fromUsername: {
      type: String,
      required: true
    },
    fromAddress: {
      type: String,
      required: true
    },
    toUser: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    toUsername: {
      type: String,
      index: true
    },
    toAddress: {
      type: String,
      index: true
    },
    amount: {
      type: Number,
      required: true
    },
    amountInWei: {
      type: String,
      required: true
    },
    transferType: {
      type: String,
      enum: ['USERNAME', 'EXTERNAL', 'LINK'],
      required: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'CLAIMED'],
      default: 'PENDING',
      index: true
    },
    transactionHash: {
      type: String,
      index: true
    },
    linkCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    linkExpiry: {
      type: Date
    },
    claimedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    claimedAt: {
      type: Date
    },
    message: {
      type: String,
      maxlength: 200
    },
    failureReason: {
      type: String
    },
    network: {
      type: String,
      default: 'base-mainnet'
    },
    pendingClaimByNewUser: {
      type: Boolean,
      default: false
    },
    // ✅ NEW: Passkey verification fields
    verifiedWithPasskey: {
      type: Boolean,
      default: false,
      index: true
    },
    verificationTimestamp: {
      type: Date,
      sparse: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

transferSchema.index({ linkCode: 1, status: 1 });
transferSchema.index({ fromUser: 1, createdAt: -1 });
transferSchema.index({ toUser: 1, createdAt: -1 });
// ✅ NEW: Indexes for passkey verification queries
transferSchema.index({ verifiedWithPasskey: 1, verificationTimestamp: -1 });
transferSchema.index({ fromUser: 1, verifiedWithPasskey: 1 });

export default mongoose.model<ITransfer>('Transfer', transferSchema);