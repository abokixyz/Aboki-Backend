// ============= src/models/PasskeyTransaction.ts =============
import mongoose, { Schema, Document } from 'mongoose';

export interface IPasskeyTransaction extends Document {
  transactionId: string;
  userId: mongoose.Types.ObjectId;
  type: 'send' | 'withdraw';
  amount: number;
  recipient: string;
  challenge: string; // base64 encoded
  status: 'pending' | 'verified' | 'expired' | 'cancelled';
  rpId: string;
  origin: string;
  credentialId?: string;
  verifiedAt?: Date;
  createdAt: Date;
  expiresAt: Date;
}

const PasskeyTransactionSchema = new Schema<IPasskeyTransaction>(
  {
    transactionId: {
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
    type: {
      type: String,
      enum: ['send', 'withdraw'],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    recipient: {
      type: String,
      required: true
    },
    challenge: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'expired', 'cancelled'],
      default: 'pending',
      index: true
    },
    rpId: {
      type: String,
      required: true,
      // Store the RPID used when creating the challenge
      // This ensures verification uses the same RPID
    },
    origin: {
      type: String,
      required: true,
      // Store the origin that requested verification
    },
    credentialId: {
      type: String
    },
    verifiedAt: {
      type: Date
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 } // Auto-delete expired docs
    }
  },
  {
    timestamps: true
  }
);

// Add index for cleanup
PasskeyTransactionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

// Compound index for finding transactions
PasskeyTransactionSchema.index({ userId: 1, status: 1 });

const PasskeyTransaction = mongoose.model<IPasskeyTransaction>(
  'PasskeyTransaction',
  PasskeyTransactionSchema
);

export default PasskeyTransaction;