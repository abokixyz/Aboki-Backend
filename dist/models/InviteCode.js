"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// ============= src/models/InviteCode.ts =============
const mongoose_1 = __importStar(require("mongoose"));
const InviteCodeSchema = new mongoose_1.Schema({
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
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    expiresAt: {
        type: Date,
        default: null,
        validate: {
            validator: function (value) {
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
}, {
    timestamps: true
});
// Index for faster queries
InviteCodeSchema.index({ code: 1 });
InviteCodeSchema.index({ isUsed: 1 });
InviteCodeSchema.index({ expiresAt: 1 });
// Pre-save middleware to ensure data consistency
InviteCodeSchema.pre('save', function (next) {
    // If lifetime code, ensure expiresAt is null
    if (this.isLifetime) {
        this.expiresAt = undefined;
    }
    next();
});
exports.default = mongoose_1.default.model('InviteCode', InviteCodeSchema);
