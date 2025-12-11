// ============= src/models/User.ts =============
import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name: string;
  username: string;
  email: string;
  password: string;
  inviteCode: string;
  invitedBy?: mongoose.Types.ObjectId; // NEW: Track who invited this user
  wallet: {
    ownerAddress: string;
    smartAccountAddress: string;
    network: string;
    walletId?: string | null;
    encryptedSeed?: string | null;
    encryptedWalletData?: string | null;
    isReal?: boolean;
  };
  createdInviteCodes: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true,
      maxlength: [50, 'Name cannot be more than 50 characters']
    },
    username: {
      type: String,
      required: [true, 'Please add a username'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot be more than 30 characters'],
      match: [
        /^[a-z0-9_]+$/,
        'Username can only contain lowercase letters, numbers, and underscores'
      ]
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email'
      ]
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    inviteCode: {
      type: String,
      required: [true, 'Invite code is required'],
      uppercase: true
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
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
        required: true,
        default: 'base-mainnet'
      },
      walletId: {
        type: String,
        default: null
      },
      encryptedSeed: {
        type: String,
        default: null,
        select: false
      },
      encryptedWalletData: {
        type: String,
        default: null,
        select: false
      },
      isReal: {
        type: Boolean,
        default: false
      }
    },
    createdInviteCodes: [{
      type: Schema.Types.ObjectId,
      ref: 'InviteCode'
    }]
  },
  {
    timestamps: true
  }
);

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);