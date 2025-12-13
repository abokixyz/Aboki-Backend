// ============= src/models/InviteCode.ts =============
import mongoose, { Schema, Document } from 'mongoose';

export interface IInviteCode extends Document {
  code: string;
  isLifetime: boolean;
  usedBy: mongoose.Types.ObjectId[];
  createdBy?: mongoose.Types.ObjectId;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Virtual properties
  isUsed: boolean;
  usageCount: number;
  // Methods
  isValid(): boolean;
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
    isLifetime: {
      type: Boolean,
      default: false,
      required: true
    },
    usedBy: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
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
InviteCodeSchema.index({ expiresAt: 1 });
InviteCodeSchema.index({ createdBy: 1 });

// Virtual property to check if code has been used
InviteCodeSchema.virtual('isUsed').get(function() {
  return this.usedBy && this.usedBy.length > 0;
});

// Virtual property to get usage count
InviteCodeSchema.virtual('usageCount').get(function() {
  return this.usedBy ? this.usedBy.length : 0;
});

// Pre-save middleware to ensure data consistency
InviteCodeSchema.pre('save', function(next) {
  // If lifetime code, ensure expiresAt is null
  if (this.isLifetime) {
    this.expiresAt = undefined;
  }
  
  // Initialize usedBy array if it doesn't exist
  if (!this.usedBy) {
    this.usedBy = [];
  }
  
  next();
});

// Method to check if invite code is still valid
InviteCodeSchema.methods.isValid = function(): boolean {
  // Check if expired (for non-lifetime codes)
  if (!this.isLifetime && this.expiresAt && this.expiresAt < new Date()) {
    return false;
  }
  
  return true;
};

// Ensure virtuals are included when converting to JSON
InviteCodeSchema.set('toJSON', { virtuals: true });
InviteCodeSchema.set('toObject', { virtuals: true });

export default mongoose.model<IInviteCode>('InviteCode', InviteCodeSchema);