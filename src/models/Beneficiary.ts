// ============= src/models/Beneficiary.ts =============
/**
 * Beneficiary Model
 * 
 * Stores user's bank account beneficiaries for offramp
 * Supports soft delete and default beneficiary marking
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ============= INTERFACE =============

export interface IBeneficiary extends Document {
  userId: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  isVerified: boolean;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'PENDING';
  verificationDate?: Date;
  isDefault: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  canDelete(): boolean;
}

// ============= STATIC METHODS INTERFACE =============

interface IBeneficiaryModel extends Model<IBeneficiary> {
  getUserBeneficiaries(userId: string): Promise<IBeneficiary[]>;
  softDelete(id: string): Promise<void>;
  setAsDefault(userId: string, id: string): Promise<void>;
}

// ============= SCHEMA =============

const beneficiarySchema = new Schema<IBeneficiary, IBeneficiaryModel>(
  {
    userId: {
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
    bankName: {
      type: String,
      required: true
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    verificationStatus: {
      type: String,
      enum: ['VERIFIED', 'UNVERIFIED', 'PENDING'],
      default: 'UNVERIFIED'
    },
    verificationDate: Date,
    isDefault: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  {
    timestamps: true,
    collection: 'beneficiaries'
  }
);

// ============= INDEXES =============

beneficiarySchema.index({ userId: 1, deletedAt: 1 });
beneficiarySchema.index({ userId: 1, isDefault: -1 });

// ============= INSTANCE METHODS =============

/**
 * Check if beneficiary can be deleted
 */
beneficiarySchema.methods.canDelete = function(): boolean {
  // Cannot delete if it's the default beneficiary
  return !this.isDefault;
};

// ============= STATIC METHODS =============

/**
 * Get user's beneficiaries (excluding soft-deleted)
 */
beneficiarySchema.statics.getUserBeneficiaries = async function(
  userId: string
): Promise<IBeneficiary[]> {
  return this.find({ userId, deletedAt: null })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
};

/**
 * Soft delete a beneficiary
 */
beneficiarySchema.statics.softDelete = async function(
  id: string
): Promise<void> {
  await this.findByIdAndUpdate(
    id,
    { deletedAt: new Date() },
    { new: true }
  );
  console.log(`✅ Beneficiary soft deleted: ${id}`);
};

/**
 * Set as default beneficiary
 */
beneficiarySchema.statics.setAsDefault = async function(
  userId: string,
  id: string
): Promise<void> {
  // Clear all defaults for this user
  await this.updateMany(
    { userId, deletedAt: null },
    { isDefault: false }
  );

  // Set this one as default
  await this.findByIdAndUpdate(
    id,
    { isDefault: true },
    { new: true }
  );

  console.log(`✅ Set default beneficiary: ${id}`);
};

// ============= MODEL =============

export default mongoose.model<IBeneficiary, IBeneficiaryModel>(
  'Beneficiary',
  beneficiarySchema
);