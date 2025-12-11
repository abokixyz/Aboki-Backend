// ============= src/types/index.ts =============
import { Document } from 'mongoose';
import mongoose from 'mongoose';

export interface IWallet {
  ownerAddress: string;
  smartAccountAddress: string;
  network: string;
  walletId?: string | null;
  encryptedSeed?: string | null;
  encryptedWalletData?: string | null;
  isReal?: boolean;
}

export interface IUser extends Document {
  name: string;
  username: string;
  email: string;
  password: string;
  inviteCode: string;
  invitedBy?: mongoose.Types.ObjectId; // NEW: Track who invited this user
  wallet?: IWallet;
  createdInviteCodes: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IInviteCode extends Document {
  code: string;
  isUsed: boolean;
  usedBy?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  expiresAt?: Date;
  isLifetime: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserDTO {
  name: string;
  username: string;
  email: string;
  password: string;
  inviteCode: string;
}

export interface UpdateUserDTO {
  name?: string;
  username?: string;
  email?: string;
}

export interface SignupDTO {
  name: string;
  username: string;
  email: string;
  password: string;
  inviteCode: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface GenerateInviteDTO {
  customCode?: string;
}

export interface WalletBalanceResponse {
  address: string;
  smartAccountAddress: string;
  network: string;
  balance: string;
  balanceInWei?: string;
  balanceInUSD?: string;
  currency?: string;
  isReal?: boolean;
}

export interface USDCBalanceResponse {
  balance: string;
  balanceInWei: string;
  currency: string;
  isReal: boolean;
}

export interface CreateInviteCodeDTO {
  code: string;
  isLifetime: boolean;
  expiresAt?: Date;
  createdBy?: mongoose.Types.ObjectId;
}

export interface SendTransactionDTO {
  toAddress: string;
  amount: string;
  token?: 'ETH' | 'USDC';
  network?: 'base-mainnet' | 'base-sepolia' | 'ethereum-sepolia';
}

export interface TransactionResponse {
  success: boolean;
  transactionHash?: string;
  amount: string;
  to: string;
  from?: string;
  token?: string;
  status?: string;
  explorerUrl?: string;
}

export interface ReferralData {
  name: string;
  username: string;
  email: string;
  joinedAt: Date;
  hasWallet: boolean;
}

export interface MyReferralsResponse {
  myInviteCode: string;
  totalReferrals: number;
  referrals: ReferralData[];
}

// Request types for middleware
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
  };
}