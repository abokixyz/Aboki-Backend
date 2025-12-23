// ============= src/models/User.ts (COMPLETE - PASSKEY OPTIONAL) =============
import mongoose, { Schema, Document } from 'mongoose';

export interface IPasskey {
  credentialID: Buffer;
  credentialPublicKey: Buffer;
  counter: number;
  credentialDeviceType: string;
  credentialBackedUp: boolean;
}

export interface IUser extends Document {
  name: string;
  username: string;
  email: string;
  authMethod: 'passkey';
  passkey?: IPasskey;  // ✅ CHANGED: Made optional with ?
  inviteCode: string;
  invitedBy?: mongoose.Types.ObjectId;
  wallet: {
    ownerAddress: string;
    smartAccountAddress: string;
    network: string;
    isReal: boolean;
    encryptedWalletData?: string;
  };
  createdInviteCodes: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const PasskeySchema: Schema = new Schema({
  credentialID: {
    type: Buffer,
    required: true,
    description: 'Unique identifier for the passkey credential'
  },
  credentialPublicKey: {
    type: Buffer,
    required: true,
    description: 'Public key for passkey verification'
  },
  counter: {
    type: Number,
    required: true,
    default: 0,
    description: 'Counter for replay attack prevention'
  },
  credentialDeviceType: {
    type: String,
    required: true,
    description: 'Type of authenticator (platform or cross-platform)'
  },
  credentialBackedUp: {
    type: Boolean,
    required: true,
    description: 'Whether the credential is backed up (synced)'
  }
}, { _id: false });

const UserSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true
    },
    username: {
      type: String,
      required: [true, 'Please add a username'],
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must be less than 30 characters'],
      match: [/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores']
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email'
      ]
    },
    authMethod: {
      type: String,
      enum: ['passkey'],
      default: 'passkey',
      required: true,
      description: 'Authentication method - passkey only for pure passkey system'
    },
    passkey: {
      type: PasskeySchema,
      required: false,  // ✅ CHANGED: Made optional (not required)
      select: false, // Don't include passkey data by default (security)
      description: 'Passkey credential data for WebAuthn authentication'
    },
    inviteCode: {
      type: String,
      required: [true, 'Invite code is required'],
      uppercase: true
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      description: 'User who invited this user (referral tracking)'
    },
    wallet: {
      ownerAddress: {
        type: String,
        required: true
      },
      smartAccountAddress: {
        type: String,
        required: true
      },
      network: {
        type: String,
        default: 'base-mainnet'
      },
      isReal: {
        type: Boolean,
        default: false
      },
      encryptedWalletData: {
        type: String,
        required: false,
        select: false, // Don't include by default for security
        description: 'Encrypted private key data for transaction signing'
      }
    },
    createdInviteCodes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InviteCode',
      description: 'Invite codes created by this user'
    }]
  },
  {
    timestamps: true
  }
);

// Indexes for performance
UserSchema.index({ email: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ invitedBy: 1 });
UserSchema.index({ 'passkey.credentialID': 1 }); // For passkey lookup

// ============= INSTANCE METHODS =============

/**
 * Check if user has a registered passkey
 * Usage: user.hasPasskey() returns true/false
 */
UserSchema.methods.hasPasskey = function(): boolean {
  return this.passkey && this.passkey.credentialID ? true : false;
};

/**
 * Add passkey to user
 * Usage: user.addPasskey(passkeyData)
 */
UserSchema.methods.addPasskey = function(passkeyData: IPasskey): void {
  this.passkey = passkeyData;
};

/**
 * Remove passkey from user
 * Usage: user.removePasskey()
 */
UserSchema.methods.removePasskey = function(): void {
  this.passkey = undefined;
};

/**
 * Update counter for replay attack prevention
 * Usage: user.updatePasskeyCounter(newCounter)
 */
UserSchema.methods.updatePasskeyCounter = function(newCounter: number): void {
  if (this.passkey) {
    this.passkey.counter = newCounter;
  }
};

export default mongoose.model<IUser>('User', UserSchema);