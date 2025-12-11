// ============= src/models/InviteCode.ts =============
import mongoose, { Schema, Document } from 'mongoose';

export interface IInviteCode extends Document {
  code: string;
  isUsed: boolean;
  isLifetime: boolean;
  usedBy?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InviteCodeSchema = new Schema<IInviteCode>(
  {
    code: {
      type: String,
      required: [true, 'Please add an invite code'],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [6, 'Invite code must be at least 6 characters'],
      maxlength: [20, 'Invite code cannot exceed 20 characters']
    },
    isUsed: {
      type: Boolean,
      default: false
    },
    isLifetime: {
      type: Boolean,
      default: false,
      required: true
    },
    usedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    expiresAt: {
      type: Date,
      default: null,
      validate: {
        validator: function(this: IInviteCode, value: Date) {
          // If isLifetime is true, expiresAt should be null
          if (this.isLifetime && value !== null) {
            return false;
          }
          // If not lifetime, expiresAt should be in the future
          if (!this.isLifetime && value && value < new Date()) {
            return false;
          }
          return true;
        },
        message: 'Lifetime codes cannot have expiration date, and non-lifetime codes must expire in the future'
      }
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
InviteCodeSchema.index({ code: 1 });
InviteCodeSchema.index({ isUsed: 1 });
InviteCodeSchema.index({ expiresAt: 1 });

// Pre-save middleware to ensure data consistency
InviteCodeSchema.pre('save', function(next) {
  // If lifetime code, ensure expiresAt is null
  if (this.isLifetime) {
    this.expiresAt = undefined;
  }
  next();
});

export default mongoose.model<IInviteCode>('InviteCode', InviteCodeSchema);