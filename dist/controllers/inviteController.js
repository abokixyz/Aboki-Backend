"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableInviteCodes = exports.validateInviteCode = exports.createDefaultInviteCode = exports.getInviteCodeByCode = exports.getMyReferrals = exports.getMyInviteCode = exports.getAllInviteCodes = void 0;
const InviteCode_1 = __importDefault(require("../models/InviteCode"));
const User_1 = __importDefault(require("../models/User"));
/**
 * @desc    Get all invite codes
 * @route   GET /api/invites
 * @access  Public
 */
const getAllInviteCodes = async (req, res) => {
    try {
        const inviteCodes = await InviteCode_1.default.find()
            .populate('usedBy', 'name email username')
            .populate('createdBy', 'name email username')
            .sort('-createdAt');
        res.status(200).json({
            success: true,
            count: inviteCodes.length,
            data: inviteCodes
        });
    }
    catch (error) {
        console.error('❌ Error fetching invite codes:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getAllInviteCodes = getAllInviteCodes;
/**
 * @desc    Get my invite code
 * @route   GET /api/invites/my-code
 * @access  Private
 */
const getMyInviteCode = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id).select('username');
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        // Get user's personal invite code
        const myInviteCode = await InviteCode_1.default.findOne({
            createdBy: user._id
        });
        if (!myInviteCode) {
            res.status(404).json({
                success: false,
                error: 'Invite code not found'
            });
            return;
        }
        res.status(200).json({
            success: true,
            data: {
                code: myInviteCode.code,
                isUsed: myInviteCode.isUsed,
                createdAt: myInviteCode.createdAt
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching my invite code:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getMyInviteCode = getMyInviteCode;
/**
 * @desc    Get my referrals (people I invited)
 * @route   GET /api/invites/my-referrals
 * @access  Private
 */
const getMyReferrals = async (req, res) => {
    try {
        // Find all users who were invited by the current user
        const referrals = await User_1.default.find({
            invitedBy: req.user?.id
        })
            .select('name username email createdAt wallet')
            .sort('-createdAt');
        // Get the user's invite code stats
        const myInviteCode = await InviteCode_1.default.findOne({
            createdBy: req.user?.id
        });
        res.status(200).json({
            success: true,
            data: {
                myInviteCode: myInviteCode?.code,
                totalReferrals: referrals.length,
                referrals: referrals.map(user => ({
                    name: user.name,
                    username: user.username,
                    email: user.email,
                    joinedAt: user.createdAt,
                    hasWallet: !!user.wallet
                }))
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching referrals:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getMyReferrals = getMyReferrals;
/**
 * @desc    Get invite code by code
 * @route   GET /api/invites/:code
 * @access  Public
 */
const getInviteCodeByCode = async (req, res) => {
    try {
        const inviteCode = await InviteCode_1.default.findOne({
            code: req.params.code.toUpperCase()
        })
            .populate('usedBy', 'name email username')
            .populate('createdBy', 'name email username');
        if (!inviteCode) {
            res.status(404).json({
                success: false,
                error: 'Invite code not found'
            });
            return;
        }
        res.status(200).json({
            success: true,
            data: inviteCode
        });
    }
    catch (error) {
        console.error('❌ Error fetching invite code:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getInviteCodeByCode = getInviteCodeByCode;
/**
 * @desc    Create default project invite code
 * @route   POST /api/invites/default
 * @access  Public
 */
const createDefaultInviteCode = async (req, res) => {
    try {
        console.log('📝 Creating default project invite code...');
        // Check if default code already exists
        const existingCode = await InviteCode_1.default.findOne({ code: 'PROJECTINVITE' });
        if (existingCode) {
            console.log('ℹ️ Default project invite code already exists');
            res.status(200).json({
                success: true,
                message: 'Default project invite code already exists',
                data: existingCode
            });
            return;
        }
        console.log('🆕 Creating new default project invite code...');
        // Create new default lifetime invite code (no creator - it's the project code)
        const inviteCode = await InviteCode_1.default.create({
            code: 'PROJECTINVITE',
            isLifetime: true,
            isUsed: false,
            expiresAt: null,
            createdBy: null // Project code has no creator
        });
        console.log('✅ Default project invite code created:', inviteCode.code);
        res.status(201).json({
            success: true,
            message: 'Default project invite code created',
            data: inviteCode
        });
    }
    catch (error) {
        console.error('❌ Error creating default invite code:', error);
        if (error.code === 11000) {
            res.status(400).json({
                success: false,
                error: 'Invite code already exists'
            });
            return;
        }
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.createDefaultInviteCode = createDefaultInviteCode;
/**
 * @desc    Validate an invite code
 * @route   POST /api/invites/:code/validate
 * @access  Public
 */
const validateInviteCode = async (req, res) => {
    try {
        const inviteCode = await InviteCode_1.default.findOne({
            code: req.params.code.toUpperCase()
        }).populate('createdBy', 'username name');
        if (!inviteCode) {
            res.status(404).json({
                success: false,
                valid: false,
                error: 'Invalid invite code'
            });
            return;
        }
        if (inviteCode.isUsed) {
            res.status(400).json({
                success: false,
                valid: false,
                error: 'This invite code has already been used'
            });
            return;
        }
        // Check if code is expired
        if (!inviteCode.isLifetime && inviteCode.expiresAt && inviteCode.expiresAt < new Date()) {
            res.status(400).json({
                success: false,
                valid: false,
                error: 'This invite code has expired'
            });
            return;
        }
        res.status(200).json({
            success: true,
            valid: true,
            message: 'Invite code is valid',
            data: {
                code: inviteCode.code,
                isLifetime: inviteCode.isLifetime,
                expiresAt: inviteCode.expiresAt,
                invitedBy: inviteCode.createdBy ? inviteCode.createdBy.username : 'Project'
            }
        });
    }
    catch (error) {
        console.error('❌ Error validating invite code:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.validateInviteCode = validateInviteCode;
/**
 * @desc    Get available (unused) invite codes
 * @route   GET /api/invites/available
 * @access  Public
 */
const getAvailableInviteCodes = async (req, res) => {
    try {
        const inviteCodes = await InviteCode_1.default.find({
            isUsed: false,
            $or: [
                { isLifetime: true },
                { expiresAt: { $gte: new Date() } }
            ]
        })
            .populate('createdBy', 'name email username')
            .sort('-createdAt');
        res.status(200).json({
            success: true,
            count: inviteCodes.length,
            data: inviteCodes
        });
    }
    catch (error) {
        console.error('❌ Error fetching available invite codes:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getAvailableInviteCodes = getAvailableInviteCodes;
exports.default = {
    getAllInviteCodes: exports.getAllInviteCodes,
    getMyInviteCode: exports.getMyInviteCode,
    getMyReferrals: exports.getMyReferrals,
    getInviteCodeByCode: exports.getInviteCodeByCode,
    createDefaultInviteCode: exports.createDefaultInviteCode,
    validateInviteCode: exports.validateInviteCode,
    getAvailableInviteCodes: exports.getAvailableInviteCodes
};
