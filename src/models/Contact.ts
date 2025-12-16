// ============= src/models/Contact.ts =============
import mongoose, { Schema, Document, PopulatedDoc } from 'mongoose';
import { IUser } from './User';

interface IContact extends Document {
  userId: mongoose.Types.ObjectId;
  contactUser: PopulatedDoc<IUser & Document>;
  username: string;
  address: string;
  interactionCount: number;
  transferCount: number;
  totalAmountTransferred: number;
  lastInteractedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const contactSchema = new Schema<IContact>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    contactUser: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    username: {
      type: String,
      required: true,
      lowercase: true
    },
    address: {
      type: String,
      required: true,
      lowercase: true
    },
    interactionCount: {
      type: Number,
      default: 0,
      min: 0
    },
    transferCount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAmountTransferred: {
      type: Number,
      default: 0,
      min: 0
    },
    lastInteractedAt: {
      type: Date,
      default: () => new Date()
    }
  },
  {
    timestamps: true
  }
);

// Compound index for fast lookups
contactSchema.index({ userId: 1, contactUser: 1 }, { unique: true });

// Index for sorting recent contacts
contactSchema.index({ userId: 1, lastInteractedAt: -1 });

// Index for getting user's contacts by interaction
contactSchema.index({ userId: 1, interactionCount: -1 });

const Contact = mongoose.model<IContact>('Contact', contactSchema);

export default Contact;
export type { IContact };